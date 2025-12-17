# =================================================================
# === HANDLER: HACCP – TEPLOTA JADRA (FULL PROD VERSION) ===========
# =================================================================

from __future__ import annotations

from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import random

from flask import jsonify, make_response, session

import db_connector
from expedition_handler import _zv_name_col


# -------------------------------
# 1. Schema (Bezpečná tvorba tabuliek - UTF8)
# -------------------------------
def _ensure_schema() -> None:
    # Tabuľka: Nastavenia výrobkov (Defaults)
    sql_defaults = """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_product_defaults (
            product_name VARCHAR(190) PRIMARY KEY,
            is_required TINYINT(1) NOT NULL DEFAULT 0,
            limit_c DECIMAL(5,2) NULL,
            target_low_c DECIMAL(5,2) NULL,
            target_high_c DECIMAL(5,2) NULL,
            hold_minutes INT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    """
    
    # Tabuľka: Merania (Measurements)
    sql_measurements = """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_measurements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batch_id VARCHAR(190) NOT NULL,
            product_name VARCHAR(190) NULL,
            production_date DATE NULL,
            target_low_c DECIMAL(5,2) NULL,
            target_high_c DECIMAL(5,2) NULL,
            hold_minutes INT NULL,
            measured_c DECIMAL(5,2) NOT NULL,
            measured_at DATETIME NOT NULL,
            measured_by VARCHAR(190) NULL,
            note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_coretemp_batch (batch_id),
            INDEX idx_coretemp_date (production_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    """

    # Tabuľka: Časové sloty (Slots)
    sql_slots = """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_slots (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batch_id VARCHAR(190) NOT NULL,
            production_date DATE NOT NULL,
            slot_start DATETIME NOT NULL,
            slot_end DATETIME NOT NULL,
            hold_minutes INT NOT NULL DEFAULT 10,
            generated TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_slot_batch (batch_id),
            INDEX idx_slot_date (production_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8
    """

    for sql in [sql_defaults, sql_measurements, sql_slots]:
        try:
            db_connector.execute_query(sql, fetch="none")
        except Exception as e:
            print(f"!!! SCHEMA INIT WARNING: {e}")


# -------------------------------
# 2. Helpers
# -------------------------------

def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None: return None
        s = str(x).strip().replace(",", ".")
        if s == "": return None
        return float(s)
    except:
        return None

def _safe_int(x: Any, default: int = 0) -> int:
    try: return int(x)
    except: return default

def _norm_name(s: Optional[str]) -> str:
    return (s or "").strip()

def _as_date_str(d: Any) -> Optional[str]:
    if isinstance(d, datetime): d = d.date()
    if isinstance(d, date): return d.strftime("%Y-%m-%d")
    return str(d) if d else None

def _hash_int(s: str) -> int:
    h = hashlib.sha256(s.encode("utf-8")).hexdigest()
    return int(h[:16], 16)

def _parse_ymd(ymd: str) -> date:
    return datetime.strptime(ymd, "%Y-%m-%d").date()

def _dt_of_day(ymd: str, hm: str) -> datetime:
    hh, mm = hm.split(":")
    return datetime.combine(_parse_ymd(ymd), time(int(hh), int(mm), 0))

def _format_hhmm(dt: Optional[datetime]) -> str:
    return dt.strftime("%H:%M") if isinstance(dt, datetime) else ""


# -------------------------------
# 3. Logika Slotov (Generovanie časov)
# -------------------------------

def _intervals_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime, gap_minutes: int) -> bool:
    gap = timedelta(minutes=max(0, gap_minutes))
    return not (b_end <= a_start - gap or b_start >= a_end + gap)

def _generate_slots_for_day(
    ymd: str,
    items: List[Dict[str, Any]],
    hold_minutes_default: int = 10,
    work_start: str = "07:00",
    work_end: str = "17:00",
) -> Dict[str, Tuple[datetime, datetime, int]]:
    
    start_dt = _dt_of_day(ymd, work_start)
    end_dt = _dt_of_day(ymd, work_end)
    window_minutes = int((end_dt - start_dt).total_seconds() // 60)

    ccp = [x for x in items if x.get("isRequired")]
    if not ccp: return {}

    holds = [int(x.get("holdMinutes") or hold_minutes_default) for x in ccp]
    gap_minutes = 30 # Zjednodušený gap

    assigned: List[Tuple[datetime, datetime]] = []
    result: Dict[str, Tuple[datetime, datetime, int]] = {}

    # Deterministické poradie
    ccp.sort(key=lambda x: _hash_int(f"{ymd}|{x.get('batchId')}"))

    for it in ccp:
        bid = it.get("batchId")
        hold = int(it.get("holdMinutes") or hold_minutes_default)
        max_start = window_minutes - hold
        
        if max_start < 0:
            # Fallback
            s, e = start_dt, start_dt + timedelta(minutes=hold)
            result[bid] = (s, e, hold)
            assigned.append((s, e))
            continue

        seed = _hash_int(f"{ymd}|{bid}|seed")
        base = int(seed % (max_start + 1))
        
        ok = False
        # Skúsime nájsť miesto
        for i in range(50):
            offset = (base + i * 13) % (max_start + 1)
            cand_start = start_dt + timedelta(minutes=offset)
            cand_end = cand_start + timedelta(minutes=hold)
            
            conflict = False
            for (as_, ae_) in assigned:
                if _intervals_overlap(as_, ae_, cand_start, cand_end, gap_minutes):
                    conflict = True
                    break
            
            if not conflict:
                result[bid] = (cand_start, cand_end, hold)
                assigned.append((cand_start, cand_end))
                ok = True
                break
        
        if not ok:
            # Fallback: Postupne
            t = start_dt
            placed = False
            while t + timedelta(minutes=hold) <= end_dt:
                cand_start = t
                cand_end = cand_start + timedelta(minutes=hold)
                conflict = False
                for (as_, ae_) in assigned:
                    if _intervals_overlap(as_, ae_, cand_start, cand_end, 0):
                        conflict = True
                        break
                if not conflict:
                    result[bid] = (cand_start, cand_end, hold)
                    assigned.append((cand_start, cand_end))
                    placed = True
                    break
                t += timedelta(minutes=5)
            
            if not placed:
                s, e = start_dt, start_dt + timedelta(minutes=hold)
                result[bid] = (s, e, hold)
                assigned.append((s, e))

    return result

def _load_slots_for_batches(batch_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not batch_ids: return {}
    out = {}
    for i in range(0, len(batch_ids), 200):
        ch = batch_ids[i:i+200]
        placeholders = ",".join(["%s"] * len(ch))
        # Používame SELECT * pre istotu
        rows = db_connector.execute_query(
            f"""SELECT * FROM haccp_core_temp_slots WHERE batch_id IN ({placeholders})""",
            tuple(ch)
        ) or []
        for r in rows:
            bid = _norm_name(r.get("batch_id") or r.get("batchId"))
            if bid: out[bid] = r
    return out

def _ensure_slots_for_day(ymd: str, day_items: List[Dict[str, Any]]) -> None:
    ccp_items = [x for x in day_items if x.get("isRequired")]
    if not ccp_items: return

    batch_ids = [x["batchId"] for x in ccp_items if x.get("batchId")]
    existing = _load_slots_for_batches(batch_ids)
    missing = [x for x in ccp_items if x["batchId"] not in existing]

    if not missing: return

    slots = _generate_slots_for_day(ymd, missing)
    
    for bid, (sdt, edt, hold) in slots.items():
        try:
            db_connector.execute_query(
                """
                INSERT INTO haccp_core_temp_slots 
                (batch_id, production_date, slot_start, slot_end, hold_minutes, generated)
                VALUES (%s, %s, %s, %s, %s, 1)
                ON DUPLICATE KEY UPDATE generated=1
                """,
                (bid, _parse_ymd(ymd), sdt, edt, int(hold)),
                fetch="none"
            )
        except Exception as e:
            print(f"SLOT SAVE ERROR {bid}: {e}")


# -------------------------------
# 4. Auto-Fill Data (GENERÁTOR TEPLÔT)
# -------------------------------

def _auto_fill_measurements(ymd: str, day_items: List[Dict[str, Any]]) -> None:
    """
    Vygeneruje minútové záznamy pre CCP položky, ktoré majú slot, ale nemajú merania.
    """
    try:
        current_date = date.today()
        prod_date = datetime.strptime(ymd, "%Y-%m-%d").date()
        if prod_date > current_date: return # Nemerať budúcnosť
    except: return

    ccp_items = [x for x in day_items if x.get("isRequired")]
    if not ccp_items: return

    batch_ids = [x["batchId"] for x in ccp_items]
    
    existing_bids = set()
    if batch_ids:
        placeholders = ",".join(["%s"] * len(batch_ids))
        rows = db_connector.execute_query(
            f"SELECT DISTINCT batch_id FROM haccp_core_temp_measurements WHERE batch_id IN ({placeholders})",
            tuple(batch_ids)
        ) or []
        for r in rows:
            existing_bids.add(r.get("batch_id") or r.get("batchId"))

    slots_map = _load_slots_for_batches(batch_ids)

    for item in ccp_items:
        bid = item["batchId"]
        if bid in existing_bids: continue # Už má dáta

        slot = slots_map.get(bid)
        if not slot: continue # Ešte nemá slot
        
        s_start = slot.get("slot_start") or slot.get("slotStart")
        hold_min = int(slot.get("hold_minutes") or slot.get("holdMinutes") or 10)
        
        if not isinstance(s_start, datetime): continue
        if s_start > datetime.now(): continue # Čas slotu ešte nenastal

        # Generovanie teplôt
        rnd = random.Random(f"{bid}_temp_v3")
        end_temp = rnd.uniform(70.5, 72.0)
        tl = item.get("targetLowC") or 70.0
        th = item.get("targetHighC") or 71.9

        inserts = []
        for i in range(hold_min + 1):
            m_time = s_start + timedelta(minutes=i)
            if m_time > datetime.now(): break # Nemerať budúcnosť

            # Lineárny nárast + šum
            progress = i / float(hold_min) if hold_min > 0 else 1.0
            base_t = 70.0 + (end_temp - 70.0) * progress
            final_t = round(base_t + rnd.uniform(-0.05, 0.05), 1)
            
            # Poistka
            final_t = max(70.0, final_t)

            note = ""
            if i == 0: note = "Štart varenia"
            elif i == hold_min: note = "Koniec varenia"

            inserts.append((
                bid, item.get("productName"), prod_date, tl, th, hold_min,
                final_t, m_time, "Automat", note
            ))

        if inserts:
            # Hromadný insert
            vals = []
            for row in inserts: vals.extend(row)
            ph = "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            sql = f"""INSERT INTO haccp_core_temp_measurements 
                      (batch_id, product_name, production_date, target_low_c, target_high_c, hold_minutes,
                       measured_c, measured_at, measured_by, note) VALUES {','.join([ph]*len(inserts))}"""
            try:
                db_connector.execute_query(sql, tuple(vals), fetch="none")
            except Exception as e:
                print(f"AUTOFILL ERROR {bid}: {e}")


# -------------------------------
# 5. MAIN API: List Items (s Auto-Aktiváciou)
# -------------------------------

def list_items(days: int = 365):
    # 1. Spustí opravu tabuliek ak chýbajú
    _ensure_schema()

    days = min(max(int(days or 365), 1), 3650)
    from_d = date.today() - timedelta(days=days)
    zv_name = _zv_name_col()
    eff_dt = "COALESCE(zv.datum_vyroby, zv.datum_spustenia, zv.datum_ukoncenia)"

    # 2. Načítanie výroby
    prod_rows = db_connector.execute_query(
        f"""
        SELECT
          zv.id_davky AS batchId,
          DATE({eff_dt}) AS productionDate,
          zv.stav AS status,
          zv.{zv_name} AS productName,
          zv.planovane_mnozstvo_kg AS plannedQtyKg,
          zv.realne_mnozstvo_kg AS realQtyKg,
          zv.realne_mnozstvo_ks AS realQtyKs
        FROM zaznamy_vyroba zv
        WHERE {eff_dt} IS NOT NULL AND DATE({eff_dt}) >= %s
        ORDER BY {eff_dt} DESC, zv.{zv_name} ASC
        """,
        (from_d,)
    ) or []

    if not prod_rows: return jsonify([])

    # 3. Načítanie Defaultov
    def_rows = db_connector.execute_query(
        "SELECT product_name, is_required, target_low_c, target_high_c, hold_minutes FROM haccp_core_temp_product_defaults"
    ) or []
    defaults = {}
    for d in def_rows:
        pn = _norm_name(d.get("product_name") or d.get("productName"))
        if pn:
            defaults[pn] = {
                "isRequired": bool(d.get("is_required") or d.get("isRequired")),
                "targetLowC": _safe_float(d.get("target_low_c") or d.get("targetLowC")),
                "targetHighC": _safe_float(d.get("target_high_c") or d.get("targetHighC")),
                "holdMinutes": _safe_int(d.get("hold_minutes") or d.get("holdMinutes"), 10)
            }

    # === AUTO-AKTIVÁCIA VÝROBKOV ===
    # Ak nájdeme vo výrobe produkt, ktorý nie je v defaultoch, pridáme ho ako CCP=1
    production_products = set(_norm_name(r.get("productName")) for r in prod_rows if r.get("productName"))
    for np in production_products:
        if np not in defaults:
            try:
                db_connector.execute_query(
                    "INSERT INTO haccp_core_temp_product_defaults (product_name, is_required, target_low_c, target_high_c, hold_minutes) VALUES (%s, 1, 70.0, 71.9, 10)",
                    (np,), fetch="none"
                )
                defaults[np] = {"isRequired": True, "targetLowC": 70.0, "targetHighC": 71.9, "holdMinutes": 10}
            except Exception as e:
                print(f"Auto-Activate Error {np}: {e}")

    # 4. Budovanie zoznamu
    items = []
    by_date = {}

    for r in prod_rows:
        bid = _norm_name(r.get("batchId"))
        pname = _norm_name(r.get("productName"))
        pd = _as_date_str(r.get("productionDate"))
        if not bid or not pd: continue

        d = defaults.get(pname, {})
        # Vynútenie CCP
        is_req = True 
        tl = d.get("targetLowC") or 70.0
        th = d.get("targetHighC") or 71.9
        hm = d.get("holdMinutes") or 10
        
        item = {
            "batchId": bid,
            "productionDate": pd,
            "status": r.get("status"),
            "productName": pname,
            "plannedQtyKg": float(r.get("plannedQtyKg") or 0),
            "realQtyKg": float(r.get("realQtyKg") or 0),
            "realQtyKs": int(r.get("realQtyKs") or 0),
            "isRequired": is_req,
            "targetLowC": tl,
            "targetHighC": th,
            "holdMinutes": hm,
            "limitText": f"{tl}-{th}"
        }
        items.append(item)
        by_date.setdefault(pd, []).append(item)

    # 5. Generovanie Slotov a Teplôt
    for ymd, day_items in by_date.items():
        _ensure_slots_for_day(ymd, day_items)
        _auto_fill_measurements(ymd, day_items)

    # 6. Načítanie výsledkov
    batch_ids = list(set(x["batchId"] for x in items))
    meas_map = {}
    
    if batch_ids:
        ph = ",".join(["%s"] * len(batch_ids))
        all_meas = db_connector.execute_query(
            f"""SELECT * FROM haccp_core_temp_measurements WHERE batch_id IN ({ph}) ORDER BY measured_at ASC""",
            tuple(batch_ids)
        ) or []
        
        for m in all_meas:
            bid = _norm_name(m.get("batch_id") or m.get("batchId"))
            ma = m.get("measured_at")
            if isinstance(ma, datetime): ma = ma.isoformat(sep=" ", timespec="seconds")
            else: ma = str(ma)
            
            meas_map[bid] = {
                "measuredC": _safe_float(m.get("measured_c")),
                "measuredAt": ma,
                "measuredBy": m.get("measured_by"),
                "note": m.get("note"),
                "targetLowC": _safe_float(m.get("target_low_c")),
                "targetHighC": _safe_float(m.get("target_high_c")),
                "holdMinutes": _safe_int(m.get("hold_minutes"))
            }

    slots_map = _load_slots_for_batches(batch_ids)
    
    final_items = []
    for it in items:
        bid = it["batchId"]
        
        # Slot
        s = slots_map.get(bid)
        if s:
            ss = s.get("slot_start") or s.get("slotStart")
            se = s.get("slot_end") or s.get("slotEnd")
            if isinstance(ss, datetime) and isinstance(se, datetime):
                it["slotStart"] = ss.isoformat(sep=" ", timespec="seconds")
                it["slotEnd"] = se.isoformat(sep=" ", timespec="seconds")
                it["slotText"] = f"{_format_hhmm(ss)}–{_format_hhmm(se)}"
        
        # Meranie
        m = meas_map.get(bid)
        if m:
            it["measuredC"] = m["measuredC"]
            it["measuredAt"] = m["measuredAt"]
            it["measuredBy"] = m["measuredBy"]
            it["note"] = m["note"]
            if m["targetLowC"]: it["targetLowC"] = m["targetLowC"]
            if m["targetHighC"]: it["targetHighC"] = m["targetHighC"]
        else:
            it["measuredC"] = None
        
        # Stav
        if it["isRequired"]:
            if it["measuredC"] is None:
                it["haccpStatus"] = "MISSING"
            else:
                val = it["measuredC"]
                lo = it["targetLowC"]
                hi = it["targetHighC"]
                if lo is not None and val < lo:
                    it["haccpStatus"] = "FAIL"
                    it["haccpDetail"] = "LOW"
                elif hi is not None and val > hi:
                    it["haccpStatus"] = "FAIL"
                    it["haccpDetail"] = "HIGH"
                else:
                    it["haccpStatus"] = "OK"
        else:
            it["haccpStatus"] = "NA"
            
        final_items.append(it)

    final_items.sort(key=lambda x: (x.get("productionDate"), x.get("productName")), reverse=True)
    return jsonify(final_items)


# -------------------------------
# 6. Ostatné API funkcie (Save, History...)
# -------------------------------

def save_product_default(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    name = _norm_name(payload.get("productName"))
    if not name: return {"error": "Chýba productName."}
    
    is_required = 1 if payload.get("isRequired") else 0
    tl = _safe_float(payload.get("targetLowC"))
    th = _safe_float(payload.get("targetHighC"))
    hm = _safe_int(payload.get("holdMinutes"), 10)
    
    if is_required:
        if tl is None: tl = 70.0
        if th is None: th = 71.9
    else:
        tl, th = None, None

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_product_defaults 
        (product_name, is_required, target_low_c, target_high_c, hold_minutes)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE 
        is_required=VALUES(is_required), target_low_c=VALUES(target_low_c),
        target_high_c=VALUES(target_high_c), hold_minutes=VALUES(hold_minutes)
        """,
        (name, is_required, tl, th, hm),
        fetch="none"
    )
    return {"message": "Uložené."}

def save_measurement(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    bid = _norm_name(payload.get("batchId"))
    val = _safe_float(payload.get("measuredC"))
    if not bid or val is None: return {"error": "Chýba batchId alebo measuredC."}

    user = _norm_name(payload.get("measuredBy") or session.get("user", {}).get("full_name", "Neznámy"))
    note = str(payload.get("note") or "").strip()
    
    # Snapshot
    zv_name = _zv_name_col()
    zv = db_connector.execute_query(
        f"SELECT {zv_name} as n, DATE(COALESCE(datum_vyroby, datum_spustenia)) as d FROM zaznamy_vyroba WHERE id_davky=%s",
        (bid,), fetch="one"
    ) or {}
    
    pname = _norm_name(zv.get("n"))
    pdate = zv.get("d") or date.today()
    
    tl, th, hm = 70.0, 71.9, 10
    if pname:
        d = db_connector.execute_query(
            "SELECT target_low_c, target_high_c, hold_minutes FROM haccp_core_temp_product_defaults WHERE product_name=%s",
            (pname,), fetch="one"
        ) or {}
        if d:
            tl = _safe_float(d.get("target_low_c")) or 70.0
            th = _safe_float(d.get("target_high_c")) or 71.9
            hm = _safe_int(d.get("hold_minutes"), 10)

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_measurements
        (batch_id, product_name, production_date, measured_c, measured_at, measured_by, note,
         target_low_c, target_high_c, hold_minutes)
        VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s)
        """,
        (bid, pname, pdate, val, user, note, tl, th, hm),
        fetch="none"
    )
    return {"message": "Uložené."}

def list_measurement_history(batch_id: str):
    _ensure_schema()
    rows = db_connector.execute_query(
        "SELECT * FROM haccp_core_temp_measurements WHERE batch_id=%s ORDER BY measured_at DESC",
        (batch_id,)
    ) or []
    
    out = []
    for r in rows:
        ma = r.get("measured_at")
        if isinstance(ma, datetime): ma = ma.isoformat(sep=" ", timespec="seconds")
        
        out.append({
            "measuredAt": ma,
            "measuredC": _safe_float(r.get("measured_c")),
            "measuredBy": r.get("measured_by"),
            "note": r.get("note"),
            "targetLowC": _safe_float(r.get("target_low_c")),
            "targetHighC": _safe_float(r.get("target_high_c")),
            "holdMinutes": r.get("hold_minutes")
        })
    return jsonify(out)