# =================================================================
# === HANDLER: KALKULÁTOR ROZRÁBKY MÄSA ===========================
# =================================================================
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
import io

from flask import jsonify, make_response, render_template, send_file
import db_connector

# ---------- UTIL --------------------------------------------------
def _to_decimal(x, nd:int=3):
    try:
        return round(float(x), nd)
    except (TypeError, ValueError):
        return None

def _now():
    return datetime.now()

def _parse_date_any(s: str) -> datetime.date:
    """Prijme 'YYYY-MM-DD', 'DD.MM.YYYY' aj 'YYYY-MM-DDTHH:MM'."""
    if not s:
        raise ValueError
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            pass
    # posledný pokus – orež len dátumovú časť
    try:
        return datetime.fromisoformat(s[:10]).date()
    except Exception:
        raise ValueError

# ---------- ČÍSELNÍKY --------------------------------------------
def list_materials():
    q = "SELECT * FROM meat_materials WHERE is_active=1 ORDER BY name"
    return jsonify(db_connector.execute_query(q) or [])

def save_material(data):
    # {id?, code, name, is_active?}
    code = (data.get('code') or '').strip()
    name = (data.get('name') or '').strip()
    if not code or not name:
        return {"error":"Chýba code alebo name."}
    is_active = 1 if str(data.get('is_active')) in ('1','true','True','on') else 1
    if data.get('id'):
        q = "UPDATE meat_materials SET code=%s,name=%s,is_active=%s WHERE id=%s"
        db_connector.execute_query(q, (code, name, is_active, int(data['id'])), fetch='none')
    else:
        q = "INSERT INTO meat_materials (code,name,is_active) VALUES (%s,%s,%s)"
        db_connector.execute_query(q, (code,name,is_active), fetch='none')
    return {"message":"Surovina uložená."}

def list_products():
    q = "SELECT * FROM meat_products WHERE is_active=1 ORDER BY name"
    return jsonify(db_connector.execute_query(q) or [])

def save_product(data):
    # {id?, code, name, selling_price_eur_kg, is_active?}
    code = (data.get('code') or '').strip()
    name = (data.get('name') or '').strip()
    price = _to_decimal(data.get('selling_price_eur_kg'), 3)
    if not code or not name or price is None:
        return {"error":"Code, name, selling_price_eur_kg sú povinné."}
    is_active = 1 if str(data.get('is_active')) in ('1','true','True','on') else 1
    if data.get('id'):
        q = "UPDATE meat_products SET code=%s,name=%s,selling_price_eur_kg=%s,is_active=%s WHERE id=%s"
        db_connector.execute_query(q, (code,name,price,is_active, int(data['id'])), fetch='none')
    else:
        q = "INSERT INTO meat_products (code,name,selling_price_eur_kg,is_active) VALUES (%s,%s,%s,%s)"
        db_connector.execute_query(q, (code,name,price,is_active), fetch='none')
    return {"message":"Produkt uložený."}

# ---------- DODÁVATELIA (číselník) -------------------------------
def list_suppliers():
    """
    Zoznam aktívnych dodávateľov pre rozrábku mäsa.
    """
    q = """
        SELECT id, code, name,
               ico, dic, ic_dph,
               contact_name, phone, email,
               address_street, address_city, address_zip, address_country,
               is_active
        FROM meat_suppliers
        WHERE is_active=1
        ORDER BY name
    """
    return jsonify(db_connector.execute_query(q) or [])


def save_supplier(data):
    """
    Vytvorenie / úprava dodávateľa.
    """
    code = (data.get('code') or '').strip()
    name = (data.get('name') or '').strip()
    if not code or not name:
        return {"error": "Chýba kód alebo názov dodávateľa."}

    ico  = (data.get('ico') or '').strip() or None
    dic  = (data.get('dic') or '').strip() or None
    ic_dph = (data.get('ic_dph') or '').strip() or None
    contact_name = (data.get('contact_name') or '').strip() or None
    phone  = (data.get('phone') or '').strip() or None
    email  = (data.get('email') or '').strip() or None
    addr_street  = (data.get('address_street') or '').strip() or None
    addr_city    = (data.get('address_city') or '').strip() or None
    addr_zip     = (data.get('address_zip') or '').strip() or None
    addr_country = (data.get('address_country') or '').strip() or None

    is_active = 1 if str(data.get('is_active', '1')) in ('1', 'true', 'True', 'on') else 0

    params = (code, name, ico, dic, ic_dph,
              contact_name, phone, email,
              addr_street, addr_city, addr_zip, addr_country,
              is_active)

    if data.get('id'):
        q = """
            UPDATE meat_suppliers
            SET code=%s, name=%s,
                ico=%s, dic=%s, ic_dph=%s,
                contact_name=%s, phone=%s, email=%s,
                address_street=%s, address_city=%s, address_zip=%s, address_country=%s,
                is_active=%s
            WHERE id=%s
        """
        db_connector.execute_query(q, params + (int(data['id']),), fetch='none')
        msg = "Dodávateľ aktualizovaný."
    else:
        q = """
            INSERT INTO meat_suppliers
              (code, name,
               ico, dic, ic_dph,
               contact_name, phone, email,
               address_street, address_city, address_zip, address_country,
               is_active)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        db_connector.execute_query(q, params, fetch='none')
        msg = "Dodávateľ vytvorený."

    return {"message": msg}


def delete_supplier(supplier_id: int):
    """
    Soft delete dodávateľa – is_active=0.
    """
    db_connector.execute_query(
        "UPDATE meat_suppliers SET is_active=0 WHERE id=%s",
        (int(supplier_id),),
        fetch='none'
    )
    return {"message": "Dodávateľ zmazaný."}

# ---------- MAZANIE SUROVÍN / PRODUKTOV --------------------------
def delete_material(material_id: int):
    """
    Soft delete suroviny – nastaví is_active=0.
    """
    db_connector.execute_query(
        "UPDATE meat_materials SET is_active=0 WHERE id=%s",
        (int(material_id),),
        fetch='none'
    )
    return {"message": "Surovina zmazaná."}


def delete_product(product_id: int):
    """
    Soft delete produktu – nastaví is_active=0.
    """
    db_connector.execute_query(
        "UPDATE meat_products SET is_active=0 WHERE id=%s",
        (int(product_id),),
        fetch='none'
    )
    return {"message": "Produkt zmazaný."}


# ---------- MAZANIE ROZRÁBKY -------------------------------------
def delete_breakdown(breakdown_id: int):
    """
    Fyzicky zmaže celý záznam rozrábky vrátane výstupov, extra nákladov a výsledkov.
    """
    bid = int(breakdown_id)
    db_connector.execute_query("DELETE FROM meat_breakdown_result WHERE breakdown_id=%s", (bid,), fetch='none')
    db_connector.execute_query("DELETE FROM meat_breakdown_output WHERE breakdown_id=%s", (bid,), fetch='none')
    db_connector.execute_query("DELETE FROM meat_breakdown_extra_costs WHERE breakdown_id=%s", (bid,), fetch='none')
    db_connector.execute_query("DELETE FROM meat_breakdown WHERE id=%s", (bid,), fetch='none')
    return {"message": "Rozrábka zmazaná."}

# =================================================================
# === ŠABLÓNY ROZRÁBKY (TEMPLATES) - MAXIMUM FORCE REFRESH ========
# =================================================================

def list_templates():
    # --- PRIDAJ TOTO PRE DIAGNOSTIKU ---
    db_name = db_connector.execute_query("SELECT DATABASE() as db", fetch='one')
    db_count = db_connector.execute_query("SELECT COUNT(*) as cnt FROM meat_templates", fetch='one')
    print(f"\n[DIAGNOSTIKA] Flask DB: {db_name['db']} | Riadkov v meat_templates: {db_count['cnt']}\n")
    # ----------------------------------
    
    try: db_connector.execute_query("COMMIT", fetch='none')
    except: pass
    # --- TESTOVACÍ BLOK START ---
    print("\n" + "!"*50)
    print("TEST PRIPOJENIA: Python handler beží!")
    try:
        test_rows = db_connector.execute_query("SELECT COUNT(*) as c FROM meat_templates")
        print(f"TEST DB: Tabuľka meat_templates má {test_rows[0]['c']} riadkov.")
    except Exception as e:
        print(f"TEST DB CHYBA: {e}")
    print("!"*50 + "\n")
    # --- TESTOVACÍ BLOK END ---

    try: db_connector.execute_query("COMMIT", fetch='none')
    except: pass

    # Najjednoduchší možný dopyt bez filtrov
    q = "SELECT id, name, material_id FROM meat_templates"
    rows = db_connector.execute_query(q)
    return jsonify(rows or [])

def get_template_details(template_id: int):
    """
    Načíta detaily šablóny.
    """
    # Aj tu refreshneme pohľad na DB
    try:
        db_connector.execute_query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED", fetch='none')
        db_connector.execute_query("COMMIT", fetch='none')
    except Exception:
        pass

    # 1. Hlavička
    t_rows = db_connector.execute_query("SELECT * FROM meat_templates WHERE id=%s", (template_id,))
    if not t_rows:
        return {"error": "Šablóna neexistuje"}
    templ = t_rows[0]

    # 2. Položky + Ceny
    q_items = """
        SELECT 
            mti.product_id,
            p.code, 
            p.name as product_name,
            COALESCE(mpl.price_eur_kg, p.selling_price_eur_kg) as current_price
        FROM meat_template_items mti
        JOIN meat_products p ON p.id = mti.product_id
        LEFT JOIN meat_price_lock mpl 
               ON mpl.product_id = p.id AND mpl.material_id = %s
        WHERE mti.template_id = %s
        ORDER BY p.name
    """
    items = db_connector.execute_query(q_items, (templ['material_id'], template_id)) or []

    return jsonify({
        "template": templ,
        "items": items
    })

def save_template(data):
    """
    Vytvorí alebo aktualizuje šablónu.
    """
    name = (data.get('name') or '').strip()
    material_id = data.get('material_id')
    product_ids = data.get('product_ids') or []

    if not name or not material_id:
        return {"error": "Chýba názov alebo surovina."}

    # UPDATE alebo INSERT hlavičky
    if data.get('id'):
        tmpl_id = int(data['id'])
        db_connector.execute_query(
            "UPDATE meat_templates SET name=%s, material_id=%s, is_active=1 WHERE id=%s",
            (name, int(material_id), tmpl_id), fetch='none'
        )
        # Premažeme staré položky
        db_connector.execute_query("DELETE FROM meat_template_items WHERE template_id=%s", (tmpl_id,), fetch='none')
    else:
        tmpl_id = db_connector.execute_query(
            "INSERT INTO meat_templates (name, material_id, is_active) VALUES (%s, %s, 1)",
            (name, int(material_id)), fetch='lastrowid'
        )

    # Vloženie položiek
    if product_ids:
        for pid in product_ids:
            db_connector.execute_query(
                "INSERT INTO meat_template_items (template_id, product_id) VALUES (%s, %s)",
                (tmpl_id, int(pid)), fetch='none'
            )
    
    # CRITICAL: Explicitný commit po zápise
    try:
        db_connector.execute_query("COMMIT", fetch='none')
    except Exception:
        pass

    return {"message": "Šablóna uložená."}

def delete_template(data):
    """Soft delete šablóny."""
    tid = data.get('id')
    if tid:
        db_connector.execute_query("UPDATE meat_templates SET is_active=0 WHERE id=%s", (int(tid),), fetch='none')
        try: db_connector.execute_query("COMMIT", fetch='none')
        except: pass
    return {"message": "Šablóna zmazaná."}

# ---------- PRICE LOCKS (zamknuté ceny po prvom zázname) ----------
def _ensure_price_locks(material_id:int, outputs:List[Dict[str,Any]]):
    """Zamkne ceny produktov použitých v rozrábke (ak lock neexistuje) na aktuálne predajné ceny."""
    pids = [int(o['product_id']) for o in outputs if o.get('product_id')]
    if not pids: return
    placeholders = ",".join(["%s"]*len(pids))
    locked = db_connector.execute_query(
        f"SELECT product_id FROM meat_price_lock WHERE material_id=%s AND product_id IN ({placeholders})",
        tuple([material_id] + pids)
    ) or []
    exists = {int(r['product_id']) for r in locked}
    to_lock = [pid for pid in pids if pid not in exists]
    if not to_lock: return
    placeholders = ",".join(["%s"]*len(to_lock))
    rows = db_connector.execute_query(
        f"SELECT id, selling_price_eur_kg FROM meat_products WHERE id IN ({placeholders})",
        tuple(to_lock)
    ) or []
    for r in rows:
        db_connector.execute_query(
            "INSERT INTO meat_price_lock (material_id, product_id, price_eur_kg) VALUES (%s,%s,%s)",
            (material_id, int(r['id']), float(r['selling_price_eur_kg'])),
            fetch='none'
        )

def list_locked_prices(material_id:int):
    rows = db_connector.execute_query("""
        SELECT p.id AS product_id, p.code, p.name,
               COALESCE(mpl.price_eur_kg, p.selling_price_eur_kg) AS price_eur_kg,
               CASE WHEN mpl.product_id IS NULL THEN 0 ELSE 1 END AS is_locked
        FROM meat_products p
        LEFT JOIN meat_price_lock mpl 
               ON mpl.product_id=p.id AND mpl.material_id=%s
        WHERE p.is_active=1
        ORDER BY p.name
    """,(int(material_id),)) or []
    return jsonify(rows)

def set_locked_price(material_id:int, product_id:int, price_eur_kg:float):
    ex = db_connector.execute_query(
        "SELECT 1 FROM meat_price_lock WHERE material_id=%s AND product_id=%s",
        (int(material_id), int(product_id))
    )
    if ex:
        db_connector.execute_query(
            "UPDATE meat_price_lock SET price_eur_kg=%s, locked_at=NOW() WHERE material_id=%s AND product_id=%s",
            (float(price_eur_kg), int(material_id), int(product_id)), fetch='none'
        )
    else:
        db_connector.execute_query(
            "INSERT INTO meat_price_lock (material_id,product_id,price_eur_kg) VALUES (%s,%s,%s)",
            (int(material_id), int(product_id), float(price_eur_kg)), fetch='none'
        )
    return {"message":"Cena aktualizovaná."}

# ---------- ULOŽENIE REÁLNEJ ROZRÁBKY -----------------------------
def save_breakdown(data):
    """
    Uloženie reálnej rozrábky.
    """
    header = data.get('header') or {}
    outputs = data.get('outputs') or []
    extras  = data.get('extras') or []

    # --- dátum ---
    bdate_raw = (header.get('breakdown_date') or '').strip()
    bdate = None
    if not bdate_raw:
        return {"error": "Chýba dátum rozrábky."}
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y"):
        try:
            bdate = datetime.strptime(bdate_raw, fmt).date()
            break
        except ValueError:
            continue
    if not bdate:
        try:
            bdate = datetime.fromisoformat(bdate_raw).date()
        except Exception:
            return {"error": f"Nesprávny formát dátumu: {bdate_raw!r}"}

    material_id = header.get('material_id')
    input_w     = _to_decimal(header.get('input_weight_kg'), 3)
    if not material_id or input_w is None or input_w <= 0:
        return {"error": "Chýba material_id alebo vstupná váha (kg)."}

    # dodávateľ / šarža / ľudia / čas
    supplier_id = header.get('supplier_id')
    supplier_id = int(supplier_id) if supplier_id else None
    supplier_name = (header.get('supplier') or '').strip() or None
    supplier_batch_code = (header.get('supplier_batch_code') or '').strip() or None

    units_count   = int(header.get('units_count') or 0) or None
    workers_count = int(header.get('workers_count') or 0) or None
    duration_min  = int(header.get('duration_minutes') or 0) or None
    note          = (header.get('note') or '').strip() or None
    tolerance     = _to_decimal(header.get('tolerance_pct'), 3) or 0.0

    total_cost = _to_decimal(header.get('purchase_total_cost_eur'), 2)
    unit_price = _to_decimal(header.get('purchase_unit_price_eur_kg'), 4)

    if total_cost is None and unit_price is None:
        return {"error": "Zadaj buď celkovú nákupnú cenu alebo nákupnú cenu za kg."}

    if total_cost is not None and unit_price is not None:
        total_cost = round(input_w * unit_price, 2)
    if total_cost is None:
        total_cost = round(input_w * unit_price, 2)
    if unit_price is None:
        unit_price = round(total_cost / input_w, 4)

    # --- výstupy ---
    if not outputs:
        return {"error": "Musíš pridať aspoň jeden výstup (produkt)."}

    sum_out = 0.0
    clean_outputs: list[dict[str, Any]] = []
    for o in outputs:
        w = _to_decimal(o.get('weight_kg'), 3)
        pid = o.get('product_id')
        if not pid or w is None or w < 0:
            return {"error": "Neplatný výstup (product_id/weight_kg)."}
        sum_out += w
        clean_outputs.append({"product_id": int(pid), "weight_kg": w})

    diff = abs(sum_out - input_w)
    if input_w > 0 and (diff / input_w) * 100 > tolerance:
        return {
            "error": (
                f"Súčet výstupov ({sum_out} kg) nespĺňa toleranciu "
                f"voči vstupu ({input_w} kg). Rozdiel {diff:.3f} kg."
            )
        }

    # --- extras ---
    clean_extras: list[dict[str, Any]] = []
    for e in extras:
        name = (e.get('name') or '').strip()
        amt  = _to_decimal(e.get('amount_eur'), 2)
        if name and amt is not None:
            clean_extras.append({"name": name, "amount_eur": amt})

    # --- INSERT / UPDATE hlavičky ---
    breakdown_id = header.get('id')
    if breakdown_id:
        breakdown_id = int(breakdown_id)
        qh = """
            UPDATE meat_breakdown
            SET breakdown_date=%s,
                material_id=%s,
                supplier=%s,
                supplier_id=%s,
                supplier_batch_code=%s,
                note=%s,
                units_count=%s,
                workers_count=%s,
                duration_minutes=%s,
                input_weight_kg=%s,
                purchase_unit_price_eur_kg=%s,
                purchase_total_cost_eur=%s,
                tolerance_pct=%s
            WHERE id=%s
        """
        db_connector.execute_query(
            qh,
            (bdate, int(material_id),
             supplier_name, supplier_id, supplier_batch_code,
             note, units_count, workers_count, duration_min,
             input_w, unit_price, total_cost, tolerance,
             breakdown_id),
            fetch='none'
        )
        # zmažeme detaily
        db_connector.execute_query("DELETE FROM meat_breakdown_output WHERE breakdown_id=%s", (breakdown_id,), fetch='none')
        db_connector.execute_query("DELETE FROM meat_breakdown_extra_costs WHERE breakdown_id=%s", (breakdown_id,), fetch='none')
        db_connector.execute_query("DELETE FROM meat_breakdown_result WHERE breakdown_id=%s", (breakdown_id,), fetch='none')
        msg = "Rozrábka aktualizovaná."
    else:
        qh = """
            INSERT INTO meat_breakdown
                (breakdown_date, material_id,
                 supplier, supplier_id, supplier_batch_code,
                 note, units_count, workers_count, duration_minutes,
                 input_weight_kg, purchase_unit_price_eur_kg, purchase_total_cost_eur, tolerance_pct)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """
        breakdown_id = db_connector.execute_query(
            qh,
            (bdate, int(material_id),
             supplier_name, supplier_id, supplier_batch_code,
             note, units_count, workers_count, duration_min,
             input_w, unit_price, total_cost, tolerance),
            fetch='lastrowid'
        )
        msg = "Rozrábka uložená."

    # výstupy
    for o in clean_outputs:
        q = "INSERT INTO meat_breakdown_output (breakdown_id, product_id, weight_kg) VALUES (%s,%s,%s)"
        db_connector.execute_query(q, (breakdown_id, o["product_id"], o["weight_kg"]), fetch='none')

    # extra náklady
    for e in clean_extras:
        q = "INSERT INTO meat_breakdown_extra_costs (breakdown_id, name, amount_eur) VALUES (%s,%s,%s)"
        db_connector.execute_query(q, (breakdown_id, e["name"], e["amount_eur"]), fetch='none')

    # auto-lock cien + prepočet výsledkov
    _ensure_price_locks(int(material_id), clean_outputs)
    compute_breakdown_results(breakdown_id)

    return {"message": msg, "breakdown_id": breakdown_id}

# ---------- VÝPOČET: výťažnosti + nákladové ceny ------------------
def _fetch_breakdown_full(breakdown_id:int) -> Tuple[Dict[str,Any], List[Dict[str,Any]], List[Dict[str,Any]]]:
    b = db_connector.execute_query("SELECT * FROM meat_breakdown WHERE id=%s", (breakdown_id,)) or []
    if not b:
        raise ValueError("Neexistuje rozrábka.")
    header = b[0]
    outputs = db_connector.execute_query("""
        SELECT mbo.*,
               COALESCE(mpl.price_eur_kg, mp.selling_price_eur_kg) AS selling_price_eur_kg,
               mp.name AS product_name
        FROM meat_breakdown_output mbo
        JOIN meat_products mp ON mp.id=mbo.product_id
        LEFT JOIN meat_price_lock mpl 
               ON mpl.product_id=mbo.product_id AND mpl.material_id=%s
        WHERE mbo.breakdown_id=%s
        ORDER BY mp.name
    """,(header['material_id'], breakdown_id)) or []
    extras = db_connector.execute_query("SELECT * FROM meat_breakdown_extra_costs WHERE breakdown_id=%s", (breakdown_id,)) or []
    return header, outputs, extras

def compute_breakdown_results(breakdown_id:int):
    b, outputs, extras = _fetch_breakdown_full(breakdown_id)
    input_w = float(b['input_weight_kg'])
    purchase_total = float(b['purchase_total_cost_eur'] or 0.0)
    extras_total = sum(float(x['amount_eur']) for x in extras)
    joint_cost = round(purchase_total + extras_total, 2)

    sv_sum = 0.0  # ∑(váha × predajná/lock cena)
    for o in outputs:
        sv_sum += float(o['weight_kg']) * float(o['selling_price_eur_kg'])
    if sv_sum <= 0:
        raise ValueError("Nie je možné alokovať – trhová hodnota je nulová (skontroluj predajné/zamknuté ceny).")

    db_connector.execute_query("DELETE FROM meat_breakdown_result WHERE breakdown_id=%s", (breakdown_id,), fetch='none')

    for o in outputs:
        w = float(o['weight_kg'])
        sp = float(o['selling_price_eur_kg'])
        share = (w*sp) / sv_sum
        alloc = round(joint_cost * share, 2)
        cpk = round(alloc / w, 4) if w > 0 else 0.0
        yld = round((w / input_w)*100.0, 4)
        margin = round(sp - cpk, 4)
        profit = round(margin * w, 2)

        ins = """INSERT INTO meat_breakdown_result
                 (breakdown_id, product_id, weight_kg, yield_pct, allocated_cost_eur, cost_per_kg_eur,
                  selling_price_eur_kg_snap, margin_eur_per_kg, profit_eur)
                 VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"""
        db_connector.execute_query(ins, (breakdown_id, int(o['product_id']), w, yld, alloc, cpk,
                                         sp, margin, profit), fetch='none')
    return {"message":"Prepočítané."}

def get_breakdown(breakdown_id:int):
    b, outputs, extras = _fetch_breakdown_full(breakdown_id)
    results = db_connector.execute_query("""
        SELECT r.*, p.name AS product_name
        FROM meat_breakdown_result r
        JOIN meat_products p ON p.id=r.product_id
        WHERE r.breakdown_id=%s
        ORDER BY p.name
    """,(breakdown_id,)) or []
    return jsonify({
        "header": b,
        "outputs": outputs,
        "extras": extras,
        "results": results
    })

def list_breakdowns(material_id=None, date_from=None, date_to=None, supplier=None):
    wh = []
    params = []
    if material_id:
        wh.append("b.material_id=%s")
        params.append(int(material_id))
    if date_from:
        wh.append("b.breakdown_date>=%s")
        params.append(date_from)
    if date_to:
        wh.append("b.breakdown_date<=%s")
        params.append(date_to)
    if supplier:
        wh.append("b.supplier=%s")
        params.append(supplier)
    where = (" WHERE " + " AND ".join(wh)) if wh else ""
    rows = db_connector.execute_query(f"""
        SELECT b.*, m.name AS material_name
        FROM meat_breakdown b
        JOIN meat_materials m ON m.id=b.material_id
        {where}
        ORDER BY b.breakdown_date DESC, b.id DESC
    """, tuple(params)) or []
    return jsonify(rows)

# ---------- ODHAD – priemerné výťažnosti --------------------------
def _avg_yields(material_id:int, supplier:Optional[str]=None, date_from=None, date_to=None) -> Dict[int,float]:
    """Vážené priemerné výťažnosti z histórie pre danú surovinu (+ voliteľné filtre)."""
    wh = ["b.material_id=%s"]; params=[int(material_id)]
    if supplier:
        wh.append("b.supplier=%s"); params.append(supplier)
    if date_from:
        wh.append("b.breakdown_date >= %s"); params.append(date_from)
    if date_to:
        wh.append("b.breakdown_date <= %s"); params.append(date_to)
    where = " WHERE " + " AND ".join(wh)

    tot = db_connector.execute_query(f"SELECT SUM(b.input_weight_kg) AS w FROM meat_breakdown b {where}", tuple(params)) or []
    total_input = float(tot[0]['w'] or 0.0)
    if total_input <= 0:
        return {}

    rows = db_connector.execute_query(f"""
        SELECT mbo.product_id, SUM(mbo.weight_kg) AS w
        FROM meat_breakdown b
        JOIN meat_breakdown_output mbo ON mbo.breakdown_id=b.id
        {where}
        GROUP BY mbo.product_id
    """, tuple(params)) or []

    res={}
    for r in rows:
        res[int(r['product_id'])] = float(r['w']) / total_input
    return res  # pomer 0..1

def _get_product_id_by_code(code: str) -> Optional[int]:
    row = db_connector.execute_query("SELECT id FROM meat_products WHERE code=%s LIMIT 1", (code,), fetch='one')
    return int(row['id']) if row and row.get('id') is not None else None

def _avg_tolerance_pct(material_id:int, supplier:Optional[str]=None, date_from=None, date_to=None) -> float:
    """
    Vypočíta vážený priemer tolerance_pct (v %) podľa vstupnej váhy:
      avg_tol = SUM(input_weight * tolerance_pct) / SUM(input_weight)
    Null tolerancie sa ignorujú (berie sa 0).
    """
    wh = ["b.material_id=%s"]; params=[int(material_id)]
    if supplier:
        wh.append("b.supplier=%s"); params.append(supplier)
    if date_from:
        wh.append("b.breakdown_date >= %s"); params.append(date_from)
    if date_to:
        wh.append("b.breakdown_date <= %s"); params.append(date_to)
    where = " WHERE " + " AND ".join(wh)

    row = db_connector.execute_query(f"""
        SELECT 
          SUM(b.input_weight_kg * COALESCE(b.tolerance_pct,0)) / NULLIF(SUM(b.input_weight_kg),0) AS avg_tol
        FROM meat_breakdown b
        {where}
    """, tuple(params), fetch='one') or {}

    avg_tol = float(row.get('avg_tol') or 0.0)
    # ohranič, keby niekde bola extrémna hodnota
    if avg_tol < 0: avg_tol = 0.0
    if avg_tol > 100: avg_tol = 100.0
    return round(avg_tol, 4)

def _get_product_id_by_code(code: str) -> Optional[int]:
    row = db_connector.execute_query("SELECT id FROM meat_products WHERE code=%s LIMIT 1", (code,), fetch='one')
    return int(row['id']) if row and row.get('id') is not None else None

def _get_product_codes(ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    placeholders = ",".join(["%s"]*len(ids))
    rows = db_connector.execute_query(
        f"SELECT id, code FROM meat_products WHERE id IN ({placeholders})",
        tuple(ids), fetch='all'
    ) or []
    return { int(r["id"]): (r["code"] or "").strip().upper() for r in rows }
def supplier_product_stats(params: dict):
    """
    Agregovaný report:
      - podľa dodávateľa a produktu
      - za zvolené obdobie

    params = {
      date_from?: 'YYYY-MM-DD',
      date_to?:   'YYYY-MM-DD',
      supplier_id?: int
    }

    Výstup:
      [
        {
          supplier_name,
          product_id, product_name,
          total_input_kg,
          total_output_kg,
          avg_yield_pct,
          total_profit_eur,
          profit_per_kg,
          total_duration_min,
          total_workers_minutes,
          efficiency_kg_per_person_hour
        }, ...
      ]
    """

    date_from = params.get('date_from')
    date_to   = params.get('date_to')
    supplier_id = params.get('supplier_id')

    where = ["1=1"]
    args: list[Any] = []

    if date_from:
        where.append("b.breakdown_date >= %s")
        args.append(date_from)
    if date_to:
        where.append("b.breakdown_date <= %s")
        args.append(date_to)
    if supplier_id:
        where.append("b.supplier_id = %s")
        args.append(int(supplier_id))

    where_sql = " AND ".join(where)

    q = f"""
        SELECT
          COALESCE(s.name, b.supplier) AS supplier_name,
          r.product_id,
          p.name AS product_name,
          SUM(b.input_weight_kg)         AS total_input_kg,
          SUM(r.weight_kg)               AS total_output_kg,
          AVG(r.yield_pct)               AS avg_yield_pct,
          SUM(r.profit_eur)              AS total_profit_eur,
          SUM(b.duration_minutes)        AS total_duration_min,
          SUM(COALESCE(b.workers_count,0) * COALESCE(b.duration_minutes,0)) AS total_workers_min
        FROM meat_breakdown_result r
        JOIN meat_breakdown b ON b.id = r.breakdown_id
        LEFT JOIN meat_products p ON p.id = r.product_id
        LEFT JOIN meat_suppliers s ON s.id = b.supplier_id
        WHERE {where_sql}
        GROUP BY supplier_name, r.product_id, p.name
        ORDER BY supplier_name ASC, avg_yield_pct DESC
    """

    rows = db_connector.execute_query(q, tuple(args)) or []
    # dopočítame odvodené KPI v Pythone (aby to bolo prehľadné)
    for row in rows:
        out_kg = row['total_output_kg'] or 0
        profit = row['total_profit_eur'] or 0
        workers_min = row['total_workers_min'] or 0
        duration_min = row['total_duration_min'] or 0

        row['profit_per_kg'] = round(profit / out_kg, 4) if out_kg else None
        # produktivita: kg / osoba / hodinu
        if workers_min > 0:
            row['efficiency_kg_per_person_hour'] = round(out_kg / (workers_min / 60.0), 3)
        else:
            row['efficiency_kg_per_person_hour'] = None
        row['total_duration_min'] = duration_min

    return jsonify(rows)

def estimate(material_id:int, planned_weight_kg:float, expected_purchase_unit_price:float,
             supplier:Optional[str]=None, date_from=None, date_to=None, extra_costs:list|None=None):
    # 1) Priemerné výťažnosti z histórie
    yields = _avg_yields(material_id, supplier, date_from, date_to)  # {product_id: fraction 0..1}
    if not yields:
        return {"error":"Nie sú dostupné historické dáta pre zvolený filter (materiál/dodávateľ/dátumy)."}

    # 2) Vylúč STRATA z odhadu a renormalizuj na 100 %
    pid_list = list(yields.keys())
    codes = _get_product_codes(pid_list)
    for pid in list(yields.keys()):
        if codes.get(pid) == "STRATA":
            yields.pop(pid, None)
    if not yields:
        return {"error":"Historické dáta po odfiltrovaní položky STRATA neobsahujú žiadne predajné diely."}

    s = float(sum(yields.values()))
    if s <= 0:
        return {"error":"Výťažnosti po odfiltrovaní sú nulové. Skontroluj historické záznamy."}
    for k in list(yields.keys()):
        yields[k] = float(yields[k]) / s  # teraz ∑yields = 1.0

    # 3) Priemerná Tolerancia straty (%) – vážená vstupom
    avg_tol_pct = _avg_tolerance_pct(material_id, supplier, date_from, date_to)  # napr. 3.25
    tol_factor = max(0.0, 1.0 - (avg_tol_pct / 100.0))

    # Efektívna výstupná váha (plán – strata)
    effective_output_weight = planned_weight_kg * tol_factor

    # 4) Ceny – preferuj lock pre materiál, inak predajné
    locks = db_connector.execute_query(
        "SELECT product_id, price_eur_kg FROM meat_price_lock WHERE material_id=%s",
        (int(material_id),)
    ) or []
    lock_map = { int(r['product_id']): float(r['price_eur_kg']) for r in locks }
    all_prices = db_connector.execute_query("SELECT id, selling_price_eur_kg FROM meat_products WHERE is_active=1") or []
    prices = { int(r['id']): (lock_map.get(int(r['id'])) if int(r['id']) in lock_map else float(r['selling_price_eur_kg']))
               for r in all_prices }

    # 5) Odhad váh – ∑w == effective_output_weight
    est_rows=[]
    for pid, y in yields.items():
        w = effective_output_weight * float(y)
        sp = prices.get(pid, 0.0)
        est_rows.append({"product_id":pid, "weight_kg":w, "selling_price":sp})

    # 6) Spoločný náklad: celý nákup (plán) + extra
    joint_cost = round(
        planned_weight_kg * expected_purchase_unit_price
        + sum(float(x.get('amount_eur') or 0) for x in (extra_costs or [])),
        2
    )

    # 7) Alokácia: podľa hodnoty; pri nulovej hodnote → váhová
    sv_sum = sum(r['weight_kg'] * r['selling_price'] for r in est_rows)
    use_weight_based = sv_sum <= 0.0
    total_w = sum(r['weight_kg'] for r in est_rows) if use_weight_based else 1.0

    results=[]
    for r in est_rows:
        share = (r['weight_kg']/total_w) if use_weight_based else ((r['weight_kg']*r['selling_price'])/sv_sum)
        alloc = round(joint_cost * share, 2)
        cpk   = round(alloc / r['weight_kg'], 4) if r['weight_kg']>0 else 0.0
        margin= round(r['selling_price'] - cpk, 4)
        profit= round(margin * r['weight_kg'], 2)
        results.append({
            "product_id":r['product_id'],
            "weight_kg":round(r['weight_kg'],3),
            "yield_pct": round((r['weight_kg']/planned_weight_kg)*100.0, 4),  # voči plánu
            "cost_alloc_eur":alloc,
            "cost_per_kg_eur":cpk,
            "selling_price_eur_kg":r['selling_price'],
            "margin_eur_per_kg":margin,
            "profit_eur":profit
        })

    return {
        "planned_weight_kg": planned_weight_kg,
        "avg_tolerance_pct": avg_tol_pct,
        "effective_output_weight_kg": round(effective_output_weight, 3),
        "joint_cost_eur": joint_cost,
        "sum_estimated_weight_kg": round(sum(r["weight_kg"] for r in results), 3),
        "rows": results
    }


# ---------- PROFITABILITY REPORT (existujúci breakdown) -----------
def profitability(breakdown_id:int):
    rows = db_connector.execute_query("""
        SELECT r.*, p.name AS product_name
        FROM meat_breakdown_result r
        JOIN meat_products p ON p.id=r.product_id
        WHERE r.breakdown_id=%s ORDER BY p.name
    """,(breakdown_id,)) or []
    tot_profit = sum(float(r['profit_eur']) for r in rows)
    tot_alloc  = sum(float(r['allocated_cost_eur']) for r in rows)
    return jsonify({"rows":rows, "total_profit_eur": round(tot_profit,2), "total_allocated_cost_eur": round(tot_alloc,2)})

# ---------- EXPORT: Excel (XLSX) ----------------------------------
def export_breakdown_excel(breakdown_id:int):
    import xlsxwriter
    b, _, _ = _fetch_breakdown_full(breakdown_id)
    rows = db_connector.execute_query("""
        SELECT p.code, p.name, r.weight_kg, r.yield_pct, r.cost_per_kg_eur, r.selling_price_eur_kg_snap, r.margin_eur_per_kg, r.profit_eur
        FROM meat_breakdown_result r
        JOIN meat_products p ON p.id=r.product_id
        WHERE r.breakdown_id=%s ORDER BY p.name
    """, (breakdown_id,)) or []

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {'in_memory': True})
    ws = wb.add_worksheet("Rozrábka")

    headers = ["Kód","Produkt","Váha (kg)","Výťažnosť (%)","Náklad €/kg","Predaj €/kg","Marža €/kg","Zisk (€)"]
    for c,h in enumerate(headers): ws.write(0,c,h)
    for r,row in enumerate(rows, start=1):
        ws.write(r,0,row['code']); ws.write(r,1,row['name'])
        ws.write_number(r,2,float(row['weight_kg']))
        ws.write_number(r,3,float(row['yield_pct']))
        ws.write_number(r,4,float(row['cost_per_kg_eur']))
        ws.write_number(r,5,float(row['selling_price_eur_kg_snap']))
        ws.write_number(r,6,float(row['margin_eur_per_kg']))
        ws.write_number(r,7,float(row['profit_eur']))
    wb.close()
    output.seek(0)
    filename = f"rozrabka_{b['id']}_{b['breakdown_date']}.xlsx"
    return send_file(output, as_attachment=True, download_name=filename,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

# =================================================================
# ==================== HTML REPORTS ===============================
# =================================================================
def report_breakdown_html(breakdown_id:int):
    b, outputs, extras = _fetch_breakdown_full(breakdown_id)
    results = db_connector.execute_query("""
        SELECT r.*, p.name AS product_name, p.code AS product_code
        FROM meat_breakdown_result r
        JOIN meat_products p ON p.id=r.product_id
        WHERE r.breakdown_id=%s
        ORDER BY p.name
    """,(breakdown_id,)) or []
    return make_response(render_template("meat_breakdown_report.html",
                                         header=b, outputs=outputs, extras=extras, results=results))