import sqlite3
import os

print("=== ZAČÍNAM HROMADNÚ OPRAVU DATABÁZ ===")

# Všetky možné cesty, kde Flask zvykne mať databázu
search_paths = [
    "instance/erp.db",
    "instance/database.db",
    "instance/data.db",
    "erp.db",
    "database.db",
    "vyroba.db",
    "data.db"
]

# Pridáme absolútnu cestu pre istotu
base_dir = os.getcwd()
paths_to_check = [os.path.join(base_dir, p) for p in search_paths]

fixed_count = 0

for db_path in paths_to_check:
    if not os.path.exists(db_path):
        continue

    print(f"\n🔎 Našiel som databázu: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 1. Kontrola, či je to databáza cenníkov (či má tabuľku 'cenniky')
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cenniky';")
        if not cursor.fetchone():
            print("   ⚠️  Preskakujem (nie je to databáza cenníkov, chýba tabuľka).")
            conn.close()
            continue

        # 2. Pokus o pridanie stĺpca
        try:
            cursor.execute("ALTER TABLE cenniky ADD COLUMN email VARCHAR(255)")
            conn.commit()
            print("   ✅ ÚSPECH: Stĺpec 'email' bol pridaný.")
            fixed_count += 1
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("   ℹ️  INFO: Stĺpec 'email' tu už existuje (OK).")
                fixed_count += 1
            else:
                print(f"   ❌ CHYBA SQL: {e}")

        conn.close()

    except Exception as e:
        print(f"   ❌ Kritická chyba pri otváraní: {e}")

print(f"\n=== HOTOVO. Skontrolovaných a pripravených databáz: {fixed_count} ===")