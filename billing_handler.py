from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta
import db_connector

billing_bp = Blueprint("billing", __name__)

def generate_doc_number(typ_dokladu):
    """Vygeneruje číslo dokladu, napr. FA-2026-0001 alebo DL-2026-0150"""
    rok = datetime.now().year
    prefix = f"{typ_dokladu}-{rok}-"
    
    # Nájdeme posledné číslo v databáze pre daný rok a typ
    sql = """
        SELECT cislo_dokladu FROM doklady_hlavicka 
        WHERE typ_dokladu = %s AND cislo_dokladu LIKE %s 
        ORDER BY id DESC LIMIT 1
    """
    row = db_connector.execute_query(sql, (typ_dokladu, f"{prefix}%"), fetch="one")
    
    if row and row['cislo_dokladu']:
        # Vytiahneme posledné 4 čísla a pripočítame 1
        posledne_cislo = int(row['cislo_dokladu'].split('-')[-1])
        nove_cislo = posledne_cislo + 1
    else:
        nove_cislo = 1
        
    return f"{prefix}{nove_cislo:04d}"

@billing_bp.get("/api/billing/uninvoiced_dls")
def get_uninvoiced_dls():
    """
    Vráti všetky Dodacie listy, ktoré ešte neboli vyfakturované, zoskupené podľa zákazníkov.
    """
    sql = """
        SELECT id, cislo_dokladu, zakaznik_id, odberatel_nazov, datum_vystavenia, suma_s_dph
        FROM doklady_hlavicka
        WHERE typ_dokladu = 'DL' AND nadradena_faktura_id IS NULL
        ORDER BY odberatel_nazov, datum_vystavenia
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    
    # Zoskupíme ich podľa zákazníka pre pohodlné zaklikávanie na frontende
    grouped = {}
    for r in rows:
        z_id = r['zakaznik_id']
        if z_id not in grouped:
            grouped[z_id] = {
                "zakaznik_id": z_id,
                "nazov": r['odberatel_nazov'],
                "dodaky": []
            }
        grouped[z_id]["dodaky"].append(r)
        
    return jsonify({"customers": list(grouped.values())})


@billing_bp.post("/api/billing/create_collective_invoice")
def create_collective_invoice():
    """
    Vytvorí Zbernú faktúru (FA) z vybraných Dodacích listov (DL).
    """
    data = request.get_json(force=True) or {}
    dl_ids = data.get("dl_ids", [])
    
    if not dl_ids:
        return jsonify({"error": "Neboli vybrané žiadne dodacie listy."}), 400

    # 1. Vytiahneme dáta prvého dodáku, aby sme mali údaje o zákazníkovi
    placeholders = ','.join(['%s'] * len(dl_ids))
    dls = db_connector.execute_query(
        f"SELECT * FROM doklady_hlavicka WHERE id IN ({placeholders})", 
        tuple(dl_ids), fetch="all"
    )
    
    if not dls:
        return jsonify({"error": "Dodacie listy sa nenašli."}), 404
        
    zakaznik_id = dls[0]['zakaznik_id']
    
    # Overíme, či všetky vybrané dodáky patria rovnakému zákazníkovi
    if any(dl['zakaznik_id'] != zakaznik_id for dl in dls):
        return jsonify({"error": "Zberná faktúra môže obsahovať len dodáky jedného zákazníka."}), 400

    # 2. Načítame detailné údaje zákazníka (Splatnosť, IČO...) z tabuľky b2b_zakaznici
    zakaznik = db_connector.execute_query(
        "SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s LIMIT 1", 
        (zakaznik_id,), fetch="one"
    ) or {}

    # Zrátame celkové sumy z dodákov
    total_bez_dph = sum(float(dl['suma_bez_dph']) for dl in dls)
    total_dph = sum(float(dl['suma_dph']) for dl in dls)
    total_s_dph = sum(float(dl['suma_s_dph']) for dl in dls)
    
    cislo_fa = generate_doc_number('FA')
    datum_vystavenia = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)
    datum_splatnosti = datum_vystavenia + timedelta(days=splatnost_dni)

    # === DATABÁZOVÁ TRANSAKCIA ===
    # Vložíme hlavičku FA
    fa_id = db_connector.execute_query("""
        INSERT INTO doklady_hlavicka 
        (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, 
        odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol)
        VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), 
        zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum_vystavenia, datum_vystavenia, datum_splatnosti,
        total_bez_dph, total_dph, total_s_dph, cislo_fa.replace('FA-', '').replace('-', '') # VS generujeme z čísla
    ), fetch="lastrowid")

    # Aktualizujeme staré Dodacie Listy - priradíme im ID tejto novej faktúry
    db_connector.execute_query(
        f"UPDATE doklady_hlavicka SET nadradena_faktura_id = %s WHERE id IN ({placeholders})",
        (fa_id, *dl_ids), fetch="none"
    )

    # Vložíme položky do faktúry (ako referenciu na DL)
    polozky = []
    for dl in dls:
        polozky.append((
            fa_id, f"Tovar podľa DL č. {dl['cislo_dokladu']}", 1, 'ks', 
            dl['suma_bez_dph'], 20.00, dl['suma_bez_dph'], dl['suma_s_dph']
        ))
        
    db_connector.execute_query("""
        INSERT INTO doklady_polozky 
        (doklad_id, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, polozky, multi=True, fetch="none")

    return jsonify({"message": f"Zberná faktúra {cislo_fa} bola úspešne vystavená.", "faktura_id": fa_id})
@billing_bp.post("/api/billing/create_dl_from_order")
def create_dl_from_order():
    """
    Preklopí B2B objednávku na Dodací list (DL) a odpíše tovar zo skladu.
    """
    data = request.get_json(force=True) or {}
    order_id = data.get("order_id")
    
    if not order_id:
        return jsonify({"error": "Chýba ID objednávky."}), 400

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)

        # 1. Načítame B2B objednávku
        cur.execute("SELECT * FROM b2b_objednavky WHERE id = %s", (order_id,))
        order = cur.fetchone()
        if not order:
            return jsonify({"error": "Objednávka neexistuje."}), 404

        # 2. Kontrola, či už nebol vystavený DL pre túto objednávku (VS = order_id)
        cur.execute("SELECT id FROM doklady_hlavicka WHERE typ_dokladu='DL' AND variabilny_symbol = %s", (str(order_id),))
        if cur.fetchone():
            return jsonify({"error": "Dodací list pre túto objednávku už bol vystavený!"}), 400

        # 3. Načítame zákazníka pre detailné údaje
        cur.execute("SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s", (order['zakaznik_id'],))
        zakaznik = cur.fetchone() or {}

        # 4. Vygenerujeme číslo a hlavičku DL
        cislo_dl = generate_doc_number('DL')
        datum_vystavenia = datetime.now().date()
        
        # Zistíme finálnu sumu objednávky (ak bola upravovaná po vážení)
        suma_bez_dph = order.get('finalna_suma_bez_dph') or order.get('celkova_suma_bez_dph') or 0
        suma_s_dph = order.get('finalna_suma_s_dph') or order.get('celkova_suma_s_dph') or 0
        
        cur.execute("""
            INSERT INTO doklady_hlavicka 
            (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, 
            odberatel_adresa, datum_vystavenia, datum_dodania, suma_bez_dph, suma_s_dph, variabilny_symbol)
            VALUES ('DL', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            cislo_dl, order['zakaznik_id'], order.get('nazov_firmy', ''), 
            zakaznik.get('ico'), zakaznik.get('dic'), zakaznik.get('ic_dph'), zakaznik.get('adresa'), 
            datum_vystavenia, datum_vystavenia, suma_bez_dph, suma_s_dph, str(order_id)
        ))
        dl_id = cur.lastrowid

        # 5. Načítame položky objednávky
        cur.execute("SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (order_id,))
        polozky = cur.fetchall()

        for p in polozky:
            mnozstvo = float(p.get('dodane_mnozstvo') or p.get('mnozstvo') or 0)
            if mnozstvo <= 0: continue # Preskočíme položky, ktoré sa nedodali
            
            cena_bez_dph = float(p.get('cena_skutocna') or p.get('cena_bez_dph') or 0)
            dph_perc = float(p.get('dph') or 20.0)
            celkom_bez_dph = mnozstvo * cena_bez_dph
            celkom_s_dph = celkom_bez_dph * (1 + (dph_perc / 100))

            # A. Zápis do položiek dokladu
            cur.execute("""
                INSERT INTO doklady_polozky 
                (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                dl_id, order_id, p['ean_produktu'], p['nazov_vyrobku'], mnozstvo, p['mj'], 
                cena_bez_dph, dph_perc, celkom_bez_dph, celkom_s_dph
            ))

            # B. Zápis do Skladového denníka (Mínusový pohyb)
            cur.execute("""
                INSERT INTO skladove_pohyby 
                (ean, nazov_vyrobku, typ_pohybu, mnozstvo, mj, doklad_id, predajna_cena_bez_dph)
                VALUES (%s, %s, 'VYDAJ_DL', %s, %s, %s, %s)
            """, (p['ean_produktu'], p['nazov_vyrobku'], -mnozstvo, p['mj'], dl_id, cena_bez_dph))

            # C. Odpis tovaru z Centrálneho skladu (tabuľka produkty)
            cur.execute("""
                UPDATE produkty 
                SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s 
                WHERE ean = %s
            """, (mnozstvo, p['ean_produktu']))

        conn.commit()
        return jsonify({"message": f"Dodací list {cislo_dl} bol úspešne vystavený a sklad zaktualizovaný.", "dl_id": dl_id})

    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": f"Chyba pri tvorbe DL: {str(e)}"}), 500
    finally:
        if conn:
            cur.close()
            conn.close()