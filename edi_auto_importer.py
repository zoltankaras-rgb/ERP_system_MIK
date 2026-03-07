import os
import io
import shutil
import traceback
from datetime import datetime
import db_connector

# Konfigurácia zložiek
ERP_EXCHANGE_DIR = os.getenv("ERP_EXCHANGE_DIR", "/var/app/data/erp_exchange")
EDI_ARCHIVE_DIR = os.path.join(ERP_EXCHANGE_DIR, "EDI_archiv")

def process_edi_files():
    if not os.path.exists(ERP_EXCHANGE_DIR):
        os.makedirs(ERP_EXCHANGE_DIR, exist_ok=True)
    if not os.path.exists(EDI_ARCHIVE_DIR):
        os.makedirs(EDI_ARCHIVE_DIR, exist_ok=True)

    csv_files = [f for f in os.listdir(ERP_EXCHANGE_DIR) if f.lower().endswith('.csv') and os.path.isfile(os.path.join(ERP_EXCHANGE_DIR, f))]

    if not csv_files:
        return 

    conn = db_connector.get_connection()
    cur = conn.cursor(dictionary=True)

    try:
        for filename in csv_files:
            filepath = os.path.join(ERP_EXCHANGE_DIR, filename)
            
            with open(filepath, 'rb') as f:
                raw_bytes = f.read()

            try:
                content = raw_bytes.decode('utf-8')
            except UnicodeDecodeError:
                content = raw_bytes.decode('cp1250', errors='replace')

            lines = content.splitlines()
            if not lines:
                continue

            # 1. Čítanie hlavičky (1. riadok)
            header_parts = lines[0].split(';')
            if len(header_parts) >= 8:
                date_str = header_parts[7].strip() # napr. 28.08.2025
                try:
                    delivery_date = datetime.strptime(date_str, '%d.%m.%Y').strftime('%Y-%m-%d')
                except ValueError:
                    delivery_date = datetime.now().strftime('%Y-%m-%d')
            else:
                delivery_date = datetime.now().strftime('%Y-%m-%d')

            # 2. Parsovanie položiek
            # Zoskupujeme podľa (GLN, Číslo EDI objednávky), aby sa vytvorili samostatné doklady
            orders_grouped = {}
            
            for line in lines[1:]:
                if not line.strip(): continue
                parts = line.split()
                if len(parts) < 6: continue
                
                raw_ean = parts[0].strip()
                stripped_ean = raw_ean.lstrip('0') or raw_ean # Odstránenie núl
                
                try:
                    qty = float(parts[-5].replace(',', '.'))
                except ValueError:
                    continue
                    
                if qty <= 0: continue
                
                coop_order_no = parts[-4].strip() # 9104063_2503918
                gln = parts[-2].strip()           # 8589000032058
                
                group_key = (gln, coop_order_no)
                if group_key not in orders_grouped:
                    orders_grouped[group_key] = []
                    
                orders_grouped[group_key].append({
                    "raw_ean": raw_ean,
                    "stripped_ean": stripped_ean,
                    "qty": qty
                })

            # 3. Zápis do databázy
            for (gln, coop_order_no), items in orders_grouped.items():
                cur.execute("SELECT id, zakaznik_id, nazov_firmy, adresa_dorucenia, parent_id FROM b2b_zakaznici WHERE edi_kod = %s", (gln,))
                customer = cur.fetchone()
                
                if not customer or not customer['parent_id']:
                    continue

                parent_id = customer['parent_id']
                order_items = []
                total_gross = 0.0

                for item in items:
                    # Mapovanie EAN (Hľadá zhodu s nulami aj bez núl)
                    cur.execute("""
                        SELECT interny_ean FROM edi_produkty_mapovanie 
                        WHERE chain_parent_id = %s AND (edi_ean = %s OR edi_ean = %s) LIMIT 1
                    """, (parent_id, item['raw_ean'], item['stripped_ean']))
                    map_result = cur.fetchone()
                    
                    # Ak nenašiel mapovanie, skúsi hľadať priamo v produktoch
                    interny_ean = map_result['interny_ean'] if map_result else item['stripped_ean']

                    cur.execute("SELECT nazov_vyrobku, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, mj FROM produkty WHERE ean = %s", (interny_ean,))
                    prod = cur.fetchone()
                    if not prod: continue

                    cur.execute("""
                        SELECT cp.cena FROM b2b_cennik_polozky cp
                        JOIN b2b_zakaznik_cennik zc ON zc.cennik_id = cp.cennik_id
                        WHERE zc.zakaznik_id = %s AND cp.ean_produktu = %s LIMIT 1
                    """, (customer['zakaznik_id'], interny_ean))
                    price_row = cur.fetchone()
                    price = float(price_row['cena']) if price_row else 0.0

                    is_akcia = 0
                    display_name = prod['nazov_vyrobku']

                    # Kontrola akcie
                    cur.execute("""
                        SELECT cena FROM akciove_ceny 
                        WHERE ean = %s AND platnost_od <= %s AND platnost_do >= %s AND zakaznik_skupina_id = %s LIMIT 1
                    """, (interny_ean, delivery_date, delivery_date, parent_id))
                    action_result = cur.fetchone()
                    if action_result:
                        price = float(action_result['cena'])
                        is_akcia = 1
                        display_name = f"[AKCIA] {prod['nazov_vyrobku']}"

                    qty = item['qty']
                    dph_rate = float(prod['dph'] or 20)
                    line_net = price * qty
                    line_gross = line_net * (1 + (dph_rate / 100))
                    
                    total_gross += line_gross

                    order_items.append((
                        interny_ean, display_name, qty, prod['mj'], dph_rate, 
                        prod['predajna_kategoria'], prod['vaha_balenia_g'], prod['typ_polozky'], price, is_akcia
                    ))

                if not order_items: continue

                # Vytvorenie objednávky priamo s originálnym číslom z COOP
                order_number = f"EDI-{coop_order_no}" 
                
                # Kontrola duplicity (aby nenaimportovalo tú istú objednávku 2x ak by súbor ostal visieť)
                cur.execute("SELECT id FROM b2b_objednavky WHERE cislo_objednavky = %s LIMIT 1", (order_number,))
                if cur.fetchone():
                    continue # Už existuje

                cur.execute("""
                    INSERT INTO b2b_objednavky 
                    (cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, celkova_suma_s_dph, stav)
                    VALUES (%s, %s, %s, %s, %s, %s, 'Nová')
                """, (order_number, customer['zakaznik_id'], customer['nazov_firmy'], customer['adresa_dorucenia'], delivery_date, total_gross))
                
                order_id = cur.lastrowid
                
                insert_query = """
                    INSERT INTO b2b_objednavky_polozky 
                    (objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, predajna_kategoria, vaha_balenia_g, typ_polozky, cena_bez_dph, pozadovany_datum_dodania, is_akcia)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """
                cur.executemany(insert_query, [(order_id, *item, delivery_date) for item in order_items])

            conn.commit()

            # Presun spracovaného súboru do archívu s časovou pečiatkou
            timestamp_str = datetime.now().strftime('%Y%m%d_%H%M%S')
            archived_filename = f"{timestamp_str}_{filename}"
            archived_filepath = os.path.join(EDI_ARCHIVE_DIR, archived_filename)
            
            shutil.move(filepath, archived_filepath)
            print(f"[{datetime.now()}] Import ukončený. Súbor archivovaný: {archived_filename}")

    except Exception as e:
        conn.rollback()
        traceback.print_exc()
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    process_edi_files()