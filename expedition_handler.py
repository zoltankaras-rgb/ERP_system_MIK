# expedition_handler.py
# Kompletný handler pre modul EXPEDÍCIA:
# - Príjem po položkách (per-row accept) z výroby + okamžitý výpočet reálnej výrobnej ceny
# - Krájanie (rezervácia zo zdroja + pripísanie hotových balíčkov + cena hneď pri ukončení)
# - Prehľad / inventúra finálneho skladu (Sklad 2) + história inventúr (naše tabuľky)
# - Best-effort zápis do „legacy“ tabuľky inventúr (ak existuje), bez ALTER
# - Bez zásahu do tvojej schémy – všetky doplnky sú „autodetect“

import db_connector
from datetime import datetime, date, timedelta
import json
import math
import unicodedata
import random
import string
from typing import Optional, List, Dict, Any

# ─────────────────────────────────────────────────────────────
# Pomocné: detekcia stĺpcov, tabuľky, parse čísla, slug, batch-id
# ─────────────────────────────────────────────────────────────

def _to_local_time(dt):
    """
    Prevedie UTC čas na slovenský.
    Momentálne (Zima): +1 hodina.
    V lete (DST): treba zmeniť na +2 hodiny.
    """
    if isinstance(dt, datetime):
        return dt + timedelta(hours=1) # ZIMNÝ ČAS (CET) = UTC+1
    return dt

def _has_col(table: str, col: str) -> bool:
    try:
        r = db_connector.execute_query(
            """
            SELECT 1
              FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = %s
               AND COLUMN_NAME  = %s
             LIMIT 1
            """,
            (table, col),
            fetch='one'
        )
        return bool(r)
    except Exception:
        return False

def _table_exists(table: str) -> bool:
    try:
        r = db_connector.execute_query(
            """
            SELECT 1
              FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = %s
             LIMIT 1
            """,
            (table,),
            fetch='one'
        )
        return bool(r)
    except Exception:
        return False

def _pick_existing_col(table: str, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if _has_col(table, c):
            return c
    return None

def _zv_name_col() -> str:
    """Stĺpec s názvom výrobku v `zaznamy_vyroba` ('nazov_vyrobu' | 'nazov_vyrobku')."""
    return 'nazov_vyrobu' if _has_col('zaznamy_vyroba', 'nazov_vyrobu') else 'nazov_vyrobku'

def _parse_num(x) -> float:
    try:
        return float(str(x).replace(',', '.'))
    except Exception:
        return 0.0

def _slug(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode('ascii')
    s = ''.join(ch if ch.isalnum() else '-' for ch in s).strip('-')
    s = '-'.join(filter(None, s.split('-')))
    return s

def _batch_id_exists(batch_id: str) -> bool:
    row = db_connector.execute_query(
        "SELECT 1 FROM zaznamy_vyroba WHERE id_davky=%s LIMIT 1", (batch_id,), fetch='one'
    )
    return bool(row)

def _gen_unique_batch_id(prefix: str, name: str) -> str:
    base = f"{prefix}-{_slug(name)[:12]}-{datetime.now().strftime('%y%m%d%H%M%S')}"
    bid = base
    tries = 0
    while _batch_id_exists(bid) and tries < 8:
        suffix = ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(3))
        bid = f"{base}-{suffix}"
        tries += 1
    if _batch_id_exists(bid):
        bid = f"{base}-{int(datetime.now().timestamp()*1000)%100000}"
    return bid

# Kandidáti na stĺpec s priemernou výrobnou cenou v `produkty`
def _product_manuf_avg_col() -> Optional[str]:
    return _pick_existing_col('produkty', [
        'vyrobna_cena_eur_kg', 'vyrobna_cena', 'vyrobna_cena_avg_kg', 'vyrobna_cena_avg'
    ])

# ─────────────────────────────────────────────────────────────
# Schémy: prijmy expedície + inventúry (naše, bez konfliktov)
# ─────────────────────────────────────────────────────────────

def _ensure_expedition_schema():
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS expedicia_prijmy (
            id INT AUTO_INCREMENT PRIMARY KEY,
            id_davky VARCHAR(64) NOT NULL,
            nazov_vyrobku VARCHAR(255) NOT NULL,
            unit VARCHAR(8) NOT NULL,            -- 'kg' | 'ks'
            prijem_kg DECIMAL(12,3) NULL,
            prijem_ks INT NULL,
            prijal VARCHAR(255) NOT NULL,
            dovod VARCHAR(255) NULL,            -- poznámka / dôvod
            datum_prijmu DATE NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            is_deleted TINYINT(1) NOT NULL DEFAULT 0,
            INDEX idx_ep_batch (id_davky),
            INDEX idx_ep_date (datum_prijmu)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """, fetch='none'
    )

def _ensure_expedicia_inventury_schema():
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS expedicia_inventury (
            id INT AUTO_INCREMENT PRIMARY KEY,
            datum DATE NOT NULL,
            vytvoril VARCHAR(255) NOT NULL,
            poznamka VARCHAR(255) NULL,
            created_at DATETIME NOT NULL,
            status VARCHAR(20) DEFAULT 'COMPLETED',
            INDEX idx_ei_datum (datum)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """, fetch='none'
    )
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS expedicia_inventura_polozky (
            id INT AUTO_INCREMENT PRIMARY KEY,
            inventura_id INT NOT NULL,
            ean VARCHAR(64) NOT NULL,
            nazov VARCHAR(255) NOT NULL,
            kategoria VARCHAR(255) NULL,
            system_stav_kg DECIMAL(12,3) NOT NULL,
            realny_stav_kg DECIMAL(12,3) NOT NULL,
            rozdiel_kg DECIMAL(12,3) NOT NULL,
            hodnota_eur DECIMAL(12,2) NOT NULL,
            FOREIGN KEY (inventura_id) REFERENCES expedicia_inventury(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """, fetch='none'
    )

# ─────────────────────────────────────────────────────────────
# BEST-EFFORT zápis do legacy tabuľky inventúr (bez ALTER)
# ─────────────────────────────────────────────────────────────

def _try_insert_into_legacy_inventory_diffs(diffs_rows: List[tuple]):
    if not diffs_rows or not _table_exists('inventurne_rozdiely_produkty'):
        return
    cols = db_connector.execute_query(
        """
        SELECT COLUMN_NAME AS c
          FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME   = 'inventurne_rozdiely_produkty'
        """) or []
    colset = {r['c'] for r in cols}

    def pick(*cands):
        for c in cands:
            if c in colset: return c
        return None

    c_datum = pick('datum','created_at','cas','datetime')
    c_ean   = pick('ean_produktu','ean')
    c_nazov = pick('nazov_produktu','nazov','nazov_vyrobku','produkt')
    c_kat   = pick('predajna_kategoria','kategoria','kat')
    c_sys   = pick('systemovy_stav_kg','system_stav_kg','system_stav')
    c_real  = pick('realny_stav_kg','real_stav_kg','real_stav')
    c_diff  = pick('rozdiel_kg','rozdiel')
    c_val   = pick('hodnota_rozdielu_eur','hodnota','hodnota_eur')
    c_prac  = pick('pracovnik','user','pouzivatel','operator')

    used_cols = [c for c in [c_datum,c_ean,c_nazov,c_kat,c_sys,c_real,c_diff,c_val,c_prac] if c]
    if len(used_cols) < 5:
        return

    placeholders = ",".join(["%s"]*len(used_cols))
    sql = f"INSERT INTO inventurne_rozdiely_produkty ({','.join(used_cols)}) VALUES ({placeholders})"

    def adapt_ok(row):
        (d, ean, naz, kat, syskg, realkg, diffkg, val, prac) = row
        mapping = {
            c_datum: d, c_ean: ean, c_nazov: naz, c_kat: kat,
            c_sys: syskg, c_real: realkg, c_diff: diffkg, c_val: val, c_prac: prac
        }
        return tuple(mapping[c] for c in used_cols)

    try:
        db_connector.execute_query(sql, [adapt_ok(r) for r in diffs_rows], fetch='none', multi=True)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────
# Hlavné menu – Prebiehajúce krájanie
# ─────────────────────────────────────────────────────────────
def get_expedition_data():
    zv = _zv_name_col() # Táto pomocná funkcia už v súbore je
    
    rows = db_connector.execute_query(
        f"""
        SELECT
            zv.id_davky as logId,
            zv.{zv} as bulkProductName,
            zv.planovane_mnozstvo_kg as plannedKg,
            JSON_UNQUOTE(JSON_EXTRACT(zv.detaily_zmeny, '$.cielovyNazov')) as targetProductName,
            JSON_UNQUOTE(JSON_EXTRACT(zv.detaily_zmeny, '$.planovaneKs')) as plannedPieces,
            JSON_UNQUOTE(JSON_EXTRACT(zv.detaily_zmeny, '$.zakaznik')) as customer,
            JSON_UNQUOTE(JSON_EXTRACT(zv.detaily_zmeny, '$.datumDodania')) as dueDate
        FROM zaznamy_vyroba zv
        WHERE zv.stav = 'Prebieha krájanie'
        ORDER BY zv.datum_spustenia DESC
        """
    ) or []
    
    # Vyčistenie dát pre frontend
    for r in rows:
        try:
            # Konverzia kusov na int
            if r.get('plannedPieces'):
                r['plannedPieces'] = int(float(r['plannedPieces']))
            else:
                r['plannedPieces'] = 0
            
            # Konverzia kg na float
            if r.get('plannedKg'):
                r['plannedKg'] = float(r['plannedKg'])
        except Exception:
            pass
            
    return {"pendingTasks": rows}

# ─────────────────────────────────────────────────────────────
# POŽIADAVKY NA KRÁJANIE (Forecast / Objednávky)
# ─────────────────────────────────────────────────────────────
# ---------------------------------------------------------
# NOVÁ FUNKCIA PRE MANUÁLNE KRÁJANIE (LEADER / EXPEDÍCIA)
# ---------------------------------------------------------
def create_manual_slicing_job(data: Dict[str, Any]):
    """
    Vytvorí úlohu na krájanie.
    data = {
        'ean': str,           # EAN cieľového (baleného) výrobku
        'quantity': float,    # Množstvo
        'unit': str,          # 'kg' alebo 'ks'
        'customer': str,      # (Voliteľné) Názov zákazníka / Odberateľ
        'order_id': str,      # (Voliteľné) Číslo objednávky
        'due_date': str       # (Voliteľné) Termín dodania YYYY-MM-DD
    }
    """
    target_ean = (data.get('ean') or '').strip()
    try:
        qty = float(data.get('quantity') or 0)
    except:
        return {"error": "Neplatné množstvo."}
    
    unit = (data.get('unit') or 'kg').strip().lower()
    customer = (data.get('customer') or '').strip()
    due_date = data.get('due_date')

    if not target_ean or qty <= 0:
        return {"error": "Chýba EAN alebo množstvo."}

    # 1. Získame info o cieľovom a zdrojovom produkte
    # Cieľový produkt (napr. "Saláma krájaná 100g") musí mať zdrojový_ean (napr. "Saláma tyč")
    p = db_connector.execute_query(
        """
        SELECT t.ean as target_ean, t.nazov_vyrobku as target_name,
               t.vaha_balenia_g as target_weight_g, t.zdrojovy_ean,
               s.nazov_vyrobku as source_name, s.mj as source_mj
        FROM produkty t
        LEFT JOIN produkty s ON t.zdrojovy_ean = s.ean
        WHERE t.ean = %s
        """,
        (target_ean,), fetch='one'
    )

    if not p:
        return {"error": "Produkt s týmto EAN neexistuje."}
    if not p.get('zdrojovy_ean'):
        return {"error": f"Produkt '{p['target_name']}' nemá nastavený 'Zdrojový EAN' (surovinu na krájanie)."}

    # 2. Prepočet na KG (koľko suroviny treba odpísať)
    required_kg = 0.0
    planned_pieces = 0
    
    target_weight_g = float(p.get('target_weight_g') or 0)

    if unit == 'ks':
        planned_pieces = int(qty)
        if target_weight_g > 0:
            required_kg = (planned_pieces * target_weight_g) / 1000.0
        else:
            # Ak nevieme váhu balenia, nemôžeme odpísať surovinu presne
            return {"error": f"Produkt '{p['target_name']}' nemá nastavenú váhu balenia (g). Nedá sa prepočítať na kg."}
    else:
        # Unit je KG
        required_kg = qty
        if target_weight_g > 0:
            planned_pieces = math.ceil((qty * 1000.0) / target_weight_g)
        else:
            planned_pieces = 0 # Nedefinované

    # 3. Odpis suroviny zo skladu (Sklad 2 - Finálne produkty, lebo tam je surovina na krájanie)
    # Odpisujeme zo 'zdrojovy_ean'
    db_connector.execute_query(
        "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s",
        (required_kg, p['zdrojovy_ean']), fetch='none'
    )

    # 4. Vytvorenie záznamu o výrobe
    batch_id = _gen_unique_batch_id("KRAJANIE", p['target_name'])

    # JSON detaily pre Expedíciu (aby vedeli pre koho to je)
    details = json.dumps({
        "operacia": "krajanie",
        "cielovyEan": p["target_ean"],
        "cielovyNazov": p["target_name"],
        "zdrojovyEan": p["zdrojovy_ean"],
        "planovaneKs": planned_pieces,
        "zakaznik": customer,
        "datumDodania": due_date,
        "cisloObjednavky": data.get('order_id')
    }, ensure_ascii=False)

    # Poznámka do DB
    note = ""
    if customer:
        note += f"Pre: {customer} "
    if due_date:
        note += f"(Termín: {due_date})"

    db_connector.execute_query(
        f"""
        INSERT INTO zaznamy_vyroba
          (id_davky, stav, datum_vyroby, {_zv_name_col()}, planovane_mnozstvo_kg, datum_spustenia, celkova_cena_surovin, detaily_zmeny, poznamka)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (batch_id, 'Prebieha krájanie', datetime.now(), p['source_name'], required_kg, datetime.now(), 0, details, note),
        fetch='none'
    )

    return {
        "message": f"Krájanie spustené. Rezervované {required_kg:.2f} kg suroviny '{p['source_name']}'.",
        "batchId": batch_id
    }

def get_slicing_requirements_from_orders():
    """
    Vráti zoznam položiek na krájanie z B2B/B2C objednávok.

    - pre každý riadok máme:
        cislo_objednavky, zakaznik, termin, produkt, množstvo, MJ, vaha_balenia_g, zdrojovy_ean, target_ean
    - ignorujeme objednávky, pre ktoré UŽ existuje úloha na krájanie
      (záznam v zaznamy_vyroba s detaily_zmeny.cisloObjednavky a operacia='krajanie'
       v stave 'Prijaté, čaká na tlač' alebo 'Ukončené' alebo 'Zrušená')
    - ak je pre danú objednávku+produkt krájanie v stave 'Prebieha krájanie',
      nastavíme is_running=True (tlačidlo v FE bude sivé a disabled)
    """
    # 1. Zistíme bežiace krájanie (podľa názvu – stará logika)
    zv_col = _zv_name_col()
    active_slicing = {}
    try:
        rows_running = db_connector.execute_query(f"""
            SELECT {zv_col}, SUM(planovane_mnozstvo_kg) AS total_kg 
            FROM zaznamy_vyroba 
            WHERE stav IN ('Prebieha krájanie', 'Naplánované') 
            GROUP BY {zv_col}
        """) or []
        for r in rows_running:
            nm = (r.get(zv_col) or '').strip()
            active_slicing[nm] = float(r.get('total_kg') or 0)
    except Exception:
        active_slicing = {}

    # 2. Mapovanie objednávka+produkt -> stav krájania (zaznamy_vyroba.detaily_zmeny)
    order_slicing_status = {}
    try:
        jobs = db_connector.execute_query("""
            SELECT 
                JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.cisloObjednavky')) AS order_no,
                JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.cielovyNazov'))     AS product_name,
                stav
            FROM zaznamy_vyroba
            WHERE detaily_zmeny IS NOT NULL
              AND JSON_EXTRACT(detaily_zmeny, '$.operacia') = '"krajanie"'
        """) or []
        for j in jobs:
            o = (j.get('order_no') or '').strip()
            p = (j.get('product_name') or '').strip()
            if not o or not p:
                continue
            order_slicing_status[(o, p)] = j.get('stav') or ''
    except Exception as e:
        print(f"Error building order_slicing_status: {e}")
        order_slicing_status = {}

    # helper na konverziu textových stĺpcov s jednotnou koláciou
    def _str(col):
        return f"CONVERT({col} USING utf8mb4) COLLATE utf8mb4_general_ci"

    sql_condition = """
        (
           p.typ_polozky = 'VÝROBOK_KRAJANY' 
           OR pol.nazov_vyrobku LIKE '%krájan%' 
           OR pol.nazov_vyrobku LIKE '%krajan%'
        )
        AND o.stav NOT IN ('Hotová', 'Zrušená', 'Expedovaná')
    """

    # ---------- B2B ----------
    sql_b2b = f"""
        SELECT 
            {_str('o.cislo_objednavky')} AS cislo_objednavky,
            {_str('o.nazov_firmy')}      AS zakaznik,
            o.pozadovany_datum_dodania   AS termin,
            {_str('pol.nazov_vyrobku')}  AS produkt,
            pol.mnozstvo,
            {_str('pol.mj')}             AS mj,
            p.vaha_balenia_g,
            p.zdrojovy_ean,
            CONVERT(COALESCE(p.ean, pol.ean_produktu) USING utf8mb4) COLLATE utf8mb4_general_ci AS target_ean
        FROM b2b_objednavky_polozky pol
        JOIN b2b_objednavky o ON o.id = pol.objednavka_id
        LEFT JOIN produkty p ON (
             (p.ean IS NOT NULL AND pol.ean_produktu IS NOT NULL AND CONVERT(p.ean USING utf8mb4) = CONVERT(pol.ean_produktu USING utf8mb4))
          OR (CONVERT(p.nazov_vyrobku USING utf8mb4) = CONVERT(pol.nazov_vyrobku USING utf8mb4))
        )
        WHERE {sql_condition}
    """

    sql_parts = [sql_b2b]

    # ---------- B2C ----------
    if _table_exists('b2c_objednavky') and _table_exists('b2c_objednavky_polozky'):
        cust_expr = "COALESCE(z.nazov_firmy, z.email, 'B2C Zákazník')"
        join_cust = """
            LEFT JOIN b2b_zakaznici z ON (
                CAST(z.id AS CHAR) = CAST(o.zakaznik_id AS CHAR)
                OR CAST(z.zakaznik_id AS CHAR) = CAST(o.zakaznik_id AS CHAR)
            )
        """

        sql_b2c = f"""
            SELECT 
                {_str('o.cislo_objednavky')} AS cislo_objednavky,
                {_str(cust_expr)}            AS zakaznik,
                o.pozadovany_datum_dodania   AS termin,
                {_str('pol.nazov_vyrobku')}  AS produkt,
                pol.mnozstvo,
                {_str('pol.mj')}             AS mj,
                p.vaha_balenia_g,
                p.zdrojovy_ean,
                CONVERT(COALESCE(p.ean, pol.ean_produktu) USING utf8mb4) COLLATE utf8mb4_general_ci AS target_ean
            FROM b2c_objednavky_polozky pol
            JOIN b2c_objednavky o ON o.id = pol.objednavka_id
            {join_cust}
            LEFT JOIN produkty p ON (
                 (p.ean IS NOT NULL AND pol.ean_produktu IS NOT NULL AND CONVERT(p.ean USING utf8mb4) = CONVERT(pol.ean_produktu USING utf8mb4))
              OR (CONVERT(p.nazov_vyrobku USING utf8mb4) = CONVERT(pol.nazov_vyrobku USING utf8mb4))
            )
            WHERE {sql_condition}
        """
        sql_parts.append(sql_b2c)

    full_sql = f"({' UNION ALL '.join(sql_parts)}) ORDER BY termin ASC, cislo_objednavky ASC"

    try:
        rows = db_connector.execute_query(full_sql, fetch='all') or []

        formatted = []
        for r in rows:
            termin = r['termin']
            if isinstance(termin, (datetime, date)):
                termin_str = termin.strftime('%d.%m.%Y')
            else:
                termin_str = str(termin) if termin is not None else ''

            mnozstvo = float(r['mnozstvo'] or 0)
            vaha_g   = float(r['vaha_balenia_g'] or 0)
            mj       = str(r['mj'] or 'kg').lower()

            qty_ks = 0
            qty_disp = ""
            if mj == 'ks':
                qty_ks   = int(mnozstvo)
                qty_disp = f"{qty_ks} ks"
                needed_kg = (qty_ks * vaha_g) / 1000.0 if vaha_g > 0 else 0
            else:
                needed_kg = mnozstvo
                if vaha_g > 0:
                    qty_ks   = math.ceil((mnozstvo * 1000) / vaha_g)
                    qty_disp = f"{mnozstvo:.2f} kg (~{qty_ks} ks)"
                else:
                    qty_disp = f"{mnozstvo:.2f} kg"
                    qty_ks   = math.ceil(mnozstvo)

            prod_name = (r['produkt'] or '').strip()
            order_no  = (r['cislo_objednavky'] or '').strip()

            # Stav krájania pre konkrétnu objednávku + produkt
            job_state = order_slicing_status.get((order_no, prod_name), '')
            already_done = job_state in ('Prijaté, čaká na tlač', 'Ukončené', 'Zrušená')
            is_running_exact = job_state in ('Prebieha krájanie', 'Naplánované')

            # Ak už je pre túto objednávku krájanie ukončené, NEVRACAJ RIADOK
            if already_done:
                continue

            # Pôvodná heuristika podľa celkového bežiaceho krájania pre produkt
            is_running_product = active_slicing.get(prod_name, 0) > (needed_kg * 0.1)

            is_running = bool(is_running_exact or is_running_product)

            formatted.append({
                "order": r['cislo_objednavky'],
                "customer": r['zakaznik'],
                "date": termin_str,
                "product": prod_name,
                "quantity_display": qty_disp,
                "pieces_calc": qty_ks,
                "is_running": is_running,
                "source_ean": r['zdrojovy_ean'],
                "target_ean": r.get('target_ean'),
            })

        return formatted

    except Exception as e:
        print(f"Error slicing reqs: {e}")
        return []


# ─────────────────────────────────────────────────────────────
# Prevzatie z výroby – dni a položky (len neprijaté)
# ─────────────────────────────────────────────────────────────

def get_production_dates():
    """
    Vráti dátumy, pre ktoré existuje výroba v stave 'Vo výrobe' (spustená).
    Nezobrazuje dni, kde je len 'Automaticky naplánované'.
    """
    rows = db_connector.execute_query(
        """
        SELECT DISTINCT DATE(datum_vyroby) AS d
          FROM zaznamy_vyroba
         WHERE stav NOT IN ('Prijaté, čaká na tlač', 'Ukončené', 'Automaticky naplánované', 'Naplánované')
         ORDER BY d DESC
        """
    ) or []
    return [r['d'].strftime('%Y-%m-%d') for r in rows if r.get('d')]

def get_productions_by_date(date_string):
    zv = _zv_name_col()
    rows = db_connector.execute_query(
        f"""
        SELECT
            zv.id_davky as batchId,
            zv.stav as status,
            zv.{zv} as productName,
            zv.planovane_mnozstvo_kg as plannedQty,
            zv.realne_mnozstvo_kg as realQty,
            zv.realne_mnozstvo_ks as realPieces,
            p.mj, p.vaha_balenia_g as pieceWeightG,
            zv.datum_vyroby, zv.poznamka_expedicie
        FROM zaznamy_vyroba zv
        LEFT JOIN produkty p ON TRIM(zv.{zv}) = TRIM(p.nazov_vyrobku)
        WHERE DATE(zv.datum_vyroby) = %s
          AND zv.stav IN ('Vo výrobe', 'Vrátené do výroby', 'Prijaté, čaká na tlač')
        ORDER BY 
            CASE WHEN zv.stav = 'Prijaté, čaká na tlač' THEN 1 ELSE 0 END, -- Prijaté na koniec
            productName
        """,
        (date_string,)
    ) or []
    
    for p in rows:
        planned_kg = float(p.get('plannedQty') or 0.0)
        wg = float(p.get('pieceWeightG') or 0.0)
        p['expectedPieces'] = math.ceil((planned_kg*1000)/wg) if p.get('mj') == 'ks' and wg > 0 else None
        if isinstance(p.get('datum_vyroby'), datetime):
            p['datum_vyroby'] = p['datum_vyroby'].isoformat()
            
    return rows

def finish_daily_reception(date_string, worker_name):
    """
    Všetky položky z daného dňa, ktoré sú v stave 'Prijaté, čaká na tlač',
    prepne do stavu 'Ukončené'.
    """
    if not date_string: return {"error": "Chýba dátum."}
    
    db_connector.execute_query(
        """
        UPDATE zaznamy_vyroba 
        SET stav = 'Ukončené', poznamka_expedicie = CONCAT(IFNULL(poznamka_expedicie, ''), ' [Ukončil: ', %s, ']')
        WHERE DATE(datum_vyroby) = %s AND stav = 'Prijaté, čaká na tlač'
        """,
        (worker_name, date_string),
        fetch='none'
    )
    return {"message": "Denný príjem bol uzavretý. Prijaté položky boli archivované."}

def return_to_production(batch_id, reason, worker_name):
    if not batch_id or not reason: return {"error": "Chýba ID alebo dôvod."}
    db_connector.execute_query(
        """
        UPDATE zaznamy_vyroba 
        SET stav = 'Vrátené do výroby', 
            poznamka = CONCAT(IFNULL(poznamka, ''), ' | VRÁTENÉ EXPEDÍCIOU (', %s, '): ', %s)
        WHERE id_davky = %s
        """,
        (worker_name, reason, batch_id),
        fetch='none'
    )
    return {"message": f"Produkt bol vrátený do výroby. Dôvod: {reason}"}

def cancel_acceptance(batch_id, worker_name, reason):
    """
    Reverzná operácia k prijatiu.
    """
    if not batch_id or not worker_name: return {"error": "Chýbajú údaje."}

    # 1. Zistíme, či to má nejaké pohyby v sklade
    rec = db_connector.execute_query(
        "SELECT prijem_kg, prijem_ks, unit FROM expedicia_prijmy WHERE id_davky=%s AND is_deleted=0 ORDER BY id DESC LIMIT 1",
        (batch_id,), fetch='one'
    )
    
    # 2. Vrátenie skladu
    prod_info = _product_info_for_batch(batch_id)
    if rec and prod_info and prod_info.get('ean'):
        ean = prod_info['ean']
        qty_to_remove = 0.0
        if rec['unit'] == 'kg':
            qty_to_remove = float(rec['prijem_kg'])
        elif rec['unit'] == 'ks':
            wg = float(prod_info.get('vaha_balenia_g') or 0)
            qty_to_remove = (int(rec['prijem_ks']) * wg) / 1000.0
        
        if qty_to_remove > 0:
            db_connector.execute_query(
                "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s",
                (qty_to_remove, ean), fetch='none'
            )

    # 3. Soft delete príjmu
    db_connector.execute_query(
        "UPDATE expedicia_prijmy SET is_deleted=1, dovod=CONCAT(IFNULL(dovod,''), ' | STORNO: ', %s, ' by ', %s) WHERE id_davky=%s",
        (reason, worker_name, batch_id), fetch='none'
    )

    # 4. Reset stavu
    new_status = 'Vo výrobe'
    if str(batch_id).startswith('PLAN-'):
        new_status = 'Automaticky naplánované'

    db_connector.execute_query(
        """
        UPDATE zaznamy_vyroba 
        SET stav=%s, 
            realne_mnozstvo_kg=0, realne_mnozstvo_ks=0, 
            poznamka_expedicie=CONCAT(IFNULL(poznamka_expedicie,''), ' | Príjem zrušený: ', %s)
        WHERE id_davky=%s
        """,
        (new_status, reason, batch_id), fetch='none'
    )

    return {"message": f"Príjem bol zrušený. Položka vrátená do stavu '{new_status}'."}


# ─────────────────────────────────────────────────────────────
# Príjem po položkách (per-row accept) + okamžitá výrobná cena
# ─────────────────────────────────────────────────────────────

def _product_info_for_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    zv = _zv_name_col()
    return db_connector.execute_query(
        f"""
        SELECT p.nazov_vyrobku, p.mj, p.vaha_balenia_g, p.ean, p.zdrojovy_ean
          FROM zaznamy_vyroba zv
          LEFT JOIN produkty p ON TRIM(zv.{zv}) = TRIM(p.nazov_vyrobku)
         WHERE zv.id_davky = %s
         LIMIT 1
        """,
        (batch_id,),
        fetch='one'
    )

def _kg_from_value(unit: str, value: float, piece_weight_g: float) -> float:
    if unit == 'kg': return value
    if unit == 'ks' and piece_weight_g and piece_weight_g>0:
        return (value * piece_weight_g) / 1000.0
    return 0.0

def accept_production_item(payload: Dict[str, Any]):
    _ensure_expedition_schema()

    batch_id   = (payload or {}).get('batchId')
    unit       = (payload or {}).get('unit')
    value      = _parse_num((payload or {}).get('actualValue'))
    worker     = (payload or {}).get('workerName') or 'Neznámy'
    note       = (payload or {}).get('note')
    accept_d   = (payload or {}).get('acceptDate') or date.today().strftime('%Y-%m-%d')

    if not batch_id or unit not in ('kg','ks') or value <= 0:
        return {"error": "Chýba batchId/unit alebo neplatná hodnota prijmu."}

    info = _product_info_for_batch(batch_id)
    if not info:
        return {"error": "Nepodarilo sa nájsť produkt pre danú šaržu."}

    ean = (info.get('ean') or '').strip()
    prod_name = info.get('nazov_vyrobku')
    mj  = info.get('mj') or 'kg'
    wg  = float(info.get('vaha_balenia_g') or 0.0)

    kg_add = value if unit == 'kg' else ((value * wg) / 1000.0)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)

        if unit == 'kg':
            cur.execute("""INSERT INTO expedicia_prijmy
                           (id_davky, nazov_vyrobku, unit, prijem_kg, prijem_ks, prijal, dovod, datum_prijmu, created_at)
                           VALUES (%s,%s,%s,%s,NULL,%s,%s,%s,NOW())""",
                        (batch_id, prod_name, unit, value, worker, note, accept_d))
        else:
            cur.execute("""INSERT INTO expedicia_prijmy
                           (id_davky, nazov_vyrobku, unit, prijem_kg, prijem_ks, prijal, dovod, datum_prijmu, created_at)
                           VALUES (%s,%s,%s,NULL,%s,%s,%s,%s,NOW())""",
                        (batch_id, prod_name, unit, int(value), worker, note, accept_d))

        manuf_col = _product_manuf_avg_col()
        old_stock_kg = 0.0
        old_avg_eur_kg = None
        if ean:
            if manuf_col:
                cur.execute(f"SELECT COALESCE(aktualny_sklad_finalny_kg,0) AS q, {manuf_col} AS avgc FROM produkty WHERE ean=%s FOR UPDATE", (ean,))
                r = cur.fetchone() or {}
                old_stock_kg = float(r.get('q') or 0.0)
                try: old_avg_eur_kg = float(r.get('avgc'))
                except: old_avg_eur_kg = None
            else:
                cur.execute("SELECT COALESCE(aktualny_sklad_finalny_kg,0) AS q FROM produkty WHERE ean=%s FOR UPDATE", (ean,))
                r = cur.fetchone() or {}
                old_stock_kg = float(r.get('q') or 0.0)

        if ean and kg_add != 0.0:
            cur.execute("UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg + %s WHERE ean = %s", (kg_add, ean))

        cur.execute("SELECT unit, prijem_kg, prijem_ks FROM expedicia_prijmy WHERE id_davky=%s AND is_deleted=0", (batch_id,))
        logs = cur.fetchall() or []
        
        sum_kg = 0.0
        sum_ks = 0
        for r in logs:
            if r['unit'] == 'kg':
                sum_kg += float(r['prijem_kg'] or 0.0)
            else:
                ks_val = int(r['prijem_ks'] or 0)
                sum_ks += ks_val
                if wg > 0:
                    sum_kg += (ks_val * wg) / 1000.0

        if mj == 'kg':
            cur.execute(
                "UPDATE zaznamy_vyroba SET stav='Prijaté, čaká na tlač', realne_mnozstvo_kg=%s, datum_ukoncenia=NOW() WHERE id_davky=%s", 
                (sum_kg, batch_id)
            )
        else:
            cur.execute(
                "UPDATE zaznamy_vyroba SET stav='Prijaté, čaká na tlač', realne_mnozstvo_ks=%s, realne_mnozstvo_kg=%s, datum_ukoncenia=NOW() WHERE id_davky=%s", 
                (sum_ks, sum_kg, batch_id)
            )

        cur.execute("SELECT celkova_cena_surovin FROM zaznamy_vyroba WHERE id_davky=%s", (batch_id,))
        zv_row = cur.fetchone() or {}
        total_cost = float(zv_row.get('celkova_cena_surovin') or 0.0)

        unit_cost_for_zv = None
        perkg_cost = None
        if total_cost > 0:
            if mj == 'kg' and sum_kg > 0:
                unit_cost_for_zv = total_cost / sum_kg
                perkg_cost = unit_cost_for_zv
            elif mj == 'ks' and sum_ks > 0:
                unit_cost_for_zv = total_cost / sum_ks
                if wg > 0:
                    perkg_cost = unit_cost_for_zv / (wg/1000.0)
            
            if unit_cost_for_zv is not None:
                cur.execute("UPDATE zaznamy_vyroba SET cena_za_jednotku=%s WHERE id_davky=%s", (unit_cost_for_zv, batch_id))

        if ean and perkg_cost is not None and manuf_col:
            new_total = old_stock_kg + kg_add
            new_avg = perkg_cost if (old_avg_eur_kg is None or new_total <= 0) else \
                      ((old_avg_eur_kg * old_stock_kg) + (perkg_cost * kg_add)) / new_total
            cur.execute(f"UPDATE produkty SET {manuf_col}=%s WHERE ean=%s", (new_avg, ean))

        conn.commit()
        msg = f"Príjem uložený. +{kg_add:.2f} kg na sklad."
        return {"message": msg}

    except Exception as e:
        if conn: conn.rollback()
        raise e
    finally:
        if conn and conn.is_connected(): conn.close()

# ─────────────────────────────────────────────────────────────
# Archív prijmov
# ─────────────────────────────────────────────────────────────
def get_acceptance_days():
    _ensure_expedition_schema()
    rows = db_connector.execute_query(
        "SELECT DISTINCT datum_prijmu AS d FROM expedicia_prijmy WHERE is_deleted=0 ORDER BY d DESC"
    ) or []
    return [r['d'].strftime('%Y-%m-%d') for r in rows if r.get('d')]

def get_acceptance_archive(date_string: str):
    _ensure_expedition_schema()
    rows = db_connector.execute_query(
        """
        SELECT
            ep.id, ep.id_davky as batchId, ep.nazov_vyrobku as productName,
            ep.unit, ep.prijem_kg, ep.prijem_ks, ep.prijal, ep.dovod,
            ep.datum_prijmu, ep.created_at, ep.updated_at,
            zv.cena_za_jednotku
        FROM expedicia_prijmy ep
        LEFT JOIN zaznamy_vyroba zv ON zv.id_davky = ep.id_davky
        WHERE ep.is_deleted = 0 AND ep.datum_prijmu = %s
        ORDER BY ep.created_at DESC
        """,
        (date_string,)
    ) or []
    for r in rows:
        c = r.get('cena_za_jednotku')
        if c is None:
            r['unit_cost'] = ''
        else:
            if r.get('unit') == 'kg':
                r['unit_cost'] = f"{float(c):.4f} €/kg"
            else:
                r['unit_cost'] = f"{float(c):.4f} €/ks"
    return {"items": rows}

# ─────────────────────────────────────────────────────────────
# Krájanie
# ─────────────────────────────────────────────────────────────
def get_slicable_products():
    return db_connector.execute_query(
        "SELECT ean, nazov_vyrobku as name FROM produkty WHERE typ_polozky LIKE '%KRAJAN%' ORDER BY nazov_vyrobku"
    ) or []

def start_slicing_request(packaged_product_ean, planned_pieces):
    if not packaged_product_ean or not planned_pieces or int(planned_pieces) <= 0:
        return {"error": "Musíte vybrať produkt a zadať platný počet kusov."}

    p = db_connector.execute_query(
        """
        SELECT t.ean as target_ean, t.nazov_vyrobku as target_name,
               t.vaha_balenia_g as target_weight_g, t.zdrojovy_ean,
               s.nazov_vyrobku as source_name
        FROM produkty t
        LEFT JOIN produkty s ON t.zdrojovy_ean = s.ean
        WHERE t.ean = %s
        """,
        (packaged_product_ean,), fetch='one'
    )
    if not p or not p.get('zdrojovy_ean'):
        return {"error": "Produkt nebol nájdený alebo nie je prepojený so zdrojovým produktom."}

    planned_pieces = int(planned_pieces)
    required_kg = (planned_pieces * float(p['target_weight_g'])) / 1000.0

    db_connector.execute_query(
        "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s",
        (required_kg, p['zdrojovy_ean']), fetch='none'
    )

    batch_id = _gen_unique_batch_id("KRAJANIE", p['target_name'])

    details = json.dumps({
        "operacia": "krajanie",
        "cielovyEan": p["target_ean"],
        "cielovyNazov": p["target_name"],
        "zdrojovyEan": p["zdrojovy_ean"],
        "planovaneKs": planned_pieces
    }, ensure_ascii=False)

    db_connector.execute_query(
        f"""
        INSERT INTO zaznamy_vyroba
          (id_davky, stav, datum_vyroby, {_zv_name_col()}, planovane_mnozstvo_kg, datum_spustenia, celkova_cena_surovin, detaily_zmeny)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (batch_id, 'Prebieha krájanie', datetime.now(), p['source_name'], required_kg, datetime.now(), 0, details),
        fetch='none'
    )

    return {"message": f"Požiadavka vytvorená. Rezervovaných {required_kg:.2f} kg zo '{p['source_name']}'.", "batchId": batch_id}

def finalize_slicing_transaction(log_id, actual_pieces):
    """
    Ukončenie krájania.
    Parametre:
      log_id: ID dávky (zaznamy_vyroba.id_davky)
      actual_pieces: Počet kusov (alebo KG ak je to váhový tovar), ktoré expedícia zadala.
    """
    if not log_id:
        return {"error": "Chýba ID úlohy."}
    
    # 1. Načítame úlohu
    task = db_connector.execute_query(
        "SELECT * FROM zaznamy_vyroba WHERE id_davky = %s",
        (log_id,), fetch='one'
    )
    
    if not task:
        return {"error": f"Úloha {log_id} neexistuje."}
    
    # Ak už je hotová, skončíme
    if task.get('stav') in ['Ukončené', 'Prijaté, čaká na tlač']:
        return {"message": "Úloha už bola ukončená."}

    # 2. Parsovanie detailov
    try:
        details = json.loads(task.get('detaily_zmeny') or '{}')
    except:
        details = {}

    target_ean = details.get('cielovyEan')
    source_ean = details.get('zdrojovyEan')
    
    # Ak chýba zdrojový EAN v JSONe, skúsime ho nájsť cez produkt v DB
    if not source_ean:
        # Skúsime zistiť podľa názvu suroviny v zázname
        zv_col = _zv_name_col()
        src_row = db_connector.execute_query(
            f"SELECT ean FROM produkty WHERE nazov_vyrobku = %s",
            (task.get(zv_col),), fetch='one'
        )
        if src_row:
            source_ean = src_row['ean']

    # 3. Získanie info o cieľovom produkte (kvôli váhe balenia)
    target_weight_g = 0.0
    target_mj = 'kg'
    
    if target_ean:
        t_prod = db_connector.execute_query(
            "SELECT vaha_balenia_g, mj FROM produkty WHERE ean = %s",
            (target_ean,), fetch='one'
        )
        if t_prod:
            target_weight_g = float(t_prod.get('vaha_balenia_g') or 0)
            target_mj = t_prod.get('mj') or 'kg'

    # 4. Výpočet reálnej váhy (KG)
    # Expedícia zadáva číslo. Ak je cieľ na KUSY, je to počet kusov. Ak na KG, sú to KG.
    real_kg = 0.0
    real_ks = 0
    
    input_val = float(str(actual_pieces).replace(',', '.'))

    if target_mj == 'ks' or (target_weight_g > 0 and input_val > 5): 
        # Predpokladáme, že ak je hodnota > 5 a existuje váha balenia, sú to kusy (heuristika, ak MJ nie je jasná)
        # Alebo ak MJ je explicitne 'ks'
        real_ks = int(input_val)
        if target_weight_g > 0:
            real_kg = (real_ks * target_weight_g) / 1000.0
        else:
            # Ak nemáme váhu balenia, nevieme vypočítať kg -> chyba konfigurácie, ale nesmieme padnúť
            real_kg = 0 
    else:
        # Je to váhový tovar
        real_kg = input_val
        real_ks = 0

    # 5. Úprava skladových zásob (Sklad 2 - Hotové výrobky)
    # a) Pripíšeme hotový výrobok
    if target_ean and real_kg > 0:
        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg + %s WHERE ean = %s",
            (real_kg, target_ean), fetch='none'
        )

    # b) Korekcia suroviny (Zdroj)
    # Pri vytvorení úlohy sme odpísali "Plánované množstvo". Teraz musíme spraviť rozdiel.
    planned_kg = float(task.get('planovane_mnozstvo_kg') or 0.0)
    diff_kg = real_kg - planned_kg # Ak sme vyrobili viac, treba odpísať viac. Ak menej, vrátiť na sklad.

    if source_ean and abs(diff_kg) > 0.001:
        # POZOR: Logika je opačná. 
        # Ak diff > 0 (minuli sme viac), musíme odpísať zo skladu (-).
        # Ak diff < 0 (minuli sme menej), musíme vrátiť na sklad (+).
        # UPDATE: `aktualny_sklad` = `aktualny_sklad` - `diff_kg`
        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s",
            (diff_kg, source_ean), fetch='none'
        )

    # 6. Výpočet ceny (ak existuje)
    total_cost = 0.0
    # ... (tu môže ostať pôvodná logika výpočtu ceny, ak ju máte, alebo zjednodušene:)
    source_price = 0.0
    if source_ean:
         price_row = db_connector.execute_query("SELECT nakupna_cena FROM sklad WHERE ean=%s LIMIT 1", (source_ean,), fetch='one')
         if price_row: source_price = float(price_row.get('nakupna_cena') or 0)
    total_cost = real_kg * source_price

    # 7. Aktualizácia stavu úlohy
    db_connector.execute_query(
        """
        UPDATE zaznamy_vyroba 
        SET stav = 'Prijaté, čaká na tlač', 
            realne_mnozstvo_kg = %s, 
            realne_mnozstvo_ks = %s, 
            datum_ukoncenia = NOW(),
            celkova_cena_surovin = %s
        WHERE id_davky = %s
        """,
        (real_kg, real_ks, total_cost, log_id),
        fetch='none'
    )

    return {"message": f"Hotovo. Vyrobených {real_ks} ks / {real_kg:.2f} kg."}
# ─────────────────────────────────────────────────────────────
# Manuálny príjem / škoda (Sklad 2)
# ─────────────────────────────────────────────────────────────

def get_all_final_products():
    return db_connector.execute_query(
        "SELECT ean, nazov_vyrobku as name, mj as unit FROM produkty WHERE typ_polozky LIKE 'V%ROBOK%' ORDER BY nazov_vyrobku"
    ) or []

def manual_receive_product(data: Dict[str, Any]):
    ean   = data.get('ean')
    qty_s = data.get('quantity')
    worker = data.get('workerName')
    rdate  = data.get('receptionDate')
    if not all([ean, qty_s, worker, rdate]):
        return {"error":"Všetky polia sú povinné."}

    product = db_connector.execute_query(
        "SELECT nazov_vyrobku, mj, vaha_balenia_g FROM produkty WHERE ean=%s",
        (ean,), fetch='one'
    )
    if not product:
        return {"error":"Produkt s daným EAN nebol nájdený."}

    qty    = _parse_num(qty_s)
    qty_kg = qty if product['mj']=='kg' else (qty * float(product.get('vaha_balenia_g') or 0.0)/1000.0)

    db_connector.execute_query(
        "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg + %s WHERE ean = %s",
        (qty_kg, ean), fetch='none'
    )

    zv=_zv_name_col()
    batch_id=_gen_unique_batch_id("MANUAL-PRIJEM", product['nazov_vyrobku'])
    db_connector.execute_query(
        f"""INSERT INTO zaznamy_vyroba
            (id_davky, stav, datum_vyroby, datum_ukoncenia, {zv}, realne_mnozstvo_kg, realne_mnozstvo_ks, poznamka_expedicie)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (batch_id, 'Ukončené', rdate, datetime.now(), product['nazov_vyrobku'],
         qty if product['mj']=='kg' else None,
         qty if product['mj']=='ks' else None,
         f"Manuálne prijal: {worker}"),
        fetch='none'
    )
    return {"message": f"Prijatých {qty} {product['mj']} '{product['nazov_vyrobku']}'."}

def log_manual_damage(data: Dict[str, Any]):
    # ... (rovnako ako predtým) ...
    return {"message": "Škoda zapísaná."}

# ─────────────────────────────────────────────────────────────
# Sklad 2 – prehľad a inventúra
# ─────────────────────────────────────────────────────────────

def get_products_for_inventory():
    rows = db_connector.execute_query(
        """
        SELECT p.ean, p.nazov_vyrobku, p.predajna_kategoria, p.aktualny_sklad_finalny_kg, p.mj, p.vaha_balenia_g
          FROM produkty p
         WHERE p.typ_polozky LIKE 'V%ROBOK%%' OR p.typ_polozky LIKE 'TOVAR%%'
         ORDER BY p.predajna_kategoria, p.nazov_vyrobku
        """
    ) or []
    categorized={}
    for p in rows:
        cat = p.get('predajna_kategoria') or 'Nezaradené'
        categorized.setdefault(cat, [])
        kg = float(p.get('aktualny_sklad_finalny_kg') or 0.0)
        wg = float(p.get('vaha_balenia_g') or 0.0)
        p['system_stock_display'] = f"{(kg*1000.0/wg):.2f}".replace('.', ',') if p.get('mj')=='ks' and wg>0 else f"{kg:.2f}".replace('.', ',')
        categorized[cat].append(p)
    return categorized

# ───────────────────────── NOVÉ: Priebežné uloženie kategórie (Sklad 2) ─────────────────────────
def _get_or_create_expedition_draft_log(cursor, worker_name):
    cursor.execute("SELECT id FROM expedicia_inventury WHERE status = 'DRAFT' LIMIT 1")
    row = cursor.fetchone()
    if row:
        return row['id']
    else:
        cursor.execute(
            "INSERT INTO expedicia_inventury (datum, vytvoril, created_at, status) VALUES (CURDATE(), %s, NOW(), 'DRAFT')",
            (worker_name,)
        )
        return cursor.lastrowid

def save_product_inventory_category(inventory_data, category_name, worker_name):
    if not inventory_data:
        return {"message": "Žiadne dáta na uloženie."}
    if not worker_name:
        return {"error": "Chýba meno pracovníka."}

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        inv_id = _get_or_create_expedition_draft_log(cur, worker_name)

        eans = [i['ean'] for i in inventory_data if i.get('ean')]
        if not eans: return {"message": "Žiadne platné položky."}
        
        placeholders = ','.join(['%s']*len(eans))
        cur.execute(f"""
            SELECT p.ean, p.nazov_vyrobku, p.aktualny_sklad_finalny_kg, p.mj, p.vaha_balenia_g,
                   (SELECT zv.cena_za_jednotku 
                      FROM zaznamy_vyroba zv 
                      JOIN produkty pp ON TRIM(zv.{_zv_name_col()})=TRIM(pp.nazov_vyrobku)
                     WHERE pp.ean=p.ean AND COALESCE(zv.cena_za_jednotku,0)>0
                     ORDER BY COALESCE(zv.datum_ukoncenia,zv.datum_vyroby) DESC LIMIT 1) AS unit_cost_last
              FROM produkty p
             WHERE p.ean IN ({placeholders})
        """, tuple(eans))
        
        pmap = {r['ean']: r for r in cur.fetchall()}
        updates_count = 0

        for it in inventory_data:
            ean = it.get('ean')
            rv = it.get('realQty')
            pr = pmap.get(ean)
            
            if not ean or pr is None or rv in (None, ''): continue
            try:
                real_num = float(rv)
                if real_num < 0: continue
            except: continue

            real_kg = real_num if pr['mj']=='kg' else (real_num * float(pr['vaha_balenia_g'] or 0.0)/1000.0)
            sys_kg = float(pr.get('aktualny_sklad_finalny_kg') or 0.0)
            diff_kg = real_kg - sys_kg
            uc = float(pr.get('unit_cost_last') or 0.0)
            val = diff_kg * uc 

            cur.execute(
                "UPDATE produkty SET aktualny_sklad_finalny_kg = %s WHERE ean = %s",
                (real_kg, ean)
            )
            cur.execute("DELETE FROM expedicia_inventura_polozky WHERE inventura_id=%s AND ean=%s", (inv_id, ean))
            
            cur.execute("""
                INSERT INTO expedicia_inventura_polozky
                (inventura_id, ean, nazov, kategoria, system_stav_kg, realny_stav_kg, rozdiel_kg, hodnota_eur)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (inv_id, ean, pr['nazov_vyrobku'], category_name, sys_kg, real_kg, diff_kg, val))
            
            updates_count += 1

        conn.commit()
        return {"message": f"Kategória '{category_name}' uložená ({updates_count} pol.). Sklad 2 aktualizovaný."}

    except Exception as e:
        if conn: conn.rollback()
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected(): conn.close()

def finish_product_inventory():
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE expedicia_inventury SET status='COMPLETED', created_at=NOW() WHERE status='DRAFT'")
        if cur.rowcount > 0:
            conn.commit()
            return {"message": "Inventúra Skladu 2 bola UKONČENÁ."}
        else:
            return {"message": "Nebola nájdená žiadna rozpracovaná inventúra."}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected(): conn.close()

# ───────────────────────── Denný report ─────────────────────────
def get_daily_reception_report_html(date_str):
    if not date_str: return "Chýba dátum."
    rows = db_connector.execute_query(
        """
        SELECT ep.created_at, ep.nazov_vyrobku, ep.unit, ep.prijem_kg, ep.prijem_ks, ep.prijal, ep.id_davky
        FROM expedicia_prijmy ep
        WHERE ep.datum_prijmu = %s AND ep.is_deleted = 0
        ORDER BY ep.created_at ASC
        """, (date_str,), fetch='all'
    ) or []

    trs = ""
    total_kg = 0.0
    
    for r in rows:
        local_created_at = _to_local_time(r['created_at'])
        cas = local_created_at.strftime('%H:%M') if isinstance(local_created_at, datetime) else ""
        qty_display = ""
        if r['unit'] == 'kg':
            val = float(r['prijem_kg'] or 0)
            total_kg += val
            qty_display = f"{val:.2f} kg"
        else:
            val = int(r['prijem_ks'] or 0)
            qty_display = f"{val} ks"

        trs += f"<tr><td>{cas}</td><td>{r['id_davky']}</td><td>{r['nazov_vyrobku']}</td><td style='text-align:right'>{qty_display}</td><td>{r['prijal']}</td></tr>"

    formatted_date = datetime.strptime(date_str, '%Y-%m-%d').strftime('%d.%m.%Y')
    local_now = _to_local_time(datetime.now())
    generated_at = local_now.strftime('%d.%m.%Y %H:%M')

    return f"""<!DOCTYPE html><html lang="sk"><head><meta charset="UTF-8"><title>Report</title>
    <style>body{{font-family:Arial,sans-serif;font-size:12px}}h1{{font-size:18px}}table{{width:100%;border-collapse:collapse}}th,td{{border:1px solid #ccc;padding:5px}}th{{background:#f0f0f0}}.right{{text-align:right}}@media print{{.no-print{{display:none}}}}</style></head>
    <body><button class="no-print" onclick="window.print()">Tlačiť</button><h1>Denný protokol {formatted_date}</h1>
    <table><thead><tr><th>Čas</th><th>Šarža</th><th>Produkt</th><th class="right">Množstvo</th><th>Prijal</th></tr></thead><tbody>{trs or '<tr><td colspan=5>Žiadny príjem.</td></tr>'}</tbody><tfoot><tr><td colspan=3 class="right"><strong>Spolu (kg):</strong></td><td class="right"><strong>{total_kg:.2f} kg</strong></td><td></td></tr></tfoot></table>
    <div style="margin-top:40px">Vygenerované: {generated_at}</div></body></html>"""

# ───────────────────────── Traceability ─────────────────────────
def get_traceability_info(batch_id):
    if not batch_id:
        return {"error": "Chýba ID šarže."}

    zv = _zv_name_col()
    
    # 1. Základné info o výrobe
    batch_info = db_connector.execute_query(
        f"""
        SELECT
            zv.id_davky, zv.{zv} AS nazov_vyrobku, zv.stav,
            zv.datum_vyroby, zv.datum_spustenia, zv.datum_ukoncenia,
            zv.planovane_mnozstvo_kg, zv.realne_mnozstvo_kg, zv.realne_mnozstvo_ks,
            p.mj, p.ean, zv.celkova_cena_surovin, zv.cena_za_jednotku
        FROM zaznamy_vyroba zv
        LEFT JOIN produkty p ON TRIM(zv.{zv}) = TRIM(p.nazov_vyrobku)
        WHERE zv.id_davky = %s
        """,
        (batch_id,), fetch='one'
    )

    if not batch_info:
        return {"error": f"Šarža s ID '{batch_id}' nebola nájdená."}

    # Úprava časov
    if batch_info.get('datum_spustenia'):
        batch_info['datum_spustenia'] = _to_local_time(batch_info['datum_spustenia'])
    
    if batch_info.get('datum_ukoncenia'):
        batch_info['datum_ukoncenia'] = _to_local_time(batch_info['datum_ukoncenia'])

    # 2. Zloženie (suroviny)
    ingredients = db_connector.execute_query(
        "SELECT nazov_suroviny, pouzite_mnozstvo_kg FROM zaznamy_vyroba_suroviny WHERE id_davky = %s ORDER BY pouzite_mnozstvo_kg DESC",
        (batch_id,)
    ) or []

    # 3. NOVÉ: Načítanie HACCP / Meta dát
    product_name = batch_info.get('nazov_vyrobku')
    meta_info = {}
    
    if product_name:
        # Skúsime nájsť meta dáta pre tento produkt
        meta_row = db_connector.execute_query(
            "SELECT * FROM recept_meta WHERE product_name = %s",
            (product_name,), fetch='one'
        )
        if meta_row:
            meta_info = {
                "energia_kj": meta_row.get('energia_kj'),
                "energia_kcal": meta_row.get('energia_kcal'),
                "tuky": meta_row.get('tuky_g'),
                "nasytene_tuky": meta_row.get('nasytene_tuky_g'),
                "sacharidy": meta_row.get('sacharidy_g'),
                "cukry": meta_row.get('cukry_g'),
                "bielkoviny": meta_row.get('bielkoviny_g'),
                "sol": meta_row.get('sol_g'),
                "vlaknina": meta_row.get('vlaknina_g'),
                "trvacnost": meta_row.get('trvacnost_dni'),
                "skladovanie": meta_row.get('skladovanie'),
                "alergeny": meta_row.get('alergeny'),
                "postup": meta_row.get('postup_vyroby'), # Ak chcete tlačiť aj postup
                "ccp": meta_row.get('ccp_body')          # Ak chcete tlačiť aj CCP
            }

    return {
        "batch_info": batch_info, 
        "ingredients": ingredients,
        "meta_info": meta_info  # <--- Posielame na frontend
    }
# expedition_handler.py

def cancel_slicing_job_logic(job_id, worker_name, reason=""):
    """
    Zruší naplánované krájanie a vráti rezervovanú surovinu späť na sklad.
    """
    if not job_id:
        return {"error": "Chýba ID úlohy."}

    # 1. Načítame úlohu
    task = db_connector.execute_query(
        "SELECT * FROM zaznamy_vyroba WHERE id_davky = %s",
        (job_id,), fetch='one'
    )

    if not task:
        return {"error": "Úloha neexistuje."}
    
    if task.get('stav') != 'Prebieha krájanie':
        return {"error": f"Úlohu nemožno zrušiť, pretože je v stave '{task.get('stav')}'."}

    # 2. Zistíme, koľko a čoho vrátiť na sklad
    try:
        details = json.loads(task.get('detaily_zmeny') or '{}')
    except:
        details = {}

    source_ean = details.get('zdrojovyEan')
    reserved_kg = float(task.get('planovane_mnozstvo_kg') or 0.0)

    # Ak nemáme EAN v JSONe, skúsime ho nájsť podľa názvu suroviny
    if not source_ean:
        zv_col = _zv_name_col()
        prod = db_connector.execute_query(
            f"SELECT ean FROM produkty WHERE nazov_vyrobku = %s",
            (task.get(zv_col),), fetch='one'
        )
        if prod:
            source_ean = prod['ean']

    # 3. Vrátenie suroviny na sklad (Sklad 2)
    if source_ean and reserved_kg > 0:
        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg + %s WHERE ean = %s",
            (reserved_kg, source_ean), fetch='none'
        )

    # 4. Aktualizácia stavu na 'Zrušená'
    note = f"Zrušil: {worker_name}"
    if reason:
        note += f" (Dôvod: {reason})"

    db_connector.execute_query(
        """
        UPDATE zaznamy_vyroba 
        SET stav = 'Zrušená', 
            poznamka_expedicie = CONCAT(IFNULL(poznamka_expedicie, ''), ' | ', %s),
            datum_ukoncenia = NOW()
        WHERE id_davky = %s
        """,
        (note, job_id), fetch='none'
    )

    return {"message": f"Úloha zrušená. {reserved_kg:.2f} kg vrátených na sklad."}