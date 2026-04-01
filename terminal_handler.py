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
            # 1. POKUS: Hľadáme podľa názvu súboru (funguje pre štandardné B2B)
            search_pattern = "%" + base_name.replace('_', '-') + "%"
            order_db = db_connector.execute_query(
                "SELECT id, cislo_objednavky FROM b2b_objednavky WHERE cislo_objednavky LIKE %s LIMIT 1", 
                (search_pattern,), fetch="one"
            )
            
            # 2. POKUS: Ak terminál premenoval súbor (ako pri COOP EDI), čítame hlavičku CSV
            if not order_db:
                with open(file_path, mode='r', encoding='cp1250', errors='replace') as f:
                    lines = f.readlines()
                    
                first_line = lines[0] if lines else ""
                
                # Overíme, či je to hlavička (nezačína medzerami a má bodkočiarky)
                if first_line and not first_line.startswith("  ") and ";" in first_line:
                    parts = first_line.strip().split(";")
                    cust_id = parts[-1].strip() # Vytiahne ID zákazníka z konca hlavičky
                    
                    # SMART MATCHING: Identifikujeme správnu objednávku podľa toho, aký tovar je v súbore
                    vzorka_ean = None
                    for line in lines:
                        if line.startswith("  ") and len(line) >= 127:
                            ean_kandidat = line[2:15].strip()
                            if ean_kandidat:
                                vzorka_ean = ean_kandidat
                                break
                    
                    if vzorka_ean:
                        ean_clean = vzorka_ean.lstrip('0') if vzorka_ean.lstrip('0') != '' else vzorka_ean
                        
                        # Preklad z EDI EAN na interný EAN
                        interny_ean = None
                        try:
                            map_db = db_connector.execute_query("""
                                SELECT interny_ean FROM edi_produkty_mapovanie 
                                WHERE edi_ean = %s OR edi_ean = %s LIMIT 1
                            """, (vzorka_ean, ean_clean), fetch="one")
                            if map_db:
                                interny_ean = map_db["interny_ean"]
                        except Exception:
                            pass 
                            
                        hladany_ean = interny_ean if interny_ean else vzorka_ean
                        hladany_clean = interny_ean.lstrip('0') if interny_ean and interny_ean.lstrip('0') != '' else ean_clean

                        # Hľadáme objednávku pre tohto zákazníka, ktorá REÁLNE OBSAHUJE TENTO TOVAR
                        order_db = db_connector.execute_query(
                            """
                            SELECT DISTINCT o.id, o.cislo_objednavky 
                            FROM b2b_objednavky o
                            JOIN b2b_objednavky_polozky pol ON o.id = pol.objednavka_id
                            WHERE o.zakaznik_id = %s 
                              AND (
                                  o.stav IN ('Nová', 'Prijatá') 
                                  OR (o.stav = 'Hotová' AND DATE(o.pozadovany_datum_dodania) >= CURDATE() - INTERVAL 2 DAY)
                              )
                              AND (pol.ean_produktu = %s OR pol.ean_produktu = %s OR pol.ean_produktu LIKE %s)
                            ORDER BY o.id DESC LIMIT 1
                            """,
                            (cust_id, hladany_ean, hladany_clean, f"%{hladany_clean}%"), fetch="one"
                        )

                    # Záchranné koleso, ak by EAN matching predsa len zlyhal (zoberie poslednú otvorenú)
                    if not order_db:
                        order_db = db_connector.execute_query(
                            """
                            SELECT id, cislo_objednavky 
                            FROM b2b_objednavky 
                            WHERE zakaznik_id = %s 
                              AND (
                                  stav IN ('Nová', 'Prijatá') 
                                  OR (stav = 'Hotová' AND DATE(pozadovany_datum_dodania) >= CURDATE() - INTERVAL 2 DAY)
                              )
                            ORDER BY id DESC LIMIT 1
                            """,
                            (cust_id,), fetch="one"
                        )
            
            if not order_db:
                print(f"Chyba: Objednávka pre súbor '{filename}' nenájdená ani podľa názvu, ani podľa zákazníka a EAN!")
                dest_path = os.path.join(TERMINAL_ERROR_DIR, filename)
                if os.path.exists(dest_path):
                    dest_path = os.path.join(TERMINAL_ERROR_DIR, f"{base_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}.csv")
                shutil.move(file_path, dest_path)
                continue
                
            order_id = order_db["id"]
            db_cislo = order_db["cislo_objednavky"]
            print(f"Nájdená objednávka: ID {order_id} (Číslo v DB: {db_cislo})")
            
            # PREDNAČÍTANIE CIEN pre lepšie odstrihnutie váhy (z predchádzajúcej opravy)
            order_items_db = db_connector.execute_query(
                "SELECT ean_produktu, cena_bez_dph FROM b2b_objednavky_polozky WHERE objednavka_id = %s",
                (order_id,), fetch="all"
            ) or []
            
            prices_map = {}
            for item in order_items_db:
                if item.get("ean_produktu"):
                    ean_key = str(item["ean_produktu"]).lstrip('0')
                    cena_float = float(item['cena_bez_dph'] or 0)
                    cena_dot = f"{cena_float:.2f}"
                    cena_comma = cena_dot.replace('.', ',')
                    prices_map[ean_key] = {"dot": cena_dot, "comma": cena_comma}
                
            with open(file_path, mode='r', encoding='cp1250', errors='replace') as f:
                lines = f.readlines()
            
            for line in lines:
                if not line.startswith("  ") or len(line) < 127:
                    continue
                    
                ean = line[2:15].strip()
                if not ean:
                    continue
                    
                ean_clean = ean.lstrip('0') if ean.lstrip('0') != '' else ean
                
                interny_ean = None
                try:
                    map_db = db_connector.execute_query("""
                        SELECT interny_ean FROM edi_produkty_mapovanie 
                        WHERE edi_ean = %s OR edi_ean = %s LIMIT 1
                    """, (ean, ean_clean), fetch="one")
                    if map_db: interny_ean = map_db["interny_ean"]
                except Exception:
                    pass 
                    
                hladany_ean = interny_ean if interny_ean else ean
                hladany_clean = interny_ean.lstrip('0') if interny_ean and interny_ean.lstrip('0') != '' else ean_clean
                
                expected_prices = prices_map.get(hladany_clean) or prices_map.get(ean_clean) or {}
                price_dot = expected_prices.get("dot", "")
                price_comma = expected_prices.get("comma", "")
                
                tail = line[105:].strip()
                
                if price_comma and tail.endswith(price_comma):
                    weight_str = tail[:-len(price_comma)].strip()
                elif price_dot and tail.endswith(price_dot):
                    weight_str = tail[:-len(price_dot)].strip()
                else:
                    weight_str = line[117:127].strip()

                weight_str = weight_str.replace(',', '.')
                weight_str = weight_str.replace(' ', '')
                
                try:
                    real_weight = float(weight_str)
                except ValueError:
                    real_weight = 0.0
                
                db_connector.execute_query("""
                    UPDATE b2b_objednavky_polozky 
                    SET dodane_mnozstvo = %s 
                    WHERE objednavka_id = %s AND (
                        ean_produktu = %s OR 
                        ean_produktu = %s OR
                        ean_produktu LIKE %s
                    )
                """, (real_weight, order_id, hladany_ean, hladany_clean, f"%{hladany_clean}%"), fetch="none")
            
            sum_db = db_connector.execute_query("""
                SELECT SUM(COALESCE(dodane_mnozstvo, mnozstvo) * cena_bez_dph) as suma_bez_dph 
                FROM b2b_objednavky_polozky 
                WHERE objednavka_id = %s
            """, (order_id,), fetch="one")
            
            finalna_suma_bez_dph = float(sum_db.get("suma_bez_dph") or 0) if sum_db else 0.0
            finalna_suma_s_dph = finalna_suma_bez_dph * 1.20 
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            db_connector.execute_query("""
                UPDATE b2b_objednavky 
                SET stav = 'Hotová', 
                    datum_vypracovania = %s,
                    finalna_suma = %s
                WHERE id = %s
            """, (now_str, finalna_suma_s_dph, order_id), fetch="none")
            
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