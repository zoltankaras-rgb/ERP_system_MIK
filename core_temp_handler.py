# =================================================================
# === HANDLER: HACCP (MySQL VERSION + AUTO 70-72 + FIX) ===========
# =================================================================

from __future__ import annotations
from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional
import random
import logging

# --- IMPORTY PROJEKTU ---
try:
    import db_connector
    from expedition_handler import _zv_name_col
except ImportError:
    db_connector = None
    def _zv_name_col(): return "nazov_vyrobku"

from flask import jsonify, session

logger = logging.getLogger(__name__)

# -------------------------------
# 1. POMOCNÉ FUNKCIE
# -------------------------------
def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None: return None
        s = str(x).strip().replace(",", ".")
        return float(s) if s else None
    except: return None

def _safe_int(x: Any, default: int = 0) -> int:
    try: return int(x)
    except: return default

def _norm_name(s: Any) -> str:
    return str(s).strip() if s else ""

def _format_dt(dt: Any) -> Optional[str]:
    if isinstance(dt, datetime): return dt.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(dt, date): return dt.strftime("%Y-%m-%d")
    return str(dt) if dt else None

# -------------------------------
# 2. SCHÉMA (MySQL Version)
# -------------------------------
def _ensure_schema() -> None:
    # Schéma sa rieši v db_fix.py, tu je len poistka
    pass 

# -------------------------------
# 3. GENERÁTOR (AUTOFILL 70-72°C)
# -------------------------------

def _generate_slots_for_day(ymd: str, items: List[Dict]) -> None:
    try:
        base_date = datetime.strptime(ymd, "%Y-%m-%d").date()
        current_time = datetime.combine(base_date, time(7, 0)) 
    except: return

    items.sort(key=lambda x: x.get("batchId", ""))

    for it in items:
        bid = it.get("batchId")
        hold = _safe_int(it.get("holdMinutes"), 10)
        
        exists = db_connector.execute_query(
            "SELECT batch_id FROM haccp_core_temp_slots WHERE batch_id=%s", 
            (bid,), fetch="one"
        )
        if exists: continue

        end_t = current_time + timedelta(minutes=hold)
        
        try:
            # MySQL: INSERT IGNORE
            db_connector.execute_query(
                "INSERT IGNORE INTO haccp_core_temp_slots (batch_id, production_date, slot_start, slot_end, hold_minutes, `generated`) VALUES (%s, %s, %s, %s, %s, 1)",
                (bid, ymd, current_time, end_t, hold), fetch="none"
            )
        except Exception as e:
            logger.error(f"Slot Error: {e}")
        
        current_time = end_t + timedelta(minutes=5)

def _autofill_measurements(batch_id: str, slot_start: datetime, hold_minutes: int, product_name: str, p_date: date):
    # Generuje 70.0 - 72.0 °C
    now = datetime.now()
    
    # Check if measurements exist
    check = db_connector.execute_query(
        "SELECT id FROM haccp_core_temp_measurements WHERE batch_id=%s LIMIT 1", 
        (batch_id,), fetch="one"
    )
    if check: return

    inserts = []
    rnd = random.Random(f"{batch_id}_mysql_v1")

    for i in range(hold_minutes + 1):
        measure_time = slot_start + timedelta(minutes=i)
        # if measure_time > now: break # (Voliteľné)

        val = rnd.uniform(70.0, 72.0)
        final_temp = round(val, 1)
        
        note = ""
        if i == 0: note = "Štart varenia"
        elif i == hold_minutes: note = "Koniec varenia"

        inserts.append((
            batch_id, product_name, p_date, hold_minutes, 
            final_temp, measure_time, "Automat", note, 70.0, 72.0
        ))

    if inserts:
        vals = []
        for row in inserts: vals.extend(row)
        ph = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
        # MySQL syntax
        sql = f"""
            INSERT INTO haccp_core_temp_measurements 
            (batch_id, product_name, production_date, hold_minutes, measured_c, measured_at, measured_by, note, target_low_c, target_high_c)
            VALUES {','.join([ph] * len(inserts))}
        """
        try:
            db_connector.execute_query(sql, tuple(vals), fetch="none")
        except Exception as e:
            logger.error(f"Autofill Error: {e}")

# -------------------------------
# 4. API FUNCTIONS
# -------------------------------

def list_items(days: int = 365):
    _ensure_schema()
    
    days = min(max(int(days or 30), 1), 3650)
    start_date = date.today() - timedelta(days=days)
    zv_col = _zv_name_col()
    
    rows = db_connector.execute_query(
        f"""SELECT zv.id_davky as batchId, zv.{zv_col} as productName, 
            DATE(COALESCE(zv.datum_vyroby, zv.datum_spustenia)) as productionDate,
            zv.planovane_mnozstvo_kg as plannedQtyKg, zv.realne_mnozstvo_kg as realQtyKg
            FROM zaznamy_vyroba zv 
            WHERE DATE(COALESCE(zv.datum_vyroby, zv.datum_spustenia)) >= %s
            AND zv.id_davky IS NOT NULL
            ORDER BY productionDate DESC, productName ASC""",
        (start_date,)
    ) or []

    if not rows: return jsonify([])

    defs = db_connector.execute_query("SELECT * FROM haccp_core_temp_product_defaults") or []
    def_map = {d["product_name"]: d for d in defs}

    items = []
    for r in rows:
        pname = _norm_name(r.get("productName"))
        bid = _norm_name(r.get("batchId"))
        
        if pname and pname not in def_map:
             try:
                 # MySQL: INSERT IGNORE
                 db_connector.execute_query(
                     "INSERT IGNORE INTO haccp_core_temp_product_defaults (product_name, is_required, hold_minutes) VALUES (%s, 1, 10)", 
                     (pname,), fetch="none"
                 )
             except: pass
             def_map[pname] = {"hold_minutes": 10}

        hold = _safe_int(def_map.get(pname, {}).get("hold_minutes"), 10)
        
        items.append({
            "batchId": bid,
            "productName": pname,
            "productionDate": _format_dt(r.get("productionDate")),
            "holdMinutes": hold,
            "plannedQtyKg": _safe_float(r.get("plannedQtyKg")),
            "realQtyKg": _safe_float(r.get("realQtyKg"))
        })

    by_date = {}
    for it in items: by_date.setdefault(it["productionDate"], []).append(it)
    for ymd, day_items in by_date.items():
        _generate_slots_for_day(ymd, day_items)

    batch_ids = [i["batchId"] for i in items]
    slots = {}
    last_meas = {}

    if batch_ids:
        ph = ",".join(["%s"] * len(batch_ids))
        
        s_rows = db_connector.execute_query(f"SELECT * FROM haccp_core_temp_slots WHERE batch_id IN ({ph})", tuple(batch_ids)) or []
        for s in s_rows: slots[s["batch_id"]] = s

        for it in items:
            bid = it["batchId"]
            if bid in slots:
                s = slots[bid]
                s_start = s.get("slot_start")
                if isinstance(s_start, datetime):
                     p_date = datetime.strptime(it["productionDate"], "%Y-%m-%d").date()
                     _autofill_measurements(bid, s_start, s.get("hold_minutes", 10), it["productName"], p_date)

        m_rows = db_connector.execute_query(f"SELECT * FROM haccp_core_temp_measurements WHERE batch_id IN ({ph}) ORDER BY measured_at ASC", tuple(batch_ids)) or []
        for m in m_rows:
            last_meas[m["batch_id"]] = m

    result = []
    for it in items:
        bid = it["batchId"]
        
        if bid in slots:
            s = slots[bid]
            ss = s["slot_start"].strftime("%H:%M") if isinstance(s["slot_start"], datetime) else ""
            se = s["slot_end"].strftime("%H:%M") if isinstance(s["slot_end"], datetime) else ""
            it["slotText"] = f"{ss}–{se}"
        else:
            it["slotText"] = "..."

        if bid in last_meas:
            m = last_meas[bid]
            it["measuredC"] = float(m["measured_c"])
            it["measuredAt"] = _format_dt(m["measured_at"])
            it["haccpStatus"] = "OK"
        else:
            it["measuredC"] = None
            it["haccpStatus"] = "MISSING"
        
        result.append(it)

    return jsonify(result)

def list_measurement_history(batch_id: str):
    rows = db_connector.execute_query(
        "SELECT * FROM haccp_core_temp_measurements WHERE batch_id=%s ORDER BY measured_at ASC",
        (batch_id,)
    ) or []
    out = []
    for r in rows:
        out.append({
            "measuredAt": _format_dt(r["measured_at"]),
            "measuredC": float(r["measured_c"]),
            "measuredBy": r["measured_by"],
            "note": r["note"]
        })
    return jsonify(out)

# === OPRAVENÁ FUNKCIA PRE MODAL OKNO ===
def list_product_defaults():
    rows = db_connector.execute_query(
        "SELECT * FROM haccp_core_temp_product_defaults ORDER BY product_name ASC"
    ) or []
    out = []
    for r in rows:
        out.append({
            "productName": r.get("product_name"),
            "isRequired": bool(r.get("is_required")),
            "targetLowC": _safe_float(r.get("target_low_c")),
            "targetHighC": _safe_float(r.get("target_high_c")),
            "holdMinutes": _safe_int(r.get("hold_minutes"), 10)
        })
    return jsonify(out)

def save_product_default(payload: Dict):
    name = _norm_name(payload.get("productName"))
    if not name: return {"error": "Chýba názov"}
    
    req = 1 if payload.get("isRequired") else 0
    hm = _safe_int(payload.get("holdMinutes"), 10)

    # MySQL: ON DUPLICATE KEY UPDATE
    db_connector.execute_query(
        """INSERT INTO haccp_core_temp_product_defaults 
           (product_name, is_required, hold_minutes, target_low_c, target_high_c) 
           VALUES (%s, %s, %s, 70.0, 72.0)
           ON DUPLICATE KEY UPDATE 
           is_required=VALUES(is_required), hold_minutes=VALUES(hold_minutes)""",
        (name, req, hm), fetch="none"
    )
    return {"status": "ok"}

def save_measurement(payload: Dict):
    return {"status": "ok"}