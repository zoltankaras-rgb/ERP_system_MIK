# expedition_board_handler.py
import db_connector
from datetime import datetime, date, timedelta

def get_b2b_special_notes():
    # 1. Vypočítame cieľový dátum (ďalší pracovný deň)
    dnes = date.today()
    
    if dnes.weekday() == 4: # Piatok
        cielovy_datum = dnes + timedelta(days=3)
    elif dnes.weekday() == 5: # Sobota
        cielovy_datum = dnes + timedelta(days=2)
    else: # Nedeľa až Štvrtok
        cielovy_datum = dnes + timedelta(days=1)
        
    cielovy_datum_str = cielovy_datum.strftime('%Y-%m-%d')
    cielovy_datum_sk = cielovy_datum.strftime('%d.%m.%Y')

    # 2. Vytiahneme objednávky s DÁTUMOM DODANIA a TRASOU
    sql = """
        SELECT 
            o.cislo_objednavky AS id_objednavky,
            z.nazov_firmy AS zakaznik,
            z.stala_poznamka_expedicia AS trvala_poznamka,
            o.poznamka AS poznamka_objednavky,
            o.pozadovany_datum_dodania AS datum_dodania,
            COALESCE(t.nazov, 'Nezaradené') AS trasa_nazov
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.stav NOT IN ('Hotová', 'Zrušená', 'Expedovaná')
          AND z.typ = 'B2B'
          AND o.pozadovany_datum_dodania = %s
          AND (
              (o.poznamka IS NOT NULL AND TRIM(o.poznamka) != '') OR 
              (z.stala_poznamka_expedicia IS NOT NULL AND TRIM(z.stala_poznamka_expedicia) != '')
          )
        ORDER BY ISNULL(t.id), t.nazov ASC, z.trasa_poradie ASC, z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, (cielovy_datum_str,), fetch='all') or []
    
    for r in rows:
        d = r.get('datum_dodania')
        if isinstance(d, (datetime, date)):
            r['datum_dodania'] = d.strftime('%d.%m.%Y')
            
    # 3. Vytiahneme globálny oznam z tabuľky system_settings
    oznam_row = db_connector.execute_query(
        "SELECT hodnota FROM system_settings WHERE kluc = 'expedicia_globalny_oznam'", 
        fetch='one'
    )
    global_note = oznam_row['hodnota'] if oznam_row and oznam_row.get('hodnota') else ""

    # 4. AKCIE COOP JEDNOTA (Striktne iba pre cieľový dátum!)
    akcie_coop = []
    try:
        # Použijeme <= pre start_date a >= pre end_date (s poistkou pre NULL)
        sql_akcie = """
            SELECT p.product_name 
            FROM b2b_promotions p
            JOIN b2b_retail_chains c ON p.chain_id = c.id
            WHERE LOWER(c.name) LIKE '%coop%'
              AND p.start_date <= %s
              AND (p.end_date >= %s OR p.end_date IS NULL)
              AND c.is_active = 1
        """
        # Posielame cielovy_datum_str dvakrát (pre start_date aj end_date podmienku)
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