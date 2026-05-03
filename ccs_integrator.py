import os
import json
from dotenv import load_dotenv
from zeep import Client

# Nacitanie premennych prostredia
load_dotenv()

CCS_USERNAME = os.getenv('CCS_API_USERNAME')
CCS_PASSWORD = os.getenv('CCS_API_PASSWORD')
CCS_FIRM_CONTEXT = os.getenv('CCS_API_FIRM_CONTEXT')

# Sem dame tu novu URL adresu s ?wsdl na konci
CCS_WSDL_URL = 'https://www.imonitor.cz/imonws/basews.asmx?wsdl' 

def test_ccs_connection():
    print(f"Pokusam sa pripojit na CCS API: {CCS_WSDL_URL}")
    
    try:
        # Inicializacia SOAP klienta
        client = Client(CCS_WSDL_URL)
        
        # Volanie metody GetDataAuth (podla toho Word dokumentu, co ste poslali)
        response = client.service.GetDataAuth(
            userName=CCS_USERNAME,
            password=CCS_PASSWORD,
            firmNameContext=CCS_FIRM_CONTEXT,
            Nazev_procedury='QWS_Get_all_vehicles_ext_number',
            Parametry=None 
        )
        
        print("\n--- Odpoved z CCS ---")
        print(response)
        print("---------------------\n")
        
        print("Spojenie uspesne!")
        return response

    except Exception as e:
        print(f"Chyba pri pripajani: {e}")
        return None

if __name__ == "__main__":
    test_ccs_connection()