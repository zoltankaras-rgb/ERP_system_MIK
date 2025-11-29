import db_connector


def _parse_number(val: str) -> float:
    """
    Bezpečné parsovanie čísla z textu:
    - odsekne medzery na krajoch
    - nahradí čiarku bodkou
    - pri chybe vráti 0.0
    """
    if val is None:
        return 0.0
    s = str(val).strip().replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def process_erp_stock_bytes(raw_bytes: bytes) -> int:
    """
    Spracuje obsah ZASOBA.CSV (v podobe bytes) a aktualizuje centrálny sklad
    v tabuľke `produkty`.

    Očakávaný formát riadkov (pevná šírka, ako v ZASOBA.CSV):

        REG_CIS       NAZOV                                       JCM11         MNOZ
        0000000023112 BR.KARE                                    3.7500     952.50
        ...

    - REG_CIS  -> EAN (s nulami naľavo, napr. "0000000000008")
    - JCM11    -> cena bez DPH      -> zapisujeme do `produkty.nakupna_cena`
    - MNOZ     -> množstvo na sklade -> zapisujeme do `produkty.aktualny_sklad_finalny_kg`

    EAN mapujeme takto:
      - ean_digits = len číslice z REG_CIS
      - ean_full   = 13-miestny s nulami vľavo (napr. "0000000000008")
      - ean_short  = verzia bez úvodných núl (napr. "8")

    UPDATE:
        WHERE ean = ean_full OR ean = ean_short

    Funkcia vracia počet riadkov, ktoré sa podarilo aktualizovať.
    """
    # DEBUG – nech vidíme, že sa funkcia naozaj volá
    print(">>> process_erp_stock_bytes CALLED, raw_bytes len =", len(raw_bytes))

    # Súbor z ERP býva v CP1250
    try:
        text = raw_bytes.decode("cp1250", errors="ignore")
    except Exception:
        text = raw_bytes.decode("utf-8", errors="ignore")

    lines = text.splitlines()
    if len(lines) <= 1:
        print(">>> process_erp_stock_bytes: málo riadkov (len hlavička?)")
        return 0

    data_lines = lines[1:]  # prvý riadok je hlavička

    conn = db_connector.get_connection()
    cur = conn.cursor()
    updated_count = 0

    try:
        for ln in data_lines:
            if not ln.strip():
                continue

            line = ln.rstrip("\r\n")
            if not line.strip():
                continue

            if "REG_CIS" in line.upper():
                # keby niekde uprostred bol znova header
                continue

            if len(line) < 30:
                continue

            # REG_CIS – " 0000000023112 BR.KARE  3.7500  952.50"
            reg_cis_raw = line[1:14].strip()
            if not reg_cis_raw:
                continue

            rest = line[15:].rstrip()
            try:
                nazov, jcm11_str, mnoz_str = rest.rsplit(maxsplit=2)
            except ValueError:
                print(">>> process_erp_stock_bytes: nepodarilo sa rsplit pre riadok:", line)
                continue

            cena_bez_dph = _parse_number(jcm11_str)
            mnozstvo = _parse_number(mnoz_str)

            # EAN – len číslice
            ean_digits = "".join(ch for ch in reg_cis_raw if ch.isdigit())
            if not ean_digits:
                continue

            ean_full = ean_digits.rjust(13, "0")[-13:]
            ean_short = ean_digits.lstrip("0") or ean_full

            cur.execute(
                """
                UPDATE produkty
                   SET aktualny_sklad_finalny_kg = %s,
                       nakupna_cena             = %s
                 WHERE ean = %s
                    OR ean = %s
                """,
                (mnozstvo, cena_bez_dph, ean_full, ean_short),
            )

            if cur.rowcount > 0:
                updated_count += cur.rowcount

        conn.commit()

    finally:
        try:
            cur.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass

    print(">>> process_erp_stock_bytes DONE, updated_count =", updated_count)
    return updated_count
