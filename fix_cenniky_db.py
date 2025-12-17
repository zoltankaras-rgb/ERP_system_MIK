import sqlite3
import os

# ==========================================
# SKRIPT NA OPRAVU SQLite TABUĽKY "CENNIKY"
# ==========================================

# 1. Nájdenie databázy
# Flask zvyčajne ukladá DB do priečinka 'instance'
possible_paths = [
    "instance/erp.db",
    "instance/database.db",
    "instance/data.db",
    "erp.db",
    "database.db",
    "vyroba.db"
]

db_path = None
for p in possible_paths:
    if os.path.exists(p):
        db_path = p
        break

if not db_path:
    print("!!! CHYBA: Nenašiel som žiadny súbor .db (SQLite).")
    print("Skontroluj, kde máš uloženú databázu pre cenníky.")
    exit(1)

print(f"--- Našiel som databázu: {db_path} ---")

# 2. Pripojenie a oprava
try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Kontrola, či tabuľka existuje
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cenniky';")
    if not cursor.fetchone():
        print("!!! Tabuľka 'cenniky' neexistuje. Najprv musíš spustiť migráciu app.")
        exit(1)

    print("Pridávam stĺpec 'email' do tabuľky 'cenniky'...")
    
    try:
        cursor.execute("ALTER TABLE cenniky ADD COLUMN email VARCHAR(150)")
        conn.commit()
        print(">>> ÚSPECH: Stĺpec 'email' bol pridaný.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print(">>> INFO: Stĺpec 'email' už existoval, netreba nič robiť.")
        else:
            print(f"!!! CHYBA SQL: {e}")

    conn.close()

except Exception as e:
    print(f"!!! KRITICKÁ CHYBA: {e}")

print("--- HOTOVO ---")