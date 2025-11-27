# b2c_public_api_nodb.py
# -*- coding: utf-8 -*-
"""
Verejné B2C API bez zmeny databázy:
- anti-bot: honeypot + minimálny čas + jednoduchá captcha (sčítanie)
- GDPR: povinné 2 checkboxy (Podmienky + Ochrana súkromia)
- marketing: email/SMS/newsletter (dobrovoľné)
- dátum narodenia (voliteľné) pre narodeninový bonus
- pred loginom: verejný cenník z b2c_handler.get_public_pricelist()
- registrácia/login/objednávky idú cez tvoje b2c_handler.* funkcie
- doplnky: /api/b2c/delivery-windows, hmotné odmeny cez kód (1× na zákazníka)
"""

import os
import json
import time
import random
import secrets
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, url_for

from auth_handler import generate_password_hash  # rovnaký hashing ako registrácia/login
from mail_handler import send_email as send_reset_email  # e-maily s linkom na reset hesla

# tvoje existujúce funkcionality
import b2c_handler
import db_connector

# Poznámka: NEIMPORTUJEME tu kancelaria_b2c_api, lebo toto je verejné API

# ---------- cesty / storage ----------
BASE_DIR      = os.path.dirname(__file__)
STATIC_DIR    = os.path.join(BASE_DIR, "static")
ORDERS_DIR    = os.path.join(STATIC_DIR, "uploads", "orders")
B2C_META_DIR  = os.path.join(STATIC_DIR, "uploads", "b2c")
DATA_DIR      = os.getenv("APP_DATA_DIR", os.path.join(BASE_DIR, "data"))
os.makedirs(ORDERS_DIR, exist_ok=True)
os.makedirs(B2C_META_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

CONSENT_LOG_PATH      = os.path.join(DATA_DIR, "b2c_consent_log.jsonl")   # append-only
PROFILE_JSON_PATH     = os.path.join(DATA_DIR, "b2c_profile.json")        # stav podľa emailu
DW_PATH               = os.path.join(B2C_META_DIR, "_delivery_windows.json")
GIFTCODES_PATH        = os.path.join(B2C_META_DIR, "_giftcodes.json")      # definície kódov -> aká odmena
GIFTCODE_USAGE_PATH   = os.path.join(B2C_META_DIR, "_giftcode_usage.json") # použitie kódov podľa usera

if not os.path.exists(CONSENT_LOG_PATH):
    open(CONSENT_LOG_PATH, "a", encoding="utf-8").close()
if not os.path.exists(PROFILE_JSON_PATH):
    with open(PROFILE_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({}, f, ensure_ascii=False)

TERMS_VERSION        = os.getenv("LEGAL_TERMS_VERSION",   "1.0")
PRIVACY_VERSION      = os.getenv("LEGAL_PRIVACY_VERSION", "1.0")
CAPTCHA_MIN_SECONDS  = int(os.getenv("B2C_MIN_FORM_SECONDS", "4"))

# Dôležité: INÉ MENO BLUEPRINTU, aby nekolidoval so starým
b2c_public_bp = Blueprint("b2c_public_v2", __name__)

# ---------- pomocné I/O ----------
def _read_json_or(path, default):
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def _append_jsonl(rec: dict):
    with open(CONSENT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def _load_profiles() -> dict:
    try:
        with open(PROFILE_JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}

def _save_profiles(profiles: dict):
    _write_json(PROFILE_JSON_PATH, profiles)

def _ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr) or ""

def _ua():
    return (request.headers.get("User-Agent") or "")[:255]

def _to_bool(v):
    return str(v).strip().lower() in {"1", "true", "yes", "on"}

def _normalize_dob(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return {"raw": "", "iso_ymd": None, "md": None}
    # formát YYYY-MM-DD
    try:
        dt = datetime.strptime(raw, "%Y-%m-%d")
        return {"raw": raw, "iso_ymd": dt.strftime("%Y-%m-%d"), "md": dt.strftime("%m-%d")}
    except Exception:
        pass
    # formát MM-DD
    if len(raw) == 5 and "-" in raw:
        mm, dd = raw.split("-", 1)
        if mm.isdigit() and dd.isdigit() and 1 <= int(mm) <= 12 and 1 <= int(dd) <= 31:
            return {"raw": raw, "iso_ymd": None, "md": f"{int(mm):02d}-{int(dd):02d}"}
    # formát DD.MM.[YYYY]
    if "." in raw:
        parts = [p for p in raw.split(".") if p.strip()]
        if len(parts) >= 2:
            try:
                dd, mm = int(parts[0]), int(parts[1])
                if len(parts) == 3:
                    yyyy = int(parts[2])
                    dt = datetime(yyyy, mm, dd)
                    return {"raw": raw, "iso_ymd": dt.strftime("%Y-%m-%d"), "md": dt.strftime("%m-%d")}
                if 1 <= mm <= 12 and 1 <= dd <= 31:
                    return {"raw": raw, "iso_ymd": None, "md": f"{mm:02d}-{dd:02d}"}
            except Exception:
                pass
    return {"raw": raw, "iso_ymd": None, "md": None}

# ---------- delivery windows (Po–Pia; 08–12, 12–15) ----------
def _load_delivery_windows():
    out = []
    today = datetime.now().date()
    labels = ("08:00–12:00", "12:00–15:00")
    for i in range(7):
        d = today + timedelta(days=i)
        if d.weekday() <= 4:  # 0=Po ... 4=Pia
            for label in labels:
                out.append({
                    "id": f"{d.isoformat()}_{label.replace(':','').replace('–','-')}".lower(),
                    "date": d.isoformat(),
                    "label": label
                })
    return out

@b2c_public_bp.get("/api/b2c/delivery-windows")
def b2c_delivery_windows():
    """Vráti zoznam časových okien (len pracovné dni; do 15:00)."""
    return jsonify({"windows": _load_delivery_windows()})

# ---------- gift kódy (hmotné odmeny; 1×/zákazník) ----------
def _giftcodes_load():
    return _read_json_or(GIFTCODES_PATH, {"codes": []})

def _giftcode_find(code: str):
    if not code:
        return None
    up = code.strip().upper()
    store = _giftcodes_load()
    for c in (store.get("codes") or []):
        if str(c.get("code", "")).upper() == up:
            return c
    return None

def _giftcode_usage_load():
    return _read_json_or(GIFTCODE_USAGE_PATH, {})

def _giftcode_used(code: str, user_key: str) -> bool:
    usage = _giftcode_usage_load()
    return str(user_key) in (usage.get(code) or {})

def _giftcode_mark_used(code: str, user_key: str, order_no: str):
    usage = _giftcode_usage_load()
    per_code = usage.get(code) or {}
    per_code[str(user_key)] = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "order_no": order_no
    }
    usage[code] = per_code
    _write_json(GIFTCODE_USAGE_PATH, usage)

def _write_order_meta(order_number: str, meta: dict):
    """Uloží META k objednávke: delivery_window + rewards (darčeky)."""
    safe = "".join(ch for ch in (order_number or "") if ch.isalnum() or ch in ("-", "_")) or "objednavka"
    path = os.path.join(ORDERS_DIR, f"{safe}.meta.json")
    old = _read_json_or(path, {})
    if not isinstance(old, dict):
        old = {}
    # merge rewards
    if meta.get("rewards"):
        prev = old.get("rewards") or []
        old["rewards"] = prev + meta["rewards"]
        meta = {k: v for k, v in meta.items() if k != "rewards"}
    old.update(meta or {})
    _write_json(path, old)

# ---------- anti-bot ----------
@b2c_public_bp.get("/api/b2c/captcha/new")
def captcha_new():
    a, b = random.randint(1, 9), random.randint(1, 9)
    session["b2c_captcha"] = {"sum": a + b, "ts": int(time.time())}
    return jsonify({"question": f"Koľko je {a} + {b}?"})

def _check_antibot(payload: dict):
    # honeypot
    if payload.get("hp_url"):
        return False, "Ochrana proti botom zlyhala (HP)."
    # minimálny čas
    try:
        form_ts = int(str(payload.get("form_ts") or "0"))
    except Exception:
        form_ts = 0
    waited_ms = int(time.time() * 1000) - form_ts
    if waited_ms < CAPTCHA_MIN_SECONDS * 1000:
        return False, "Formulár bol odoslaný príliš rýchlo."
    # captcha
    expected = (session.get("b2c_captcha") or {}).get("sum")
    try:
        ans = int(str(payload.get("captcha_answer") or "").strip())
    except Exception:
        ans = None
    if expected is None or ans != expected:
        return False, "Nesprávne potvrdenie, že nie ste robot."
    session.pop("b2c_captcha", None)
    return True, ""

# ---------- verejné B2C ----------
@b2c_public_bp.get("/api/b2c/get-pricelist")
def public_pricelist():
    data = b2c_handler.get_public_pricelist()
    return jsonify(data or {})

@b2c_public_bp.post("/api/b2c/register")
def b2c_register():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True) or {}
    ok, reason = _check_antibot(payload)
    if not ok:
        return jsonify({"error": reason}), 400

    # povinné: 2 GDPR checkboxy
    if not (_to_bool(payload.get("gdpr_terms")) and _to_bool(payload.get("gdpr_privacy"))):
        return jsonify({"error": "Pre registráciu musíte potvrdiť Podmienky a Ochranu osobných údajov."}), 400

    base = {
        "name": (payload.get("name") or "").strip(),
        "email": (payload.get("email") or "").strip().lower(),
        "phone": (payload.get("phone") or "").strip(),
        "address": (payload.get("address") or "").strip(),
        "delivery_address": (payload.get("delivery_address") or "").strip() or (payload.get("address") or "").strip(),
        "password": payload.get("password") or "",
        "gdpr": True,
    }
    res = b2c_handler.process_b2c_registration(base)
    if isinstance(res, dict) and res.get("error"):
        return jsonify(res), 400

    # dobrovoľné súhlasy + DOB zapíšeme do súborov
    now_iso = datetime.utcnow().isoformat()
    email   = base["email"]
    m_email = _to_bool(payload.get("marketing_email"))
    m_sms   = _to_bool(payload.get("marketing_sms"))
    m_news  = _to_bool(payload.get("marketing_newsletter"))
    bday_ok = _to_bool(payload.get("birthday_bonus_opt_in", 1))
    dob     = _normalize_dob(payload.get("dob"))

    _append_jsonl({"ts": now_iso, "email": email, "type": "terms", "granted": True,
                   "version": TERMS_VERSION, "ip": _ip(), "ua": _ua()})
    _append_jsonl({"ts": now_iso, "email": email, "type": "privacy", "granted": True,
                   "version": PRIVACY_VERSION, "ip": _ip(), "ua": _ua()})
    if m_email:
        _append_jsonl({"ts": now_iso, "email": email, "type": "email_marketing", "granted": True, "ip": _ip(), "ua": _ua()})
    if m_sms:
        _append_jsonl({"ts": now_iso, "email": email, "type": "sms_marketing", "granted": True, "ip": _ip(), "ua": _ua()})
    if m_news:
        _append_jsonl({"ts": now_iso, "email": email, "type": "newsletter", "granted": True, "ip": _ip(), "ua": _ua()})
    if bday_ok:
        _append_jsonl({"ts": now_iso, "email": email, "type": "birthday_bonus", "granted": True, "ip": _ip(), "ua": _ua()})

    profiles = _load_profiles()
    p = profiles.get(email, {})
    p.update({
        "marketing": {"email": m_email, "sms": m_sms, "newsletter": m_news},
        "birthday_bonus_opt_in": bday_ok,
        "dob": dob,
        "gdpr": {
            "terms_version": TERMS_VERSION,
            "privacy_version": PRIVACY_VERSION,
            "consent_at": now_iso,
            "ip": _ip(),
        },
        "last_updated": now_iso
    })
    profiles[email] = p
    _save_profiles(profiles)

    return jsonify({"message": "Registrácia prebehla úspešne. Vitajte! Teraz sa môžete prihlásiť."})

@b2c_public_bp.post("/api/b2c/login")
def b2c_login():
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True) or {}
    res = b2c_handler.process_b2c_login(payload)
    if isinstance(res, dict) and res.get("error"):
        return jsonify(res), 401
    session["b2c_user"] = res.get("user")
    return jsonify({"message": res.get("message", "OK"), "user": res.get("user")})

@b2c_public_bp.post("/api/b2c/logout")
def b2c_logout():
    session.pop("b2c_user", None)
    return jsonify({"message": "Odhlásenie prebehlo úspešne."})

@b2c_public_bp.get("/api/b2c/check_session")
def b2c_check_session():
    usr = session.get("b2c_user")
    return jsonify({"loggedIn": bool(usr), "user": usr or None})

def _need_user():
    usr = session.get("b2c_user")
    if not usr:
        return None, (jsonify({"error": "Musíte byť prihlásený."}), 401)
    return usr, None

@b2c_public_bp.post("/api/b2c/submit-order")
def submit_order():
    usr, err = _need_user()
    if err:
        return err

    payload = request.get_json(silent=True) or request.form.to_dict(flat=True) or {}

    # 1) Spracovanie objednávky cez handler
    # Očakávame, že b2c_handler.submit_b2c_order vráti dict s kľúčmi:
    # 'success', 'message', 'order_data', 'pdf_attachment'
    try:
        res = b2c_handler.submit_b2c_order(usr["id"], payload)
    except ValueError as e:
        # Zachytenie chyby unpacking alebo inej ValueError
        print(f"CRITICAL ERROR in submit_b2c_order: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Interná chyba pri spracovaní objednávky (PDF). Kontaktujte podporu."}), 500
    except Exception as e:
        print(f"CRITICAL ERROR in submit_b2c_order: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Interná chyba: {str(e)}"}), 500

    if isinstance(res, dict) and res.get("error"):
        return jsonify(res), 400

    # 2) Uloženie PDF a JSON na disk (ak handler vrátil PDF)
    try:
        order_data = res.get("order_data") or {}
        order_number = order_data.get("order_number", "objednavka")
        # Bezpečný názov súboru
        safe_name = "".join(ch for ch in order_number if ch.isalnum() or ch in ("-", "_")) or "objednavka"

        pdf_bytes = None
        # Vytiahneme PDF z odpovede handlera a odstránime ho z JSON odpovede (aby nešla binary data na FE)
        if isinstance(res, dict) and isinstance(res.get("pdf_attachment"), (bytes, bytearray)):
            pdf_bytes = res.pop("pdf_attachment", None)
        
        if pdf_bytes:
            filename_pdf = f"{safe_name}.pdf"
            pdf_path = os.path.join(ORDERS_DIR, filename_pdf)
            with open(pdf_path, "wb") as f:
                f.write(pdf_bytes)
            # Pridáme URL do odpovede pre frontend
            res.setdefault("order_files", {})["pdf_url"] = f"/static/uploads/orders/{filename_pdf}"

        # Uložíme JSON meta dáta o objednávke
        try:
            filename_json = f"{safe_name}.json"
            json_path = os.path.join(ORDERS_DIR, filename_json)
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(order_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Chyba pri ukladaní JSON meta dát: {e}")

    except Exception as e:
        print(f"Chyba pri ukladaní súborov objednávky: {e}")
        import traceback
        traceback.print_exc()

    # 3) Doplnky BEZ DB: časové okno + HMOTNÉ ODMENY (gift-only; 1×/zákazník)
    # Tieto veci sú špecifické pre tvoju implementáciu, ak ich používaš
    
    delivery_window = (payload.get("delivery_window") or "").strip()
    if delivery_window:
        res.setdefault("order_data", {})["delivery_window"] = delivery_window

    reward_code = (payload.get("reward_code") or payload.get("promo_code") or "").strip()
    if reward_code:
        # Použijeme pomocné funkcie definované vyššie (alebo importované)
        rd = _giftcode_find(reward_code)
        if not rd:
            res.setdefault("warnings", []).append({"reward_code": reward_code, "reason": "neznámy_kód"})
        else:
            # identifikátor zákazníka (id -> email fallback)
            user_key = str(usr.get("id") or usr.get("email") or "")
            if not user_key:
                res.setdefault("warnings", []).append({"reward_code": reward_code, "reason": "nezistený_používateľ"})
            elif _giftcode_used(reward_code, user_key):
                res.setdefault("warnings", []).append({"reward_code": reward_code, "reason": "kód_už_použitý"})
            else:
                gift  = rd.get("gift_item") or {}
                label = gift.get("label") or rd.get("reward_label") or "Odmena"
                try:
                    qty = float(gift.get("qty") or rd.get("qty") or 1)
                except Exception:
                    qty = 1.0
                reward = {"type": "giftcode", "label": label, "qty": qty, "code": rd.get("code")}
                
                # Pridáme odmenu do odpovede
                res.setdefault("order_data", {}).setdefault("rewards", []).append(reward)

                # zapíš META a zaeviduj použitie kódu
                order_no = (res.get("order_data") or {}).get("order_number") or safe_name
                try:
                    meta_path = os.path.join(ORDERS_DIR, f"{order_no}.meta.json")
                    meta = _read_json_or(meta_path, {})
                    meta.setdefault("rewards", []).append(reward)
                    _write_json(meta_path, meta)
                except Exception:
                    pass
                _giftcode_mark_used(reward_code, user_key, order_no)

    # Ak boli nejaké meta dáta (okno, odmena), uložíme ich k objednávke
    if delivery_window or reward_code:
        order_no = (res.get("order_data") or {}).get("order_number")
        if order_no:
            _write_order_meta(order_no, res.get("order_data") or {})
    
    return jsonify(res)

@b2c_public_bp.get("/api/b2c/get-history")
def get_history():
    usr, err = _need_user()
    if err:
        return err
    res = b2c_handler.get_order_history(usr["id"])
    return jsonify(res or {})

@b2c_public_bp.get("/api/b2c/get_rewards")
def get_rewards():
    res = b2c_handler.get_available_rewards()
    return jsonify(res or {"rewards": []})

@b2c_public_bp.post("/api/b2c/claim_reward")
def claim_reward():
    usr, err = _need_user()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    rid = data.get("reward_id")
    if not rid:
        return jsonify({"error": "Chýba identifikátor odmeny."}), 400
    res = b2c_handler.claim_reward(usr["id"], rid)
    if isinstance(res, dict) and res.get("error"):
        return jsonify(res), 400
    return jsonify(res)

@b2c_public_bp.post("/api/b2c/consent/withdraw")
def withdraw():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    channels = data.get("channels") or []
    if not email or not isinstance(channels, list):
        return jsonify({"error": "Neplatná požiadavka."}), 400
    now_iso = datetime.utcnow().isoformat()
    for ch in channels:
        if ch in {"email", "sms", "newsletter"}:
            _append_jsonl({
                "ts": now_iso,
                "email": email,
                "type": f"{ch}_marketing",
                "granted": False,
                "ip": _ip(),
                "ua": _ua()
            })
    profiles = _load_profiles()
    p = profiles.get(email, {})
    m = p.get("marketing", {"email": False, "sms": False, "newsletter": False})
    if "email" in channels:
        m["email"] = False
    if "sms" in channels:
        m["sms"] = False
    if "newsletter" in channels:
        m["newsletter"] = False
    p["marketing"] = m
    p["last_updated"] = now_iso
    profiles[email] = p
    _save_profiles(profiles)
    return jsonify({"message": "Súhlasy boli odvolané."})

# -----------------------------------------------------------------
# OBNOVA HESLA – request + nastavenie nového hesla
# -----------------------------------------------------------------
@b2c_public_bp.post("/api/b2c/request_password_reset")
def b2c_request_password_reset():
    """
    1) Príde e-mail z formulára (frontend /b2c – „Zabudli ste heslo?“)
    2) Ak existuje B2C účet s daným e-mailom, vygenerujeme token, uložíme ho do b2b_zakaznici
       a pošleme e-mail s odkazom /b2c?reset_token=XYZ.
    3) Vždy vrátime rovnakú správu, aby sa nedalo hádať, či účet existuje.
    """
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True) or {}
    email = (payload.get("email") or "").strip().lower()

    if not email:
        return jsonify({"error": "E-mail je povinný."}), 400

    # nájdeme B2C zákazníka (B2B/B2C sú v jednej tabuľke)
    user = db_connector.execute_query(
        """
        SELECT id, email, nazov_firmy
        FROM b2b_zakaznici
        WHERE email = %s AND typ = 'B2C'
        LIMIT 1
        """,
        (email,),
        fetch="one"
    )

    # generická odpoveď (bez ohľadu na to, či používateľ existuje)
    generic_msg = "Ak u nás existuje účet s týmto e‑mailom, poslali sme vám odkaz na obnovu hesla."

    if not user:
        return jsonify({"message": generic_msg})

    # vygeneruj token + expiráciu (napr. 1 hodina)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=1)

    db_connector.execute_query(
        """
        UPDATE b2b_zakaznici
        SET reset_token = %s,
            reset_token_expiry = %s
        WHERE id = %s
        """,
        (token, expires_at, user["id"]),
        fetch="none"
    )

    # zostav URL na front-end (b2c stránka)
    base_url = request.url_root.rstrip("/")
    reset_url = f"{base_url}/b2c?reset_token={token}"

    body_text = f"""Dobrý deň,

prišla nám požiadavka na obnovu hesla k vášmu účtu v objednávkovom systéme MIK s.r.o.

Ak ste to boli vy, kliknite na nasledujúci odkaz (platný približne 1 hodinu):

{reset_url}

Ak ste o obnovu hesla nežiadali, môžete tento e-mail pokojne ignorovať.

S pozdravom
MIK s.r.o.
"""

    try:
        # využijeme tvoj existujúci mail helper z mail_handler.py
        send_reset_email(user["email"], "Obnova hesla - MIK s.r.o.", body_text, html=None)
    except Exception as e:
        # nechceme prezradiť nič používateľovi, len zalogujeme
        print("[B2C] Chyba pri odosielaní reset e-mailu:", e)

    return jsonify({"message": generic_msg})

@b2c_public_bp.post("/api/b2c/reset_password")
def b2c_reset_password():
    """
    Frontend odošle token + nové heslo.
    Overíme token, expiráciu a nastavíme nové heslo v b2b_zakaznici.
    """
    payload = request.get_json(silent=True) or request.form.to_dict(flat=True) or {}
    token = (payload.get("token") or "").strip()
    new_password = (payload.get("password") or "").strip()

    if not token or not new_password:
        return jsonify({"error": "Chýba token alebo nové heslo."}), 400

    if len(new_password) < 6:
        return jsonify({"error": "Heslo musí mať aspoň 6 znakov."}), 400

    # nájdeme používateľa podľa reset tokenu
    user = db_connector.execute_query(
        """
        SELECT id, email, reset_token_expiry
        FROM b2b_zakaznici
        WHERE reset_token = %s
          AND typ = 'B2C'
        LIMIT 1
        """,
        (token,),
        fetch="one"
    )

    if not user:
        return jsonify({"error": "Odkaz na obnovu hesla je neplatný alebo už bol použitý."}), 400

    expires = user.get("reset_token_expiry")
    if not expires or expires < datetime.utcnow():
        return jsonify({"error": "Odkaz na obnovu hesla expiroval. Skúste si vyžiadať nový."}), 400

    # vygeneruj nový salt + hash s rovnakým algoritmom ako registrácia/login
    salt_hex, hash_hex = generate_password_hash(new_password)

    db_connector.execute_query(
        """
        UPDATE b2b_zakaznici
        SET
          heslo_salt = %s,
          heslo_hash = %s,
          password_salt_hex = %s,
          password_hash_hex = %s,
          reset_token = NULL,
          reset_token_expiry = NULL
        WHERE id = %s
        """,
        (salt_hex, hash_hex, salt_hex, hash_hex, user["id"]),
        fetch="none"
    )

    return jsonify({"message": "Heslo bolo úspešne zmenené. Teraz sa môžete prihlásiť novým heslom."})
