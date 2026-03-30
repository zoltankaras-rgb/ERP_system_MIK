import os
import glob
import shutil
from datetime import datetime
from flask import Blueprint
import db_connector

terminal_bp = Blueprint("terminal", __name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TERMINAL_IMPORT_DIR = os.getenv("TERMINAL_IMPORT_DIR", os.path.join(BASE_DIR, "static", "vyprobjed"))
TERMINAL_PROCESSED_DIR = os.path.join(TERMINAL_IMPORT_DIR, "spracovane")
TERMINAL_ERROR_DIR = os.path.join(TERMINAL_IMPORT_DIR, "chyby")

def ensure_directories():
    os.makedirs(TERMINAL_IMPORT_DIR, exist_ok=True)
    os.makedirs(TERMINAL_PROCESSED_DIR, exist_ok=True)
    os.makedirs(TERMINAL_ERROR_DIR, exist_ok=True)

def process_terminal_files():
    ensure_directories()
    csv_files = glob.glob(os.path.join(TERMINAL_IMPORT_DIR, "*.[cC][sS][vV]"))
    
    if not csv_files:
        return
        
    for file_path in csv_files:
        filename = os.path.basename(file_path)
        base_name = os.path.splitext(filename)[0]
        print(f">>> [TERMINAL] Začínam spracovávať: {filename}")
        
        try:
            # PRISPÔSOBENIE PRE DB: 000004_2026... zmeníme na 000004-2026...
            search_pattern = "%" + base_name.replace('_', '-') + "%"
            
            # Hľadáme pomocou LIKE (nájde to B2B-000004-20260330091344)
            order_db = db_connector.execute_query(
                "SELECT id, cislo_objednavky FROM b2b_objednavky WHERE cislo_objednavky LIKE %s LIMIT 1", 
                (search_pattern,), fetch="one"
            )
            
            if not order_db:
                print(f"Chyba: Objednávka podobná '{base_name}' neexistuje v databáze!")
                dest_path = os.path.join(TERMINAL_ERROR_DIR, filename)
                if os.path.exists(dest_path):
                    dest_path = os.path.join(TERMINAL_ERROR_DIR, f"{base_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv")
                shutil.move(file_path, dest_path)
                continue
                
            order_id = order_db["id"]
            db_cislo = order_db["cislo_objednavky"]
            print(f"Nájdená objednávka: ID {order_id} (Číslo v DB: {db_cislo})")
                
            with open(file_path, mode='r', encoding='cp1250', errors='replace') as f:
                lines = f.readlines()
            
            for line in lines:
                if not line.startswith("  ") or len(line) < 127:
                    continue
                    
                ean = line[2:15].strip()
                weight_str = line[117:127].strip().replace(',', '.')
                
                if not ean:
                    continue
                    
                try:
                    real_weight = float(weight_str)
                except ValueError:
                    real_weight = 0.0
                    
                ean_clean = ean.lstrip('0') if ean.lstrip('0') != '' else ean
                
                # Zápis reálnej váhy
                db_connector.execute_query("""
                    UPDATE b2b_objednavky_polozky 
                    SET mnozstvo = %s 
                    WHERE objednavka_id = %s AND (ean_produktu = %s OR ean_produktu = %s)
                """, (real_weight, order_id, ean, ean_clean), fetch="none")
            
            # Prepočet finálnej sumy
            sum_db = db_connector.execute_query("""
                SELECT SUM(mnozstvo * cena_bez_dph) as suma_bez_dph 
                FROM b2b_objednavky_polozky 
                WHERE objednavka_id = %s
            """, (order_id,), fetch="one")
            
            finalna_suma_bez_dph = float(sum_db.get("suma_bez_dph") or 0) if sum_db else 0.0
            finalna_suma_s_dph = finalna_suma_bez_dph * 1.20 
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # Zmena stavu na Hotová
            db_connector.execute_query("""
                UPDATE b2b_objednavky 
                SET stav = 'Hotová', 
                    datum_vypracovania = %s,
                    finalna_suma = %s
                WHERE id = %s
            """, (now_str, finalna_suma_s_dph, order_id), fetch="none")
            
            # Presun do spracovane
            dest_path = os.path.join(TERMINAL_PROCESSED_DIR, filename)
            if os.path.exists(dest_path):
                dest_path = os.path.join(TERMINAL_PROCESSED_DIR, f"{base_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv")
            shutil.move(file_path, dest_path)
            print(f">>> [TERMINAL] Objednávka '{db_cislo}' úspešne nastavená na Hotová!")
            
        except Exception as e:
            print(f">>> [TERMINAL] CHYBA pri súbore {filename}: {e}")
            base_name = os.path.splitext(filename)[0]
            dest_path = os.path.join(TERMINAL_ERROR_DIR, filename)
            if os.path.exists(dest_path):
                dest_path = os.path.join(TERMINAL_ERROR_DIR, f"{base_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv")
            shutil.move(file_path, dest_path)