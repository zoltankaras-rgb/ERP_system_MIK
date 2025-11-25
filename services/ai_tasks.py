# services/ai_tasks.py
# -------------------------------------------------------------------
# LOGIKA PRE PLÁNOVANÉ ÚLOHY (AI → SQL → PEKNÁ TABUĽKA → MAIL)
# -------------------------------------------------------------------
from __future__ import annotations
import uuid
import re
import html as py_html
from typing import Any, Dict, List, Optional

from flask import current_app
from flask_mail import Message

import db_connector

# Import agenta (s fallbackom pre rôzne umiestnenie súborov)
try:
    from gemini_agent import ask_gemini_agent
except ImportError:
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from gemini_agent import ask_gemini_agent

# ───────────────────────── PREKLADY A FORMÁTOVANIE (Tu sa menia názvy) ─────────────────────────

def _friendly_header(name: str) -> str:
    """Prekladá názvy stĺpcov z databázy do peknej slovenčiny."""
    n = (name or "").lower()
    mapping = {
        # Akcie a Ceny
        "promotion_name": "Názov akcie",
        "product_name": "Produkt",
        "nazov_vyrobku": "Produkt",
        "product_ean": "EAN",
        "retail_chain": "Reťazec",
        "retail_chain_name": "Reťazec",
        "sale_price_net": "Akciová cena (€)",  # <--- ZMENA
        "price_eur_kg": "Cena (€/kg)",
        "predajna_cena": "Predajná cena (€)",
        
        # Dátumy
        "start_date": "Platnosť od",           # <--- ZMENA
        "end_date": "Platnosť do",             # <--- ZMENA
        "datum_od": "Platnosť od",
        "datum_do": "Platnosť do",
        "created_at": "Vytvorené",
        
        # Sklad a Logistika
        "message": "Poznámka",
        "sales_kg": "Predaj (kg)",
        "centralny_sklad_kg": "Sklad (kg)",
        "stock_kg": "Sklad (kg)",
        "mnozstvo": "Množstvo",
        "min_zasoba": "Min. zásoba",
        
        # IoT / Vozidlá
        "total_km": "Najazdené km",
        "km_driven": "Najazdené km",
        "device_name": "Zariadenie",
        "max_temp_c": "Teplota (°C)",
        "at_timestamp": "Čas merania",
        "license_plate": "EČV",
    }
    return mapping.get(n, name)

def _fmt_num(x, *, auto_dec=True) -> str:
    """Formátuje čísla (1000 -> 1 000)."""
    try:
        v = float(x)
        if not auto_dec: return f"{v:,.2f}".replace(",", " ")
        d = 3 if abs(v) < 1 else 2
        return f"{v:,.{d}f}".replace(",", " ").replace(".", ",")
    except Exception:
        return "" if x is None else str(x)

def _fmt_eur(v) -> str:
    """Formátuje menu."""
    try:
        return f"{float(v):.2f} €".replace(".", ",")
    except Exception:
        return f"{v} €"

def _render_table_friendly(columns, rows, max_rows=200) -> str:
    """Vygeneruje peknú HTML tabuľku pre e-mail."""
    rows = rows or []
    cols = [str(c) for c in (columns or (list(rows[0].keys()) if rows else []))]

    # Štýly (aby to vyzeralo dobre aj v Outlooku)
    style_th = "text-align:left; padding:8px; border-bottom:2px solid #ddd; background:#f4f4f4; color:#333; font-weight:bold; font-size:13px;"
    style_td = "padding:8px; border-bottom:1px solid #eee; font-size:13px; color:#444;"
    
    thead = "<thead><tr>" + "".join(
        f"<th style='{style_th}'>{py_html.escape(_friendly_header(c))}</th>" for c in cols
    ) + "</tr></thead>"

    def _cell_val(k: str, v):
        if v is None: return ""
        kl = k.lower()
        
        # Formátovanie cien a čísel
        if any(t in kl for t in ("price", "eur", "cena")): return _fmt_eur(v)
        if any(t in kl for t in ("kg", "km", "qty", "mnoz", "zasoba")): return _fmt_num(v)
        
        # Formátovanie Dátumu (YYYY-MM-DD -> DD.MM.YYYY)
        s = str(v)
        # Regex pre ISO dátum
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
        if m: return f"{m.group(3)}.{m.group(2)}.{m.group(1)}"
        # Regex pre Datetime (orezanie času ak je 00:00:00)
        if " " in s and ":" in s:
            try:
                date_part, time_part = s.split(" ")
                dm = re.match(r"^(\d{4})-(\d{2})-(\d{2})", date_part)
                if dm:
                    return f"{dm.group(3)}.{dm.group(2)}.{dm.group(1)} {time_part[:-3]}" # bez sekúnd
            except: pass

        return py_html.escape(s)

    body_rows = []
    for r in rows[:max_rows]:
        tds = "".join(f"<td style='{style_td}'>{_cell_val(c, r.get(c))}</td>" for c in cols)
        body_rows.append(f"<tr>{tds}</tr>")
    
    return (
        f"<table cellspacing='0' cellpadding='0' border='0' width='100%' "
        f"style='border-collapse:collapse; font-family:Segoe UI, Arial, sans-serif; border:1px solid #eee;'>"
        f"{thead}<tbody>{''.join(body_rows)}</tbody></table>"
    )

def _send_task_email(to_addr: str, subject: str, html_body: str) -> bool:
    mail = current_app.extensions.get('mail') or globals().get('mail')
    if not mail:
        print("[AI_TASKS] Flask-Mail nie je nakonfigurovaný.")
        return False
    
    sender = current_app.config.get("MAIL_DEFAULT_SENDER") or "no-reply@miksro.sk"
    if isinstance(sender, (list, tuple)): sender = sender[0]
    
    msg = Message(subject=subject, recipients=[to_addr], sender=sender)
    msg.html = html_body
    
    try:
        with current_app.app_context():
            mail.send(msg)
        return True
    except Exception as e:
        print(f"[AI_TASKS] Chyba odosielania e-mailu: {e}")
        return False

# ───────────────────────── LOGIKA INTRA (TEXTU) ─────────────────────────

def _is_promotions_result(columns) -> tuple[bool, dict]:
    """Zistí, či tabuľka obsahuje dáta o akciách."""
    cols = [str(c).lower() for c in (columns or [])]
    s = set(cols)
    colmap = {
        "product": next((c for c in ["product_name","nazov_vyrobku","name"] if c in s), None),
        "price":   next((c for c in ["sale_price_net","price_eur_kg","cena","predajna_cena"] if c in s), None),
        "start":   next((c for c in ["start_date","datum_od"] if c in s), None),
        "end":     next((c for c in ["end_date","datum_do"] if c in s), None),
        "chain":   next((c for c in ["retail_chain_name","retail_chain","chain_name"] if c in s), None),
    }
    has_min = bool(colmap["product"] and colmap["price"])
    return has_min, colmap

def _compose_promotions_intro(rows: List[dict], colmap: dict) -> str:
    """Fallback text pre akcie (ak by AI zlyhala)."""
    if not rows: return "<p>Žiadne akcie.</p>"
    
    chains = sorted({str(r.get(colmap["chain"]) or "") for r in rows if colmap.get("chain") and r.get(colmap["chain"])})
    chain_txt = f" v <b>{py_html.escape(chains[0])}</b>" if len(chains) == 1 else ""
    
    items = []
    for r in rows[:3]:
        p = r.get(colmap["product"])
        c = r.get(colmap["price"])
        items.append(f"{py_html.escape(str(p))} <b>{_fmt_eur(c)}</b>")
    
    extra = f", +{len(rows)-3} ďalšie" if len(rows) > 3 else ""
    return f"<p>Prebieha akcia{chain_txt}: {'; '.join(items)}{extra}.</p>"

def _compose_generic_intro(rows: List[dict]) -> str:
    if not rows: return "Nenašiel som žiadne záznamy."
    return f"Našiel som {len(rows)} záznamov (tabuľka nižšie)."

# ───────────────────────── CRON BUILDER ─────────────────────────
def build_cron_expr(kind: str, *, time_str: str = None, dow: str|int = None, dom: int = None) -> str:
    kind = (kind or "").lower()
    if kind == "every_5m": return "*/5 * * * *"
    if kind == "daily":
        h, m = (time_str or "14:00").split(":")
        return f"{int(m)} {int(h)} * * *"
    return "0 14 * * *"

# ───────────────────────── PREVIEW (Náhľad v prehliadači) ─────────────────────────

def preview_nl(*, question: str, conversation_id: Optional[str] = None) -> Dict[str, Any]:
    conv_id = conversation_id or f"preview_{uuid.uuid4().hex[:8]}"
    out = ask_gemini_agent(question, history=[], conversation_id=conv_id, confirm=False)
    
    email_html = f"<h3 style='margin:0 0 .5rem 0'>Náhľad e-mailu</h3>{out.get('answer_html','')}"
    return {
        "answer": out.get("answer") or "",
        "answer_html": out.get("answer_html") or "",
        "email_html": email_html,
        "rows": (out.get("data") or {}).get("rows") or [],
        "columns": (out.get("data") or {}).get("columns") or [],
        "used_sql": out.get("used_sql"),
    }

# ───────────────────────── RUN TASK (Scheduler) ─────────────────────────
# services/ai_tasks.py - (iba funkcia run_task)

def run_task(task_id: int, *, idempotency_key: str | None = None, throttle_seconds: int = 10) -> Dict[str, Any]:
    lock_name = f"task_lock_{task_id}"
    try:
        got = db_connector.execute_query("SELECT GET_LOCK(%s, 0) AS ok", (lock_name,), fetch="one")
        if not got or int(got.get("ok") or 0) != 1: return {"ok": False, "message": "Locked"}
    except: pass

    try:
        task = db_connector.execute_query("SELECT * FROM automatizovane_ulohy WHERE id=%s", (task_id,), fetch="one")
        if not task: return {"ok": False, "message": "Task not found"}

        title    = task.get("nazov_ulohy") or f"Úloha {task_id}"
        email_to = (task.get("email_adresata") or "").strip()
        question = (task.get("popis_ulohy_pre_ai") or "").strip()
        sql_text = (task.get("sql_text") or "").strip()
        
        final_html = ""
        sql_err = None
        rows = []
        row_count = 0

        # === 1. AI Logic ===
        if question and not sql_text:
            try:
                out = ask_gemini_agent(question, history=[], conversation_id=f"task_{task_id}", confirm=False)
                
                if out.get("answer_html"):
                    final_html = out["answer_html"]
                else:
                    rows = (out.get("data") or {}).get("rows") or []
                    cols = (out.get("data") or {}).get("columns") or []
                    final_html = f"<p>{out.get('answer','')}</p>" + _render_table_friendly(cols, rows)
                
                rows = (out.get("data") or {}).get("rows") or []
                row_count = len(rows)
            except Exception as e:
                sql_err = f"AI Error: {str(e)}"

        # === 2. Legacy SQL Logic ===
        elif sql_text:
            try:
                from nastroje_ai import vykonaj_bezpecny_sql_prikaz
                res = vykonaj_bezpecny_sql_prikaz(sql_text)
                if res.get("error"):
                    sql_err = res["error"]
                else:
                    rows = res.get("rows") or []
                    cols = res.get("columns") or []
                    row_count = len(rows)
                    
                    is_promo, colmap = _is_promotions_result(cols)
                    if is_promo:
                        intro = _compose_promotions_intro(rows, colmap)
                    else:
                        intro = f"<p>{_compose_generic_intro(rows)}</p>"
                    
                    tbl = _render_table_friendly(cols, rows)
                    final_html = f"{intro}{tbl}"
            except Exception as e:
                sql_err = str(e)

        # === 3. Send Email (LOGIKA PRE ALERT) ===
        status = "SKIPPED"
        msg_log = ""

        # ODOSLAŤ LEN AK SÚ DÁTA (row_count > 0) ALEBO AK NASTALA CHYBA
        # Ak je 0 riadkov a žiadna chyba, považujeme to za "Všetko OK" a neposielame mail.
        should_send = False
        
        if sql_err: 
            should_send = True # Pošleme info o chybe
        elif row_count > 0:
            should_send = True # Máme dáta (napr. nízky sklad)
        
        if email_to and should_send:
            body_style = "font-family:Segoe UI,Arial,sans-serif; color:#333;"
            if sql_err:
                content = f"<div style='{body_style}'><h2 style='color:red'>Chyba</h2><p>{py_html.escape(sql_err)}</p></div>"
            else:
                content = (
                    f"<div style='{body_style}'>"
                    f"<h2 style='border-bottom:1px solid #ddd; padding-bottom:10px'>{py_html.escape(title)}</h2>"
                    f"{final_html}"
                    f"<p style='color:#999; font-size:11px; margin-top:20px'>AI Asistent MIK s.r.o.</p>"
                    f"</div>"
                )

            if _send_task_email(email_to, f"[Report] {title}", content):
                status = "SENT"
            else:
                status = "MAIL_ERROR"
        elif email_to and row_count == 0:
            status = "SKIPPED (0 rows)"
            msg_log = "Žiadne dáta na odoslanie (Alert mode)."

        # === 4. Log ===
        summary = f"Email: {email_to} | Status: {status} | Rows: {row_count}"
        if msg_log: summary += f" | {msg_log}"
        if sql_err: summary += f" | ERR: {sql_err}"
        
        try:
            db_connector.execute_query(
                "INSERT INTO automatizovane_ulohy_log(task_id, executed_at, row_count, summary) VALUES (%s, NOW(), %s, %s)",
                (task_id, row_count, summary[:2000]), fetch="none"
            )
        except: pass

        return {"ok": not sql_err, "message": summary}

    finally:
        try: db_connector.execute_query("SELECT RELEASE_LOCK(%s)", (lock_name,), fetch="none")
        except: pass