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

    Formát riadkov (pevná šírka, tak ako si posielal):

        REG_CIS       NAZOV                                       JCM11         MNOZ
        0000000023112 BR.KARE                                    3.7500     952.50
        0000000023116 BR.BOK                                     3.1500     -38.1480
        ...

    - REG_CIS  -> EAN (s nulami naľavo, napr. "0000000000008")
    - JCM11    -> cena bez DPH      -> zapisujeme do `produkty.nakupna_cena`
    - MNOZ     -> množstvo na sklade -> zapisujeme do `produkty.aktualny_sklad_finalny_kg`

    EAN mapujeme takto:
      - ean_digits = len číslice z REG_CIS
      - ean_full   = 13-miestny s nulami vľavo (napr. "0000000000008")
      - ean_short  = verzia bez úvodných núl (napr. "8")

    UPDATE potom prebieha cez:
        WHERE ean = ean_full OR ean = ean_short

    Funkcia vracia počet riadkov v tabuľke `produkty`, ktoré sa podarilo
    aktualizovať (t.j. počet produktov, kde UPDATE niečo našiel).
    """
    # Súbor z ERP býva v CP1250
    try:
        text = raw_bytes.decode("cp1250", errors="ignore")
    except Exception:
        # fallback keby náhodou prišlo UTF-8
        text = raw_bytes.decode("utf-8", errors="ignore")

    lines = text.splitlines()
    if len(lines) <= 1:
        return 0  # prázdne alebo len hlavička

    # prvý riadok je hlavička (REG_CIS NAZOV JCM11 MNOZ)
    data_lines = lines[1:]

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

            # keby sa náhodou v strede súboru objavila hlavička
            if "REG_CIS" in line.upper():
                continue

            # minimálna dĺžka, aby sa tam vošiel REG_CIS + zvyšok
            if len(line) < 30:
                continue

            # 1) REG_CIS – v dátových riadkoch je napr.:
            #    " 0000000023112 BR.KARE  3.7500  952.50"
            # prvý znak býva medzera, nasleduje 13 číslic
            reg_cis_raw = line[1:14].strip()
            if not reg_cis_raw:
                continue

            # 2) Zvyšok riadku: NAZOV + 2 číselné stĺpce na konci (JCM11, MNOZ)
            rest = line[15:].rstrip()
            try:
                nazov, jcm11_str, mnoz_str = rest.rsplit(maxsplit=2)
            except ValueError:
                # nevieme rozparsovať – radšej preskočíme
                continue

            cena_bez_dph = _parse_number(jcm11_str)
            mnozstvo = _parse_number(mnoz_str)

            # 3) EAN normalizácia – použijeme len číslice
            ean_digits = "".join(ch for ch in reg_cis_raw if ch.isdigit())
            if not ean_digits:
                continue

            # 13-miestny EAN s nulami vľavo (ERP štýl) + verzia bez núl
            ean_full = ean_digits.rjust(13, "0")[-13:]
            ean_short = ean_digits.lstrip("0") or ean_full

            # 4) UPDATE v DB – pracujeme s tabuľkou `produkty`
            #    - neprepisujeme názov ani typy, len:
            #      aktualny_sklad_finalny_kg = MNOZ
            #      nakupna_cena             = JCM11
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
                # rowcount je počet aktualizovaných riadkov (tu max 1),
                # ale pre "Spracovaných" nám stačí počítať produkty, ktoré sa našli.
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

    return updated_count
