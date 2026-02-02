import os
import csv
from datetime import datetime
import traceback
from pathlib import Path
import db_connector

# =================================================================
# === MODUL PRE INTEGRÁCIU S EXTERNÝMI SYSTÉMAMI (ERP) ===
# =================================================================

# --- KONFIGURÁCIA ---
# Načítame cestu z .env premennej ERP_EXCHANGE_DIR (nastavené na serveri)
env_path = os.getenv("ERP_EXCHANGE_DIR", "/var/app/data/erp_exchange")
BASE_PATH = Path(env_path)

# Exportujeme a importujeme priamo v hlavnej zložke
EXPORT_FOLDER = BASE_PATH
IMPORT_FOLDER = BASE_PATH

def generate_daily_receipt_export(date_str):
    """
    Vygeneruje súbor VYROBA.CSV pre daný dátum (uzávierka dňa).
    Formát je presne podľa vzoru ZASOBA.CSV:
    Stĺpce: REG_CIS;NAZOV;JCM11;MNOZ
    Hodnoty: EAN na 13 miest, čísla na 4 desatinné miesta.
    """
    
    # 1. Príprava cesty a názvu
    file_name = "VYROBA.CSV"
    file_path = EXPORT_FOLDER / file_name

    # 2. SQL dotaz - Získame sumár príjmov z expedície pre daný deň
    #    Priorita ceny (JCM11): Cena z výroby -> Výrobná cena produktu -> Skladová cena -> 0
    sql = """
        SELECT 
            p.ean AS REG_CIS,
            ep.nazov_vyrobku AS NAZOV,
            COALESCE(zv.cena_za_jednotku, p.vyrobna_cena, p.skladova_cena, 0) AS JCM11,
            p.mj AS MJ,
            SUM(
                CASE 
                    -- Ak je produkt v KS a príjem bol v KS, exportujeme KS
                    WHEN p.mj = 'ks' AND ep.prijem_ks IS NOT NULL AND ep.prijem_ks != 0 THEN ep.prijem_ks
                    -- Inak exportujeme KG (to zahŕňa aj záporné pohyby z krájania)
                    ELSE ep.prijem_kg 
                END
            ) AS MNOZ
        FROM expedicia_prijmy ep
        LEFT JOIN zaznamy_vyroba zv ON ep.id_davky = zv.id_davky
        LEFT JOIN produkty p ON TRIM(ep.nazov_vyrobku) = TRIM(p.nazov_vyrobku)
        WHERE ep.datum_prijmu = %s 
          AND ep.is_deleted = 0
        GROUP BY p.ean, ep.nazov_vyrobku, JCM11, p.mj
        HAVING MNOZ <> 0
    """

    try:
        # Uistíme sa, že priečinok existuje
        os.makedirs(EXPORT_FOLDER, exist_ok=True)

        rows = db_connector.execute_query(sql, (date_str,), fetch='all')
        
        if not rows:
            rows = []

        # 3. Zápis do CSV
        # Kódovanie cp1250 je nutné pre slovenské znaky v starších systémoch
        with open(file_path, mode='w', newline='', encoding='cp1250') as csvfile:
            # Používame delimiter ';' (bodkočiarka) podľa ZASOBA.CSV
            writer = csv.writer(csvfile, delimiter=';', quotechar='"', quoting=csv.QUOTE_MINIMAL)
            
            # Hlavička presne podľa vzoru
            writer.writerow(['REG_CIS', 'NAZOV', 'JCM11', 'MNOZ'])
            
            for r in rows:
                # A) REG_CIS: EAN kód doplnený nulami na 13 miest (ak je to číslo)
                #    Napr. '23112' -> '0000000023112'
                raw_ean = str(r['REG_CIS'] or '').strip()
                if raw_ean.isdigit() and len(raw_ean) > 0 and len(raw_ean) <= 13:
                    reg_cis = raw_ean.zfill(13)
                else:
                    reg_cis = raw_ean
                
                # B) NAZOV
                nazov = str(r['NAZOV'] or '').strip()
                
                # C) JCM11: Cena na 4 desatinné miesta (napr. 3.2500)
                try:
                    price = float(r['JCM11'] or 0)
                    jcm11 = f"{price:.4f}"
                except:
                    jcm11 = "0.0000"
                
                # D) MNOZ: Množstvo na 4 desatinné miesta (napr. 160.0000)
                try:
                    qty = float(r['MNOZ'] or 0)
                    mnoz = f"{qty:.4f}"
                except:
                    mnoz = "0.0000"
                
                # Zapíšeme riadok
                writer.writerow([reg_cis, nazov, jcm11, mnoz])

        print(f">>> Export VYROBA.CSV úspešný: {file_path}")
        return {"success": True, "file_path": str(file_path)}

    except Exception as e:
        print(f"!!! Export Error: {traceback.format_exc()}")
        return {"error": str(e)}

# --- Pôvodná funkcia pre import (ponechaná pre kompatibilitu, ak ju používate) ---
def process_stock_update_import():
    """
    Spracuje importný CSV súbor (sklad.csv) - ak sa používa.
    """
    try:
        file_path = IMPORT_FOLDER / 'sklad.csv'

        if not os.path.exists(file_path):
            return {"error": f"Importný súbor nebol nájdený: {file_path}"}
        
        updates = []
        with open(file_path, 'r', newline='', encoding='cp1250') as csvfile:
            reader = csv.reader(csvfile, delimiter=';')
            next(reader, None)  # Preskočí hlavičku
            for row in reader:
                if len(row) >= 2:
                    ean = row[0]
                    qty_str = row[1].replace(',', '.')
                    try:
                        updates.append((float(qty_str), ean))
                    except: pass

        if not updates:
            return {"message": "Žiadne dáta na import."}

        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = %s WHERE ean = %s",
            updates, fetch='none', multi=True
        )
        
        return {"message": f"Aktualizovaných {len(updates)} produktov."}
    
    except Exception as e:
        return {"error": str(e)}