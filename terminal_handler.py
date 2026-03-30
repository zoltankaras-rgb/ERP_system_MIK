import os
import glob
import shutil
from datetime import datetime
from flask import Blueprint, jsonify
import db_connector

# Vytvoríme blueprint pre tento modul
terminal_bp = Blueprint("terminal", __name__)

# Nastavenie zložiek (ak bežíte na serveri, uistite sa, že aplikácia tam má právo zápisu)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TERMINAL_IMPORT_DIR = os.getenv("TERMINAL_IMPORT_DIR", os.path.join(BASE_DIR, "static", "vyprobjed"))
TERMINAL_PROCESSED_DIR = os.path.join(TERMINAL_IMPORT_DIR, "spracovane")

def ensure_directories():
    os.makedirs(TERMINAL_IMPORT_DIR, exist_ok=True)
    os.makedirs(TERMINAL_PROCESSED_DIR, exist_ok=True)

def parse_float(val_str):
    """Pomocná funkcia na bezpečný prevod textu na číslo (zvládne bodku aj čiarku)"""
    if not val_str or not val_str.strip(): 
        return 0.0
    try:
        return float(val_str.strip().replace(',', '.'))
    except ValueError:
        return 0.0

@terminal_bp.route('/api/kancelaria/terminal/sync', methods=['POST'])
# @login_required(role=('kancelaria', 'veduci', 'admin')) # Odkomentujte po úspešnom teste
def sync_terminal_orders():
    ensure_directories()
    
    # Hľadáme všetky .csv súbory
    csv_files = glob.glob(os.path.join(TERMINAL_IMPORT_DIR, "*.[cC][sS][vV]"))
    if not csv_files:
        return jsonify({"message": "Žiadne nové objednávky z terminálu.", "processed_count": 0})
        
    spracovane_subory = []
    chyby = []
    
    conn = db_connector.get_connection()
    
    for file_path in csv_files:
        filename = os.path.basename(file_path)
        try:
            # Súbory vytvorené v make_csv mali cp1250, tak rovnako ich aj čítame
            with open(file_path, 'r', encoding='cp1250', errors='replace') as f:
                lines = f.readlines()
            
            if len(lines) <= 1:
                chyby.append(f"Súbor {filename} neobsahuje položky.")
                continue
            
            orders_data = {}
            
            # Spracovanie riadkov od indexu 1 (preskočíme hlavičku)
            for line in lines[1:]:
                if len(line) < 127: 
                    continue # Ignorujeme neúplné riadky
                    
                # Extrakcia z fixných pozícií podľa vášho make_csv
                ean = line[2:15].strip()
                cislo_objednavky = line[66:81].strip()
                real_weight_str = line[117:127].strip()
                price_str = line[127:].strip()
                
                real_weight = parse_float(real_weight_str)
                price = parse_float(price_str)
                
                if not cislo_objednavky:
                    continue
                    
                if cislo_objednavky not in orders_data:
                    orders_data[cislo_objednavky] = []
                    
                orders_data[cislo_objednavky].append({
                    "ean": ean,
                    "real_weight": real_weight,
                    "price": price
                })
            
            # Zápis do Databázy
            cur = conn.cursor(dictionary=True)
            for cislo_obj, items in orders_data.items():
                
                # 1. Nájdeme objednávku
                cur.execute("SELECT id FROM b2b_objednavky WHERE cislo_objednavky = %s OR id = %s LIMIT 1", (cislo_obj, cislo_obj))
                obj_row = cur.fetchone()
                
                if not obj_row:
                    chyby.append(f"Objednávka {cislo_obj} sa v DB nenašla.")
                    continue
                    
                obj_id = obj_row["id"]
                finalna_suma = 0.0
                
                for item in items:
                    # 2. Prepíšeme reálne množstvo (predpokladáme stĺpec realne_mnozstvo)
                    cur.execute("""
                        UPDATE b2b_objednavky_polozky 
                        SET realne_mnozstvo = %s 
                        WHERE objednavka_id = %s AND (ean_produktu = %s OR ean_produktu LIKE %s)
                    """, (item["real_weight"], obj_id, item["ean"], f"%{item['ean']}%"))
                    
                    finalna_suma += item["real_weight"] * item["price"]
                
                # 3. Zmeníme stav objednávky a doplníme finálnu sumu
                cur.execute("""
                    UPDATE b2b_objednavky 
                    SET stav = 'Hotová', 
                        datum_vypracovania = NOW(), 
                        finalna_suma = %s
                    WHERE id = %s
                """, (finalna_suma, obj_id))
            
            conn.commit()
            cur.close()
            
            # Presun spracovaného súboru do zložky 'spracovane'
            dest_path = os.path.join(TERMINAL_PROCESSED_DIR, filename)
            if os.path.exists(dest_path):
                name, ext = os.path.splitext(filename)
                dest_path = os.path.join(TERMINAL_PROCESSED_DIR, f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}")
            
            shutil.move(file_path, dest_path)
            spracovane_subory.append(filename)
            
        except Exception as e:
            if conn:
                conn.rollback()
            chyby.append(f"Chyba v súbore {filename}: {str(e)}")

    if conn and conn.is_connected():
        conn.close()

    return jsonify({
        "success": True if not chyby else False,
        "message": f"Spracované súbory: {len(spracovane_subory)}. Chyby: {len(chyby)}.",
        "processed_files": spracovane_subory,
        "errors": chyby
    })