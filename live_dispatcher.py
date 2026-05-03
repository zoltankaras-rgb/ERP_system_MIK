import os
import math
import time
import requests
import mysql.connector
from datetime import datetime, timedelta
from dotenv import load_dotenv

# --- NASTAVENIA ---
load_dotenv()
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_USER = os.getenv('DB_USER', 'root')
DB_PASS = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME', 'vyrobny_system')
ORS_API_KEY = os.getenv('ORS_API_KEY')

# GPS centraly MIK Sala [Lon, Lat]
MIK_SALA_GPS = [17.880655, 48.151759]
CAS_VYKLADKY_MINUTY = 15

# ==========================================
# 1. MATEMATIKA A MAPY
# ==========================================
def vypocitaj_vzdialenost(lat1, lon1, lat2, lon2):
    """Haversinova rovnica v metroch."""
    if not all([lat1, lon1, lat2, lon2]): return 999999
    R = 6371000.0
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = math.radians(float(lat2) - float(lat1))
    d_lam = math.radians(float(lon2) - float(lon1))
    a = math.sin(d_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2.0)**2
    return R * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))

def vypocitaj_trasu_ors(zastavky_gps):
    """Komunikacia s OpenRouteService."""
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    headers = {'Authorization': ORS_API_KEY, 'Content-Type': 'application/json'}
    try:
        res = requests.post(url, json={"coordinates": zastavky_gps}, headers=headers)
        if res.status_code == 200:
            trasa = res.json().get('routes', [{}])[0]
            if 'segments' in trasa:
                return [seg['duration'] for seg in trasa['segments']]
    except Exception as e:
        print(f"[-] Chyba ORS: {e}")
    return None

# ==========================================
# 2. CCS SIMULACIA
# ==========================================
def get_live_gps_from_ccs(vehicle_id):
    """Mock funkcia. Tu napojime skutocne CCS, ked ho zapnu."""
    # Simulujeme, ze auto prave odislo zo Sale a blizi sa k Bratislave (vzdialenost > 1km od MIK)
    return {"lat": 48.152000, "lon": 17.200000} 

# ==========================================
# 3. DISPECERSKY CYKLUS
# ==========================================
def run_dispatcher_cycle():
    try:
        conn = mysql.connector.connect(host=DB_HOST, user=DB_USER, password=DB_PASS, database=DB_NAME)
        cursor = conn.cursor(dictionary=True)
        dnes = datetime.now().strftime('%Y-%m-%d')
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Spustam dispecing pre {dnes}")

        # Ziskame vsetky trasy, ktore sa dnes jazdia
        cursor.execute("""
            SELECT DISTINCT z.trasa_id 
            FROM b2b_objednavky o 
            JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id 
            WHERE DATE(o.pozadovany_datum_dodania) = %s AND o.stav NOT IN ('Zrušená', 'Stornovaná')
        """, (dnes,))
        trasy_dnes = [r['trasa_id'] for r in cursor.fetchall() if r['trasa_id']]

        for trasa_id in trasy_dnes:
            # V buducnosti tu priradime realne vehicle_id pre danu trasu
            auto_gps = get_live_gps_from_ccs(vehicle_id=1) 
            if not auto_gps: continue

            # Vzdialenost auta od zavodu MIK Sala
            vzdialenost_od_startu = vypocitaj_vzdialenost(auto_gps['lat'], auto_gps['lon'], MIK_SALA_GPS[1], MIK_SALA_GPS[0])
            
            # Vytiahneme vsetky zastavky na tejto trase podla poradia
            cursor.execute("""
                SELECT o.id as obj_id, z.nazov_firmy, z.lat, z.lon, o.cas_eta, o.cas_dorucenia_real
                FROM b2b_objednavky o
                JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
                WHERE DATE(o.pozadovany_datum_dodania) = %s AND z.trasa_id = %s AND z.lat IS NOT NULL
                ORDER BY z.trasa_poradie ASC
            """, (dnes, trasa_id))
            zastavky = cursor.fetchall()
            
            if not zastavky: continue

            # SCENAR A: Auto odislo z firmy (>1km), ale ETA este nebola vypocitana
            if vzdialenost_od_startu > 1000 and zastavky[0]['cas_eta'] is None:
                print(f"🚀 Auto na trase {trasa_id} opustilo zavod! Pocitam ETA...")
                
                # Pripravime GPS body pre mapy: Start(MIK) + vsetci zakaznici [Lon, Lat]
                body_trasy = [MIK_SALA_GPS]
                for z in zastavky:
                    body_trasy.append([float(z['lon']), float(z['lat'])])
                
                useky_sekundy = vypocitaj_trasu_ors(body_trasy)
                if useky_sekundy:
                    aktualny_cas = datetime.now()
                    
                    for i, z in enumerate(zastavky):
                        # Pripocitame cas jazdy k danemu zakaznikovi
                        aktualny_cas += timedelta(seconds=useky_sekundy[i])
                        
                        # Zapiseme vypocitany cas do databazy
                        cursor.execute("UPDATE b2b_objednavky SET cas_eta = %s WHERE id = %s", (aktualny_cas.strftime('%Y-%m-%d %H:%M:%S'), z['obj_id']))
                        print(f"   -> ETA pre {z['nazov_firmy']}: {aktualny_cas.strftime('%H:%M')}")
                        
                        # Pripocitame 15 minut (servisny cas) stravenych u zakaznika pred odchodom k dalsiemu
                        aktualny_cas += timedelta(minutes=CAS_VYKLADKY_MINUTY)
                    
                    conn.commit()
            
            # SCENAR B: Zastavky už maju vypocitanu ETA, ideme odskrtavat dodania!
            for z in zastavky:
                if z['cas_dorucenia_real'] is None:
                    vzdialenost_k_zakaznikovi = vypocitaj_vzdialenost(auto_gps['lat'], auto_gps['lon'], z['lat'], z['lon'])
                    
                    # Sme v 50m okruhu od vykladky?
                    if vzdialenost_k_zakaznikovi <= 50:
                        print(f"✅ Auto dorazilo na vykladku: {z['nazov_firmy']}!")
                        cas_vykladky = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                        cursor.execute("UPDATE b2b_objednavky SET cas_dorucenia_real = %s WHERE id = %s", (cas_vykladky, z['obj_id']))
                        conn.commit()
                    break # Kontrolujeme vzdy len najblizsiu nedorucenu zastavku

    except Exception as e:
        print(f"Kriticka chyba: {e}")
    finally:
        if 'conn' in locals() and conn.is_connected(): cursor.close(); conn.close()

if __name__ == "__main__":
    run_dispatcher_cycle()