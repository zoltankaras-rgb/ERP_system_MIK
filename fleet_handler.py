# =================================================================
# === HANDLER PRE MODUL: SPRÁVA VOZOVÉHO PARKU (B2C admin) ========
# =================================================================
# Funkcie na ktoré volá frontend (fleet.js):
#   getData, saveVehicle, deleteVehicle, saveLog, saveRefueling, deleteRefueling,
#   getAnalysis, getCosts, saveCost, deleteCost, getReport...
# AdBlue: bez povinnej DB migrácie (fuel_type/is_adblue ak existujú, inak sidecar JSON)
# Default šofér: ak driver nepríde, doplní sa z fleet_vehicles.default_driver
# Costs: amortizácia/mesačne – mesačná suma sa ukladá do DB; meta (mode/total) do sidecar JSON
# =================================================================

import os, json
from datetime import datetime
from calendar import monthrange
from flask import render_template, make_response, request
import db_connector

# --- cesty na meta (bez DB zmien) --------------------------------
BASE_DIR    = os.path.dirname(__file__)
B2C_DIR     = os.path.join(BASE_DIR, "static", "uploads", "b2c")
ORDERS_DIR  = os.path.join(BASE_DIR, "static", "uploads", "orders")
os.makedirs(B2C_DIR, exist_ok=True)

REFUEL_META_PATH = os.path.join(B2C_DIR, "_fleet_refueling_meta.json")
COST_META_PATH   = os.path.join(B2C_DIR, "_fleet_costs_meta.json")   # <-- META k nákladom (mode/total/months...)

def _meta_load(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}

def _meta_save(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj or {}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

# --- helpers ------------------------------------------------------
def _to_int(value, default=None, min_val=None, max_val=None):
    """
    Robustný parse na int:
    - prijme int/str/None, prázdne → vráti default
    - oseká medzery, ošetrí "11", "" atď.
    - voliteľne ohraničí na <min_val, max_val>
    """
    try:
        s = str(value).strip()
        if s == '' or s.lower() in ('none', 'null'):
            return default
        n = int(s)
        if min_val is not None and n < min_val:
            return default if default is not None else min_val
        if max_val is not None and n > max_val:
            return default if default is not None else max_val
        return n
    except Exception:
        return default


def _to_float(v, fb=None):
    try:
        return float(v)
    except Exception:
        return fb

def _col_exists(table: str, col: str) -> bool:
    r = db_connector.execute_query(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema=DATABASE() AND table_name=%s AND column_name=%s LIMIT 1",
        (table, col), fetch="one"
    )
    return bool(r)

# ---------------------------- vehicles -----------------------------

def save_vehicle(data: dict):
    """Insert/Update do fleet_vehicles. Unikátna ŠPZ, povinný initial_odometer + VIN (Legislatíva 2026)."""
    if not isinstance(data, dict):
        return {"error": "Neplatná požiadavka."}

    vid            = _to_int(data.get("id"))
    license_plate  = (data.get("license_plate") or "").strip().upper()
    vin            = (data.get("vin") or "").strip().upper() # NOVÉ: VIN
    name           = (data.get("name") or "").strip()
    vtype          = (data.get("type") or "").strip() or None
    default_driver = (data.get("default_driver") or "").strip() or None
    initial_odo    = _to_int(data.get("initial_odometer"))

    if not license_plate or not name:
        return {"error": "Vyplňte ŠPZ a názov vozidla."}
    if initial_odo is None:
        return {"error": "Počiatočný stav tachometra je povinný."}

    if vid:
        dup = db_connector.execute_query(
            "SELECT id FROM fleet_vehicles WHERE UPPER(license_plate)=UPPER(%s) AND id<>%s LIMIT 1",
            (license_plate, vid), fetch="one"
        )
        if dup:
            return {"error":"Vozidlo s touto ŠPZ už existuje."}
        db_connector.execute_query(
            "UPDATE fleet_vehicles SET license_plate=%s, vin=%s, name=%s, type=%s, default_driver=%s, initial_odometer=%s WHERE id=%s",
            (license_plate, vin, name, vtype, default_driver, initial_odo, vid), fetch="none"
        )
        return {"message":"Vozidlo upravené.", "id": vid}
    else:
        dup = db_connector.execute_query(
            "SELECT id FROM fleet_vehicles WHERE UPPER(license_plate)=UPPER(%s) LIMIT 1",
            (license_plate,), fetch="one"
        )
        if dup:
            return {"error":"Vozidlo s touto ŠPZ už existuje."}
        db_connector.execute_query(
            "INSERT INTO fleet_vehicles (license_plate, vin, name, type, default_driver, initial_odometer, is_active) VALUES (%s,%s,%s,%s,%s,%s, TRUE)",
            (license_plate, vin, name, vtype, default_driver, initial_odo), fetch="none"
        )
        rid = db_connector.execute_query("SELECT LAST_INSERT_ID() AS id", fetch="one")
        return {"message":"Vozidlo pridané.", "id": (rid or {}).get("id")}
# --- DELETE: denné záznamy z knihy jázd (double confirm) ---
# fleet_handler.py
def delete_day_logs(data: dict):
    """
    Vymaže všetky riadky z fleet_logs pre dané vozidlo a dátum (jeden deň).
    Dvojité potvrdenie: 'confirm_text' musí byť presný dátum (SK dd.mm.yyyy / ISO yyyy-mm-dd)
    alebo 'ZMAZAŤ' (bez diakritiky, ľubovoľný case).
    """
    vid = _to_int(data.get("vehicle_id"))
    date_iso = (data.get("date") or "").strip()[:10]  # YYYY-MM-DD
    confirm_text = (data.get("confirm_text") or "").strip()
    if not vid or not date_iso:
        return {"error": "Chýba vehicle_id alebo date (YYYY-MM-DD)."}

    def _sk_from_iso(s):
        try:
            y, m, d = s.split("-")
            return f"{d}.{m}.{y}"
        except Exception:
            return None

    ok_tokens = { date_iso, _sk_from_iso(date_iso), "ZMAZAŤ" }
    ok_tokens = {t for t in ok_tokens if t}
    if confirm_text.upper() not in {t.upper() for t in ok_tokens}:
        return {"error": "Potvrdenie nesedí. Zadajte dátum dňa alebo ZMAZAŤ."}

    db_connector.execute_query(
        "DELETE FROM fleet_logs WHERE vehicle_id=%s AND DATE(log_date)=%s",
        (vid, date_iso), fetch="none"
    )
    return {"message": "Denné záznamy vymazané."}


def delete_vehicle(data: dict):
    """
    Zmazanie/deaktivácia vozidla s dvojitým potvrdením:
      - vyžaduje confirm_plate zhodný s reálnou ŠPZ (UPPER)
      - ak vozidlo má záznamy, nastaví is_active=FALSE, inak fyzicky zmaže
    """
    vid = _to_int(data.get("id"))
    confirm_plate = (data.get("confirm_plate") or "").strip().upper()
    if not vid:
        return {"error":"Chýba ID vozidla."}
    veh = db_connector.execute_query("SELECT license_plate FROM fleet_vehicles WHERE id=%s", (vid,), fetch="one")
    if not veh:
        return {"error":"Vozidlo neexistuje."}
    if (veh.get("license_plate") or "").strip().upper() != confirm_plate:
        return {"error":"Nezhoda potvrdenia ŠPZ."}

    used = db_connector.execute_query("SELECT 1 FROM fleet_logs WHERE vehicle_id=%s LIMIT 1", (vid,), fetch="one") \
        or db_connector.execute_query("SELECT 1 FROM fleet_refueling WHERE vehicle_id=%s LIMIT 1", (vid,), fetch="one")
    if used:
        db_connector.execute_query("UPDATE fleet_vehicles SET is_active=FALSE WHERE id=%s", (vid,), fetch="none")
        return {"message":"Vozidlo deaktivované (má záznamy)."}
    db_connector.execute_query("DELETE FROM fleet_vehicles WHERE id=%s", (vid,), fetch="none")
    return {"message":"Vozidlo zmazané."}

# ------------------------------ data -------------------------------
def get_fleet_data(vehicle_id=None, year=None, month=None):
    """Načíta dáta a správne určí last_odometer (z minulosti alebo initial)."""
    vehicles = db_connector.execute_query("SELECT * FROM fleet_vehicles WHERE is_active=1 ORDER BY name")
    if not vehicle_id and vehicles:
        vehicle_id = vehicles[0]["id"]
    
    today = datetime.now()
    year = _to_int(year, today.year)
    month = _to_int(month, today.month)

    logs = []
    refuelings = []
    last_odo = 0

    if vehicle_id:
        # 1. Logs pre aktuálny mesiac
        logs = db_connector.execute_query(
            "SELECT * FROM fleet_logs WHERE vehicle_id=%s AND YEAR(log_date)=%s AND MONTH(log_date)=%s ORDER BY log_date ASC",
            (vehicle_id, year, month)
        ) or []

        # 2. Tankovanie pre aktuálny mesiac
        refuelings = db_connector.execute_query(
            "SELECT * FROM fleet_refueling WHERE vehicle_id=%s AND YEAR(refueling_date)=%s AND MONTH(refueling_date)=%s ORDER BY refueling_date ASC",
            (vehicle_id, year, month)
        ) or []

        # 3. KĽÚČOVÉ: Zistenie počiatočného stavu pre tento mesiac
        # Hľadáme posledný záznam PRED týmto mesiacom
        first_day_of_month = f"{year:04d}-{month:02d}-01"
        
        prev_log = db_connector.execute_query(
            "SELECT end_odometer FROM fleet_logs WHERE vehicle_id=%s AND log_date < %s ORDER BY log_date DESC LIMIT 1",
            (vehicle_id, first_day_of_month),
            fetch="one"
        )

        if prev_log:
            last_odo = int(prev_log['end_odometer'])
        else:
            # Ak neexistuje žiadny záznam v minulosti, vezmi initial_odometer z auta
            veh = db_connector.execute_query("SELECT initial_odometer FROM fleet_vehicles WHERE id=%s", (vehicle_id,), fetch="one")
            last_odo = int((veh or {}).get('initial_odometer') or 0)
    last_driver = None
    if vehicle_id:
        ld = db_connector.execute_query(
            "SELECT driver FROM fleet_logs "
            "WHERE vehicle_id=%s AND driver IS NOT NULL AND driver<>'' "
            "ORDER BY log_date DESC LIMIT 1",
            (vehicle_id,),
            fetch="one"
        )
        if ld:
            last_driver = (ld.get("driver") or "").strip() or None

    # fallback na default_driver z vozidla, ak v logoch nič nie je
    if not last_driver:
        v = db_connector.execute_query(
            "SELECT default_driver FROM fleet_vehicles WHERE id=%s",
            (vehicle_id,),
            fetch="one"
        )
        last_driver = ((v or {}).get("default_driver") or "").strip() or None

    return {
  "vehicles": vehicles,
  "selected_vehicle_id": _to_int(vehicle_id) if vehicle_id else None,
  "selected_year": year,
  "selected_month": month,
  "logs": logs,
  "refuelings": refuelings,
  "last_odometer": last_odo,
  "last_driver": last_driver
}


def get_data(vehicle_id=None, year=None, month=None):
    return get_fleet_data(vehicle_id, year, month)

# --------------------------- save logbook --------------------------

def save_daily_log(data):
    """
    Uloží/aktualizuje jazdy.
    Podporuje detailnú evidenciu (čas, miesto, účel) pre zákon 2026.
    Identifikácia záznamu pre UPDATE je cez unikátne 'id' jazdy.
    """
    logs = data.get('logs')
    if not logs:
        return {"error":"Chýbajú dáta záznamov (logs)."}

    def to_i(v):
        try: return int(v) if v not in (None,"") else None
        except: return None
    def to_f(v):
        try: return float(v) if v not in (None,"") else None
        except: return None

    # Načítanie default šoférov pre vozidlá v requeste (optimalizácia)
    vehicle_ids = set(to_i(r.get('vehicle_id')) for r in logs if to_i(r.get('vehicle_id')))
    defaults_map = {}
    if vehicle_ids:
        placeholders = ",".join(["%s"] * len(vehicle_ids))
        rows = db_connector.execute_query(
            f"SELECT id, default_driver FROM fleet_vehicles WHERE id IN ({placeholders})",
            tuple(vehicle_ids), fetch="all"
        ) or []
        for r in rows:
            defaults_map[r['id']] = r.get('default_driver')

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        for row in logs:
            trip_id = to_i(row.get('id')) # ID konkrétnej jazdy (ak existuje)
            vid = to_i(row.get('vehicle_id'))
            log_date = (row.get('log_date') or '')[:10]
            
            if not vid or not log_date: continue

            # Hodnoty
            start_o = to_i(row.get('start_odometer'))
            end_o   = to_i(row.get('end_odometer'))
            km      = to_i(row.get('km_driven'))

            # Auto-výpočet KM ak chýba
            if km is None and start_o is not None and end_o is not None:
                km = max(0, end_o - start_o)
            
            # NOVÉ polia pre zákon 2026
            time_start = row.get('time_start') or None # format "HH:MM"
            time_end   = row.get('time_end') or None
            loc_start  = (row.get('location_start') or "").strip() or None
            loc_end    = (row.get('location_end') or "").strip() or None
            purpose    = (row.get('purpose') or "").strip() or None
            
            driver = (row.get('driver') or '').strip() or defaults_map.get(vid)

            # Ostatné (tovar)
            goods_out = to_f(row.get('goods_out_kg'))
            goods_in  = to_f(row.get('goods_in_kg'))
            dl_count  = to_i(row.get('delivery_notes_count')) or 0

            if trip_id:
                # UPDATE existujúcej jazdy podľa ID
                cur.execute("""
                    UPDATE fleet_logs SET
                        driver=%s, time_start=%s, time_end=%s,
                        location_start=%s, location_end=%s, purpose=%s,
                        start_odometer=%s, end_odometer=%s, km_driven=%s,
                        goods_out_kg=%s, goods_in_kg=%s, delivery_notes_count=%s,
                        log_date=%s
                    WHERE id=%s
                """, (driver, time_start, time_end, loc_start, loc_end, purpose,
                      start_o, end_o, km, goods_out, goods_in, dl_count, log_date, trip_id))
            else:
                # INSERT novej jazdy
                cur.execute("""
                    INSERT INTO fleet_logs (
                        vehicle_id, log_date, driver, time_start, time_end,
                        location_start, location_end, purpose,
                        start_odometer, end_odometer, km_driven,
                        goods_out_kg, goods_in_kg, delivery_notes_count
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (vid, log_date, driver, time_start, time_end,
                      loc_start, loc_end, purpose,
                      start_o, end_o, km, goods_out, goods_in, dl_count))

        conn.commit()
        return {"message":"Jazdy boli uložené."}
    except Exception as e:
        if conn: conn.rollback()
        print(f"Error saving log: {e}")
        return {"error": f"Chyba pri ukladaní: {str(e)}"}
    finally:
        if conn and conn.is_connected():
            conn.close()

def save_log(data):
    return save_daily_log(data)
# -------------------------- refuelings ----------------------------
def save_refueling(data):
    """Priamy zápis do DB, keďže tabuľka má stĺpec fuel_type."""
    required = ['vehicle_id', 'refueling_date', 'liters']
    if not all(k in data for k in required):
        return {"error": "Chýbajú povinné polia."}

    driver = (data.get('driver') or '').strip()
    # Ak nie je šofér, vytiahneme default
    if not driver:
        row = db_connector.execute_query("SELECT default_driver FROM fleet_vehicles WHERE id=%s", (data['vehicle_id'],), fetch="one")
        driver = (row or {}).get("default_driver")

    fuel_type = (data.get("fuel_type") or "Diesel").strip()
    # Pre istotu zjednotíme názvy (UI posiela 'ADBLUE', DB má default 'Diesel')
    if fuel_type.upper() == 'ADBLUE':
        fuel_type = 'AdBlue'
    else:
        fuel_type = 'Diesel'

    liters = _to_float(data.get('liters'), 0.0)
    ppl = _to_float(data.get('price_per_liter'), 0.0)
    total = _to_float(data.get('total_price'), 0.0) or (liters * ppl)

    db_connector.execute_query(
        """
        INSERT INTO fleet_refueling 
        (vehicle_id, refueling_date, driver, liters, price_per_liter, total_price, fuel_type) 
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (data['vehicle_id'], data['refueling_date'], driver, liters, ppl, total, fuel_type),
        fetch="none"
    )
    return {"message": "Tankovanie uložené."}


def delete_refueling(data):
    rid = _to_int(data.get('id'))
    if not rid:
        return {"error":"Chýba ID záznamu na vymazanie."}
    db_connector.execute_query("DELETE FROM fleet_refueling WHERE id=%s", (rid,), fetch="none")
    # zmaž meta, ak existuje
    meta = _meta_load(REFUEL_META_PATH)
    if str(rid) in meta:
        meta.pop(str(rid), None)
        _meta_save(meta, REFUEL_META_PATH)
    return {"message":"Záznam o tankovaní bol vymazaný."}

# --------------------------- analysis -----------------------------
def get_fleet_analysis(vehicle_id, year, month):
    year = _to_int(year); month = _to_int(month)
    if not all([vehicle_id, year, month]): return {"error": "Chýbajú parametre."}

    # 1. KM a Tovar (filter chýb > 2000 km)
    log_sum = db_connector.execute_query(
        """
        SELECT SUM(km_driven) total_km, SUM(goods_out_kg) total_goods_out 
        FROM fleet_logs 
        WHERE vehicle_id=%s AND YEAR(log_date)=%s AND MONTH(log_date)=%s AND km_driven < 2000
        """,
        (vehicle_id, year, month), fetch="one"
    ) or {}
    
    total_km = float(log_sum.get("total_km") or 0.0)
    goods_out = float(log_sum.get("total_goods_out") or 0.0)

    # 2. Palivo - čítame priamo fuel_type z DB
    ref = db_connector.execute_query(
        "SELECT liters, total_price, fuel_type FROM fleet_refueling WHERE vehicle_id=%s AND YEAR(refueling_date)=%s AND MONTH(refueling_date)=%s",
        (vehicle_id, year, month)
    ) or []

    diesel_l = 0.0; diesel_c = 0.0
    adblue_l = 0.0; adblue_c = 0.0

    for r in ref:
        ft = str(r.get('fuel_type') or 'Diesel').upper()
        l = float(r.get('liters') or 0)
        c = float(r.get('total_price') or 0)
        
        if 'ADBLUE' in ft:
            adblue_l += l
            adblue_c += c
        else:
            diesel_l += l
            diesel_c += c

    # 3. Náklady
    start = datetime(year, month, 1)
    end = start.replace(day=monthrange(year, month)[1])
    other = db_connector.execute_query(
        "SELECT SUM(monthly_cost) c FROM fleet_costs WHERE vehicle_id=%s AND valid_from<=%s AND (valid_to IS NULL OR valid_to>=%s)",
        (vehicle_id, end.date(), start.date()), fetch="one"
    ) or {}
    
    total_costs = float(other.get("c") or 0.0) + diesel_c + adblue_c

    # --- VÝPOČTY ---
    cost_per_km = (total_costs / total_km) if total_km > 0 else 0.0
    
    # Výpočet ceny za kg tovaru (to, čo chýbalo)
    # Pridávame napr. 10% amortizáciu k cene, ako naznačuje šablóna (+10% amort.)
    # Alebo len čistý podiel. Podľa šablóny to vyzerá, že sa očakáva len hodnota.
    # Ak chcete presne to isté čo v šablóne "+10% amort", treba to zohľadniť tu alebo v šablóne.
    # Tu dávam čistý výpočet cena/kg. Ak šablóna robí iné, upravte vzorec.
    cost_per_kg = (total_costs / goods_out) if goods_out > 0 else 0.0

    return {
        "total_km": total_km,
        "total_costs": total_costs,
        "cost_per_km": cost_per_km,
        "total_goods_out_kg": goods_out,
        "avg_consumption": (diesel_l / total_km * 100.0) if total_km > 0 else 0.0,
        "total_adblue_liters": adblue_l,
        "total_adblue_cost": adblue_c,
        "adblue_per_100km": (adblue_l / total_km * 100.0) if total_km > 0 else 0.0,
        "cost_per_kg_goods": cost_per_kg  # <--- TOTO BOL CHÝBAJÚCI KĽÚČ
    }
def get_analysis(vehicle_id, year, month):
    return get_fleet_analysis(vehicle_id, year, month)

# ----------------------------- costs ------------------------------

def _cost_meta_load():
    return _meta_load(COST_META_PATH)

def _cost_meta_save(obj):
    _meta_save(obj, COST_META_PATH)

def _months_inclusive(y1, m1, y2, m2):
    """vráti count mesiacov od (y1,m1) po (y2,m2) vrátane; ak nie je valid_to -> None"""
    try:
        return (y2 - y1) * 12 + (m2 - m1) + 1
    except Exception:
        return None

def get_fleet_costs(vehicle_id=None):
    rows = db_connector.execute_query(
        "SELECT * FROM fleet_costs WHERE vehicle_id = %s OR vehicle_id IS NULL ORDER BY valid_from DESC",
        (vehicle_id,)
    ) or []
    # pripoj meta (mode/total_amount/months)
    meta = _cost_meta_load()
    out = []
    for r in rows:
        rid = str(r.get("id"))
        m = meta.get(rid) or {}
        r["cost_mode"]       = m.get("mode") or "monthly"       # 'monthly' | 'amortized'
        r["total_amount"]    = m.get("total_amount")            # None alebo číslo
        r["amortize_months"] = m.get("months")                  # None alebo int
        out.append(r)
    return out

def save_fleet_cost(data):
    """
    Uloží (insert/update) náklad.
    Podporuje:
      - cost_mode: 'monthly' (mesačná suma) alebo 'amortized' (rozrátať)
      - total_amount: celková suma na rozrátanie (pri 'amortized'), resp. mesačná suma pri 'monthly'
      - amortize_use_period: '1'/'true' → počet mesiacov sa vezme z valid_from..valid_to (vrátane)
      - amortize_months: ak nechceš podľa obdobia, zadaj priamo počet mesiacov
    Do DB sa ukladá iba prepočítaná 'monthly_cost'; meta sa drží v _fleet_costs_meta.json
    """
    cost_id = _to_int(data.get('id'))
    required = ['cost_name','cost_type','valid_from']
    if not all(k in data for k in required):
        return {"error":"Chýbajú povinné polia (názov, typ, platné od)."}

    # UI flag – viazané na vozidlo
    vehicle_id_to_save = data.get('is_vehicle_specific') and data.get('vehicle_id') or None

    # režim
    cost_mode = (data.get("cost_mode") or "monthly").strip().lower()  # 'monthly' | 'amortized'
    total_amount = _to_float(data.get("total_amount"), None)
    monthly_cost_in = _to_float(data.get("monthly_cost"), None)

    valid_from = data.get('valid_from')
    valid_to   = data.get('valid_to') or None

    # rozhodnutie o mesačnej sume
    monthly_cost_out = None

    if cost_mode == "amortized":
        # spočítať počet mesiacov
        use_period = str(data.get("amortize_use_period") or "").lower() in ("1","true","yes","y","on")
        months = None
        if use_period and valid_to:
            try:
                y1,m1 = int(valid_from[:4]), int(valid_from[5:7])
                y2,m2 = int(valid_to[:4]),   int(valid_to[5:7])
                months = _months_inclusive(y1,m1,y2,m2)
            except Exception:
                months = None
        if not months:
            months = _to_int(data.get("amortize_months"), None)
        if not months or months <= 0:
            months = 12  # rozumný default

        if total_amount is None:
            # ak náhodou neprišla total_amount, skús vziať monthly_cost_in * months
            if monthly_cost_in is not None:
                total_amount = float(monthly_cost_in) * months
            else:
                return {"error":"Pri rozrátaní je potrebná celková suma alebo mesačná suma."}
        monthly_cost_out = round(float(total_amount) / float(months), 2)

    else:
        # monthly režim – mesačne priamo z monthly_cost_in, alebo ak poslal total_amount, tak = total_amount
        if monthly_cost_in is not None:
            monthly_cost_out = float(monthly_cost_in)
        elif total_amount is not None:
            monthly_cost_out = float(total_amount)
        else:
            return {"error":"Zadajte mesačnú sumu alebo celkovú sumu."}

    params = (
        data['cost_name'],
        data['cost_type'],
        monthly_cost_out,
        valid_from,
        valid_to,
        vehicle_id_to_save
    )

    if cost_id:
        db_connector.execute_query(
            "UPDATE fleet_costs SET cost_name=%s, cost_type=%s, monthly_cost=%s, valid_from=%s, valid_to=%s, vehicle_id=%s WHERE id=%s",
            params + (cost_id,), fetch="none"
        )
        rid = cost_id
    else:
        db_connector.execute_query(
            "INSERT INTO fleet_costs (cost_name, cost_type, monthly_cost, valid_from, valid_to, vehicle_id) VALUES (%s,%s,%s,%s,%s,%s)",
            params, fetch="none"
        )
        r = db_connector.execute_query("SELECT LAST_INSERT_ID() AS id", fetch="one")
        rid = (r or {}).get("id")

    # zapíš meta (mode/total_amount/mes.)
    if rid:
        meta = _cost_meta_load()
        meta[str(rid)] = {
            "mode": cost_mode,
            "total_amount": total_amount if total_amount is not None else None,
            "months": None
        }
        if cost_mode == "amortized":
            # uložiť, koľko mesiacov reálne používame
            mths = None
            if valid_to:
                try:
                    y1,m1 = int(valid_from[:4]), int(valid_from[5:7])
                    y2,m2 = int(valid_to[:4]),   int(valid_to[5:7])
                    mths = _months_inclusive(y1,m1,y2,m2)
                except Exception:
                    pass
            if not mths:
                mths = _to_int(data.get("amortize_months"), None)
            if not mths:
                mths = 12
            meta[str(rid)]["months"] = int(mths)
        _cost_meta_save(meta)

    return {"message": ("Náklad upravený." if cost_id else "Náklad pridaný."), "monthly_cost": monthly_cost_out}

def delete_fleet_cost(data):
    cid = _to_int(data.get('id'))
    if not cid:
        return {"error":"Chýba ID nákladu."}
    db_connector.execute_query("DELETE FROM fleet_costs WHERE id=%s", (cid,), fetch="none")
    # zmaž cost meta
    meta = _cost_meta_load()
    if str(cid) in meta:
        meta.pop(str(cid), None)
        _cost_meta_save(meta)
    return {"message":"Náklad vymazaný."}

# aliasy podľa názvov z frontendu
def get_costs(vehicle_id=None):   return get_fleet_costs(vehicle_id)
def save_cost(data):              return save_fleet_cost(data)
def delete_cost(data):            return delete_fleet_cost(data)

# ------------------------------ report ----------------------------

def get_report_html_content(vehicle_id, year, month, report_type='all'):
    year=_to_int(year); month=_to_int(month)
    if not all([vehicle_id,year,month]):
        return make_response("<h1>Chýbajú parametre pre report.</h1>",400)
    data = get_fleet_data(vehicle_id, year, month)
    analysis = get_fleet_analysis(vehicle_id, year, month)

    start = datetime(year, month, 1)
    end   = start.replace(day=monthrange(year, month)[1])
    all_costs = db_connector.execute_query(
        "SELECT * FROM fleet_costs WHERE (vehicle_id=%s OR vehicle_id IS NULL) AND valid_from<=%s AND (valid_to IS NULL OR valid_to>=%s)",
        (vehicle_id, end.date(), start.date())
    )

    fixed_costs    = [c for c in all_costs if c['cost_type'] in ['MZDA','POISTENIE','DIALNICNA','INE']]
    variable_costs = [c for c in all_costs if c['cost_type'] in ['SERVIS','PNEUMATIKY','SKODA']]

    ctx = {
        "vehicle": next((v for v in (data['vehicles'] or []) if v['id']==int(vehicle_id)), {}),
        "period": f"{month:02d}/{year}",
        "logs": data['logs'],
        "refuelings": data['refuelings'],
        "analysis": analysis,
        "fixed_costs": fixed_costs,
        "variable_costs": variable_costs,
        "report_type": report_type or 'all'
    }
    return make_response(render_template('fleet_report_template.html', **ctx))
def get_previous_odometer_value(vehicle_id, date_str):
    """
    Nájde konečný stav tachometra z posledného záznamu PRED zadaným dátumom.
    Ak záznam neexistuje, vráti initial_odometer vozidla.
    """
    # 1. Hľadáme v logoch (najnovší záznam, ktorý je starší ako date_str)
    sql_log = """
        SELECT end_odometer 
        FROM fleet_logs 
        WHERE vehicle_id = %s AND log_date < %s 
        ORDER BY log_date DESC 
        LIMIT 1
    """
    row = db_connector.execute_query(sql_log, (vehicle_id, date_str), fetch="one")
    
    if row and row.get('end_odometer'):
        return int(row['end_odometer'])

    # 2. Ak logy neexistujú, vrátime počiatočný stav vozidla
    sql_veh = "SELECT initial_odometer FROM fleet_vehicles WHERE id = %s"
    veh = db_connector.execute_query(sql_veh, (vehicle_id,), fetch="one")
    
    return int((veh or {}).get('initial_odometer') or 0)

def delete_trip_log(data: dict):
    """Vymaže konkrétnu jazdu podľa ID."""
    trip_id = _to_int(data.get("id"))
    if not trip_id:
        return {"error": "Chýba ID jazdy."}
    
    db_connector.execute_query("DELETE FROM fleet_logs WHERE id=%s", (trip_id,), fetch="none")
    return {"message": "Záznam o jazde vymazaný."}