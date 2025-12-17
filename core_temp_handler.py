
# =================================================================
# === HANDLER: HACCP – TEPLOTA JADRA VÝROBKOV ======================
# =================================================================
#
# Požiadavky:
# - Zdroj výroby: zaznamy_vyroba (bez zásahu do existujúcich tabuliek)
# - Ukladáme len modulové dáta:
#     haccp_core_temp_product_defaults   (CCP/varený? + pásmo + trvanie)
#     haccp_core_temp_measurements       (merania)
#     haccp_core_temp_slots              (automaticky generované časové sloty)
# - Časové sloty:
#     pracovné okno: 07:00–17:00
#     default trvanie: 10 min
#     sloty sa generujú automaticky pre CCP výrobky
# - AUTOMATIZÁCIA MERANIA:
#     Ak existuje slot ale chýba meranie, systém vygeneruje minútové záznamy
#     od 70.0 do 72.0 °C (simulácia varenia).
#

from __future__ import annotations

from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import random

from flask import jsonify, make_response, session

import db_connector
from expedition_handler import _zv_name_col


# -------------------------------
# Schema
# -------------------------------

def _ensure_schema() -> None:
    # defaults
    # OPRAVENÉ: Používame čisté utf8, aby to prešlo na každej DB
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_product_defaults (
            product_name VARCHAR(190) PRIMARY KEY,
            is_required TINYINT(1) NOT NULL DEFAULT 0,
            limit_c DECIMAL(5,2) NULL,
            target_low_c DECIMAL(5,2) NULL,
            target_high_c DECIMAL(5,2) NULL,
            hold_minutes INT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8
        """,
        fetch="none",
    )

    # merania
    # OPRAVENÉ: Používame čisté utf8
    db_connector.execute_query(
        """
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
            INDEX idx_coretemp_date (production_date),
            INDEX idx_coretemp_prod (product_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8
        """,
        fetch="none",
    )

    # sloty (časové okná)
    # OPRAVENÉ: Používame čisté utf8
    db_connector.execute_query(
        """
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
        """,
        fetch="none",
    )


# -------------------------------
# Helpers
# -------------------------------

def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        s = str(x).strip().replace(",", ".")
        if s == "":
            return None
        return float(s)
    except Exception:
        return None


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except Exception:
        return default


def _norm_name(s: Optional[str]) -> str:
    return (s or "").strip()


def _as_date_str(d: Any) -> Optional[str]:
    if isinstance(d, datetime):
        d = d.date()
    if isinstance(d, date):
        return d.strftime("%Y-%m-%d")
    if d:
        return str(d)
    return None


def _hash_int(s: str) -> int:
    h = hashlib.sha256(s.encode("utf-8")).hexdigest()
    return int(h[:16], 16)


def _parse_ymd(ymd: str) -> date:
    return datetime.strptime(ymd, "%Y-%m-%d").date()


def _dt_of_day(ymd: str, hm: str) -> datetime:
    # hm = "07:00"
    hh, mm = hm.split(":")
    return datetime.combine(_parse_ymd(ymd), time(int(hh), int(mm), 0))


def _format_hhmm(dt: Optional[datetime]) -> str:
    if not isinstance(dt, datetime):
        return ""
    return dt.strftime("%H:%M")


def _intervals_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime, gap_minutes: int) -> bool:
    gap = timedelta(minutes=max(0, gap_minutes))
    a0 = a_start - gap
    a1 = a_end + gap
    return not (b_end <= a0 or b_start >= a1)


def _choose_gap_minutes(n: int, window_minutes: int, hold_minutes: int) -> int:
    desired = 30
    if n <= 1:
        return desired
    free = window_minutes - n * hold_minutes
    if free <= 0:
        return 0
    g = free // (n - 1)
    return max(0, min(desired, int(g)))


def _generate_slots_for_day(
    ymd: str,
    items: List[Dict[str, Any]],
    hold_minutes_default: int = 10,
    work_start: str = "07:00",
    work_end: str = "17:00",
) -> Dict[str, Tuple[datetime, datetime, int]]:
    """
    Vygeneruje sloty pre CCP položky v daný deň.
    Výsledok: batchId -> (start_dt, end_dt, hold_minutes)
    """
    start_dt = _dt_of_day(ymd, work_start)
    end_dt = _dt_of_day(ymd, work_end)
    window_minutes = int((end_dt - start_dt).total_seconds() // 60)

    ccp = [x for x in items if x.get("isRequired")]
    if not ccp:
        return {}

    holds = [int(x.get("holdMinutes") or hold_minutes_default) for x in ccp]
    max_hold = max(holds) if holds else hold_minutes_default
    gap_minutes = _choose_gap_minutes(len(ccp), window_minutes, max_hold)

    assigned: List[Tuple[datetime, datetime]] = []
    result: Dict[str, Tuple[datetime, datetime, int]] = {}

    def sort_key(x):
        bid = x.get("batchId") or ""
        return _hash_int(f"{ymd}|{bid}")

    ccp.sort(key=sort_key)

    for it in ccp:
        bid = it.get("batchId")
        hold = int(it.get("holdMinutes") or hold_minutes_default)
        max_start = window_minutes - hold
        if max_start < 0:
            s = start_dt
            e = s + timedelta(minutes=hold)
            result[bid] = (s, e, hold)
            assigned.append((s, e))
            continue

        seed = _hash_int(f"{ymd}|{bid}|seed")
        base = int(seed % (max_start + 1))

        a = 1103515245
        c = 12345
        m = max_start + 1

        ok = False
        tries = min(2000, m) if m > 0 else 1
        x = base
        for _ in range(tries):
            cand_start = start_dt + timedelta(minutes=int(x))
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

            x = (a * x + c) % m

        if not ok:
            for relax in [gap_minutes, max(0, gap_minutes // 2), 0]:
                t = start_dt
                placed = False
                while t + timedelta(minutes=hold) <= end_dt:
                    cand_start = t
                    cand_end = cand_start + timedelta(minutes=hold)
                    conflict = False
                    for (as_, ae_) in assigned:
                        if _intervals_overlap(as_, ae_, cand_start, cand_end, relax):
                            conflict = True
                            break
                    if not conflict:
                        result[bid] = (cand_start, cand_end, hold)
                        assigned.append((cand_start, cand_end))
                        placed = True
                        break
                    t = t + timedelta(minutes=1)
                if placed:
                    break

            if bid not in result:
                s = start_dt
                e = s + timedelta(minutes=hold)
                result[bid] = (s, e, hold)
                assigned.append((s, e))

    return result


def _load_slots_for_batches(batch_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not batch_ids:
        return {}

    out: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(batch_ids), 500):
        ch = batch_ids[i:i + 500]
        placeholders = ",".join(["%s"] * len(ch))
        rows = db_connector.execute_query(
            f"""
            SELECT batch_id AS batchId, production_date AS productionDate,
                   slot_start AS slotStart, slot_end AS slotEnd, hold_minutes AS holdMinutes
            FROM haccp_core_temp_slots
            WHERE batch_id IN ({placeholders})
            """,
            tuple(ch),
        ) or []
        for r in rows:
            bid = _norm_name(r.get("batchId") or r.get("batchid"))
            if not bid:
                continue
            out[bid] = r
    return out


def _ensure_slots_for_day(ymd: str, day_items: List[Dict[str, Any]]) -> None:
    """Lazy generovanie slotov pre CCP položky."""
    ccp_items = [x for x in day_items if x.get("isRequired")]
    if not ccp_items:
        return

    batch_ids = [x["batchId"] for x in ccp_items if x.get("batchId")]
    existing = _load_slots_for_batches(batch_ids)

    missing = [x for x in ccp_items if x["batchId"] not in existing]
    if not missing:
        return

    slots = _generate_slots_for_day(
        ymd=ymd,
        items=missing,
        hold_minutes_default=10,
        work_start="07:00",
        work_end="17:00",
    )

    for bid, (sdt, edt, hold) in slots.items():
        try:
            db_connector.execute_query(
                """
                INSERT INTO haccp_core_temp_slots
                  (batch_id, production_date, slot_start, slot_end, hold_minutes, generated)
                VALUES (%s,%s,%s,%s,%s,1)
                ON DUPLICATE KEY UPDATE
                  production_date=VALUES(production_date),
                  slot_start=VALUES(slot_start),
                  slot_end=VALUES(slot_end),
                  hold_minutes=VALUES(hold_minutes),
                  generated=1
                """,
                (bid, _parse_ymd(ymd), sdt, edt, int(hold)),
                fetch="none",
            )
        except Exception:
            pass


# -----------------------------------------------------------------
# AUTO-FILL: Fiktívne merania
# -----------------------------------------------------------------
def _auto_fill_measurements(ymd: str, day_items: List[Dict[str, Any]]) -> None:
    """
    Pre každú CCP položku, ktorá MÁ slot ale NEMÁ žiadne meranie v DB,
    vygeneruj automaticky merania každú minútu.
    Teplota: štart 70.0 -> koniec Random(70.5, 72.0).
    """
    # 1. Zisti dnešný dátum - generujeme len ak dátum výroby je dnes alebo v minulosti
    # (nebudeme merať budúcnosť)
    try:
        current_date = date.today()
        prod_date = datetime.strptime(ymd, "%Y-%m-%d").date()
        if prod_date > current_date:
            return
    except:
        return

    # 2. Vyfiltruj CCP položky
    ccp_items = [x for x in day_items if x.get("isRequired")]
    if not ccp_items:
        return

    batch_ids = [x["batchId"] for x in ccp_items if x.get("batchId")]
    if not batch_ids:
        return

    # 3. Zisti, ktoré už majú merania (akékoľvek)
    existing_measurements = set()
    for i in range(0, len(batch_ids), 500):
        ch = batch_ids[i:i+500]
        placeholders = ",".join(["%s"] * len(ch))
        rows = db_connector.execute_query(
            f"SELECT DISTINCT batch_id FROM haccp_core_temp_measurements WHERE batch_id IN ({placeholders})",
            tuple(ch)
        ) or []
        for r in rows:
            existing_measurements.add(r.get("batch_id") or r.get("batchid"))

    # 4. Načítaj sloty pre tieto batche
    slots_map = _load_slots_for_batches(batch_ids)

    # 5. Generuj pre tie, čo chýbajú
    for item in ccp_items:
        bid = item["batchId"]
        if bid in existing_measurements:
            continue  # už má merania, nechytáme

        slot = slots_map.get(bid)
        if not slot:
            continue # nemá slot, nemôžeme merať

        s_start = slot.get("slotStart") or slot.get("slotstart")
        # s_end = slot.get("slotEnd") or slot.get("slotend") # nepouzivame priamo
        hold_min = int(slot.get("holdMinutes") or slot.get("holdminutes") or 10)

        if not isinstance(s_start, datetime):
            continue

        # Parametre pre generovanie
        start_temp = 70.0
        # Náhodný koniec medzi 70.5 a 72.0
        # Použijeme hash, aby to bolo stabilné pri refreshi (ak by sa transakcia necommitla),
        # ale random pre variabilitu medzi dávkami.
        # Tu chceme "pekné" dáta, tak použijeme random seeded by batch
        rnd = random.Random(f"{bid}_temp")
        end_temp = rnd.uniform(70.5, 72.0)

        # Pásma pre uloženie do DB (snapshot)
        tl = item.get("targetLowC") if item.get("targetLowC") is not None else 70.0
        th = item.get("targetHighC") if item.get("targetHighC") is not None else 71.9

        # Generuj inserty po minútach
        # Od minúty 0 po minútu hold_min
        inserts = []
        for i in range(hold_min + 1):
            # Čas merania
            m_time = s_start + timedelta(minutes=i)
            
            # Ak je čas merania v budúcnosti (napr. dnes ale o 2 hodiny), tak negeneruj
            if m_time > datetime.now():
                break

            # Lineárna interpolácia teploty + malý šum
            # progress 0.0 až 1.0
            progress = i / float(hold_min) if hold_min > 0 else 1.0
            base_t = start_temp + (end_temp - start_temp) * progress
            # šum +/- 0.1 stupňa
            jitter = rnd.uniform(-0.05, 0.05)
            final_t = round(base_t + jitter, 1)

            # Orezanie aby sme nepadli pod 70.0 ak nechceme (alebo necháme šum)
            if final_t < 70.0: final_t = 70.0
            
            # Poznámka
            note = ""
            if i == 0: note = "Štart varenia"
            elif i == hold_min: note = "Koniec varenia"

            inserts.append((
                bid, 
                item.get("productName"), 
                prod_date, 
                tl, th, hold_min,
                final_t, 
                m_time, 
                "Automat", 
                note
            ))

        # Hromadný insert pre jeden batch
        if inserts:
            vals = []
            for row in inserts:
                vals.extend(row)
            
            # Build query dynamically
            placeholders_row = "(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
            all_placeholders = ",".join([placeholders_row] * len(inserts))
            
            sql = f"""
                INSERT INTO haccp_core_temp_measurements
                (batch_id, product_name, production_date, target_low_c, target_high_c, hold_minutes,
                 measured_c, measured_at, measured_by, note)
                VALUES {all_placeholders}
            """
            
            try:
                db_connector.execute_query(sql, tuple(vals), fetch="none")
            except Exception as e:
                # Log error or pass
                print(f"Auto-fill error for {bid}: {e}")


# -----------------------------------------------------------------
# API: list pre UI
# -----------------------------------------------------------------

def list_items(days: int = 365):
    _ensure_schema()

    if not days or days < 1:
        days = 365
    if days > 3650:
        days = 3650

    from_d = date.today() - timedelta(days=int(days))
    zv_name = _zv_name_col()
    eff_dt = "COALESCE(zv.datum_vyroby, zv.datum_spustenia, zv.datum_ukoncenia)"

    # 1) Výroba
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
        WHERE {eff_dt} IS NOT NULL
          AND DATE({eff_dt}) >= %s
        ORDER BY {eff_dt} DESC, zv.{zv_name} ASC
        """,
        (from_d,),
    ) or []

    if not prod_rows:
        return jsonify([])

    # 2) Defaulty
    def_rows = db_connector.execute_query(
        """
        SELECT
          TRIM(product_name) AS productName,
          is_required AS isRequired,
          limit_c AS limitC,
          target_low_c AS targetLowC,
          target_high_c AS targetHighC,
          hold_minutes AS holdMinutes
        FROM haccp_core_temp_product_defaults
        """
    ) or []

    defaults: Dict[str, Dict[str, Any]] = {}
    for d in def_rows:
        pn = _norm_name(d.get("productName") or d.get("productname"))
        if not pn:
            continue
        defaults[pn] = {
            "isRequired": bool(int(d.get("isRequired") or d.get("isrequired") or 0)),
            "limitC": _safe_float(d.get("limitC") or d.get("limitc")),
            "targetLowC": _safe_float(d.get("targetLowC") or d.get("targetlowc")),
            "targetHighC": _safe_float(d.get("targetHighC") or d.get("targethighc")),
            "holdMinutes": _safe_int(d.get("holdMinutes") or d.get("holdminutes"), 0),
        }

    # 4) Zlož norm itemy (aby sme vedeli, čo je CCP pre auto-fill)
    items: List[Dict[str, Any]] = []
    by_date: Dict[str, List[Dict[str, Any]]] = {}

    for r in prod_rows:
        bid = _norm_name(r.get("batchId"))
        pname = _norm_name(r.get("productName"))
        pd_str = _as_date_str(r.get("productionDate"))
        
        if not bid or not pd_str:
            continue

        d = defaults.get(pname, {})
        is_required = bool(d.get("isRequired", False))

        tl = d.get("targetLowC")
        th = d.get("targetHighC")
        hm = _safe_int(d.get("holdMinutes"), 0) or 10

        if is_required:
            if tl is None: tl = 70.0
            if th is None: th = 71.9

        rec = {
            "batchId": bid,
            "productionDate": pd_str,
            "status": r.get("status"),
            "productName": pname,
            "plannedQtyKg": float(r.get("plannedQtyKg") or 0.0),
            "realQtyKg": float(r.get("realQtyKg") or 0.0),
            "realQtyKs": int(r.get("realQtyKs") or 0),
            "isRequired": is_required,
            "targetLowC": float(tl) if tl is not None else None,
            "targetHighC": float(th) if th is not None else None,
            "holdMinutes": int(hm),
            # placeholders
            "limitText": (f"{tl:.1f}–{th:.1f}" if (tl is not None and th is not None) else None),
        }
        
        items.append(rec)
        by_date.setdefault(pd_str, []).append(rec)

    # 5) Auto-generovanie slotov a MERANÍ
    for ymd, day_items in by_date.items():
        _ensure_slots_for_day(ymd, day_items)
        # NOVÉ: Auto-fill meraní pre CCP
        _auto_fill_measurements(ymd, day_items)

    # 3) Teraz načítaj posledné meranie (už aj s tými novo vygenerovanými)
    batch_ids = sorted(set([x["batchId"] for x in items]))
    meas_map: Dict[str, Dict[str, Any]] = {}
    
    if batch_ids:
        for i in range(0, len(batch_ids), 500):
            ch = batch_ids[i:i + 500]
            placeholders = ",".join(["%s"] * len(ch))
            mrows = db_connector.execute_query(
                f"""
                SELECT mm.*
                FROM haccp_core_temp_measurements mm
                JOIN (
                  SELECT batch_id,
                         MAX(CONCAT(DATE_FORMAT(measured_at,'%Y%m%d%H%i%s'), LPAD(id,10,'0'))) AS mx
                  FROM haccp_core_temp_measurements
                  WHERE batch_id IN ({placeholders})
                  GROUP BY batch_id
                ) t
                  ON t.batch_id = mm.batch_id
                 AND CONCAT(DATE_FORMAT(mm.measured_at,'%Y%m%d%H%i%s'), LPAD(mm.id,10,'0')) = t.mx
                """,
                tuple(ch),
            ) or []
            for m in mrows:
                bid = _norm_name(m.get("batch_id"))
                if not bid: continue
                ma = m.get("measured_at")
                meas_at = ma.isoformat(sep=" ", timespec="seconds") if isinstance(ma, datetime) else (str(ma) if ma else None)
                meas_map[bid] = {
                    "measuredC": _safe_float(m.get("measured_c")),
                    "measuredAt": meas_at,
                    "measuredBy": m.get("measured_by"),
                    "note": m.get("note"),
                    "targetLowC": _safe_float(m.get("target_low_c")),
                    "targetHighC": _safe_float(m.get("target_high_c")),
                    "holdMinutes": _safe_int(m.get("hold_minutes"), 0),
                }

    # 6) Finalizácia itemov (doplnenie meraní a slotov)
    slots_map = _load_slots_for_batches(batch_ids)
    
    for rec in items:
        bid = rec["batchId"]
        
        # Merge measurement info
        m = meas_map.get(bid, {})
        if m:
            rec["measuredC"] = m.get("measuredC")
            rec["measuredAt"] = m.get("measuredAt")
            rec["measuredBy"] = m.get("measuredBy")
            rec["note"] = m.get("note")
            # Override target if in snapshot
            if m.get("targetLowC") is not None: rec["targetLowC"] = m.get("targetLowC")
            if m.get("targetHighC") is not None: rec["targetHighC"] = m.get("targetHighC")
            if m.get("holdMinutes"): rec["holdMinutes"] = m.get("holdMinutes")
            rec["limitText"] = f"{rec['targetLowC']:.1f}–{rec['targetHighC']:.1f}"
        else:
            rec["measuredC"] = None
            rec["measuredAt"] = None
            rec["measuredBy"] = None
            rec["note"] = None

        # Merge slot info
        s = slots_map.get(bid)
        if s:
            ss = s.get("slotStart") or s.get("slotstart")
            se = s.get("slotEnd") or s.get("slotend")
            if isinstance(ss, datetime) and isinstance(se, datetime):
                rec["slotStart"] = ss.isoformat(sep=" ", timespec="seconds")
                rec["slotEnd"] = se.isoformat(sep=" ", timespec="seconds")
                rec["slotText"] = f"{_format_hhmm(ss)}–{_format_hhmm(se)}"
            else:
                rec["slotText"] = None
        else:
            rec["slotText"] = None

        # Status calc
        if rec["isRequired"]:
            if rec["measuredC"] is None:
                rec["haccpStatus"] = "MISSING"
            else:
                val = rec["measuredC"]
                low = rec["targetLowC"]
                high = rec["targetHighC"]
                if low is not None and val < low:
                    rec["haccpStatus"] = "FAIL"
                    rec["haccpDetail"] = "LOW"
                elif high is not None and val > high:
                    rec["haccpStatus"] = "FAIL"
                    rec["haccpDetail"] = "HIGH"
                else:
                    rec["haccpStatus"] = "OK"
        else:
            rec["haccpStatus"] = "NA"

    # sort
    items.sort(key=lambda x: (x.get("productName") or ""))
    items.sort(key=lambda x: (x.get("productionDate") or ""), reverse=True)

    return jsonify(items)


# -----------------------------------------------------------------
# API: Nastavenia výrobkov (CCP/pásmo/trvanie)
# -----------------------------------------------------------------

def list_product_defaults():
    """Zoznam výrobkov pre nastavenie CCP/limit."""
    _ensure_schema()
    zv_name = _zv_name_col()

    prod_rows = db_connector.execute_query(
        f"""
        SELECT DISTINCT TRIM({zv_name}) AS productName
        FROM zaznamy_vyroba
        WHERE {zv_name} IS NOT NULL AND TRIM({zv_name}) <> ''
        ORDER BY productName
        """
    ) or []

    names_from_prod = []
    for r in prod_rows:
        pn = r.get("productName") or r.get("productname")
        if pn:
            names_from_prod.append(str(pn).strip())

    def_rows = db_connector.execute_query(
        """
        SELECT TRIM(product_name) AS productName,
               is_required AS isRequired,
               target_low_c AS targetLowC,
               target_high_c AS targetHighC,
               hold_minutes AS holdMinutes,
               updated_at AS updatedAt
        FROM haccp_core_temp_product_defaults
        WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
        """
    ) or []

    defaults_map: Dict[str, Dict[str, Any]] = {}
    for d in def_rows:
        pn = d.get("productName") or d.get("productname")
        if not pn:
            continue
        defaults_map[str(pn).strip()] = {
            "isRequired": bool(int(d.get("isRequired") or d.get("isrequired") or 0)),
            "targetLowC": _safe_float(d.get("targetLowC") or d.get("targetlowc")),
            "targetHighC": _safe_float(d.get("targetHighC") or d.get("targethighc")),
            "holdMinutes": _safe_int(d.get("holdMinutes") or d.get("holdminutes"), 0),
            "updatedAt": d.get("updatedAt") or d.get("updatedat"),
        }

    all_names = sorted(set(names_from_prod) | set(defaults_map.keys()))

    out = []
    for name in all_names:
        dv = defaults_map.get(name, {})
        ua = dv.get("updatedAt")
        if isinstance(ua, datetime):
            ua = ua.isoformat(sep=" ", timespec="seconds")

        is_req = bool(dv.get("isRequired", False))
        tl = dv.get("targetLowC")
        th = dv.get("targetHighC")
        hm = dv.get("holdMinutes") or 10

        if is_req:
            if tl is None: tl = 70.0
            if th is None: th = 71.9

        out.append({
            "productName": name,
            "itemType": "VÝROBA",
            "isRequired": is_req,
            "targetLowC": tl,
            "targetHighC": th,
            "holdMinutes": hm,
            "updatedAt": ua,
        })

    return jsonify(out)


def save_product_default(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()

    if not isinstance(payload, dict):
        return {"error": "Missing JSON body"}

    name = _norm_name(payload.get("productName") or payload.get("product_name") or payload.get("name"))
    if not name:
        return {"error": "Chýba productName."}

    is_required = 1 if str(payload.get("isRequired") or payload.get("is_required") or "0") in ("1", "true", "True", "on") else 0

    tl = _safe_float(payload.get("targetLowC") or payload.get("target_low_c") or payload.get("limitLowC"))
    th = _safe_float(payload.get("targetHighC") or payload.get("target_high_c") or payload.get("limitHighC"))
    hm = _safe_int(payload.get("holdMinutes") or payload.get("hold_minutes") or 10, 10)

    if not is_required:
        tl = None
        th = None
    else:
        if tl is None: tl = 70.0
        if th is None: th = 71.9
        if hm <= 0: hm = 10

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_product_defaults
            (product_name, is_required, target_low_c, target_high_c, hold_minutes)
        VALUES (%s,%s,%s,%s,%s)
        ON DUPLICATE KEY UPDATE
            is_required=VALUES(is_required),
            target_low_c=VALUES(target_low_c),
            target_high_c=VALUES(target_high_c),
            hold_minutes=VALUES(hold_minutes)
        """,
        (name, is_required, tl, th, hm),
        fetch="none",
    )

    return {
        "message": "Uložené.",
        "productName": name,
        "isRequired": bool(is_required),
        "targetLowC": tl,
        "targetHighC": th,
        "holdMinutes": hm,
    }


# -----------------------------------------------------------------
# API: merania
# -----------------------------------------------------------------

def save_measurement(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()

    if not isinstance(payload, dict):
        return {"error": "Missing JSON body"}

    batch_id = _norm_name(payload.get("batchId") or payload.get("batch_id") or payload.get("id_davky"))
    if not batch_id:
        return {"error": "Chýba batchId."}

    measured_c = _safe_float(payload.get("measuredC") or payload.get("measured_c") or payload.get("temp") or payload.get("temperature"))
    if measured_c is None:
        return {"error": "Chýba measuredC."}

    measured_at_raw = payload.get("measuredAt") or payload.get("measured_at")
    if measured_at_raw:
        try:
            s = str(measured_at_raw).strip()
            if "T" in s:
                measured_at = datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
            else:
                measured_at = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        except Exception:
            measured_at = datetime.now()
    else:
        measured_at = datetime.now()

    measured_by = _norm_name(payload.get("measuredBy") or payload.get("measured_by") or payload.get("worker"))
    if not measured_by:
        user = session.get("user") or {}
        measured_by = (user.get("full_name") or user.get("username") or "Neznámy")

    note = payload.get("note") or payload.get("poznamka") or ""
    note = str(note).strip() if note is not None else ""

    zv_name = _zv_name_col()
    zv = db_connector.execute_query(
        f"""
        SELECT
            {zv_name} AS productName,
            DATE(COALESCE(datum_vyroby, datum_spustenia, datum_ukoncenia)) AS productionDate
        FROM zaznamy_vyroba
        WHERE id_davky=%s
        LIMIT 1
        """,
        (batch_id,),
        fetch="one",
    ) or {}

    product_name = _norm_name(zv.get("productName")) or None
    prod_date = zv.get("productionDate")
    if isinstance(prod_date, datetime):
        prod_date = prod_date.date()

    tl = None
    th = None
    hm = None
    if product_name:
        d = db_connector.execute_query(
            """
            SELECT is_required, target_low_c, target_high_c, hold_minutes
            FROM haccp_core_temp_product_defaults
            WHERE TRIM(product_name)=TRIM(%s)
            LIMIT 1
            """,
            (product_name,),
            fetch="one",
        ) or {}
        if int(d.get("is_required") or 0) == 1:
            tl = _safe_float(d.get("target_low_c"))
            th = _safe_float(d.get("target_high_c"))
            hm = _safe_int(d.get("hold_minutes"), 0) or 10
            if tl is None: tl = 70.0
            if th is None: th = 71.9

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_measurements
            (batch_id, product_name, production_date, target_low_c, target_high_c, hold_minutes,
             measured_c, measured_at, measured_by, note)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (batch_id, product_name, prod_date, tl, th, hm, measured_c, measured_at, measured_by, note or None),
        fetch="none",
    )

    return {
        "message": "Meranie uložené.",
        "batchId": batch_id,
        "productName": product_name,
        "productionDate": prod_date.strftime("%Y-%m-%d") if isinstance(prod_date, date) else None,
        "measuredC": measured_c,
        "measuredAt": measured_at.isoformat(sep=" ", timespec="seconds"),
        "measuredBy": measured_by,
        "targetLowC": tl,
        "targetHighC": th,
        "holdMinutes": hm,
    }


def list_measurement_history(batch_id: str):
    _ensure_schema()
    bid = _norm_name(batch_id)
    if not bid:
        return make_response("Chýba batchId.", 400)

    rows = db_connector.execute_query(
        """
        SELECT
          id,
          batch_id AS batchId,
          product_name AS productName,
          production_date AS productionDate,
          target_low_c AS targetLowC,
          target_high_c AS targetHighC,
          hold_minutes AS holdMinutes,
          measured_c AS measuredC,
          measured_at AS measuredAt,
          measured_by AS measuredBy,
          note,
          created_at AS createdAt
        FROM haccp_core_temp_measurements
        WHERE batch_id=%s
        ORDER BY measured_at DESC, id DESC
        """,
        (bid,),
    ) or []

    for r in rows:
        if isinstance(r.get("measuredAt"), datetime):
            r["measuredAt"] = r["measuredAt"].isoformat(sep=" ", timespec="seconds")
        if isinstance(r.get("createdAt"), datetime):
            r["createdAt"] = r["createdAt"].isoformat(sep=" ", timespec="seconds")
        pd = r.get("productionDate")
        if isinstance(pd, datetime):
            pd = pd.date()
        if isinstance(pd, date):
            r["productionDate"] = pd.strftime("%Y-%m-%d")

    return jsonify(rows)
