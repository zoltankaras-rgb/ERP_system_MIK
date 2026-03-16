import db_connector

def _ensure_nakup_schema():
    """Vytvorí schému pre nákupy s podporou stavov bez čísla dokladu."""
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS nakupne_objednavky (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dodavatel VARCHAR(255) NOT NULL,
            datum_vystavenia DATE NOT NULL,
            datum_dodania DATE,
            stav ENUM('Objednané', 'Prijaté', 'Zrušené') DEFAULT 'Objednané',
            celkova_suma_bez_dph DECIMAL(10,2) DEFAULT 0,
            celkova_suma_s_dph DECIMAL(10,2) DEFAULT 0,
            poznamka TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci;
    """, fetch='none')

    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS nakupne_objednavky_polozky (
            id INT AUTO_INCREMENT PRIMARY KEY,
            objednavka_id INT NOT NULL,
            ean VARCHAR(64),
            nazov_produktu VARCHAR(255) NOT NULL,
            mnozstvo DECIMAL(10,3) NOT NULL,
            cena_bez_dph DECIMAL(10,4) NOT NULL,
            dph DECIMAL(5,2) DEFAULT 20.00,
            FOREIGN KEY (objednavka_id) REFERENCES nakupne_objednavky(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci;
    """, fetch='none')

def ulozit_nakup(data):
    _ensure_nakup_schema()
    dodavatel = data.get('dodavatel')
    datum_vystavenia = data.get('datum_vystavenia')
    datum_dodania = data.get('datum_dodania')
    stav = data.get('stav', 'Objednané')
    celkova_suma_bez_dph = data.get('celkova_suma_bez_dph', 0)
    celkova_suma_s_dph = data.get('celkova_suma_s_dph', 0)
    poznamka = data.get('poznamka', '')
    polozky = data.get('polozky', [])
    
    if not dodavatel or not datum_vystavenia or not polozky:
        return {"error": "Dodávateľ, dátum vystavenia a položky sú povinné."}
        
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO nakupne_objednavky 
            (dodavatel, datum_vystavenia, datum_dodania, stav, celkova_suma_bez_dph, celkova_suma_s_dph, poznamka) 
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (dodavatel, datum_vystavenia, datum_dodania, stav, celkova_suma_bez_dph, celkova_suma_s_dph, poznamka))
        obj_id = cur.lastrowid
        
        for p in polozky:
            cur.execute("""
                INSERT INTO nakupne_objednavky_polozky (objednavka_id, ean, nazov_produktu, mnozstvo, cena_bez_dph, dph) 
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (obj_id, p.get('ean'), p.get('nazov'), float(p.get('mnozstvo')), float(p.get('cena_bez_dph')), float(p.get('dph'))))
            
        conn.commit()
        return {"message": f"Záznam bol úspešne uložený v stave '{stav}'."}
    except Exception as e:
        if conn: conn.rollback()
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected():
            cur.close()
            conn.close()

def zmenit_stav_objednavky(data):
    obj_id = data.get('id')
    novy_stav = data.get('stav')
    
    if not obj_id or novy_stav != 'Prijaté':
        return {"error": "Neplatná požiadavka na zmenu stavu."}
        
    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT stav FROM nakupne_objednavky WHERE id = %s", (obj_id,))
        obj = cur.fetchone()
        if not obj or obj['stav'] == 'Prijaté':
            return {"error": "Objednávka už je prijatá alebo neexistuje."}
            
        cur.execute("UPDATE nakupne_objednavky SET stav = 'Prijaté' WHERE id = %s", (obj_id,))
        conn.commit()
        return {"message": "Objednávka bola označená ako Prijatá."}
    except Exception as e:
        if conn: conn.rollback()
        return {"error": str(e)}
    finally:
        if conn and conn.is_connected():
            cur.close()
            conn.close()

def zoznam_objednavok():
    _ensure_nakup_schema()
    sql = """
        SELECT id, dodavatel, DATE_FORMAT(datum_vystavenia, '%%d.%%m.%%Y') as datum_vystavenia, 
               DATE_FORMAT(datum_dodania, '%%d.%%m.%%Y') as datum_dodania, stav, celkova_suma_bez_dph, celkova_suma_s_dph
        FROM nakupne_objednavky
        ORDER BY CASE WHEN stav = 'Objednané' THEN 1 ELSE 2 END, id DESC
        LIMIT 100
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    return {"objednavky": rows}

def get_produkty_autocomplete():
    sql = """
        SELECT ean, nazov_vyrobku as name FROM produkty WHERE nazov_vyrobku IS NOT NULL AND nazov_vyrobku != ''
        UNION
        SELECT ean, nazov as name FROM sklad WHERE nazov IS NOT NULL AND nazov != ''
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    unique_products = {r['name']: r for r in rows}
    return {"products": list(unique_products.values())}

def historia_nakupov(ean, nazov):
    _ensure_nakup_schema()
    if not ean and not nazov:
        return {"error": "Zadajte EAN alebo Názov."}
        
    where_clause = "p.ean = %s" if ean else "p.nazov_produktu LIKE %s"
    param = ean if ean else f"%{nazov}%"
    
    sql = f"""
        SELECT 
            DATE_FORMAT(o.datum_vystavenia, '%%Y-%%m-%%d') as date,
            DATE_FORMAT(o.datum_dodania, '%%d.%%m.%%Y') as delivery_date,
            o.dodavatel as supplier,
            p.mnozstvo as qty,
            p.cena_bez_dph as price
        FROM nakupne_objednavky_polozky p
        JOIN nakupne_objednavky o ON o.id = p.objednavka_id
        WHERE {where_clause} AND o.stav != 'Zrušené'
        ORDER BY o.datum_vystavenia ASC
    """
    try:
        rows = db_connector.execute_query(sql, (param,), fetch="all") or []
        return {"history": rows}
    except Exception as e:
        return {"error": str(e)}