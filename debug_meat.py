import db_connector
import sys

print("\n--- ZAČIATOK DIAGNOSTIKY ---")

# 1. Výpis existujúcich šablón
print("1. Čítam tabuľku meat_templates...")
rows = db_connector.execute_query("SELECT * FROM meat_templates")
print(f"   -> Nájdených záznamov: {len(rows) if rows else 0}")
if rows:
    print(f"   -> Dáta: {rows}")

# 2. Pokus o vloženie testovacej šablóny
print("\n2. Skúšam vložiť TEST šablónu...")
try:
    # Zistíme nejaké validné material_id
    mat = db_connector.execute_query("SELECT id FROM meat_materials LIMIT 1", fetch='one')
    mat_id = mat['id'] if mat else 1
    
    query = "INSERT INTO meat_templates (name, material_id, is_active) VALUES ('TEST DEBUG', %s, 1)"
    print(f"   -> SQL: {query} (material_id={mat_id})")
    
    # Vložíme a vypýtame si ID
    new_id = db_connector.execute_query(query, (mat_id,), fetch='lastrowid')
    print(f"   -> Vrátené ID (lastrowid): {new_id}")
    
    if not new_id:
        print("   !!! CHYBA: Databáza nevrátila ID. Pravdepodobne chýba AUTO_INCREMENT.")
    else:
        print("   -> Zápis vyzerá úspešne.")

except Exception as e:
    print(f"   !!! CHYBA PRI ZÁPISE: {e}")

# 3. Kontrolné čítanie po zápise
print("\n3. Čítam tabuľku po zápise...")
rows_after = db_connector.execute_query("SELECT * FROM meat_templates")
print(f"   -> Nájdených záznamov: {len(rows_after) if rows_after else 0}")

if rows_after and len(rows_after) > (len(rows) if rows else 0):
    print("\n[VÝSLEDOK]: Zápis funguje! Problém je v aplikácii (cache/commit).")
else:
    print("\n[VÝSLEDOK]: Zápis zlyhal! Dáta sa neukladajú. Problém je v DB alebo transakcii.")

print("--- KONIEC DIAGNOSTIKY ---\n")