import sys
import os
import logging
import argparse
import shutil
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import mysql.connector
from mysql.connector import Error

# =============================================================================
# IMPORT Z PROJEKTU
# =============================================================================
try:
    import db_connector
except ImportError:
    print("CHYBA: Nemozem najst modul 'db_connector.py'. Uistite sa, ze skript je v korenovom adresari projektu.")
    sys.exit(1)

# =============================================================================
# KONFIGURÁCIA SÚBOROV A CIEST
# =============================================================================

FILE_IMPORT = 'ZASOBA.CSV'
FILE_EXPORT = 'VYROBKY.CSV'
LOG_FILE = 'sync.log'
ENCODING = 'cp1250'

EDI_IMPORT_DIR = '/var/app/data/erp_exchange'
EDI_ARCHIVE_DIR = os.path.join(EDI_IMPORT_DIR, 'archive')

COL_WIDTHS = {
    'ean': (0, 15),
    'name': (15, 58),
    'price': (58, 69),
    'qty': (69, 77)
}

# =============================================================================
# LOGGING
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger()

# =============================================================================
# POMOCNÉ FUNKCIE
# =============================================================================

def parse_decimal(value_str):
    try:
        clean_str = value_str.strip().replace(',', '.')
        if not clean_str:
            return Decimal('0.0000')
        return Decimal(clean_str)
    except Exception:
        return Decimal('0.0000')

def format_fwf_line(ean, name, price, qty):
    ean_str = str(ean).strip()[:15].ljust(15)
    name_str = str(name).strip()[:43].ljust(43)
    
    price_dec = Decimal(price).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    price_str = "{:.4f}".format(price_dec).rjust(11)
    
    qty_dec = Decimal(qty).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    qty_str = "{:.2f}".format(qty_dec).rjust(8)

    return f"{ean_str}{name_str}{price_str}{qty_str}\n"

# =============================================================================
# HLAVNÁ LOGIKA
# =============================================================================

def run_import(cursor):
    if not os.path.exists(FILE_IMPORT):
        logger.error(f"Súbor {FILE_IMPORT} neexistuje.")
        sys.exit(1)

    logger.info(f"Začínam import z {FILE_IMPORT}...")
    rows_to_upsert = []
    
    try:
        with open(FILE_IMPORT, 'r', encoding=ENCODING) as f:
            for line_num, line in enumerate(f, 1):
                if len(line) < 77:
                    continue
                
                try:
                    ean = line[COL_WIDTHS['ean'][0]:COL_WIDTHS['ean'][1]].strip()
                    name = line[COL_WIDTHS['name'][0]:COL_WIDTHS['name'][1]].strip()
                    price = parse_decimal(line[COL_WIDTHS['price'][0]:COL_WIDTHS['price'][1]])
                    qty = parse_decimal(line[COL_WIDTHS['qty'][0]:COL_WIDTHS['qty'][1]])
                    
                    if not ean:
                        continue

                    rows_to_upsert.append((ean, name, qty, price))
                    
                except Exception as e:
                    logger.warning(f"Chyba parsovania riadku {line_num}: {e}")

        if not rows_to_upsert:
            logger.warning("Žiadne platné dáta.")
            return

        sql = """
            INSERT INTO produkty (ean, nazov_vyrobku, aktualny_sklad_finalny_kg, nakupna_cena)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                aktualny_sklad_finalny_kg = VALUES(aktualny_sklad_finalny_kg),
                nakupna_cena = VALUES(nakupna_cena),
                nazov_vyrobku = VALUES(nazov_vyrobku)
        """
        
        cursor.executemany(sql, rows_to_upsert)
        logger.info(f"Import OK: Spracovaných {cursor.rowcount} záznamov.")

    except IOError as e:
        logger.error(f"Chyba súboru: {e}")
        raise

def run_export(cursor):
    logger.info(f"Začínam export do {FILE_EXPORT}...")

    sql = """
        SELECT 
            p.ean,
            p.nazov_vyrobku,
            p.aktualny_sklad_finalny_kg,
            COALESCE(
                (SELECT zv.cena_za_jednotku 
                 FROM zaznamy_vyroba zv 
                 WHERE zv.produkt_ean = p.ean 
                   AND zv.cena_za_jednotku > 0
                 ORDER BY zv.datum_ukoncenia DESC, zv.id_davky DESC 
                 LIMIT 1),
                p.nakupna_cena,
                0.0000
            ) as smart_price
        FROM produkty p
        WHERE p.typ_polozky IN ('VÝROBOK', 'VÝROBOK_KRAJANY', 'VÝROBOK_KUSOVY')
    """
    
    try:
        cursor.execute(sql)
        results = cursor.fetchall()
        
        with open(FILE_EXPORT, 'w', encoding=ENCODING) as f:
            for row in results:
                if isinstance(row, dict):
                    ean = row.get('ean')
                    name = row.get('nazov_vyrobku')
                    qty = row.get('aktualny_sklad_finalny_kg')
                    price = row.get('smart_price')
                else:
                    ean, name, qty, price = row
                
                ean = ean if ean else ""
                name = name if name else ""
                qty = qty if qty is not None else Decimal(0)
                price = price if price is not None else Decimal(0)
                
                f.write(format_fwf_line(ean, name, price, qty))
                
        logger.info(f"Export OK: {len(results)} riadkov.")

    except IOError as e:
        logger.error(f"Chyba zápisu: {e}")
        raise


def run_edi_import(cursor):
    """Spracuje všetky CSV súbory v EDI adresári a vytvorí z nich objednávky."""
    if not os.path.exists(EDI_IMPORT_DIR):
        logger.error(f"Adresár pre EDI import neexistuje: {EDI_IMPORT_DIR}")
        return

    os.makedirs(EDI_ARCHIVE_DIR, exist_ok=True)
    files_processed = 0

    for filename in os.listdir(EDI_IMPORT_DIR):
        if not filename.lower().endswith('.csv'):
            continue
            
        if filename.upper() in [FILE_IMPORT, FILE_EXPORT]:
            continue

        filepath = os.path.join(EDI_IMPORT_DIR, filename)
        archive_path = os.path.join(EDI_ARCHIVE_DIR, filename)

        logger.info(f"Načítavam EDI súbor: {filename}")

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        except UnicodeDecodeError:
            with open(filepath, 'r', encoding='cp1250', errors='replace') as f:
                lines = f.readlines()
                
        if not lines:
            logger.warning(f"Súbor {filename} je prázdny. Presúvam do archívu.")
            shutil.move(filepath, archive_path)
            continue

        # Zistenie oddeľovača z hlavičky a izolácia dátumu
        delimiter = ';' if ';' in lines[0] else ' '
        header_parts = lines[0].split(delimiter)
        
        delivery_date = datetime.now().strftime('%Y-%m-%d')
        if len(header_parts) >= 8 and "202" in header_parts[7]:
            date_str = header_parts[7].strip()
            try:
                delivery_date = datetime.strptime(date_str, '%d.%m.%Y').strftime('%Y-%m-%d')
            except ValueError:
                pass
                
        orders_grouped = {}

        # 1. Parsácia položiek na základe hybridného formátu súboru
        for line in lines[1:]:
            if not line.strip(): continue
            parts = line.split()
            if len(parts) < 6: continue
            
            raw_ean = parts[0].strip()
            stripped_ean = raw_ean.lstrip('0') or raw_ean 
            
            try:
                qty = float(parts[-5].replace(',', '.'))
            except ValueError:
                continue
                
            if qty <= 0: continue
            
            branch_id_raw = parts[-3].strip()
            branch_id = branch_id_raw.split('-')[-1]
            gln = parts[-2].strip()
            
            store_key = f"{branch_id}_{gln}"
            if store_key not in orders_grouped:
                orders_grouped[store_key] = {
                    "branch_id": branch_id,
                    "gln": gln,
                    "items": []
                }
            
            orders_grouped[store_key]["items"].append({
                "raw_ean": stripped_ean,
                "qty": qty
            })

        if not orders_grouped:
            logger.warning(f"Súbor {filename} neobsahuje platné položky. Presúvam do archívu.")
            shutil.move(filepath, archive_path)
            continue
            
        # 2. Mapovanie voči ERP databáze a generovanie objednávok
        for store_key, store_data in orders_grouped.items():
            branch_id = store_data["branch_id"]
            gln = store_data["gln"]
            items = store_data["items"]
            
            sql_find_cust = """
                SELECT id, parent_id, zakaznik_id, nazov_firmy, adresa_dorucenia 
                FROM b2b_zakaznici 
                WHERE typ='B2B' AND parent_id IS NOT NULL 
                AND (edi_kod = %s OR cislo_prevadzky = %s OR cislo_prevadzky LIKE %s)
                LIMIT 1
            """
            cursor.execute(sql_find_cust, (gln, branch_id, f"%{branch_id}"))
            customer = cursor.fetchone()
            
            if not customer:
                logger.error(f"Zákazník nenájdený: GLN={gln}, PJ={branch_id}. Objednávka preskočená.")
                continue
                
            if isinstance(customer, tuple):
                cust_id, parent_id, zakaznik_id, nazov_firmy, adresa_dorucenia = customer
            else:
                cust_id = customer.get('id')
                parent_id = customer.get('parent_id')
                zakaznik_id = customer.get('zakaznik_id')
                nazov_firmy = customer.get('nazov_firmy')
                adresa_dorucenia = customer.get('adresa_dorucenia', '')
                
            if not parent_id:
                logger.error(f"Zákazník '{nazov_firmy}' nemá definované parent_id. Objednávka preskočená.")
                continue
                
            order_number = f"EDI-{zakaznik_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            order_items = []
            total_gross = 0.0
            
            for item in items:
                sql_mapping = """
                    SELECT interny_ean FROM edi_produkty_mapovanie 
                    WHERE chain_parent_id = %s AND (edi_ean = %s OR TRIM(LEADING '0' FROM edi_ean) = %s) LIMIT 1
                """
                cursor.execute(sql_mapping, (parent_id, item['raw_ean'], item['raw_ean']))
                mapping = cursor.fetchone()
                
                if not mapping:
                    logger.warning(f"Chýba EDI mapovanie pre EAN {item['raw_ean']} (Parent ID {parent_id})")
                    continue
                    
                interny_ean = mapping[0] if isinstance(mapping, tuple) else mapping.get('interny_ean')
                
                sql_prod = """
                    SELECT nazov_vyrobku, dph, mj, predajna_kategoria, vaha_balenia_g, typ_polozky 
                    FROM produkty WHERE ean = %s LIMIT 1
                """
                cursor.execute(sql_prod, (interny_ean,))
                prod = cursor.fetchone()
                
                if not prod:
                    logger.warning(f"ERP neeviduje interný EAN: {interny_ean}")
                    continue
                    
                p_nazov = prod[0] if isinstance(prod, tuple) else prod.get('nazov_vyrobku')
                p_dph = float(prod[1] if isinstance(prod, tuple) else (prod.get('dph') or 20))
                p_mj = prod[2] if isinstance(prod, tuple) else (prod.get('mj') or 'ks')
                p_kat = prod[3] if isinstance(prod, tuple) else prod.get('predajna_kategoria')
                p_vaha = prod[4] if isinstance(prod, tuple) else prod.get('vaha_balenia_g')
                p_typ = prod[5] if isinstance(prod, tuple) else prod.get('typ_polozky')
                
                sql_price = """
                    SELECT cp.cena FROM b2b_zakaznik_cennik zc
                    JOIN b2b_cennik_polozky cp ON cp.cennik_id = zc.cennik_id
                    WHERE zc.zakaznik_id = %s AND cp.ean_produktu = %s LIMIT 1
                """
                cursor.execute(sql_price, (zakaznik_id, interny_ean))
                price_row = cursor.fetchone()
                price = float(price_row[0] if isinstance(price_row, tuple) else price_row.get('cena', 0.0)) if price_row else 0.0
                    
                qty = item['qty']
                line_net = price * qty
                line_gross = line_net * (1 + (p_dph / 100))
                total_gross += line_gross
                
                order_items.append((
                    interny_ean, p_nazov, qty, p_mj, p_dph, p_kat, p_vaha, p_typ, price, delivery_date, 0
                ))
                
            if not order_items:
                logger.error(f"Predajňa {nazov_firmy}: Nespárovala sa žiadna položka. Objednávka neuložená.")
                continue
                
            sql_insert_order = """
                INSERT INTO b2b_objednavky (
                    cislo_objednavky, zakaznik_id, nazov_firmy, adresa, pozadovany_datum_dodania, 
                    stav, celkova_suma_s_dph
                ) VALUES (%s, %s, %s, %s, %s, 'Nová', %s)
            """
            cursor.execute(sql_insert_order, (order_number, zakaznik_id, nazov_firmy, adresa_dorucenia, delivery_date, total_gross))
            new_order_id = cursor.lastrowid
            
            sql_insert_item = """
                INSERT INTO b2b_objednavky_polozky (
                    objednavka_id, ean_produktu, nazov_vyrobku, mnozstvo, mj, dph, 
                    predajna_kategoria, vaha_balenia_g, typ_polozky, cena_bez_dph, 
                    pozadovany_datum_dodania, is_akcia
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            for oi in order_items:
                cursor.execute(sql_insert_item, (new_order_id,) + oi)
                
            logger.info(f"Vytvorená EDI objednávka: {order_number} | Klient: {nazov_firmy} | Počet položiek: {len(order_items)}")
            
        shutil.move(filepath, archive_path)
        logger.info(f"Súbor archivovaný: {filename}")
        files_processed += 1
        
    if files_processed == 0:
        logger.info("Zložka EDI neobsahuje nové súbory.")


def main():
    parser = argparse.ArgumentParser(description='Synchronizácia ERP.')
    parser.add_argument('--mode', required=True, choices=['import', 'export', 'edi'])
    args = parser.parse_args()

    conn = None
    cursor = None
    
    try:
        conn = db_connector.get_connection()
        
        if conn.is_connected():
            conn.start_transaction()
            cursor = conn.cursor()

            if args.mode == 'import':
                run_import(cursor)
            elif args.mode == 'export':
                run_export(cursor)
            elif args.mode == 'edi':
                run_edi_import(cursor)

            conn.commit()
            logger.info("Transakcia potvrdená (COMMIT).")
        else:
            logger.error("Nepodarilo sa pripojiť k databáze.")

    except Error as e:
        if conn and conn.is_connected():
            conn.rollback()
            logger.error("DB Error - ROLLBACK.")
        logger.error(f"MySQL Error: {e}")
        sys.exit(1)
    except Exception as e:
        if conn and conn.is_connected():
            conn.rollback()
        logger.error(f"Kritická chyba: {e}")
        sys.exit(1)
    finally:
        if cursor:
            cursor.close()
        if conn and conn.is_connected():
            conn.close()
            logger.info("Spojenie ukončené.")

if __name__ == "__main__":
    main()