import os
import requests
from dotenv import load_dotenv

# Nacitanie premennych
load_dotenv()

CCS_USERNAME = os.getenv('CCS_API_USERNAME')
CCS_PASSWORD = os.getenv('CCS_API_PASSWORD')
CCS_FIRM_CONTEXT = os.getenv('CCS_API_FIRM_CONTEXT')
# Tu uz nepouzivame ?wsdl, posielame to priamo na koncovy bod
CCS_URL = 'https://www.imonitor.cz/imonws/basews.asmx' 

def test_raw_post():
    # Presny XML format podla dokumentacie CCS
    soap_request = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetVehiclesList xmlns="http://ccs.cz/WS">
      <userName>{CCS_USERNAME}</userName>
      <password>{CCS_PASSWORD}</password>
      <firmNameContext>{CCS_FIRM_CONTEXT}</firmNameContext>
    </GetVehiclesList>
  </soap:Body>
</soap:Envelope>"""

    # Nastavenie hlaviciek presne podla ich HTTP poziadavky
    headers = {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"http://ccs.cz/WS/GetVehiclesList"'
    }

    print(f"Odosielam priamy POST na {CCS_URL} ...")
    
    try:
        # Odoslanie poziadavky
        response = requests.post(CCS_URL, data=soap_request.encode('utf-8'), headers=headers)
        
        print(f"\nHTTP Status Kod: {response.status_code} (Ak je 200, je to super!)")
        print("\n=== SUROVA ODPOVED ZO SERVERA CCS ===")
        print(response.text)
        print("=======================================\n")
        
    except Exception as e:
        print(f"Chyba: {e}")

if __name__ == "__main__":
    test_raw_post()