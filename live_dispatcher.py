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

import xml.etree.ElementTree as ET

# Pridajte toto hore medzi načítanie premenných
CCS_MODE = os.getenv('CCS_MODE', 'mock')
CCS_USER = os.getenv('CCS_USERNAME')
CCS_PASS = os.getenv('CCS_PASSWORD')
CCS_FIRM = os.getenv('CCS_FIRM')

# ==========================================
# 2. CCS KOMUNIKACIA (MOCK vs LIVE)
# ==========================================
def get_live_gps_from_ccs(vehicle_id):
    """
    Rozhodne sa, ci taha data z testovacieho prostredia alebo z ostreho CCS API.
    """
    if CCS_MODE == 'mock':
        # --- FIKTIVNE DATA PRE TESTOVANIE ---
        print(f"  [TEST] Stahujem fiktivnu polohu pre auto {vehicle_id}")
        return {"lat": 48.152000, "lon": 17.200000} 
        
    elif CCS_MODE == 'live':
        # --- OSTRA PREVADZKA (REALNE API CCS) ---
        url = "https://www.imonitor.cz/imonws/basews.asmx"
        headers = {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': '"http://ccs.cz/WS/GetVehicleOnlinePosition"'
        }
        
        # Skladame XML presne podla sablony od CCS
        payload = f"""<?xml version="1.0" encoding="utf-8"?>
        <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
          <soap:Body>
            <GetVehicleOnlinePosition xmlns="http://ccs.cz/WS">
              <userName>{CCS_USER}</userName>
              <password>{CCS_PASS}</password>
              <firmNameContext>{CCS_FIRM}</firmNameContext>
              <idVehicle>{vehicle_id}</idVehicle>
              <imei></imei>
            </GetVehicleOnlinePosition>
          </soap:Body>
        </soap:Envelope>"""
        
        try:
            response = requests.post(url, data=payload.encode('utf-8'), headers=headers, timeout=10)
            if response.status_code == 200:
                # Rozparsovanie vrateneho XML
                root = ET.fromstring(response.text)
                
                # Zadefinujeme namespaces, s ktorymi CCS pracuje
                namespaces = {
                    'soap': 'http://schemas.xmlsoap.org/soap/envelope/',
                    'ws': 'http://ccs.cz/WS',
                    'data': 'http://ccs.cz/WS/DataVehicleOnlinePosition'
                }
                
                # Hladame prvy <row>
                row = root.find('.//data:row', namespaces)
                if row is not None:
                    lat_str = row.find('data:Lat', namespaces).text
                    lon_str = row.find('data:Lon', namespaces).text
                    
                    return {
                        "lat": float(lat_str),
                        "lon": float(lon_str)
                    }
                else:
                    print(f"  [CCS] Varovanie: Auto {vehicle_id} nevratilo ziadnu polohu (mozno je vypnute).")
                    return None
            else:
                print(f"  [CCS] API Chyba: {response.status_code}")
                return None
                
        except Exception as e:
            print(f"  [CCS] Zlyhalo pripojenie na server: {e}")
            return None

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