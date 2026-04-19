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

@billing_bp.post("/api/billing/create_collective_invoice")
def create_collective_invoice():
    """
    Vytvorí Zbernú faktúru (FA) z vybraných objednávok (predtým dodacích listov).
    """
    data = request.get_json(force=True) or {}
    order_ids = data.get("dl_ids", [])  # Front-end posiela 'dl_ids', ale v našom novom modeli sú to ID objednávok
    
    if not order_ids:
        return jsonify({"error": "Neboli vybrané žiadne objednávky na fakturáciu."}), 400

    # 1. Vytiahneme dáta objednávok, aby sme mali údaje o zákazníkovi
    placeholders = ','.join(['%s'] * len(order_ids))
    orders = db_connector.execute_query(
        f"SELECT * FROM b2b_objednavky WHERE id IN ({placeholders})", 
        tuple(order_ids), fetch="all"
    )
    
    if not orders:
        return jsonify({"error": "Objednávky sa nenašli."}), 404
        
    zakaznik_id = orders[0]['zakaznik_id']
    
    # Overíme, či všetky vybrané objednávky patria rovnakému zákazníkovi
    if any(o['zakaznik_id'] != zakaznik_id for o in orders):
        return jsonify({"error": "Zberná faktúra môže obsahovať len objednávky jedného zákazníka."}), 400

    # 2. Načítame detailné údaje zákazníka (Splatnosť, IČO...) z tabuľky b2b_zakaznici
    zakaznik = db_connector.execute_query(
        "SELECT * FROM b2b_zakaznici WHERE zakaznik_id = %s LIMIT 1", 
        (zakaznik_id,), fetch="one"
    ) or {}

    # Zrátame celkové sumy z objednávok (použijeme finalna_suma ak existuje, inak celkova_suma)
    total_bez_dph = 0
    total_s_dph = 0
    
    for o in orders:
        s_bez = float(o.get('finalna_suma_bez_dph') or o.get('celkova_suma_bez_dph') or 0)
        s_dph = float(o.get('finalna_suma_s_dph') or o.get('celkova_suma_s_dph') or 0)
        total_bez_dph += s_bez
        total_s_dph += s_dph
        
    total_dph = total_s_dph - total_bez_dph
    
    cislo_fa = generate_doc_number('FA')
    datum_vystavenia = datetime.now().date()
    splatnost_dni = int(zakaznik.get('splatnost_dni') or 14)
    datum_splatnosti = datum_vystavenia + timedelta(days=splatnost_dni)

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor(dictionary=True)
        
        # === DATABÁZOVÁ TRANSAKCIA ===
        # Vložíme hlavičku FA
        cur.execute("""
            INSERT INTO doklady_hlavicka 
            (typ_dokladu, cislo_dokladu, zakaznik_id, odberatel_nazov, odberatel_ico, odberatel_dic, odberatel_ic_dph, 
            odberatel_adresa, datum_vystavenia, datum_dodania, datum_splatnosti, suma_bez_dph, suma_dph, suma_s_dph, variabilny_symbol)
            VALUES ('FA', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            cislo_fa, zakaznik_id, zakaznik.get('nazov_firmy', ''), zakaznik.get('ico'), zakaznik.get('dic'), 
            zakaznik.get('ic_dph'), zakaznik.get('adresa'), datum_vystavenia, datum_vystavenia, datum_splatnosti,
            total_bez_dph, total_dph, total_s_dph, cislo_fa.replace('FA-', '').replace('-', '') 
        ))
        fa_id = cur.lastrowid

        # Aktualizujeme Objednávky - priradíme im ID tejto novej faktúry
        cur.execute(
            f"UPDATE b2b_objednavky SET faktura_id = %s WHERE id IN ({placeholders})",
            (fa_id, *order_ids)
        )

        # Vložíme položky do faktúry
        for o in orders:
            # Pre každú objednávku najprv vložíme "hlavičkový" riadok na faktúru
            cur.execute("""
                INSERT INTO doklady_polozky 
                (doklad_id, objednavka_id, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                fa_id, o['id'], f"Dodávka tovaru z objednávky č. {o['cislo_objednavky']}", 1, 'ks', 
                0, 0, 0, 0  # Tento riadok slúži len ako nadpis
            ))
            
            # A potom pridáme samotné položky
            cur.execute("SELECT * FROM b2b_objednavky_polozky WHERE objednavka_id = %s", (o['id'],))
            polozky_objednavky = cur.fetchall()
            
            for p in polozky_objednavky:
                mnozstvo = float(p.get('dodane_mnozstvo') or p.get('mnozstvo') or 0)
                if mnozstvo <= 0: continue
                
                cena_bez_dph = float(p.get('cena_skutocna') or p.get('cena_bez_dph') or 0)
                dph_perc = float(p.get('dph') or 20.0)
                celkom_bez_dph = mnozstvo * cena_bez_dph
                celkom_s_dph = celkom_bez_dph * (1 + (dph_perc / 100))

                cur.execute("""
                    INSERT INTO doklady_polozky 
                    (doklad_id, objednavka_id, ean, nazov_polozky, mnozstvo, mj, cena_bez_dph, dph_percento, celkom_bez_dph, celkom_s_dph)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    fa_id, o['id'], p['ean_produktu'], p['nazov_vyrobku'], mnozstvo, p['mj'], 
                    cena_bez_dph, dph_perc, celkom_bez_dph, celkom_s_dph
                ))
                
                # Zápis do Skladového denníka (Mínusový pohyb = Odpis tovaru zo skladu pri fakturácii)
                cur.execute("""
                    INSERT INTO skladove_pohyby 
                    (ean, nazov_vyrobku, typ_pohybu, mnozstvo, mj, doklad_id, predajna_cena_bez_dph)
                    VALUES (%s, %s, 'VYDAJ_FAKTURA', %s, %s, %s, %s)
                """, (p['ean_produktu'], p['nazov_vyrobku'], -mnozstvo, p['mj'], fa_id, cena_bez_dph))

                # Odpis tovaru z Centrálneho skladu (tabuľka produkty)
                cur.execute("""
                    UPDATE produkty 
                    SET aktualny_sklad_finalny_kg = aktualny_sklad_finalny_kg - %s 
                    WHERE ean = %s
                """, (mnozstvo, p['ean_produktu']))

        conn.commit()
        return jsonify({"message": f"Zberná faktúra {cislo_fa} bola úspešne vystavená.", "faktura_id": fa_id})

    except Exception as e:
        if conn: conn.rollback()
        return jsonify({"error": f"Chyba pri tvorbe Zbernej faktúry: {str(e)}"}), 500
    finally:
        if conn:
            cur.close()
            conn.close()

@billing_bp.get("/api/billing/ready_for_invoice")
def get_ready_for_invoice():
    """
    Vráti všetky 'Hotové' objednávky z terminálu, ktoré ešte nemajú faktúru.
    Zoskupené podľa Trasy a následne podľa Zákazníkov.
    """
    sql = """
        SELECT 
            o.id as obj_id, o.cislo_objednavky, o.datum_vytvorenia, o.pozadovany_datum_dodania,
            o.finalna_suma_s_dph, o.celkova_suma_s_dph,
            z.zakaznik_id, z.nazov_firmy, z.typ_fakturacie,
            COALESCE(t.nazov, 'Bez priradenej trasy') as trasa_nazov
        FROM b2b_objednavky o
        JOIN b2b_zakaznici z ON o.zakaznik_id = z.zakaznik_id
        LEFT JOIN logistika_trasy t ON z.trasa_id = t.id
        WHERE o.stav = 'Hotová' AND o.faktura_id IS NULL
        ORDER BY t.nazov, z.nazov_firmy, o.pozadovany_datum_dodania
    """
    rows = db_connector.execute_query(sql, fetch="all") or []
    
    trasy_map = {}
    for r in rows:
        trasa = r['trasa_nazov']
        zid = r['zakaznik_id']
        
        if trasa not in trasy_map:
            trasy_map[trasa] = {}
            
        if zid not in trasy_map[trasa]:
            trasy_map[trasa][zid] = {
                "zakaznik_id": zid,
                "nazov_firmy": r['nazov_firmy'],
                "typ_fakturacie": r['typ_fakturacie'],
                "objednavky": []
            }
            
        suma = r.get('finalna_suma_s_dph') or r.get('celkova_suma_s_dph') or 0
        
        trasy_map[trasa][zid]["objednavky"].append({
            "id": r['obj_id'],
            "cislo": r['cislo_objednavky'],
            "datum": r['pozadovany_datum_dodania'],
            "suma": float(suma)
        })

    vystup = [{"trasa": k, "zakaznici": list(v.values())} for k, v in trasy_map.items()]
    return jsonify({"trasy": vystup})

@billing_bp.get("/api/billing/order_items/<int:order_id>")
def get_order_items_for_billing(order_id):
    """Vráti položky konkrétnej objednávky pre rýchlu úpravu pred fakturáciou."""
    sql = """
        SELECT id, ean_produktu as ean, nazov_vyrobku as name, 
               COALESCE(dodane_mnozstvo, mnozstvo) as qty, 
               mj, 
               COALESCE(cena_skutocna, cena_bez_dph) as price, dph
        FROM b2b_objednavky_polozky
        WHERE objednavka_id = %s
    """
    items = db_connector.execute_query(sql, (order_id,), fetch="all") or []
    return jsonify({"items": items})