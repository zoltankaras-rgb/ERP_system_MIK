import db_connector

def ulozit_nakup(data):
    dodavatel = data.get('dodavatel')
    datum = data.get('datum')
    polozky = data.get('polozky', [])
    
    if not dodavatel or not datum or not polozky:
        return {"error": "Dodávateľ, dátum a položky sú povinné."}
        
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        # Vloženie hlavičky objednávky
        cur.execute(
            "INSERT INTO nakupne_objednavky (dodavatel, datum_nakupu, poznamka) VALUES (%s, %s, %s)", 
            (dodavatel, datum, data.get('poznamka', ''))
        )
        obj_id = cur.lastrowid
        
        # Vloženie položiek
        for p in polozky:
            cur.execute(
                "INSERT INTO nakupne_objednavky_polozky (objednavka_id, ean, nazov_produktu, mnozstvo, cena_za_jednotku) VALUES (%s, %s, %s, %s, %s)",
                (obj_id, p.get('ean'), p.get('nazov'), float(p.get('mnozstvo')), float(p.get('cena')))
            )
        conn.commit()
        return {"message": "Nákup bol úspešne zaznamenaný."}
    except Exception as e:
        if conn: conn.rollback()
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected():
            cur.close()
            conn.close()

def historia_nakupov(ean, nazov):
    if not ean and not nazov:
        return {"error": "Zadajte EAN alebo Názov."}
        
    # Vyhľadávanie prioritne podľa EAN, inak podľa názvu
    where_clause = "p.ean = %s" if ean else "p.nazov_produktu LIKE %s"
    param = ean if ean else f"%{nazov}%"
    
    sql = f"""
        SELECT 
            DATE_FORMAT(o.datum_nakupu, '%%Y-%%m-%%d') as date,
            o.dodavatel as supplier,
            p.mnozstvo as qty,
            p.cena_za_jednotku as price
        FROM nakupne_objednavky_polozky p
        JOIN nakupne_objednavky o ON o.id = p.objednavka_id
        WHERE {where_clause}
        ORDER BY o.datum_nakupu ASC
    """
    try:
        rows = db_connector.execute_query(sql, (param,), fetch="all") or []
        return {"history": rows}
    except Exception as e:
        return {"error": str(e)}