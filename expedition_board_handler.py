# expedition_board_handler.py
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

    # PRIDANÉ: Výpočet kg z položiek (celkova_vaha_kg) a kontrola času (datum_objednavky)
    sql = """
        SELECT 
            COALESCE(t.nazov, 'Nezaradené') AS trasa_nazov,
            z.cislo_prevadzky,
            z.nazov_firmy AS zakaznik,
            COALESCE(z.adresa_dorucenia, z.adresa, '') AS adresa,
            z.stala_poznamka_expedicia AS trvala_poznamka,
            o.cislo_objednavky AS id_objednavky,
            o.poznamka AS poznamka_objednavky,
            o.datum_objednavky,
            (SELECT COALESCE(SUM(mnozstvo), 0) FROM b2b_objednavky_polozky WHERE objednavka_id = o.id) AS celkova_vaha_kg,
            1 AS ma_objednavku
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.stav NOT IN ('Hotová', 'Zrušená', 'Expedovaná')
          AND z.typ = 'B2B'
          AND o.pozadovany_datum_dodania = %s
        ORDER BY ISNULL(t.id), t.nazov ASC, z.trasa_poradie ASC, z.nazov_firmy ASC
    """
    
    rows = db_connector.execute_query(sql, (cielovy_datum_str,), fetch='all') or []
    
    # SPRACOVANIE VÝNIMIEK A VÁHY
    for r in rows:
        # 1. Kontrola uzávierky (Ak bola objednávka nahodená o 12:00 a neskôr)
        is_late = False
        if r.get('datum_objednavky'):
            dt = r['datum_objednavky']
            if isinstance(dt, datetime) and dt.hour >= 12:
                is_late = True
            # Serializácia pre JSON
            r['datum_objednavky'] = str(r['datum_objednavky'])
        r['po_uzavierke'] = is_late
        
        # 2. Kategorizácia váhy podľa kg
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