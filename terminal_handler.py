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
        print(f">>> [TERMINAL] Začínam spracovávať: {filename}")
        
        try:
            # 1. Vytiahneme ID objednávky rovno z názvu súboru (000004_... -> 4)
            try:
                order_id = int(filename.split('_')[0])
            except ValueError:
                print(f"Preskakujem: Neplatný názov súboru {filename}")
                continue
            
            # 2. Overíme, či objednávka existuje
            order_db = db_connector.execute_query(
                "SELECT id FROM b2b_objednavky WHERE id = %s", (order_id,), fetch="one"
            )
            
            if not order_db:
                print(f"Chyba: Objednávka s ID {order_id} neexistuje v databáze!")
                continue
                
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
                    
                # 3. Orežeme nuly z exportu (0000000232360 -> 232360)
                ean_clean = ean.lstrip('0') if ean.lstrip('0') != '' else ean
                
                # 4. Zápis reálnej váhy
                db_connector.execute_query("""
                    UPDATE b2b_objednavky_polozky 
                    SET mnozstvo = %s 
                    WHERE objednavka_id = %s AND (ean_produktu = %s OR ean_produktu = %s)
                """, (real_weight, order_id, ean, ean_clean), fetch="none")
            
            # 5. Prepočet finálnej sumy
            sum_db = db_connector.execute_query("""
                SELECT SUM(mnozstvo * cena_bez_dph) as suma_bez_dph 
                FROM b2b_objednavky_polozky 
                WHERE objednavka_id = %s
            """, (order_id,), fetch="one")
            
            finalna_suma_bez_dph = float(sum_db.get("suma_bez_dph") or 0) if sum_db else 0.0
            finalna_suma_s_dph = finalna_suma_bez_dph * 1.20 
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # 6. KONEČNÁ ZMENA STAVU NA HOTOVÁ
            db_connector.execute_query("""
                UPDATE b2b_objednavky 
                SET stav = 'Hotová', 
                    datum_vypracovania = %s,
                    finalna_suma = %s
                WHERE id = %s
            """, (now_str, finalna_suma_s_dph, order_id), fetch="none")
            
            dest_path = os.path.join(TERMINAL_PROCESSED_DIR, filename)
            if os.path.exists(dest_path):
                name, ext = os.path.splitext(filename)
                dest_path = os.path.join(TERMINAL_PROCESSED_DIR, f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}")
                
            shutil.move(file_path, dest_path)
            print(f">>> [TERMINAL] Objednávka {order_id} nastavená na Hotová!")
            
        except Exception as e:
            print(f">>> [TERMINAL] CHYBA pri súbore {filename}: {e}")
            dest_path = os.path.join(TERMINAL_ERROR_DIR, filename)
            shutil.move(file_path, dest_path)