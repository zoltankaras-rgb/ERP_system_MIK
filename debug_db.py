import db_connector
import json

def debug_slicing():
    print("==========================================================")
    print("1. VISIACE ÚLOHY V STAVE 'Prebieha krájanie'")
    print("==========================================================")
    hanging = db_connector.execute_query("""
        SELECT id, id_davky, stav, planovane_mnozstvo_kg, realne_mnozstvo_kg, realne_mnozstvo_ks
        FROM zaznamy_vyroba 
        WHERE stav = 'Prebieha krájanie'
    """)
    if hanging:
        for r in hanging:
            print(r)
    else:
        print("Žiadne úlohy v stave 'Prebieha krájanie'.")

    print("\n==========================================================")
    print("2. POSLEDNÝCH 10 ZÁZNAMOV V TABUĽKE 'zaznamy_vyroba'")
    print("==========================================================")
    recent_zv = db_connector.execute_query("""
        SELECT id, id_davky, stav, datum_ukoncenia 
        FROM zaznamy_vyroba 
        ORDER BY id DESC LIMIT 10
    """)
    for r in recent_zv:
        print(r)

    print("\n==========================================================")
    print("3. POSLEDNÝCH 10 ZÁZNAMOV V TABUĽKE 'expedicia_prijmy' (Export)")
    print("==========================================================")
    recent_ep = db_connector.execute_query("""
        SELECT id, id_davky, nazov_vyrobku, prijem_kg, prijem_ks, unit
        FROM expedicia_prijmy 
        ORDER BY id DESC LIMIT 10
    """)
    if recent_ep:
        for r in recent_ep:
            print(r)
    else:
        print("Žiadne záznamy v expedicia_prijmy.")

if __name__ == '__main__':
    debug_slicing()