import os
from dotenv import load_dotenv
from zeep import Client

load_dotenv()

CCS_USERNAME = os.getenv('CCS_API_USERNAME')
CCS_PASSWORD = os.getenv('CCS_API_PASSWORD')
CCS_FIRM_CONTEXT = os.getenv('CCS_API_FIRM_CONTEXT')
CCS_WSDL_URL = 'https://www.imonitor.cz/imonws/basews.asmx?wsdl'

def test_ccs_raw():
    print("Odosielam poziadavku na CCS...")
    try:
        client = Client(CCS_WSDL_URL)
        response = client.service.GetDataAuth(
            userName=CCS_USERNAME,
            password=CCS_PASSWORD,
            firmNameContext=CCS_FIRM_CONTEXT,
            Nazev_procedury='QWS_Get_all_vehicles_ext_number',
            Parametry=None
        )
        
        print("\n=== SUROVE XML Z CCS ===")
        print(response)
        print("========================\n")

    except Exception as e:
        print(f"Kriticka chyba: {e}")

if __name__ == "__main__":
    test_ccs_raw()