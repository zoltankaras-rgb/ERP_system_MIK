from __future__ import annotations
import db_connector

print("--- ZAČÍNAM OPRAVU DATABÁZY ---")

# 1. Najprv vymažeme staré/zlé HACCP tabuľky (Hard Reset)
drop_queries = [
    "DROP TABLE IF EXISTS haccp_core_temp_measurements",
    "DROP TABLE IF EXISTS haccp_core_temp_slots",
    "DROP TABLE IF EXISTS haccp_core_temp_product_defaults"
]

print("1. Mazanie starých HACCP tabuliek...")
for sql in drop_queries:
    try:
        db_connector.execute_query(sql, fetch="none")
    except Exception as e:
        print(f" -> Chyba pri mazaní (nevadí): {e}")
print(" -> Hotovo.")

# 2. Vytvorenie nových tabuliek (Podľa aktuálneho kódu)
create_queries = [
    """
    CREATE TABLE haccp_core_temp_product_defaults (
        product_name VARCHAR(190) PRIMARY KEY,
        is_required TINYINT(1) NOT NULL DEFAULT 0,
        target_low_c DECIMAL(5,2) NULL,
        target_high_c DECIMAL(5,2) NULL,
        hold_minutes INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE haccp_core_temp_measurements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        batch_id VARCHAR(190) NOT NULL,
        product_name VARCHAR(190) NULL,
        production_date DATE NULL,
        target_low_c DECIMAL(5,2) NULL,
        target_high_c DECIMAL(5,2) NULL,
        hold_minutes INT NULL,
        measured_c DECIMAL(5,2) NOT NULL,
        measured_at DATETIME NOT NULL,
        measured_by VARCHAR(190) NULL,
        note TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_coretemp_batch (batch_id),
        INDEX idx_coretemp_date (production_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE haccp_core_temp_slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        batch_id VARCHAR(190) NOT NULL,
        production_date DATE NOT NULL,
        slot_start DATETIME NOT NULL,
        slot_end DATETIME NOT NULL,
        hold_minutes INT NOT NULL DEFAULT 10,
        generated TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_slot_batch (batch_id),
        INDEX idx_slot_date (production_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """
]

print("2. Vytváranie nových HACCP tabuliek...")
for i, sql in enumerate(create_queries):
    try:
        db_connector.execute_query(sql, fetch="none")
        print(f" -> Tabuľka {i+1} vytvorená OK.")
    except Exception as e:
        print(f" -> CHYBA pri vytváraní tabuľky {i+1}: {e}")

# 3. Oprava tabuľky Cenníky (Fix pre chýbajúci email)
print("3. Opravujem tabuľku cenniky (stĺpec email)...")
sql_cenniky = "ALTER TABLE cenniky ADD COLUMN email VARCHAR(190) NULL;"
try:
    db_connector.execute_query(sql_cenniky, fetch="none")
    print(" -> OK (stĺpec 'email' bol pridaný).")
except Exception as e:
    # Ak chyba obsahuje "Duplicate column", je to v poriadku
    err_msg = str(e).lower()
    if "duplicate column" in err_msg or "exists" in err_msg:
        print(" -> Info: Stĺpec 'email' už existuje, všetko je v poriadku.")
    else:
        print(f" -> Chyba: {e}")

print("--- HOTOVO: Reštartujte Flask server ---")