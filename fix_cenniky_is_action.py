import sqlite3
import os

print("=== SPUSTENIE OPRAVY DATABÁZY: Pridávanie stĺpca 'is_action' ===")

# Zoznam možných ciest k databázam
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

        # 1. Kontrola existencie tabuľky 'polozky_cennika'
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='polozky_cennika';")
        if not cursor.fetchone():
            print("   ⚠️  Tabuľka 'polozky_cennika' neexistuje. Preskakujem.")
            conn.close()
            continue

        # 2. Pridanie stĺpca 'is_action'
        try:
            # BOOLEAN v SQLite je zvyčajne INTEGER (0 alebo 1)
            cursor.execute("ALTER TABLE polozky_cennika ADD COLUMN is_action BOOLEAN DEFAULT 0")
            print("   ✅ Pridaný stĺpec 'is_action'.")
            fixed_count += 1
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("   ℹ️  Stĺpec 'is_action' už existuje.")
            else:
                print(f"   ❌ Chyba pri pridávaní 'is_action': {e}")

        conn.commit()
        conn.close()

    except Exception as e:
        print(f"   ❌ Kritická chyba DB: {e}")

print(f"\n=== HOTOVO. Opravené/Skontrolované zmeny: {fixed_count} ===")