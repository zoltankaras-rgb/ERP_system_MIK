import os
import io
from datetime import datetime
from . import db_connector  # prispôsob tvojej štruktúre

def _parse_number(val: str) -> float:
    if val is None:
        return 0.0
    s = val.strip().replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def process_erp_stock_bytes(raw_bytes: bytes) -> int:
    """
    Spracuje obsah ZASOBA.CSV (v podobe bytes).
    - REG_CIS -> EAN (strip nul zľava)
    - JCM11  -> cena bez DPH
    - MNOZ   -> nové množstvo na sklade
    Vráti počet úspešne aktualizovaných riadkov.
    """
    # Súbor je v CP1250, pevná šírka
    text = raw_bytes.decode("cp1250", errors="ignore")
    lines = text.splitlines()

    if not lines:
        return 0

    # prvý riadok je hlavička
    data_lines = lines[1:]

    conn = db_connector.get_connection()
    cur = conn.cursor()
    updated_count = 0

    try:
        for ln in data_lines:
            if not ln.strip():
                continue

            # 1) REG_CIS – pozície podľa reálneho súboru
            #    " REG_CIS       ..." -> na dátových riadkoch je: " 0000000023112 ..."
            reg_cis_raw = ln[1:14].strip()  # 13 znakov po úvodnej medzere
            if not reg_cis_raw:
                continue

            # 2) Zvyšok riadku: názov + 2 číselné stĺpce na konci
            rest = ln[15:].rstrip()
            try:
                nazov, jcm11_str, mnoz_str = rest.rsplit(maxsplit=2)
            except ValueError:
                # nevieme rozparsovať – preskočíme
                continue

            cena_bez_dph = _parse_number(jcm11_str)
            mnozstvo = _parse_number(mnoz_str)

            # 3) EAN normalizácia:
            #    - variant so všetkými nulami (napr. "0000000023112")
            #    - variant bez úvodných núl (napr. "23112")
            ean_full = reg_cis_raw
            ean_nozeros = reg_cis_raw.lstrip("0") or "0"

            # 4) UPDATE v DB – prispôsob názvy stĺpcov a tabuľky
            #    predpokladám tabuľku "produkty" a stĺpce:
            #    - ean (TEXT/VARCHAR)
            #    - cena_bez_dph
            #    - stav_na_sklade
            cur.execute(
                """
                UPDATE produkty
                SET cena_bez_dph = %s,
                    stav_na_sklade = %s
                WHERE ean = %s OR ean = %s
                """,
                (cena_bez_dph, mnozstvo, ean_full, ean_nozeros),
            )

            if cur.rowcount > 0:
                updated_count += 1

        conn.commit()
    finally:
        try:
            cur.close()
            conn.close()
        except Exception:
            pass

    return updated_count
