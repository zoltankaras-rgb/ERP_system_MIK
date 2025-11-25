import sys
import os
import logging
import argparse
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
# KONFIGURÁCIA SÚBOROV
# =============================================================================

FILE_IMPORT = 'ZASOBA.CSV'
FILE_EXPORT = 'VYROBKY.CSV'
LOG_FILE = 'sync.log'
ENCODING = 'cp1250'

# Definícia stĺpcov (Start, End)
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
    """Bezpečný prevod stringu na Decimal."""
    try:
        clean_str = value_str.strip().replace(',', '.')
        if not clean_str:
            return Decimal('0.0000')
        return Decimal(clean_str)
    except Exception:
        return Decimal('0.0000')

def format_fwf_line(ean, name, price, qty):
    """Vytvorí riadok s fixnou šírkou pre export."""
    ean_str = str(ean).strip()[:15].ljust(15)
    name_str = str(name).strip()[:43].ljust(43)
    
    # Cena: format 10.4, zarovnanie doprava
    price_dec = Decimal(price).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    price_str = "{:.4f}".format(price_dec).rjust(11)
    
    # Množstvo: zarovnanie doprava
    qty_dec = Decimal(qty).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    qty_str = "{:.2f}".format(qty_dec).rjust(8)

    return f"{ean_str}{name_str}{price_str}{qty_str}\n"

# =============================================================================
# HLAVNÁ LOGIKA
# =============================================================================

def run_import(cursor):
    """Import zo ZASOBA.CSV -> DB."""
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

        # Použijeme REPLACE alebo INSERT ... ON DUPLICATE KEY UPDATE
        # Pre istotu v tomto pripade INSERT ... ON DUPLICATE
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
    """Export DB -> VYROBKY.CSV (Smart Pricing)."""
    logger.info(f"Začínam export do {FILE_EXPORT}...")

    # Logika cien: 1. Výroba, 2. Importovaná nákupná cena, 3. Nula
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
                # row je tuple alebo dictionary podla nastavenia db_connector
                # Predpokladáme tuple (ean, nazov, qty, price)
                # Ak db_connector vracia dict, upravíme prístup
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

def main():
    parser = argparse.ArgumentParser(description='Synchronizácia ERP.')
    parser.add_argument('--mode', required=True, choices=['import', 'export'])
    args = parser.parse_args()

    conn = None
    cursor = None
    
    try:
        # Použitie existujúceho konektora
        conn = db_connector.get_connection()
        
        if conn.is_connected():
            # Start transaction
            conn.start_transaction()
            cursor = conn.cursor() # default tuple cursor

            if args.mode == 'import':
                run_import(cursor)
            elif args.mode == 'export':
                run_export(cursor)

            conn.commit()
            logger.info("Transakcia potvrdená (COMMIT).")
        else:
            logger.error("Nepodarilo sa pripojiť k DB cez db_connector.")

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