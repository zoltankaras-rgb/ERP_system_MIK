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
    return jsonify({'customers': _read_b2b_customers()})

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
    if not order_id:
        return jsonify({'error':'chýba order_id'}), 400
    if order_id.isdigit():
        return redirect(f"/api/kancelaria/b2b/print_order_pdf/{order_id}", code=302)
    row = db_connector.execute_query(
        "SELECT id FROM b2b_objednavky WHERE cislo_objednavky=%s",
        (order_id,), fetch='one'
    )
    if row and row.get('id'):
        return redirect(f"/api/kancelaria/b2b/print_order_pdf/{row['id']}", code=302)
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
    Odošle notifikácie (PDF/CSV).
    ÚPRAVA: Pre ID 255 natvrdo nastaví meno v PDF na "255 - [Manuálne meno]".
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
    payload = {}
    try:
        from b2b_handler import build_order_pdf_payload_admin
        payload = build_order_pdf_payload_admin(int(order_id))
    except Exception:
        # Fallback ak zlyhá import buildera (vyskladáme ručne)
        items = db_connector.execute_query(
            "SELECT ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, cena_bez_dph "
            "FROM b2b_objednavky_polozky WHERE objednavka_id=%s ORDER BY id", (order_id,)
        ) or []
        total_net = sum(float((it.get('cena_bez_dph') or 0)) * float((it.get('mnozstvo') or 0)) for it in items)
        total_vat = sum(
            float((it.get('cena_bez_dph') or 0)) * float((it.get('mnozstvo') or 0)) * (abs(float(it.get('dph') or 0))/100.0)
            for it in items
        )
        delivery = head.get('pozadovany_datum_dodania')
        if isinstance(delivery, (datetime, date)):
            delivery = delivery.strftime("%Y-%m-%d")
            
        payload = {
            "order_number": head['cislo'],
            "customer_address": head.get("adresa") or "",
            "delivery_date": delivery or "",
            "note": "",
            "items": [{
                "ean": it.get("ean_produktu"),
                "name": it.get("nazov_vyrobku"),
                "quantity": float(it.get("mnozstvo") or 0),
                "unit": it.get("mj") or "ks",
                "price": float(it.get("cena_bez_dph") or 0),
                "dph": abs(float(it.get("dph") or 0))
            } for it in items],
            "totalNet": total_net,
            "totalVat": total_vat,
            "totalWithVat": total_net + total_vat,
        }

    # --- KĽÚČOVÁ OPRAVA: PREPÍSANIE MENA PRE PDF ---
    # Toto zabezpečí, že sa tam zobrazí to, čo ste napísali do objednávky
    
    manual_name = head.get('nazov_firmy') or ""
    zakaznik_id_str = str(head.get('zakaznik_id') or "")

    if zakaznik_id_str == '255':
        # Pre ID 255 spojíme ID a meno
        display_name = f"255 - {manual_name}"
    else:
        # Pre ostatných použijeme meno z objednávky (alebo ak je prázdne, tak z payloadu)
        display_name = manual_name if manual_name else payload.get('customer_name', '')

    # Nastavíme to do oboch kľúčov, ktoré PDF generátor používa
    payload['customer_name'] = display_name
    payload['customerName'] = display_name

    # 3) Vygeneruj PDF + CSV
    try:
        # CSV názov: 255_Meno_Datum.csv
        safe_name = "".join(x for x in manual_name if x.isalnum())
        csv_fname = f"{zakaznik_id_str}_{safe_name}_{datetime.now().strftime('%Y%m%d%H%M')}.csv"
        
        pdf_bytes, csv_bytes, _ = pdf_generator.create_order_files(payload)
    except Exception as e:
        return jsonify({'error': f'Generovanie PDF/CSV zlyhalo: {e}'}), 500

    # 4) Odoslanie e-mailov
    expedition_email = os.getenv("B2B_EXPEDITION_EMAIL") or "miksroexpedicia@gmail.com"

    # A) Zákazník - len ak má email (pri ID 255 bude cust_email None, takže sa nepošle)
    if cust_email:
        try:
            notification_handler.send_order_confirmation_email(
                to=cust_email,
                order_number=payload.get('order_number'),
                pdf_content=pdf_bytes,
                csv_content=None
            )
        except: pass

    # B) Expedícia - pošle sa VŽDY (PDF + CSV)
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

    return jsonify({'message':'Objednávka spracovaná, CSV odoslané na sklad.', 'order_id': order_id})
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
# Krájačky / výroba – placeholder
@leader_bp.get('/get_slicable_products')
@login_required(role=('veduci', 'admin'))
def leader_get_slicable_products():
    """
    Vráti zoznam produktov na krájanie (typ_polozky LIKE '%KRAJAN%').
    Využíva existujúcu logiku z expedition_handler.
    """
    return jsonify(expedition_handler.get_slicable_products())# =============================================================================


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
        'customer': data.get('order_id'),    # Frontend posiela názov zákazníka v poli 'order_id' (label: Objednávka/Zákazník)
        'order_id': '',                      # Ak by sme chceli separátne ID
        'due_date': data.get('due_date')
    }

    # Voláme logiku z expedície
    result = expedition_handler.create_manual_slicing_job(payload)
    
    if result.get('error'):
        return jsonify(result), 400
        
    return jsonify(result)

# leader_handler.py

@leader_bp.get('/cut_jobs')
@login_required(role=('veduci','admin'))
def leader_cut_jobs_list():
    # Dynamicky zistíme názov stĺpca (nazov_vyrobu vs nazov_vyrobku)
    zv = 'nazov_vyrobu' if _table_exists('zaznamy_vyroba') and 'nazov_vyrobu' in _table_cols('zaznamy_vyroba') else 'nazov_vyrobku'
    
    # OPRAVA: Používame 'datum_spustenia' namiesto 'created_at'
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

# Pomocná funkcia pre leader_handler (ak ju tam nemáte)
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

    # Hľadáme v tabuľke 'produkty'. 
    # Predpokladáme, že nákupná cena je v stĺpci 'nakupna_cena'.
    # Ak je nákupná cena NULL, použijeme 0.
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
        # Pre prípad, že by stĺpec nakupna_cena neexistoval v tabuľke produkty,
        # skúsime fallback na tabuľku sklad (ak je to potrebné), alebo vrátime chybu.
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