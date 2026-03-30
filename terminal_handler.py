import os
import glob
import shutil
from datetime import datetime
from flask import Blueprint
import db_connector

terminal_bp = Blueprint("terminal", __name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Cesta k zložke, do ktorej padajú dáta zo servera
TERMINAL_IMPORT_DIR = os.getenv("TERMINAL_IMPORT_DIR", os.path.join(BASE_DIR, "static", "vyprobjed"))
TERMINAL_PROCESSED_DIR = os.path.join(TERMINAL_IMPORT_DIR, "spracovane")
TERMINAL_ERROR_DIR = os.path.join(TERMINAL_IMPORT_DIR, "chyby")

def ensure_directories():
    """Zabezpečí vytvorenie potrebných zložiek."""
    os.makedirs(TERMINAL_IMPORT_DIR, exist_ok=True)
    os.makedirs(TERMINAL_PROCESSED_DIR, exist_ok=True)
    os.makedirs(TERMINAL_ERROR_DIR, exist_ok=True)

def process_terminal_files():
    """Funkcia volaná schedulerom každú minútu."""
    ensure_directories()
    
    csv_files = glob.glob(os.path.join(TERMINAL_IMPORT_DIR, "*.[cC][sS][vV]"))
    
    if not csv_files:
        return
        
    for file_path in csv_files:
        filename = os.path.basename(file_path)
        print(f">>> [TERMINAL] Začínam spracovávať: {filename}")
        
        try:
            orders_to_finish = set()
            
            # Terminály často používajú staršie kódovanie, cp1250 je pre Windows/CS ideálne
            with open(file_path, mode='r', encoding='cp1250', errors='replace') as f:
                lines = f.readlines()
            
            for line in lines:
                # 1. Kontrola: Položky vždy začínajú dvoma medzerami, inak je to hlavička
                if not line.startswith("  ") or len(line) < 127:
                    continue
                    
                # 2. Parsovanie pevných pozícií podľa _make_csv
                ean = line[2:15].strip()
                order_number = line[66:81].strip()
                weight_str = line[117:127].strip().replace(',', '.')
                
                # Ak chýba číslo objednávky, nevieme komu položka patrí
                if not order_number or not ean:
                    continue
                    
                try:
                    real_weight = float(weight_str)
                except ValueError:
                    real_weight = 0.0
                    
                orders_to_finish.add(order_number)
                
                # 3. Zistenie ID objednávky v DB a uloženie reálnej váhy
                order_db = db_connector.execute_query(
                    "SELECT id FROM b2b_objednavky WHERE cislo_objednavky = %s LIMIT 1",
                    (order_number,), fetch="one"
                )
                
                if order_db:
                    order_id = order_db["id"]
                    db_connector.execute_query("""
                        UPDATE b2b_objednavky_polozky 
                        SET mnozstvo = %s 
                        WHERE objednavka_id = %s AND ean_produktu = %s
                    """, (real_weight, order_id, ean), fetch="none")
            
            # 4. Prepočet finálnych súm pre všetky dotknuté objednávky
            for order_num in orders_to_finish:
                order_db = db_connector.execute_query(
                    "SELECT id FROM b2b_objednavky WHERE cislo_objednavky = %s LIMIT 1",
                    (order_num,), fetch="one"
                )
                
                if order_db:
                    order_id = order_db["id"]
                    
                    # Spočítame novú sumu
                    sum_db = db_connector.execute_query("""
                        SELECT SUM(mnozstvo * cena_bez_dph) as suma_bez_dph 
                        FROM b2b_objednavky_polozky 
                        WHERE objednavka_id = %s
                    """, (order_id,), fetch="one")
                    
                    finalna_suma_bez_dph = float(sum_db["suma_bez_dph"] or 0)
                    finalna_suma_s_dph = finalna_suma_bez_dph * 1.20 # 20% DPH prepočet
                    
                    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    
                    # Uzavrieme objednávku do stavu Hotová
                    db_connector.execute_query("""
                        UPDATE b2b_objednavky 
                        SET stav = 'Hotová', 
                            datum_vypracovania = %s,
                            finalna_suma = %s
                        WHERE id = %s
                    """, (now_str, finalna_suma_s_dph, order_id), fetch="none")
            
            # 5. Súbor presunieme do "spracovane"
            dest_path = os.path.join(TERMINAL_PROCESSED_DIR, filename)
            if os.path.exists(dest_path): # Ak už existuje s takým menom, pridáme timestamp
                name, ext = os.path.splitext(filename)
                dest_path = os.path.join(TERMINAL_PROCESSED_DIR, f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}")
                
            shutil.move(file_path, dest_path)
            print(f">>> [TERMINAL] Súbor {filename} spracovaný a presunutý.")
            
        except Exception as e:
            print(f">>> [TERMINAL] CHYBA pri súbore {filename}: {e}")
            dest_path = os.path.join(TERMINAL_ERROR_DIR, filename)
            if os.path.exists(dest_path):
                name, ext = os.path.splitext(filename)
                dest_path = os.path.join(TERMINAL_ERROR_DIR, f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}")
            shutil.move(file_path, dest_path)