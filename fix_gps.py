import db_connector

def fix_db():
    queries = [
        "ALTER TABLE b2b_stores ADD COLUMN lat DECIMAL(10,6) NULL",
        "ALTER TABLE b2b_stores ADD COLUMN lon DECIMAL(10,6) NULL",
        "ALTER TABLE b2b_zakaznici ADD COLUMN lat DECIMAL(10,6) NULL",
        "ALTER TABLE b2b_zakaznici ADD COLUMN lon DECIMAL(10,6) NULL",
        "ALTER TABLE b2b_manual_zakaznici ADD COLUMN lat DECIMAL(10,6) NULL",
        "ALTER TABLE b2b_manual_zakaznici ADD COLUMN lon DECIMAL(10,6) NULL"
    ]
    
    print("Prebieha kontrola a úprava databázy pre GPS súradnice...")
    conn = db_connector.get_connection()
    cur = conn.cursor()
    
    for q in queries:
        try:
            cur.execute(q)
            print(f"✅ OK: Pridaný stĺpec -> {q.split('ADD COLUMN ')[1].split(' ')[0]} do {q.split('ALTER TABLE ')[1].split(' ')[0]}")
        except Exception as e:
            # Ak stĺpec už existuje, vyhodí chybu, ktorú môžeme ignorovať
            print(f"⏩ SKIP (Stĺpec už existuje): {q.split('ALTER TABLE ')[1].split(' ADD')[0]}")
            
    conn.commit()
    cur.close()
    conn.close()
    print("🎉 Hotovo! Databáza je plne pripravená na mapy a Geofencing.")

if __name__ == '__main__':
    fix_db()