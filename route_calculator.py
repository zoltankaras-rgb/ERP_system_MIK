import os
import requests
from dotenv import load_dotenv

# Nacitanie premennych prostredia
load_dotenv()
ORS_API_KEY = os.getenv("ORS_API_KEY")

def vypocitaj_trasu(zastavky_gps):
    """
    zastavky_gps: zoznam suradnic vo formate [[lon1, lat1], [lon2, lat2], ...]
    """
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    
    headers = {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json'
    }
    
    # Oproti prvej verzii sme zrusili "instructions": False, 
    # aby nam server bezpecne poslal vsetky useky a casy
    body = {
        "coordinates": zastavky_gps
    }
    
    try:
        response = requests.post(url, json=body, headers=headers)
        
        # Osetrenie, ak by server vratil napriklad chybu s API klucom
        if response.status_code != 200:
            print(f"[-] API Zamietnute (Kod {response.status_code}): {response.text}")
            return None
            
        data = response.json()
        
        # Bezpecne nacitanie dat
        trasa = data.get('routes', [{}])[0]
        sekundy_celkom = trasa.get('summary', {}).get('duration', 0)
        metre_celkom = trasa.get('summary', {}).get('distance', 0)
        
        # Ziskanie casov medzi zastavkami
        useky_sekundy = []
        if 'segments' in trasa:
            useky_sekundy = [seg['duration'] for seg in trasa['segments']]
        else:
            useky_sekundy = [sekundy_celkom]
            
        return {
            "celkovy_cas_sekundy": sekundy_celkom,
            "celkova_vzdialenost_metre": metre_celkom,
            "trvanie_usekov_sekundy": useky_sekundy
        }
        
    except Exception as e:
        print(f"[-] Chyba pri spracovani trasy: {e}")
        return None

# ==========================================
# TESTOVACI SCENAR
# ==========================================
if __name__ == "__main__":
    if not ORS_API_KEY:
        print("CHYBA: ORS_API_KEY nie je nastaveny v .env subore!")
    else:
        print("Prebieha komunikacia so satelitom (ORS)...")
        
        testovacia_trasa = [
            [17.880655, 48.151759], # Start: MIK Sala
            [17.112165, 48.152865], # Zastavka 1: Bratislava
            [17.585785, 48.373264]  # Zastavka 2: Trnava
        ]
        
        vysledok = vypocitaj_trasu(testovacia_trasa)
        
        if vysledok:
            minuty_celkom = vysledok['celkovy_cas_sekundy'] / 60
            km_celkom = vysledok['celkova_vzdialenost_metre'] / 1000
            
            print("\n✅ MAPY FUNGUJU: Trasa uspesne vypocitana!")
            print(f"Celkovy hruby cas cesty: {minuty_celkom:.1f} minut")
            print(f"Celkova vzdialenost: {km_celkom:.1f} km")
            
            print("\nDetail cesty (Cisty cas jazdenia):")
            for i, usek in enumerate(vysledok['trvanie_usekov_sekundy']):
                print(f" - Usek {i+1}: {usek / 60:.1f} minut")