import sqlite3
import os

print("=== START: OPRAVA ADRESÁRA KONTAKTOV ===")

# Zoznam všetkých možných ciest k DB
search_paths = [
    "instance/erp.db",
    "instance/database.db",
    "instance/data.db",
    "erp.db",
    "database.db",
    "vyroba.db",
    "data.db"
]

base_dir = os.getcwd()
paths_to_check = [os.path.join(base_dir, p) for p in search_paths]
fixed_count = 0

for db_path in paths_to_check:
    if not os.path.exists(db_path):
        continue

    print(f"\n🔎 Kontrolujem databázu: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Skúsime vytvoriť tabuľku saved_contacts
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS saved_contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(150) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            print("   ✅ Tabuľka 'saved_contacts' bola overená/vytvorená.")
            fixed_count += 1
        except Exception as e:
            print(f"   ❌ Chyba pri vytváraní tabuľky: {e}")

        conn.commit()
        conn.close()

    except Exception as e:
        print(f"   ❌ Nedá sa pripojiť k DB: {e}")

print(f"\n=== HOTOVO. Skontrolovaných databáz: {fixed_count} ===")