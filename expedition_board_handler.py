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
    
    if dnes.weekday() == 4: # Piatok
        cielovy_datum = dnes + timedelta(days=3)
    elif dnes.weekday() == 5: # Sobota
        cielovy_datum = dnes + timedelta(days=2)
    else: # Nedeľa až Štvrtok
        cielovy_datum = dnes + timedelta(days=1)
        
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
            o.stav,
            (SELECT COALESCE(SUM(
                CASE 
                    WHEN LOWER(mj) = 'ks' THEN mnozstvo * (COALESCE(vaha_balenia_g, 0) / 1000.0)
                    ELSE mnozstvo 
                END
            ), 0) FROM b2b_objednavky_polozky WHERE objednavka_id = o.id) AS celkova_vaha_kg,
            1 AS ma_objednavku
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.stav != 'Zrušená'
          AND z.typ = 'B2B'
          AND o.pozadovany_datum_dodania = %s
        ORDER BY ISNULL(t.id), t.nazov ASC, z.trasa_poradie ASC, z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, (cielovy_datum_str,), fetch='all') or []
    
    for r in rows:
        weight = float(r.get('celkova_vaha_kg') or 0)
        r['vaha_kg'] = weight
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
            WHERE LOWER(c.name) LIKE '%coop%'
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