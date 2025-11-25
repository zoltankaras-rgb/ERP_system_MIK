# nastroje_ai.py
# ------------------------------------------------------------
# Schéma DB pre AI + bezpečné spúšťanie SQL:
#  - get_schema_prompt()             -> číta schema_prompt.md (s cache)
#  - vykonaj_bezpecny_sql_prikaz()   -> bezpečný SELECT‑only spúšťač
#  - vykonaj_dml_sql()               -> zápisy (INSERT/UPDATE...)
# ------------------------------------------------------------

from __future__ import annotations
import os, re, json, time, datetime, decimal
from typing import Any, Dict, List, Optional

# tvoje DB API
import db_connector

# ------------- Pomocné -------------------------------------------------------
def _jsonify_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def conv(v):
        if isinstance(v, (datetime.datetime, datetime.date)):
            return v.isoformat()
        if isinstance(v, decimal.Decimal):
            return float(v)
        return v
    return [{k: conv(v) for k, v in (r or {}).items()} for r in (rows or [])]

def _strip_sql_comments_and_strings(s: str) -> str:
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.DOTALL)
    s = re.sub(r"(?m)--.*$", " ", s)
    s = re.sub(r"('([^'\\]|\\.)*'|\"([^\"\\]|\\.)*\")", " ", s)
    return s

# ------------- SELECT-only guard --------------------------------------------
_SQL_MULTI_STMT   = re.compile(r";\s*(?=\S)", re.IGNORECASE)
_SQL_ONLY_SELECT  = re.compile(r"^\s*(WITH\b.*?SELECT\b|SELECT\b)", re.IGNORECASE | re.DOTALL)
_SQL_DDL_IO       = re.compile(
    r"\b(alter|create|drop|truncate|rename|grant|revoke|load|outfile|infile|handler|set|explain|describe|show|call|sleep\s*\()",
    re.IGNORECASE,
)
_SQL_WRITE_STMT   = re.compile(r"^\s*(insert|update|delete|replace\s+into)\b", re.IGNORECASE)

def vykonaj_bezpecny_sql_prikaz(sql: str, limit_default: int = 2000) -> Dict[str, Any]:
    """
    Povolí iba SELECT/CTE SELECT, doplní LIMIT ak chýba.
    """
    if not isinstance(sql, str):
        return {"error": "SQL musí byť text."}
    candidate = (sql or "").strip().rstrip(";")
    if not candidate:
        return {"error": "SQL je prázdne."}

    # multi-statement guard
    if _SQL_MULTI_STMT.search(_strip_sql_comments_and_strings(candidate)):
        return {"error": "Zakázané sú viaceré príkazy v jednom SQL."}

    # SELECT-only
    if not _SQL_ONLY_SELECT.match(candidate):
        return {"error": "Povolené sú len SELECT dotazy (vrátane WITH ... SELECT)."}

    # zakáž DDL/I-O aj v SELECT-e
    if _SQL_DDL_IO.search(_strip_sql_comments_and_strings(candidate)):
        return {"error": "Zakázaný príkaz – povolené sú len SELECT dotazy."}

    # doplň LIMIT (ak chýba)
    if re.search(r"\bLIMIT\s+\d+", candidate, re.IGNORECASE) is None:
        candidate = f"{candidate} LIMIT {int(limit_default)}"

    try:
        rows = db_connector.execute_query(candidate, fetch="all") or []
        rows = _jsonify_rows(rows)
        cols = list(rows[0].keys()) if rows else []
        return {"columns": cols, "rows": rows, "row_count": len(rows)}
    except Exception as e:
        return {"error": str(e)}

# ------------- DML (zápisy) ---------------------
def vykonaj_dml_sql(sql: str) -> Dict[str, Any]:
    """
    Vykoná INSERT/UPDATE/DELETE/REPLACE INTO.
    """
    if not isinstance(sql, str):
        return {"error": "SQL musí byť text."}
    candidate = (sql or "").strip().rstrip(";")
    if not candidate:
        return {"error": "SQL je prázdne."}

    clean = _strip_sql_comments_and_strings(candidate)

    if _SQL_MULTI_STMT.search(clean):
        return {"error": "Zakázané sú viaceré príkazy v jednom SQL."}

    if _SQL_DDL_IO.search(clean):
        return {"error": "Zakázané DDL/I-O príkazy."}

    if not _SQL_WRITE_STMT.match(clean):
        return {"error": "Povolené sú len INSERT/UPDATE/DELETE/REPLACE INTO."}

    try:
        db_connector.execute_query(candidate, fetch="none")
        # pokus o zistenie počtu ovplyvnených riadkov
        try:
            rc_row = db_connector.execute_query("SELECT ROW_COUNT() AS rc", fetch="one") or {}
            rc = rc_row.get("rc")
        except Exception:
            rc = None
        return {"ok": True, "affected_rows": rc}
    except Exception as e:
        return {"error": str(e)}

# ------------- SCHEMA PROMPT (ČÍTANIE SÚBORU) ---------------------------

_SCHEMA_FILE_CACHE = {"path": None, "mtime": 0.0, "text": ""}

def _read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def get_schema_prompt() -> str:
    """
    Kľúčová funkcia: Hľadá súbor schema_prompt.md.
    1. Skúsi ENV premennú SCHEMA_PROMPT_PATH.
    2. Skúsi priečinok 'schema/schema_prompt.md'.
    3. Skúsi koreňový priečinok 'schema_prompt.md'.
    """
    
    # 1. Cesta z ENV alebo default
    path = os.getenv("SCHEMA_PROMPT_PATH")
    
    # 2. Ak nie je v ENV, skúsime relatívne cesty
    if not path:
        base = os.path.dirname(os.path.abspath(__file__))
        
        # Možnosť A: v podpriečinku schema/
        path_a = os.path.join(base, "schema", "schema_prompt.md")
        # Možnosť B: priamo vedľa skriptu
        path_b = os.path.join(base, "schema_prompt.md")
        # Možnosť C: o úroveň vyššie (ak je nastroje_ai.py v podadresári)
        path_c = os.path.join(os.path.dirname(base), "schema_prompt.md")
        
        if os.path.exists(path_a):
            path = path_a
        elif os.path.exists(path_b):
            path = path_b
        elif os.path.exists(path_c):
            path = path_c
        else:
            # Fallback: ak súbor nenájde, vráti aspoň základnú informáciu, aby to nespadlo
            return "CHYBA: Súbor schema_prompt.md sa nenašiel. Uistite sa, že je nahratý v koreňovom adresári alebo v zložke schema/."

    # 3. Načítanie s cache (aby sme nečítali disk pri každom dotaze, ak sa nezmenil)
    try:
        st = os.stat(path)
        if _SCHEMA_FILE_CACHE["path"] != path or _SCHEMA_FILE_CACHE["mtime"] != st.st_mtime:
            txt = _read_text_file(path)
            _SCHEMA_FILE_CACHE.update({"path": path, "mtime": st.st_mtime, "text": txt})
        return _SCHEMA_FILE_CACHE["text"]
    except Exception as e:
        return f"CHYBA pri čítaní schémy: {str(e)}"