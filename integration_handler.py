import os
from datetime import datetime
import traceback
from pathlib import Path
import db_connector
from decimal import Decimal, ROUND_HALF_UP

# --- KONFIGURÁCIA ---
env_path = os.getenv("ERP_EXCHANGE_DIR", "/var/app/data/erp_exchange")
BASE_PATH = Path(env_path)
EXPORT_FOLDER = BASE_PATH
IMPORT_FOLDER = BASE_PATH

def generate_daily_receipt_export(date_str):
    """
    Vygeneruje súbor VYROBKY.CSV pre daný dátum (uzávierka dňa v expedícii).
    Pevný formát (Fixed-Width) kompatibilný so ZASOBA.CSV.
    """
    if not date_str:
        return {"error": "Chýba dátum."}

    # Názov súboru zmenený presne na VYROBKY.CSV
    file_name = "VYROBKY.CSV"
    file_path = EXPORT_FOLDER / file_name

    target_types = ["VÝROBOK", "VÝROBOK_KRAJANY", "VÝROBOK_KRÁJANÝ", "VÝROBOK_KUSOVY", "VÝROBOK_KUSOVÝ", "TOVAR", "TOVAR_KUSOVY"]
    placeholders = ", ".join(["%s"] * len(target_types))

    # Dynamické zistenie stĺpca pre názov výrobku vo výrobe
    try:
        r = db_connector.execute_query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='zaznamy_vyroba' AND COLUMN_NAME='nazov_vyrobu' LIMIT 1", fetch='one')
        zv_col = 'nazov_vyrobu' if r else 'nazov_vyrobku'
    except:
        zv_col = 'nazov_vyrobku'

    sql = f"""
        SELECT
            p.ean,
            p.nazov_vyrobku,
            SUM(
                CASE
                    WHEN ep.unit = 'ks' THEN COALESCE(ep.prijem_ks, 0)
                    ELSE COALESCE(ep.prijem_kg, 0)
                END
            ) AS qty,
            (
                COALESCE(
                    (
                        SELECT zv2.cena_za_jednotku
                          FROM zaznamy_vyroba zv2
                         WHERE TRIM(zv2.{zv_col}) = TRIM(p.nazov_vyrobku)
                           AND zv2.cena_za_jednotku > 0
                         ORDER BY zv2.datum_ukoncenia DESC, zv2.id_davky DESC
                         LIMIT 1
                    ),
                    p.nakupna_cena,
                    0.0000
                ) * 1.25
            ) AS price_with_margin
        FROM expedicia_prijmy ep
        JOIN zaznamy_vyroba zv ON zv.id_davky = ep.id_davky
        JOIN produkty p ON TRIM(zv.{zv_col}) = TRIM(p.nazov_vyrobku)
        WHERE ep.is_deleted = 0
          AND ep.datum_prijmu = %s
          AND p.typ_polozky IN ({placeholders})
        GROUP BY p.ean, p.nazov_vyrobku
        HAVING qty <> 0
        ORDER BY p.nazov_vyrobku
    """
    
    params = (date_str, *target_types)

    try:
        os.makedirs(EXPORT_FOLDER, exist_ok=True)
        rows = db_connector.execute_query(sql, params, fetch='all') or []

        # ZÁPIS VO FIXNOM FORMÁTE (Presne 77 znakov na riadok)
        with open(file_path, "w", encoding="cp1250", newline="\r\n") as f:
            header = " REG_CIS       NAZOV                                       JCM11         MNOZ"
            f.write(header + "\r\n")

            for r in rows:
                ean_raw = str(r.get("ean") or "").strip()
                ean_digits = "".join(ch for ch in ean_raw if ch.isdigit())
                if not ean_digits: continue
                
                # 1. EAN (15 znakov: medzera + 13 čísel + medzera)
                ean13 = ean_digits.rjust(13, "0")[-13:]
                ean_field = f" {ean13} "

                # 2. NÁZOV (42 znakov, zarovnané vľavo)
                name = str(r.get("nazov_vyrobku") or "").strip()
                name_field = name[:42].ljust(42)

                # 3. CENA (7 znakov, zarovnané vpravo, 4 desatinné miesta)
                try:
                    price_val = Decimal(str(r.get("price_with_margin") or 0))
                    price_fmt = price_val.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
                    price_field = f"{price_fmt:.4f}".rjust(7)
                except Exception:
                    price_field = " 0.0000"

                # 4. MNOŽSTVO (13 znakov, zarovnané vpravo, 4 desatinné miesta)
                try:
                    qty_val = Decimal(str(r.get("qty") or 0))
                    qty_fmt = qty_val.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
                    qty_field = f"{qty_fmt:.4f}".rjust(13)
                except Exception:
                    qty_field = "       0.0000"

                line = f"{ean_field}{name_field}{price_field}{qty_field}\r\n"
                f.write(line)

        print(f">>> Export VYROBKY.CSV úspešný: {file_path}")
        return {"success": True, "file_path": str(file_path)}

    except Exception as e:
        print(f"!!! Export Error: {traceback.format_exc()}")
        return {"error": str(e)}

# --- Pôvodná funkcia pre import (ponechaná pre kompatibilitu) ---
def process_stock_update_import():
    try:
        file_path = IMPORT_FOLDER / 'sklad.csv'
        if not os.path.exists(file_path):
            return {"error": f"Importný súbor nebol nájdený: {file_path}"}
        
        updates = []
        with open(file_path, 'r', newline='', encoding='cp1250') as csvfile:
            import csv
            reader = csv.reader(csvfile, delimiter=';')
            next(reader, None)  
            for row in reader:
                if len(row) >= 2:
                    ean = row[0]
                    qty_str = row[1].replace(',', '.')
                    try:
                        updates.append((float(qty_str), ean))
                    except: pass

        if not updates:
            return {"message": "Žiadne dáta na import."}

        db_connector.execute_query(
            "UPDATE produkty SET aktualny_sklad_finalny_kg = %s WHERE ean = %s",
            updates, fetch='none', multi=True
        )
        return {"message": f"Aktualizovaných {len(updates)} produktov."}
    except Exception as e:
        return {"error": str(e)}