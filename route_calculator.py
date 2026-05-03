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
    # Pouzivame profil pre dodavky/auta (driving-car). 
    # Ak mate kamiony nad 3.5t, da sa to zmenit na 'driving-hgv'
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    
    headers = {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json'
    }
    
    body = {
        "coordinates": zastavky_gps,
        "instructions": False  # Nepotrebujeme texty ako "odbocte doprava", stacia nam cisla
    }
    
    try:
        response = requests.post(url, json=body, headers=headers)
        data = response.json()
        
        if 'error' in data:
            print(f"[-] Chyba ORS API: {data['error']['message']}")
            return None
            
        # Ziskame data o celej trase z odpovede
        trasa = data['routes'][0]
        sekundy_celkom = trasa['summary']['duration']
        metre_celkom = trasa['summary']['distance']
        
        # Casove useky medzi jednotlivymi zastavkami
        # Toto je pre nas najdolezitejsie, zisti to cas od jedneho zakaznika k druhemu
        useky_sekundy = [seg['duration'] for seg in trasa['segments']]
        
        return {
            "celkovy_cas_sekundy": sekundy_celkom,
            "celkova_vzdialenost_metre": metre_celkom,
            "trvanie_usekov_sekundy": useky_sekundy
        }
        
    except Exception as e:
        print(f"[-] Chyba pripojenia na mapovy server: {e}")
        return None

# ==========================================
# TESTOVACI SCENAR
# ==========================================
if __name__ == "__main__":
    if not ORS_API_KEY:
        print("CHYBA: ORS_API_KEY nie je nastaveny v .env subore!")
    else:
        print("Prebieha komunikacia so satelitom (ORS)...")
        
        # Test: Start z MIK Sala -> Zakaznik 1 v BA -> Zakaznik 2 v TT
        # Suradnice davame ako [Dlzka(Lon), Sirka(Lat)]
        testovacia_trasa = [
            [17.880655, 48.151759], # Start: Sala
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
            
            print("\nDetail cesty:")
            print(f" - Zo Sale k prvemu zakaznikovi: {vysledok['trvanie_usekov_sekundy'][0] / 60:.1f} minut")
            print(f" - Od prveho k druhemu zakaznikovi: {vysledok['trvanie_usekov_sekundy'][1] / 60:.1f} minut")