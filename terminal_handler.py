import os
import glob
import shutil
from datetime import datetime
from flask import Blueprint
import db_connector
import time
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
        
        # --- OCHRANA PRED NEKOMPLETNÝMI SÚBORMI ---
        try:
            velkost_pred = os.path.getsize(file_path)
            time.sleep(1.5) # Počká 1.5 sekundy
            velkost_po = os.path.getsize(file_path)
            if velkost_pred != velkost_po or velkost_po == 0:
                print(f"Súbor {filename} sa ešte nahráva z terminálu, preskakujem ho pre ďalšie kolo.")
                continue
        except Exception:
            continue

        base_name = os.path.splitext(filename)[0]
        print(f">>> [TERMINAL] Začínam spracovávať: {filename}")
        
        try:
            # 1. POKUS: Hľadáme podľa názvu súboru (funguje pre štandardné B2B)
            search_pattern = "%" + base_name.replace('_', '-') + "%"
            order_db = db_connector.execute_query(
                "SELECT id, cislo_objednavky FROM b2b_objednavky WHERE cislo_objednavky LIKE %s LIMIT 1", 
                (search_pattern,), fetch="one"
            )
            
            # 2. POKUS: Ak ide o COOP/EDI formát (XXX_YYYYYYYY.csv)
            if not order_db:
                with open(file_path, mode='r', encoding='cp1250', errors='replace') as f:
                    lines = f.readlines()
                    
                first_line = lines[0] if lines else ""
                
                if first_line and not first_line.startswith("  ") and ";" in first_line:
                    parts = [p.strip() for p in first_line.split(";")]
                    cust_id = next((p for p in reversed(parts) if p), "")
                    
                    # Extrakcia kódu pobočky z názvu súboru (napr. '022' z '022_43489684.csv')
                    branch_code = base_name.split('_')[0] if '_' in base_name else ""
                    
                    # Získanie všetkých EAN kódov z lístka
                    vsetky_eany = set()
                    for line in lines:
                        if line.startswith("  ") and len(line) >= 127:
                            ean_kand = line[2:15].strip()
                            if ean_kand:
                                vsetky_eany.add(ean_kand)
                    
                    # HLAVNÁ OPRAVA: Prepojíme si tabuľku zákazníkov a pýtame sa priamo na 'cislo_prevadzky'
                    kandidati_objednavky = db_connector.execute_query(
                        """
                        SELECT o.id, o.cislo_objednavky 
                        FROM b2b_objednavky o
                        LEFT JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
                        WHERE (o.zakaznik_id = %s OR o.zakaznik_id = %s OR z.cislo_prevadzky = %s)
                          AND (
                              o.stav IN ('Nová', 'Prijatá') 
                              OR (o.stav = 'Hotová' AND DATE(o.pozadovany_datum_dodania) >= CURDATE() - INTERVAL 2 DAY)
                          )
                        ORDER BY o.id DESC
                        """,
                        (cust_id, branch_code, branch_code), 
                        fetch="all"
                    ) or []
                    
                    # SMART MATCHING: Prejdeme všetky nájdené objednávky a vyberieme tú, 
                    # v ktorej sa nachádza aspoň jeden tovar z tohto lístka. 
                    for o in kandidati_objednavky:
                        polozky_db = db_connector.execute_query(
                            "SELECT ean_produktu FROM b2b_objednavky_polozky WHERE objednavka_id = %s",
                            (o["id"],), fetch="all"
                        ) or []
                        
                        db_eans = [str(p["ean_produktu"]).strip() for p in polozky_db if p.get("ean_produktu")]
                        db_eans_clean = [e.lstrip('0') for e in db_eans]
                        
                        zhoda = False
                        for f_ean in vsetky_eany:
                            f_ean_clean = f_ean.lstrip('0')
                            
                            mapped_ean = None
                            try:
                                map_db = db_connector.execute_query(
                                    "SELECT interny_ean FROM edi_produkty_mapovanie WHERE edi_ean = %s OR edi_ean = %s LIMIT 1",
                                    (f_ean, f_ean_clean), fetch="one"
                                )
                                if map_db: mapped_ean = str(map_db["interny_ean"]).strip()
                            except:
                                pass
                                
                            check_list = [f_ean, f_ean_clean]
                            if mapped_ean:
                                check_list.extend([mapped_ean, mapped_ean.lstrip('0')])
                                
                            for c in check_list:
                                if c in db_eans or c in db_eans_clean:
                                    zhoda = True
                                    break
                            
                            if zhoda: break
                            
                        if zhoda:
                            order_db = o
                            break
                            
                    # Záchranné koleso
                    if not order_db and kandidati_objednavky:
                        order_db = kandidati_objednavky[0]
            
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
            
            # PREDNAČÍTANIE CIEN
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
                    # 1. Skúsime nájsť v EDI tabuľke
                    map_db = db_connector.execute_query("""
                        SELECT interny_ean FROM edi_produkty_mapovanie 
                        WHERE edi_ean = %s OR edi_ean = %s LIMIT 1
                    """, (ean, ean_clean), fetch="one")
                    
                    # 2. Ak sa nenašlo, skúsime nájsť v B2B tabuľke (toto opraví chýbajúce váhy pre B2B!)
                    if not map_db:
                        map_db = db_connector.execute_query("""
                            SELECT interny_ean FROM b2b_ean_mapovanie 
                            WHERE objednavkovy_kod = %s OR objednavkovy_kod = %s LIMIT 1
                        """, (ean, ean_clean), fetch="one")
                        
                    if map_db: 
                        interny_ean = str(map_db["interny_ean"]).strip()
                except Exception as err:
                    print(f"Chyba pri EAN mapovaní: {err}")
                    
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
                SELECT SUM(
                    COALESCE(pol.dodane_mnozstvo, pol.mnozstvo) * pol.cena_bez_dph * (1 + COALESCE(p.dph, pol.dph, 20) / 100.0)
                ) as suma_s_dph 
                FROM b2b_objednavky_polozky pol
                LEFT JOIN produkty p ON p.ean = pol.ean_produktu
                WHERE pol.objednavka_id = %s
            """, (order_id,), fetch="one")
            
            finalna_suma_s_dph = float(sum_db.get("suma_s_dph") or 0) if sum_db else 0.0
            now_str = datetime.now()
            
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