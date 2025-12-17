from __future__ import annotations
import db_connector

print("--- ZAČÍNAM OPRAVU DATABÁZY (SQLITE VERZIA) ---")

# 1. Vymazanie starých tabuliek
tables = [
    "haccp_core_temp_measurements",
    "haccp_core_temp_slots",
    "haccp_core_temp_product_defaults"
]

print("1. Mazanie tabuliek...")
for t in tables:
    try:
        db_connector.execute_query(f"DROP TABLE IF EXISTS {t}", fetch="none")
    except Exception as e:
        print(f" -> Chyba (nevadí): {e}")

# 2. Vytvorenie nových tabuliek (SQLite Syntax - bez ENGINE=InnoDB)
queries = [
    """
    CREATE TABLE haccp_core_temp_product_defaults (
        product_name VARCHAR(190) PRIMARY KEY,
        is_required INTEGER NOT NULL DEFAULT 0,
        target_low_c REAL NULL,
        target_high_c REAL NULL,
        hold_minutes INTEGER NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE haccp_core_temp_measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id VARCHAR(190) NOT NULL,
        product_name VARCHAR(190) NULL,
        production_date DATE NULL,
        target_low_c REAL NULL,
        target_high_c REAL NULL,
        hold_minutes INTEGER NULL,
        measured_c REAL NOT NULL,
        measured_at DATETIME NOT NULL,
        measured_by VARCHAR(190) NULL,
        note TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE INDEX idx_ct_batch ON haccp_core_temp_measurements (batch_id)
    """,
    """
    CREATE TABLE haccp_core_temp_slots (
        batch_id VARCHAR(190) PRIMARY KEY,
        production_date DATE NOT NULL,
        slot_start DATETIME NOT NULL,
        slot_end DATETIME NOT NULL,
        hold_minutes INTEGER NOT NULL DEFAULT 10,
        generated INTEGER NOT NULL DEFAULT 1
    )
    """
]

print("2. Vytváranie tabuliek...")
for q in queries:
    try:
        db_connector.execute_query(q, fetch="none")
    except Exception as e:
        print(f" -> Chyba: {e}")

print("--- HOTOVO ---")