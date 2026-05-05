# expedition_board_handler.py
import os
import time

os.environ['TZ'] = 'Europe/Bratislava'
if hasattr(time, 'tzset'):
    time.tzset()

import db_connector
from datetime import datetime, date, timedelta

def get_b2b_special_notes():
    dnes = date.today()
    
    # Základný posun pre ďalší deň
    if dnes.weekday() == 4: # Piatok
        cielovy_datum = dnes + timedelta(days=3)
    elif dnes.weekday() == 5: # Sobota
        cielovy_datum = dnes + timedelta(days=2)
    else: # Nedeľa až Štvrtok
        cielovy_datum = dnes + timedelta(days=1)
        
    # --- DYNAMICKÁ KONTROLA SVIATKOV A VÍKENDOV ---
    # Bude posúvať dátum dopredu, kým nenájde bežný pracovný deň
    while True:
        posun_nastal = False
        
        # Ak by to padlo na Sobotu (5) alebo Nedeľu (6), posuň na Pondelok
        if cielovy_datum.weekday() == 5:
            cielovy_datum += timedelta(days=2)
            posun_nastal = True
        elif cielovy_datum.weekday() == 6:
            cielovy_datum += timedelta(days=1)
            posun_nastal = True
            
        # Ak je to Sviatok zaznamenaný v kalendári, posuň o 1 deň
        if is_holiday(cielovy_datum):
            cielovy_datum += timedelta(days=1)
            posun_nastal = True
            
        # Ak sme v tomto cykle nemuseli robiť žiadny posun, máme finálny pracovný deň
        if not posun_nastal:
            break
    # ----------------------------------------------

    cielovy_datum_str = cielovy_datum.strftime('%Y-%m-%d')
    cielovy_datum_sk = cielovy_datum.strftime('%d.%m.%Y')

    sql = """
        SELECT 
            COALESCE(t.nazov, 'Nezaradené') AS trasa_nazov,
            z.cislo_prevadzky,
            z.nazov_firmy AS zakaznik,
            COALESCE(z.adresa_dorucenia, z.adresa, '') AS adresa,
            z.stala_poznamka_expedicia AS trvala_poznamka,
            o.cislo_objednavky AS id_objednavky,
            o.poznamka AS poznamka_objednavky,
            o.poznamka_veduceho,
            o.stav,
            
            -- OPRAVA: Ťahá bežnú poznámku AJ poznámku vedúcej k samotným položkám
            -- (Ak máš stĺpec nazvaný inak ako poznamka_veducej_vyroby, uprav si názov)
            (SELECT GROUP_CONCAT(CONCAT(nazov_vyrobku, ': ', COALESCE(poznamka, ''), ' ', COALESCE(poznamka_veducej_vyroby, '')) SEPARATOR ' | ') 
             FROM b2b_objednavky_polozky 
             WHERE objednavka_id = o.id 
               AND (poznamka IS NOT NULL OR poznamka_veducej_vyroby IS NOT NULL) 
               AND (poznamka != '' OR poznamka_veducej_vyroby != '')) AS poznamka_poloziek,
             
            (SELECT GROUP_CONCAT(DISTINCT CONCAT(pol.nazov_vyrobku, ' ', (ROUND(COALESCE(pol.dodane_mnozstvo, pol.mnozstvo), 2) + 0), ' ', pol.mj) SEPARATOR ' | ')
             FROM b2b_objednavky_polozky pol
             LEFT JOIN produkty pr ON pr.nazov_vyrobku = pol.nazov_vyrobku
             WHERE pol.objednavka_id = o.id 
               AND (LOWER(pr.predajna_kategoria) LIKE '%%mrazen%%' OR LOWER(pol.nazov_vyrobku) LIKE '%%mrazen%%')
            ) AS mrazene_polozky,

            (SELECT COALESCE(SUM(
                CASE 
                    WHEN LOWER(mj) = 'ks' THEN COALESCE(dodane_mnozstvo, mnozstvo) * (COALESCE(vaha_balenia_g, 0) / 1000.0)
                    ELSE COALESCE(dodane_mnozstvo, mnozstvo) 
                END
            ), 0) FROM b2b_objednavky_polozky WHERE objednavka_id = o.id) AS celkova_vaha_kg,
            1 AS ma_objednavku
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.stav != 'Zrušená'
          AND z.typ = 'B2B'
          -- OPRAVA: DATE() zabezpečí, že nájde objednávku aj keď má uložený časový údaj
          AND DATE(o.pozadovany_datum_dodania) = %s
        ORDER BY ISNULL(t.id), t.nazov ASC, z.trasa_poradie ASC, z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, (cielovy_datum_str,), fetch='all') or []
    
    for r in rows:
        weight = float(r.get('celkova_vaha_kg') or 0)
        r['vaha_kg'] = weight
        
        # Spojenie hlavnej poznámky s poznámkami k jednotlivým položkám
        po = r.get('poznamka_objednavky') or ""
        pp = r.get('poznamka_poloziek') or ""
        if pp:
            r['poznamka_objednavky'] = f"{po} | Špecifické: {pp}" if po else f"Špecifické: {pp}"
            
        if weight >= 100:
            r['vaha_kategoria'] = 'velka'
        elif weight >= 50:
            r['vaha_kategoria'] = 'stredna'
        else:
            r['vaha_kategoria'] = 'mala'
            
    oznam_row = db_connector.execute_query(
        "SELECT hodnota FROM system_settings WHERE kluc = 'expedicia_globalny_oznam'", 
        fetch='one'
    )
    global_note = oznam_row['hodnota'] if oznam_row and oznam_row.get('hodnota') else ""

    akcie_coop = []
    try:
        sql_akcie = """
            SELECT p.product_name 
            FROM b2b_promotions p
            JOIN b2b_retail_chains c ON p.chain_id = c.id
            WHERE LOWER(c.name) LIKE '%%coop%%'
              AND p.start_date <= %s
              AND (p.end_date >= %s OR p.end_date IS NULL)
              AND c.is_active = 1
        """
        akcie_rows = db_connector.execute_query(sql_akcie, (cielovy_datum_str, cielovy_datum_str), fetch='all') or []
        akcie_coop = [r['product_name'] for r in akcie_rows if r.get('product_name')]
    except Exception as e:
        print(f"Chyba pri načítaní akcií z DB: {e}")
            
    return {
        "cielovy_datum": cielovy_datum_sk,
        "global_note": global_note,
        "akcie_coop": akcie_coop,
        "poznamky": rows
    }

def is_holiday(check_date):
    """
    Overí v databáze kalendára, či je na daný deň naplánovaný sviatok (HOLIDAY).
    """
    date_str = check_date.strftime('%Y-%m-%d')
    
    sql = """
        SELECT id FROM calendar_events 
        WHERE type = 'HOLIDAY' 
          AND DATE(start_at) <= %s 
          AND (DATE(end_at) >= %s OR end_at IS NULL)
          AND is_deleted = 0
          AND status != 'CANCELLED'
    """
    row = db_connector.execute_query(sql, (date_str, date_str), fetch='one')
    return bool(row)