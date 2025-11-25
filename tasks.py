# tasks.py
# ===========================================
# Proaktívne úlohy pre ERP (scheduler volá tieto funkcie)
# - používa nové SDK:  pip install google-genai
# - AI model: GEMINI_MODEL (napr. gemini-2.0-flash / gemini-2.5-flash)
# - e-mail: použije tvoj mail_handler.send_email, inak SMTP localhost
# - SMS: použije office_handler.sms_send alebo /api/kancelaria/sms/send
# - + Enterprise Calendar: notifikácie udalostí (email/SMS)
# ===========================================

from __future__ import annotations

import os
import datetime
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from pytz import timezone
import requests

# --- DB konektor (tvoj existujúci modul) ---
try:
    import db_connector
except Exception as e:
    raise RuntimeError(
        "Nepodarilo sa importovať db_connector. Uisti sa, že modul je v PYTHONPATH."
    ) from e

# --- AI (Nové SDK) ---
from google import genai

_GEMINI_KEY = os.getenv("GEMINI_API_KEY")
client: Optional[genai.Client] = None
if _GEMINI_KEY:
    try:
        client = genai.Client(api_key=_GEMINI_KEY)
    except Exception:
        client = None  # fallback: pobežíme bez AI

MODEL = (os.getenv("GEMINI_MODEL") or "gemini-2.0-flash").strip()
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "no-reply@example.com")

# časová zóna ERP
ERP_TZ = timezone(os.getenv("APP_TZ", "Europe/Bratislava"))

# kde beží tvoja Flask aplikácia (kalendár + SMS API)
CAL_API_BASE = os.getenv("CAL_API_BASE", "http://127.0.0.1:5000")
SMS_API_BASE = os.getenv("SMS_API_BASE", CAL_API_BASE)

# časové okno v sekundách, v ktorom sa pripomienka považuje za „aktuálnu“
CAL_NOTIF_WINDOW_SEC = int(os.getenv("CAL_NOTIF_WINDOW_SEC", "60"))

# jednoduchá cache, aby sme pri jednom behu scheduler-a neposlali tú istú
# pripomienku viackrát (po reštarte procesu sa cache vynuluje)
_CAL_SENT_CACHE: set[str] = set()


# ========================= E‑MAIL / SMS HELPERY =========================

def posli_sms(phone: str, text: str) -> None:
    """
    Jednoduchý wrapper pre tvoj SMS systém.

    Používa rovnaký formát payloadu, ako SMS Connector:
      {
        "message": "text správy",
        "sender": "MIK" (alebo z .env),
        "simple_text": true,
        "recipients": ["+421..."]
      }
    """
    if not phone:
        return

    payload = {
        "message": text,
        "sender": os.getenv("SMS_DEFAULT_SENDER", "ERP"),
        "simple_text": True,
        "recipients": [phone],
    }

    # 1) Skús priamu Python funkciu office_handler.sms_send
    try:
        from office_handler import sms_send  # musíš mať v office_handler
        sms_send(payload)
        return
    except Exception as e:
        # len log, nech vidíš, či to padlo na tomto kroku
        print("[SMS] office_handler.sms_send zlyhal:", e)

    # 2) HTTP API na /api/kancelaria/sms/send (rovnaké ako používa SMS UI)
    try:
        import requests
        base_url = os.getenv("ERP_BASE_URL", "http://127.0.0.1:5000")
        url = base_url.rstrip("/") + "/api/kancelaria/sms/send"
        # /api/kancelaria/sms/send berie JSON s rovnakým payloadom
        r = requests.post(url, json=payload, timeout=10)
        if not r.ok:
            print("[SMS] /api/kancelaria/sms/send vrátilo", r.status_code, r.text[:200])
        return
    except Exception as e:
        print("[SMS] HTTP volanie /api/kancelaria/sms/send zlyhalo:", e)

    # 3) fallback – len zaloguj, aby job nespadol
    print(f"[calendar] (FAKE SMS) {phone}: {text}")


def posli_email(to_addr: str, subject: str, text: str) -> None:
    """
    Najprv skúsi tvoj mail handler (mail_handler.send_email),
    ktorý používa rovnaké nastavenie ako UI mail modul.

    Ak to zlyhá, skúsime jednoduchý SMTP localhost (fallback),
    aby job nespadol.
    """
    # 1) Tvoj existujúci mail handler
    try:
        from mail_handler import send_email  # tá nová helper funkcia
        send_email(to_addr, subject, text, html=None)
        return
    except Exception as e:
        print("[MAIL] mail_handler.send_email zlyhal:", e)

    # 2) Fallback: jednoduchý SMTP localhost
    try:
        import smtplib
        from email.mime.text import MIMEText

        msg = MIMEText(text, _charset="utf-8")
        msg["Subject"] = subject
        msg["From"] = DEFAULT_FROM_EMAIL
        msg["To"] = to_addr

        with smtplib.SMTP("localhost") as s:
            s.send_message(msg)

        print(f"[MAIL] E-mail odoslaný cez SMTP localhost na {to_addr}")
    except Exception as e:
        print(f"[MAIL] Nepodarilo sa odoslať email na {to_addr} (SMTP fallback): {e}")


def send_email_existing(to_addr: str, subject: str, text: str) -> None:
    """
    Wrapper, ktorý používajú kalendárové notifikácie a AI úlohy.
    Ak by si v budúcnosti chcel zmeniť spôsob odosielania e‑mailov,
    stačí upraviť posli_email().
    """
    posli_email(to_addr, subject, text)


def send_sms_existing(phone: str, text: str) -> None:
    """
    Wrapper, ktorý používajú kalendárové notifikácie.

    Používa rovnaké API / formát ako SMS Connector.
    """
    posli_sms(phone, text)


# ========================= POMOCNÉ PRE SQL / AI =========================

def _rows_to_markdown(rows: List[Dict[str, Any]]) -> str:
    if not rows:
        return ""
    headers = list(rows[0].keys())
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(h, "")) for h in headers) + " |")
    return "\n".join(lines)


def _is_select(sql: str) -> bool:
    if not isinstance(sql, str):
        return False
    s = sql.strip().lstrip("(")  # toleruj CTE s () na začiatku
    return s.lower().startswith("select") or s.lower().startswith("with")


def _safe_select(sql: str) -> List[Dict[str, Any]]:
    """
    Povolené sú iba SELECT (vrátane CTE WITH ... SELECT).
    """
    if not _is_select(sql):
        return []
    return db_connector.execute_query(sql, fetch="all") or []


def _ai_summarize_markdown(md_text: str, system_prompt: str) -> str:
    """
    Vygeneruj krátke, profesionálne zhrnutie (ak AI je k dispozícii).
    Ak AI nie je k dispozícii, vráť pôvodný text.
    """
    if not client:
        return md_text

    try:
        prompt = f"{system_prompt}\n\n{md_text}"
        resp = client.models.generate_content(model=MODEL, contents=prompt)
        text = getattr(resp, "text", None) or str(resp)
        return text
    except Exception:
        # fallback: vráť raw md
        return md_text


# ========================= ÚLOHA: KONTROLA SKLADU =========================

def uloha_kontrola_skladu(email_to: str) -> str:
    """
    Denne o 14:00: nájdi položky pod minimom (sklad vs. produkty) a pošli stručný e-mail.
    Používa sa z scheduler.py (_schedule_builtin_jobs).
    """
    sql = """
    SELECT 
        p.nazov_vyrobku AS nazov,
        COALESCE(s.mnozstvo_kg, s.mnozstvo, 0) AS mnozstvo,
        COALESCE(p.min_zasoba_kg, p.min_zasoba, 0) AS min_zasoba,
        p.mj
    FROM sklad s
    JOIN produkty p ON p.ean = s.ean
    WHERE COALESCE(s.mnozstvo_kg, s.mnozstvo, 0) < COALESCE(p.min_zasoba_kg, p.min_zasoba, 0)
    ORDER BY (COALESCE(p.min_zasoba_kg, p.min_zasoba, 0) - COALESCE(s.mnozstvo_kg, s.mnozstvo, 0)) DESC
    LIMIT 200
    """
    rows = _safe_select(sql)
    if not rows:
        return "Všetko v poriadku – nič nie je pod minimom."

    md = _rows_to_markdown(rows)
    system = (
        "Si manažér skladu. Na základe tabuľky nižšie priprav stručný a profesionálny e-mail "
        "pre oddelenie nákupu so zoznamom surovín, ktoré treba urgentne doobjednať. "
        "Použi odrážky (názov, aktuálne množstvo vs. minimum, MJ) a krátky záver s odporúčaním."
    )
    text = _ai_summarize_markdown(md, system)
    posli_email(email_to, "Sklad pod minimom – urgentné doobjednávky", text)
    return f"Odoslaný email na {email_to} – položky pod minimom: {len(rows)}."


# ========================= ÚLOHA: DB AUTOMATIZÁCIE =======================

def vykonaj_db_ulohu(task_id: int) -> str:
    """
    Spustí definovanú úlohu z tabuľky `automatizovane_ulohy`:
      - ak má SQL SELECT, vykoná ho,
      - vytvorí zhrnutie pomocou AI (ak je dostupná),
      - odošle e-mail (ak je zadaný),
      - zapíše log do `automatizovane_ulohy_log`.
    """
    # 1) Načítaj definíciu
    t = db_connector.execute_query(
        "SELECT * FROM automatizovane_ulohy WHERE id=%s",
        (task_id,), fetch="one"
    )
    if not t:
        return f"Úloha {task_id} neexistuje."
    if not int(t.get("is_enabled", 1)):
        return f"Úloha {task_id} je vypnutá."

    name = t.get("nazov_ulohy") or f"Úloha #{task_id}"
    email_to = (t.get("email_adresata") or "").strip()
    popis = (t.get("popis_ulohy_pre_ai") or "").strip()
    sql_text = (t.get("sql_text") or "").strip()

    # 2) Spusti SELECT (ak je)
    rows: List[Dict[str, Any]] = []
    if sql_text and _is_select(sql_text):
        try:
            rows = _safe_select(sql_text)
        except Exception as e:
            rows = [{"chyba": f"SQL zlyhalo: {e}"}]

    # 3) Zhrnutie (AI ak je dostupná)
    md = _rows_to_markdown(rows) if rows else "_Bez dát (žiadny riadok)._"
    system = popis or "Zhrň priložené dáta a priprav stručný manažérsky e-mail (slovensky)."
    text = _ai_summarize_markdown(md, system)

    # 4) Pošli e-mail (ak je zadaný)
    if email_to:
        posli_email(email_to, name, text)

    # 5) Log do tabuľky
    try:
        db_connector.execute_query(
            """
            INSERT INTO automatizovane_ulohy_log(task_id, executed_at, row_count, summary)
            VALUES (%s, NOW(), %s, %s)
            """,
            (task_id, len(rows), text[:2000])
        )
    except Exception:
        # logovanie nech nezhodí job
        pass

    return f"Úloha {task_id} vykonaná – email: {email_to or '-'}, riadkov: {len(rows)}."


# ========================================================================
# === ENTERPRISE KALENDÁR – NOTIFIKÁCIE (EMAIL / SMS) ====================
# ========================================================================

def _load_calendar_reminders(now: datetime) -> List[Dict[str, Any]]:
    """
    Načíta pending notifikácie z tabuľky calendar_event_notifications,
    ktorých planned_at je v okolí aktuálneho času (± CAL_NOTIF_WINDOW_SEC).
    """
    window = timedelta(seconds=CAL_NOTIF_WINDOW_SEC)
    start = now - window
    end   = now + window

    rows = db_connector.execute_query(
        """
        SELECT 
            n.id,
            n.event_id,
            n.event_title,
            n.event_type,
            n.event_start,
            n.event_end,
            n.channel,
            n.contact_id,
            n.target_email,
            n.target_phone,
            n.minutes_before,
            n.planned_at,
            c.name  AS contact_name,
            c.email AS contact_email,
            c.phone AS contact_phone
        FROM calendar_event_notifications n
        LEFT JOIN calendar_contacts c ON c.id = n.contact_id
        WHERE n.status = 'PENDING'
          AND n.planned_at BETWEEN %s AND %s
        ORDER BY n.planned_at ASC, n.id ASC
        """,
        (start, end),
        fetch="all"
    ) or []
    return rows


def _send_calendar_notification_row(row: Dict[str, Any], now: datetime) -> bool:
    """
    Odošle jednu notifikáciu (EMAIL alebo SMS) a aktualizuje status v DB.
    Vráti True pri úspechu, False pri chybe.
    """
    notif_id = row.get("id")
    channel  = (row.get("channel") or "").upper().strip() or "EMAIL"

    event_title = (row.get("event_title") or "Udalosť").strip()
    event_type  = (row.get("event_type") or "").strip()
    minutes_before = int(row.get("minutes_before") or 0)

    event_start = row.get("event_start")
    if isinstance(event_start, str):
        try:
            event_start_dt = datetime.fromisoformat(event_start)
        except Exception:
            event_start_dt = None
    else:
        event_start_dt = event_start

    # text správy
    lines = []
    lines.append(f"Pripomienka: {event_title}")
    if event_type:
        lines.append(f"Typ: {event_type}")
    if event_start_dt:
        lines.append(f"Začiatok: {event_start_dt}")
    if minutes_before > 0:
        lines.append(f"Odoslané približne {minutes_before} min pred začiatkom.")
    body = "\n".join(lines)

    ok = False
    error_msg: Optional[str] = None

    try:
        if channel == "SMS":
            phone = (row.get("target_phone") or row.get("contact_phone") or "").strip()
            if not phone:
                error_msg = "Chýba telefónne číslo."
            else:
                posli_sms(phone, body)
                ok = True
        else:  # default EMAIL
            to_email = (row.get("target_email") or row.get("contact_email") or "").strip()
            if not to_email:
                error_msg = "Chýba e-mailová adresa."
            else:
                subject = f"Pripomienka: {event_title}"
                posli_email(to_email, subject, body)
                ok = True
    except Exception as e:
        error_msg = f"send_error: {e}"

    status = "SENT" if ok else "FAILED"

    # update v DB
    try:
        db_connector.execute_query(
            """
            UPDATE calendar_event_notifications
               SET status=%s,
                   sent_at = CASE WHEN %s='SENT' THEN NOW() ELSE sent_at END,
                   error_message = %s
             WHERE id=%s
            """,
            (status, status, error_msg, notif_id),
            fetch=None
        )
    except Exception as e:
        print("[calendar] Nepodarilo sa update-notification:", e)

    if ok:
        print(f"[calendar] Notifikácia #{notif_id} odoslaná ({channel}).")
    else:
        print(f"[calendar] Notifikácia #{notif_id} zlyhala: {error_msg}")

    return ok


def check_calendar_notifications() -> int:
    """
    Hlavná funkcia pre scheduler:
    - nájde pending notifikácie v aktuálnom časovom okne,
    - odošle email/SMS podľa konfigurácie,
    - aktualizuje stav v DB,
    - vráti počet úspešne odoslaných notifikácií.
    """
    now = datetime.now(ERP_TZ)

    rows = _load_calendar_reminders(now)
    if not rows:
        return 0

    sent_count = 0
    for r in rows:
        key = f"{r.get('id')}"
        if key in _CAL_SENT_CACHE:
            # v tomto behu scheduleru už odoslaná
            continue

        if _send_calendar_notification_row(r, now):
            _CAL_SENT_CACHE.add(key)
            sent_count += 1

    if sent_count:
        print(f"[calendar] Odoslaných notifikácií: {sent_count}")
    return sent_count
