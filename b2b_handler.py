import os, hmac, base64, json, time
import hashlib
import secrets
import traceback
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Tuple
from flask import request

import db_connector
import pdf_generator
import notification_handler

# ───────────────── DB chyby ─────────────────
try:
    from mysql.connector import errors as db_errors
except Exception:
    class _E(Exception): ...
    class db_errors:  # type: ignore
        IntegrityError = _E
        ProgrammingError = _E
        DatabaseError = _E

# kam posielame PDF+CSV pre expedíciu
EXPEDITION_EMAIL = os.getenv("B2B_EXPEDITION_EMAIL") or "miksroexpedicia@gmail.com"

# ───────────────── DDL helpery ─────────────────
def _exec_ddl(sql: str) -> None:
    try:
        db_connector.execute_query(sql, fetch="none")
    except Exception:
        pass

def _ensure_system_settings() -> None:
    _exec_ddl("""
    CREATE TABLE IF NOT EXISTS system_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kluc VARCHAR(191) UNIQUE,
      hodnota TEXT,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """)

def _ensure_pricelist_tables() -> None:
    _exec_ddl("""
    CREATE TABLE IF NOT EXISTS b2b_cenniky (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nazov_cennika VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """)
    _exec_ddl("""
    CREATE TABLE IF NOT EXISTS b2b_cennik_polozky (
      id INT AUTO_INCREMENT PRIMARY KEY,
      cennik_id INT NOT NULL,
      ean_produktu VARCHAR(64) NOT NULL,
      nazov_vyrobku VARCHAR(255),
      cena DECIMAL(10,2) NOT NULL DEFAULT 0,
      UNIQUE KEY uq_pl (cennik_id, ean_produktu),
      CONSTRAINT fk_pl_cennik FOREIGN KEY (cennik_id) REFERENCES b2b_cenniky(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """)

def _ensure_mapping_table() -> None:
    _exec_ddl("""
    CREATE TABLE IF NOT EXISTS b2b_zakaznik_cennik (
      zakaznik_id VARCHAR(64) NOT NULL,
      cennik_id INT NOT NULL,
      PRIMARY KEY (zakaznik_id, cennik_id),
      KEY idx_cennik (cennik_id),
      CONSTRAINT fk_map_cennik FOREIGN KEY (cennik_id) REFERENCES b2b_cenniky(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """)

def _ensure_comm_table() -> None:
    _exec_ddl("""
    CREATE TABLE IF NOT EXISTS b2b_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      customer_id INT NULL,
      zakaznik_login VARCHAR(64),
      customer_name VARCHAR(255),
      customer_email VARCHAR(255),
      subject VARCHAR(255),
      body TEXT,
      direction ENUM('in','out') NOT NULL DEFAULT 'in',
      status ENUM('new','read','closed') NOT NULL DEFAULT 'new',
      attachment_path VARCHAR(500),
      attachment_filename VARCHAR(255),
      attachment_mime VARCHAR(120),
      attachment_size INT,
      parent_id INT NULL,
      INDEX idx_status (status),
      INDEX idx_customer (customer_id),
      INDEX idx_login (zakaznik_login),
      INDEX idx_parent (parent_id),
      FOREIGN KEY (customer_id) REFERENCES b2b_zakaznici(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """)
def _existing_columns(table_name: str) -> set[str]:
    try:
        rows = db_connector.execute_query(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            """,
            (table_name,),
            fetch="all",
        ) or []
        return {r.get("COLUMN_NAME") for r in rows}
    except Exception:
        traceback.print_exc()
        return set()

# ───────────────── Anti-bot (voliteľné) ─────────────────
SECRET = (os.getenv("SECRET_KEY") or "dev-secret").encode()

def _ua_hash(ua: str) -> str:
    return hashlib.sha256((ua or "").encode("utf-8")).hexdigest()[:16]

def issue_antibot_token(user_agent: str | None = None) -> Dict[str, Any]:
    ua = user_agent or request.headers.get("User-Agent", "")
    iat = int(time.time() * 1000)
    payload = {"iat": iat, "ua": _ua_hash(ua), "rnd": secrets.token_hex(8)}
    payload_str = json.dumps(payload, separators=(",", ":"))
    sig = hmac.new(SECRET, payload_str.encode(), hashlib.sha256).hexdigest()
    token = base64.urlsafe_b64encode(f"{payload_str}.{sig}".encode()).decode()
    return {"token": token, "min_delay_ms": 800, "expires_in_ms": 20 * 60 * 1000}

def _verify_antibot_token_if_present(data: dict) -> bool:
    token = (data or {}).get("ab_token")
    if not token:
        return True
    try:
        raw = base64.urlsafe_b64decode((token or "").encode()).decode()
        payload_str, sig = raw.rsplit(".", 1)
        exp = hmac.new(SECRET, payload_str.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(exp, sig):
            return False
        p = json.loads(payload_str)
        if p.get("ua") != _ua_hash(request.headers.get("User-Agent", "")):
            return False
        iat = int(p.get("iat", 0))
        now = int(time.time() * 1000)
        age = now - iat
        return (age >= 800) and (age <= 20 * 60 * 1000)
    except Exception:
        return False
def _get_password_column_names() -> Tuple[str, str]:
    """
    Zistí, či tabuľka b2b_zakaznici používa nové ('password_*') alebo staré ('heslo_*') stĺpce.
    Vráti dvojicu (hash_col, salt_col).
    """
    try:
        rows = db_connector.execute_query(
            """
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME='b2b_zakaznici'
              AND COLUMN_NAME IN ('password_hash_hex','password_salt_hex','heslo_hash','heslo_salt')
            """,
            fetch="all",
        ) or []
        cols = {r.get("COLUMN_NAME") for r in rows}
        if "password_hash_hex" in cols and "password_salt_hex" in cols:
            return ("password_hash_hex", "password_salt_hex")
        if "heslo_hash" in cols and "heslo_salt" in cols:
            return ("heslo_hash", "heslo_salt")
    except Exception:
        traceback.print_exc()
    # default – preferuj nové názvy
    return ("password_hash_hex", "password_salt_hex")

# ───────────────── Utility ─────────────────
def _normalize_date_to_str(d: Any) -> str:
    """YYYY-MM-DD string pre datetime/date/str/None."""
    if isinstance(d, (datetime, date)):
        return d.strftime("%Y-%m-%d")
    return d or ""

def _to_float(x: Any, default: float = 0.0) -> float:
    try:
        if x is None or x == "":
            return float(default)
        return float(x)
    except Exception:
        return float(default)

# ───────────────── Heslá / login helpery ─────────────────
def _hash_password(password: str) -> Tuple[str, str]:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 250000)
    return salt.hex(), key.hex()

def _verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex or "")
        stored = bytes.fromhex(hash_hex or "")
        new = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 250000)
        return secrets.compare_digest(new, stored)
    except Exception:
        return False

def _pending_login() -> str:
    base = "PENDING-"
    while True:
        cand = base + secrets.token_hex(4).upper()
        row = db_connector.execute_query(
            "SELECT id FROM b2b_zakaznici WHERE zakaznik_id = %s", (cand,), fetch="one"
        )
        if not row:
            return cand

def _login_from_user_id(num_or_login):
    if num_or_login is None:
        return None
    if isinstance(num_or_login, str) and not num_or_login.isdigit():
        return num_or_login
    try:
        row = db_connector.execute_query(
            "SELECT zakaznik_id FROM b2b_zakaznici WHERE id=%s",
            (int(num_or_login),),
            fetch="one",
        )
        return row["zakaznik_id"] if row else None
    except Exception:
        return None

# ───────────────── PORTÁL (produkty, login) ─────────────────
def get_products_for_pricelist(pricelist_id):
    if not pricelist_id:
        return {"error": "Chýba ID cenníka."}
    # PRIDANÉ: cp.info do SELECTu
    rows = db_connector.execute_query(
        """
        SELECT cp.ean_produktu, p.nazov_vyrobku, cp.cena, cp.info, p.dph, p.mj, p.predajna_kategoria
        FROM b2b_cennik_polozky cp
        JOIN produkty p
          ON (p.ean COLLATE utf8mb4_slovak_ci) = (cp.ean_produktu COLLATE utf8mb4_slovak_ci)
        WHERE cp.cennik_id=%s
        ORDER BY p.predajna_kategoria, p.nazov_vyrobku
        """,
        (pricelist_id,),
    ) or []
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        r["cena"] = _to_float(r.get("cena"))
        r["dph"]  = abs(_to_float(r.get("dph")))
        # Info posielame na frontend
        r["info"] = r.get("info") or ""
        out.setdefault(r.get("predajna_kategoria") or "Nezaradené", []).append(r)
    return {"productsByCategory": out}

def _portal_customer_payload(login_id: str):
    _ensure_system_settings()
    pricelists = db_connector.execute_query(
        """
        SELECT c.id, c.nazov_cennika
        FROM b2b_cenniky c
        JOIN b2b_zakaznik_cennik zc ON zc.cennik_id = c.id
        WHERE zc.zakaznik_id = %s
        """,
        (login_id,),
    ) or []
    row = db_connector.execute_query(
        "SELECT hodnota FROM system_settings WHERE kluc='b2b_announcement' LIMIT 1",
        fetch="one",
    )
    payload = {"pricelists": pricelists, "announcement": (row["hodnota"] if row else "")}
    if len(pricelists) == 1:
        payload |= get_products_for_pricelist(pricelists[0]["id"])
    return payload

def process_b2b_login(data: dict):
    if (data or {}).get("hp"):
        return {"error": "Neplatný vstup."}
    if not _verify_antibot_token_if_present(data):
        return {"error": "Overenie zlyhalo. Skúste znova."}

    zakaznik_id = (data or {}).get("zakaznik_id")
    password    = (data or {}).get("password")
    if not zakaznik_id or not password:
        return {"error": "Zadajte prihlasovacie meno aj heslo."}

    cols_in_db = _existing_columns("b2b_zakaznici")

    select_parts = ["id", "zakaznik_id", "nazov_firmy", "email", "adresa"] # Pridaná adresa
    if "je_schvaleny" in cols_in_db:
        select_parts.append("je_schvaleny")
    else:
        select_parts.append("1 AS je_schvaleny")
    if "je_admin" in cols_in_db:
        select_parts.append("je_admin")
    else:
        select_parts.append("0 AS je_admin")

    if "password_salt_hex" in cols_in_db:
        select_parts.append("password_salt_hex AS password_salt_hex")
    elif "heslo_salt" in cols_in_db:
        select_parts.append("heslo_salt AS password_salt_hex")
    else:
        return {"error": "Schéma nemá stĺpec pre SALT."}

    if "password_hash_hex" in cols_in_db:
        select_parts.append("password_hash_hex AS password_hash_hex")
    elif "heslo_hash" in cols_in_db:
        select_parts.append("heslo_hash AS password_hash_hex")
    else:
        return {"error": "Schéma nemá stĺpec pre HASH hesla."}

    where = "WHERE zakaznik_id=%s"
    if "typ" in cols_in_db:
        where += " AND typ='B2B'"

    q = f"SELECT {', '.join(select_parts)} FROM b2b_zakaznici {where} LIMIT 1"
    user = db_connector.execute_query(q, (zakaznik_id,), fetch="one")

    ok = user and _verify_password(
        password,
        user.get("password_salt_hex"),
        user.get("password_hash_hex"),
    )
    if not ok:
        return {"error": "Nesprávne meno alebo heslo."}
    if (not user.get("je_admin")) and str(user.get("je_schvaleny")) in ("0", "False", "false"):
        return {"error": "Účet zatiaľ nebol schválený administrátorom."}

    # === LOGIKA PRE POBOČKY (SUB-ACCOUNTS) ===
    sub_accounts = []
    try:
        # Načítame všetky deti, ktoré patria tomuto rodičovi
        # Dôležité: sub-account nemusí mať heslo, ale musí mať zakaznik_id (ERP kód)
        children = db_connector.execute_query(
            "SELECT id, zakaznik_id, nazov_firmy, adresa, adresa_dorucenia "
            "FROM b2b_zakaznici WHERE parent_id=%s ORDER BY zakaznik_id",
            (user['id'],),
            fetch="all"
        ) or []
        sub_accounts = children
    except Exception:
        traceback.print_exc()
    # ==========================================

    resp = {
        "id": user["id"],
        "zakaznik_id": user["zakaznik_id"],
        "nazov_firmy": user["nazov_firmy"],
        "email": user["email"],
        "adresa": user.get("adresa", ""),
        "role": "admin" if str(user.get("je_admin")) not in ("0", "False", "false") else "zakaznik",
        "sub_accounts": sub_accounts # Posielame na frontend
    }
    
    # Ak nemá sub-účty, pošleme cenníky pre neho. 
    # Ak má sub-účty, cenníky sa načítajú až po výbere pobočky (frontend zavolá reload).
    if resp["role"] == "zakaznik":
        resp |= _portal_customer_payload(user["zakaznik_id"])
        
    return {"message": "Prihlásenie úspešné.", "userData": resp}
# ───────────────── Registrácia / Reset ─────────────────
def process_b2b_registration(data: dict):
    req = data or {}

    # 1. ANTI-BOT: Honeypot (ak je vyplnené skryté pole 'hp', je to bot)
    if req.get("hp"):
        return {"error": "Neplatný vstup."}

    # 2. ANTI-BOT: Token (existujúca funkcia)
    if not _verify_antibot_token_if_present(req):
        return {"error": "Overenie zlyhalo. Skúste znova."}

    # 3. ANTI-BOT: Matematická Captcha (NOVÉ)
    # Očakávame kľúče: captcha_a, captcha_b, captcha_answer
    try:
        c_a = int(req.get('captcha_a', 0))
        c_b = int(req.get('captcha_b', 0))
        # Default -999, aby 0+0 neprešlo náhodou
        c_ans = int(req.get('captcha_answer', -999))

        if c_a + c_b != c_ans:
            return {"error": "Nesprávny výsledok bezpečnostného príkladu (Antispam)."}
    except (ValueError, TypeError):
        # Ak používateľ pošle text namiesto čísla alebo nič
        return {"error": "Prosím, vyplňte číselný výsledok bezpečnostného príkladu."}

    # 4. Kontrola povinných polí
    required = ["email", "nazov_firmy", "telefon", "adresa", "password"]
    for k in required:
        if not req.get(k):
            return {"error": "Všetky polia sú povinné."}

    # 5. Kontrola GDPR
    if not req.get("gdpr"):
        return {"error": "Je potrebný súhlas so spracovaním osobných údajov."}

    # 6. Kontrola unikátneho emailu v DB
    if db_connector.execute_query(
        "SELECT id FROM b2b_zakaznici WHERE LOWER(email)=LOWER(%s) LIMIT 1",
        (req["email"],),
        fetch="one",
    ):
        return {"error": "Účet s týmto e-mailom už existuje."}

    # 7. Generovanie loginu a hashovanie hesla
    pending_login = _pending_login()
    salt_hex, hash_hex = _hash_password(req["password"])

    # 8. Dynamické zistenie stĺpcov v tabuľke (aby to nepadlo pri zmene štruktúry)
    cols_in_db = _existing_columns("b2b_zakaznici")

    cols = []
    vals = []

    def add(col, val):
        if col in cols_in_db:
            cols.append(col)
            vals.append(val)

    # Pridanie hodnôt do zoznamu
    add("zakaznik_id", pending_login)
    add("nazov_firmy", req["nazov_firmy"])
    add("email", req["email"])
    add("telefon", req["telefon"])
    add("adresa", req["adresa"])
    add("adresa_dorucenia", req.get("adresa_dorucenia") or "")

    # Nastavenie flagov
    add("typ", "B2B")
    add("je_schvaleny", 0)     # Čaká na schválenie
    add("je_admin", 0)
    add("reset_token", None)
    add("reset_token_expiry", None)

    # Uloženie hesla (podporujeme oba typy stĺpcov pre kompatibilitu)
    add("password_hash_hex", hash_hex)
    add("password_salt_hex", salt_hex)
    add("heslo_hash", hash_hex)
    add("heslo_salt", salt_hex)

    # Bezpečnostná poistka – ak by v DB chýbalo kľúčové pole
    if "zakaznik_id" not in cols:
        return {"error": "Schéma tabuľky b2b_zakaznici je neúplná (chýba 'zakaznik_id')."}

    # 9. Zostavenie a vykonanie SQL príkazu
    placeholders = ",".join(["%s"] * len(cols))
    sql = f"INSERT INTO b2b_zakaznici ({', '.join(cols)}) VALUES ({placeholders})"

    try:
        db_connector.execute_query(sql, tuple(vals), fetch="none")
    except Exception as e:
        traceback.print_exc()
        return {"error": f"Registrácia zlyhala: {getattr(e, 'msg', str(e))}"}

    # 10. Odoslanie notifikácií (Email zákazníkovi + Alert adminovi)
    try:
        notification_handler.send_registration_pending_email(
            to=req["email"], company=req["nazov_firmy"]
        )
        notification_handler.send_new_registration_admin_alert(req)
    except Exception:
        traceback.print_exc()
        # Chyba v mailoch by nemala zablokovať úspešnú registráciu v DB

    return {"message": "Registrácia odoslaná. Po schválení v kancelárii dostanete e-mail."}


def request_password_reset(data: dict):
    if (data or {}).get("hp"):
        return {"error": "Neplatný vstup."}
    if not _verify_antibot_token_if_present(data):
        return {"error": "Overenie zlyhalo. Skúste znova."}

    email = (data or {}).get("email")
    if not email:
        return {"error": "Zadajte e-mail."}

    user = db_connector.execute_query(
        "SELECT id FROM b2b_zakaznici WHERE email=%s AND typ='B2B'",
        (email,),
        fetch="one",
    )
    if not user:
        return {"error": "Účet s daným e-mailom neexistuje."}

    # vygeneruj token
    token = secrets.token_urlsafe(32)
    # platnosť 10 minút, používame UTC, lebo tak sa kontroluje v perform_password_reset
    expiry = datetime.utcnow() + timedelta(minutes=10)

    db_connector.execute_query(
        "UPDATE b2b_zakaznici SET reset_token=%s, reset_token_expiry=%s WHERE id=%s",
        (token, expiry, user["id"]),
        fetch="none",
    )

    # sprav klikateľný link do mailu, napr. http://127.0.0.1:5000/b2b?token=....
    try:
        base_url = os.getenv("B2B_PORTAL_URL")
        if not base_url:
            # request.host_url = "http://127.0.0.1:5000/"
            # path na portál je /b2b
            if request:
                base_url = request.host_url.rstrip("/") + "/b2b"
            else:
                base_url = "http://127.0.0.1:5000/b2b"
        reset_link = f"{base_url}?token={token}"
        # POZOR: notification_handler teraz dostane už celý URL link, nie holý token
        notification_handler.send_password_reset_email(email, reset_link)
    except Exception:
        traceback.print_exc()

    return {"message": "Poslali sme vám e-mail s odkazom na zmenu hesla. Odkaz platí 10 minút."}

def perform_password_reset(data: dict):
    if (data or {}).get("hp"):
        return {"error": "Neplatný vstup."}
    if not _verify_antibot_token_if_present(data):
        return {"error": "Overenie zlyhalo. Skúste znova."}

    token = (data or {}).get("token") or ""
    # podporujeme aj staré "new_password" aj nové "password"
    new_password = (data or {}).get("new_password") or (data or {}).get("password") or ""
    if len(new_password) < 6:
        return {"error": "Heslo musí mať aspoň 6 znakov."}

    user = db_connector.execute_query(
        "SELECT id, reset_token_expiry FROM b2b_zakaznici WHERE reset_token=%s LIMIT 1",
        (token,), fetch="one"
    )
    if not user:
        return {"error": "Neplatný alebo expirovaný odkaz."}
    if user.get("reset_token_expiry") and user["reset_token_expiry"] < datetime.utcnow():
        return {"error": "Odkaz na zmenu hesla expiroval."}

    salt_hex, hash_hex = _hash_password(new_password)
    hash_col, salt_col = _get_password_column_names()

    # pokus s novým schémou (má aj reset_token stĺpce)
    try:
        db_connector.execute_query(
            f"""
            UPDATE b2b_zakaznici
               SET {hash_col}=%s, {salt_col}=%s,
                   reset_token=NULL, reset_token_expiry=NULL
             WHERE id=%s
            """,
            (hash_hex, salt_hex, user["id"]),
            fetch="none",
        )
    except Exception:
        # fallback pre staršie schémy bez reset_token stĺpcov
        db_connector.execute_query(
            f"UPDATE b2b_zakaznici SET {hash_col}=%s, {salt_col}=%s WHERE id=%s",
            (hash_hex, salt_hex, user["id"]),
            fetch="none",
        )
    return {"message": "Heslo bolo zmenené. Môžete sa prihlásiť."}


# ───────────────── Kancelária – registrácie / cenníky / zákazníci / oznam ─────────────────
def get_pending_b2b_registrations():
    rows = db_connector.execute_query(
        """
        SELECT id, zakaznik_id, nazov_firmy, email, telefon, adresa, adresa_dorucenia, je_schvaleny, datum_registracie
        FROM b2b_zakaznici
        WHERE typ='B2B' AND (je_schvaleny=0 OR zakaznik_id LIKE 'PENDING-%')
        ORDER BY id DESC
        """
    ) or []
    return {"registrations": rows}

def approve_b2b_registration(data: dict):
    reg_id = (data or {}).get("id")
    customer_id = (data or {}).get("customer_id") or (data or {}).get("customerId")
    pricelist_ids = (data or {}).get("pricelist_ids") or (data or {}).get("pricelistIds") or []

    if (not reg_id) or (not customer_id):
        return {"error": "Chýba id registrácie alebo zákaznícke číslo."}

    # zákaznícke číslo musí byť unikátne
    exists = db_connector.execute_query(
        "SELECT id FROM b2b_zakaznici WHERE zakaznik_id=%s",
        (customer_id,), fetch="one",
    )
    if exists:
        return {"error": f"Zákaznícke číslo '{customer_id}' už existuje."}

    db_connector.execute_query(
        "UPDATE b2b_zakaznici SET je_schvaleny=1, zakaznik_id=%s WHERE id=%s",
        (customer_id, reg_id), fetch="none",
    )

    # mapovanie na cenník (ak prišlo)
    if pricelist_ids:
        _ensure_mapping_table()
        conn = db_connector.get_connection()
        cur = conn.cursor()
        try:
            cur.executemany(
                "INSERT INTO b2b_zakaznik_cennik (zakaznik_id, cennik_id) VALUES (%s, %s)",
                [(customer_id, int(pid)) for pid in pricelist_ids],
            )
            conn.commit()
        finally:
            try:
                cur.close(); conn.close()
            except Exception:
                pass

    # pošleme potvrdzovací e-mail
    cust = db_connector.execute_query(
        "SELECT email, nazov_firmy FROM b2b_zakaznici WHERE id=%s",
        (reg_id,), fetch="one",
    )
    if cust:
        try:
            notification_handler.send_approval_email(
                cust["email"], cust["nazov_firmy"], customer_id
            )
        except Exception:
            traceback.print_exc()

    return {"message": "Registrácia schválená a notifikácia odoslaná."}

def reject_b2b_registration(data: dict):
    reg_id = (data or {}).get("id")
    reason = (data or {}).get("reason") or ""
    row = db_connector.execute_query(
        "SELECT email, nazov_firmy FROM b2b_zakaznici WHERE id=%s",
        (reg_id,),
        fetch="one",
    )
    db_connector.execute_query("DELETE FROM b2b_zakaznici WHERE id=%s", (reg_id,), fetch="none")
    if row:
        try:
            notification_handler.send_rejection_email(row["email"], row["nazov_firmy"], reason)
        except Exception:
            traceback.print_exc()
    return {"message": "Registrácia bola zamietnutá."}

def get_customers_and_pricelists():
    import db_connector
    
    # 1. Zákazníci - VRÁTENÁ STRIKTNÁ PODMIENKA: WHERE typ='B2B'
    customers = db_connector.execute_query(
        """
        SELECT id, parent_id, zakaznik_id, nazov_firmy, email, telefon, 
               adresa, adresa_dorucenia, je_schvaleny, trasa_id, trasa_poradie
        FROM b2b_zakaznici 
        WHERE typ='B2B'
        ORDER BY nazov_firmy
        """
    ) or []
    
    # 2. Cenníky
    pricelists = db_connector.execute_query("SELECT id, nazov_cennika FROM b2b_cenniky ORDER BY nazov_cennika") or []
    
    # 3. Trasy
    routes = db_connector.execute_query("SELECT id, nazov FROM logistika_trasy WHERE is_active=1 ORDER BY nazov") or []
    
    # 4. Mapovanie cenníkov
    try:
        mapping_rows = db_connector.execute_query("SELECT zakaznik_id, cennik_id FROM b2b_zakaznik_cennik") or []
    except Exception:
        mapping_rows = []

    by_customer = {}
    for m in mapping_rows:
        by_customer.setdefault(str(m['zakaznik_id']), []).append(m['cennik_id'])
        
    return {"customers": customers, "pricelists": pricelists, "routes": routes, "mapping": by_customer}


def update_customer_details(data: dict):
    cid = data.get("id")
    if not cid:
        return {"error": "Chýba id zákazníka."}

    fields = data.get("fields", data)
    trasa_id = fields.get('trasa_id')
    trasa_poradie = fields.get('trasa_poradie')

    # Bezpečné spracovanie prázdnych hodnôt
    if str(trasa_id).strip() in ["", "null", "None"]:
        trasa_id = None
    else:
        trasa_id = int(trasa_id)

    if str(trasa_poradie).strip() in ["", "null", "None"]:
        trasa_poradie = 999
    else:
        trasa_poradie = int(trasa_poradie)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        # TVRDÝ ZÁPIS A COMMIT
        cur.execute("""
            UPDATE b2b_zakaznici 
            SET nazov_firmy=%s, email=%s, telefon=%s, adresa=%s, 
                adresa_dorucenia=%s, je_schvaleny=%s, trasa_id=%s, trasa_poradie=%s
            WHERE id=%s
        """, (fields.get('nazov_firmy'), fields.get('email'), fields.get('telefon'), 
              fields.get('adresa'), fields.get('adresa_dorucenia'), fields.get('je_schvaleny', 1), 
              trasa_id, trasa_poradie, cid))
        conn.commit()
    except Exception as e:
        if conn: conn.rollback()
        return {"error": f"Chyba pri ukladaní trasy: {str(e)}"}
    finally:
        if conn and conn.is_connected():
            conn.close()

    # Cenníky necháme bežať cez pôvodný systém
    pricelist_ids = fields.get("pricelist_ids") or []
    row = db_connector.execute_query("SELECT zakaznik_id FROM b2b_zakaznici WHERE id=%s", (cid,), fetch="one")
    if row and row["zakaznik_id"]:
        login = row["zakaznik_id"]
        db_connector.execute_query("DELETE FROM b2b_zakaznik_cennik WHERE zakaznik_id = %s", (login,), fetch="none")
        if pricelist_ids:
            conn2 = db_connector.get_connection()
            cur2 = conn2.cursor()
            try:
                cur2.executemany("INSERT INTO b2b_zakaznik_cennik (zakaznik_id, cennik_id) VALUES (%s, %s)", [(login, int(pid)) for pid in pricelist_ids])
                conn2.commit()
            finally:
                cur2.close()
                conn2.close()

    return {"message": "Zákazník bol úspešne aktualizovaný a trasa uložená."}

def update_customer_route_order(data: dict):
    cid = data.get("zakaznik_id")
    poradie = data.get("poradie")
    
    if not cid or poradie is None:
        return {"error": "Chýba ID zákazníka alebo poradie."}
        
    import db_connector
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE b2b_zakaznici SET trasa_poradie=%s WHERE id=%s", (int(poradie), int(cid)))
        conn.commit()  # TVRDÝ COMMIT
        return {"message": "Poradie bolo úspešne uložené."}
    except Exception as e:
        if conn: conn.rollback()
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected():
            conn.close()

def get_pricelists_and_products():
    _ensure_pricelist_tables()
    pricelists = db_connector.execute_query(
        "SELECT id, nazov_cennika FROM b2b_cenniky ORDER BY nazov_cennika"
    ) or []

    products = []
    try:
        # PRIDANÉ: COALESCE(nakupna_cena, 0) as nakupna_cena
        products = db_connector.execute_query(
            """
            SELECT 
                ean, 
                nazov_vyrobku, 
                COALESCE(dph,0) as dph, 
                COALESCE(mj,'ks') as mj, 
                COALESCE(predajna_kategoria,'Nezaradené') as predajna_kategoria,
                COALESCE(nakupna_cena, 0) as nakupna_cena
            FROM produkty 
            ORDER BY nazov_vyrobku
            """
        ) or []
    except Exception:
        products = []

    # Fallback ak tabuľka produkty zlyhá alebo je prázdna (pre istotu)
    if not products:
        try:
            products = db_connector.execute_query(
                "SELECT ean, nazov_produktu AS nazov_vyrobku, COALESCE(dph,0) dph, COALESCE(mj,'ks') mj, 'Nezaradené' as predajna_kategoria, 0 as nakupna_cena FROM sklad2 ORDER BY nazov_produktu"
            ) or []
        except Exception:
            products = []

    return {"pricelists": pricelists, "products": products}

def create_pricelist(data: dict):
    _ensure_pricelist_tables()
    name = (data or {}).get("nazov_cennika") or (data or {}).get("name")
    items = (data or {}).get("items") or []
    customer_ids = (data or {}).get("customer_ids") or []
    
    if not name:
        return {"error": "Názov cenníka je povinný."}

    # Normalizácia položiek (EAN + Cena + Info)
    normalized: List[Tuple[str, float, str]] = []
    for it in items:
        e_raw = it.get("ean") if "ean" in it else it.get("ean_produktu")
        if e_raw is None: continue
        e = str(e_raw).strip()
        
        c_val = it.get("cena") if "cena" in it else it.get("price")
        c = _to_float(c_val)
        
        # ZMENA: Načítame info
        info = str(it.get("info") or it.get("poznamka") or "").strip()

        if e and c is not None and c >= 0:
            normalized.append((e, c, info))

    # Deduplikácia (posledný vyhráva)
    by_ean = {item[0]: (item[1], item[2]) for item in normalized}
    eans = list(by_ean.keys())

    conn = db_connector.get_connection()
    cur = conn.cursor()
    try:
        # 1. Hlavička cenníka
        cur.execute("INSERT INTO b2b_cenniky (nazov_cennika) VALUES (%s)", (name,))
        pl_id = cur.lastrowid

        # 2. Položky
        batch = []
        skipped = []

        if eans:
            placeholders = ",".join(["%s"] * len(eans))
            rows = db_connector.execute_query(
                f"SELECT ean, nazov_vyrobku FROM produkty WHERE ean IN ({placeholders})",
                tuple(eans),
            ) or []

            exist_set = set()
            name_map = {}
            for r in rows:
                e = str(r["ean"])
                exist_set.add(e)
                name_map[e] = r.get("nazov_vyrobku") or ""

            valid_eans = [e for e in eans if e in exist_set]
            skipped = [e for e in eans if e not in exist_set]

            for e in valid_eans:
                price, info_text = by_ean[e]
                title = name_map.get(e) or f"EAN {e}"
                # ZMENA: Pridávame info do batchu
                batch.append((pl_id, e, title, price, info_text))

            if batch:
                # ZMENA: Insertujeme aj stĺpec info
                cur.executemany(
                    "INSERT INTO b2b_cennik_polozky (cennik_id, ean_produktu, nazov_vyrobku, cena, info) "
                    "VALUES (%s,%s,%s,%s,%s)",
                    batch,
                )

        # 3. Priradenie zákazníkom
        if customer_ids:
            _ensure_mapping_table()
            placeholders_cust = ",".join(["%s"] * len(customer_ids))
            cust_rows = db_connector.execute_query(
                f"SELECT zakaznik_id FROM b2b_zakaznici WHERE id IN ({placeholders_cust})",
                tuple(customer_ids), fetch="all"
            ) or []
            
            map_batch = [(c['zakaznik_id'], pl_id) for c in cust_rows if c.get('zakaznik_id')]
            if map_batch:
                cur.executemany(
                    "INSERT IGNORE INTO b2b_zakaznik_cennik (zakaznik_id, cennik_id) VALUES (%s, %s)",
                    map_batch
                )

        conn.commit()
        result = {"message": "Cenník vytvorený.", "id": pl_id, "count": len(batch)}
        if skipped: result["skipped_eans"] = skipped
        return result

    except Exception as e:
        try: conn.rollback()
        except: pass
        traceback.print_exc()
        return {"error": f"Chyba: {e}"}
    finally:
        try: cur.close(); conn.close()
        except: pass

def get_pricelist_details(data: dict):
    pl_id = (data or {}).get("id")
    if not pl_id:
        return {"error": "Chýba id cenníka."}
    pl = db_connector.execute_query(
        "SELECT id, nazov_cennika FROM b2b_cenniky WHERE id=%s", (pl_id,), fetch="one"
    )
    if not pl:
        return {"error": "Cenník neexistuje."}
    # PRIDANÉ: info do SELECTu
    items = db_connector.execute_query(
        "SELECT ean_produktu, nazov_vyrobku, cena, info FROM b2b_cennik_polozky WHERE cennik_id = %s ORDER BY nazov_vyrobku",
        (pl_id,),
    ) or []
    return {"pricelist": pl, "items": items}

# V súbore b2b_handler.py nájdite funkciu update_pricelist a nahraďte ju týmto:

def update_pricelist(data: dict):
    _ensure_pricelist_tables()

    pl_id = (data or {}).get("id")
    # TUTO JE ZMENA: Načítame aj nový názov
    new_name = (data or {}).get("name") 
    items = (data or {}).get("items") or []
    
    if not pl_id:
        return {"error": "Chýba id cenníka."}

    # 1) normalizácia vstupu: EAN, cena A INFO
    cleaned: List[Tuple[str, float, str]] = []
    for it in items:
        e_raw = it.get("ean") if "ean" in it else it.get("ean_produktu")
        if not e_raw:
            continue
        ean = str(e_raw).strip()
        cena = _to_float(it.get("price") if "price" in it else it.get("cena"))
        info = str(it.get("info") or "").strip()
        
        if not ean or cena is None or cena < 0:
            continue
        cleaned.append((ean, cena, info))

    conn = db_connector.get_connection()
    cur = conn.cursor()
    try:
        # 2) Ak bol poslaný nový názov, aktualizujeme ho
        if new_name:
            cur.execute("UPDATE b2b_cenniky SET nazov_cennika=%s WHERE id=%s", (new_name, pl_id))

        # 3) vymaž existujúce položky
        cur.execute("DELETE FROM b2b_cennik_polozky WHERE cennik_id=%s", (pl_id,))

        if not cleaned:
            conn.commit()
            return {"message": "Cenník aktualizovaný (prázdny).", "count": 0}

        # 4) ukladáme riadok po riadku
        inserted = 0
        for ean, cena, info in cleaned:
            cur.execute(
                "SELECT ean, nazov_vyrobku, dph, mj, predajna_kategoria FROM produkty WHERE ean = %s",
                (ean,),
            )
            row = cur.fetchone()
            if row is None:
                # Ak produkt nenájde, preskočíme ho (aby nepadol celý cenník)
                continue

            prod_ean, nazov_vyrobku, dph, mj, pred_kat = row
            
            try:
                cur.execute(
                    """
                    INSERT INTO b2b_cennik_polozky
                      (cennik_id, ean_produktu, nazov_vyrobku, cena, info)
                    VALUES (%s,%s,%s,%s,%s)
                    """,
                    (pl_id, str(prod_ean), nazov_vyrobku, cena, info),
                )
                inserted += 1
            except Exception:
                pass

        conn.commit()
        return {"message": "Cenník a názov boli aktualizované.", "count": inserted}

    except Exception as e:
        try: conn.rollback() 
        except: pass
        traceback.print_exc()
        return {"error": f"Chyba DB: {e}"}
    finally:
        try: cur.close(); conn.close()
        except: pass

def get_announcement():
    _ensure_system_settings()
    row = db_connector.execute_query(
        "SELECT hodnota FROM system_settings WHERE kluc='b2b_announcement' LIMIT 1",
        fetch="one",
    )
    return {"announcement": (row["hodnota"] if row else "")}

def save_announcement(data: dict):
    text = (data or {}).get("announcement", "")
    _ensure_system_settings()
    exists = db_connector.execute_query(
        "SELECT kluc FROM system_settings WHERE kluc='b2b_announcement' LIMIT 1",
        fetch="one"
    )
    if exists:
        db_connector.execute_query(
            "UPDATE system_settings SET hodnota=%s WHERE kluc='b2b_announcement'",
            (text,), fetch='none'
        )
    else:
        db_connector.execute_query(
            "INSERT INTO system_settings (kluc, hodnota) VALUES ('b2b_announcement', %s)",
            (text,), fetch='none'
        )
    return {"message": "Oznam uložený."}

def _get_pricelist_price_map(login_id: str, eans: List[str]) -> Dict[str, float]:
    try:
        if not login_id or not eans:
            return {}
        _ensure_mapping_table()
        rows = db_connector.execute_query(
            "SELECT cennik_id FROM b2b_zakaznik_cennik WHERE zakaznik_id=%s ORDER BY cennik_id",
            (login_id,)
        ) or []
        if not rows:
            return {}
        # zoberieme prvý priradený cenník
        pl_id = int(rows[0].get("cennik_id") or list(rows[0].values())[0])
        ph = ",".join(["%s"] * len(eans))
        q = f"SELECT ean_produktu, cena FROM b2b_cennik_polozky WHERE cennik_id=%s AND ean_produktu IN ({ph})"
        params = [pl_id] + [str(e) for e in eans]
        items = db_connector.execute_query(q, tuple(params)) or []
        return {str(r["ean_produktu"]): float(r["cena"]) for r in items if r.get("ean_produktu") is not None}
    except Exception:
        traceback.print_exc()
        return {}

def submit_b2b_order(data: dict):
    user_id        = (data or {}).get("userId")          # ID prihláseného (Rodič)
    target_cust_id = (data or {}).get("targetCustomerId") # ID pobočky (Dieťa) - VOLITEĽNÉ
    items_in       = (data or {}).get("items") or []
    note           = (data or {}).get("note")
    delivery_date  = (data or {}).get("deliveryDate")
    customer_email = (data or {}).get("customerEmail")
    cc_emails_raw  = (data or {}).get("ccEmails") or ""  # Extrakcia kópií e-mailov

    if not (user_id and items_in and delivery_date and customer_email):
        return {"error": "Chýbajú povinné údaje (zákazník, položky, dátum dodania, e-mail)."}

    # 1. Identifikácia cieľového zákazníka (na koho sa fakturuje/dodáva)
    final_id = target_cust_id if target_cust_id else user_id

    # 2. Bezpečnostná kontrola vzťahu
    if str(final_id) != str(user_id):
        check = db_connector.execute_query(
            "SELECT id FROM b2b_zakaznici WHERE id=%s AND parent_id=%s LIMIT 1",
            (final_id, user_id),
            fetch="one"
        )
        if not check:
            return {"error": "Neoprávnená objednávka na tento účet (neplatný vzťah)."}

    # 3. Načítanie údajov CIEĽOVÉHO zákazníka
    cust = db_connector.execute_query(
        "SELECT id, zakaznik_id, nazov_firmy, adresa, adresa_dorucenia FROM b2b_zakaznici WHERE id=%s",
        (final_id,), fetch="one",
    )
    if not cust:
        return {"error": "Cieľový zákazník neexistuje."}
    
    login_id = cust["zakaznik_id"] 
    final_address = cust.get("adresa_dorucenia") if cust.get("adresa_dorucenia") else cust.get("adresa")

    # 4. Načítanie produktov z tabuľky 'produkty'
    eans = [str(it.get("ean")) for it in items_in if it.get("ean")]
    pmap: Dict[str, Any] = {}
    if eans:
        ph = ",".join(["%s"] * len(eans))
        rows = db_connector.execute_query(
            f"SELECT ean, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, mj, nazov_vyrobku FROM produkty WHERE ean IN ({ph})",
            tuple(eans)
        ) or []
        pmap = {str(r["ean"]): r for r in rows}

    # 5. Ceny podľa cenníka a spracovanie položiek
    pricelist_price_by_ean = _get_pricelist_price_map(login_id, eans)

    pdf_items: List[Dict[str, Any]] = []
    total_net = 0.0
    total_vat = 0.0

    for it in items_in:
        qty   = _to_float(it.get("quantity"))
        price = _to_float(it.get("price")) 
        pm    = pmap.get(str(it.get("ean"))) or {}
        
        unit = it.get("unit") or pm.get("mj") or "ks"
        dph   = abs(_to_float(pm.get("dph", it.get("dph"))))
        item_note = it.get("note") or it.get("item_note") or ""

        line_net = price * qty
        line_vat = line_net * (dph / 100.0)
        total_net += line_net
        total_vat += line_vat
        
        pdf_items.append({
            "ean": str(it.get("ean")),
            "name": it.get("name") or pm.get("nazov_vyrobku") or "",
            "unit": unit, 
            "quantity": qty,
            "price": price,
            "dph": dph,
            "line_net": line_net,
            "line_vat": line_vat,
            "line_gross": line_net + line_vat,
            "pricelist_price": pricelist_price_by_ean.get(str(it.get("ean"))),
            "item_note": item_note 
        })

    total_gross = total_net + total_vat

    order_payload = {
        "order_number": None, 
        "customerName": cust["nazov_firmy"],
        "customerAddress": final_address,
        "deliveryDate": delivery_date,
        "note": note,
        "items": pdf_items,
        "totalNet": total_net,
        "totalVat": total_vat,
        "totalWithVat": total_gross,
        "customerCode": login_id, 
    }

    # 6. Uloženie do databázy
    order_number = f"B2B-{login_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    conn = db_connector.get_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO b2b_objednavky
              (cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, poznamka, celkova_suma_s_dph)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (order_number, login_id, cust["nazov_firmy"], final_address, _normalize_date_to_str(delivery_date), note, total_gross)
        )
        oid = cur.lastrowid

        lines: List[Tuple[Any, ...]] = []
        for i in pdf_items:
            pm = pmap.get(str(i.get("ean"))) or {}
            lines.append((
                oid,
                i.get("ean"),
                i.get("name"),
                i["quantity"],
                i["unit"], 
                i["dph"],
                pm.get("predajna_kategoria"),
                pm.get("vaha_balenia_g"),
                pm.get("typ_polozky"),
                i["price"],
                _normalize_date_to_str(delivery_date),
            ))
        
        cur.executemany(
            """
            INSERT INTO b2b_objednavky_polozky
              (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, cena_bez_dph, pozadovany_datum_dodania)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            lines
        )
        conn.commit()
    finally:
        try:
            cur.close(); conn.close()
        except: pass

    # 7. Generovanie PDF/CSV a odoslanie e-mailov
    order_payload["order_number"] = order_number
    try:
        pdf_bytes, csv_bytes, csv_filename = pdf_generator.create_order_files(order_payload)

        # Export CSV na disk
        try:
            export_dir = os.getenv("B2B_CSV_EXPORT_DIR", "/var/app/data/b2bobjednavky")
            os.makedirs(export_dir, exist_ok=True)
            file_name = csv_filename or f"objednavka_{order_number}.csv"
            file_path = os.path.join(export_dir, file_name)
            if csv_bytes:
                with open(file_path, "wb") as f:
                    f.write(csv_bytes)
        except Exception:
            traceback.print_exc()
        
        # A) Hlavný e-mail zákazníkovi (Rodič)
        try:
            notification_handler.send_order_confirmation_email(
                to=customer_email, order_number=order_number, pdf_content=pdf_bytes, csv_content=None
            )
        except Exception:
            traceback.print_exc()

        # B) KÓPIE podľa poľa z frontendu
        if cc_emails_raw:
            cc_list = [e.strip() for e in cc_emails_raw.replace(';', ',').split(',') if e.strip()]
            for cc_mail in cc_list:
                if '@' in cc_mail:
                    try:
                        notification_handler.send_order_confirmation_email(
                            to=cc_mail, order_number=order_number, pdf_content=pdf_bytes, csv_content=None
                        )
                    except Exception as e:
                        print(f"Nepodarilo sa odoslať kópiu na {cc_mail}: {e}")
        
        # C) Email expedícii
        try:
            notification_handler.send_order_confirmation_email(
                to=EXPEDITION_EMAIL, 
                order_number=order_number, 
                pdf_content=pdf_bytes, 
                csv_content=csv_bytes,
                csv_filename=csv_filename
            )
        except Exception:
            try:
                notification_handler.send_order_confirmation_email(
                    to=EXPEDITION_EMAIL, order_number=order_number, pdf_content=pdf_bytes, csv_content=csv_bytes
                )
            except: pass

    except Exception:
        traceback.print_exc()

    return {
        "status": "success",
        "message": f"Objednávka {order_number} pre {cust['nazov_firmy']} bola prijatá.",
        "order_data": order_payload,
    }

def create_b2b_branch(data: dict):
    """
    Vytvorí podúčet (pobočku) pre existujúceho zákazníka.
    Používa rovnaký e-mail ako rodič (vyžaduje odstránenie UNIQUE indexu v DB).
    """
    parent_id = data.get("parent_id")
    name      = (data.get("branch_name") or "").strip()
    code      = (data.get("branch_code") or "").strip() # ERP ID
    addr      = (data.get("branch_address") or "").strip()
    del_addr  = data.get("branch_delivery_address")
    
    if not (parent_id and name and code):
        return {"error": "Chýbajú povinné údaje (Rodič, Názov, Kód)."}

    # 1. Načítame rodiča
    parent = db_connector.execute_query("SELECT * FROM b2b_zakaznici WHERE id=%s", (parent_id,), fetch="one")
    if not parent:
        return {"error": "Rodičovský účet neexistuje."}

    # 2. Overíme unikátnosť kódu (loginu) - Login musí byť stále unikátny
    exists = db_connector.execute_query("SELECT id FROM b2b_zakaznici WHERE zakaznik_id=%s", (code,), fetch="one")
    if exists:
        return {"error": f"Zákaznícke číslo {code} už existuje."}

    # 3. Príprava dát - E-mail preberáme priamo od rodiča
    parent_email = parent.get("email") or ""
    
    dummy_salt, dummy_hash = _hash_password(secrets.token_hex(16))

    cols_in_db = _existing_columns("b2b_zakaznici")
    cols = []
    vals = []

    def add(col, val):
        if col in cols_in_db:
            cols.append(col)
            vals.append(val)

    add("zakaznik_id", code)
    add("nazov_firmy", name)
    add("email", parent_email) # <--- POUŽIJEME ORIGINÁL EMAIL RODIČA
    add("telefon", parent.get("telefon") or "")
    add("adresa", parent.get("adresa") or "")
    add("adresa_dorucenia", addr if addr else (del_addr or ""))
    add("parent_id", parent_id)
    add("typ", "B2B")
    add("je_schvaleny", 1)
    
    # Bezpečné vloženie hesla
    add("password_hash_hex", dummy_hash)
    add("password_salt_hex", dummy_salt)
    add("heslo_hash", dummy_hash)
    add("heslo_salt", dummy_salt)

    if not cols:
        return {"error": "Nepodarilo sa detegovať stĺpce tabuľky."}

    placeholders = ",".join(["%s"] * len(cols))
    sql = f"INSERT INTO b2b_zakaznici ({', '.join(cols)}) VALUES ({placeholders})"
    
    conn = db_connector.get_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, tuple(vals))
        
        # 4. Automatické kopírovanie cenníkov
        parent_pls = db_connector.execute_query(
            "SELECT cennik_id FROM b2b_zakaznik_cennik WHERE zakaznik_id=%s", 
            (parent["zakaznik_id"],), 
            fetch="all"
        )
        if parent_pls:
            map_data = [(code, pl["cennik_id"]) for pl in parent_pls]
            cur.executemany(
                "INSERT INTO b2b_zakaznik_cennik (zakaznik_id, cennik_id) VALUES (%s, %s)",
                map_data
            )
        
        conn.commit()
        return {"message": f"Pobočka '{name}' vytvorená."}
    except Exception as e:
        conn.rollback()
        traceback.print_exc()
        return {"error": f"Chyba DB: {str(e)}"}
    finally:
        try:
            cur.close(); conn.close()
        except: pass
        
def get_all_b2b_orders(filters=None):
    filters = filters or {}
    where: List[str] = []
    params: List[Any] = []
    
    # Rozhodnutie, podľa ktorého stĺpca sa filtruje
    date_col = "datum_objednavky" # Default: Dátum prijatia/vytvorenia
    if filters.get("date_type") == "delivery":
        date_col = "pozadovany_datum_dodania" # Novinka: Dátum dodania

    if filters.get("from_date"):
        where.append(f"{date_col} >= %s")
        params.append(filters["from_date"])
    if filters.get("to_date"):
        where.append(f"{date_col} < %s")
        params.append(filters["to_date"])
    if filters.get("customer"):
        where.append("zakaznik_id=%s")
        params.append(filters["customer"])
        
    q = "SELECT id, cislo_objednavky, zakaznik_id, nazov_firmy, datum_objednavky, pozadovany_datum_dodania, stav, celkova_suma_s_dph FROM b2b_objednavky"
    if where:
        q += " WHERE " + " AND ".join(where)
        
    # Ak filtrujeme podľa dodania, zotriedime to od najbližších dodaní. Inak radíme od najnovšie prijatých.
    if filters.get("date_type") == "delivery":
        q += " ORDER BY pozadovany_datum_dodania ASC, datum_objednavky DESC"
    else:
        q += " ORDER BY datum_objednavky DESC"
        
    rows = db_connector.execute_query(q, tuple(params) if params else None) or []
    return {"orders": rows}
def get_b2b_order_details(data_or_id):
    if isinstance(data_or_id, dict):
        oid = data_or_id.get("id")
    else:
        oid = data_or_id
    if not oid:
        return {"error": "Chýba id objednávky."}
    head = db_connector.execute_query("SELECT * FROM b2b_objednavky WHERE id = %s", (oid,), fetch="one")
    if not head:
        return {"error": "Objednávka neexistuje."}
    items = db_connector.execute_query(
        "SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s ORDER BY id",
        (oid,),
    ) or []
    return {"order": head, "items": items}

# ───────────────── PDF payloady ─────────────────
def build_order_pdf_for_customer(order_id: int, user_id: int):
    if not order_id or not user_id:
        return {"error": "Chýba objednávka alebo používateľ.", "code": 400}

    head = db_connector.execute_query(
        "SELECT id, cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, datum_objednavky, celkova_suma_s_dph "
        "FROM b2b_objednavky WHERE id=%s", (order_id,), fetch='one'
    )
    if not head:
        return {"error": "Objednávka neexistuje.", "code": 404}

    user_row = db_connector.execute_query(
        "SELECT zakaznik_id FROM b2b_zakaznici WHERE id=%s", (user_id,), fetch='one'
    )
    if not user_row:
        return {"error": "Používateľ neexistuje.", "code": 404}
    if str(head['zakaznik_id']) != str(user_row['zakaznik_id']):
        return {"error": "Nedovolený prístup k objednávke.", "code": 403}

    items = db_connector.execute_query(
        "SELECT ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, cena_bez_dph "
        "FROM b2b_objednavky_polozky WHERE objednavka_id=%s ORDER BY id", (order_id,)
    ) or []

    mapped: List[Dict[str, Any]] = []
    total_net = 0.0
    total_vat = 0.0
    for it in items:
        qty   = _to_float(it.get("mnozstvo"))
        price = _to_float(it.get("cena_bez_dph"))
        dph   = abs(_to_float(it.get("dph")))
        line_net = price * qty
        line_vat = line_net * (dph / 100.0)
        total_net += line_net
        total_vat += line_vat
        mapped.append({
            "ean": it.get("ean_produktu"),
            "name": it.get("nazov_vyrobku"),
            "quantity": qty,
            "unit": it.get("mj") or "ks",
            "price": price,
            "dph": dph,
            "vatPercent": dph,
            "line_net": line_net, "line_vat": line_vat, "line_gross": line_net + line_vat,
            "lineNet": line_net,  "lineVAT": line_vat,  "lineGross": line_net + line_vat,
            "net": line_net, "vat_amount": line_vat, "gross": line_net + line_vat,
        })

    delivery_norm = _normalize_date_to_str(head.get("pozadovany_datum_dodania"))
    total_gross = total_net + total_vat

    data = {
        "order_number": head["cislo_objednavky"],
        "customer_name": head["nazov_firmy"],
        "customer_address": head["adresa"],
        "delivery_date": delivery_norm,
        "note": "",
        "items": mapped,
        "total_net": total_net,
        "total_vat": total_vat,
        "total_with_vat": total_gross,
        # aliasy pre pdf_generator
        "orderNumber": head["cislo_objednavky"],
        "customerName": head["nazov_firmy"],
        "customerAddress": head["adresa"],
        "deliveryDate": delivery_norm,
        "totalNet": total_net,
        "totalVat": total_vat,
        "totalWithVat": total_gross,
        "sum_dph": total_vat,
        "sum_vat": total_vat,
        "totalVatAmount": total_vat,
        "totalNetAmount": total_net,
        "totalGross": total_gross,
        "totalGrossWithVat": total_gross,
    }

    # === OPRAVA TU: 3 premenné, ignorujeme CSV (pretože zákazník sťahuje len PDF) ===
    pdf_bytes, _, _ = pdf_generator.create_order_files(data)
    
    return {"pdf": pdf_bytes, "filename": f"objednavka_{head['cislo_objednavky']}.pdf"}

def build_order_pdf_payload_admin(order_id: int) -> dict:
    """
    Admin payload pre pdf_generator.create_order_files() – bez kontroly vlastníka.
    DPH sa berie z 'produkty', súhrny sú spočítané, posielajú sa aj aliasy.
    """
    if not order_id:
        return {"error": "Chýba id objednávky."}

    head = db_connector.execute_query(
        "SELECT id, cislo_objednavky, zakaznik_id, nazov_firmy, adresa, "
        "       pozadovany_datum_dodania, datum_objednavky, celkova_suma_s_dph, poznamka "
        "FROM b2b_objednavky WHERE id=%s",
        (order_id,), fetch="one"
    )
    if not head:
        return {"error": "Objednávka neexistuje."}

    rows = db_connector.execute_query(
        "SELECT ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, cena_bez_dph "
        "FROM b2b_objednavky_polozky WHERE objednavka_id=%s ORDER BY id",
        (order_id,)
    ) or []

    eans = [r["ean_produktu"] for r in rows if r.get("ean_produktu")]
    pmap = {}
    if eans:
        ph = ",".join(["%s"] * len(eans))
        prod_rows = db_connector.execute_query(
            f"SELECT ean, dph, nazov_vyrobku, mj FROM produkty WHERE ean IN ({ph})",
            tuple(eans)
        ) or []
        pmap = {pr["ean"]: pr for pr in prod_rows}

    items: List[Dict[str, Any]] = []
    total_net = 0.0
    total_vat = 0.0
    for r in rows:
        qty   = _to_float(r.get("mnozstvo"))
        price = _to_float(r.get("cena_bez_dph"))
        pm    = pmap.get(r.get("ean_produktu")) or {}
        dph   = abs(_to_float(pm.get("dph", r.get("dph"))))
        line_net = price * qty
        line_vat = line_net * (dph / 100.0)
        total_net += line_net
        total_vat += line_vat
        items.append({
            "ean": r.get("ean_produktu"),
            "name": r.get("nazov_vyrobku") or pm.get("nazov_vyrobku") or "",
            "quantity": qty,
            "unit": r.get("mj") or pm.get("mj") or "ks",
            "price": price,
            "dph": dph,
            "vatPercent": dph,
            "line_net": line_net, "line_vat": line_vat, "line_gross": line_net + line_vat,
            "lineNet": line_net,  "lineVAT": line_vat,  "lineGross": line_net + line_vat,
            "net": line_net, "vat_amount": line_vat, "gross": line_net + line_vat,
        })

    delivery = head.get("pozadovany_datum_dodania")
    if isinstance(delivery, (datetime, date)):
        delivery = delivery.strftime("%Y-%m-%d")
    elif delivery is None:
        delivery = ""

    total_gross = total_net + total_vat

    payload = {
        "order_number": head["cislo_objednavky"],
        "customer_name": head["nazov_firmy"],
        "customer_address": head["adresa"],
        "delivery_date": delivery,
        "note": head.get("poznamka") or "",
        "items": items,

        "total_net": total_net,
        "total_vat": total_vat,
        "total_with_vat": total_gross,

        # aliasy
        "orderNumber": head["cislo_objednavky"],
        "customerName": head["nazov_firmy"],
        "customerAddress": head["adresa"],
        "deliveryDate": delivery,
        "totalNet": total_net,
        "totalVat": total_vat,
        "totalWithVat": total_gross,
        "sum_dph": total_vat,
        "sum_vat": total_vat,
        "totalVatAmount": total_vat,
        "totalNetAmount": total_net,
        "totalGross": total_gross,
        "totalGrossWithVat": total_gross,
    }
    return payload

# ───────────────── Komunikácia ─────────────────
def _comm_inbox_email():
    return os.getenv('B2B_COMM_EMAIL') or os.getenv('ADMIN_NOTIFY_EMAIL') or os.getenv('MAIL_DEFAULT_SENDER') or os.getenv('MAIL_USERNAME')

def _safe_name(name: str) -> str:
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
    return "".join(ch if ch in keep else "_" for ch in (name or ""))[:180] or "priloha"
def portal_message_attachment(data: dict):
    """
    Vráti prílohu správy pre prihláseného zákazníka ako base64 + meta,
    aby ju FE vedel stiahnuť / otvoriť.
    """
    _ensure_comm_table()
    mid = (data or {}).get("id")
    user_id = (data or {}).get("userId")

    if not mid or not user_id:
        return {"error": "Chýba id správy alebo používateľ."}

    msg = db_connector.execute_query(
        "SELECT customer_id, attachment_path, attachment_filename, attachment_mime "
        "FROM b2b_messages WHERE id=%s",
        (mid,),
        fetch="one",
    )
    if not msg:
        return {"error": "Správa neexistuje."}

    # zákazník môže otvoriť len svoje správy
    try:
        if int(msg.get("customer_id") or 0) != int(user_id):
            return {"error": "Nemáte prístup k tejto prílohe."}
    except Exception:
        return {"error": "Nemáte prístup k tejto prílohe."}

    path = msg.get("attachment_path")
    if not path or not os.path.isfile(path):
        return {"error": "Príloha sa nenašla."}

    try:
        with open(path, "rb") as fh:
            raw = fh.read()
    except Exception:
        traceback.print_exc()
        return {"error": "Prílohu sa nepodarilo načítať."}

    import base64
    content_b64 = base64.b64encode(raw).decode("ascii")

    return {
        "filename": msg.get("attachment_filename") or "priloha",
        "mime": msg.get("attachment_mime") or "application/octet-stream",
        "content_base64": content_b64,
    }

def portal_message_send(req):
    _ensure_comm_table()
    user_id = req.form.get('userId', type=int)
    subject = (req.form.get('subject') or '').strip()
    body    = (req.form.get('body') or '').strip()
    if not (user_id and subject and body):
        return {"error":"Chýbajú povinné polia."}

    cust = db_connector.execute_query("SELECT id, zakaznik_id, nazov_firmy, email FROM b2b_zakaznici WHERE id=%s",(user_id,),fetch="one")
    if not cust:
        return {"error":"Zákazník neexistuje."}
    login = cust['zakaznik_id']
    cname = cust['nazov_firmy']
    cemail = cust['email']

    # uloženie prílohy
    file = req.files.get('file')
    a_path = a_name = a_mime = None
    a_size = None
    if file and file.filename:
        base_dir = os.path.join(os.getcwd(), 'storage', 'b2b_comm', datetime.now().strftime('%Y/%m'))
        os.makedirs(base_dir, exist_ok=True)
        a_name = _safe_name(file.filename)
        a_path = os.path.join(base_dir, f"{int(time.time())}_{a_name}")
        a_mime = file.mimetype or 'application/octet-stream'
        file.save(a_path)
        try:
            a_size = os.path.getsize(a_path)
        except Exception:
            a_size = None

    # DB záznam
    db_connector.execute_query(
        "INSERT INTO b2b_messages (customer_id, zakaznik_login, customer_name, customer_email, subject, body, direction, status, attachment_path, attachment_filename, attachment_mime, attachment_size) "
        "VALUES (%s,%s,%s,%s,%s,%s,'in','new',%s,%s,%s,%s)",
        (user_id, login, cname, cemail, subject, body, a_path, a_name, a_mime, a_size),
        fetch="none"
    )

    # email adminovi
    try:
        to_admin = _comm_inbox_email()
        if to_admin:
            html = f"<p><strong>B2B správa od:</strong> {cname} ({login}) &lt;{cemail}&gt;</p><p><strong>Predmet:</strong> {subject}</p><p><pre style='white-space:pre-wrap'>{body}</pre></p>"
            attachments = []
            if a_path and os.path.isfile(a_path):
                with open(a_path,'rb') as fh:
                    attachments.append((a_name, fh.read(), a_mime or 'application/octet-stream'))
            notification_handler._send_email(to_admin, f"B2B správa – {cname} ({login})", notification_handler._wrap_html("B2B správa", html), attachments)
    except Exception:
        traceback.print_exc()

    return {"message":"Správa bola odoslaná."}

def portal_my_messages(user_id: int, page:int=1, page_size:int=50):
    _ensure_comm_table()
    off = max(0, (int(page or 1)-1)*max(1,int(page_size or 50)))
    rows = db_connector.execute_query(
        "SELECT id, created_at, subject, body, direction, status, attachment_filename FROM b2b_messages WHERE customer_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (user_id, max(1,int(page_size or 50)), off)
    ) or []
    return {"messages": rows}

def admin_messages_list(args):
    _ensure_comm_table()
    where=[]; params=[]
    status = args.get('status')
    customer_id = args.get('customer_id', type=int)
    q = args.get('q')
    if status and status.lower()!='all':
        where.append("status=%s"); params.append(status.lower())
    if customer_id:
        where.append("customer_id=%s"); params.append(customer_id)
    if q:
        where.append("(subject LIKE %s OR body LIKE %s OR customer_name LIKE %s OR zakaznik_login LIKE %s)")
        like = f"%{q}%"; params += [like,like,like,like]
    sql = "SELECT id, created_at, customer_id, zakaznik_login, customer_name, customer_email, subject, LEFT(body,1000) body, direction, status, attachment_filename FROM b2b_messages"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY status='new' DESC, created_at DESC LIMIT 200"
    rows = db_connector.execute_query(sql, tuple(params) if params else None) or []
    return {"messages": rows}

def admin_messages_unread_count():
    _ensure_comm_table()
    row = db_connector.execute_query("SELECT COUNT(*) AS c FROM b2b_messages WHERE status='new'", fetch="one") or {"c":0}
    return {"unread": int(row["c"] or 0)}

def admin_messages_mark_read(data: dict):
    _ensure_comm_table()
    mid = (data or {}).get("id")
    if not mid:
        return {"error":"Chýba id správy."}
    db_connector.execute_query("UPDATE b2b_messages SET status='read' WHERE id=%s",(mid,),fetch="none")
    return {"message":"Označené ako prečítané."}

def admin_messages_reply(req):
    _ensure_comm_table()
    mid = req.form.get('id', type=int)
    body = (req.form.get('body') or '').strip()
    subject = (req.form.get('subject') or '').strip()
    if not (mid and body):
        return {"error":"Chýbajú povinné polia."}
    orig = db_connector.execute_query("SELECT * FROM b2b_messages WHERE id=%s",(mid,),fetch="one")
    if not orig:
        return {"error":"Pôvodná správa neexistuje."}
    to = orig["customer_email"]
    cname = orig["customer_name"]
    login = orig["zakaznik_login"]

    # príloha
    file = req.files.get('file')
    a_path=a_name=a_mime=None
    a_size=None
    if file and file.filename:
        base_dir = os.path.join(os.getcwd(), 'storage', 'b2b_comm', datetime.now().strftime('%Y/%m'))
        os.makedirs(base_dir, exist_ok=True)
        a_name = _safe_name(file.filename)
        a_path = os.path.join(base_dir, f"{int(time.time())}_{a_name}")
        a_mime = file.mimetype or 'application/octet-stream'
        file.save(a_path)
        try:
            a_size=os.path.getsize(a_path)
        except Exception:
            a_size=None

    # uložiť outbound
    db_connector.execute_query(
        "INSERT INTO b2b_messages (customer_id, zakaznik_login, customer_name, customer_email, subject, body, direction, status, attachment_path, attachment_filename, attachment_mime, attachment_size, parent_id) "
        "VALUES (%s,%s,%s,%s,%s,%s,'out','read',%s,%s,%s,%s,%s)",
        (orig["customer_id"], login, cname, to, subject or (f"Re: {orig.get('subject') or ''}"), body, a_path, a_name, a_mime, a_size, mid),
        fetch="none"
    )

    # e-mail zákazníkovi
    try:
        html = f"<p>Dobrý deň,</p><p>{body.replace(chr(10),'<br/>')}</p><hr/><p style='color:#666'>Re: {orig.get('subject') or ''}</p>"
        attachments = []
        if a_path and os.path.isfile(a_path):
            with open(a_path,'rb') as fh:
                attachments.append((a_name, fh.read(), a_mime or 'application/octet-stream'))
        notification_handler._send_email(to, subject or f"Re: {orig.get('subject') or ''}", notification_handler._wrap_html("Správa od MIK s.r.o.", html), attachments)
    except Exception:
        traceback.print_exc()

    return {"message":"Odpoveď odoslaná."}
def get_daily_items_summary(data: dict):
    """
    Vráti zoznam všetkých produktov objednaných na konkrétny deň dodania.
    Zgrupuje B2B objednávky podľa EAN/Názvu.
    """
    target_date = data.get('date')
    if not target_date:
        return {"error": "Chýba dátum."}

    # SQL: Vyberieme položky z B2B objednávok, ktoré nie sú zrušené
    # a majú požadovaný dátum dodania.
    sql = """
        SELECT 
            p.nazov_vyrobku, 
            p.ean_produktu, 
            p.mj, 
            SUM(p.mnozstvo) as total_qty
        FROM b2b_objednavky_polozky p
        JOIN b2b_objednavky o ON o.id = p.objednavka_id
        WHERE o.pozadovany_datum_dodania = %s
          AND o.stav != 'Zrušená'
        GROUP BY p.ean_produktu, p.nazov_vyrobku, p.mj
        ORDER BY p.nazov_vyrobku
    """
    
    rows = db_connector.execute_query(sql, (target_date,), fetch='all') or []
    
    # Prevedieme decimal na float pre JSON
    results = []
    for r in rows:
        results.append({
            "name": r['nazov_vyrobku'],
            "ean": r['ean_produktu'],
            "qty": float(r['total_qty'] or 0),
            "unit": r['mj']
        })
        
    return {"items": results, "date": target_date}
# b2b_handler.py

def _ensure_route_templates_table():
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS b2b_route_templates (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            customer_ids JSON NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')

def get_route_templates():
    _ensure_route_templates_table()
    return db_connector.execute_query("SELECT * FROM b2b_route_templates ORDER BY name", fetch='all') or []

def save_route_template(data: dict):
    _ensure_route_templates_table()
    name = (data.get('name') or '').strip()
    ids = data.get('ids') or []
    
    if not name or not ids:
        return {"error": "Chýba názov alebo vybraní zákazníci."}
        
    # Uložíme zoznam ID ako JSON string
    import json
    ids_json = json.dumps(ids)
    
    db_connector.execute_query(
        "INSERT INTO b2b_route_templates (name, customer_ids) VALUES (%s, %s)",
        (name, ids_json), fetch='none'
    )
    return {"message": "Šablóna trasy uložená."}

def delete_route_template(data: dict):
    tid = data.get('id')
    if not tid: return {"error": "Chýba ID."}
    db_connector.execute_query("DELETE FROM b2b_route_templates WHERE id=%s", (tid,), fetch='none')
    return {"message": "Šablóna zmazaná."}

# b2b_handler.py

def delete_pricelist(data: dict):
    pl_id = data.get('id')
    if not pl_id:
        return {"error": "Chýba ID cenníka."}
    
    # Vďaka ON DELETE CASCADE sa zmažú aj položky a väzby na zákazníkov
    db_connector.execute_query(
        "DELETE FROM b2b_cenniky WHERE id=%s", 
        (pl_id,), 
        fetch='none'
    )
    return {"message": "Cenník bol úspešne vymazaný."}


def get_order_history(user_id):
    """Vráti históriu objednávok pre daného zákazníka."""
    login = _login_from_user_id(user_id) or user_id
    rows = db_connector.execute_query(
        """
        SELECT id, cislo_objednavky, datum_objednavky AS datum_vytvorenia, stav, celkova_suma_s_dph, poznamka
        FROM b2b_objednavky
        WHERE zakaznik_id=%s
        ORDER BY datum_objednavky DESC
        """,
        (login,),
    ) or []
    return {"orders": rows}

def delete_b2b_customer(data: dict):
    cid = data.get("id")
    if not cid:
        return {"error": "Chýba ID zákazníka."}
    
    # 1. Získame LOGIN (zakaznik_id), lebo objednávky sú viazané na string, nie na ID
    cust = db_connector.execute_query(
        "SELECT id, zakaznik_id, nazov_firmy FROM b2b_zakaznici WHERE id=%s", 
        (cid,), fetch="one"
    )
    
    if not cust:
        return {"error": "Zákazník už neexistuje."}
        
    login = cust["zakaznik_id"]
    
    print(f"--- ZAČÍNAM MAZANIE TESTOVACIEHO PROFILU: {login} (ID: {cid}) ---")

    try:
        # A) Zmažeme položky v KOŠÍKU (ak nejaké zostali visieť)
        db_connector.execute_query(
            "DELETE FROM b2b_kosik WHERE zakaznik_id=%s", 
            (login,), fetch="none"
        )

        # B) Zmažeme POLOŽKY OBJEDNÁVOK (Najprv deti, potom rodičov!)
        # Musíme nájsť ID objednávok tohto zákazníka a zmazať ich položky
        db_connector.execute_query(
            """
            DELETE FROM b2b_objednavky_polozky 
            WHERE objednavka_id IN (
                SELECT id FROM b2b_objednavky WHERE zakaznik_id = %s
            )
            """, 
            (login,), fetch="none"
        )

        # C) Teraz môžeme zmazať samotné OBJEDNÁVKY
        db_connector.execute_query(
            "DELETE FROM b2b_objednavky WHERE zakaznik_id=%s", 
            (login,), fetch="none"
        )

        # D) Zmažeme väzby na CENNÍKY
        db_connector.execute_query(
            "DELETE FROM b2b_zakaznik_cennik WHERE zakaznik_id=%s", 
            (login,), fetch="none"
        )
        
        # E) Zmažeme SPRÁVY
        db_connector.execute_query(
            "DELETE FROM b2b_messages WHERE customer_id=%s", 
            (cid,), fetch="none"
        )

        # F) Konečne zmažeme ZÁKAZNÍKA
        db_connector.execute_query(
            "DELETE FROM b2b_zakaznici WHERE id=%s", 
            (cid,), fetch="none"
        )

        # 2. OVERENIE (pre istotu)
        check = db_connector.execute_query(
            "SELECT id FROM b2b_zakaznici WHERE id=%s", (cid,), fetch="one"
        )
        
        if check:
            return {"error": "Databáza stále odmieta zmazať záznam. Pravdepodobne existuje ešte iná tabuľka s väzbou, o ktorej nevieme."}

        return {"message": f"Testovací profil '{cust['nazov_firmy']}' a všetky jeho dáta boli kompletne odstránené."}

    except Exception as e:
        traceback.print_exc()
        return {"error": f"Chyba pri mazaní: {str(e)}"}

def get_customer_360_view(data: dict):
    cid = data.get("id")
    if not cid:
        return {"error": "Chýba ID zákazníka."}

    # 1. Získame základné údaje o zákazníkovi
    cust = db_connector.execute_query(
        "SELECT id, zakaznik_id, nazov_firmy, email, telefon FROM b2b_zakaznici WHERE id=%s", 
        (cid,), fetch="one"
    )
    if not cust:
        return {"error": "Zákazník neexistuje."}

    login = cust["zakaznik_id"]

    # 2. Celkové štatistiky (vynecháme zrušené objednávky)
    stats_sql = """
        SELECT 
            COUNT(DISTINCT o.id) as total_orders,
            COALESCE(SUM(op.mnozstvo * op.cena_bez_dph), 0) as total_revenue
        FROM b2b_objednavky o
        JOIN b2b_objednavky_polozky op ON o.id = op.objednavka_id
        WHERE o.zakaznik_id = %s AND o.stav NOT IN ('Zrušená', 'Zrusena', 'Stornovaná')
    """
    stats = db_connector.execute_query(stats_sql, (login,), fetch="one") or {}
    
    # 3. Detailná agregácia nákupov po produktoch
    products_sql = """
        SELECT 
            op.ean_produktu as ean,
            op.nazov_vyrobku as name,
            op.mj as unit,
            SUM(op.mnozstvo) as total_qty,
            COALESCE(SUM(op.mnozstvo * op.cena_bez_dph), 0) as revenue,
            MAX(COALESCE(p.nakupna_cena, 0)) as current_unit_cost
        FROM b2b_objednavky o
        JOIN b2b_objednavky_polozky op ON o.id = op.objednavka_id
        LEFT JOIN produkty p ON p.ean = op.ean_produktu
        WHERE o.zakaznik_id = %s AND o.stav NOT IN ('Zrušená', 'Zrusena', 'Stornovaná')
        GROUP BY op.ean_produktu, op.nazov_vyrobku, op.mj
        ORDER BY total_qty DESC
    """
    products = db_connector.execute_query(products_sql, (login,), fetch="all") or []

    # 4. Prepočty pre každý produkt a celkový zisk
    prod_list = []
    total_cost = 0.0

    for r in products:
        qty = float(r["total_qty"] or 0)
        rev = float(r["revenue"] or 0)
        unit_cost = float(r["current_unit_cost"] or 0)
        
        # Nákladová cena pre toto nakúpené množstvo
        cost = qty * unit_cost
        total_cost += cost
        
        avg_price = (rev / qty) if qty > 0 else 0
        prof = rev - cost
        marg = (prof / rev * 100) if rev > 0 else 0
        
        prod_list.append({
            "ean": r["ean"] or "",
            "name": r["name"] or "Neznámy produkt",
            "unit": r["unit"] or "ks",
            "qty": round(qty, 2),
            "avg_price": round(avg_price, 4),
            "unit_cost": round(unit_cost, 4),
            "revenue": round(rev, 2),
            "profit": round(prof, 2),
            "margin": round(marg, 1)
        })

    # Dopočítanie celkového zisku
    total_rev = float(stats.get("total_revenue") or 0.0)
    total_profit = total_rev - total_cost
    total_margin = (total_profit / total_rev * 100) if total_rev > 0 else 0

    return {
        "customer": cust,
        "summary": {
            "total_orders": stats.get("total_orders", 0),
            "total_revenue": round(total_rev, 2),
            "total_profit": round(total_profit, 2),
            "margin_pct": round(total_margin, 1)
        },
        "products": prod_list
    }

def get_logistics_routes_data(target_date: str):
    if not target_date:
        return {"error": "Chýba parameter dátumu."}

    try:
        import db_connector
        trasy_db = db_connector.execute_query("SELECT id, nazov FROM logistika_trasy WHERE is_active=1 ORDER BY nazov", fetch='all') or []
        trasy_map = {str(t['id']): t['nazov'] for t in trasy_db}
        trasy_map['unassigned'] = 'Zatiaľ nepriradená trasa (Zákazníci bez trasy)'

        # DOKONALÝ JOIN: Spájame tvoje odberné číslo v objednávke s tvojím odberným číslom v zákazníkoch
        sql = """
        SELECT 
            o.cislo_objednavky,
            o.nazov_firmy AS odberatel,
            o.adresa,
            z.id AS db_id,
            o.zakaznik_id AS erp_id,
            COALESCE(z.trasa_id, 'unassigned') AS trasa_id,
            COALESCE(z.trasa_poradie, 999) AS poradie,
            pol.nazov_vyrobku AS produkt,
            pol.mnozstvo,
            pol.mj,
            p.predajna_kategoria
        FROM b2b_objednavky o
        JOIN b2b_objednavky_polozky pol ON o.id = pol.objednavka_id
        LEFT JOIN b2b_zakaznici z ON TRIM(CAST(z.zakaznik_id AS CHAR)) = TRIM(CAST(o.zakaznik_id AS CHAR))
        LEFT JOIN produkty p ON (
             (p.ean IS NOT NULL AND pol.ean_produktu IS NOT NULL AND p.ean = pol.ean_produktu)
          OR (p.nazov_vyrobku = pol.nazov_vyrobku)
        )
        WHERE o.stav NOT IN ('Hotová', 'Zrušená', 'Expedovaná')
          AND DATE(o.pozadovany_datum_dodania) = %s
        """
        
        polozky = db_connector.execute_query(sql, (target_date,), fetch='all') or []

        routes_data = {}

        for p in polozky:
            tid = str(p['trasa_id'])
            
            # db_id použijeme na to, aby sme z Logistiky vedeli správne uložiť zmenu poradia naspäť do DB
            db_id = str(p['db_id']) if p['db_id'] is not None else '0'
            
            odberatel = p['odberatel']
            adresa = p['adresa']
            obj_cislo = p['cislo_objednavky']
            kategoria = str(p['predajna_kategoria'] or 'Nezaradené').strip()
            produkt = p['produkt']
            mnozstvo = float(p['mnozstvo'] or 0)
            mj = p['mj']

            if tid not in routes_data:
                routes_data[tid] = { "id": tid, "nazov": trasy_map.get(tid, 'Neznáma trasa'), "zastavky": {}, "sumar": {} }

            if odberatel not in routes_data[tid]["zastavky"]:
                routes_data[tid]["zastavky"][odberatel] = {
                    "zakaznik_id": db_id, 
                    "odberatel": odberatel, 
                    "adresa": adresa,
                    "poradie": p['poradie'], 
                    "objednavky_set": set()
                }
            routes_data[tid]["zastavky"][odberatel]["objednavky_set"].add(obj_cislo)

            if kategoria not in routes_data[tid]["sumar"]:
                routes_data[tid]["sumar"][kategoria] = {}
            
            prod_key = f"{produkt}|{mj}"
            if prod_key not in routes_data[tid]["sumar"][kategoria]:
                routes_data[tid]["sumar"][kategoria][prod_key] = { "produkt": produkt, "mnozstvo": 0, "mj": mj }
            routes_data[tid]["sumar"][kategoria][prod_key]["mnozstvo"] += mnozstvo

        final_routes = []
        for tid, data in routes_data.items():
            zastavky_list = []
            for odb, zdata in data["zastavky"].items():
                obj_list = list(zdata["objednavky_set"])
                zastavky_list.append({
                    "zakaznik_id": zdata["zakaznik_id"], 
                    "odberatel": odb, 
                    "adresa": zdata["adresa"],
                    "poradie": zdata["poradie"], 
                    "pocet_objednavok": len(obj_list), 
                    "cisla_objednavok": obj_list
                })
            zastavky_list.sort(key=lambda x: x["poradie"])

            sumar_list = []
            for kat, produkty in data["sumar"].items():
                prod_list = list(produkty.values())
                prod_list.sort(key=lambda x: x["produkt"])
                sumar_list.append({ "kategoria": kat, "polozky": prod_list })
            sumar_list.sort(key=lambda x: x["kategoria"])

            final_routes.append({ "trasa_id": tid, "nazov": data["nazov"], "zastavky": zastavky_list, "sumar": sumar_list })

        final_routes.sort(key=lambda x: x["nazov"])
        
        vehicles = db_connector.execute_query("SELECT id, license_plate, name FROM fleet_vehicles WHERE is_active=1 ORDER BY name", fetch='all') or []
        return {"trasy": final_routes, "vehicles": vehicles}
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}
    
def get_routes_list():
    try:
        from db_connector import execute_query
        rows = execute_query("SELECT id, nazov, poznamka FROM logistika_trasy WHERE is_active=1 ORDER BY id", fetch='all') or []
        return {"routes": rows}
    except Exception as e:
        return {"error": str(e)}

def create_route(data: dict):
    nazov = (data.get("nazov") or "").strip()
    poznamka = (data.get("poznamka") or "").strip()
    if not nazov:
        return {"error": "Názov trasy je povinný."}
    
    try:
        from db_connector import execute_query
        execute_query(
            "INSERT INTO logistika_trasy (nazov, poznamka, is_active) VALUES (%s, %s, 1)", 
            (nazov, poznamka), fetch='none'
        )
        return {"message": f"Trasa '{nazov}' bola úspešne vytvorená."}
    except Exception as e:
        return {"error": str(e)}

def delete_route(data: dict):
    rid = data.get("id")
    if not rid:
        return {"error": "Chýba ID trasy."}
    try:
        from db_connector import execute_query
        # Trasu iba "deaktivujeme" aby sme nerozbili historické dáta u zákazníkov
        execute_query("UPDATE logistika_trasy SET is_active=0 WHERE id=%s", (rid,), fetch='none')
        return {"message": "Trasa bola vymazaná."}
    except Exception as e:
        return {"error": str(e)}

def assign_vehicle_to_route_and_fleet(data: dict):
    date_str = data.get("date")
    route_name = data.get("route_name")
    vehicle_id = data.get("vehicle_id")

    if not all([date_str, route_name, vehicle_id]):
        return {"error": "Chýbajú údaje (dátum, trasa, auto)."}

    import db_connector
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        
        # 1. Zistíme defaultného šoféra a počiatočné km auta
        cur.execute("SELECT default_driver, name, initial_odometer FROM fleet_vehicles WHERE id=%s", (vehicle_id,))
        veh = cur.fetchone()
        if not veh:
            return {"error": "Vozidlo neexistuje."}
        driver = veh.get("default_driver") or ""
        initial_km = veh.get("initial_odometer") or 0

        # 2. Skontrolujeme duplicity
        cur.execute(
            "SELECT id FROM fleet_logs WHERE vehicle_id=%s AND log_date=%s AND location_end=%s",
            (vehicle_id, date_str, route_name)
        )
        if cur.fetchone():
            return {"message": "Toto auto už má na tento deň a trasu vytvorený záznam v module Fleet."}

        # 3. Zistíme POSLEDNÝ stav tachometra (koniec km minulej jazdy)
        cur.execute("""
            SELECT end_odometer 
            FROM fleet_logs 
            WHERE vehicle_id=%s 
              AND end_odometer IS NOT NULL 
              AND end_odometer > 0
            ORDER BY log_date DESC, id DESC 
            LIMIT 1
        """, (vehicle_id,))
        last_log = cur.fetchone()
        
        start_km = last_log["end_odometer"] if last_log else initial_km

        # 4. Založenie draftu s korektnými kilometrami
        cur.execute("""
            INSERT INTO fleet_logs 
            (vehicle_id, log_date, driver, location_end, purpose, start_odometer, end_odometer) 
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (vehicle_id, date_str, driver, route_name, "Rozvoz tovaru", start_km, start_km))

        conn.commit()
        return {"message": f"Vozidlo '{veh['name']}' priradené. Počiatočný stav ({start_km} km) bol predvyplnený."}
    except Exception as e:
        if conn: conn.rollback()
        import traceback
        traceback.print_exc()
        return {"error": f"Chyba DB: {str(e)}"}
    finally:
        if conn and conn.is_connected():
            conn.close()