import math

def vypocitaj_vzdialenost(lat1, lon1, lat2, lon2):
    """
    Vypocita vzdialenost medzi dvoma GPS bodmi v metroch pomocou Haversinovej rovnice.
    lat1, lon1 = GPS poloha auta
    lat2, lon2 = GPS poloha zakaznika
    """
    # Polomer Zeme v metroch (priblizne 6 371 km)
    R = 6371000.0

    # Prevod stupnov na radiany (matematika potrebuje radiany)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    # Samotna Haversinova rovnica
    a = math.sin(delta_phi / 2.0)**2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0)**2
    
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    # Vysledna vzdialenost v metroch
    vzdialenost_metre = R * c
    return vzdialenost_metre


def skontroluj_vykladku(auto_lat, auto_lon, zakaznik_lat, zakaznik_lon, tolerovana_zona=50):
    """
    Vyhodnoti, ci auto voslo do zony zakaznika.
    Defaultna tolerovana zona je 50 metrov.
    """
    vzdialenost = vypocitaj_vzdialenost(auto_lat, auto_lon, zakaznik_lat, zakaznik_lon)
    
    print(f"Auto je od zakaznika vzdialene: {vzdialenost:.1f} metrov")
    
    if vzdialenost <= tolerovana_zona:
        print("✅ STATUS: Auto je v zone! Mozeme odskrtnut vykladku.")
        return True
    else:
        print("❌ STATUS: Auto je este na ceste.")
        return False

# ==========================================
# TESTOVACI SCENAR (Mozete si upravit GPS body)
# ==========================================
if __name__ == "__main__":
    # Povedzme, ze zakaznik (skolska jedalen) sidli tu:
    zakaznik_gps = (48.152865, 17.112165)
    
    # Situacia 1: Auto je este o ulicu dalej (napr. v zapche)
    auto_gps_1 = (48.153900, 17.113500)
    print("\n--- TEST 1: Auto sa blizi k zakaznikovi ---")
    skontroluj_vykladku(auto_gps_1[0], auto_gps_1[1], zakaznik_gps[0], zakaznik_gps[1], tolerovana_zona=50)

    # Situacia 2: Auto zaparkovalo pred rampou u zakaznika
    auto_gps_2 = (48.152900, 17.112200)
    print("\n--- TEST 2: Auto parkuje pred prevadzkou ---")
    skontroluj_vykladku(auto_gps_2[0], auto_gps_2[1], zakaznik_gps[0], zakaznik_gps[1], tolerovana_zona=50)