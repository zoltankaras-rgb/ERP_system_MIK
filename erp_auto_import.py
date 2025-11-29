#!/usr/bin/env python3
import os
from datetime import datetime
from erp_import import process_erp_stock_bytes

# Rovnaký adresár, kde sync skript nahráva ZASOBA.CSV
ERP_EXCHANGE_DIR = os.getenv("ERP_EXCHANGE_DIR", "/var/app/static/erp_exchange")

IMPORT_BASENAME = "ZASOBA.CSV"   # ak budeš chcieť hľadať napr. SKLAD_*.CSV, vieme upraviť

def find_import_file():
    """
    Hľadáme ZASOBA.CSV, prípadne prvý .csv súbor obsahujúci 'sklad' v názve.
    """
    path = os.path.join(ERP_EXCHANGE_DIR, IMPORT_BASENAME)
    if os.path.exists(path):
        return path

    # fallback – nájsť prvý .csv, v názve 'sklad'
    for name in os.listdir(ERP_EXCHANGE_DIR):
        lower = name.lower()
        if not lower.endswith(".csv"):
            continue
        if "sklad" in lower:
            return os.path.join(ERP_EXCHANGE_DIR, name)

    return None

def main():
    os.makedirs(ERP_EXCHANGE_DIR, exist_ok=True)

    full_path = find_import_file()
    if not full_path:
        print(f"[{datetime.now()}] AUTO_IMPORT: Nenašiel som ZASOBA.CSV ani *sklad*.csv v {ERP_EXCHANGE_DIR}")
        return

    print(f"[{datetime.now()}] AUTO_IMPORT: Spracúvam súbor {full_path}")

    with open(full_path, "rb") as f:
        raw = f.read()

    processed = process_erp_stock_bytes(raw)
    print(f"[{datetime.now()}] AUTO_IMPORT: Spracovaných {processed} riadkov")

    # presunieme do archívu
    archive_dir = os.path.join(ERP_EXCHANGE_DIR, "archive")
    os.makedirs(archive_dir, exist_ok=True)
    base = os.path.basename(full_path)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_path = os.path.join(archive_dir, f"{ts}_{base}")
    os.rename(full_path, archive_path)
    print(f"[{datetime.now()}] AUTO_IMPORT: Súbor presunutý do {archive_path}")


if __name__ == "__main__":
    main()
