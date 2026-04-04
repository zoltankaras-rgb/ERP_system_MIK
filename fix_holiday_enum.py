import db_connector
import mysql.connector

sql = """
ALTER TABLE calendar_events 
MODIFY COLUMN event_type ENUM('MEETING', 'TENDER', 'VACATION', 'ABSENCE', 'SERVICE', 'DEADLINE', 'TASK', 'HOLIDAY') NOT NULL;
"""

try:
    # Use a direct emergency connection to ensure the DDL statement executes without pool interference
    conn = mysql.connector.connect(**db_connector.DB_CONFIG)
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    print("Zmena v databáze prebehla úspešne! 'HOLIDAY' je teraz povolený typ.")
except Exception as e:
    print(f"Chyba pri úprave DB: {e}")
finally:
    if 'cur' in locals() and cur is not None:
        cur.close()
    if 'conn' in locals() and conn is not None and conn.is_connected():
        conn.close()