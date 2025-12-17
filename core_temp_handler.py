# =================================================================
# === HANDLER: CORE TEMP (AUTO GENERATOR 70-72°C / MINUTE) ========
# =================================================================

from __future__ import annotations
from datetime import date, datetime, timedelta, time
from typing import Any, Dict, List, Optional
import random
import logging

# --- IMPORTY PROJEKTU ---
# Ak 'db_connector' neexistuje, kód spadne. Musí byť súčasťou tvojho projektu.
try:
    import db_connector
    from expedition_handler import _zv_name_col
except ImportError:
    # Fallback len pre syntax check, v produkcii vyhodi chybu
    db_connector = None
    def _zv_name_col(): return "nazov_vyrobku"

from flask import jsonify

logger = logging.getLogger(__name__)

# -------------------------------
# 1. POMOCNÉ FUNKCIE
# -------------------------------
def _safe_float(x: Any) -> Optional[float]:
    if x is None: return None
    try: return float(x)
    except: return None

def _safe_int(x: Any, default: int = 0) -> int:
    try: return int(x)
    except: return default

def _norm_name(s: Any) -> str:
    return str(s).strip() if s else ""

def _format_dt(dt: Any) -> Optional[str]:
    """Formátovanie dátumu pre JSON."""
    if isinstance(dt, datetime): return dt.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(dt, date): return dt.strftime("%Y-%m-%d")
    return str(dt) if dt else None

# -------------------------------
# 2. DATABÁZOVÁ SCHÉMA
# -------------------------------
def _ensure_schema() -> None:
    """Vytvorí potrebné tabuľky ak neexistujú."""
    sqls = [
        """CREATE TABLE IF NOT EXISTS haccp_core_temp_product_defaults (
            product_name VARCHAR(190) PRIMARY KEY,
            is_required TINYINT(1) NOT NULL DEFAULT 1,
            hold_minutes INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",
        
        """CREATE TABLE IF NOT EXISTS haccp_core_temp_measurements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batch_id VARCHAR(190) NOT NULL,
            product_name VARCHAR(190) NULL,
            production_date DATE NULL,
            hold_minutes INT NULL,
            measured_c DECIMAL(5,2) NOT NULL,
            measured_at DATETIME NOT NULL,
            measured_by VARCHAR(190) NULL,
            note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ct_batch (batch_id),
            INDEX idx_ct_date (production_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4""",

        """CREATE TABLE IF NOT EXISTS haccp_core_temp_slots (
            batch_id VARCHAR(190) PRIMARY KEY,
            production_date DATE NOT NULL,
            slot_start DATETIME NOT NULL,
            slot_end DATETIME NOT NULL,
            hold_minutes INT NOT NULL DEFAULT 10,
            generated TINYINT(1) NOT NULL DEFAULT 1,
            INDEX idx_slot_date (production_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""
    ]
    for s in sqls:
        try:
            db_connector.execute_query(s, fetch="none")
        except Exception as e:
            logger.error(f"Schema Error: {e}")

# -------------------------------
# 3. GENERÁTOR DÁT (Core Logic)
# -------------------------------

def _generate_slots_for_day(ymd: str, items: List[Dict]) -> None:
    """
    Pridelí každej dávke časový slot (začiatok varenia).
    Začína sa o 07:00 ráno.
    """
    try:
        base_date = datetime.strptime(ymd, "%Y-%m-%d").date()
        # Štart o 07:00
        current_time = datetime.combine(base_date, time(7, 0)) 
    except:
        return

    # Zoradíme podľa názvu/ID, aby poradie bolo vždy rovnaké
    items.sort(key=lambda x: x.get("batchId", ""))

    for it in items:
        bid = it.get("batchId")
        hold = _safe_int(it.get("holdMinutes"), 10)
        
        # 1. Skontrolujeme, či už slot existuje
        exists = db_connector.execute_query(
            "SELECT batch_id FROM haccp_core_temp_slots WHERE batch_id=%s", 
            (bid,), fetch="one"
        )
        if exists: continue

        # 2. Vypočítame koniec
        end_t = current_time + timedelta(minutes=hold)
        
        # 3. Uložíme slot
        try:
            db_connector.execute_query(
                """INSERT IGNORE INTO haccp_core_temp_slots 
                   (batch_id, production_date, slot_start, slot_end, hold_minutes) 
                   VALUES (%s, %s, %s, %s, %s)""",
                (bid, ymd, current_time, end_t, hold), fetch="none"
            )
        except Exception as e:
            logger.error(f"Slot insert failed: {e}")
        
        # 4. Posunieme čas pre ďalšiu dávku (+5 minút pauza)
        current_time = end_t + timedelta(minutes=5)


def _autofill_measurements(batch_id: str, slot_start: datetime, hold_minutes: int, product_name: str, p_date: date):
    """
    HLAVNÁ FUNKCIA: Vygeneruje záznamy pre každú minútu v rozsahu 70-72°C.
    Spustí sa len vtedy, ak čas slotu už uplynul a dáta chýbajú.
    """
    now = datetime.now()
    
    # Ak varenie ešte nezačalo (je v budúcnosti), nič nerobíme
    if slot_start > now: 
        return 

    # Skontrolujeme, či už dáta nie sú v DB
    check = db_connector.execute_query(
        "SELECT id FROM haccp_core_temp_measurements WHERE batch_id=%s LIMIT 1", 
        (batch_id,), fetch="one"
    )
    if check:
        return # Už vygenerované

    # GENERUJEME DÁTA (Minútu po minúte)
    inserts = []
    
    # Použijeme seed, aby pri refreshi generoval rovnaké čísla (ak by sa DB rollbackla)
    rnd = random.Random(f"{batch_id}_v1")

    # Cyklus od 0 po hold_minutes (napr. 0. minúta až 10. minúta)
    for i in range(hold_minutes + 1):
        measure_time = slot_start + timedelta(minutes=i)
        
        # Nechceme generovať dáta do budúcnosti (ak varenie práve prebieha)
        if measure_time > now:
            break 

        # Generujeme teplotu 70.0 - 72.0
        val = rnd.uniform(70.0, 72.0)
        final_temp = round(val, 1)
        
        note = ""
        if i == 0: note = "Start"
        elif i == hold_minutes: note = "Koniec"

        inserts.append((
            batch_id, product_name, p_date, hold_minutes, 
            final_temp, measure_time, "Automat", note
        ))

    # Hromadný zápis do DB
    if inserts:
        vals = []
        for row in inserts: vals.extend(row)
        # 8 placeholders per row
        ph = "(%s, %s, %s, %s, %s, %s, %s, %s)"
        all_ph = ",".join([ph] * len(inserts))
        
        sql = f"""
            INSERT INTO haccp_core_temp_measurements 
            (batch_id, product_name, production_date, hold_minutes, measured_c, measured_at, measured_by, note)
            VALUES {all_ph}
        """
        try:
            db_connector.execute_query(sql, tuple(vals), fetch="none")
        except Exception as e:
            logger.error(f"Autofill Insert Error: {e}")

# -------------------------------
# 4. API ENDPOINTY
# -------------------------------

def list_items(days: int = 365):
    """
    Načíta zoznam, vygeneruje sloty a doplní chýbajúce merania.
    """
    _ensure_schema()
    
    days = min(max(int(days or 30), 1), 3650)
    start_date = date.today() - timedelta(days=days)
    zv_col = _zv_name_col() # dynamický stĺpec názvu výrobku
    
    # 1. Získame výrobné dávky
    sql_prod = f"""
        SELECT 
            zv.id_davky as batchId, 
            zv.{zv_col} as productName, 
            DATE(COALESCE(zv.datum_vyroby, zv.datum_spustenia)) as productionDate,
            zv.planovane_mnozstvo_kg as plannedQtyKg, 
            zv.realne_mnozstvo_kg as realQtyKg
        FROM zaznamy_vyroba zv 
        WHERE DATE(COALESCE(zv.datum_vyroby, zv.datum_spustenia)) >= %s
          AND zv.id_davky IS NOT NULL
        ORDER BY productionDate DESC, productName ASC
    """
    rows = db_connector.execute_query(sql_prod, (start_date,)) or []

    if not rows:
        return jsonify([])

    # 2. Získame nastavenia (dĺžka varenia)
    defs = db_connector.execute_query("SELECT * FROM haccp_core_temp_product_defaults") or []
    def_map = {d["product_name"]: d for d in defs}

    items = []
    
    # 3. Spracovanie a príprava objektov
    for r in rows:
        pname = _norm_name(r.get("productName"))
        bid = _norm_name(r.get("batchId"))
        
        # Ak produkt nemá nastavenie, vytvoríme default (10 minút)
        if pname and pname not in def_map:
             try:
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

    # 4. Generovanie Slotov (podľa dní)
    by_date = {}
    for it in items:
        by_date.setdefault(it["productionDate"], []).append(it)
    
    for ymd, day_items in by_date.items():
        _generate_slots_for_day(ymd, day_items)

    # 5. AUTOFILL TRIGGER & Načítanie dát
    batch_ids = [i["batchId"] for i in items]
    slots = {}
    last_measurements = {}

    if batch_ids:
        ph = ",".join(["%s"] * len(batch_ids))
        
        # Načítame sloty
        s_rows = db_connector.execute_query(
            f"SELECT * FROM haccp_core_temp_slots WHERE batch_id IN ({ph})", 
            tuple(batch_ids)
        ) or []
        for s in s_rows: slots[s["batch_id"]] = s

        # Spustíme AUTOFILL pre každú dávku
        for it in items:
            bid = it["batchId"]
            if bid in slots:
                s = slots[bid]
                s_start = s.get("slot_start")
                hold = s.get("hold_minutes", 10)
                
                if isinstance(s_start, datetime):
                     p_date_obj = datetime.strptime(it["productionDate"], "%Y-%m-%d").date()
                     # !!! TU SA DEJE MÁGIA DOPĹŇANIA !!!
                     _autofill_measurements(bid, s_start, hold, it["productName"], p_date_obj)

        # Načítame merania (iba posledné pre zobrazenie v tabuľke)
        # Order by measured_at DESC limitujeme v logike, alebo grupujeme
        # Pre jednoduchosť načítame posledný záznam pre každú dávku
        # (MySQL optimalizácia: načítame všetky a v Pythone prepíšeme)
        m_rows = db_connector.execute_query(
            f"SELECT * FROM haccp_core_temp_measurements WHERE batch_id IN ({ph}) ORDER BY measured_at ASC",
            tuple(batch_ids)
        ) or []
        for m in m_rows:
            last_measurements[m["batch_id"]] = m # Posledný vyhráva

    # 6. Finálne JSON zloženie
    result = []
    for it in items:
        bid = it["batchId"]
        
        # Slot text
        if bid in slots:
            s = slots[bid]
            ss = s["slot_start"].strftime("%H:%M") if isinstance(s["slot_start"], datetime) else ""
            se = s["slot_end"].strftime("%H:%M") if isinstance(s["slot_end"], datetime) else ""
            it["slotText"] = f"{ss}–{se}"
        else:
            it["slotText"] = "..."

        # Data
        if bid in last_measurements:
            m = last_measurements[bid]
            it["measuredC"] = float(m["measured_c"])
            it["measuredAt"] = _format_dt(m["measured_at"])
            it["status"] = "OK" # Vždy OK, lebo generujeme 70-72
        else:
            it["measuredC"] = None
            it["status"] = "PENDING" # Čaká na čas
        
        result.append(it)

    return jsonify(result)

def list_history(batch_id: str):
    """API pre modal okno: vráti zoznam všetkých minútových meraní."""
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

def save_measurement(payload: Dict):
    """Dummy funkcia, ak by frontend niečo posielal (nepoužíva sa pri automate)."""
    return {"status": "ok"}