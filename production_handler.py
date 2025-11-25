from flask import session
import db_connector
from datetime import datetime, timedelta
import unicodedata
from typing import List, Dict, Any, Tuple, Optional

# Položky, ktoré sa neodpisujú (nekonečný sklad)
INFINITE_STOCK_NAMES = {'Ľad', 'Lad', 'Voda', 'Ovar'}

# ───────────────────────── Pomocné ─────────────────────────

def slugify(value: str) -> str:
    try:
        value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
        value = value.lower().replace(' ', '_').replace('.', '')
        return ''.join(c for c in value if c.isalnum() or c == '_')
    except Exception:
        return "".join(c for c in value if c.isalnum() or c in (' ', '_')).lower().replace(' ', '_')

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

def _norm(s: Optional[str]) -> str:
    if not s: return ''
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode('ascii')
    return s.strip().lower()

def _category_from_values(cat_raw: Optional[str], name: str) -> str:
    """
    Mapuje na: Mäso | Koreniny | Obaly | Pomocný materiál (heuristika + kategória)
    """
    s = _norm(cat_raw)
    n = _norm(name)

    if s in ('maso', 'mäso', 'meat') or any(k in s for k in ['brav', 'hovad', 'hoväd', 'hydin', 'ryb']):
        return 'Mäso'
    if s.startswith('koren') or 'korenin' in s or any(k in s for k in ['paprik', 'rasc', 'kmín', 'kmin', 'cesnak', 'dusit', 'sol', 'soľ']):
        return 'Koreniny'
    if 'obal' in s or 'cerv' in s or 'črev' in s or 'fóli' in s or 'foli' in s or 'vak' in s or 'siet' in s or 'spag' in s or 'špag' in s:
        return 'Obaly'
    if 'pomoc' in s or 'material' in s or 'materi' in s:
        return 'Pomocný materiál'

    if any(k in n for k in ['brav', 'hovad', 'hoväd', 'kurac', 'mork', 'morč', 'hydin', 'ryb', 'mlet']):
        return 'Mäso'
    if any(k in n for k in ['koren', 'paprik', 'rasc', 'kmin', 'dusit', 'sol', 'soľ', 'cesnak']):
        return 'Koreniny'
    if any(k in n for k in ['obal', 'črev', 'cerv', 'fóli', 'foli', 'vak', 'siet', 'špag', 'spag']):
        return 'Obaly'
    if n in ('voda', 'lad', 'ľad', 'ovar') or 'pomoc' in n:
        return 'Pomocný materiál'
    return 'Pomocný materiál'

def _build_sklad_select_sql() -> str:
    """
    SELECT na sklad – funguje aj bez kategoria/typ/podtyp; vráti aj cenu a min zásobu.
    """
    has_cat  = _has_col('sklad', 'kategoria')
    has_typ  = _has_col('sklad', 'typ')
    has_pod  = _has_col('sklad', 'podtyp')
    has_def  = _has_col('sklad', 'default_cena_eur_kg')
    has_buy  = _has_col('sklad', 'nakupna_cena')
    has_min  = _has_col('sklad', 'min_zasoba')
    has_inf  = _has_col('sklad', 'is_infinite_stock')

    cat_expr = 'kategoria' if has_cat else ('typ' if has_typ else ('podtyp' if has_pod else "' '"))
    price_expr = (
        "COALESCE(default_cena_eur_kg, nakupna_cena, 0)" if (has_def and has_buy)
        else ("COALESCE(default_cena_eur_kg, 0)" if has_def else ("COALESCE(nakupna_cena, 0)" if has_buy else "0"))
    )
    min_expr = "COALESCE(min_zasoba, 0)" if has_min else "0"
    inf_expr = "COALESCE(is_infinite_stock, 0)" if has_inf else "0"

    return f"""
        SELECT
            nazov AS name,
            {cat_expr} AS cat_raw,
            mnozstvo AS quantity,
            {price_expr} AS price,
            {min_expr} AS minStock,
            {inf_expr} AS is_infinite_stock
        FROM sklad
        ORDER BY nazov
    """

def _zv_name_col() -> str:
    """
    V zaznamy_vyroba zistí názov stĺpca s menom výrobku: 'nazov_vyrobu' alebo 'nazov_vyrobku'.
    """
    return 'nazov_vyrobu' if _has_col('zaznamy_vyroba', 'nazov_vyrobu') else 'nazov_vyrobku'

# ───────────────────────── Sklad / Recepty (pre UI) ─────────────────────────

def get_warehouse_state() -> Dict[str, Any]:
    rows = db_connector.execute_query(_build_sklad_select_sql()) or []
    groups: Dict[str, List[Dict[str, Any]]] = {'Mäso': [], 'Koreniny': [], 'Obaly': [], 'Pomocný materiál': []}
    all_items: List[Dict[str, Any]] = []
    for r in rows:
        name = r.get('name')
        quantity = float(r.get('quantity') or 0.0)
        price = float(r.get('price') or 0.0)
        min_stock = float(r.get('minStock') or 0.0)
        is_inf = bool(r.get('is_infinite_stock') or (name in INFINITE_STOCK_NAMES))
        cat = _category_from_values(r.get('cat_raw'), name)
        rec = {'name': name, 'type': cat, 'quantity': quantity, 'price': price, 'minStock': min_stock, 'is_infinite_stock': is_inf}
        groups.setdefault(cat, []).append(rec)
        all_items.append(rec)
    return {
        'Mäso': groups.get('Mäso', []),
        'Koreniny': groups.get('Koreniny', []),
        'Obaly': groups.get('Obaly', []),
        'Pomocný materiál': groups.get('Pomocný materiál', []),
        'all': all_items
    }

def get_categorized_recipes() -> Dict[str, Any]:
    rows = db_connector.execute_query("""
        SELECT p.nazov_vyrobku, p.kategoria_pre_recepty
          FROM produkty p
         WHERE p.typ_polozky LIKE 'VÝROBOK%%'
           AND EXISTS (SELECT 1 FROM recepty r WHERE TRIM(r.nazov_vyrobku)=TRIM(p.nazov_vyrobku) LIMIT 1)
         ORDER BY p.kategoria_pre_recepty, p.nazov_vyrobku
    """) or []
    out: Dict[str, List[str]] = {}
    for r in rows:
        out.setdefault(r.get('kategoria_pre_recepty') or 'Nezaradené', []).append(r['nazov_vyrobku'])
    return {'data': out}

def get_planned_production_tasks_by_category() -> Dict[str, List[Dict[str, Any]]]:
    zv_name = _zv_name_col()
    rows = db_connector.execute_query(f"""
        SELECT
            zv.id_davky AS logId,
            zv.{zv_name} AS productName,
            zv.planovane_mnozstvo_kg AS actualKgQty,
            p.kategoria_pre_recepty AS category
          FROM zaznamy_vyroba zv
          JOIN produkty p ON TRIM(zv.{zv_name})=TRIM(p.nazov_vyrobku)
         WHERE zv.stav='Automaticky naplánované'
           AND p.typ_polozky LIKE 'VÝROBOK%%'
         ORDER BY category, productName
    """) or []
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        cat = r.get('category') or 'Nezaradené'
        r['displayQty'] = f"{float(r['actualKgQty']):.2f} kg"
        out.setdefault(cat, []).append(r)
    return out

def get_running_production_tasks_by_category() -> Dict[str, List[Dict[str, Any]]]:
    zv_name = _zv_name_col()
    rows = db_connector.execute_query(f"""
        SELECT
            zv.id_davky AS logId,
            zv.{zv_name} AS productName,
            zv.planovane_mnozstvo_kg AS plannedKg,
            p.kategoria_pre_recepty AS category
          FROM zaznamy_vyroba zv
          JOIN produkty p ON TRIM(zv.{zv_name})=TRIM(p.nazov_vyrobku)
         WHERE zv.stav='Vo výrobe'
         ORDER BY category, productName
    """) or []
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        cat = r.get('category') or 'Nezaradené'
        r['displayQty'] = f"{float(r['plannedKg']):.2f} kg"
        out.setdefault(cat, []).append(r)
    return out

# --- NOVÁ FUNKCIA: Získanie úloh podľa DÁTUMU ---
def get_planned_tasks_by_date() -> Dict[str, Any]:
    """
    Vráti úlohy zoskupené ako: 'Dnes', 'Zajtra', 'Pondelok (25.11.)' atď.
    """
    zv_name = _zv_name_col()
    
    # Hľadáme úlohy, ktoré naplánovala kancelária
    rows = db_connector.execute_query(f"""
        SELECT
            zv.id_davky AS logId,
            zv.{zv_name} AS productName,
            zv.planovane_mnozstvo_kg AS actualKgQty,
            zv.datum_vyroby,
            p.kategoria_pre_recepty AS category
          FROM zaznamy_vyroba zv
          LEFT JOIN produkty p ON TRIM(zv.{zv_name})=TRIM(p.nazov_vyrobku)
         WHERE zv.stav IN ('Automaticky naplánované', 'Naplánované')
         ORDER BY zv.datum_vyroby ASC, p.kategoria_pre_recepty
    """) or []

    grouped = {}
    today = datetime.now().date()
    tomorrow = today + timedelta(days=1)
    
    # Slovenské názvy dní
    sk_days = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota', 'Nedeľa']

    for r in rows:
        d_raw = r.get('datum_vyroby')
        date_label = "Neurčený dátum"
        
        if d_raw:
            if isinstance(d_raw, str):
                try: d_obj = datetime.strptime(d_raw, '%Y-%m-%d').date()
                except: d_obj = None
            elif isinstance(d_raw, datetime):
                d_obj = d_raw.date()
            else:
                d_obj = d_raw # už je date
            
            if d_obj:
                if d_obj == today:
                    date_label = "Dnes"
                elif d_obj == tomorrow:
                    date_label = "Zajtra"
                elif d_obj < today:
                    date_label = "Zmeškané / Staré"
                else:
                    day_name = sk_days[d_obj.weekday()]
                    date_label = f"{day_name} ({d_obj.strftime('%d.%m.')})"

        if date_label not in grouped:
            grouped[date_label] = []
            
        r['displayQty'] = f"{float(r['actualKgQty']):.2f} kg"
        grouped[date_label].append(r)

    return grouped

# --- UPRAVENÁ FUNKCIA: get_production_menu_data ---
def get_production_menu_data() -> Dict[str, Any]:
    return {
        # Posielame týždenný plán namiesto jednoduchého zoznamu
        'weekly_schedule': get_planned_tasks_by_date(),
        'running_tasks': get_running_production_tasks_by_category(),
        'warehouse': get_warehouse_state(),
        # Potrebujeme zoznam všetkých surovín pre dropdown (pri zmene receptu)
        'all_ingredients': get_all_warehouse_items(), 
        'recipes': get_categorized_recipes().get('data')
    }

# ───────────────────────── Recepty / Výpočet ─────────────────────────

def find_recipe_data(product_name: str) -> List[Dict[str, Any]]:
    return db_connector.execute_query(
        """
        SELECT nazov_suroviny, mnozstvo_na_davku_kg
          FROM recepty
         WHERE TRIM(nazov_vyrobku)=TRIM(%s)
         ORDER BY nazov_suroviny
        """,
        (product_name,)
    ) or []

def _get_product_batch_size_kg(product_name: str) -> float:
    row = db_connector.execute_query(
        "SELECT vyrobna_davka_kg FROM produkty WHERE TRIM(nazov_vyrobku)=TRIM(%s) LIMIT 1",
        (product_name,), fetch='one'
    ) or {}
    try:
        val = float(row.get('vyrobna_davka_kg') or 0.0)
        return val if val > 0 else 100.0
    except Exception:
        return 100.0

def calculate_required_ingredients(product_name, planned_weight):
    try:
        planned_weight = float(planned_weight or 0)
    except Exception:
        return {"error": "Zadajte platný produkt a množstvo."}
    if not product_name or planned_weight <= 0:
        return {"error": "Zadajte platný produkt a množstvo."}

    recipe_ingredients = find_recipe_data(product_name)
    if not recipe_ingredients:
        return {"error": f'Recept s názvom "{product_name}" nebol nájdený.'}

    batch_kg = _get_product_batch_size_kg(product_name)
    multiplier = planned_weight / batch_kg

    warehouse = get_warehouse_state()
    stock_map = {x['name']: x for x in (warehouse.get('all') or [])}

    out = []
    for ing in recipe_ingredients:
        per_batch = float(ing.get('mnozstvo_na_davku_kg') or 0.0)
        required = per_batch * multiplier
        meta = stock_map.get(ing['nazov_suroviny'], {})
        available = float(meta.get('quantity') or 0.0)
        is_sufficient = (ing['nazov_suroviny'] in INFINITE_STOCK_NAMES) or (available >= required)
        out.append({
            "name": ing['nazov_suroviny'],
            "type": meta.get('type', 'Neznámy'),
            "required": round(required, 3),
            "inStock": round(available, 2),
            "isSufficient": bool(is_sufficient),
        })
    return {"data": out, "batchKg": batch_kg, "multiplier": multiplier}

# ───────────────────────── Štart výroby (TX) ─────────────────────────

def start_production(productName, plannedWeight, productionDate, ingredients, workerName, existingLogId=None, **kwargs):
    if not all([productName, plannedWeight, productionDate, ingredients]):
        return {"error": "Chýbajú povinné údaje pre spustenie výroby."}
    if not existingLogId and not workerName:
        return {"error": "Chýba meno pracovníka pre vytvorenie manuálnej výrobnej úlohy."}

    try:
        planned_weight_val = float(plannedWeight)
    except Exception:
        return {"error": "Neplatné plánované množstvo."}

    try:
        datetime.strptime(productionDate, '%Y-%m-%d')
    except Exception:
        return {"error": "Dátum výroby musí byť vo formáte YYYY-MM-DD."}

    ing_names = [i.get('name') for i in (ingredients or []) if i.get('name')]
    if not ing_names:
        return {"error": "Výroba musí obsahovať aspoň jednu surovinu."}

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)

        # LOCK riadkov skladu pre dotknuté suroviny
        placeholders = ','.join(['%s'] * len(ing_names))
        cur.execute(f"SELECT nazov, mnozstvo FROM sklad WHERE nazov IN ({placeholders}) FOR UPDATE", tuple(ing_names))
        _ = cur.fetchall() or []

        # Odpis (nekonečné neodpisujeme)
        updates: List[Tuple[float, str]] = []
        for ing in ingredients:
            nm = ing.get('name')
            qty = float(ing.get('quantity') or 0.0)
            if nm in INFINITE_STOCK_NAMES:
                continue
            updates.append((qty, nm))
        if updates:
            cur.executemany("UPDATE sklad SET mnozstvo = mnozstvo - %s WHERE nazov = %s", updates)

        now = datetime.now()
        zv_name = _zv_name_col()

        if existingLogId:
            batch_id = existingLogId
            # cena dávky (ak sú stĺpce na sklade)
            try:
                cur.execute(f"SELECT nazov, COALESCE(default_cena_eur_kg, nakupna_cena, 0) AS cena FROM sklad WHERE nazov IN ({placeholders})", tuple(ing_names))
                price_map = {r['nazov']: float(r.get('cena') or 0.0) for r in (cur.fetchall() or [])}
                total_cost = sum(float(i.get('quantity') or 0.0) * price_map.get(i.get('name'), 0.0) for i in ingredients)
                cur.execute(
                    """
                    UPDATE zaznamy_vyroba
                       SET stav=%s,
                           datum_vyroby=%s,
                           datum_spustenia=%s,
                           celkova_cena_surovin=%s
                     WHERE id_davky=%s
                    """,
                    ('Vo výrobe', productionDate, now, total_cost, batch_id)
                )
            except Exception:
                cur.execute(
                    """
                    UPDATE zaznamy_vyroba
                       SET stav=%s,
                           datum_vyroby=%s,
                           datum_spustenia=%s
                     WHERE id_davky=%s
                    """,
                    ('Vo výrobe', productionDate, now, batch_id)
                )
            cur.execute("DELETE FROM zaznamy_vyroba_suroviny WHERE id_davky=%s", (batch_id,))
            message = f"Príkaz {batch_id} bol spustený do výroby."
        else:
            safe_product = slugify(productName)[:20]
            safe_worker = slugify(workerName).upper()[:6]
            date_str = datetime.strptime(productionDate, '%Y-%m-%d').strftime('%d%m%y')
            time_str = now.strftime('%H%M')
            batch_id = f"{safe_product}-{safe_worker}-{date_str}-{time_str}-{int(planned_weight_val)}"
            try:
                cur.execute(f"SELECT nazov, COALESCE(default_cena_eur_kg, nakupna_cena, 0) AS cena FROM sklad WHERE nazov IN ({placeholders})", tuple(ing_names))
                price_map = {r['nazov']: float(r.get('cena') or 0.0) for r in (cur.fetchall() or [])}
                total_cost = sum(float(i.get('quantity') or 0.0) * price_map.get(i.get('name'), 0.0) for i in ingredients)
                cur.execute(
                    f"""
                    INSERT INTO zaznamy_vyroba
                        (id_davky, stav, datum_vyroby, {zv_name}, planovane_mnozstvo_kg, datum_spustenia, celkova_cena_surovin)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (batch_id, 'Vo výrobe', productionDate, productName, planned_weight_val, now, total_cost)
                )
            except Exception:
                cur.execute(
                    f"""
                    INSERT INTO zaznamy_vyroba
                        (id_davky, stav, datum_vyroby, {zv_name}, planovane_mnozstvo_kg, datum_spustenia)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (batch_id, 'Vo výrobe', productionDate, productName, planned_weight_val, now)
                )
            message = f"VÝROBA SPUSTENÁ! Šarža: {batch_id}."

        # Zapíš použité suroviny
        to_log = [(batch_id, i['name'], float(i['quantity'])) for i in ingredients if i.get('name') and float(i.get('quantity') or 0) > 0]
        if to_log:
            cur.executemany(
                "INSERT INTO zaznamy_vyroba_suroviny (id_davky, nazov_suroviny, pouzite_mnozstvo_kg) VALUES (%s,%s,%s)",
                to_log
            )

        conn.commit()
        return {"message": message}
    except Exception as e:
        if conn: conn.rollback()
        raise e
    finally:
        if conn and conn.is_connected(): conn.close()

# ───────────────────────── Inventúra / Výdaj ─────────────────────────

# production_handler.py
# production_handler.py

# --- POMOCNÁ FUNKCIA: Nájdi alebo vytvor otvorenú inventúru ---
def _get_or_create_draft_log(cursor, worker_name):
    # Hľadáme otvorenú inventúru (DRAFT)
    cursor.execute("SELECT id FROM inventory_logs WHERE status = 'DRAFT' LIMIT 1")
    row = cursor.fetchone()
    
    if row:
        return row['id'] # alebo row[0] ak nepouzivate dictionary cursor
    else:
        # Ak neexistuje, vytvoríme novú
        cursor.execute(
            "INSERT INTO inventory_logs (created_at, worker_name, note, status) VALUES (NOW(), %s, '', 'DRAFT')",
            (worker_name,)
        )
        return cursor.lastrowid

# ───────────────────────── NOVÉ: Priebežné uloženie kategórie ─────────────────────────
def save_inventory_category(inventory_data, category_name):
    if not inventory_data:
        return {"message": "Žiadne dáta na uloženie."}

    worker_name = "Neznámy"
    user = session.get('user')
    if user:
        worker_name = user.get('full_name') or user.get('username') or "Neznámy"

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True) # Uistite sa, ze pouzivate dictionary=True alebo upravte indexy

        # 1. Získame ID otvorenej inventúry
        log_id = _get_or_create_draft_log(cur, worker_name)

        updates_count = 0

        # 2. Prejdeme položky
        for item in inventory_data:
            name = item.get('name')
            try:
                real_qty = float(item.get('realQty'))
                if real_qty < 0: continue
            except:
                continue 

            # A) Získame aktuálne dáta (kvôli cene a systémovému stavu PRE REPORT)
            # Pozor: Systémový stav sa mení, ale pre inventúru chceme snapshot. 
            # Pri drafte aktualizujeme záznam, ak už v logu existuje.
            cur.execute("""
                SELECT 
                    COALESCE(sv.mnozstvo, 0) as sys_qty,
                    COALESCE(s.nakupna_cena, s.default_cena_eur_kg, 0) as price
                FROM sklad s
                LEFT JOIN sklad_vyroba sv ON sv.nazov = s.nazov
                WHERE s.nazov = %s
            """, (name,))
            row = cur.fetchone()
            
            # Fallback hodnoty
            system_qty = float(row['sys_qty']) if row else 0.0
            unit_price = float(row['price']) if row else 0.0

            # B) OKAMŽITÝ UPDATE SKLADU (Aby výroba mohla pokračovať s novými číslami)
            cur.execute("""
                INSERT INTO sklad_vyroba (nazov, mnozstvo) 
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE mnozstvo = %s
            """, (name, real_qty, real_qty))

            # C) Zápis do LOGU (História) - UPSERT (ak už položku uložil, prepíšeme ju)
            # Najprv zmažeme starý záznam pre túto položku v tomto logu (jednoduchší update)
            cur.execute("DELETE FROM inventory_log_items WHERE inventory_log_id=%s AND product_name=%s", (log_id, name))
            
            cur.execute("""
                INSERT INTO inventory_log_items 
                (inventory_log_id, product_name, category, system_qty, real_qty, unit_price)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (log_id, name, category_name, system_qty, real_qty, unit_price))
            
            updates_count += 1

        conn.commit()
        return {"message": f"Kategória '{category_name}' bola uložená ({updates_count} pol.). Sklad aktualizovaný."}

    except Exception as e:
        if conn: conn.rollback()
        return {"error": f"Chyba: {str(e)}"}
    finally:
        if conn and conn.is_connected(): conn.close()

# ───────────────────────── NOVÉ: Ukončenie inventúry ─────────────────────────
def finish_inventory_process():
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        # Nájde otvorený draft a zmení ho na COMPLETED
        cur.execute("UPDATE inventory_logs SET status='COMPLETED', created_at=NOW() WHERE status='DRAFT'")
        
        if cur.rowcount > 0:
            conn.commit()
            return {"message": "Inventúra bola úspešne UKONČENÁ a odoslaná do kancelárie."}
        else:
            return {"message": "Nebola nájdená žiadna rozpracovaná inventúra na ukončenie."}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected(): conn.close()
        
def update_inventory(inventory_data):
    if not inventory_data:
        return {"error": "Neboli zadané žiadne platné reálne stavy."}

    worker_name = "Neznámy"
    user = session.get('user')
    if user:
        worker_name = user.get('full_name') or user.get('username') or "Neznámy"

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()

        # 1. Vytvoríme hlavičku inventúry
        cur.execute(
            "INSERT INTO inventory_logs (created_at, worker_name, note) VALUES (NOW(), %s, '')",
            (worker_name,)
        )
        log_id = cur.lastrowid

        updates_count = 0

        # 2. Spracujeme položky
        for item in inventory_data:
            name = item.get('name')
            try:
                real_qty = float(item.get('realQty'))
                if real_qty < 0: raise ValueError()
            except:
                continue 

            # A) Získame systémový stav zo SKLAD_VYROBA (tam sa robí výrobná inventúra)
            #    a cenu zo SKLAD (karta) alebo posledného príjmu
            cur.execute("""
                SELECT 
                    COALESCE(sv.mnozstvo, 0) as sys_qty,
                    COALESCE(s.nakupna_cena, s.default_cena_eur_kg, 0) as price
                FROM sklad s
                LEFT JOIN sklad_vyroba sv ON sv.nazov = s.nazov
                WHERE s.nazov = %s
            """, (name,))
            row = cur.fetchone()
            
            system_qty = 0.0
            unit_price = 0.0
            
            if row:
                system_qty = float(row[0] or 0)
                unit_price = float(row[1] or 0)

            # B) Aktualizujeme SKLAD_VYROBA (nie sklad kariet)
            #    Použijeme INSERT ... ON DUPLICATE KEY UPDATE, keby náhodou položka v sklad_vyroba ešte nebola
            cur.execute("""
                INSERT INTO sklad_vyroba (nazov, mnozstvo) 
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE mnozstvo = %s
            """, (name, real_qty, real_qty))

            # C) Zapíšeme do histórie rozdielov
            cur.execute("""
                INSERT INTO inventory_log_items 
                (inventory_log_id, product_name, system_qty, real_qty, unit_price)
                VALUES (%s, %s, %s, %s, %s)
            """, (log_id, name, system_qty, real_qty, unit_price))
            
            updates_count += 1

        conn.commit()
        return {"message": f"Inventúra dokončená. Aktualizovaných {updates_count} položiek. Stav skladu bol upravený."}

    except Exception as e:
        if conn: conn.rollback()
        print(f"Inventory Error: {e}")
        return {"error": f"Chyba pri zápise inventúry: {str(e)}"}
        
    finally:
        if conn and conn.is_connected(): conn.close()
        
def get_all_warehouse_items():
    return db_connector.execute_query(
        "SELECT nazov AS name, COALESCE(kategoria, typ, podtyp, '') AS type FROM sklad ORDER BY nazov"
    ) or []

def manual_warehouse_write_off(data):
    name, worker, qty_str, note = data.get('itemName'), data.get('workerName'), data.get('quantity'), data.get('note')
    if not all([name, worker, qty_str, note]):
        return {"error": "Všetky polia sú povinné."}
    try:
        qty = float(qty_str)
        if qty <= 0:
            raise ValueError("Množstvo musí byť kladné.")
    except (ValueError, TypeError):
        return {"error": "Zadané neplatné množstvo."}

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()

        # 1) Update skladu (nekonečné neodpisujeme)
        if name not in INFINITE_STOCK_NAMES:
            cur.execute("UPDATE sklad SET mnozstvo = mnozstvo - %s WHERE nazov = %s", (qty, name))

        # 2) Log výdaja – dynamicky podľa existujúcich stĺpcov v 'vydajky'
        inserted = False
        if _table_exists('vydajky'):
            col_datum    = _pick_existing_col('vydajky', ['datum','created_at','cas','datetime'])
            col_prac     = _pick_existing_col('vydajky', ['pracovnik','user','pouzivatel','operator'])
            col_nazov    = _pick_existing_col('vydajky', ['nazov_suroviny','nazov','polozka','nazov_polozky'])
            col_mnozstvo = _pick_existing_col('vydajky', ['mnozstvo_kg','mnozstvo'])
            col_pozn     = _pick_existing_col('vydajky', ['poznamka','dovod','poz'])

            if all([col_datum, col_prac, col_nazov, col_mnozstvo, col_pozn]):
                q = f"INSERT INTO vydajky ({col_datum}, {col_prac}, {col_nazov}, {col_mnozstvo}, {col_pozn}) VALUES (%s,%s,%s,%s,%s)"
                cur.execute(q, (datetime.now(), worker, name, qty, note))
                inserted = True

        # 3) Fallback log – ak sa nepodarilo do vydajky, zapíš aspoň do zaznamy_vyroba_suroviny
        if not inserted:
            cur.execute(
                """
                INSERT INTO zaznamy_vyroba_suroviny (id_davky, nazov_suroviny, pouzite_mnozstvo_kg)
                VALUES (%s, %s, %s)
                """,
                ('MANUAL-ODPIS', name, qty)
            )

        conn.commit()
        return {"message": f"Úspešne odpísaných {qty} kg suroviny '{name}'."}
    except Exception as e:
        if conn: conn.rollback()
        raise e
    finally:
        if conn and conn.is_connected(): conn.close()
