# check_fleet_dates.py
import os
from datetime import date, timedelta, datetime
from dotenv import load_dotenv

load_dotenv()
import db_connector
import notification_handler

# !!! NASTAVTE SI SVOJE ČÍSLO PRE SMS !!!
ADMIN_PHONE_NUMBER = os.getenv("ADMIN_PHONE_NUMBER", "09xx123456") 

def check_and_notify():
    print("Spúšťam kontrolu termínov vozového parku...")
    vehicles = db_connector.execute_query("SELECT * FROM fleet_vehicles WHERE is_active=1")
    if not vehicles:
        return

    today = date.today()
    limit_30 = today + timedelta(days=30)
    alerts = []

    for v in vehicles:
        plate = v.get('license_plate') or '?'
        
        def parse_d(val):
            if not val: return None
            if isinstance(val, (date, datetime)):
                return val.date() if isinstance(val, datetime) else val
            if isinstance(val, str):
                try: return datetime.strptime(str(val), '%Y-%m-%d').date()
                except: return None
            return None

        # Kontrola STK
        stk = parse_d(v.get('stk_valid_until'))
        if stk:
            if stk < today:
                alerts.append(f"VOZIDLO {plate}: STK EXPIROVALA {stk}!")
            elif stk <= limit_30:
                diff = (stk - today).days
                # Posielame SMS v tieto kľúčové dni:
                if diff in [30, 14, 7, 3, 1]:
                    alerts.append(f"VOZIDLO {plate}: STK končí o {diff} dní ({stk})")

        # Kontrola Známky
        vig = parse_d(v.get('vignette_valid_until'))
        if vig:
            if vig < today:
                alerts.append(f"VOZIDLO {plate}: Známka EXPIROVALA {vig}!")
            elif vig <= limit_30:
                diff = (vig - today).days
                if diff in [30, 14, 7, 3, 1]:
                    alerts.append(f"VOZIDLO {plate}: Známka končí o {diff} dní ({vig})")

    if alerts:
        print(f"Odosielam {len(alerts)} upozornení...")
        notification_handler.send_fleet_expiry_alert_batch(alerts, admin_phone=ADMIN_PHONE_NUMBER)
    else:
        print("Všetko v poriadku.")

if __name__ == "__main__":
    check_and_notify()