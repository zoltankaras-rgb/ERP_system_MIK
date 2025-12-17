import sqlite3
import os

print("=== VYTVÁRAM TABUĽKU PRE ADRESÁR ===")

search_paths = [
    "instance/erp.db",
    "instance/database.db",
    "erp.db",
    "database.db",
    "vyroba.db"
]

base_dir = os.getcwd()
paths_to_check = [os.path.join(base_dir, p) for p in search_paths]

for db_path in paths_to_check:
    if not os.path.exists(db_path):
        continue

    print(f"\n🔎 Databáza: {db_path}")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Vytvorenie tabuľky 'saved_contacts' ak neexistuje
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        print("   ✅ Tabuľka 'saved_contacts' je pripravená.")
        conn.commit()
        conn.close()

    except Exception as e:
        print(f"   ❌ Chyba: {e}")

print("\n=== HOTOVO ===")