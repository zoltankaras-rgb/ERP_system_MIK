from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
import db_connector

billing_bp = Blueprint("billing", __name__)

def generate_doc_number(typ_dokladu):
    """Vygeneruje číslo dokladu, napr. FA-2026-0001 alebo DL-2026-0150"""
    rok = datetime.now().year
    prefix = f"{typ_dokladu}-{rok}-"
    
    sql = """
        SELECT cislo_dokladu FROM doklady_hlavicka 
        WHERE typ_dokladu = %s AND cislo_dokladu LIKE %s 
        ORDER BY id DESC LIMIT 1
    """
    row = db_connector.execute_query(sql, (typ_dokladu, f"{prefix}%"), fetch="one")
    
    if row and row['cislo_dokladu']:
        posledne_cislo = int(row['cislo_dokladu'].split('-')[-1])
        nove_cislo = posledne_cislo + 1
    else:
        nove_cislo = 1
        
    return f"{prefix}{nove_cislo:04d}"

# --- 1. ENDPOINT NA ZOBRAZENIE OBJEDNÁVOK ---
@billing_bp.get("/api/billing/ready_for_invoice")
def get_ready_for_invoice():
    """
    Vráti 'Hotové' objednávky z terminálu (Návrhy DL).
    Párovanie zákazníkov prebieha priamo parsovaním čísla objednávky (napr. B2B-12345-...).
    """
    # 1. Natiahneme IBA objednávky (žiadne SQL JOINY, aby nám databáza nič nezahodila)
    try:
        sql_orders = """
            SELECT id as obj_id, cislo_objednavky, pozadovany_datum_dodania, 
                   COALESCE(finalna_suma_s_dph, celkova_suma_s_dph, 0) as suma,
                   zakaznik_id, odberatel, nazov_firmy
            FROM b2b_objednavky
            WHERE stav = 'Hotová' AND (faktura_id IS NULL OR faktura_id = 0)
        """
        orders = db_connector.execute_query(sql_orders, fetch="all") or []
    except Exception as e:
        # Fallback pre istotu, ak by tabuľka chvíľkovo štrajkovala kvôli stĺpcu faktura_id
        print("Chyba dotazu na faktura_id:", e)
        sql_fallback = """
            SELECT id as obj_id, cislo_objednavky, pozadovany_datum_dodania, 
                   COALESCE(finalna_suma_s_dph, celkova_suma_s_dph, 0) as suma,
                   zakaznik_id, odberatel, nazov_firmy
            FROM b2b_objednavky
            WHERE stav = 'Hotová'
        """
        orders = db_connector.execute_query(sql_fallback, fetch="all") or []

    # 2. Natiahneme všetkých zákazníkov do pamäte
    sql_customers = """
        SELECT z.id, z.zakaznik_id as erp_id, z.nazov_firmy, z.typ_fakturacie, 
               COALESCE(t.nazov, 'Nepriradená trasa') as trasa
        FROM b2b_zakaznici z
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
    """
    customers_db = db_connector.execute_query(sql_customers, fetch="all") or []
    
    # Vytvoríme si vyhľadávací slovník pre rýchle párovanie v pamäti
    cust_map = {}
    for c in customers_db:
        if c.get('erp_id'): cust_map[str(c['erp_id']).strip()] = c
        if c.get('id'): cust_map[str(c['id']).strip()] = c

    trasy_map = {}
    
    # 3. TVOJ ALGORITMUS: Parsovanie a párovanie objednávok
    for o in orders:
        cislo = o.get('cislo_objednavky') or ''
        
        # Extrahujeme IDčko zo stringu (B2B-12345-2026...)
        vyextrahovane_id = None
        parts = cislo.split('-')
        if len(parts) >= 2 and parts[0] in ('B2B', 'B2C'):
            vyextrahovane_id = parts[1].strip()
            
        # Spárujeme so zákazníkom zo slovníka
        found_cust = None
        if vyextrahovane_id:
            found_cust = cust_map.get(vyextrahovane_id)
        if not found_cust and o.get('zakaznik_id'):
            found_cust = cust_map.get(str(o.get('zakaznik_id')).strip())
            
        # Priradíme dáta
        if found_cust:
            z_id = str(found_cust['erp_id'] or found_cust['id'])
            z_meno = found_cust['nazov_firmy']
            trasa = found_cust['trasa']
            typ_fa = found_cust.get('typ_fakturacie') or 'Jednotlivo'
        else:
            # Ak by predsa len zákazník neexistoval, aspoň ukážeme objednávku!
            z_id = str(vyextrahovane_id or o.get('zakaznik_id') or 'Neznáme')
            z_meno = o.get('odberatel') or o.get('nazov_firmy') or f"Nespárovaný ({z_id})"
            trasa = 'Nepriradená trasa'
            typ_fa = 'Jednotlivo'

        # 4. Zoskupenie pre Frontend (do podoby Návrhov DL roztriedených podľa trasy)
        if trasa not in trasy_map:
            trasy_map[trasa] = {}
            
        if z_id not in trasy_map[trasa]:
            trasy_map[trasa][z_id] = {
                "zakaznik_id": z_id,
                "nazov_firmy": z_meno,
                "typ_fakturacie": typ_fa,
                "objednavky": []
            }
            
        trasy_map[trasa][z_id]["objednavky"].append({
            "id": o['obj_id'],
            "cislo": cislo,
            "datum": o['pozadovany_datum_dodania'],
            "suma": float(o['suma'])
        })

    vystup = [{"trasa": k, "zakaznici": list(v.values())} for k, v in trasy_map.items()]
    
    # Zoradíme abecedne trasy a následne aj zákazníkov pre lepší prehľad
    vystup.sort(key=lambda x: x['trasa'])
    for t in vystup:
        t['zakaznici'].sort(key=lambda c: c['nazov_firmy'])

    return jsonify({"trasy": vystup})
# --- 2. ENDPOINT NA NAČÍTANIE POLOŽIEK ---
@billing_bp.get("/api/billing/order_items/<int:order_id>")
def get_order_items_for_billing(order_id):
    sql = """
        SELECT id, ean_produktu as ean, nazov_vyrobku as name, 
               COALESCE(dodane_mnozstvo, mnozstvo) as qty, 
               mj, COALESCE(cena_skutocna, cena_bez_dph) as price, dph
        FROM b2b_objednavky_polozky
        WHERE objednavka_id = %s
    """
    items = db_connector.execute_query(sql, (order_id,), fetch="all") or []
    return jsonify({"items": items})

# --- 3. ENDPOINT NA ULOŽENIE ZMIEN VÁH A CIEN ---
@billing_bp.route('/api/billing/update_order_items', methods=['POST'])
def update_order_items():
    data = request.json
    items = data.get('items', [])
    if not items:
        return jsonify({"status": "error", "message": "Žiadne dáta"}), 400

    conn = db_connector.get_connection()
    try:
        cursor = conn.cursor()
        update_query = """
            UPDATE b2b_objednavky_polozky 
            SET dodane_mnozstvo = %s, cena_skutocna = %s 
            WHERE id = %s
        """
        update_data = [(item['mnozstvo'], item['cena_bez_dph'], item['id']) for item in items]
        cursor.executemany(update_query, update_data)
        conn.commit()
        return jsonify({"status": "success", "message": "Položky upravené."})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        if conn:
            cursor.close()
            conn.close()

# --- 4. ENDPOINT NA VYSTAVENIE FAKTÚRY ---
@billing_bp.post("/api/billing/create_collective_invoice")
def create_collective_invoice():
    data = request.get_json(force=True) or {}
    order_ids = data.get("dl_ids", []) 
    
    if not order_ids:
        return jsonify({"error": "Neboli vybrané žiadne objednávky."}), 400

    placeholders = ','.join(['%s'] * len(order_ids))
    orders = db_connector.execute_query(
        f"SELECT * FROM b2b_objednavky WHERE id IN ({placeholders})", 
        tuple(order_ids), fetch="all"
    )
    
    if not orders:
        return jsonify({"error": "Objednávky sa nenašli."}), 404
        
    zakaznik_id = orders[0]['zakaznik_id']
    if any(o['zakaznik_id'] != zakaznik_id for o in orders):
        return jsonify({"error": "Zberná faktúra môže obsahovať len objednávky jedného zákazníka."}), 400

    zakaznik = db_connector.execute_query(
        "SELECT * FROM b2b_zakaznici WHERE id = %s OR zakaznik_id = %s LIMIT 1", 
        (zakaznik_id, zakaznik_id), fetch="one"
    ) or {}

    total_bez_dph = sum(float(o.get('finalna_suma_bez_dph') or o.get('celkova_suma_bez_dph') or 0) for o in orders)
    total_s_dph = sum(float(o.get('finalna_suma_s_dph') or o.get('celkova_suma_s_dph') or 0) for o in orders)
    total_dph = total_s_dph - total_bez_dph
    
    cislo_fa = generate_doc_number('FA')
    datum_vystavenia = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)
    datum_splatnosti = datum_vystavenia + timedelta(days=splatnost_dni)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            INSERT INTO doklady_hlavicka 
            (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, 
            odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol)
            VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), 
            zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum_vystavenia, datum_vystavenia, datum_splatnosti,
            total_bez_dph, total_dph, total_s_dph, cislo_fa.replace('FA-', '').replace('-', '') 
        ))
        fa_id = cur.lastrowid

        cur.execute(f"UPDATE b2b_objednavky SET faktura_id = %s WHERE id IN ({placeholders})", (fa_id, *order_ids))

        for o in orders:
            cur.execute("""
                INSERT INTO doklady_polozky 
                (doklad_id, objednavka_id, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (fa_id, o['id'], f"Dodávka tovaru (Obj. {o['cislo_objednavky']})", 1, 'ks', 0, 0, 0, 0))
            
            cur.execute("SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (o['id'],))
            for p in cur.fetchall():
                mnozstvo = float(p.get('dodane_mnozstvo') or p.get('mnozstvo') or 0)
                if mnozstvo <= 0: continue
                cena_bez_dph = float(p.get('cena_skutocna') or p.get('cena_bez_dph') or 0)
                dph_perc = float(p.get('dph') or 20.0)
                celkom_bez_dph = mnozstvo * cena_bez_dph
                celkom_s_dph = celkom_bez_dph * (1 + (dph_perc / 100))

                cur.execute("""
                    INSERT INTO doklady_polozky 
                    (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (fa_id, o['id'], p['ean_produktu'], p['nazov_vyrobku'], mnozstvo, p['mj'], cena_bez_dph, dph_perc, celkom_bez_dph, celkom_s_dph))
                
                cur.execute("""
                    INSERT INTO skladove_pohyby 
                    (ean, nazov_vyrobku, typ_pohybu, mnozstvo, mj, doklad_id, predajna_cena_bez_dph)
                    VALUES (%s, %s, 'VYDAJ_FAKTURA', %s, %s, %s, %s)
                """, (p['ean_produktu'], p['nazov_vyrobku'], -mnozstvo, p['mj'], fa_id, cena_bez_dph))

                cur.execute("UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s", (mnozstvo, p['ean_produktu']))

        conn.commit()
        return jsonify({"message": f"Zberná faktúra {cislo_fa} úspešne vystavená.", "faktura_id": fa_id})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn: cur.close(); conn.close()