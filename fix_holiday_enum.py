import db_connector

sql = """
ALTER TABLE calendar_events 
MODIFY COLUMN event_type ENUM('MEETING', 'TENDER', 'VACATION', 'ABSENCE', 'SERVICE', 'DEADLINE', 'TASK', 'HOLIDAY') NOT NULL;
"""

try:
    db_connector.execute_query(sql, fetch='none')
    print("Zmena v databáze prebehla úspešne! 'HOLIDAY' je teraz povolený typ.")
except Exception as e:
    print(f"Chyba pri úprave DB: {e}")