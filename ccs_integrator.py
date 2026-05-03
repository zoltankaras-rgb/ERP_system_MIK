import os
import json
import xml.etree.ElementTree as ET
from dotenv import load_dotenv
from zeep import Client

# Nacitanie premennych prostredia
load_dotenv()

CCS_USERNAME = os.getenv('CCS_API_USERNAME')
CCS_PASSWORD = os.getenv('CCS_API_PASSWORD')
CCS_FIRM_CONTEXT = os.getenv('CCS_API_FIRM_CONTEXT')
CCS_WSDL_URL = 'https://www.imonitor.cz/imonws/basews.asmx?wsdl'

def parse_ccs_xml(xml_string):
    """
    Spracuje XML z CCS a ignoruje schemu, hlada realne data (NewDataSet/Table).
    """
    if not xml_string:
        return []

    try:
        root = ET.fromstring(xml_string)
        results = []
        
        # DataSet od Microsoftu zvycajne zabali data do elementu, ktory nema namespace,
        # alebo ho ma nastaveny na nejaku specificku hodnotu. 
        # Budeme hladat elementy na urovni pod rootom, ktore NIE SU schema.
        for child in root:
            # Ignorujeme cast so schemou
            if 'schema' in child.tag:
                continue
                
            # Tu zacinaju data. Zvycajne je to tag <Table> alebo <Polozka>
            # Prechadzame vsetky riadky (vsetky deti tohto 'data' elementu)
            for row in child:
                row_data = {}
                # Prechadzame stlpce v riadku
                for field in row:
                    # Ocistime nazov tagu od zbytocnych mennych priestorov (namespace)
                    tag_name = field.tag.split('}')[-1] if '}' in field.tag else field.tag
                    row_data[tag_name] = field.text
                
                if row_data:
                    results.append(row_data)
                    
        return results
    except Exception as e:
        print(f"Chyba pri spracovani XML: {e}")
        return []

def test_ccs_connection():
    print(f"Pokusam sa pripojit na CCS API: {CCS_WSDL_URL}")
    print(f"Ako uzivatel: {CCS_USERNAME}")
    
    try:
        client = Client(CCS_WSDL_URL)
        
        # SKUSKA 1: Ziskame strukturu firmy (mali by sme tam vidiet D1, S1)
        print("\n--- Zistujem strukturu firmy (QWS_Get_company_ext_number) ---")
        resp_company = client.service.GetDataAuth(
            userName=CCS_USERNAME,
            password=CCS_PASSWORD,
            firmNameContext=CCS_FIRM_CONTEXT,
            Nazev_procedury='QWS_Get_company_ext_number',
            Parametry=None 
        )
        parsed_company = parse_ccs_xml(resp_company)
        print(json.dumps(parsed_company, indent=4, ensure_ascii=False))


        # SKUSKA 2: Ziskame vsetky vozidla
        print("\n--- Zistujem zoznam vozidiel (QWS_Get_all_vehicles_ext_number) ---")
        resp_vehicles = client.service.GetDataAuth(
            userName=CCS_USERNAME,
            password=CCS_PASSWORD,
            firmNameContext=CCS_FIRM_CONTEXT,
            Nazev_procedury='QWS_Get_all_vehicles_ext_number',
            Parametry=None 
        )
        parsed_vehicles = parse_ccs_xml(resp_vehicles)
        print(json.dumps(parsed_vehicles, indent=4, ensure_ascii=False))


    except Exception as e:
        print(f"Kriticka chyba pri komunikacii: {e}")

if __name__ == "__main__":
    test_ccs_connection()