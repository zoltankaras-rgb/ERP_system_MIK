# leader_handler.py — API pre vedúceho expedície (B2B/B2C/Forecast/Plan)
# Zlúčené so schémou DB (pozri schema_prompt.md). Flexibilné voči názvom stĺpcov.
# (C) tvoj projekt

from flask import Blueprint, json, request, jsonify, redirect
from datetime import datetime, date, timedelta
from typing import Any, Optional
import os
import pdf_generator
import notification_handler
import expedition_handler
import random
import b2b_handler # IMPORT PRE ZRKADLENIE LOGISTIKY

import db_connector
from auth_handler import login_required

leader_bp = Blueprint('leader', __name__, url_prefix='/api/leader')

# =============================================================================
# Helpers
# =============================================================================

def _get_conn():
    """Vráť natívne DB pripojenie (rovnaké ako používa db_connector)."""
    if hasattr(db_connector, 'get_connection'):
        return db_connector.get_connection()
    if hasattr(db_connector, 'pool'):
        return db_connector.pool.get_connection()
    if hasattr(db_connector, 'cnx'):
        return db_connector.cnx()
    # fallback – ak by nebolo nič, vyhodiť:
    raise RuntimeError('db_connector nemá get_connection/pool/cnx')

def _table_exists(table: str) -> bool:
    try:
        rows = db_connector.execute_query("SHOW TABLES LIKE %s", (table,))
        return bool(rows)
    except Exception:
        return False

def _table_cols(table: str) -> set[str]:
    rows = db_connector.execute_query(f"SHOW COLUMNS FROM `{table}`") or []
    out = []
    for r in rows:
        fld = r.get('Field') if isinstance(r, dict) else r[0]
        out.append(str(fld).lower())
    return set(out)

def _pick(cols: set[str], candidates: list[str]) -> Optional[str]:
    for c in candidates:
        if c and c.lower() in cols:
            return c
    return None

def _pick_col(table: str, candidates):
    """Vyber reálne meno stĺpca (vracia správny case)."""
    try:
        rows = db_connector.execute_query(f"SHOW COLUMNS FROM `{table}`") or []
        have = {
            (r.get('Field') if isinstance(r, dict) else r[0]).lower():
            (r.get('Field') if isinstance(r, dict) else r[0])
            for r in rows
        }
        for c in candidates:
            k = c.lower()
            if k in have:
                return have[k]
    except Exception:
        pass
    return None

def _iso(d: Any) -> Optional[str]:
    if not d:
        return None
    if isinstance(d, (datetime, date)):
        return d.strftime('%Y-%m-%d')
    try:
        return datetime.fromisoformat(str(d)).strftime('%Y-%m-%d')
    except Exception:
        return None

def _d(s: Optional[str]) -> str:
    if not s:
        return date.today().strftime('%Y-%m-%d')
    try:
        return datetime.strptime(s, "%Y-%m-%d").date().strftime("%Y-%m-%d")
    except Exception:
        return date.today().strftime("%Y-%m-%d")

def _workdays(start: date, days: int = 7):
    out, cur = [], start
    while len(out) < days:
        if cur.weekday() < 5:
            out.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return out

def _gen_b2b_no(customer_id=None) -> str:
    ts = datetime.now().strftime('%Y%m%d%H%M%S')
    suffix = str(customer_id) if customer_id else f"{random.randint(1000,9999)}"
    return f"B2B-{suffix}-{ts}"

# =============================================================================
# Katalóg: názvy podľa EAN (leader-safe)
# =============================================================================

@leader_bp.get('/catalog/names')
@login_required(role=('veduci','admin'))
def leader_catalog_names():
    raw = (request.args.get('eans') or '').strip()
    eans = [e.strip() for e in raw.split(',') if e.strip()]
    if not eans:
        return jsonify({})

    def try_map(table, ean_field, name_field):
        ph = ",".join(["%s"] * len(eans))
        rows = db_connector.execute_query(
            f"SELECT `{ean_field}` AS ean, `{name_field}` AS name "
            f"FROM `{table}` WHERE `{ean_field}` IN ({ph})",
            tuple(eans)
        ) or []
        out = {}
        for r in rows:
            en = str(r.get('ean') or '')
            nm = (r.get('name') or '').strip()
            if en and nm:
                out[en] = nm
        return out

    candidates = [
        ('b2c_produkty',       'ean',          'nazov_vyrobku'),
        ('produkty',           'ean',          'nazov_produktu'),
        ('katalog_produktov',  'ean',          'name'),
        ('b2b_cennik_polozky', 'ean_produktu', 'nazov_vyrobku'),  # fallback
    ]
    result = {}
    for tbl, ce, cn in candidates:
        if _table_exists(tbl):
            ok_e = _pick_col(tbl, [ce])
            ok_n = _pick_col(tbl, [cn, 'nazov', 'nazov_produktu', 'nazov_vyrobku', 'name'])
            if ok_e and ok_n:
                part = try_map(tbl, ok_e, ok_n)
                result.update(part)
        if len(result) == len(eans):
            break
    return jsonify(result)

# =============================================================================
# B2B: zákazníci + cenníky
# =============================================================================

def _read_b2b_customers():
    if not _table_exists('b2b_zakaznici'):
        return []
    rows = db_connector.execute_query(
        "SELECT zakaznik_id, nazov_firmy, email "
        "FROM b2b_zakaznici WHERE typ='B2B' ORDER BY nazov_firmy LIMIT 1000"
    ) or []
    out = []
    for r in rows:
        out.append({
            'id': r.get('zakaznik_id'),
            'name': r.get('nazov_firmy') or '',
            'email': r.get('email') or ''
        })
    return out

def _read_pricelists_for_customer(customer_zkid: str):
    if not (_table_exists('b2b_zakaznik_cennik') and _table_exists('b2b_cenniky')):
        return []
    pls = db_connector.execute_query(
        "SELECT c.id, c.nazov_cennika "
        "FROM b2b_zakaznik_cennik zc "
        "JOIN b2b_cenniky c ON c.id = zc.cennik_id "
        "WHERE zc.zakaznik_id=%s "
        "ORDER BY c.nazov_cennika",
        (customer_zkid,)
    ) or []
    out = []
    has_items = _table_exists('b2b_cennik_polozky')
    for p in pls:
        items = []
        if has_items:
            rows = db_connector.execute_query(
                "SELECT ean_produktu AS ean, cena AS price "
                "FROM b2b_cennik_polozky WHERE cennik_id=%s",
                (p['id'],)
            ) or []
            items = [{'ean': r['ean'], 'price': float(r.get('price', 0) or 0)} for r in rows if r.get('ean')]
        out.append({'id': p['id'], 'name': p.get('nazov_cennika') or f'Cenník {p["id"]}', 'items': items})
    return out

@leader_bp.get('/b2b/getCustomersAndPricelists')
@login_required(role=('veduci','admin'))
def leader_b2b_get_customers_and_pricelists():
    import b2b_handler
    return jsonify(b2b_handler.get_customers_and_pricelists())

@leader_bp.get('/b2b/get_pricelists')
@login_required(role=('veduci','admin'))
def leader_b2b_get_pricelists():
    cid = request.args.get('customer_id')
    if not cid:
        return jsonify({'error': 'chýba customer_id'}), 400
    return jsonify(_read_pricelists_for_customer(cid))

@leader_bp.get('/b2b/get_pricelists_and_products')
@login_required(role=('veduci','admin'))
def leader_b2b_get_pricelists_and_products():
    cid = request.args.get('customer_id')
    if not cid:
        return jsonify({'error': 'chýba customer_id'}), 400
    return jsonify({'pricelists': _read_pricelists_for_customer(cid)})

# PDF alias (ID alebo číslo objednávky)
@leader_bp.get('/b2b/order-pdf')
@login_required(role=('veduci','admin'))
def leader_b2b_order_pdf_alias():
    order_id = (request.args.get('order_id') or '').strip()
    
    # NOVÉ: Podpora pre typ PDF (napr. type=finished pre vypracovanú objednávku)
    req_type = request.args.get('type')
    type_param = f"?type={req_type}" if req_type else ""
    
    if not order_id:
        return jsonify({'error':'chýba order_id'}), 400
    if order_id.isdigit():
        return redirect(f"/api/kancelaria/b2b/print_order_pdf/{order_id}{type_param}", code=302)
    
    row = db_connector.execute_query(
        "SELECT id FROM b2b_objednavky WHERE cislo_objednavky=%s",
        (order_id,), fetch='one'
    )
    if row and row.get('id'):
        return redirect(f"/api/kancelaria/b2b/print_order_pdf/{row['id']}{type_param}", code=302)
    return jsonify({'error':'Objednávku sa nepodarilo nájsť.'}), 404

# =============================================================================
# Dashboard / KPI
# =============================================================================

@leader_bp.get('/dashboard')
@login_required(role=('veduci','admin'))
def leader_dashboard():
    d = _d(request.args.get('date'))
    b2c_cols = _table_cols('b2c_objednavky')
    b2b_cols = _table_cols('b2b_objednavky')
    b2c_date = 'pozadovany_datum_dodania' if 'pozadovany_datum_dodania' in b2c_cols else 'datum_objednavky'
    b2b_date = 'pozadovany_datum_dodania' if 'pozadovany_datum_dodania' in b2b_cols else 'datum_objednavky'

    rows_b2c = db_connector.execute_query(
        f"SELECT * FROM b2c_objednavky WHERE DATE({b2c_date})=%s", (d,)
    ) or []
    rows_b2b = db_connector.execute_query(
        f"SELECT * FROM b2b_objednavky WHERE DATE({b2b_date})=%s", (d,)
    ) or []

    def _items_count(rows):
        import json
        total = 0
        for r in rows:
            raw = r.get('polozky_json') or r.get('polozky') or r.get('items') or '[]'
            try:
                arr = json.loads(raw) if isinstance(raw, str) else (raw if isinstance(raw, list) else [])
            except Exception:
                arr = []
            total += len(arr)
        return total

    # podľa schémy používame celkova_suma_s_dph
    kpi = {
        'b2c_count': len(rows_b2c),
        'b2b_count': len(rows_b2b),
        'items_total': _items_count(rows_b2c) + _items_count(rows_b2b),
        'sum_total': sum(float(r.get('celkova_suma_s_dph') or 0) for r in rows_b2c)
                   + sum(float(r.get('celkova_suma_s_dph') or 0) for r in rows_b2b),
    }

# --- VÝPOČET TEMPA A ODHADU KONCA ---
    from datetime import datetime, timedelta, date
    
    today_str = date.today().strftime('%Y-%m-%d') # Pridané pre kontrolu dneška
    
    hotove_casy = []
    zostava_chystat = 0
    
    for r in rows_b2c + rows_b2b:
        stav = r.get('stav', '')
        if stav in ('Hotová', 'Expedovaná'):
            cas = r.get('datum_vypracovania') or r.get('vypracovane') or r.get('cas_dokoncenia') or r.get('updated_at')
            if cas:
                # ZJEDNOTENIE S TV TABUĽOU: Berieme len to, čo reálne spravili DNES
                c_date_str = cas.strftime('%Y-%m-%d') if hasattr(cas, 'strftime') else str(cas)[:10]
                if c_date_str == today_str:
                    hotove_casy.append(cas)
        elif stav not in ('Hotová', 'Expedovaná', 'Zrušená'):
            zostava_chystat += 1

    tempo_minuty = 0
    odhad_konca = ""
    
    if len(hotove_casy) > 1:
        parsed_casy = []
        for c in hotove_casy:
            if isinstance(c, datetime):
                parsed_casy.append(c)
            elif isinstance(c, str):
                try:
                    parsed_casy.append(datetime.strptime(c[:19], '%Y-%m-%d %H:%M:%S'))
                except:
                    try: parsed_casy.append(datetime.fromisoformat(c.replace('Z', '+00:00')))
                    except: pass
        
        if len(parsed_casy) > 1:
            parsed_casy.sort()
            platne_intervaly = []
            
            for i in range(1, len(parsed_casy)):
                rozdiel_sekundy = (parsed_casy[i] - parsed_casy[i-1]).total_seconds()
                
                # ZJEDNOTENIE S TV TABUĽOU: 10 až 1200 sekúnd (20 minút limit)
                if 10 < rozdiel_sekundy < 1200:
                    platne_intervaly.append(rozdiel_sekundy)

            if platne_intervaly:
                priemer_sekundy = sum(platne_intervaly) / len(platne_intervaly)
                tempo_minuty = round(priemer_sekundy / 60.0, 1)
            else:
                tempo_minuty = 0

            if tempo_minuty > 0 and zostava_chystat > 0:
                odhad_dt = datetime.now() + timedelta(minutes=(zostava_chystat * tempo_minuty))
                odhad_konca = odhad_dt.strftime('%H:%M')
                
    kpi['zostava_chystat'] = zostava_chystat
    kpi['tempo_minuty'] = tempo_minuty
    kpi['odhad_konca'] = odhad_konca
    # ----------------------------------

    start_date = datetime.strptime(d, "%Y-%m-%d").date()
    days = [ (start_date + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7) ]

    def _count(table: str, date_col: str, the_day: str) -> int:
        row = db_connector.execute_query(
            f"SELECT COUNT(*) AS c FROM {table} WHERE DATE({date_col})=%s",
            (the_day,), fetch='one'
        ) or {}
        return int(row.get('c') or 0)

    next7_orders = []
    for day in days:
        c_b2c = _count('b2c_objednavky', b2c_date, day)
        c_b2b = _count('b2b_objednavky', b2b_date, day)
        next7_orders.append({'date': day, 'b2c': c_b2c, 'b2b': c_b2b, 'total': c_b2c + c_b2b})

    workdays = _workdays(start_date, 7)
    tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
    plan = [{'date': dd, 'note': 'auto', 'items': [], 'is_tomorrow': (dd == tomorrow)} for dd in workdays]

    sources = {
        'promotions_source': '/api/kancelaria/get_promotions_data',
        'forecast_source':   '/api/kancelaria/get_7_day_forecast',
    }

    return jsonify({
        'date': d,
        'kpi': kpi,
        'next7_orders': next7_orders,
        'production_plan_preview': plan,
        'sources': sources
    })
# =============================================================================
# Zoznam objednávok (B2C/B2B)
# =============================================================================

@leader_bp.get('/b2c/orders')
@login_required(role=('veduci', 'admin'))
def leader_b2c_orders():
    """
    Zoznam B2C objednávok pre Vedúceho expedície.
    OPRAVA: Pripája tabuľku b2b_zakaznici cez LEFT JOIN, aby sme vždy mali meno zákazníka.
    """
    d = _d(request.args.get('date'))
    
    # Zistíme, ktorý stĺpec v b2c_objednavky je dátum dodania (pre WHERE klauzulu)
    date_col = _pick_col('b2c_objednavky', ['pozadovany_datum_dodania', 'datum_dodania', 'datum_objednavky']) or 'id'

    # SQL Dotaz s JOINom na zákazníka
    # Používame alias 'o' pre objednávky a 'z' pre zákazníkov
    sql = f"""
        SELECT 
            o.*,
            COALESCE(z.nazov_firmy, z.email, o.nazov_firmy) as resolved_name
        FROM b2c_objednavky o
        LEFT JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        WHERE DATE(o.{date_col}) = %s 
        ORDER BY o.{date_col} DESC, o.id DESC
    """
    
    # Ak by tabuľka b2b_zakaznici neexistovala (veľmi nepravdepodobné), fallback na jednoduchý select
    if not _table_exists('b2b_zakaznici'):
        sql = f"SELECT *, nazov_firmy as resolved_name FROM b2c_objednavky WHERE DATE({date_col}) = %s ORDER BY {date_col} DESC"

    try:
        rows = db_connector.execute_query(sql, (d,), fetch="all") or []
    except Exception as e:
        # Fallback ak zlyhá SQL syntax (napr. neexistujúce stĺpce)
        print(f"Leader B2C Error: {e}")
        rows = []

    # Zistíme názvy stĺpcov pre sumy a položky (pre robustnosť)
    pred_col = _pick_col('b2c_objednavky', ['predpokladana_suma_s_dph', 'suma_s_dph', 'total_s_dph', 'total_gross'])
    fin_col  = _pick_col('b2c_objednavky', ['celkova_suma_s_dph', 'finalna_suma_s_dph', 'finalna_suma', 'total_s_dph'])
    items_col = _pick_col('b2c_objednavky', ['polozky_json', 'polozky', 'items'])

    out = []

    for r in rows:
        # --- 1. Meno zákazníka (z JOINu alebo fallback) ---
        cust_name = r.get('resolved_name') or r.get('nazov_firmy') or r.get('email') or 'Neznámy zákazník'

        # --- 2. Predbežná suma ---
        pred = None
        if pred_col:
            try:
                val = r.get(pred_col)
                if val is not None: pred = float(val)
            except: pass

        # Ak nemáme sumu v DB, spočítame ju z JSON položiek
        if (not pred or pred <= 0):
            try:
                raw_items = r.get(items_col)
                if isinstance(raw_items, str):
                    items = json.loads(raw_items or "[]")
                elif isinstance(raw_items, list):
                    items = raw_items
                else:
                    items = []
                
                gross = 0.0
                for it in items:
                    if not isinstance(it, dict): continue
                    # Podpora rôznych kľúčov (quantity/mnozstvo, price_s_dph/cena_s_dph)
                    q = float(it.get("quantity") or it.get("mnozstvo") or 0)
                    price = float(it.get("price_s_dph") or it.get("cena_s_dph") or 0)
                    if q > 0 and price > 0:
                        gross += q * price
                
                if gross > 0: pred = round(gross, 2)
            except: pass

        # --- 3. Finálna suma ---
        fin = None
        if fin_col:
            try:
                val = r.get(fin_col)
                if val is not None and float(val) > 0:
                    fin = float(val)
            except: pass

        # Výstup pre frontend
        out.append({
            "id": r.get("id"),
            "cislo_objednavky": r.get("cislo_objednavky") or str(r.get("id")),
            "datum_objednavky": _iso(r.get("datum_objednavky")),
            "pozadovany_datum_dodania": _iso(r.get("pozadovany_datum_dodania")),
            "predpokladana_suma_s_dph": pred,
            "finalna_suma_s_dph": fin,
            "stav": r.get("stav") or "",
            "zakaznik_meno": cust_name,  # <--- TOTO JE OPRAVENÉ POLE
            "nazov_firmy": cust_name,    # <--- PRE ISTOTU AJ TOTO
            "polozky_json": r.get(items_col) or "[]",
        })

    return jsonify(out)

@leader_bp.get('/b2b/orders')
@login_required(role=('veduci','admin'))
def leader_b2b_orders():
    d = _d(request.args.get('date'))
    date_col = _pick_col('b2b_objednavky', ['pozadovany_datum_dodania','datum_objednavky'])
    if date_col:
        rows = db_connector.execute_query(
            f"SELECT * FROM b2b_objednavky WHERE DATE({date_col})=%s ORDER BY {date_col} DESC, id DESC", (d,)
        ) or []
    else:
        rows = db_connector.execute_query("SELECT * FROM b2b_objednavky ORDER BY id DESC LIMIT 200") or []

    out = []
    for r in rows:
        out.append({
            'id': r.get('id'),
            'cislo_objednavky': r.get('cislo_objednavky') or r.get('id'),
            'odberatel': r.get('nazov_firmy') or '',
            'datum_objednavky': _iso(r.get('datum_objednavky')),
            'pozadovany_datum_dodania': _iso(r.get('pozadovany_datum_dodania')),
            'predpokladana_suma_s_dph': None,
            'finalna_suma_s_dph': r.get('celkova_suma_s_dph'),
            'stav': r.get('stav') or '',
            'polozky_json': r.get('polozky_json') or r.get('polozky') or '[]'
        })
    return jsonify(out)

# =============================================================================
# B2C: zrušenie (leader proxy)
# =============================================================================

@leader_bp.post('/b2c/cancel_order')
@login_required(role=('veduci','admin'))
def leader_b2c_cancel_order():
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    reason   = (data.get('reason') or '').strip()
    if not order_id:
        return jsonify({'error': 'Chýba order_id.'}), 400
    try:
        if _pick_col('b2c_objednavky',['poznamka']):
            db_connector.execute_query(
                "UPDATE b2c_objednavky SET stav='Zrušená', poznamka=CONCAT(COALESCE(poznamka,''), %s) WHERE id=%s",
                (f"\n[ZRUŠENIE – líder]: {reason}" if reason else '', order_id), fetch='none'
            )
        else:
            db_connector.execute_query(
                "UPDATE b2c_objednavky SET stav='Zrušená' WHERE id=%s",
                (order_id,), fetch='none'
            )
    except Exception as e:
        return jsonify({'error': f'Nepodarilo sa zmeniť stav: {e}'}), 500
    return jsonify({'message': 'Objednávka zrušená.', 'order_id': order_id})

# =============================================================================
# B2B: manuálne vytvorenie / úprava / notify
# =============================================================================

@leader_bp.post('/b2b/orders')
@login_required(role=('veduci','admin'))
def leader_b2b_create_order():
    data = request.get_json(silent=True) or {}
    odberatel      = (data.get('odberatel') or '').strip()
    customer_id    = data.get('customer_id')
    datum_dodania  = (data.get('datum_dodania') or '').strip() or None
    poznamka       = (data.get('poznamka') or '').strip()
    items          = data.get('items') or []

    if not odberatel and not customer_id:
        return jsonify({'error': 'Chýba odberateľ'}), 400
    if not items:
        return jsonify({'error': 'Pridaj aspoň jednu položku'}), 400

    cols = _table_cols('b2b_objednavky')
    col_customer_id   = _pick(cols, ['zakaznik_id','customer_id'])
    col_customer_name = _pick(cols, ['odberatel','nazov_firmy','zakaznik_meno','firma','zakaznik'])
    col_order_date    = _pick(cols, ['datum_objednavky','created_at','datum_vytvorenia'])
    col_due_date      = _pick(cols, ['pozadovany_datum_dodania','datum_dodania'])
    col_note          = _pick(cols, ['poznamka','poznamky','note'])
    col_status        = _pick(cols, ['stav','status'])
    col_order_no      = _pick(cols, ['cislo_objednavky','cislo','kod'])

    fields = []
    values = []
    params = []

    # číslo objednávky – generuj, ak existuje stĺpec
    order_no = None
    if col_order_no:
        order_no = _gen_b2b_no(customer_id)
        fields.append(f"`{col_order_no}`"); values.append("%s"); params.append(order_no)

    if col_customer_id and customer_id:
        fields.append(f"`{col_customer_id}`"); values.append("%s"); params.append(customer_id)
    if col_customer_name and odberatel:
        fields.append(f"`{col_customer_name}`"); values.append("%s"); params.append(odberatel)
    if col_order_date:
        fields.append(f"`{col_order_date}`"); values.append("NOW()")
    if col_due_date and datum_dodania:
        fields.append(f"`{col_due_date}`"); values.append("%s"); params.append(datum_dodania)
    if col_note:
        fields.append(f"`{col_note}`"); values.append("%s"); params.append(poznamka)
    if col_status:
        fields.append(f"`{col_status}`"); values.append("%s"); params.append('Prijatá')

    if not fields:
        return jsonify({'error': 'Schéma b2b_objednavky nemá použiteľné stĺpce.'}), 500

    insert_head_sql = f"INSERT INTO `b2b_objednavky` ({', '.join(fields)}) VALUES ({', '.join(values)})"

    try:
        conn = _get_conn()
        cur = conn.cursor(dictionary=True)
        try:
            conn.start_transaction()

            # pokus o insert (ak by číslo bolo unique, skús ešte raz s novým číslom)
            for attempt in range(2):
                try:
                    cur.execute(insert_head_sql, tuple(params))
                    break
                except Exception as e:
                    if 'Duplicate' in str(e) and col_order_no:
                        order_no = _gen_b2b_no(customer_id)
                        # nahraď order_no v params
                        for i, p in enumerate(params):
                            if isinstance(p, str) and p.startswith('B2B-'):
                                params[i] = order_no
                                break
                        continue
                    raise

            order_id = cur.lastrowid

            for it in items:
                ean   = (it.get('ean')  or it.get('ean_produktu') or '').strip()
                name  = (it.get('name') or it.get('nazov') or it.get('nazov_vyrobku') or '').strip()
                qty   = float(it.get('quantity') or it.get('mnozstvo') or 0) or 0.0
                unit  = (it.get('unit') or it.get('mj') or 'ks').strip()
                price = float(it.get('cena_bez_dph') or 0) or 0.0
                if not ean or not name or qty <= 0:
                    continue
                cur.execute("""
                    INSERT INTO b2b_objednavky_polozky
                      (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, cena_bez_dph)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (order_id, ean, name, qty, unit, price))

            conn.commit()
            return jsonify({'message': 'Objednávka prijatá', 'order_id': order_id, 'order_no': order_no})
        except Exception as e:
            conn.rollback()
            return jsonify({'error': f'Chyba pri ukladaní objednávky: {e}'}), 500
        finally:
            try: cur.close()
            except: pass
            try: conn.close()
            except: pass
    except Exception as e:
        return jsonify({'error': f'Chyba pripojenia: {e}'}), 500

@leader_bp.post('/b2b/update_order')
@login_required(role=('veduci','admin'))
def leader_b2b_update_order():
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    items    = data.get('items') or []
    if not order_id:
        return jsonify({'error': 'Chýba order_id.'}), 400
    if not isinstance(items, list) or not items:
        return jsonify({'error': 'Pridaj aspoň jednu položku.'}), 400
    try:
        conn = _get_conn()
        cur  = conn.cursor(dictionary=True)
        try:
            conn.start_transaction()
            cur.execute("DELETE FROM b2b_objednavky_polozky WHERE objednavka_id=%s", (order_id,))
            for it in items:
                ean  = (it.get('ean') or '').strip()
                name = (it.get('name') or it.get('nazov') or '').strip()
                qty  = float(it.get('quantity') or it.get('mnozstvo') or 0)
                unit = (it.get('unit') or it.get('mj') or 'kg')
                price= float(it.get('cena_bez_dph') or 0)
                if not (ean and name and qty>0):
                    continue
                cur.execute("""
                    INSERT INTO b2b_objednavky_polozky
                      (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, cena_bez_dph)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, (order_id, ean, name, qty, unit, price))
            conn.commit()
        except Exception as e:
            conn.rollback()
            return jsonify({'error': f'Chyba pri ukladaní položiek: {e}'}), 500
        finally:
            try: cur.close()
            except: pass
            try: conn.close()
            except: pass
    except Exception as e:
        return jsonify({'error': f'Chyba pripojenia: {e}'}), 500
    return jsonify({'message': 'Objednávka upravená.', 'order_id': order_id})


@leader_bp.post('/b2b/notify_order')
@login_required(role=('veduci','admin'))
def leader_b2b_notify_order():
    """
    Odošle notifikácie (PDF/CSV) a ULOŽÍ CSV DO ZLOŽKY PRE OBJEDNÁVKY.
    Oprava: Ukladá do B2B_REMOTE_DIR (/var/app/data/b2bobjednavky).
    """
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    if not order_id:
        return jsonify({'error':'Chýba order_id.'}), 400

    # 1) Načítaj dáta z DB
    head = db_connector.execute_query(
        "SELECT id, COALESCE(cislo_objednavky, id) AS cislo, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania "
        "FROM b2b_objednavky WHERE id=%s",
        (order_id,), fetch='one'
    )
    if not head:
        return jsonify({'error':'Objednávka neexistuje.'}), 404

    # Email zákazníka (pre 255 bude prázdny)
    cust_email = None
    if head.get('zakaznik_id'):
        row = db_connector.execute_query(
            "SELECT email FROM b2b_zakaznici WHERE zakaznik_id=%s OR id=%s LIMIT 1",
            (head['zakaznik_id'], head['zakaznik_id']), fetch='one'
        )
        cust_email = (row or {}).get('email')

    # 2) Priprav dáta pre PDF generátor
    try:
        from b2b_handler import build_order_pdf_payload_admin
        payload = build_order_pdf_payload_admin(int(order_id))
        
        # --- ŠPECIÁLNA ÚPRAVA PRE AMBULANT (ID 255) ---
        if str(head.get('zakaznik_id')) == '255':
            manual_name = head.get('nazov_firmy') or ""
            payload['customer_name'] = f"255 - {manual_name}"
            payload['customerName'] = f"255 - {manual_name}"
        elif head.get('nazov_firmy'):
            payload['customer_name'] = head['nazov_firmy']
            payload['customerName'] = head['nazov_firmy']
            
    except Exception:
        # Fallback
        return jsonify({'error': 'Chyba pri príprave dát pre PDF.'}), 500

    # 3) Vygeneruj PDF + CSV
    try:
        # CSV názov: 255_Meno_Datum.csv (bezpečné znaky)
        safe_name = "".join(x for x in str(payload.get('customer_name','')) if x.isalnum())
        csv_fname = f"{head.get('zakaznik_id')}_{safe_name}_{datetime.now().strftime('%Y%m%d%H%M')}.csv"
        
        pdf_bytes, csv_bytes, _ = pdf_generator.create_order_files(payload)
    except Exception as e:
        return jsonify({'error': f'Generovanie PDF/CSV zlyhalo: {e}'}), 500

    # --- 4) ULOŽENIE CSV NA SERVER (DO B2B ZLOŽKY) ---
    try:
        # ZMENA: Čítame B2B_REMOTE_DIR, nie ERP_EXCHANGE_DIR
        # Default: /var/app/data/b2bobjednavky
        orders_dir = os.getenv("B2B_REMOTE_DIR", "/var/app/data/b2bobjednavky")
        
        if not os.path.isabs(orders_dir):
            base = os.path.dirname(__file__)
            orders_dir = os.path.join(base, orders_dir)

        os.makedirs(orders_dir, exist_ok=True)
        
        file_path = os.path.join(orders_dir, csv_fname)
        
        with open(file_path, "wb") as f:
            f.write(csv_bytes)
            
        print(f"[Leader] CSV objednávka uložená do: {file_path}")
        
    except Exception as e:
        print(f"[Leader] Chyba pri zápise CSV na disk: {e}")
        # Pokračujeme, aby sa odoslal aspoň email

    # 5) Odoslanie e-mailov
    expedition_email = os.getenv("B2B_EXPEDITION_EMAIL") or "miksroexpedicia@gmail.com"

    # A) Zákazník (len ak má email)
    if cust_email:
        try:
            notification_handler.send_order_confirmation_email(
                to=cust_email,
                order_number=payload.get('order_number'),
                pdf_content=pdf_bytes,
                csv_content=None
            )
        except: pass

    # B) Expedícia - VŽDY
    try:
        notification_handler.send_order_confirmation_email(
            to=expedition_email,
            order_number=payload.get('order_number'),
            pdf_content=pdf_bytes,
            csv_content=csv_bytes,
            csv_filename=csv_fname
        )
    except Exception as e:
        return jsonify({'error': f'Expedičný e-mail zlyhal: {e}'}), 500

    return jsonify({'message':'Objednávka spracovaná, CSV uložené pre sync.', 'order_id': order_id})


# =============================================================================
# TV TABUĽA: Správa oznamov a stálych poznámok
# =============================================================================
@leader_bp.get('/tv_board/live_kpi')
@login_required(role=('veduci','admin'))
def tv_board_live_kpi():
    from datetime import date, datetime, timedelta
    
    today_str = date.today().strftime('%Y-%m-%d')
    
    # 1. Oprava tabuľky: v projekte sa volá 'system_settings'
    target_date_row = db_connector.execute_query(
        "SELECT hodnota FROM system_settings WHERE kluc='expedicia_cielovy_datum'", 
        fetch='one'
    )
    t_date = target_date_row.get('hodnota') if target_date_row else (date.today() + timedelta(days=1)).strftime('%Y-%m-%d')

    # 2. Dynamická detekcia stĺpcov pre dátum dodania
    b2c_date_col = _pick_col('b2c_objednavky', ['pozadovany_datum_dodania', 'datum_dodania', 'datum_objednavky']) or 'id'
    b2b_date_col = _pick_col('b2b_objednavky', ['pozadovany_datum_dodania', 'datum_objednavky']) or 'id'

    # 3. Použijeme SELECT *, aby sme sa vyhli chybe s neexistujúcim stĺpcom datum_vypracovania
    rows_b2c = db_connector.execute_query(f"SELECT * FROM b2c_objednavky WHERE DATE({b2c_date_col}) = %s", (t_date,)) or []
    rows_b2b = db_connector.execute_query(f"SELECT * FROM b2b_objednavky WHERE DATE({b2b_date_col}) = %s", (t_date,)) or []

    hotove_dnes_casy = []
    zostava_chystat = 0
    
    for r in rows_b2c + rows_b2b:
        stav = r.get('stav', '')
        if stav in ('Hotová', 'Expedovaná'):
            # Použijeme tvoju logiku z dashboardu na hľadanie času dokončenia
            cas = r.get('datum_vypracovania') or r.get('vypracovane') or r.get('cas_dokoncenia') or r.get('updated_at')
            if cas:
                c_date_str = cas.strftime('%Y-%m-%d') if hasattr(cas, 'strftime') else str(cas)[:10]
                if c_date_str == today_str:
                    hotove_dnes_casy.append(cas)
        elif stav not in ('Zrušená'):
            zostava_chystat += 1

    tempo_minuty = 0
    odhad_konca = ""
    
    if len(hotove_dnes_casy) > 1:
        parsed_casy = []
        for c in hotove_dnes_casy:
            if isinstance(c, datetime): parsed_casy.append(c)
            elif isinstance(c, str):
                try: parsed_casy.append(datetime.strptime(c[:19], '%Y-%m-%d %H:%M:%S'))
                except: pass
        
        if len(parsed_casy) > 1:
            parsed_casy.sort()
            platne_intervaly = []
            for i in range(1, len(parsed_casy)):
                rozdiel = (parsed_casy[i] - parsed_casy[i-1]).total_seconds()
                if 10 < rozdiel < 1200: # 10 sekúnd až 20 minút (pauzy ignorujeme)
                    platne_intervaly.append(rozdiel)

            if platne_intervaly:
                tempo_minuty = round((sum(platne_intervaly) / len(platne_intervaly)) / 60.0, 1)
                if zostava_chystat > 0:
                    koniec_dt = datetime.now() + timedelta(minutes=(zostava_chystat * tempo_minuty))
                    odhad_konca = koniec_dt.strftime('%H:%M')

    return jsonify({
        'zostava_chystat': zostava_chystat,
        'tempo_minuty': tempo_minuty,
        'odhad_konca': odhad_konca,
        'target_date': t_date
    })
@leader_bp.route('/tv_board/customers', methods=['GET'])
@login_required(role=('veduci','admin'))
def get_tv_board_customers():
    """Vráti zoznam B2B zákazníkov a aktuálny globálny oznam."""
    conn = _get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT zakaznik_id, nazov_firmy, stala_poznamka_expedicia FROM b2b_zakaznici WHERE typ='B2B' ORDER BY nazov_firmy")
        customers = cur.fetchall()
        
        cur.execute("SELECT hodnota FROM system_settings WHERE kluc = 'expedicia_globalny_oznam'")
        oznam_row = cur.fetchone()
        globalny_oznam = oznam_row['hodnota'] if oznam_row else ""
        
        return jsonify({"customers": customers, "global_note": globalny_oznam})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@leader_bp.route('/tv_board/global_note', methods=['POST'])
@login_required(role=('veduci','admin'))
def save_global_note():
    """Uloží globálny oznam pre expedíciu."""
    data = request.json
    note = data.get('note', '')
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO system_settings (kluc, hodnota) 
            VALUES ('expedicia_globalny_oznam', %s) 
            ON DUPLICATE KEY UPDATE hodnota = %s, updated_at = NOW()
        """, (note, note))
        conn.commit()
        return jsonify({"message": "Globálny oznam uložený."})
    finally:
        conn.close()

@leader_bp.route('/tv_board/customer_note', methods=['POST'])
@login_required(role=('veduci','admin'))
def save_customer_note():
    """Uloží stálu požiadavku ku konkrétnemu zákazníkovi."""
    data = request.json
    zakaznik_id = data.get('zakaznik_id')
    note = data.get('note', '')
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE b2b_zakaznici SET stala_poznamka_expedicia = %s WHERE zakaznik_id = %s", (note, zakaznik_id))
        conn.commit()
        return jsonify({"message": "Stála požiadavka uložená."})
    finally:
        conn.close()
# =============================================================================
# Výrobný plán
# =============================================================================

@leader_bp.get('/production/plan')
@login_required(role=('veduci','admin'))
def leader_production_plan():
    start = _d(request.args.get('start'))
    days  = int(request.args.get('days') or 7)
    commit= int(request.args.get('commit') or 0)
    sdate = datetime.strptime(start, "%Y-%m-%d").date()
    workdays = _workdays(sdate, days)
    plan = [{'date': d, 'items': [], 'note': 'auto',
             'is_tomorrow': (d == (date.today() + timedelta(days=1)).strftime("%Y-%m-%d"))}
            for d in workdays]

    if not commit:
        return jsonify({'start': start, 'days': days, 'plan': plan})

    try:
        if not _table_exists('vyroba_plan'):
            raise RuntimeError('Tabuľka vyroba_plan neexistuje')
        for p in plan:
            db_connector.execute_query(
                "INSERT INTO vyroba_plan (plan_date, meta_note, created_at) VALUES (%s,%s,NOW())",
                (p['date'], p['note']),
                fetch='none'
            )
        return jsonify({'message':'Plán uložený'})
    except Exception as e:
        return jsonify({'error': f'Chýba tabuľka vyroba_plan alebo schéma – {e}'}), 400

# =============================================================================
# Krájačky / výroba
# =============================================================================

@leader_bp.get('/get_slicable_products')
@login_required(role=('veduci', 'admin'))
def leader_get_slicable_products():
    """
    Vráti zoznam produktov na krájanie (typ_polozky LIKE '%KRAJAN%').
    Využíva existujúcu logiku z expedition_handler.
    """
    return jsonify(expedition_handler.get_slicable_products())

@leader_bp.post('/cut_jobs')
@login_required(role=('veduci','admin'))
def leader_cut_jobs_create():
    """
    Vytvorenie úlohy na krájanie z rozhrania Vedúceho.
    """
    data = request.get_json(silent=True) or {}
    
    # Mapovanie dát z frontend formulára (leaderexpedition.js) na backend logiku
    payload = {
        'ean': data.get('ean'),
        'quantity': data.get('quantity'),
        'unit': data.get('unit'),            # leaderexpedition.js posiela 'kg' alebo 'ks'
        'customer': data.get('order_id'),    # Frontend posiela názov zákazníka v poli 'order_id'
        'order_id': '',                      
        'due_date': data.get('due_date')
    }

    # Voláme logiku z expedície
    result = expedition_handler.create_manual_slicing_job(payload)
    
    if result.get('error'):
        return jsonify(result), 400
        
    return jsonify(result)

@leader_bp.get('/cut_jobs')
@login_required(role=('veduci','admin'))
def leader_cut_jobs_list():
    # Dynamicky zistíme názov stĺpca (nazov_vyrobu vs nazov_vyrobku)
    zv = 'nazov_vyrobu' if _table_exists('zaznamy_vyroba') and 'nazov_vyrobu' in _table_cols('zaznamy_vyroba') else 'nazov_vyrobku'
    
    rows = db_connector.execute_query(
        f"""
        SELECT 
            id_davky as id,
            stav,
            datum_spustenia as due_date,
            planovane_mnozstvo_kg as quantity_kg,
            {zv} as source_product,
            JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.cielovyNazov')) as target_name,
            JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.cielovyEan')) as ean,
            JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.zakaznik')) as customer,
            JSON_UNQUOTE(JSON_EXTRACT(detaily_zmeny, '$.planovaneKs')) as pieces
        FROM zaznamy_vyroba
        WHERE stav = 'Prebieha krájanie'
        ORDER BY datum_spustenia DESC
        """
    ) or []

    out = []
    for r in rows:
        qty = ""
        mj = "kg"
        
        # Ak sú definované kusy, zobrazíme ks, inak kg
        if r.get('pieces') and _parse_num(r['pieces']) > 0:
            qty = r['pieces']
            mj = "ks"
        else:
            qty = float(r.get('quantity_kg') or 0)
            mj = "kg"

        out.append({
            'id': r['id'],
            'order_id': r.get('customer') or '', 
            'ean': r.get('ean') or '',
            'nazov_vyrobku': r.get('target_name') or r.get('source_product'),
            'mnozstvo': qty,
            'mj': mj,
            'due_date': _iso(r.get('due_date')),
            'stav': r.get('stav')
        })

    return jsonify(out)

def _parse_num(x):
    try: return float(x)
    except: return 0
    
@leader_bp.get('/search_customers')
@login_required(role=('veduci', 'admin'))
def leader_search_customers():
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify([])

    # Hľadáme v B2B aj B2C tabuľkách
    results = []
    
    # B2B
    if _table_exists('b2b_zakaznici'):
        rows = db_connector.execute_query(
            "SELECT nazov_firmy as name, 'B2B' as type FROM b2b_zakaznici WHERE nazov_firmy LIKE %s LIMIT 10",
            (f"%{q}%",)
        ) or []
        results.extend(rows)

    # B2C (z objednávok, keďže nemusia mať vlastnú tabuľku zákazníkov)
    if _table_exists('b2c_objednavky'):
        # Skúsime nájsť unikátne mená/firmy
        col_name = _pick_col('b2c_objednavky', ['zakaznik_meno', 'nazov_firmy', 'customer_name'])
        if col_name:
            rows = db_connector.execute_query(
                f"SELECT DISTINCT {col_name} as name, 'B2C' as type FROM b2c_objednavky WHERE {col_name} LIKE %s LIMIT 10",
                (f"%{q}%",)
            ) or []
            results.extend(rows)

    return jsonify(results[:20]) # Vrátime max 20 výsledkov

@leader_bp.patch('/cut_jobs/<int:job_id>')
@login_required(role='veduci')
def leader_cut_jobs_update(job_id: int):
    return jsonify({'error': 'Použi workflow v module expedícia (tieto endpointy sú placeholder).'}), 400

@leader_bp.post('/cut_jobs/cancel')
@login_required(role=('veduci', 'admin'))
def leader_cut_jobs_cancel():
    data = request.get_json(silent=True) or {}
    job_id = data.get('id')
    
    # Voláme logiku z expedition_handler
    result = expedition_handler.cancel_slicing_job_logic(job_id, "Vedúci expedície", "Zrušené cez Leader panel")
    
    if result.get('error'):
        return jsonify(result), 400
    return jsonify(result)

@leader_bp.get('/b2b/search_products')
@login_required(role=('veduci', 'admin'))
def leader_b2b_search_products():
    """
    Vyhľadávanie v katalógu pre 'Ambulantný predaj'.
    Vráti produkty s vypočítanou cenou (Nákupná cena + 25% marža).
    """
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify([])

    sql = """
        SELECT 
            ean, 
            nazov_vyrobku as name, 
            mj, 
            COALESCE(nakupna_cena, 0) as cost
        FROM produkty 
        WHERE LOWER(nazov_vyrobku) LIKE %s OR ean LIKE %s
        LIMIT 20
    """
    like_q = f"%{q.lower()}%"
    
    try:
        rows = db_connector.execute_query(sql, (like_q, like_q), fetch='all') or []
    except Exception as e:
        print(f"Chyba pri vyhľadávaní produktov: {e}")
        return jsonify([])
    
    out = []
    for r in rows:
        cost = float(r.get('cost') or 0)
        
        # VÝPOČET CENY: Nákupná cena * 1.25 (25% marža)
        price_with_margin = cost * 1.25
        
        out.append({
            'ean': r['ean'],
            'name': r['name'],
            'mj': r.get('mj') or 'kg', 
            'price': round(price_with_margin, 2)  # Zaokrúhlené na 2 desatinné miesta
        })
        
    return jsonify(out)

# =============================================================================
# ZRKADLENIE LOGISTIKY Z KANCELÁRIE (Volá priamo funkcie b2b_handler.py)
# =============================================================================

@leader_bp.get('/logistics/routes-data')
@login_required(role=('veduci','admin'))
def leader_logistics_routes_data():
    date_str = request.args.get('date')
    return jsonify(b2b_handler.get_logistics_routes_data(date_str))

@leader_bp.post('/b2b/updateCustomerRouteOrder')
@login_required(role=('veduci','admin'))
def leader_update_customer_route_order():
    return jsonify(b2b_handler.update_customer_route_order(request.get_json(silent=True) or {}))

@leader_bp.get('/b2b/getStores')
@login_required(role=('veduci','admin'))
def leader_get_stores():
    return jsonify(b2b_handler.get_stores())

@leader_bp.post('/b2b/saveStore')
@login_required(role=('veduci','admin'))
def leader_save_store():
    return jsonify(b2b_handler.save_store(request.get_json(silent=True) or {}))

@leader_bp.post('/b2b/deleteStore')
@login_required(role=('veduci','admin'))
def leader_delete_store():
    return jsonify(b2b_handler.delete_store(request.get_json(silent=True) or {}))

@leader_bp.get('/b2b/getRouteTemplates')
@login_required(role=('veduci','admin'))
def leader_get_route_templates():
    return jsonify(b2b_handler.get_route_templates())

@leader_bp.post('/b2b/saveRouteTemplate')
@login_required(role=('veduci','admin'))
def leader_save_route_template():
    return jsonify(b2b_handler.save_route_template(request.get_json(silent=True) or {}))

@leader_bp.post('/b2b/deleteRouteTemplate')
@login_required(role=('veduci','admin'))
def leader_delete_route_template():
    return jsonify(b2b_handler.delete_route_template(request.get_json(silent=True) or {}))

@leader_bp.post('/logistics/assign-vehicle')
@login_required(role=('veduci','admin'))
def leader_assign_vehicle():
    return jsonify(b2b_handler.assign_vehicle_to_route_and_fleet(request.get_json(silent=True) or {}))

@leader_bp.post('/logistics/kanban-save')
@login_required(role=('veduci','admin'))
def leader_logistics_kanban_save():
    """
    Uloží hromadne zmeny z Drag & Drop Kanbanu.
    Prijíma ID trasy a presné pole usporiadaných ID zákazníkov.
    """
    data = request.get_json(silent=True) or {}
    route_id = data.get('route_id')
    customer_ids = data.get('customer_ids', []) # napr. ['REG_12', 'MAN_5', 'NAME_Test']

    conn = _get_conn()
    try:
        cur = conn.cursor()
        
        # Ak je to stĺpec 'unassigned', nastavíme NULL. Inak konkrétne ID trasy.
        trasa_val = None if str(route_id) == 'unassigned' else int(route_id)

        # Prejdeme všetky prijaté IDčka a zapíšeme im nové poradie a novú trasu
        for poradie, cid in enumerate(customer_ids, start=1):
            cid_str = str(cid)
            if cid_str.startswith('REG_'):
                db_id = int(cid_str[4:])
                cur.execute("UPDATE b2b_zakaznici SET trasa_id=%s, trasa_poradie=%s WHERE id=%s", (trasa_val, poradie, db_id))
            
            elif cid_str.startswith('MAN_'):
                db_id = int(cid_str[4:])
                cur.execute("UPDATE b2b_manual_zakaznici SET trasa_id=%s, trasa_poradie=%s WHERE id=%s", (trasa_val, poradie, db_id))
            
            elif cid_str.startswith('NAME_'):
                name = cid_str[5:]
                cur.execute("""
                    INSERT INTO logistika_name_routes (odberatel, trasa_id, trasa_poradie) VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE trasa_id=%s, trasa_poradie=%s
                """, (name, trasa_val, poradie, trasa_val, poradie))

        conn.commit()
        return jsonify({"message": "Nové usporiadanie uložené."})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            cur.close()
            conn.close()


@leader_bp.post('/logistics/update-route-name')
@login_required(role=('veduci','admin'))
def leader_update_route_name():
    import b2b_handler
    return jsonify(b2b_handler.update_route_name(request.get_json(silent=True) or {}))

# =============================================================================
# MANUÁLNE OBJEDNÁVKY (ZJEDNOTENÉ PRE REGISTROVANÝCH AJ NEREGISTROVANÝCH)
# =============================================================================

def _ensure_manual_customers_table():
    import db_connector
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS b2b_manual_zakaznici (
            id INT AUTO_INCREMENT PRIMARY KEY,
            interne_cislo VARCHAR(64) UNIQUE,
            nazov_firmy VARCHAR(255) NOT NULL,
            adresa VARCHAR(255),
            kontakt VARCHAR(255),
            trasa_id INT NULL,
            trasa_poradie INT DEFAULT 999,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')
    
    try:
        db_connector.execute_query("ALTER TABLE b2b_manual_zakaznici ADD COLUMN trasa_id INT NULL", fetch='none')
        db_connector.execute_query("ALTER TABLE b2b_manual_zakaznici ADD COLUMN trasa_poradie INT DEFAULT 999", fetch='none')
    except Exception:
        pass
    
    try:
        db_connector.execute_query("ALTER TABLE b2b_objednavky DROP FOREIGN KEY fk_b2bo_zakaznik", fetch='none')
    except Exception:
        pass

@leader_bp.get('/manual_customers/search_all')
@login_required(role=('veduci', 'admin'))
def search_all_customers():
    _ensure_manual_customers_table()
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    
    like_q = f"%{q}%"

    # 1. Hľadáme v registrovaných zákazníkoch (E-shop) - pridané cislo_prevadzky do SELECTu aj WHERE
    sql_reg = """
        SELECT id as db_id, zakaznik_id as interne_cislo, nazov_firmy, adresa, email as kontakt, '1' as is_registered, cislo_prevadzky 
        FROM b2b_zakaznici 
        WHERE typ='B2B' AND (nazov_firmy LIKE %s OR zakaznik_id LIKE %s OR cislo_prevadzky LIKE %s)
        LIMIT 15
    """
    reg_rows = db_connector.execute_query(sql_reg, (like_q, like_q, like_q), fetch='all') or []

    # Vloženie čísla prevádzky priamo do názvu firmy pre frontend
    for r in reg_rows:
        c_prev = str(r.get('cislo_prevadzky') or '').strip()
        if c_prev and not str(r['nazov_firmy']).startswith(f"[{c_prev}]"):
            r['nazov_firmy'] = f"[{c_prev}] {r['nazov_firmy']}"

    # 2. Hľadáme v neregistrovaných (Manuálnych)
    sql_man = """
        SELECT id as db_id, interne_cislo, nazov_firmy, adresa, kontakt, '0' as is_registered 
        FROM b2b_manual_zakaznici 
        WHERE nazov_firmy LIKE %s OR interne_cislo LIKE %s
        LIMIT 15
    """
    man_rows = db_connector.execute_query(sql_man, (like_q, like_q), fetch='all') or []

    return jsonify(reg_rows + man_rows)

@leader_bp.post('/manual_customers/save')
@login_required(role=('veduci', 'admin'))
def save_manual_customer():
    _ensure_manual_customers_table()
    data = request.get_json() or {}
    interne_cislo = data.get('interne_cislo', '').strip()
    nazov_firmy = data.get('nazov_firmy', '').strip()
    adresa = data.get('adresa', '').strip()
    kontakt = data.get('kontakt', '').strip()

    if not interne_cislo or not nazov_firmy:
        return jsonify({'error': 'Interné číslo a názov firmy sú povinné.'}), 400

    try:
        db_connector.execute_query("""
            INSERT INTO b2b_manual_zakaznici (interne_cislo, nazov_firmy, adresa, kontakt)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE nazov_firmy=%s, adresa=%s, kontakt=%s
        """, (interne_cislo, nazov_firmy, adresa, kontakt, nazov_firmy, adresa, kontakt), fetch='none')
        return jsonify({'message': 'Zákazník uložený.'})
    except Exception as e:
        return jsonify({'error': f'Chyba uloženia: {str(e)}'}), 500

@leader_bp.get('/products_standard/search')
@login_required(role=('veduci', 'admin'))
def search_standard_products():
    q = request.args.get('q', '').strip()
    customer_id = request.args.get('customer_id', '').strip()
    
    if len(q) < 2:
        return jsonify([])

    like_q = f"%{q.lower()}%"
    rows = []
    
    # 1. Klasické vyhľadanie produktov so záchranou (Fallback na sklad2)
    try:
        sql = """
            SELECT ean, nazov_vyrobku as name, mj, COALESCE(dph, 20) as dph
            FROM produkty 
            WHERE LOWER(nazov_vyrobku) LIKE %s OR ean LIKE %s
            LIMIT 30
        """
        rows = db_connector.execute_query(sql, (like_q, like_q), fetch='all') or []
    except Exception as e1:
        # Ak tabuľka produkty zlyhá, skúsime záložnú tabuľku sklad2
        try:
            sql_fallback = """
                SELECT ean, nazov_produktu as name, COALESCE(mj, 'kg') as mj, COALESCE(dph, 20) as dph
                FROM sklad2 
                WHERE LOWER(nazov_produktu) LIKE %s OR ean LIKE %s
                LIMIT 30
            """
            rows = db_connector.execute_query(sql_fallback, (like_q, like_q), fetch='all') or []
        except Exception as e2:
            return jsonify({'error': f"Chyba databázy produktov: {str(e2)}"}), 500
            
    try:
        # 2. Zistenie historických cien pre daného zákazníka
        hist_prices = {}
        if customer_id and rows:
            eans = [str(r['ean']) for r in rows if r.get('ean')]
            if eans:
                format_strings = ','.join(['%s'] * len(eans))
                hist_sql = f"""
                    SELECT op.ean_produktu, op.cena_bez_dph
                    FROM b2b_objednavky_polozky op
                    JOIN b2b_objednavky o ON o.id = op.objednavka_id
                    WHERE o.zakaznik_id = %s 
                      AND op.ean_produktu IN ({format_strings})
                    ORDER BY o.datum_objednavky DESC
                """
                params = tuple([customer_id] + eans)
                hist_rows = db_connector.execute_query(hist_sql, params, fetch='all') or []
                
                for hr in hist_rows:
                    ean_key = str(hr['ean_produktu'])
                    if ean_key not in hist_prices:
                        hist_prices[ean_key] = float(hr['cena_bez_dph'] or 0)

        # 3. Zlúčenie výsledkov a bezpečné nastavenie formátov
        for r in rows:
            r['dph'] = float(r.get('dph') or 20.0)
            
            ean_val = str(r.get('ean'))
            if ean_val in hist_prices:
                r['price'] = hist_prices[ean_val]
                r['has_history_price'] = True
            else:
                r['price'] = 0.0
                r['has_history_price'] = False

        return jsonify(rows)

    except Exception as e:
        print(f"Kritická chyba pri spracovaní cien: {e}")
        return jsonify({'error': f"Chyba spracovania: {str(e)}"}), 500
    
@leader_bp.post('/manual_order/submit')
@login_required(role=('veduci', 'admin'))
def submit_manual_order():
    _ensure_manual_customers_table()
    data = request.get_json() or {}
    customer = data.get('customer', {})
    items = data.get('items', [])
    delivery_date = data.get('delivery_date')
    note = data.get('note', '')

    if not customer.get('interne_cislo') or not customer.get('nazov_firmy'):
        return jsonify({'error': 'Chýba zákazník.'}), 400
    if not items:
        return jsonify({'error': 'Objednávka neobsahuje položky.'}), 400

    login_id = customer['interne_cislo']
    is_registered = customer.get('is_registered') == '1'
    cust_email = customer.get('kontakt') if is_registered else None
    
    # ZMENA: Prefix B2BM- pre lepšiu filtráciu manuálnych objednávok
    order_number = f"B2BM-{login_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    total_net = 0.0
    total_vat = 0.0
    pdf_items = []

    for it in items:
        qty = float(it.get('quantity', 0))
        price = float(it.get('price', 0))
        dph = float(it.get('dph', 20))
        
        line_net = price * qty
        line_vat = line_net * (dph / 100.0)
        total_net += line_net
        total_vat += line_vat

        pdf_items.append({
            "ean": str(it.get("ean")),
            "name": it.get("name"),
            "unit": it.get("unit", "kg"),
            "quantity": qty,
            "price": price,
            "dph": dph,
            "line_net": line_net,
            "line_vat": line_vat,
            "line_gross": line_net + line_vat
        })

    total_gross = total_net + total_vat
    del_iso = _iso(delivery_date)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO b2b_objednavky
              (cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, poznamka, celkova_suma_s_dph, stav)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'Prijatá')
        """, (order_number, login_id, customer['nazov_firmy'], customer.get('adresa', ''), del_iso, note, total_gross))
        
        oid = cur.lastrowid
        
        lines = []
        for i in pdf_items:
            lines.append((
                oid, i["ean"], i["name"], i["quantity"], i["unit"], i["dph"], i["price"], del_iso
            ))
            
        cur.executemany("""
            INSERT INTO b2b_objednavky_polozky
              (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, cena_bez_dph, pozadovany_datum_dodania)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """, lines)
        conn.commit()
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({'error': f'Databázová chyba: {str(e)}'}), 500
    finally:
        if conn and conn.is_connected():
            cur.close()
            conn.close()

    import copy
    order_payload = {
        "order_number": order_number,
        "customerName": customer['nazov_firmy'],
        "customerAddress": customer.get('adresa', ''),
        "deliveryDate": delivery_date,
        "note": note,
        "items": pdf_items,
        "totalNet": total_net,
        "totalVat": total_vat,
        "totalWithVat": total_gross,
        "customerCode": login_id,
        "route_number": "",
        "branch_number": ""
    }

    try:
        import pdf_generator
        import notification_handler
        
        pdf_bytes, _, csv_filename_raw = pdf_generator.create_order_files(order_payload)

        # Mapovanie a generovanie CSV pre váhový terminál
        csv_payload = copy.deepcopy(order_payload)
        mapping_db = db_connector.execute_query("SELECT interny_ean, objednavkovy_kod FROM b2b_ean_mapovanie", fetch='all') or []
        ean_map = {str(m['interny_ean']).strip().lstrip('0'): str(m['objednavkovy_kod']).strip() for m in mapping_db if m.get('interny_ean')}

        for item in csv_payload.get("items", []):
            orig_ean = str(item.get("ean", "")).strip().lstrip('0')
            if orig_ean in ean_map:
                item["ean"] = ean_map[orig_ean]

        _, csv_bytes, _ = pdf_generator.create_order_files(csv_payload)

        # Fyzické uloženie CSV na disk
        export_dir = os.getenv("B2B_CSV_EXPORT_DIR", "/var/app/data/b2bobjednavky")
        os.makedirs(export_dir, exist_ok=True)
        file_name = csv_filename_raw if csv_filename_raw else f"objednavka_{order_number}.csv"
        file_path = os.path.join(export_dir, file_name)
        
        if csv_bytes:
            with open(file_path, "wb") as f:
                f.write(csv_bytes)
                
        # Odosielanie E-mailov (BEZ CSV a s upraveným predmetom)
        expedition_email = os.getenv("B2B_EXPEDITION_EMAIL") or "miksroexpedicia@gmail.com"
        
        try:
            # 1. EXPEDÍCIA: Dostane e-mail s novým predmetom a BEZ CSV (CSV už je na serveri)
            notification_handler.send_order_confirmation_email(
                to=expedition_email, 
                order_number=order_number, 
                pdf_content=pdf_bytes, 
                csv_content=None,                       # ZABRÁNI PRILOŽENIU CSV
                csv_filename=None,                      # ZABRÁNI PRILOŽENIU CSV
                customer_name=customer['nazov_firmy'],  # DO PREDMETU
                delivery_date=delivery_date             # DO PREDMETU
            )
        except Exception as e:
            print(f"Chyba pri maili na expediciu: {e}")

        if is_registered and cust_email and '@' in cust_email:
            try:
                # 2. ZÁKAZNÍK: Dostane len PDF a zakážeme duplicitnú kópiu na expedíciu
                notification_handler.send_order_confirmation_email(
                    to=cust_email, 
                    order_number=order_number, 
                    pdf_content=pdf_bytes, 
                    csv_content=None,
                    send_exped_copy=False               # ZABRÁNI DUPLICITNÉMU E-MAILU
                )
            except Exception as e:
                print(f"Chyba pri maili zákazníkovi: {e}")

    except Exception as e:
        print(f"Chyba pri generovaní súborov: {e}")

    return jsonify({
        'message': 'Objednávka úspešne vytvorená. CSV bolo odoslané na sklad.',
        'order_id': oid,
        'order_number': order_number
    })

@leader_bp.get('/manual_order/pricelist_items')
@login_required(role=('veduci', 'admin'))
def manual_pricelist_items():
    pl_id = request.args.get('pricelist_id')
    if not pl_id: 
        return jsonify([])
    
    sql = """
        SELECT cp.ean_produktu as ean, p.nazov_vyrobku as name, cp.cena as price, p.mj, p.dph 
        FROM b2b_cennik_polozky cp
        JOIN produkty p ON p.ean = cp.ean_produktu
        WHERE cp.cennik_id = %s
        ORDER BY p.predajna_kategoria, p.nazov_vyrobku
    """
    rows = db_connector.execute_query(sql, (pl_id,), fetch='all') or []
    
    # Prevádzame Decimals na floaty pre JSON odpoveď
    for r in rows:
        r['price'] = float(r.get('price', 0))
        r['dph'] = float(r.get('dph', 20))
        
    return jsonify(rows)

@leader_bp.get('/manual_order/history')
@login_required(role=('veduci', 'admin'))
def manual_order_history():
    limit = int(request.args.get('limit', 50))
    q = request.args.get('q', '').strip()
    
    sql = """
        SELECT id, cislo_objednavky, nazov_firmy, pozadovany_datum_dodania, celkova_suma_s_dph, stav, datum_objednavky
        FROM b2b_objednavky
        WHERE cislo_objednavky LIKE 'B2BM-%'
    """
    params = []
    
    if q:
        sql += " AND nazov_firmy LIKE %s "
        params.append(f"%{q}%")
        
    sql += " ORDER BY datum_objednavky DESC LIMIT %s"
    params.append(limit)

    rows = db_connector.execute_query(sql, tuple(params), fetch='all') or []
    
    for r in rows:
        r['datum_objednavky'] = _iso(r.get('datum_objednavky'))
        r['pozadovany_datum_dodania'] = _iso(r.get('pozadovany_datum_dodania'))
        r['celkova_suma_s_dph'] = float(r.get('celkova_suma_s_dph') or 0)
        
    return jsonify(rows)

@leader_bp.post('/logistics/bulk-assign-route')
@login_required(role=('veduci','admin'))
def leader_bulk_assign_route():
    import b2b_handler
    return jsonify(b2b_handler.bulk_assign_route(request.get_json(silent=True) or {}))

@leader_bp.get('/logistics/daily-summary')
@login_required(role=('veduci','admin'))
def leader_daily_summary():
    date_str = request.args.get('date')
    import b2b_handler
    return jsonify(b2b_handler.get_daily_items_summary({'date': date_str}))

@leader_bp.get('/production/predictive_batch')
@login_required(role=('veduci', 'admin'))
def leader_predictive_batch():
    target_date = request.args.get('date')
    if not target_date:
        target_date = (date.today() + timedelta(days=1)).strftime('%Y-%m-%d')
        
    # ZMENA 1: Pevný filter na prefix EDI objednávok namiesto názvu firmy
    order_filter = 'EDI-%'

    TOLERANCES = {
        'výrobky': 1.08, 'bravčové mäso chladené': 1.03, 'hovädzie mäso chladené': 1.03,
        'hydinové mäso chladené': 1.03, 'bravčové mäso mrazené': 1.10, 'hovädzie mäso mrazené': 1.10,
        'hydinové mäso mrazené': 1.10, 'ryby mrazené': 1.10, 'zelenina': 1.05, 'tovar': 1.05, 'default': 1.05
    }

    try:
        conn = _get_conn()
        cur = conn.cursor(dictionary=True)
        
        # 1. HISTÓRIA (Priemer za posledných 30 dní - filter podľa cislo_objednavky)
        sql_history = """
            SELECT 
                op.ean_produktu as ean, 
                MAX(op.nazov_vyrobku) as name,
                MAX(LOWER(COALESCE(p.predajna_kategoria, 'default'))) as category,
                MAX(COALESCE(p.mj, 'kg')) as mj,
                (SUM(op.mnozstvo) / GREATEST(COUNT(DISTINCT DATE(o.pozadovany_datum_dodania)), 1)) as avg_qty
            FROM b2b_objednavky_polozky op
            JOIN b2b_objednavky o ON o.id = op.objednavka_id
            LEFT JOIN produkty p ON p.ean = op.ean_produktu
            WHERE o.pozadovany_datum_dodania < %s
              AND o.pozadovany_datum_dodania >= DATE_SUB(%s, INTERVAL 30 DAY)
              AND o.cislo_objednavky LIKE %s
              AND o.stav != 'Zrušená'
            GROUP BY op.ean_produktu
        """
        cur.execute(sql_history, (target_date, target_date, order_filter))
        history_rows = cur.fetchall() or []

        # 2. REÁLNY STAV NA DNES (Taktiež len EDI objednávky)
        sql_real = """
            SELECT 
                op.ean_produktu as ean, 
                SUM(op.mnozstvo) as real_qty
            FROM b2b_objednavky_polozky op
            JOIN b2b_objednavky o ON o.id = op.objednavka_id
            WHERE DATE(o.pozadovany_datum_dodania) = %s
              AND o.cislo_objednavky LIKE %s
              AND o.stav != 'Zrušená'
            GROUP BY op.ean_produktu
        """
        cur.execute(sql_real, (target_date, order_filter))
        real_rows = {str(r['ean']): float(r['real_qty']) for r in cur.fetchall() or []}

        # --- LADIACE VÝPISY DO TERMINÁLU ---
        print("\n" + "="*50)
        print(f"🔎 DEBUG SLEPÉHO ZBERU (Dátum: {target_date}, Filter: {order_filter})")
        print(f"Nájdených produktov z EDI histórie: {len(history_rows)}")
        if not history_rows:
            print("❌ V histórii (posledných 30 dní) neboli nájdené žiadne EDI objednávky!")
        
        results = []
        for h in history_rows:
            ean = str(h['ean'])
            name = h['name']
            cat = h['category']
            mj = h['mj']
            avg_qty = float(h['avg_qty'])
            
            tolerance_multiplier = TOLERANCES.get('default')
            for key, val in TOLERANCES.items():
                if key in cat:
                    tolerance_multiplier = val
                    break
                    
            historical_target = avg_qty * tolerance_multiplier
            real_qty = real_rows.get(ean, 0.0)
            
            if real_qty >= historical_target:
                final_target = real_qty * tolerance_multiplier
            else:
                final_target = historical_target

            delta_to_pick = final_target - real_qty
            
            if delta_to_pick > 0:
                print(f"📦 {name}: Priemer={avg_qty:.2f}, DnesObjednané={real_qty:.2f}, Cieľ={final_target:.2f} -> CHÝBA NACHYSTAŤ={delta_to_pick:.2f}")

            results.append({
                'ean': ean,
                'name': name,
                'kategoria': cat,
                'mj': mj,
                'avg_history': round(avg_qty, 2),
                'tolerance_pct': round((tolerance_multiplier - 1) * 100, 1),
                'real_ordered': round(real_qty, 2),
                'total_target': round(final_target, 2),
                'blind_pick_delta': round(max(0.0, delta_to_pick), 2)
            })

        print("="*50 + "\n")

        results.sort(key=lambda x: x['blind_pick_delta'], reverse=True)

        return jsonify({
            'target_date': target_date,
            'client_filter': order_filter,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'predictions': [r for r in results if r['blind_pick_delta'] > 0]
        })
    
    except Exception as e:
        return jsonify({'error': f'Zlyhanie prediktívneho algoritmu: {str(e)}'}), 500
    finally:
        try: cur.close()
        except: pass
        try: conn.close()
        except: pass

@leader_bp.get('/plan/rozpis')
@login_required(role=('veduci', 'admin'))
def leader_plan_rozpis():
    target_date = request.args.get('date')
    category = request.args.get('category', 'all')
    
    if not target_date:
        return jsonify({'error': 'Chýba dátum.'}), 400

    # Základný SQL dotaz (spája B2B aj B2C objednávky)
    sql_base = """
        SELECT 
            odberatel, produkt, mnozstvo, mj, kategoria
        FROM (
            SELECT 
                o.nazov_firmy as odberatel, 
                pol.nazov_vyrobku as produkt, 
                pol.mnozstvo, pol.mj, 
                p.predajna_kategoria as kategoria,
                o.pozadovany_datum_dodania as datum,
                o.stav
            FROM b2b_objednavky_polozky pol
            JOIN b2b_objednavky o ON o.id = pol.objednavka_id
            LEFT JOIN produkty p ON p.ean = pol.ean_produktu
            
            UNION ALL
            
            SELECT 
                COALESCE(o.nazov_firmy, 'B2C Zákazník') as odberatel, 
                pol.nazov_vyrobku as produkt, 
                pol.mnozstvo, pol.mj, 
                p.predajna_kategoria as kategoria,
                o.pozadovany_datum_dodania as datum,
                o.stav
            FROM b2c_objednavky_polozky pol
            JOIN b2c_objednavky o ON o.id = pol.objednavka_id
            LEFT JOIN produkty p ON p.ean = pol.ean_produktu
        ) as combined
        WHERE DATE(datum) = %s AND stav != 'Zrušená'
    """
    
    params = [target_date]
    
    # ROZŠÍRENÁ LOGIKA FILTROVANIA
    if category != 'all':
        if category == 'mrazené':
            # Agresívny filter: hľadáme kľúčové slovo "mrazen" ALEBO explicitné kategórie
            sql_base += """ 
                AND (
                    LOWER(kategoria) LIKE '%%mrazen%%' 
                    OR LOWER(produkt) LIKE '%%mrazen%%' 
                    OR LOWER(kategoria) = 'tovar' 
                    OR LOWER(kategoria) = 'ryby'
                )
            """
        else:
            # Štandardný filter pre ostatné kategórie (hovädzie, bravčové atď.)
            sql_base += " AND kategoria = %s"
            params.append(category)

    try:
        rows = db_connector.execute_query(sql_base, tuple(params), fetch='all') or []
        return jsonify({'items': rows})
    except Exception as e:
        print(f"Chyba pri generovaní rozpisu: {e}")
        return jsonify({'error': str(e)}), 500