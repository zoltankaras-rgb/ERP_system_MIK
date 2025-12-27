import db_connector
from datetime import datetime
import os
import csv
import traceback
from pathlib import Path

# =================================================================
# === MODUL PRE INTEGRÁCIU S EXTERNÝMI SYSTÉMAMI ===
# =================================================================

# --- KONFIGURÁCIA ---
# Načítame cestu z .env premennej ERP_EXCHANGE_DIR (nastavené na serveri)
# Ak by náhodou nebola nastavená, použije sa default /var/app/data/erp_exchange
env_path = os.getenv("ERP_EXCHANGE_DIR", "/var/app/data/erp_exchange")
BASE_PATH = Path(env_path)

# Exportujeme a importujeme priamo v hlavnej zložke (kde vidíte aj ostatné CSV)
EXPORT_FOLDER = BASE_PATH
IMPORT_FOLDER = BASE_PATH


def generate_daily_receipt_export(export_date_str=None):
    """
    Vygeneruje CSV súbor (VYROBKY.CSV) s denným príjmom finálnych produktov.
    Súbor obsahuje EAN a celkové prijaté množstvo za deň.
    Túto funkciu volá app.py pri ukončení dňa v expedícii.
    """
    try:
        export_date = export_date_str or datetime.now().strftime('%Y-%m-%d')

        # Získa dáta z databázy pre daný deň
        # Hľadáme iba položky, ktoré boli práve prepnuté do stavu 'Ukončené' v daný deň
        query = """
            SELECT p.ean, zv.realne_mnozstvo_kg, zv.realne_mnozstvo_ks, p.mj as unit 
            FROM zaznamy_vyroba zv
            LEFT JOIN produkty p ON zv.nazov_vyrobku = p.nazov_vyrobku
            WHERE zv.stav = 'Ukončené' AND DATE(zv.datum_ukoncenia) = %s
        """
        records = db_connector.execute_query(query, (export_date,))

        if not records:
            return {"message": f"Pre dátum {export_date} neboli nájdené žiadne ukončené výroby na export.", "file_path": None}

        # Zoskupí dáta podľa EAN, aby sa sčítali rovnaké produkty
        consolidated = {}
        for r in records:
            if not r.get('ean'): continue
            
            ean = r['ean']
            if ean not in consolidated:
                consolidated[ean] = 0
            
            qty_to_add = float(r.get('realne_mnozstvo_ks') or 0.0) if r.get('unit') == 'ks' else float(r.get('realne_mnozstvo_kg') or 0.0)
            consolidated[ean] += qty_to_add
        
        # Vytvorí priečinok, ak neexistuje
        os.makedirs(EXPORT_FOLDER, exist_ok=True)
        
        # Názov súboru presne podľa požiadavky
        file_name = "VYROBKY.CSV"
        file_path = EXPORT_FOLDER / file_name

        # Zapíše dáta do CSV súboru s kódovaním vhodným pre Slovensko (cp1250)
        with open(file_path, 'w', newline='', encoding='cp1250') as csvfile:
            writer = csv.writer(csvfile, delimiter=';')
            writer.writerow(['EAN', 'Mnozstvo'])  # Hlavička súboru
            for ean, quantity in consolidated.items():
                # Formátujeme číslo s desatinnou čiarkou (slovenský formát)
                writer.writerow([ean, f"{quantity:.2f}".replace('.', ',')])
        
        return {"message": f"Exportný súbor bol úspešne vygenerovaný: {file_path}", "file_path": str(file_path)}
    except Exception as e:
        print(f"!!! CHYBA pri generovaní exportu: {traceback.format_exc()}")
        return {"error": f"Nastala chyba pri zápise súboru: {e}"}


def process_stock_update_import():
    """
    Spracuje importný CSV súbor so stavom skladu finálnych produktov.
    Očakáva súbor `sklad.csv` v importnom priečinku.
    (Poznámka: Ak používate ZASOBA.CSV cez iný skript, táto funkcia sa možno nepoužíva, ale je opravená pre istotu)
    """
    try:
        file_path = IMPORT_FOLDER / 'sklad.csv'

        if not os.path.exists(file_path):
            return {"error": f"Importný súbor nebol nájdený na ceste: {file_path}"}
        
        updates_to_catalog = []
        with open(file_path, 'r', newline='', encoding='cp1250') as csvfile:
            reader = csv.reader(csvfile, delimiter=';')
            next(reader)  # Preskočí hlavičku
            for row in reader:
                if len(row) == 2:
                    ean, quantity_str = row
                    quantity = float(quantity_str.replace(',', '.'))
                    updates_to_catalog.append((quantity, ean))

        if not updates_to_catalog:
            return {"message": "Importný súbor neobsahoval žiadne platné dáta."}

        # Aktualizuje databázu v jednej hromadnej operácii
        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = %s WHERE ean = %s",
            updates_to_catalog,
            fetch='none',
            multi=True
        )
        
        return {"message": f"Sklad bol úspešne aktualizovaný. Počet aktualizovaných produktov: {len(updates_to_catalog)}."}
    
    except Exception as e:
        print(f"!!! CHYBA pri spracovaní importu: {traceback.format_exc()}")
        return {"error": f"Nastala chyba pri spracovaní importného súboru: {e}"}