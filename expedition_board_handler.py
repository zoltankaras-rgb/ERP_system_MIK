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

    # 2. Vytiahneme objednávky aj s DÁTUMOM DODANIA
    sql = """
        SELECT 
            o.cislo_objednavky AS id_objednavky,
            z.nazov_firmy AS zakaznik,
            z.stala_poznamka_expedicia AS trvala_poznamka,
            o.poznamka AS poznamka_objednavky,
            o.pozadovany_datum_dodania AS datum_dodania
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        WHERE o.stav NOT IN ('Hotová', 'Zrušená', 'Expedovaná')
          AND z.typ = 'B2B'
          AND o.pozadovany_datum_dodania = %s
          AND (
              (o.poznamka IS NOT NULL AND TRIM(o.poznamka) != '') OR 
              (z.stala_poznamka_expedicia IS NOT NULL AND TRIM(z.stala_poznamka_expedicia) != '')
          )
        ORDER BY z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, (cielovy_datum_str,), fetch='all') or []
    
    # Formátovanie dátumu do tvaru 29.03.2026
    for r in rows:
        d = r.get('datum_dodania')
        if isinstance(d, (datetime, date)):
            r['datum_dodania'] = d.strftime('%d.%m.%Y')
            
    return {
        "cielovy_datum": cielovy_datum_sk,
        "poznamky": rows
    }