import db_connector

def _ensure_nakup_schema():
    """Vykoná tvrdú kontrolu a migráciu stĺpcov, aby databáza nepadala na starej štruktúre."""
    # 1. Základné tabuľky (ak ešte vôbec neexistujú)
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS nakupne_objednavky (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dodavatel VARCHAR(255) NOT NULL,
            datum_nakupu DATE NOT NULL,
            poznamka TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci;
    """, fetch='none')

    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS nakupne_objednavky_polozky (
            id INT AUTO_INCREMENT PRIMARY KEY,
            objednavka_id INT NOT NULL,
            ean VARCHAR(64) NULL,
            nazov_produktu VARCHAR(255) NOT NULL,
            mnozstvo DECIMAL(10,3) NOT NULL,
            cena_za_jednotku DECIMAL(10,4) NOT NULL,
            FOREIGN KEY (objednavka_id) REFERENCES nakupne_objednavky(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci;
    """, fetch='none')

    # 2. Migrácie - bezpečné pridanie nových stĺpcov a premenovanie starých (ignoruje chyby, ak už prebehli)
    migracie = [
        "ALTER TABLE nakupne_objednavky ADD COLUMN datum_dodania DATE NULL;",
        "ALTER TABLE nakupne_objednavky ADD COLUMN stav ENUM('Objednané', 'Prijaté', 'Zrušené') DEFAULT 'Objednané';",
        "ALTER TABLE nakupne_objednavky ADD COLUMN celkova_suma_bez_dph DECIMAL(10,2) DEFAULT 0;",
        "ALTER TABLE nakupne_objednavky ADD COLUMN celkova_suma_s_dph DECIMAL(10,2) DEFAULT 0;",
        "ALTER TABLE nakupne_objednavky CHANGE datum_nakupu datum_vystavenia DATE NOT NULL;",
        
        "ALTER TABLE nakupne_objednavky_polozky ADD COLUMN cena_bez_dph DECIMAL(10,4) NOT NULL DEFAULT 0;",
        "ALTER TABLE nakupne_objednavky_polozky ADD COLUMN dph DECIMAL(5,2) DEFAULT 20.00;"
    ]
    
    for sql in migracie:
        try:
            db_connector.execute_query(sql, fetch='none')
        except Exception:
            pass

def ulozit_nakup(data):
    try:
        _ensure_nakup_schema()
    except Exception as e:
        print(f"Upozornenie pri kontrole schemy nakupov: {e}")

    dodavatel = data.get('dodavatel')
    datum_vystavenia = data.get('datum_vystavenia') or data.get('datum')
    
    datum_dodania = data.get('datum_dodania')
    if not datum_dodania or str(datum_dodania).strip() == "":
        datum_dodania = None

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
        """, (dodavatel, datum_vystavenia, datum_dodania, stav, float(celkova_suma_bez_dph), float(celkova_suma_s_dph), poznamka))
        
        obj_id = cur.lastrowid
        
        for p in polozky:
            ean = p.get('ean')
            if not ean or str(ean).strip() == "":
                ean = None
            
            # Duplikujeme cena_bez_dph aj do povodneho stlpca cena_za_jednotku, aby nepadla databaza pre 'NOT NULL'
            cur.execute("""
                INSERT INTO nakupne_objednavky_polozky 
                (objednavka_id, ean, nazov_produktu, mnozstvo, cena_bez_dph, cena_za_jednotku, dph) 
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                obj_id, 
                ean, 
                p.get('nazov'), 
                float(p.get('mnozstvo', 0)), 
                float(p.get('cena_bez_dph', 0)), 
                float(p.get('cena_bez_dph', 0)), 
                float(p.get('dph', 20))
            ))
            
        conn.commit()
        return {"message": f"Záznam bol úspešne uložený v stave '{stav}'."}
    except Exception as e:
        if conn: conn.rollback()
        print(f"!!! CHYBA DB PRI UKLADANI NAKUPU: {str(e)}")
        return {"error": f"Databázová chyba: {str(e)}"}
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
    try:
        _ensure_nakup_schema()
    except Exception:
        pass
        
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
        SELECT ean, nazov_vyrobku as name, COALESCE(dph, 20.0) as dph 
        FROM produkty 
        WHERE nazov_vyrobku IS NOT NULL AND nazov_vyrobku != ''
        UNION
        SELECT ean, nazov as name, 20.0 as dph 
        FROM sklad 
        WHERE nazov IS NOT NULL AND nazov != ''
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    unique_products = {r['name']: r for r in rows}
    return {"products": list(unique_products.values())}

def historia_nakupov(ean, nazov):
    try:
        _ensure_nakup_schema()
    except Exception:
        pass
        
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