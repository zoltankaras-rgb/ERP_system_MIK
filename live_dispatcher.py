import os
import math
import time
import mysql.connector
from datetime import datetime
from dotenv import load_dotenv

# Nacitanie premennych (rovnake ako ste uz nastavili)
load_dotenv()
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_USER = os.getenv('DB_USER', 'root')
DB_PASS = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME', 'vyrobny_system')

# ==========================================
# 1. GEOFENCE LOGIKA (Už otestovaná)
# ==========================================
def vypocitaj_vzdialenost(lat1, lon1, lat2, lon2):
    if not all([lat1, lon1, lat2, lon2]):
        return 999999 # Ak nieco chyba, vratime obrovsku vzdialenost
    
    R = 6371000.0
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    delta_phi = math.radians(float(lat2) - float(lat1))
    delta_lambda = math.radians(float(lon2) - float(lon1))

    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

# ==========================================
# 2. KOMUNIKACIA S CCS (Zatial "MOCK" - Cakame na podporu)
# ==========================================
def get_live_gps_from_ccs(vehicle_id):
    """
    TUTO FUNKCIU NAPLNIME, KED VAM CCS PODPORA ZAPNE VIDITELNOST AUT.
    Zatial vrati 'falošnú' polohu pre ucely testovania databazy.
    """
    # Tu neskôr vložime SOAP požiadavku GetVehicleOnlinePosition
    # Zatial simulujeme, ze auto stoji niekde v Šali:
    return {"lat": 48.152865, "lon": 17.112165}

# ==========================================
# 3. HLAVNY DISPEČERSKY CYKLUS
# ==========================================
def run_dispatcher_cycle():
    try:
        conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
        cursor = conn.cursor(dictionary=True)
        
        dnes = datetime.now().strftime('%Y-%m-%d')
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Spustam dispečersky cyklus pre {dnes}")

        # Najdeme vsetky DNESNE objednavky, ktore ESTE NEBOLI DORUCENE
        query = """
            SELECT o.id as obj_id, o.cislo_objednavky, o.zakaznik_id, 
                   z.lat, z.lon, z.nazov_firmy, z.trasa_id
            FROM b2b_objednavky o
            JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
            WHERE DATE(o.pozadovany_datum_dodania) = %s 
              AND o.cas_dorucenia_real IS NULL
              AND o.stav NOT IN ('Zrušená', 'Stornovaná')
              AND z.lat IS NOT NULL AND z.lon IS NOT NULL
        """
        cursor.execute(query, (dnes,))
        cielove_zastavky = cursor.fetchall()
        
        if not cielove_zastavky:
            print("Ziadne aktivne zastavky na dnes (alebo vsetko dorucene / chybaju GPS).")
            return

        # Pre ukazku si zoskupime zastavky podla TRASY (neskor tu budeme tahat auto priradene k trase)
        print(f"Nasiel som {len(cielove_zastavky)} nedorucenych zastavok s GPS. Zistujem polohu aut...")

        # V produkcii tu pojdeme cez ID aut. Zatial simulujeme len jeden prechod.
        for zastavka in cielove_zastavky:
            # TODO: Ziskat realne vehicle_id podla trasa_id
            simulovane_vehicle_id = 1 
            
            auto_gps = get_live_gps_from_ccs(simulovane_vehicle_id)
            
            if auto_gps:
                vzdialenost = vypocitaj_vzdialenost(auto_gps['lat'], auto_gps['lon'], zastavka['lat'], zastavka['lon'])
                
                print(f"Auto je od '{zastavka['nazov_firmy']}' vzdialene {vzdialenost:.1f} m")
                
                # Zlaté pravidlo Geofencingu: Ak je do 50 metrov, ODŠKRTNEME DODANIE!
                if vzdialenost <= 50:
                    cas_teraz = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    print(f"  >>> BINGO! Auto dorazilo na vykladku: {zastavka['nazov_firmy']}")
                    
                    update_q = "UPDATE b2b_objednavky SET cas_dorucenia_real = %s WHERE id = %s"
                    cursor.execute(update_q, (cas_teraz, zastavka['obj_id']))
                    conn.commit()

    except Exception as e:
        print(f"Kriticka chyba dispecera: {e}")
    finally:
        if 'conn' in locals() and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    # V buducnosti toto bude bezat ako slucka, napr:
    # while True:
    #    run_dispatcher_cycle()
    #    time.sleep(120) # Pocka 2 minuty
    run_dispatcher_cycle()