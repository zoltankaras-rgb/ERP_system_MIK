from flask import Blueprint, request, jsonify, make_response
from datetime import datetime, timedelta
import db_connector
import traceback

billing_bp = Blueprint("billing", __name__)

def generate_dl_number():
    rok_short = str(datetime.now().year)[-2:]
    sql = "SELECT cislo_dokladu FROM doklady_hlavicka WHERE typ_dokladu = 'DL' AND cislo_dokladu LIKE %s ORDER BY id DESC LIMIT 1"
    row = db_connector.execute_query(sql, (f"%{rok_short}",), fetch="one")
    if row and row['cislo_dokladu'] and len(row['cislo_dokladu']) >= 7:
        try:
            posledne = int(row['cislo_dokladu'][:-2])
            nove = posledne + 1
        except: nove = 1
    else: nove = 1
    return f"{nove:05d}{rok_short}"

def generate_doc_number(typ_dokladu):
    rok = datetime.now().year
    prefix = f"{typ_dokladu}-{rok}-"
    sql = "SELECT cislo_dokladu FROM doklady_hlavicka WHERE typ_dokladu = %s AND cislo_dokladu LIKE %s ORDER BY id DESC LIMIT 1"
    row = db_connector.execute_query(sql, (typ_dokladu, f"{prefix}%"), fetch="one")
    if row and row['cislo_dokladu']:
        posledne_cislo = int(row['cislo_dokladu'].split('-')[-1])
        nove_cislo = posledne_cislo + 1
    else: nove_cislo = 1
    return f"{prefix}{nove_cislo:04d}"

# --- NASTAVENIA (Hlavička a Pätička) ---
@billing_bp.route("/api/billing/settings", methods=['GET', 'POST'])
def billing_settings():
    if request.method == 'GET':
        rows = db_connector.execute_query("SELECT kluc, hodnota FROM system_settings WHERE kluc IN ('invoice_supplier_info', 'dl_footer')", fetch="all") or []
        return jsonify({r['kluc']: r['hodnota'] for r in rows})
    
    if request.method == 'POST':
        data = request.json or {}
        for k, v in data.items():
            if k in ('invoice_supplier_info', 'dl_footer'):
                db_connector.execute_query(
                    "INSERT INTO system_settings (kluc, hodnota) VALUES (%s, %s) ON DUPLICATE KEY UPDATE hodnota = %s",
                    (k, v, v), fetch="none"
                )
        return jsonify({"status": "success"})


@billing_bp.get("/api/billing/ready_for_invoice")
def get_ready_for_invoice():
    try:
        sql_orders = "SELECT id as obj_id, cislo_objednavky, pozadovany_datum_dodania, COALESCE(finalna_suma, celkova_suma_s_dph, 0) as suma, zakaznik_id, nazov_firmy FROM b2b_objednavky WHERE stav = 'Hotová' AND dodaci_list_id IS NULL"
        orders = db_connector.execute_query(sql_orders, fetch="all") or []
    except Exception as e: return jsonify({"error": str(e)}), 500

    sql_customers = "SELECT z.id, z.zakaznik_id as erp_code, z.nazov_firmy, z.typ_fakturacie, COALESCE(t.nazov, 'Nepriradená trasa') as trasa FROM b2b_zakaznici z LEFT JOIN logistika_trasy t ON z.trasa_id = t.id"
    customers_db = db_connector.execute_query(sql_customers, fetch="all") or []
    cust_map = {str(c['erp_code']).strip(): c for c in customers_db if c.get('erp_code')}
    trasy_map = {}
    
    for o in orders:
        cislo = str(o.get('cislo_objednavky') or '')
        vyextrahovany_kod = cislo.split('-')[1].strip() if len(cislo.split('-')) >= 2 else None
        found_cust = cust_map.get(vyextrahovany_kod) or cust_map.get(str(o.get('zakaznik_id')).strip())
        
        if found_cust: z_id, z_meno, trasa, typ_fa = str(found_cust['erp_code']), found_cust['nazov_firmy'], found_cust['trasa'], found_cust.get('typ_fakturacie') or 'Zberná'
        else: z_id, z_meno, trasa, typ_fa = str(vyextrahovany_kod or o.get('zakaznik_id') or 'Neznáme'), o.get('nazov_firmy') or f"Nespárovaný ({z_id})", 'Nepriradená trasa', 'Zberná'

        if trasa not in trasy_map: trasy_map[trasa] = {}
        if z_id not in trasy_map[trasa]: trasy_map[trasa][z_id] = {"zakaznik_id": z_id, "nazov_firmy": z_meno, "typ_fakturacie": typ_fa, "objednavky": []}
        trasy_map[trasa][z_id]["objednavky"].append({"id": o['obj_id'], "cislo": cislo, "datum": o['pozadovany_datum_dodania'], "suma": float(o['suma'])})

    vystup = [{"trasa": k, "zakaznici": list(v.values())} for k, v in trasy_map.items()]
    vystup.sort(key=lambda x: x['trasa'])
    for t in vystup: t['zakaznici'].sort(key=lambda c: c['nazov_firmy'])
    return jsonify({"trasy": vystup})

@billing_bp.get("/api/billing/order_items/<int:order_id>")
def get_order_items_for_billing(order_id):
    try:
        cols_db = db_connector.execute_query("SHOW COLUMNS FROM b2b_objednavky_polozky", fetch="all")
        cols = [c['Field'] for c in cols_db]
        qty_col = 'dodane_mnozstvo' if 'dodane_mnozstvo' in cols else 'mnozstvo'
        price_col = 'cena_skutocna' if 'cena_skutocna' in cols else 'cena_bez_dph'
        sql = f"SELECT id, ean_produktu as ean, nazov_vyrobku as name, COALESCE({qty_col}, mnozstvo) as qty, mj, COALESCE({price_col}, cena_bez_dph, 0) as price FROM b2b_objednavky_polozky WHERE objednavka_id = %s"
        return jsonify({"items": db_connector.execute_query(sql, (order_id,), fetch="all") or []})
    except Exception as e: return jsonify({"error": str(e)}), 500

@billing_bp.route('/api/billing/update_order_items', methods=['POST'])
def update_order_items():
    data = request.json
    items = data.get('items', [])
    if not items: return jsonify({"status": "error", "message": "Žiadne dáta"}), 400
    try:
        cols_db = db_connector.execute_query("SHOW COLUMNS FROM b2b_objednavky_polozky", fetch="all")
        cols = [c['Field'] for c in cols_db]
        conn = db_connector.get_connection()
        cursor = conn.cursor()
        for item in items:
            upd_parts = ["mnozstvo = %s", "cena_bez_dph = %s"]
            params = [item['mnozstvo'], item['cena_bez_dph']]
            if 'dodane_mnozstvo' in cols: upd_parts.append("dodane_mnozstvo = %s"); params.append(item['mnozstvo'])
            if 'cena_skutocna' in cols: upd_parts.append("cena_skutocna = %s"); params.append(item['cena_bez_dph'])
            params.append(item['id'])
            cursor.execute(f"UPDATE b2b_objednavky_polozky SET {', '.join(upd_parts)} WHERE id = %s", tuple(params))
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        if 'conn' in locals() and conn: conn.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        if 'conn' in locals() and conn: cursor.close(); conn.close()

@billing_bp.post("/api/billing/issue_documents")
def issue_documents():
    data = request.get_json(force=True) or {}
    order_ids = data.get("order_ids", [])
    create_fa = data.get("create_fa", False)
    if not order_ids: return jsonify({"error": "Neboli vybrané objednávky."}), 400

    placeholders = ','.join(['%s'] * len(order_ids))
    orders = db_connector.execute_query(f"SELECT * FROM b2b_objednavky WHERE id IN ({placeholders})", tuple(order_ids), fetch="all")
    if not orders: return jsonify({"error": "Objednávky nenájdené."}), 404

    zakaznik_id = str(orders[0]['zakaznik_id']).strip()
    zakaznik = db_connector.execute_query("SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s OR CAST(id AS CHAR) = %s LIMIT 1", (zakaznik_id, zakaznik_id), fetch="one") or {}

    total_bez_dph = sum(float(o.get('finalna_suma') or o.get('celkova_suma_s_dph') or 0) / 1.2 for o in orders)
    total_s_dph = sum(float(o.get('finalna_suma') or o.get('celkova_suma_s_dph') or 0) for o in orders)
    total_dph = total_s_dph - total_bez_dph
    
    cislo_dl = generate_dl_number()
    datum = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        fa_id = None
        if create_fa:
            cislo_fa = generate_doc_number('FA')
            vs = cislo_fa.replace('FA-', '').replace('-', '')
            cur.execute("INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", 
                        ('FA', cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum + timedelta(days=splatnost_dni), total_bez_dph, total_dph, total_s_dph, vs))
            fa_id = cur.lastrowid

        cur.execute("INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol, nadradena_faktura_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", 
                    ('DL', cislo_dl, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum, total_bez_dph, total_dph, total_s_dph, cislo_dl, fa_id))
        dl_id = cur.lastrowid

        cur.execute(f"UPDATE b2b_objednavky SET dodaci_list_id = %s, faktura_id = %s WHERE id IN ({placeholders})", (dl_id, fa_id, *order_ids))

        typ_pohybu = 'VYDAJ_FAKTURA' if create_fa else 'VYDAJ_DL'
        now_dt = datetime.now()
        for o in orders:
            cur.execute("SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (o['id'],))
            for p in cur.fetchall():
                mnozstvo = float(p.get('dodane_mnozstvo') or p.get('mnozstvo') or 0)
                if mnozstvo <= 0: continue
                cena = float(p.get('cena_skutocna') or p.get('cena_bez_dph') or 0)
                dph = float(p.get('dph') or 20.0)
                c_bez, c_s = mnozstvo * cena, (mnozstvo * cena) * (1 + (dph/100))
                
                try:
                    cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", 
                                (dl_id, o['id'], p.get('ean_produktu'), p.get('nazov_vyrobku'), mnozstvo, p.get('mj'), cena, dph, c_bez, c_s))
                    if fa_id:
                        cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", 
                                    (fa_id, o['id'], p.get('ean_produktu'), p.get('nazov_vyrobku'), mnozstvo, p.get('mj'), cena, dph, c_bez, c_s))
                except Exception as ex: print("Chyba polozky:", ex)
                    
                try:
                    cur.execute("INSERT INTO skladove_pohyby (datum_pohybu, ean, nazov_vyrobku, typ_pohybu, mnozstvo, mj, doklad_id, predajna_cena_bez_dph) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", 
                                (now_dt, p.get('ean_produktu'), p.get('nazov_vyrobku'), typ_pohybu, -mnozstvo, p.get('mj'), fa_id or dl_id, cena))
                    cur.execute("UPDATE produkty SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s WHERE ean = %s", (mnozstvo, p.get('ean_produktu')))
                except Exception as ex: print("Chyba skladu:", ex)

        conn.commit()
        return jsonify({"message": f"Vystavené: DL č. {cislo_dl}" + (f" a FA č. {cislo_fa}" if create_fa else ""), "dl_id": dl_id, "fa_id": fa_id})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn: cur.close(); conn.close()

@billing_bp.get("/api/billing/uninvoiced_dls")
def get_uninvoiced_dls():
    try:
        sql = "SELECT o.id as obj_id, o.cislo_objednavky, o.zakaznik_id, o.nazov_firmy, COALESCE(o.finalna_suma, o.celkova_suma_s_dph, 0) as suma, dh.id as dl_id, dh.cislo_dokladu, dh.datum_vystavenia, COALESCE(t.nazov, 'Nepriradená trasa') as trasa FROM b2b_objednavky o JOIN doklady_hlavicka dh ON o.dodaci_list_id = dh.id LEFT JOIN b2b_zakaznici z ON CAST(o.zakaznik_id AS CHAR) = CAST(z.zakaznik_id AS CHAR) LEFT JOIN logistika_trasy t ON z.trasa_id = t.id WHERE o.dodaci_list_id IS NOT NULL AND (o.faktura_id IS NULL OR o.faktura_id = 0)"
        rows = db_connector.execute_query(sql, fetch="all") or []
        z_map = {}
        for r in rows:
            zid = str(r['zakaznik_id'])
            if zid not in z_map: z_map[zid] = {"zakaznik_id": zid, "nazov_firmy": r['nazov_firmy'], "trasa": r['trasa'], "dodacie_listy": {}}
            dl_id = r['dl_id']
            if dl_id not in z_map[zid]["dodacie_listy"]: z_map[zid]["dodacie_listy"][dl_id] = {"dl_id": dl_id, "cislo_dl": r['cislo_dokladu'], "datum": r['datum_vystavenia'], "suma": 0, "obj_ids": []}
            z_map[zid]["dodacie_listy"][dl_id]["suma"] += float(r['suma'])
            z_map[zid]["dodacie_listy"][dl_id]["obj_ids"].append(r['obj_id'])

        for zid in z_map: z_map[zid]["dodacie_listy"] = list(z_map[zid]["dodacie_listy"].values())
        vystup = list(z_map.values())
        vystup.sort(key=lambda x: x['nazov_firmy'])
        return jsonify({"zakaznici": vystup})
    except Exception as e: return jsonify({"error": str(e)}), 500

@billing_bp.post("/api/billing/create_collective_invoice")
def create_collective_invoice():
    data = request.get_json(force=True) or {}
    dl_ids = data.get("dl_ids", [])
    if not dl_ids: return jsonify({"error": "Neboli vybrané DL."}), 400

    placeholders = ','.join(['%s'] * len(dl_ids))
    dls = db_connector.execute_query(f"SELECT * FROM doklady_hlavicka WHERE id IN ({placeholders}) AND typ_dokladu='DL'", tuple(dl_ids), fetch="all")
    if not dls: return jsonify({"error": "DL nenájdené."}), 404
        
    zakaznik_id = str(dls[0]['zakaznik_id']).strip()
    zakaznik = db_connector.execute_query("SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s OR CAST(id AS CHAR) = %s LIMIT 1", (zakaznik_id, zakaznik_id), fetch="one") or {}

    total_bez_dph = sum(float(d['suma_bez_dph']) for d in dls)
    total_s_dph = sum(float(d['suma_s_dph']) for d in dls)
    total_dph = total_s_dph - total_bez_dph
    
    cislo_fa = generate_doc_number('FA')
    datum = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        vs = cislo_fa.replace('FA-', '').replace('-', '')
        cur.execute("INSERT INTO doklady_hlavicka (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol) VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", 
                    (cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum, datum, datum + timedelta(days=splatnost_dni), total_bez_dph, total_dph, total_s_dph, vs))
        fa_id = cur.lastrowid

        cur.execute(f"UPDATE doklady_hlavicka SET nadradena_faktura_id = %s WHERE id IN ({placeholders})", (fa_id, *dl_ids))
        cur.execute(f"UPDATE b2b_objednavky SET faktura_id = %s WHERE dodaci_list_id IN ({placeholders})", (fa_id, *dl_ids))

        cur.execute(f"SELECT * FROM doklady_polozky WHERE doklad_id IN ({placeholders})", tuple(dl_ids))
        for p in cur.fetchall():
            cur.execute("INSERT INTO doklady_polozky (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (fa_id, p['objednavka_id'], p['ean'], p['nazov_polozky'], p['mnozstvo'], p['mj'], p['cena_bez_dph'], p['dph_percento'], p.get('celkom_bez_dph',0), p.get('celkom_s_dph',0)))

        conn.commit()
        return jsonify({"message": f"Zberná faktúra {cislo_fa} bola úspešne vystavená.", "fa_id": fa_id, "dl_id": dl_ids[0]})
    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn: cur.close(); conn.close()

@billing_bp.get("/api/billing/issued_documents")
def get_issued_documents():
    try:
        sql = "SELECT id, typ_dokladu, cislo_dokladu, odberatel_nazov, datum_vystavenia, suma_bez_dph, suma_s_dph FROM doklady_hlavicka ORDER BY id DESC LIMIT 100"
        docs = db_connector.execute_query(sql, fetch="all") or []
        for d in docs: d['datum'] = d['datum_vystavenia'].strftime('%d.%m.%Y') if hasattr(d['datum_vystavenia'], 'strftime') else str(d['datum_vystavenia'])
        return jsonify({"documents": docs})
    except Exception as e: return jsonify({"error": str(e)}), 500

def get_doc_html_block(doc_id):
    hlavicka = db_connector.execute_query("SELECT * FROM doklady_hlavicka WHERE id = %s", (doc_id,), fetch="one")
    if not hlavicka: return ""
    polozky = db_connector.execute_query("SELECT * FROM doklady_polozky WHERE doklad_id = %s", (doc_id,), fetch="all") or []
    
    nastavenia_db = db_connector.execute_query("SELECT kluc, hodnota FROM system_settings WHERE kluc IN ('invoice_supplier_info', 'dl_footer')", fetch="all") or []
    nastavenia = {r['kluc']: r['hodnota'] for r in nastavenia_db}
    
    dodavatel_text = nastavenia.get('invoice_supplier_info')
    if not dodavatel_text:
        dodavatel_html = "<strong>MIK, s.r.o.</strong><br>Záhradnícka 4/25<br>927 01 Šaľa<br><br><strong>IČO:</strong> 34099514<br><strong>DIČ:</strong> 2020400000<br><strong>IČ DPH:</strong> SK2020400000<br><br><small>Spoločnosť zapísaná v OR Okresného súdu Trnava,<br>oddiel: Sro, vložka č. 12345/T</small>"
    else:
        dodavatel_html = dodavatel_text.replace('\n', '<br>')
        
    dl_footer_text = nastavenia.get('dl_footer', '')
    footer_html = f"<div style='margin-top:30px; font-size:11px; color:#555;'>{dl_footer_text.replace(chr(10), '<br>')}</div>" if (hlavicka['typ_dokladu'] == 'DL' and dl_footer_text) else ""

    nazov_dokladu = "Faktúra - Daňový doklad" if hlavicka['typ_dokladu'] == 'FA' else "Dodací list"
    datum_str = hlavicka['datum_vystavenia'].strftime('%d.%m.%Y') if hasattr(hlavicka['datum_vystavenia'], 'strftime') else str(hlavicka['datum_vystavenia'])
    datum_splat_str = hlavicka['datum_splatnosti'].strftime('%d.%m.%Y') if hasattr(hlavicka.get('datum_splatnosti'), 'strftime') else str(hlavicka.get('datum_splatnosti', datum_str))
    
    html = f"""
    <div class="doc-page">
        <div class="header">
            <div class="title">{nazov_dokladu}<br><small style="font-size:16px; color:#555;">č. {hlavicka['cislo_dokladu']}</small></div>
            <div style="text-align:right; font-size:13px;">
                <table style="width:auto; float:right; border:none; margin:0;">
                    <tr><td style="border:none; padding:2px 10px; text-align:right;"><strong>Dátum vystavenia:</strong></td><td style="border:none; padding:2px 0;">{datum_str}</td></tr>
                    <tr><td style="border:none; padding:2px 10px; text-align:right;"><strong>Dátum dodania:</strong></td><td style="border:none; padding:2px 0;">{datum_str}</td></tr>
                    <tr><td style="border:none; padding:2px 10px; text-align:right;"><strong>Dátum splatnosti:</strong></td><td style="border:none; padding:2px 0; color:#d97706; font-weight:bold;">{datum_splat_str}</td></tr>
                    <tr><td style="border:none; padding:2px 10px; text-align:right;"><strong>Forma úhrady:</strong></td><td style="border:none; padding:2px 0;">Prevodný príkaz</td></tr>
                </table>
            </div>
        </div>
        <div class="boxes">
            <div class="box">
                <div class="box-title">Dodávateľ</div>
                <div style="font-size:14px; line-height:1.4;">{dodavatel_html}</div>
            </div>
            <div class="box">
                <div class="box-title">Odberateľ</div>
                <strong style="font-size:16px;">{hlavicka['odberatel_nazov']}</strong><br>
                {hlavicka['odberatel_adresa'] or ''}<br><br>
                <strong>IČO:</strong> {hlavicka['odberatel_ico'] or 'Nezadané'}<br>
                <strong>IČ DPH:</strong> {hlavicka['odberatel_ic_dph'] or 'Nezadané'}
            </div>
        </div>
        <table>
            <thead>
                <tr><th>Názov položky</th><th>EAN</th><th style="text-align:center;">Množstvo</th><th>MJ</th><th style="text-align:right;">Cena/MJ</th><th style="text-align:right;">DPH</th><th style="text-align:right;">Celkom s DPH</th></tr>
            </thead>
            <tbody>
    """
    for p in polozky:
        html += f"<tr><td>{p['nazov_polozky']}</td><td><small>{p.get('ean') or ''}</small></td><td style='text-align:center; font-weight:bold;'>{float(p['mnozstvo']):.2f}</td><td>{p['mj']}</td><td style='text-align:right;'>{float(p['cena_bez_dph']):.3f} €</td><td style='text-align:right;'>{p.get('dph_percento') or 20}%</td><td style='text-align:right; font-weight:bold;'>{float(p.get('celkom_s_dph') or 0):.2f} €</td></tr>"
        
    html += f"""
            </tbody>
        </table>
        <div class="totals">
            <table style="width:300px; float:right; border:none; margin:0;">
                <tr><td style="border:none; text-align:right; padding:4px;">Základ bez DPH:</td><td style="border:none; text-align:right; padding:4px; width:100px;">{float(hlavicka['suma_bez_dph']):.2f} €</td></tr>
                <tr><td style="border:none; text-align:right; padding:4px;">DPH:</td><td style="border:none; text-align:right; padding:4px;">{float(hlavicka['suma_dph']):.2f} €</td></tr>
                <tr><td colspan="2" style="border:none; border-top:2px solid #000; padding:10px 0 0 0;"><div class="grand-total">CELKOM K ÚHRADE: {float(hlavicka['suma_s_dph']):.2f} €</div></td></tr>
            </table>
            <div style="clear:both;"></div>
        </div>
        {footer_html}
        <div class="signatures">
            <div>Vystavil (Podpis a pečiatka):<br><br>...........................................................</div>
            <div>Tovar prevzal (Podpis):<br><br>...........................................................</div>
        </div>
    </div>
    """
    return html

@billing_bp.get("/api/billing/print_pack")
def print_pack():
    dl_id = request.args.get('dl_id')
    fa_id = request.args.get('fa_id')
    pages = []
    
    if dl_id and fa_id:
        h_dl = get_doc_html_block(dl_id)
        h_fa = get_doc_html_block(fa_id)
        pages = [h_dl, h_dl, h_fa, h_fa]
    elif dl_id:
        h_dl = get_doc_html_block(dl_id)
        pages = [h_dl, h_dl, h_dl, h_dl]
    elif fa_id:
        h_fa = get_doc_html_block(fa_id)
        pages = [h_fa, h_fa]
        
    joined_pages = "\n<div class='page-break'></div>\n".join(pages)
    
    final_html = f"""
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Tlač dokladov</title>
    <style>
        body {{ font-family: 'Arial', sans-serif; color: #111; font-size: 13px; margin: 0; padding: 20px; background: #525659; }}
        .doc-page {{ background: white; width: 210mm; min-height: 297mm; padding: 15mm; margin: 0 auto 20px auto; box-shadow: 0 0 10px rgba(0,0,0,0.5); box-sizing: border-box; position: relative; }}
        .page-break {{ display: block; height: 1px; }}
        .header {{ display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }}
        .title {{ font-size: 24px; font-weight: bold; text-transform: uppercase; color: #000; }}
        .boxes {{ display: flex; justify-content: space-between; margin-bottom: 20px; }}
        .box {{ width: 45%; border: 1px solid #000; padding: 15px; border-radius: 5px; }}
        .box-title {{ font-size: 11px; text-transform: uppercase; color: #000; margin-bottom: 5px; font-weight: bold; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 10px; }}
        th, td {{ border-bottom: 1px solid #000; padding: 8px; text-align: left; font-size: 12px; }}
        th {{ font-weight: bold; color: #000; border-top: 2px solid #000; border-bottom: 2px solid #000; }}
        .totals {{ margin-top: 10px; }}
        .grand-total {{ font-size: 18px; font-weight: bold; color: #000; margin-top: 5px; text-align: right; }}
        .signatures {{ margin-top: 50px; display: flex; justify-content: space-between; font-weight: bold; }}
        @media print {{ 
            body {{ padding: 0; background: white; }} 
            .doc-page {{ margin: 0; padding: 10mm; box-shadow: none; width: auto; min-height: auto; }}
            .page-break {{ page-break-after: always; }}
        }}
    </style></head><body onload="setTimeout(() => window.print(), 500);">{joined_pages}</body></html>
    """
    return make_response(final_html)

@billing_bp.get("/api/billing/print/<int:doc_id>")
def print_single_document(doc_id):
    html = get_doc_html_block(doc_id)
    if not html: return "Doklad sa nenašiel.", 404
    final_html = f"""
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Tlač dokladu</title>
    <style>
        body {{ font-family: 'Arial', sans-serif; color: #111; font-size: 13px; margin: 0; padding: 20px; background: #525659; }}
        .doc-page {{ background: white; width: 210mm; min-height: 297mm; padding: 15mm; margin: 0 auto 20px auto; box-shadow: 0 0 10px rgba(0,0,0,0.5); box-sizing: border-box; }}
        .header {{ display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }}
        .title {{ font-size: 24px; font-weight: bold; text-transform: uppercase; }}
        .boxes {{ display: flex; justify-content: space-between; margin-bottom: 20px; }}
        .box {{ width: 45%; border: 1px solid #000; padding: 15px; border-radius: 5px; }}
        .box-title {{ font-size: 11px; text-transform: uppercase; font-weight: bold; }}
        table {{ width: 100%; border-collapse: collapse; margin-bottom: 10px; }}
        th, td {{ border-bottom: 1px solid #000; padding: 8px; text-align: left; font-size: 12px; }}
        th {{ border-top: 2px solid #000; border-bottom: 2px solid #000; }}
        .grand-total {{ font-size: 18px; font-weight: bold; margin-top: 5px; text-align: right; }}
        .signatures {{ margin-top: 50px; display: flex; justify-content: space-between; font-weight: bold; }}
        .print-btn {{ background: #2563eb; color: white; border: none; padding: 15px 30px; font-size: 18px; font-weight:bold; cursor: pointer; border-radius: 8px; display:block; margin: 0 auto 20px auto; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }}
        @media print {{ body {{ padding: 0; background: white; }} .doc-page {{ margin: 0; padding: 10mm; box-shadow: none; }} .print-btn {{ display: none; }} }}
    </style></head><body>
    <button class="print-btn" onclick="window.print()">🖨️ Vytlačiť doklad</button>
    {html}</body></html>
    """
    return make_response(final_html)