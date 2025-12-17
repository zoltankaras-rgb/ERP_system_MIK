import sqlite3
import os

print("=== ZAČÍNAM OPRAVU POLOŽIEK CENNÍKA (DPH, MJ) ===")

# Zoznam možných ciest k databáze
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

        # 1. Kontrola existencie tabuľky polozky_cennika
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='polozky_cennika';")
        if not cursor.fetchone():
            print("   ⚠️  Tabuľka 'polozky_cennika' tu nie je. Preskakujem.")
            conn.close()
            continue

        # 2. Pridanie stĺpca DPH
        try:
            cursor.execute("ALTER TABLE polozky_cennika ADD COLUMN dph DECIMAL(5,2) DEFAULT 20.00")
            print("   ✅ Pridaný stĺpec 'dph'.")
            fixed_count += 1
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("   ℹ️  Stĺpec 'dph' už existuje.")
            else:
                print(f"   ❌ Chyba pri dph: {e}")

        # 3. Pridanie stĺpca MJ (Merná jednotka) - pre istotu, tiež zvykne chýbať
        try:
            cursor.execute("ALTER TABLE polozky_cennika ADD COLUMN mj VARCHAR(20) DEFAULT 'kg'")
            print("   ✅ Pridaný stĺpec 'mj'.")
            fixed_count += 1
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("   ℹ️  Stĺpec 'mj' už existuje.")
            else:
                print(f"   ❌ Chyba pri mj: {e}")

        conn.commit()
        conn.close()

    except Exception as e:
        print(f"   ❌ Kritická chyba DB: {e}")

print(f"\n=== HOTOVO. Opravené/Skontrolované zmeny: {fixed_count} ===")