# -*- coding: utf-8 -*-
"""
notification_handler – odosielanie notifikačných e-mailov pre B2B/B2C.
Nepoužíva Flask-Mail; používa smtplib a číta nastavenia z .env

Očakávané v .env:
  MAIL_SERVER, MAIL_PORT, MAIL_USE_TLS, MAIL_USE_SSL, MAIL_USERNAME, MAIL_PASSWORD, MAIL_DEFAULT_SENDER
  ADMIN_NOTIFY_EMAIL (voliteľné; fallback = MAIL_DEFAULT_SENDER)
  B2B_EXPEDITION_EMAIL (voliteľné; fallback = miksroexpedicia@gmail.com)
  B2C_SMS_ENABLED (voliteľné; default true)

Voliteľný branding (.env):
  BRAND_COMPANY_NAME="MIK s.r.o."
  BRAND_LOGO_URL="https://www.miksro.sk/wp-content/uploads/2025/09/Dizajn-bez-nazvu-1.png"
  BRAND_PRIMARY_COLOR="#0f172a"         # hlavička
  BRAND_ACCENT_COLOR="#16a34a"          # tlačidlá/akcent
  BRAND_SUPPORT_EMAIL="info@miksro.sk"
  BRAND_ADDRESS="Hollého č.1999/13, 927 05 Šaľa"
  BRAND_WEBSITE="https://www.miksro.sk"
"""

from __future__ import annotations

import os
import re
import ssl
import smtplib
import json
import mimetypes
import traceback
import base64
from email.message import EmailMessage
from typing import Optional, List, Tuple, Dict, Any
from datetime import datetime
from typing import Optional

# ── SMTP config ─────────────────────────────────────────────────
MAIL_SERVER = os.getenv("MAIL_SERVER")
# UPRAVENÉ: Default port zmenený na 587 (pre Hetzner/Websupport kompatibilitu)
MAIL_PORT = int(os.getenv("MAIL_PORT", "587"))
MAIL_USE_TLS = str(os.getenv("MAIL_USE_TLS", "True")).lower() in ("1", "true", "t", "yes")
MAIL_USE_SSL = str(os.getenv("MAIL_USE_SSL", "False")).lower() in ("1", "true", "t", "yes")
MAIL_USERNAME = os.getenv("MAIL_USERNAME")
MAIL_PASSWORD = os.getenv("MAIL_PASSWORD")
MAIL_DEFAULT_SENDER = os.getenv("MAIL_DEFAULT_SENDER") or MAIL_USERNAME
ADMIN_NOTIFY_EMAIL = os.getenv("ADMIN_NOTIFY_EMAIL") or MAIL_DEFAULT_SENDER

# Expedícia – príjemca PDF+CSV (zákazník dostáva len PDF)
EXPEDITION_EMAIL = (os.getenv("B2B_EXPEDITION_EMAIL") or "miksroexpedicia@gmail.com").strip()
EXPEDITION_EMAIL_L = EXPEDITION_EMAIL.lower()

# B2C SMS toggle
B2C_SMS_ENABLED = str(os.getenv("B2C_SMS_ENABLED", "true")).lower() in ("1", "true", "yes")

# Branding
BRAND_COMPANY_NAME = os.getenv("BRAND_COMPANY_NAME", "MIK s.r.o.")
BRAND_LOGO_URL     = os.getenv("BRAND_LOGO_URL", "https://www.miksro.sk/wp-content/uploads/2025/09/Dizajn-bez-nazvu-1.png")
BRAND_PRIMARY      = os.getenv("BRAND_PRIMARY_COLOR", "#0f172a")
BRAND_ACCENT       = os.getenv("BRAND_ACCENT_COLOR", "#16a34a")
BRAND_SUPPORT      = os.getenv("BRAND_SUPPORT_EMAIL", "info@miksro.sk")
BRAND_ADDRESS      = os.getenv("BRAND_ADDRESS", "Hollého č.1999/13, 927 05 Šaľa")
BRAND_WEBSITE      = os.getenv("BRAND_WEBSITE", "https://www.miksro.sk")

# ── cesty k úložiskám ──────────────────────────────────────────
BASE_DIR    = os.path.dirname(__file__)
OUTBOX_DIR  = os.path.join(BASE_DIR, "static", "uploads", "outbox")
ORDERS_DIR  = os.path.join(BASE_DIR, "static", "uploads", "orders")
os.makedirs(OUTBOX_DIR, exist_ok=True)
os.makedirs(ORDERS_DIR, exist_ok=True)

# ── helpers a voliteľná SMS integrácia pre B2C ──────────────────
try:
    import sms_handler as _sms
except Exception:
    _sms = None

# pre lookup telefónu podľa e-mailu (B2C zákazníci)
try:
    import db_connector as _dbc
except Exception:
    _dbc = None

def _maybe_send_sms(msisdn: str | None, text: str):
    """Tichá SMS – ak je k dispozícii sms_handler a platné číslo, pošli; ak nie, ignoruj."""
    if not B2C_SMS_ENABLED:
        return
    try:
        if _sms and msisdn:
            ms = _sms.normalize_msisdn(msisdn)
            if ms:
                _sms.send_batch(message=text, recipients=[ms], simple_text=True)
    except Exception:
        # nikdy nezhadzuj hlavný proces (napr. e-mail) kvôli SMS
        pass

def _extract_phone(data: dict | None) -> Optional[str]:
    """Skúsi vydolovať telefón z dictu (order_data/meta)."""
    if not data:
        return None
    for k in ("phone", "telefon", "tel", "mobile", "mobil", "customerPhone", "phoneNumber", "msisdn"):
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    # občas je to vnorené
    c = data.get("customer") if isinstance(data, dict) else None
    if isinstance(c, dict):
        return _extract_phone(c)
    return None

# notification_handler.py

from typing import Optional

def _normalize_phone_for_sms(phone: str | None) -> str:
    """
    Jednoduchá normalizácia telefónneho čísla pre SMS:

    - vyhodí všetko okrem číslic
    - 09xx... -> 4219xx...
    - ak začína 00, odstráni úvodné 00
    - ostatné čísla nechá tak
    """
    if not phone:
        return ""

    # len číslice
    digits = re.sub(r"\D+", "", phone)
    if not digits:
        return ""

    # 00xxx... -> xxx...
    if digits.startswith("00"):
        digits = digits[2:]

    # 09xx... -> 4219xx...
    if digits.startswith("0"):
        digits = "421" + digits[1:]

    # ak nezačína 421, necháme tak – môže ísť o zahraničné číslo
    return digits


def _lookup_b2c_phone_by_email(email: str | None) -> Optional[str]:
    """
    Ak máme DB a e-mail, pokúsi sa nájsť telefón zákazníka v DB podľa e-mailu.

    PRIORITA:
      1) b2b_zakaznici  (kde máš aj B2C s typ='B2C')
      2) b2c_zakaznici
      3) b2c_customers / customers / zakaznici

    Vracia normálny string s telefónom, alebo None.
    """
    try:
        if not (_dbc and email):
            return None

        # poradie tabuliek, kde sa snažíme telefón nájsť
        candidates = [
            "b2b_zakaznici",
            "b2c_zakaznici",
            "b2c_customers",
            "customers",
            "zakaznici",
        ]

        chosen = None
        for t in candidates:
            r = _dbc.execute_query(
                """
                SELECT COUNT(*) AS c
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME   = %s
                """,
                (t,),
                fetch="one",
            )
            if r and int(list(r.values())[0]) > 0:
                chosen = t
                break

        if not chosen:
            return None

        # zistíme názvy stĺpcov v tabuľke
        cols = _dbc.execute_query(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = %s
            """,
            (chosen,),
        ) or []
        colset = { (c.get("COLUMN_NAME") if isinstance(c, dict) else list(c.values())[0]) for c in cols }

        def pick(*names, default=None):
            for n in names:
                if n in colset:
                    return n
            return default

        col_mail  = pick("email", "mail")
        col_phone = pick("telefon", "phone", "mobil", "mobilne_cislo", "tel")

        if not (col_mail and col_phone):
            return None

        row = _dbc.execute_query(
            f"SELECT {col_phone} AS phone FROM {chosen} WHERE LOWER({col_mail})=LOWER(%s) LIMIT 1",
            (email,),
            fetch="one",
        )
        if row and row.get("phone"):
            return str(row["phone"]).strip()
        return None
    except Exception:
        return None


# ── mail low-level ─────────────────────────────────────────────
def _sanitize_filename(s: str) -> str:
    s = s or "mail"
    s = re.sub(r"[^\w.\- ]+", "_", s)
    return s[:80]

def _smtp_client():
    if not all([MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD]):
        raise RuntimeError("E-mail nie je nakonfigurovaný – chýbajú MAIL_* premenné v .env")
    
    # UPRAVENÉ: Fix pre Hetzner (ignorovania kontroly hostname pre IP adresu)
    # Vytvoríme kontext, ktorý nekontroluje zhodu IP a certifikátu
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    if MAIL_USE_SSL:
        # Použijeme náš upravený kontext
        return smtplib.SMTP_SSL(MAIL_SERVER, MAIL_PORT, context=context, timeout=30)
    
    client = smtplib.SMTP(MAIL_SERVER, MAIL_PORT, timeout=30)
    client.ehlo()
    if MAIL_USE_TLS:
        # Použijeme náš upravený kontext aj pre STARTTLS
        client.starttls(context=context)
        client.ehlo()
    return client

def _save_outbox(msg: EmailMessage, subject: str):
    try:
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        fn = f"{ts}_{_sanitize_filename(subject)}.eml"
        path = os.path.join(OUTBOX_DIR, fn)
        with open(path, "wb") as f:
            f.write(msg.as_bytes())
    except Exception:
        traceback.print_exc()

# ── low-level mail (robustné, FIX príloh) ───────────────────────
def _send_email(
    to: str | List[str],
    subject: str,
    text: Optional[str] = None,
    html: Optional[str] = None,
    atts: Optional[List[Any]] = None,
    **kwargs,
):
    """
    Vnútorná utilita na odosielanie e-mailov s pevnou podporou príloh (PDF, CSV, ...).
    Prílohy môžu byť:
      - tuple/list: (filename, data, content_type?)
      - dict: {"filename":..., "data"/"content"/"bytes"/"path":..., "content_type"/"mime":...}
      - data môže byť: bytes, file-like, filesystem path, data:URL, alebo text (ktorý zakódujeme do bytes)
    """

    # Podpora starého keywordu 'attachments='
    if atts is None and "attachments" in kwargs:
        atts = kwargs.get("attachments")

    # Autofix – ak 'text' vyzerá ako HTML, presuň do 'html'
    if isinstance(text, (bytes, bytearray)):
        try:
            text = text.decode("utf-8", "replace")
        except Exception:
            text = str(text)
    if isinstance(text, str) and ("<html" in text.lower() or "<body" in text.lower() or "<table" in text.lower()):
        html = text; text = None

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = MAIL_DEFAULT_SENDER or MAIL_USERNAME or "no-reply@localhost"
    if isinstance(to, (list, tuple, set)):
        msg["To"] = ", ".join(map(str, to))
    else:
        msg["To"] = str(to)
    # Anti auto-reply hlavičky
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"

    # plain text fallback
    if not isinstance(text, str) or not text.strip():
        text = "Tento e-mail vyžaduje HTML zobrazenie."
    msg.set_content(text)

    # HTML alternative
    if html:
        if isinstance(html, (bytes, bytearray)):
            try:
                html = html.decode("utf-8", "replace")
            except Exception:
                html = str(html)
        msg.add_alternative(html, subtype="html")

    # Pomocné normalizácie
    def _as_str(x):
        if isinstance(x, (bytes, bytearray)):
            try:
                return x.decode("utf-8", "ignore")
            except Exception:
                return str(x)
        return x

    def _normalize_content_type(ct):
        ct = _as_str(ct)
        if not ct or not isinstance(ct, str):
            return None
        return ct.strip()

    def _read_attachment_data(content, content_type_hint: str | None):
        """
        Vráti (bytes_data, maintype, subtype)
        """
        # 1) načítanie dát -> BYTES
        if isinstance(content, (bytes, bytearray)):
            data = bytes(content)
        elif hasattr(content, "read"):                                # file-like
            try:
                data = content.read()
            except Exception:
                data = b""
        elif isinstance(content, str):
            s = content.strip()
            if os.path.exists(s):                                     # filesystem path
                with open(s, "rb") as fh:
                    data = fh.read()
            elif s.startswith("data:") and "," in s:                  # data:URL
                head, b64 = s.split(",", 1)
                try:
                    data = base64.b64decode(b64, validate=False)
                except Exception:
                    data = b64.encode("utf-8", "replace")
                # MIME z head ak chýba
                if not content_type_hint:
                    try:
                        content_type_hint = head.split(";")[0][5:]    # "data:application/pdf"
                    except Exception:
                        pass
            else:
                data = s.encode("utf-8", "replace")
        else:
            data = str(content).encode("utf-8", "replace")

        # 2) MIME
        ct = _normalize_content_type(content_type_hint)
        if not ct:
            ct = "application/octet-stream"
        try:
            if "/" in ct:
                maintype, subtype = ct.split("/", 1)
            else:
                maintype, subtype = "application", "octet-stream"
        except Exception:
            maintype, subtype = "application", "octet-stream"
        return data, maintype, subtype

    def _attach(filename: str | None, content: Any, content_type: Optional[str] = None):
        filename = (filename or "attachment.bin")
        ct_hint = _normalize_content_type(content_type) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        data, maintype, subtype = _read_attachment_data(content, ct_hint)
        if isinstance(data, str):  # poistka – musí byť bytes
            data = data.encode("utf-8", "replace")
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    for a in list(atts or []):
        try:
            if isinstance(a, dict):
                _attach(
                    a.get("filename") or a.get("name"),
                    a.get("data") or a.get("content") or a.get("bytes") or a.get("path"),
                    a.get("content_type") or a.get("mime"),
                )
            elif isinstance(a, (list, tuple)) and len(a) >= 2:
                _attach(a[0], a[1], a[2] if len(a) > 2 else None)
        except Exception:
            traceback.print_exc()
            continue

    # odoslanie
    try:
        with _smtp_client() as smtp:
            if MAIL_USERNAME and MAIL_PASSWORD:
                smtp.login(MAIL_USERNAME, MAIL_PASSWORD)
            smtp.send_message(msg)
    except Exception:
        traceback.print_exc()
        _save_outbox(msg, subject)


# ── HTML layout ────────────────────────────────────────────────
def _brand_html(title: str, body_html: str, preheader: str = "") -> str:
    pre = (preheader or "").replace('"', '').strip()
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>
  body{{margin:0;background:#f6f7f9;font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111}}
  .container{{max-width:700px;margin:0 auto;background:#fff}}
  .header{{background:{BRAND_PRIMARY};padding:18px 20px;color:#fff;display:flex;align-items:center;gap:12px}}
  .header img{{max-height:38px;display:block}}
  .content{{padding:20px}}
  h1{{margin:0 0 10px 0;font-size:20px;line-height:1.3}}
  h2{{font-size:16px;margin:18px 0 8px 0}}
  .btn{{display:inline-block;background:{BRAND_ACCENT};color:#fff !important;text-decoration:none;padding:10px 14px;border-radius:6px}}
  .note{{color:#555}}
  .table{{width:100%;border-collapse:collapse}}
  .table th,.table td{{border-bottom:1px solid #e5e7eb;padding:8px;text-align:left}}
  .footer{{color:#666;padding:16px 20px;border-top:1px solid #e5e7eb;font-size:12px}}
  .preheader{{display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden}}
  a{{color:{BRAND_ACCENT}}}
</style>
</head>
<body>
  <div class="preheader">{pre}</div>
  <div class="container">
    <div class="header">
      {'<img src="'+BRAND_LOGO_URL+'" alt="'+BRAND_COMPANY_NAME+'">' if BRAND_LOGO_URL else ''}
      <div style="font-weight:600">{BRAND_COMPANY_NAME}</div>
    </div>
    <div class="content">
      {body_html}
    </div>
    <div class="footer">
      {BRAND_COMPANY_NAME} • {BRAND_ADDRESS} • <a href="mailto:{BRAND_SUPPORT}">{BRAND_SUPPORT}</a> • <a href="{BRAND_WEBSITE}">{BRAND_WEBSITE}</a><br>
      Tento e-mail bol odoslaný automaticky. Neodpovedajte.
    </div>
  </div>
</body></html>"""

def _wrap_html(title: str, body: str) -> str:
    return _brand_html(title, body, preheader=title)

# === B2C EXTRAS (delivery window + rewards) ======================
def _fmt_dw(dw: str) -> str:
    raw = (dw or "").strip()
    if not raw:
        return ""
    low = raw.lower()
    if "workdays_08_12" in low: return "Po–Pia 08:00–12:00"
    if "workdays_12_15" in low: return "Po–Pia 12:00–15:00"
    if "_" in raw and raw[:10].count("-") == 2:
        try:
            d = datetime.strptime(raw[:10], "%Y-%m-%d").strftime("%d.%m.%Y")
            label = raw[11:].replace("-", "–")
            if len(label) >= 9 and label[4].isdigit():
                return f"{d} • {label[:2]}:{label[2:4]}–{label[5:7]}:{label[7:9]}"
            return f"{d} • {label}"
        except Exception:
            pass
    return raw

def _read_order_meta(order_no: str) -> dict:
    if not order_no: return {}
    safe = "".join(ch for ch in str(order_no) if ch.isalnum() or ch in ("-","_"))
    path = os.path.join(ORDERS_DIR, f"{safe}.meta.json")
    try:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f) or {}
    except Exception:
        traceback.print_exc()
    return {}

def _compose_b2c_extras(order_data: dict, fallback_order_no: str = "") -> tuple[str, str]:
    """
    Vráti (HTML, TEXT) blok so sekciou Vyzdvihnutie + Odmeny.
    Najprv číta z order_data (delivery_window, rewards), ak chýba – dočíta z META.
    """
    od = order_data or {}
    dw = od.get("deliveryWindowPretty") or od.get("delivery_window")
    rewards = od.get("rewards") or []
    if (not dw or not rewards) and (od.get("order_number") or fallback_order_no):
        meta = _read_order_meta(od.get("order_number") or fallback_order_no)
        dw = dw or meta.get("delivery_window")
        rewards = rewards or (meta.get("rewards") or [])
    dw_txt = _fmt_dw(dw) if dw else ""

    html_parts, text_parts = [], []
    if dw_txt:
        html_parts.append("<h3 style='margin:14px 0 6px'>Vyzdvihnutie / doručenie</h3>")
        html_parts.append(f"<p style='margin:0 0 10px'>{dw_txt}</p>")
        text_parts.append(f"Vyzdvihnutie / doručenie: {dw_txt}")

    prn = (od.get("uplatnena_odmena_poznamka") or "").strip()
    if prn:
        if not rewards:
            html_parts.append("<h3 style='margin:14px 0 6px'>Odmeny</h3><ul style='margin:0 0 10px 18px'>")
        else:
            if not any(p.startswith("<h3") for p in html_parts[-2:]):
                html_parts.append("<h3 style='margin:14px 0 6px'>Odmeny</h3><ul style='margin:0 0 10px 18px'>")
        html_parts.append(f"<li>Vernostná odmena: {prn}</li>")
        if "Odmeny" not in "\n".join(text_parts): text_parts.append("Odmeny:")
        text_parts.append(f" - Vernostná odmena: {prn}")

    if rewards:
        if not any("Odmeny</h3>" in p for p in html_parts):
            html_parts.append("<h3 style='margin:14px 0 6px'>Odmeny</h3><ul style='margin:0 0 10px 18px'>")
        for r in rewards:
            label = (r.get("label") or "Odmena")
            qty = r.get("qty") or 1
            html_parts.append(f"<li>{label} × {qty}</li>")
            if "Odmeny:" not in text_parts: text_parts.append("Odmeny:")
            text_parts.append(f" - {label} × {qty}")
        html_parts.append("</ul>")

    return ("".join(html_parts), "\n".join(text_parts))

# =================================================================
# ========================  B2B NOTIFIKÁCIE  ======================
# =================================================================
def send_registration_pending_email(to: str, company: str):
    html = f"""
      <h1>Registrácia prijatá</h1>
      <p>Ďakujeme za registráciu pre B2B prístup.</p>
      <p>Firma: <strong>{company}</strong></p>
      <p>Vaša žiadosť bude spracovaná v čo najkratšom čase. Po schválení
      vám pošleme ďalší e-mail s prideleným zákazníckym číslom a cenníkom.</p>
    """
    _send_email(to, "Registrácia prijatá – B2B portál",
                html=_brand_html("Registrácia prijatá", html, "Vaša registrácia bola prijatá"))

def send_new_registration_admin_alert(data: dict):
    if not ADMIN_NOTIFY_EMAIL:
        return
    html = f"""
      <h1>Nová B2B registrácia</h1>
      <ul>
        <li>Firma: <strong>{(data or {}).get('nazov_firmy','')}</strong></li>
        <li>E-mail: {(data or {}).get('email','')}</li>
        <li>Telefón: {(data or {}).get('telefon','')}</li>
        <li>Adresa: {(data or {}).get('adresa','')}</li>
        <li>Doručovacia adresa: {(data or {}).get('adresa_dorucenia','')}</li>
      </ul>
      <p>Schváľte v module Kancelária → B2B registrácie.</p>
    """
    _send_email(ADMIN_NOTIFY_EMAIL, "Nová B2B registrácia – čaká na schválenie",
                html=_brand_html("Nová B2B registrácia", html))

def send_approval_email(to: str, company: str, customer_id: str):
    html = f"""
      <h1>B2B prístup schválený</h1>
      <p>Firma: <strong>{company}</strong><br>
      Zákaznícke číslo: <strong>{customer_id}</strong></p>
      <p>Teraz sa môžete prihlásiť na B2B portáli a vytvárať objednávky.</p>
    """
    _send_email(to, "B2B prístup schválený",
                html=_brand_html("B2B prístup schválený", html))

def send_rejection_email(to: str, company: str, reason: str = ""):
    html = f"""
      <h1>B2B registrácia zamietnutá</h1>
      <p>Mrzí nás to, ale registrácia pre <strong>{company}</strong> bola zamietnutá.</p>
      {('<p><strong>Dôvod:</strong> ' + reason + '</p>') if reason else ''}
    """
    _send_email(to, "B2B registrácia zamietnutá",
                html=_brand_html("B2B registrácia zamietnutá", html))

def send_password_reset_email(to: str, token: str):
    html = f"""
      <h1>Reset hesla</h1>
      <p>Požiadali ste o reset hesla. Ak ste to neboli vy, ignorujte tento e-mail.</p>
      <p>Token pre zmenu hesla:</p>
      <p style="font-size:18px;font-weight:700;letter-spacing:.5px">{token}</p>
      <p>Platnosť: 2 hodiny.</p>
    """
    _send_email(to, "Reset hesla – B2B",
                html=_brand_html("Reset hesla", html, "Reset hesla – token v správe"))
    
def send_order_confirmation_email(to: str | list[str],
                                  order_number: str,
                                  pdf_content: bytes | None = None,
                                  csv_content: bytes | None = None,
                                  csv_filename: str | None = None,
                                  customer_name: str | None = None,
                                  delivery_date: str | None = None):  # <--- PRIDANÉ PARAMETRE
    """
    B2B potvrdenie objednávky.
    ZÁKAZNÍK: dostane len PDF.
    EXPEDÍCIA: dostane PDF + CSV (s upraveným predmetom).
    """
    subject = f"Potvrdenie objednávky {order_number}"
    html_body = f"""
      <h1>Potvrdenie objednávky</h1>
      <p>Potvrdzujeme prijatie vašej B2B objednávky <strong>{order_number}</strong>.</p>
      <p>V prílohe prikladáme podklady.</p>
    """
    html = _brand_html("Potvrdenie objednávky", html_body)

    # normalizuj zoznam príjemcov
    if isinstance(to, (list, tuple, set)):
        recipients = [str(x).strip() for x in to if x]
    else:
        recipients = [str(to).strip()] if to else []

    to_exped = [r for r in recipients if r.lower() == EXPEDITION_EMAIL_L]
    to_others = [r for r in recipients if r.lower() != EXPEDITION_EMAIL_L]

    # priprava príloh (NEDOTKNUTÉ)
    atts_pdf_only = []
    if pdf_content:
        atts_pdf_only.append((f"objednavka_{order_number}.pdf", pdf_content, "application/pdf"))

    atts_pdf_csv = list(atts_pdf_only)
    if csv_content:
        final_csv_name = csv_filename if csv_filename else f"objednavka_{order_number}.csv"
        atts_pdf_csv.append((final_csv_name, csv_content, "text/csv"))

    # 1) pošli ostatným (zákazník) – LEN PDF
    if to_others:
        _send_email(
            to=to_others if len(to_others) > 1 else to_others[0],
            subject=subject,
            text=None,
            html=html,
            atts=atts_pdf_only
        )

    # 2) pošli expedícii – PDF + CSV
    if EXPEDITION_EMAIL:
        # --- ZAČIATOK BEZPEČNEJ ÚPRAVY PREDMETU ---
        exped_subject = f"KOPIA (B2B): {subject}"
        if customer_name and delivery_date:
            try:
                # Konverzia dátumu RRRR-MM-DD na DD.MM.RRRR pre krajšie zobrazenie
                if "-" in str(delivery_date) and len(str(delivery_date)) >= 10:
                    d_obj = datetime.strptime(str(delivery_date)[:10], "%Y-%m-%d")
                    fmt_date = d_obj.strftime("%d.%m.%Y")
                else:
                    fmt_date = delivery_date
            except Exception:
                fmt_date = delivery_date
            
            exped_subject = f"KOPIA (B2B): {customer_name} {fmt_date} {subject}"
        # --- KONIEC ÚPRAVY PREDMETU ---

        _send_email(
            to=EXPEDITION_EMAIL,
            subject=exped_subject,
            text=None,
            html=html,
            atts=atts_pdf_csv  # <--- PRÍLOHY (AJ CSV) SA POSIELAJÚ BEZ ZMENY
        )
# =================================================================
# =========================  B2C NOTIFIKÁCIE  =====================
# =================================================================
def send_b2c_registration_email(to: str, full_name: str):
    html = f"""
      <h1>Registrácia potvrdená</h1>
      <p>Dobrý deň {full_name},</p>
      <p>vaša registrácia do B2C portálu <strong>{BRAND_COMPANY_NAME}</strong> prebehla úspešne.</p>
      <p><strong>Platba:</strong> Aktuálne je možná len <strong>platba v hotovosti pri vyzdvihnutí</strong>.</p>
    """
    _send_email(to, "Registrácia potvrdená – B2C",
                html=_brand_html("Registrácia potvrdená", html, "Vaša registrácia bola potvrdená"))
    # SMS k registrácii (voliteľne – väčšina e-shopov neposiela)
    # phone = _lookup_b2c_phone_by_email(to)
    # _maybe_send_sms(phone, f"MIK: registracia na B2C bola uspesna. Dakujeme.")

def send_b2c_new_registration_admin_alert(data: dict):
    if not ADMIN_NOTIFY_EMAIL:
        return
    html = f"""
      <h1>Nová B2C registrácia</h1>
      <ul>
        <li>Meno: <strong>{(data or {}).get('name','')}</strong></li>
        <li>E-mail: {(data or {}).get('email','')}</li>
        <li>Telefón: {(data or {}).get('phone','')}</li>
        <li>Adresa: {(data or {}).get('address','')}</li>
        <li>Doručovacia adresa: {(data or {}).get('delivery_address','')}</li>
      </ul>
    """
    _send_email(ADMIN_NOTIFY_EMAIL, "Nová B2C registrácia",
                html=_brand_html("Nová B2C registrácia", html))

def send_b2c_order_confirmation(to_email: str, order_data: dict, pdf_bytes: bytes | None = None):
    """
    Potvrdenie B2C objednávky.
    UPRAVENÉ:
    - Zákazník dostane PDF.
    - Expedícia dostane KÓPIU s PDF.
    """
    order_no = (order_data.get("order_number")
                or order_data.get("orderNumber")
                or order_data.get("cislo_objednavky")
                or "").strip()

    if order_no:
        subject = f"Ďakujeme za objednávku – {order_no} potvrdená"
        heading_html = f"<h2>Ďakujeme za objednávku {order_no}</h2>"
        first_line_text = f"Ďakujeme za objednávku {order_no}."
    else:
        subject = "Ďakujeme za objednávku"
        heading_html = "<h2>Ďakujeme za objednávku</h2>"
        first_line_text = "Ďakujeme za objednávku."

    # HTML verzia
    body_html = f"""
{heading_html}
<p>Vašu objednávku sme prijali.</p>
<p>
  Tovar si môžete vyzdvihnúť v dohodnutom čase.
  Keď bude objednávka pripravená, budeme vás kontaktovať e-mailom a SMS správou
  na číslo uvedené pri registrácii.
</p>
<p>
  V prílohe nájdete potvrdenie objednávky (PDF).
  Konečná cena bude určená po prevážení.
</p>
"""
    html = _wrap_html(subject, body_html)

    # TEXT verzia (plain text)
    text_lines = [
        first_line_text,
        "Vašu objednávku sme prijali.",
        "Tovar si môžete vyzdvihnúť v dohodnutom čase.",
        "Keď bude objednávka pripravená, budeme vás kontaktovať e-mailom a SMS správou na číslo uvedené pri registrácii.",
        "V prílohe nájdete potvrdenie objednávky (PDF).",
        "Konečná cena bude určená po prevážení.",
    ]
    text = "\n".join(text_lines)

    # PDF príloha – môže prísť ako bytes alebo ako path; vždy skonvertujeme na bytes
    atts = None
    if pdf_bytes:
        if isinstance(pdf_bytes, str) and os.path.exists(pdf_bytes):
            with open(pdf_bytes, "rb") as fh:
                pdf_bytes = fh.read()
        atts = [("objednavka.pdf", pdf_bytes, "application/pdf")]

    # 1. odoslanie e-mailu ZÁKAZNÍKOVI
    _send_email(to_email, subject, text=text, html=html, atts=atts)

    # 2. odoslanie KÓPIE EXPEDÍCII
    if EXPEDITION_EMAIL:
         _send_email(
             EXPEDITION_EMAIL,
             f"KOPIA (B2C): {subject}",
             text=text,
             html=html,
             atts=atts
         )

    # Krátka SMS (ASCII kvôli SMS bránam)
    phone = _extract_phone(order_data) or _lookup_b2c_phone_by_email(to_email)
    if phone:
        _maybe_send_sms(
            phone,
            f"MIK: prijali sme objednavku {order_no}. Detaily su v e-maile. Dakujeme."
        )


def send_b2c_order_confirmation_email(to_email: str, order_data: dict, pdf_bytes: bytes | None = None):
    """Alias kvôli importom v app.py"""
    return send_b2c_order_confirmation(to_email, order_data, pdf_bytes)

def send_b2c_order_confirmation_email_with_pdf(to_email: str, order_data: dict, pdf_bytes: bytes | None = None):
    """Alias kvôli importom v app.py"""
    return send_b2c_order_confirmation(to_email, order_data, pdf_bytes)

def send_b2c_order_ready_email(to_email: str, order_no: str, final_price: float):
    """
    READY e-mail – objednávka je pripravená.

    - pošle e-mail s finálnou sumou,
    - pošle SMS s finálnou sumou a info, že tovar je pripravený na vyzdvihnutie,
    - do textu dá aj delivery window / odmeny, ak sú v META.
    """
    # poistenie – ak náhodou príde None
    try:
        fp = float(final_price or 0.0)
    except Exception:
        fp = 0.0

    subject = f"Objednávka {order_no} je pripravená – ďakujeme"

    # META (vyzdvihnutie, odmeny)
    meta = _read_order_meta(order_no)
    od = {
        "order_number": order_no,
        "delivery_window": meta.get("delivery_window"),
        "rewards": meta.get("rewards"),
    }
    extras_html, extras_text = _compose_b2c_extras(od, fallback_order_no=order_no)

    # 1 bod = 1 € (len info)
    points = int(fp) if fp > 0 else 0

    html = _wrap_html(
        subject,
        f"<h2>Objednávka {order_no} je pripravená</h2>"
        f"<p>Ďakujeme za nákup. Môžete si ju vyzdvihnúť v dohodnutom čase."
        f" V prípade zmeny nám prosím odpovedzte na tento e-mail.</p>"
        f"<p>Finálna suma: <b>{fp:.2f} €</b></p>"
        + (
            f"<p>Ako poďakovanie Vám po uzavretí tejto objednávky pripíšeme "
            f"<b>{points}</b> vernostných bodov.</p>"
            if points
            else ""
        )
        + extras_html,
    )

    text = (
        f"Objednávka {order_no} je pripravená.\n"
        f"Ďakujeme za nákup. Finálna suma: {fp:.2f} €.\n"
        + (f"Po uzavretí pripíšeme {points} vernostných bodov.\n" if points else "")
        + (extras_text + "\n" if extras_text else "")
    )

    _send_email(to_email, subject, text=text, html=html)

    # READY SMS – s finálnou sumou
    phone = _lookup_b2c_phone_by_email(to_email)
    if phone and fp > 0:
        sms_txt = f"MIK: objednavka {order_no} je pripravena. Suma {fp:.2f} EUR. Dakujeme."
        _maybe_send_sms(phone, sms_txt)



def send_b2c_order_completed_email(
    to_email: str,
    order_no: str,
    final_paid: float,
    points_added: int,
):
    """
    COMPLETED e-mail – po uzavretí objednávky:

    - zobrazí uhradenú sumu,
    - počet pripísaných bodov,
    - aktuálny stav bodov (ak ho vieme z DB),
    - pošle krátku SMS so sumou + bodmi.
    """
    try:
        fp = float(final_paid or 0.0)
    except Exception:
        fp = 0.0
    pts = int(points_added or 0)

    # načítaj aktuálny stav bodov podľa e-mailu (ak máme DB)
    total_points = None
    if _dbc and to_email:
        try:
            row = _dbc.execute_query(
                "SELECT vernostne_body FROM b2b_zakaznici WHERE LOWER(email)=LOWER(%s) LIMIT 1",
                (to_email,),
                fetch="one",
            ) or {}
            if row.get("vernostne_body") is not None:
                total_points = int(row["vernostne_body"])
        except Exception:
            total_points = None

    subject = f"Objednávka {order_no} – uzavretá, ďakujeme"

    body_html = (
        f"<h2>Objednávka {order_no} uzavretá</h2>"
        f"<p>Ďakujeme za nákup.</p>"
        f"<p>Uhradené: <b>{fp:.2f} €</b><br>"
        f"Pripísané body: <b>{pts}</b>"
    )
    if total_points is not None:
        body_html += f"<br>Aktuálny stav bodov: <b>{total_points}</b>"
    body_html += "</p>"

    html = _wrap_html(subject, body_html)

    text = f"Objednávka {order_no} uzavretá.\nUhradené: {fp:.2f} €.\nPripísané body: {pts}."
    if total_points is not None:
        text += f"\nAktuálny stav bodov: {total_points}."

    _send_email(to_email, subject, text=text, html=html)

    # SMS o úhrade + bodoch
    phone = _lookup_b2c_phone_by_email(to_email)
    if phone and (fp > 0 or pts != 0):
        if total_points is not None:
            sms = f"MIK: objednavka {order_no} uzavreta. Suma {fp:.2f} EUR, +{pts} bodov, spolu {total_points}."
        else:
            sms = f"MIK: objednavka {order_no} uzavreta. Suma {fp:.2f} EUR, +{pts} bodov."
        _maybe_send_sms(phone, sms)

def send_b2c_birthday_bonus_email(to_email: str, full_name: str, month_genitive: str, points: int, milestone: bool = False, age: int | None = None):
    if milestone and age:
        subject = f"Jubileum, {full_name}! 🎉 Pripísali sme Vám {points} bodov"
        lead = f"K Vašim <strong>{age}. narodeninám</strong> Vám s radosťou pripisujeme <strong>{points} vernostných bodov</strong>."
    else:
        subject = f"Váš narodeninový bonus {points} bodov 🎉"
        lead = f"V <strong>{month_genitive}</strong> máte narodeniny. Ako poďakovanie za Vašu priazeň Vám pripisujeme <strong>{points} vernostných bodov</strong>."
    html = f"""
      <h1>Všetko najlepšie!</h1>
      <p>Milý/á {full_name},</p>
      <p>{lead}</p>
      <p>Body uvidíte vo svojom vernostnom účte a môžete ich využiť na <strong>odmenu v podobe našich výrobkov</strong> pri najbližšej objednávke.</p>
      <p>Želáme Vám veľa zdravia, radosti a dobrú chuť!</p>
    """
    _send_email(to_email, subject,
                html=_brand_html("Narodeninový bonus", html, "Narodeninový bonus – ďakujeme za vernosť"))

    # (voliteľné) SMS k narodeninám – len stručné info
    phone = _lookup_b2c_phone_by_email(to_email)
    sms_txt = f"MIK: narodeninovy bonus {points} bodov bol pripisany. Vsetko najlepsie!"
    _maybe_send_sms(phone, sms_txt)

def send_points_awarded_email(to: str, points_delta: int, template: str | None = None, custom_message: str | None = None):
    pts = int(points_delta)
    sign = "+" if pts >= 0 else "−"
    pts_abs = abs(pts)
    if custom_message:
        lead = custom_message.strip()
    else:
        if template == "10orders":
            lead = f"Za Vašu 10. objednávku v uplynulých 2 mesiacoch Vám pripisujeme {pts_abs} bodov ako poďakovanie za vernosť."
        elif template == "campaign":
            lead = f"V rámci aktuálnej kampane Vám pripisujeme {pts_abs} bodov."
        elif template == "goodwill":
            lead = f"Pripísali/doplnili sme Vám {pts_abs} bodov ako gesto vďaky za Vašu priazeň."
        else:
            lead = f"Upravili sme stav Vášho vernostného účtu o {sign}{pts_abs} bodov."
    html = f"""
      <h1>Zmena vernostných bodov</h1>
      <p>{lead}</p>
      <p>Aktuálny stav bodov uvidíte po prihlásení do B2C portálu.</p>
      <p>Ďakujeme, že ste s nami.</p>
    """
    _send_email(to, f"Zmena vernostných bodov: {sign}{pts_abs} bodov",
                html=_brand_html("Vernostné body – aktualizácia", html, "Aktualizácia vernostných bodov"))

    # === SMS (stručná informácia o zmene bodov) ==================
    phone = _lookup_b2c_phone_by_email(to)
    sms_txt = f"MIK: vernostne body zmena {sign}{pts_abs}."
    _maybe_send_sms(phone, sms_txt)

def send_b2c_campaign_email(to: str, subject: str, html_body: str, preheader: str = ""):
    _send_email(to, subject, html=_brand_html(subject, html_body, preheader))

def send_fleet_expiry_alert_batch(alerts: list, admin_phone: str = None):
    """
    Odošle e-mail a SMS so zoznamom áut, ktorým končí platnosť.
    """
    if not alerts:
        return

    # 1. E-mail adminovi
    subject = f"FLEET ALERT: {len(alerts)} vozidiel vyžaduje pozornosť"
    html_list = "".join([f"<li>{a}</li>" for a in alerts])
    html_body = f"""
        <h2>Upozornenie na termíny vozového parku</h2>
        <p>Nasledujúcim vozidlám končí platnosť STK alebo známky:</p>
        <ul style='color:red; font-weight:bold;'>
            {html_list}
        </ul>
        <p>Prosím, aktualizujte dátumy v module Vozový park.</p>
    """
    
    if ADMIN_NOTIFY_EMAIL:
        _send_email(
            ADMIN_NOTIFY_EMAIL, 
            subject, 
            html=_brand_html("Fleet Alert", html_body, "Upozornenie na exspirácie")
        )

    # 2. SMS (ak je zapnuté a máme číslo)
    if B2C_SMS_ENABLED and admin_phone:
        sms_lines = ["MIK FLEET POZOR:"]
        for a in alerts:
            # Skrátime text pre SMS
            clean_a = a.replace("VOZIDLO ", "").replace("Diaľničná známka", "Znamka")
            sms_lines.append(clean_a)
        
        full_sms = "\n".join(sms_lines)
        _maybe_send_sms(admin_phone, full_sms)
# =================================================================
# =========================  ADMIN ALERT  =========================
# =================================================================
def send_admin_alert(message: str, subject: str = "B2C – systémová notifikácia"):
    html = f"<h1>Upozornenie</h1><pre style='white-space:pre-wrap'>{message}</pre>"
    _send_email(ADMIN_NOTIFY_EMAIL or MAIL_DEFAULT_SENDER,
                subject,
                html=_brand_html(subject, html, "Systémové upozornenie"))