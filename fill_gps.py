import os
import time
import requests
import mysql.connector
from dotenv import load_dotenv

# Nacitanie premennych z .env suboru
load_dotenv()

DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_USER = os.getenv('DB_USER', 'root')
DB_PASS = os.getenv('DB_PASSWORD')
DB_NAME = os.getenv('DB_NAME', 'vyrobny_system')

def geocode_address(address):
    """Ziska GPS z OpenStreetMap bez pouzitia plateneho Google Maps API."""
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        'q': address,
        'format': 'json',
        'limit': 1
    }
    # OpenStreetMap vyzaduje, aby sme sa slusne "predstavili" v hlavicke
    headers = {
        'User-Agent': 'MIK_ERP_Logistika/1.0'
    }
    
    try:
        response = requests.get(url, params=params, headers=headers)
        data = response.json()
        if data:
            return float(data[0]['lat']), float(data[0]['lon'])
    except Exception as e:
        pass
    
    return None, None

def fill_coordinates():
    if not DB_PASS:
        print("Chyba: DB_PASSWORD nie je nastavene v .env subore!")
        return

    try:
        # 1. Pripojime sa do MySQL
        conn = mysql.connector.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor(dictionary=True)
        
        # 2. Vytiahneme len tych, co maju prazdne GPS
        cursor.execute("SELECT id, adresa_dorucenia, adresa, nazov_firmy FROM b2b_zakaznici WHERE lat IS NULL OR lon IS NULL")
        zakaznici = cursor.fetchall()
        
        print(f"Nasiel som {len(zakaznici)} zakaznikov bez GPS. Zacinam hladat na mape...\n")
        
        uspesni = 0
        
        # 3. Cyklus cez vsetkych zakaznikov
        for z in zakaznici:
            # Ak nema adresu dorucenia, pouzijeme fakturacnu adresu
            adresa = z['adresa_dorucenia'] if z['adresa_dorucenia'] else z['adresa']
            
            if not adresa:
                print(f"[-] {z['nazov_firmy']}: Nema vyplnenu ziadnu adresu v systeme.")
                continue
                
            print(f"Hladam: {adresa} ({z['nazov_firmy']})")
            lat, lon = geocode_address(adresa)
            
            if lat and lon:
                # Ulozime vysledok priamo do databazy
                update_query = "UPDATE b2b_zakaznici SET lat = %s, lon = %s WHERE id = %s"
                cursor.execute(update_query, (lat, lon, z['id']))
                conn.commit()
                uspesni += 1
                print(f"  [+] ULOZENE: {lat}, {lon}")
            else:
                print("  [x] Adresu sa nepodarilo najst na mape.")
                
            # Povinna 1-sekundova pauza pre bezplatne API OpenStreetMap
            time.sleep(1)
            
        print(f"\n--- HOTOVO! Uspesne prelozenych a ulozenych {uspesni} adries. ---")
            
    except mysql.connector.Error as err:
        print(f"Kriticka chyba databazy: {err}")
    finally:
        if 'conn' in locals() and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    fill_coordinates()