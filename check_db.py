import db_connector

rows = db_connector.execute_query("SHOW COLUMNS FROM calendar_events", fetch="all")
if rows:
    stlpce = [r['Field'] for r in rows]
    print("STĹPCE V DATABÁZE SÚ:", stlpce)
else:
    print("Nepodarilo sa načítať stĺpce.")