from __future__ import annotations
import db_connector

print("--- ZAČÍNAM OPRAVU DATABÁZY (MySQL VERZIA) ---")

# 1. Vymazanie starých tabuliek
tables = [
    "haccp_core_temp_measurements",
    "haccp_core_temp_slots",
    "haccp_core_temp_product_defaults"
]

print("1. Mazanie tabuliek...")
for t in tables:
    try:
        # Vypneme kontrolu cudzích kľúčov pre istotu
        db_connector.execute_query("SET FOREIGN_KEY_CHECKS = 0", fetch="none")
        db_connector.execute_query(f"DROP TABLE IF EXISTS {t}", fetch="none")
        db_connector.execute_query("SET FOREIGN_KEY_CHECKS = 1", fetch="none")
    except Exception as e:
        print(f" -> Chyba (nevadí): {e}")

# 2. Vytvorenie nových tabuliek (MySQL Syntax)
queries = [
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

print("2. Vytváranie tabuliek...")
for q in queries:
    try:
        db_connector.execute_query(q, fetch="none")
    except Exception as e:
        print(f" -> Chyba: {e}")

print("--- HOTOVO ---")