# gemini_agent.py — ERP agent (Full Schema Knowledge)
# ---------------------------------------------------------------------------------------------
from __future__ import annotations
import os, re, json, html, time
from typing import Any, Dict, List, Optional

# === LLM (Gemini) ============================================================
try:
    from google import genai
except Exception as _e:
    raise RuntimeError("Chýba balík `google-genai` (pip install -U google-genai)") from _e

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
PRIMARY_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
if not API_KEY:
    raise RuntimeError("Nastav GEMINI_API_KEY v .env")

client = genai.Client(api_key=API_KEY)

# Nastavenia
GENAI_MAX_RETRIES = 3
ROW_LIMIT_DEFAULT = int(os.getenv("AI_SQL_ROW_LIMIT", "200"))

# === DB + AI nástroje ========================================================
import db_connector
from nastroje_ai import (
    get_schema_prompt,         # <--- TOTO je kľúčová funkcia, ktorá číta tvoj súbor
    vykonaj_bezpecny_sql_prikaz,
    vykonaj_dml_sql,
)

# === Helpery na formátovanie (stále potrebné pre pekný mail) ==================

def _translate_header(col_name: str) -> str:
    """Jednoduchý prekladač len pre vizuál v maile (nie pre logiku AI)."""
    c = col_name.lower()
    # Tu sú len kozmetické preklady pre človeka
    mapping = {
        "product_name": "Produkt", "nazov_vyrobku": "Produkt",
        "sale_price_net": "Cena (€)", "price_eur_kg": "Cena/kg",
        "start_date": "Od", "end_date": "Do",
        "license_plate": "EČV", "total_km": "km", "km_driven": "km",
        "goods_out_kg": "Roznesené (kg)", "stock_kg": "Sklad (kg)",
    }
    return mapping.get(c, col_name)

def _fmt_val(val: Any, col: str) -> str:
    s = str(val)
    # Dátum
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        p = s.split("-")
        return f"{p[2]}.{p[1]}.{p[0]}"
    # Čísla
    if isinstance(val, (int, float)) or (s.replace('.','',1).isdigit() and '.' in s):
        try:
            v = float(val)
            if "price" in col or "eur" in col or "cena" in col:
                return f"{v:.2f} €".replace(".", ",")
            return f"{v:,.2f}".replace(",", " ").replace(".", ",")
        except: pass
    return s

def _rows_to_email_html(rows: List[Dict[str, Any]]) -> str:
    if not rows: return ""
    cols = list(rows[0].keys())
    
    th_style = "background:#f4f4f4;border:1px solid #ccc;padding:8px;text-align:left;font-weight:bold;"
    td_style = "border:1px solid #ccc;padding:8px;"
    
    thead = "".join(f"<th style='{th_style}'>{html.escape(_translate_header(c))}</th>" for c in cols)
    tbody = ""
    for r in rows[:50]:
        cells = "".join(f"<td style='{td_style}'>{html.escape(_fmt_val(r.get(c,''), c))}</td>" for c in cols)
        tbody += f"<tr>{cells}</tr>"
        
    return f"<table border='1' style='width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;'><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>"

# === Hlavná logika ===========================================================

def _call_llm(prompt: str) -> str:
    for _ in range(GENAI_MAX_RETRIES):
        try:
            resp = client.models.generate_content(model=PRIMARY_MODEL, contents=prompt)
            return (getattr(resp, "text", None) or str(resp)).strip()
        except Exception: time.sleep(1)
    return ""

def _extract_sql_only(text: str) -> Optional[str]:
    m = re.search(r"```sql\s*(.*?)```", text, re.IGNORECASE | re.DOTALL)
    if m: return m.group(1).strip()
    s = re.search(r"(?is)\b(select|with)\b.*", text)
    if s: return s.group(0).split(";")[0].strip()
    return None

def ask_gemini_agent(
    question: str,
    history: Optional[List[Dict[str, str]]] = None,
    *,
    conversation_id: Optional[str] = None,
    user_id: Optional[Any] = None,
    confirm: bool = False,
) -> Dict[str, Any]:
    
    q = (question or "").strip()
    if not q: return {"answer": "", "answer_html": ""}

    # 1. NAČÍTANIE TVOJHO SÚBORU schema_prompt.md
    # Funkcia get_schema_prompt() v nastroje_ai.py musí čítať ten súbor!
    full_schema_context = get_schema_prompt() 

    # 2. System Prompt - veľmi jednoduchý, lebo všetko je v schéme
    system_prompt = (
        "Si expertný SQL analytik pre MySQL.\n"
        f"Dnešný dátum: {time.strftime('%Y-%m-%d')}\n"
        "Tvojou úlohou je naštudovať si priloženú SCHÉMU a vygenerovať SQL dotaz na otázku používateľa.\n"
        "V SCHÉME sú poznámky 'POZNÁMKA PRE AI', ktoré presne hovoria, ako spájať tabuľky a prekladať EČV/EAN.\n"
        "Riaď sa nimi presne.\n"
        "Nepoužívaj Postgres syntax (ILIKE), len MySQL.\n"
        "Vráť iba SQL kód v bloku ```sql ... ```."
    )

    prompt = f"{system_prompt}\n\n=== SCHÉMA DATABÁZY ===\n{full_schema_context}\n\n=== OTÁZKA ===\n{q}\n"
    
    MAX_REPAIRS = 3
    last_error = None
    
    for _ in range(MAX_REPAIRS + 1):
        # 3. Volanie AI
        raw_resp = _call_llm(prompt)
        sql = _extract_sql_only(raw_resp)
        
        if not sql:
            return {"answer": raw_resp, "answer_html": f"<p>{html.escape(raw_resp)}</p>"}

        # 4. Vykonanie SQL
        res = vykonaj_bezpecny_sql_prikaz(sql)
        
        if res.get("error"):
            last_error = res["error"]
            print(f"--- AI CHYBA: {last_error}")
            prompt += f"\n\nCHYBA DB: {last_error}\nOPRAVA (pozri sa znova do schémy):"
            continue 
        
        # 5. Úspech -> Generovanie odpovede
        rows = res.get("rows", [])
        
        # Summarizer
        sample = json.dumps([{k: str(v) for k,v in r.items()} for r in rows[:3]], ensure_ascii=False)
        sum_prompt = (
            f"Otázka: {q}\nDáta: {sample}\n"
            "Napíš 1 vetu zhrnutia pre manažéra (slovensky). Nepíš 'Dobrý deň'. Buď konkrétny."
        )
        human_text = _call_llm(sum_prompt).replace('"', '').strip()
        if not human_text: human_text = f"Našiel som {len(rows)} záznamov."

        html_table = _rows_to_email_html(rows)
        
        full_html = (
            f"<div style='font-family: Arial, sans-serif;'>"
            f"<p>{html.escape(human_text)}</p>"
            f"{html_table}"
            f"</div>"
        )
        
        return {
            "answer": human_text,
            "answer_html": full_html,
            "used_sql": sql,
            "data": res,
            "result_meta": {"row_count": len(rows)}
        }

    return {
        "answer": "Nepodarilo sa získať dáta.",
        "answer_html": f"<p style='color:red'>Chyba: {last_error}</p>"
    }