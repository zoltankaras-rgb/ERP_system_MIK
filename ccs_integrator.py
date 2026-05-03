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

def extract_vehicles_from_xml(xml_element):
    """
    Vyberie data vozidiel zo specifickej struktury CCS.
    Podla dokumentacie to ma strukturu: 
    <DataVehiclesList><rows><row><ID_vozidlo>...</ID_vozidlo>...
    """
    vehicles = []
    
    # Zeep nam vrati objekt (nie cisty string). 
    # V tomto pripade, kedze ide o vnutorny XML element, zvycajne pride ako list lxml Elementov.
    if not xml_element:
        return []

    try:
        # Prechadzame strukturu. Casto byva obalena v jednom hlavnom elemente.
        for child in xml_element:
            # Hladame element 'rows', ktory obsahuje nase 'row'
            if 'rows' in child.tag:
                for row in child:
                    if 'row' in row.tag:
                        vehicle_data = {}
                        for field in row:
                            # Ocistime nazov tagu (ak ma namespace)
                            tag_name = field.tag.split('}')[-1] if '}' in field.tag else field.tag
                            vehicle_data[tag_name] = field.text
                        
                        if vehicle_data:
                            vehicles.append(vehicle_data)
                            
        return vehicles

    except Exception as e:
        print(f"Chyba pri parsovani vozidiel: {e}")
        return []

def get_ccs_vehicles():
    print(f"Pripajam sa na CCS: {CCS_WSDL_URL}")
    print(f"Uzivatel: {CCS_USERNAME}")
    print("-" * 30)
    
    try:
        client = Client(CCS_WSDL_URL)
        
        # Volame presne metodu GetVehiclesList podla vasej dokumentacie
        response = client.service.GetVehiclesList(
            userName=CCS_USERNAME,
            password=CCS_PASSWORD,
            firmNameContext=CCS_FIRM_CONTEXT
        )
        
        print("Surova odpoved prijata, analyzujem...\n")
        
        # 'response' z tejto metody zvycajne obsahuje priamo XML elementy (_any_1)
        # Pokusime sa ich spracovat.
        if hasattr(response, '_value_1'):
             parsed_data = extract_vehicles_from_xml(response._value_1)
        else:
             parsed_data = extract_vehicles_from_xml(response)


        if not parsed_data:
            print("Zoznam je prazdny. Skontrolujte strukturu surovin dat:")
            print(response)
        else:
            print("--- ZOZNAM VOZIDIEL (JSON) ---")
            print(json.dumps(parsed_data, indent=4, ensure_ascii=False))
            print("-" * 30)
            
        return parsed_data

    except Exception as e:
        print(f"Kriticka chyba komunikacie: {e}")
        return None

if __name__ == "__main__":
    get_ccs_vehicles()