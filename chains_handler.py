import csv
import io
import traceback
from datetime import datetime
from flask import Blueprint, request, jsonify
import db_connector
from auth_handler import login_required

chains_bp = Blueprint('chains_api', __name__)

# ==========================================
# 1. ZÁKLADNÁ SPRÁVA REŤAZCOV
# ==========================================

@chains_bp.route('/api/chains', methods=['GET'])
@login_required(role=("kancelaria", "admin", "veduci"))
def get_chains():
    """Vráti zoznam materských spoločností (napr. COOP Jednota centrála)."""
    try:
        rows = db_connector.execute_query(
            "SELECT id, zakaznik_id, nazov_firmy, email, telefon FROM b2b_zakaznici WHERE parent_id IS NULL AND typ='B2B'", 
            fetch='all'
        ) or []
        return jsonify({"chains": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chains_bp.route('/api/chains/<int:parent_id>/branches', methods=['GET'])
@login_required(role=("kancelaria", "admin", "veduci"))
def get_branches(parent_id):
    """Vráti zoznam všetkých pobočiek pod konkrétnou centrálou."""
    try:
        rows = db_connector.execute_query(
            """SELECT id, zakaznik_id, nazov_firmy, adresa_dorucenia, telefon, email, edi_kod, cislo_prevadzky 
               FROM b2b_zakaznici WHERE parent_id = %s ORDER BY cislo_prevadzky""", 
            (parent_id,), fetch='all'
        ) or []
        return jsonify({"branches": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chains_bp.route('/api/chains/branch/<int:branch_id>', methods=['POST'])
@login_required(role=("kancelaria", "admin", "veduci"))
def update_branch(branch_id):
    """Aktualizácia konkrétnej pobočky (napr. priradenie interného ERP čísla 'zakaznik_id')."""
    data = request.json or {}
    try:
        db_connector.execute_query(
            """UPDATE b2b_zakaznici 
               SET zakaznik_id=%s, edi_kod=%s, telefon=%s, email=%s 
               WHERE id=%s""",
            (data.get('zakaznik_id'), data.get('edi_kod'), data.get('telefon'), data.get('email'), branch_id),
            fetch='none'
        )
        return jsonify({"message": "Pobočka bola úspešne aktualizovaná."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# 2. IMPORT PREVÁDZOK Z CSV
# ==========================================

@chains_bp.route('/api/chains/<int:parent_id>/import_stores', methods=['POST'])
@login_required(role=("admin", "veduci"))
def import_coop_stores(parent_id):
    """Spracuje CSV a vykoná UPSERT pobočiek na základe GLN (edi_kod)."""
    if 'file' not in request.files:
        return jsonify({"error": "Chýba súbor."}), 400
        
    file = request.files['file']
    try:
        raw_bytes = file.read()
        try:
            content = raw_bytes.decode('utf-8')
        except UnicodeDecodeError:
            content = raw_bytes.decode('cp1250', errors='replace')
            
        csv_reader = csv.reader(io.StringIO(content), delimiter=',')
        
        conn = db_connector.get_connection()
        cur = conn.cursor()
        
        processed, updated = 0, 0

        for row in csv_reader:
            if len(row) < 11 or "GLN" in row[10] or not row[10].strip():
                continue 

            retazec = row[2].strip()
            cislo_pj = row[3].strip() 
            mesto = row[4].strip()
            psc = row[5].replace('.0', '').strip()
            adresa_ulica = row[6].strip()
            veduca = row[7].strip()
            mobil = row[8].strip()
            email = row[9].strip()
            gln = row[10].replace('.0', '').strip() 
            
            if not gln: continue

            nazov_firmy = f"{retazec} - {mesto}"
            adresa_dorucenia = f"{adresa_ulica}, {psc} {mesto}"
            poznamka = f"Vedúca: {veduca}"
            
            import secrets, hashlib, os
            salt = os.urandom(16)
            key = hashlib.pbkdf2_hmac("sha256", secrets.token_hex(16).encode("utf-8"), salt, 250000)
            salt_hex, hash_hex = salt.hex(), key.hex()

            sql = """
                INSERT INTO b2b_zakaznici 
                (parent_id, typ, nazov_firmy, adresa_dorucenia, telefon, email, edi_kod, cislo_prevadzky, heslo_hash, heslo_salt, je_schvaleny, poznamka)
                VALUES (%s, 'B2B', %s, %s, %s, %s, %s, %s, %s, %s, 1, %s)
                ON DUPLICATE KEY UPDATE 
                nazov_firmy=VALUES(nazov_firmy),
                adresa_dorucenia=VALUES(adresa_dorucenia),
                telefon=VALUES(telefon),
                email=VALUES(email),
                cislo_prevadzky=VALUES(cislo_prevadzky),
                poznamka=VALUES(poznamka)
            """
            cur.execute(sql, (
                parent_id, nazov_firmy, adresa_dorucenia, mobil, email, 
                gln, cislo_pj, hash_hex, salt_hex, poznamka
            ))
            
            if cur.rowcount == 1: processed += 1
            else: updated += 1

        conn.commit()
        return jsonify({"message": f"Import úspešný. Vytvorených: {processed}, Aktualizovaných: {updated}."})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Chyba importu: {str(e)}"}), 500
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

# ==========================================
# 3. EDI MAPOVANIE PRODUKTOV
# ==========================================

@chains_bp.route('/api/chains/<int:parent_id>/edi_mapping', methods=['GET'])
@login_required(role=("kancelaria", "admin", "veduci"))
def get_edi_mapping(parent_id):
    try:
        sql = """
            SELECT m.id, m.edi_ean, m.interny_ean, p.nazov_vyrobku 
            FROM edi_produkty_mapovanie m
            LEFT JOIN produkty p ON p.ean = m.interny_ean
            WHERE m.chain_parent_id = %s
        """
        rows = db_connector.execute_query(sql, (parent_id,), fetch='all') or []
        return jsonify({"mapping": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chains_bp.route('/api/chains/<int:parent_id>/edi_mapping', methods=['POST'])
@login_required(role=("kancelaria", "admin", "veduci"))
def add_edi_mapping(parent_id):
    data = request.json
    edi_ean = data.get('edi_ean')
    interny_ean = data.get('interny_ean')
    
    if not edi_ean or not interny_ean:
        return jsonify({"error": "Chýbajú EAN kódy"}), 400
        
    try:
        exists = db_connector.execute_query("SELECT nazov_vyrobku FROM produkty WHERE ean=%s", (interny_ean,), fetch='one')
        if not exists:
            return jsonify({"error": f"Interný EAN {interny_ean} neexistuje v ERP."}), 400

        db_connector.execute_query(
            """
            INSERT INTO edi_produkty_mapovanie (chain_parent_id, edi_ean, interny_ean) 
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE interny_ean=VALUES(interny_ean)
            """, 
            (parent_id, edi_ean, interny_ean), fetch='none'
        )
        return jsonify({"message": f"Mapovanie pre '{exists['nazov_vyrobku']}' uložené."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chains_bp.route('/api/chains/edi_mapping/<int:mapping_id>', methods=['DELETE'])
@login_required(role=("admin", "veduci"))
def delete_edi_mapping(mapping_id):
    try:
        db_connector.execute_query("DELETE FROM edi_produkty_mapovanie WHERE id=%s", (mapping_id,), fetch='none')
        return jsonify({"message": "Mapovanie vymazané."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# 4. REPORT AKCIOVÝCH PREDAJOV
# ==========================================

@chains_bp.route('/api/chains/action_report', methods=['POST'])
@login_required(role=("kancelaria", "admin", "veduci"))
def api_action_sales_report():
    data = request.json or {}
    date_from = data.get("date_from")
    date_to = data.get("date_to")
    parent_id = data.get("parent_id")

    if not date_from or not date_to or not parent_id:
        return jsonify({"error": "Chýbajú parametre (date_from, date_to, parent_id)."}), 400

    try:
        sql = """
            SELECT 
                pol.ean_produktu AS ean,
                pol.nazov_vyrobku AS produkt,
                pol.mj,
                SUM(pol.mnozstvo) AS predane_mnozstvo,
                SUM(pol.mnozstvo * pol.cena_bez_dph) AS trzby_bez_dph,
                MIN(pol.cena_bez_dph) AS aplikovana_cena
            FROM b2b_objednavky_polozky pol
            JOIN b2b_objednavky o ON o.id = pol.objednavka_id
            WHERE pol.is_akcia = 1
              AND o.pozadovany_datum_dodania >= %s 
              AND o.pozadovany_datum_dodania <= %s
              AND o.stav NOT IN ('Zrušená', 'Stornovaná')
              AND o.zakaznik_id IN (SELECT zakaznik_id FROM b2b_zakaznici WHERE parent_id = %s)
            GROUP BY pol.ean_produktu, pol.nazov_vyrobku, pol.mj
            ORDER BY predane_mnozstvo DESC
        """
        rows = db_connector.execute_query(sql, (date_from, date_to, parent_id), fetch="all") or []
        
        total_rev = 0.0
        for r in rows:
            r['predane_mnozstvo'] = float(r['predane_mnozstvo'] or 0)
            r['trzby_bez_dph'] = float(r['trzby_bez_dph'] or 0)
            r['aplikovana_cena'] = float(r['aplikovana_cena'] or 0)
            total_rev += r['trzby_bez_dph']
            
        return jsonify({"report": rows, "total_action_revenue": total_rev})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Chyba pri generovaní reportu: {str(e)}"}), 500

@chains_bp.route('/api/chains/<int:parent_id>/import_orders', methods=['POST'])
@login_required(role=("kancelaria", "admin", "veduci"))
def import_edi_orders(parent_id):
    """Importuje EDI objednávky a zapíše ich natívne ako B2B objednávky."""
    if 'file' not in request.files:
        return jsonify({"error": "Chýba súbor s objednávkami."}), 400

    delivery_date = request.form.get("delivery_date")
    if not delivery_date:
        return jsonify({"error": "Chýba požadovaný dátum dodania."}), 400

    file = request.files['file']
    try:
        raw_bytes = file.read()
        try:
            content = raw_bytes.decode('utf-8')
        except UnicodeDecodeError:
            content = raw_bytes.decode('cp1250', errors='replace')
            
        csv_reader = csv.reader(io.StringIO(content), delimiter=';') # EDI CSV zvyčajne používa bodkočiarku
        
        conn = db_connector.get_connection()
        cur = conn.cursor(dictionary=True)

        # Zoskupenie položiek podľa GLN (EDI kódu predajne)
        orders_by_gln = {}
        for row in csv_reader:
            if len(row) < 11 or "GLN" in row[0]: continue
            
            gln = str(row[10]).replace('.0', '').strip()
            edi_ean = str(row[4]).strip()
            qty_str = str(row[5]).replace(',', '.')
            try:
                qty = float(qty_str)
            except ValueError:
                continue
                
            if qty <= 0 or not gln: continue
                
            if gln not in orders_by_gln: orders_by_gln[gln] = []
            orders_by_gln[gln].append({"edi_ean": edi_ean, "qty": qty})

        processed_count = 0
        errors = []

        for gln, items in orders_by_gln.items():
            # 1. Nájdenie pobočky podľa EDI kódu
            cur.execute("SELECT id, zakaznik_id, nazov_firmy, adresa_dorucenia FROM b2b_zakaznici WHERE edi_kod = %s AND parent_id = %s", (gln, parent_id))
            customer = cur.fetchone()
            if not customer:
                errors.append(f"Nenájdená prevádzka pre GLN: {gln}")
                continue

            order_items = []
            total_net = 0.0
            total_gross = 0.0
            
            for item in items:
                # 2. Preklad cudzieho EAN na interný EAN
                cur.execute("SELECT interny_ean FROM edi_produkty_mapovanie WHERE edi_ean = %s AND chain_parent_id = %s", (item['edi_ean'], parent_id))
                map_result = cur.fetchone()
                interny_ean = map_result['interny_ean'] if map_result else item['edi_ean']

                # 3. Zistenie produktu z databázy
                cur.execute("SELECT nazov_vyrobku, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, mj FROM produkty WHERE ean = %s", (interny_ean,))
                prod = cur.fetchone()
                if not prod:
                    errors.append(f"Produkt EAN {interny_ean} neexistuje (EDI: {item['edi_ean']})")
                    continue

                # 4. Zistenie bežnej ceny (Fallback, ideálne napojiť na b2b_cennik_polozky)
                cur.execute("""
                    SELECT cp.cena 
                    FROM b2b_cennik_polozky cp
                    JOIN b2b_zakaznik_cennik zc ON zc.cennik_id = cp.cennik_id
                    WHERE zc.zakaznik_id = %s AND cp.ean_produktu = %s LIMIT 1
                """, (customer['zakaznik_id'], interny_ean))
                price_row = cur.fetchone()
                price = float(price_row['cena']) if price_row else 0.0

                # 5. Kontrola akcie (Správa Akcií)
                is_akcia = 0
                display_name = prod['nazov_vyrobku']
                # Predpokladaná tabuľka pre akcie. Ak je iná, upravíme.
                # cur.execute("SELECT cena FROM akciove_ceny WHERE ean = %s AND platnost_od <= %s AND platnost_do >= %s LIMIT 1", (interny_ean, delivery_date, delivery_date))
                # action_row = cur.fetchone()
                # if action_row:
                #     price = float(action_row['cena'])
                #     is_akcia = 1
                #     display_name = f"[AKCIA] {prod['nazov_vyrobku']}"

                qty = item['qty']
                dph_rate = float(prod['dph'] or 20)
                line_net = price * qty
                line_gross = line_net * (1 + (dph_rate / 100))
                
                total_net += line_net
                total_gross += line_gross
                
                order_items.append((
                    interny_ean, display_name, qty, prod['mj'], dph_rate, 
                    prod['predajna_kategoria'], prod['vaha_balenia_g'], prod['typ_polozky'], price, is_akcia
                ))

            if not order_items: continue

            # 6. Zápis do B2B_OBJEDNAVKY (Natívne zapojenie do ERP)
            order_number = f"EDI-{customer['zakaznik_id']}-{datetime.now().strftime('%m%d%H%M%S')}"
            cur.execute("""
                INSERT INTO b2b_objednavky 
                (cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, celkova_suma_s_dph, stav)
                VALUES (%s, %s, %s, %s, %s, %s, 'Nová')
            """, (order_number, customer['zakaznik_id'], customer['nazov_firmy'], customer['adresa_dorucenia'], delivery_date, total_gross))
            
            order_id = cur.lastrowid
            
            # 7. Zápis položiek
            insert_query = """
                INSERT INTO b2b_objednavky_polozky 
                (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, cena_bez_dph, pozadovany_datum_dodania, is_akcia)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cur.executemany(insert_query, [(order_id, *item, delivery_date) for item in order_items])
            processed_count += 1

        conn.commit()
        return jsonify({"message": f"Úspešne naimportovaných a vytvorených {processed_count} B2B objednávok.", "errors": errors})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Chyba pri importe objednávok: {str(e)}"}), 500
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()