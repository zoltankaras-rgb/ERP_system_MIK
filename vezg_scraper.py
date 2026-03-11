import requests
from bs4 import BeautifulSoup
import re
from datetime import date
from models import db, CenaVezg
import logging

log = logging.getLogger("erp-scraper")

def fetch_vezg_prices():
    url = "https://www.vezg.de/preisinfo-schweine.html"
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        text = soup.get_text()
        
        # Hľadanie cien vo formáte "1,70"
        current_match = re.search(r"AutoFOM-Preisfaktor:\s*(\d+,\d+)\s*€", text)
        prev_match = re.search(r"Vorwochenpreis\s*(\d+,\d+)\s*€", text)
        
        if current_match and prev_match:
            # Konverzia nemeckého formátu na float (desatinná čiarka na bodku)
            curr_price = float(current_match.group(1).replace(',', '.'))
            prev_price = float(prev_match.group(1).replace(',', '.'))
            
            nova_cena = CenaVezg(
                datum_zaznamu=date.today(),
                cena_aktualna=curr_price,
                cena_minula=prev_price
            )
            db.session.add(nova_cena)
            db.session.commit()
            log.info(f"VEZG cena úspešne uložená: Aktuálna {curr_price} €, Minulá {prev_price} €")
        else:
            log.error("Nepodarilo sa nájsť ceny v štruktúre HTML. Štruktúra stránky sa mohla zmeniť.")
            
    except Exception as e:
        log.error(f"Chyba pri sťahovaní VEZG cien: {e}")