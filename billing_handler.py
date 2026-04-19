from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
import db_connector

billing_bp = Blueprint("billing", __name__)

def generate_dl_number():
    """Vygeneruje číslo DL vo formáte 0000126 (5 miest poradie + 2 miesta rok)"""
    rok_short = str(datetime.now().year)[-2:]
    sql = """
        SELECT cislo_dokladu FROM doklady_hlavicka 
        WHERE typ_dokladu = 'DL' AND cislo_dokladu LIKE %s 
        ORDER BY id DESC LIMIT 1
    """
    row = db_connector.execute_query(sql, (f"%{rok_short}",), fetch="one")
    if row and row['cislo_dokladu'] and len(row['cislo_dokladu']) >= 7:
        try:
            posledne = int(row['cislo_dokladu'][:-2])
            nove = posledne + 1
        except:
            nove = 1
    else:
        nove = 1
    return f"{nove:05d}{rok_short}"

def generate_doc_number(typ_dokladu):
    """Vygeneruje klasické číslo pre Faktúru (FA-2026-0001)"""
    rok = datetime.now().year
    prefix = f"{typ_dokladu}-{rok}-"
    sql = "SELECT cislo_dokladu FROM doklady_hlavicka WHERE typ_dokladu = %s AND cislo_dokladu LIKE %s ORDER BY id DESC LIMIT 1"
    row = db_connector.execute_query(sql, (typ_dokladu, f"{prefix}%"), fetch="one")
    if row and row['cislo_dokladu']:
        posledne_cislo = int(row['cislo_dokladu'].split('-')[-1])
        nove_cislo = posledne_cislo + 1
    else:
        nove_cislo = 1
    return f"{prefix}{nove_cislo:04d}"

# --- 1. ZÍSKANIE NÁVRHOV (ČAKAJÚCE NA DL) ---
@billing_bp.get("/api/billing/ready_for_invoice")
def get_ready_for_invoice():
    try:
        sql_orders = """
            SELECT id as obj_id, cislo_objednavky, pozadovany_datum_dodania, 
                   COALESCE(finalna_suma, celkova_suma_s_dph, 0) as suma,
                   zakaznik_id, nazov_firmy
            FROM b2b_objednavky
            WHERE stav = 'Hotová' AND dodaci_list_id IS NULL
        """
        orders = db_connector.execute_query(sql_orders, fetch="all") or []
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    sql_customers = """
        SELECT z.id, z.zakaznik_id as erp_code, z.nazov_firmy, z.typ_fakturacie, 
               COALESCE(t.nazov, 'Nepriradená trasa') as trasa
        FROM b2b_zakaznici z LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
    """
    customers_db = db_connector.execute_query(sql_customers, fetch="all") or []
    cust_map = {str(c['erp_code']).strip(): c for c in customers_db if c.get('erp_code')}
    trasy_map = {}
    
    for o in orders:
        cislo = str(o.get('cislo_objednavky') or '')
        vyextrahovany_kod = cislo.split('-')[1].strip() if len(cislo.split('-')) >= 2 else None
        found_cust = cust_map.get(vyextrahovany_kod) or cust_map.get(str(o.get('zakaznik_id')).strip())
        
        if found_cust:
            z_id, z_meno, trasa, typ_fa = str(found_cust['erp_code']), found_cust['nazov_firmy'], found_cust['trasa'], found_cust.get('typ_fakturacie') or 'Zberná'
        else:
            z_id, z_meno, trasa, typ_fa = str(vyextrahovany_kod or o.get('zakaznik_id') or 'Neznáme'), o.get('nazov_firmy') or f"Nespárovaný ({z_id})", 'Nepriradená trasa', 'Zberná'

        if trasa not in trasy_map: trasy_map[trasa] = {}
        if z_id not in trasy_map[trasa]: trasy_map[trasa][z_id] = {"zakaznik_id": z_id, "nazov_firmy": z_meno, "typ_fakturacie": typ_fa, "objednavky": []}
        trasy_map[trasa][z_id]["objednavky"].append({"id": o['obj_id'], "cislo": cislo, "datum": o['pozadovany_datum_dodania'], "suma": float(o['suma'])})

    vystup = [{"trasa": k, "zakaznici": list(v.values())} for k, v in trasy_map.items()]
    vystup.sort(key=lambda x: x['trasa'])
    for t in vystup: t['zakaznici'].sort(key=lambda c: c['nazov_firmy'])
    return jsonify({"trasy": vystup})


# --- 2. ZÍSKANIE NEVYFAKTUROVANÝCH DL (FÁZA 2) ---
@billing_bp.get("/api/billing/uninvoiced_dls")
def get_uninvoiced_dls():
    sql = """
        SELECT o.id as obj_id, o.cislo_objednavky, o.zakaznik_id, o.nazov_firmy,
               COALESCE(o.finalna_suma, o.celkova_suma_s_dph, 0) as suma,
               dh.id as dl_id, dh.cislo_dokladu, dh.datum_vystavenia,
               COALESCE(t.nazov, 'Nepriradená trasa') as trasa
        FROM b2b_objednavky o
        JOIN doklady_hlavicka dh ON o.dodaci_list_id = dh.id
        LEFT JOIN b2b_zakaznici z ON CAST(o.zakaznik_id AS CHAR) = CAST(z.zakaznik_id AS CHAR)
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.dodaci_list_id IS NOT NULL AND (o.faktura_id IS NULL OR o.faktura_id = 0)
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    z_map = {}
    for r in rows:
        zid = str(r['zakaznik_id'])
        if zid not in z_map:
            z_map[zid] = {
                "zakaznik_id": zid,
                "nazov_firmy": r['nazov_firmy'],
                "trasa": r['trasa'],
                "dodacie_listy": {}
            }
        dl_id = r['dl_id']
        if dl_id not in z_map[zid]["dodacie_listy"]:
            z_map[zid]["dodacie_listy"][dl_id] = {
                "dl_id": dl_id, "cislo_dl": r['cislo_dokladu'], "datum": r['datum_vystavenia'], "suma": 0, "obj_ids": []
            }
        z_map[zid]["dodacie_listy"][dl_id]["suma"] += float(r['suma'])
        z_map[zid]["dodacie_listy"][dl_id]["obj_ids"].append(r['obj_id'])

    # Preklopíme z dictionary na list pre Frontend
    for zid in z_map:
        z_map[zid]["dodacie_listy"] = list(z_map[zid]["dodacie_listy"].values())
    vystup = list(z_map.values())
    vystup.sort(key=lambda x: x['nazov_firmy'])
    
    return jsonify({"zakaznici": vystup})


# --- 3. VYSTAVENIE DOKLADOV (FÁZA 1) ---
@billing_bp.post("/api/billing/issue_documents")
def issue_documents():
    data = request.get_json(force=True) or {}
    order_ids = data.get("order_ids", [])
    create_fa = data.get("create_fa", False)
    
    if not order_ids: return jsonify({"error": "Neboli vybrané objednávky."}), 400

    placeholders = ','.join(['%s'] * len(order_ids))
    orders = db_connector.execute_query(f"SELECT * FROM b2b_objednavky WHERE id IN ({placeholders})", tuple(order_ids), fetch="all")
    if not orders: return jsonify({"error": "Objednávky nenájdené."}), 404

    zakaznik_id = orders[0]['zakaznik_id']
    zakaznik = db_connector.execute_query("SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s LIMIT 1", (zakaznik_id,), fetch="one") or {}

    total_bez_dph = sum(float(o.get('finalna_suma_bez_dph') or o.get('celkova_suma_bez_dph') or 0) for o in orders)
    total_s_dph = sum(float(o.get('finalna_suma') or o.get('celkova_suma_s_dph') or 0) for o in orders)
    total_dph = total_s_dph - total_bez_dph
    
    cislo_dl = generate_dl_number()
    datum = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        
        fa_id = None
        # Ak chceme aj FA, vytvoríme ju najprv
        if create_fa:
            cislo_fa = generate_doc_number('FA')
            cur.execute("""
                INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol)
                VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum + timedelta(days=splatnost_dni), total_bez_dph, total_dph, total_s_dph, cislo_fa.replace('FA-', '').replace('-', '')))
            fa_id = cur.lastrowid

        # Vytvorenie DL
        cur.execute("""
            INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, nadradena_faktura_id)
            VALUES ('DL', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (cislo_dl, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum, total_bez_dph, total_dph, total_s_dph, fa_id))
        dl_id = cur.lastrowid

        # Aktualizácia objednávok
        cur.execute(f"UPDATE b2b_objednavky SET dodaci_list_id = %s, faktura_id = %s WHERE id IN ({placeholders})", (dl_id, fa_id, *order_ids))

        # Zapísanie položiek a ODPIS ZO SKLADU
        typ_pohybu = 'VYDAJ_FAKTURA' if create_fa else 'VYDAJ_DL'
        
        for o in orders:
            cur.execute("SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (o['id'],))
            for p in cur.fetchall():
                mnozstvo = float(p.get('dodane_mnozstvo') or p.get('mnozstvo') or 0)
                if mnozstvo <= 0: continue
                cena = float(p.get('cena_skutocna') or p.get('cena_bez_dph') or 0)
                dph = float(p.get('dph') or 20.0)
                
                # Uložíme do dokladov
                cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                            (dl_id, o['id'], p['ean_produktu'], p['nazov_vyrobku'], mnozstvo, p['mj'], cena, dph))
                if fa_id:
                    cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                                (fa_id, o['id'], p['ean_produktu'], p['nazov_vyrobku'], mnozstvo, p['mj'], cena, dph))
                
                # Fyzický odpis zo skladu!
                cur.execute("INSERT INTO skladove_pohyby (ean, nazov_vyrobku, typ_pohybu, mnozstvo, mj, doklad_id, predajna_cena_bez_dph) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                            (p['ean_produktu'], p['nazov_vyrobku'], typ_pohybu, -mnozstvo, p['mj'], fa_id or dl_id, cena))
                cur.execute("UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s", (mnozstvo, p['ean_produktu']))

        conn.commit()
        sprava = f"Doklady úspešne vystavené: DL č. {cislo_dl}" + (f" a FA č. {cislo_fa}" if create_fa else "")
        return jsonify({"message": sprava})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn: cur.close(); conn.close()


# --- 4. ZBERNÁ FAKTÚRA (FÁZA 2) ---
@billing_bp.post("/api/billing/create_collective_invoice")
def create_collective_invoice():
    data = request.get_json(force=True) or {}
    dl_ids = data.get("dl_ids", [])
    
    if not dl_ids: return jsonify({"error": "Neboli vybrané DL."}), 400

    placeholders = ','.join(['%s'] * len(dl_ids))
    dls = db_connector.execute_query(f"SELECT * FROM doklady_hlavicka WHERE id IN ({placeholders}) AND typ_dokladu='DL'", tuple(dl_ids), fetch="all")
    if not dls: return jsonify({"error": "DL nenájdené."}), 404
        
    zakaznik_id = dls[0]['zakaznik_id']
    zakaznik = db_connector.execute_query("SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s LIMIT 1", (zakaznik_id,), fetch="one") or {}

    total_bez_dph = sum(float(d['suma_bez_dph']) for d in dls)
    total_s_dph = sum(float(d['suma_s_dph']) for d in dls)
    total_dph = total_s_dph - total_bez_dph
    
    cislo_fa = generate_doc_number('FA')
    datum = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        
        # Vytvoríme Zbernú Faktúru
        cur.execute("""
            INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol)
            VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum + timedelta(days=splatnost_dni), total_bez_dph, total_dph, total_s_dph, cislo_fa.replace('FA-', '').replace('-', '')))
        fa_id = cur.lastrowid

        # Zviažeme staré DL s touto FA
        cur.execute(f"UPDATE doklady_hlavicka SET nadradena_faktura_id = %s WHERE id IN ({placeholders})", (fa_id, *dl_ids))
        cur.execute(f"UPDATE b2b_objednavky SET faktura_id = %s WHERE dodaci_list_id IN ({placeholders})", (fa_id, *dl_ids))

        # Prepíšeme položky z DL do FA (SKLAD SA UŽ NEODPISUJE!)
        cur.execute(f"SELECT * FROM doklady_polozky WHERE doklad_id IN ({placeholders})")
        for p in cur.fetchall():
            cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (fa_id, p['objednavka_id'], p['ean'], p['nazov_polozky'], p['mnozstvo'], p['mj'], p['cena_bez_dph'], p['dph_percento']))

        conn.commit()
        return jsonify({"message": f"Zberná faktúra {cislo_fa} bola úspešne vystavená."})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn: cur.close(); conn.close()

# Uloženie položiek
@billing_bp.route('/api/billing/update_order_items', methods=['POST'])
def update_order_items():
    data = request.json
    items = data.get('items', [])
    if not items: return jsonify({"status": "error", "message": "Žiadne dáta"}), 400
    conn = db_connector.get_connection()
    try:
        cursor = conn.cursor()
        update_data = [(item['mnozstvo'], item['cena_bez_dph'], item['id']) for item in items]
        cursor.executemany("UPDATE b2b_objednavky_polozky SET dodane_mnozstvo = %s, cena_skutocna = %s WHERE id = %s", update_data)
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        if conn: cursor.close(); conn.close()

@billing_bp.get("/api/billing/order_items/<int:order_id>")
def get_order_items_for_billing(order_id):
    items = db_connector.execute_query("SELECT id, ean_produktu as ean, nazov_vyrobku as name, COALESCE(dodane_mnozstvo, mnozstvo) as qty, mj, COALESCE(cena_skutocna, cena_bez_dph) as price, dph FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (order_id,), fetch="all") or []
    return jsonify({"items": items})