import db_connector
from datetime import datetime, date

def get_b2b_special_notes():
    """
    Vytiahne nevybavené B2B objednávky, ktoré majú jednorazovú poznámku 
    alebo má zákazník nastavenú stálu poznámku pre expedíciu.
    """
    # OPRAVA: 
    # 1. Spájame cez z.zakaznik_id namiesto z.id (oba sú varchar(32))
    # 2. Pridaná podmienka AND z.typ = 'B2B' pre istotu
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
          AND (
              (o.poznamka IS NOT NULL AND TRIM(o.poznamka) != '') OR 
              (z.stala_poznamka_expedicia IS NOT NULL AND TRIM(z.stala_poznamka_expedicia) != '')
          )
        ORDER BY o.pozadovany_datum_dodania ASC, z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, fetch='all') or []
    
    # Úprava formátu dátumu pre frontend
    for r in rows:
        d = r.get('datum_dodania')
        if isinstance(d, (datetime, date)):
            r['datum_dodania'] = d.strftime('%d.%m.%Y')
            
    return rows