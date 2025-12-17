from __future__ import annotations
import db_connector

print("--- ZAČÍNAM KONTROLU DATABÁZY ---")

queries = [
    """
    CREATE TABLE IF NOT EXISTS haccp_core_temp_product_defaults (
        product_name VARCHAR(255) PRIMARY KEY,
        is_required TINYINT(1) NOT NULL DEFAULT 0,
        limit_c DECIMAL(5,2) NULL,
        target_low_c DECIMAL(5,2) NULL,
        target_high_c DECIMAL(5,2) NULL,
        hold_minutes INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS haccp_core_temp_measurements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        batch_id VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NULL,
        production_date DATE NULL,
        target_low_c DECIMAL(5,2) NULL,
        target_high_c DECIMAL(5,2) NULL,
        hold_minutes INT NULL,
        measured_c DECIMAL(5,2) NOT NULL,
        measured_at DATETIME NOT NULL,
        measured_by VARCHAR(255) NULL,
        note TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_coretemp_batch (batch_id),
        INDEX idx_coretemp_date (production_date),
        INDEX idx_coretemp_prod (product_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS haccp_core_temp_slots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        batch_id VARCHAR(255) NOT NULL,
        production_date DATE NOT NULL,
        slot_start DATETIME NOT NULL,
        slot_end DATETIME NOT NULL,
        hold_minutes INT NOT NULL DEFAULT 10,
        generated TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_slot_batch (batch_id),
        INDEX idx_slot_date (production_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """
]

for i, sql in enumerate(queries):
    print(f"Vytváram tabuľku č. {i+1}...")
    try:
        # Použijeme priamy kurzor ak je to možné, alebo cez wrapper
        # Skúsime štandardný execute_query z db_connector
        res = db_connector.execute_query(sql, fetch="none")
        print(f" -> OK.")
    except Exception as e:
        print(f" -> CHYBA: {e}")
# 4. Oprava tabuľky Cenníky (Fix pre chýbajúci email)
    print("Opravujem tabuľku cenniky...")
    sql_cenniky = "ALTER TABLE cenniky ADD COLUMN email VARCHAR(255) NULL;"
    try:
        # Skúsime pridať stĺpec. Ak už existuje, vyhodí to chybu, ktorú odchytíme.
        db_connector.execute_query(sql_cenniky, fetch="none")
        print(" -> OK (stĺpec 'email' pridaný).")
    except Exception as e:
        # Ignorujeme chybu, ak stĺpec už existuje
        print(f" -> Info: {e}")
print("--- HOTOVO ---")