# =================================================================
# === HANDLER PRE MODUL: ZISKOVOSŤ / NÁKLADY (upravené, kompatibilné) ===
# =================================================================

import db_connector
from datetime import datetime, date
from flask import render_template, make_response
import fleet_handler

COLL = "utf8mb4_0900_ai_ci"


# -----------------------------
# ---- Pomocné: bezpečné zistenie existencie stĺpca v tabuľke
# -----------------------------
def _has_col(table: str, col: str) -> bool:
    try:
        r = db_connector.execute_query(
            """
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = %s
              AND COLUMN_NAME  = %s
            LIMIT 1
            """,
            (table, col),
            fetch="one",
        )
        return bool(r)
    except Exception:
        return False


def _product_manuf_avg_col() -> str | None:
    # vyber najbližší existujúci stĺpec s priemernou výrobnou €/kg
    for c in ("vyrobna_cena_eur_kg", "vyrobna_cena", "vyrobna_cena_avg_kg", "vyrobna_cena_avg"):
        try:
            if _has_col("produkty", c):
                return c
        except Exception:
            pass
    return None


# -----------------------------------------------------------------
# Striktný výnos z výroby – podľa reálne prijatých výrobkov v expedícii
# -----------------------------------------------------------------
def compute_strict_production_revenue(year: int, month: int) -> dict:
    y, m = int(year), int(month)

    try:
        t_exists = db_connector.execute_query(
            """
            SELECT 1
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'expedicia_prijmy'
            LIMIT 1
            """,
            fetch="one",
        )
        if not t_exists:
            return {"total": 0.0, "items": [], "by_product": {}}
    except Exception:
        return {"total": 0.0, "items": [], "by_product": {}}

    manuf_col = _product_manuf_avg_col()
    manuf_sel = f", p.{manuf_col} AS manuf_avg" if manuf_col else ", NULL AS manuf_avg"

    query = f"""
        SELECT
            ep.id,
            ep.id_davky,
            ep.nazov_vyrobku,
            ep.unit,
            ep.prijem_kg,
            ep.prijem_ks,
            ep.datum_prijmu,
            zv.cena_za_jednotku,
            p.ean,
            p.mj,
            p.vaha_balenia_g,
            p.nazov_vyrobku AS product_name
            {manuf_sel}
        FROM expedicia_prijmy ep
        LEFT JOIN zaznamy_vyroba zv ON zv.id_davky = ep.id_davky
        LEFT JOIN produkty p
          ON ep.nazov_vyrobku COLLATE {COLL} = p.nazov_vyrobku COLLATE {COLL}
        WHERE ep.is_deleted = 0
          AND YEAR(ep.datum_prijmu) = %s
          AND MONTH(ep.datum_prijmu) = %s
        ORDER BY ep.datum_prijmu ASC, ep.id ASC
    """
    rows = db_connector.execute_query(query, (y, m)) or []

    def _num(v, default=0.0):
        try:
            return float(v) if v not in (None, "") else default
        except Exception:
            return default

    total = 0.0
    items = []
    by_product = {}

    for r in rows:
        unit = (r.get("unit") or "kg").lower()
        mj = (r.get("mj") or "kg").lower()
        wg = _num(r.get("vaha_balenia_g"))

        if unit == "kg":
            qty_kg = _num(r.get("prijem_kg"))
        else:
            pcs = _num(r.get("prijem_ks"))
            qty_kg = (pcs * wg) / 1000.0 if wg > 0 else 0.0

        perkg = 0.0
        cju = r.get("cena_za_jednotku")
        if cju is not None:
            try:
                cju = float(cju)
                perkg = cju if mj == "kg" else (cju / (wg / 1000.0) if wg > 0 else 0.0)
            except Exception:
                perkg = 0.0
        if perkg <= 0.0:
            perkg = _num(r.get("manuf_avg"))

        value = qty_kg * perkg
        total += value

        d = r.get("datum_prijmu")
        dstr = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)
        prod = r.get("product_name") or r.get("nazov_vyrobku") or ""
        item = {
            "date": dstr,
            "batchId": r.get("id_davky"),
            "ean": r.get("ean"),
            "product": prod,
            "qty_kg": round(qty_kg, 3),
            "unit_cost_per_kg": round(perkg, 4),
            "value_eur": round(value, 2),
        }
        items.append(item)

        agg = by_product.setdefault(prod or "NEZNÁMY", {"qty_kg": 0.0, "value_eur": 0.0})
        agg["qty_kg"] += qty_kg
        agg["value_eur"] += value

    by_product = {
        k: {"qty_kg": round(v["qty_kg"], 3), "value_eur": round(v["value_eur"], 2)}
        for k, v in by_product.items()
    }
    return {"total": round(total, 2), "items": items, "by_product": by_product}


def _ym_int(year, month):
    return int(year), int(month)


def get_profitability_data(year, month):
    year, month = _ym_int(year, month)

    dept_data = (
        db_connector.execute_query(
            "SELECT * FROM profit_department_monthly WHERE report_year = %s AND report_month = %s",
            (year, month),
            fetch="one",
        )
        or {}
    )

    production_view_data = get_production_profit_view(year, month)
    sales_channels_data = get_sales_channels_view(year, month)
    calculations_data = get_calculations_view(year, month)

    strict_prod = compute_strict_production_revenue(year, month)
    strict_total = float(strict_prod.get("total") or 0.0)

    exp_stock_prev = float(dept_data.get("exp_stock_prev", 0) or 0)
    exp_from_butchering = float(dept_data.get("exp_from_butchering", 0) or 0)
    exp_from_prod_manual = float(dept_data.get("exp_from_prod", 0) or 0) 
    exp_external = float(dept_data.get("exp_external", 0) or 0)
    exp_returns = float(dept_data.get("exp_returns", 0) or 0)
    exp_stock_current = float(dept_data.get("exp_stock_current", 0) or 0)
    exp_revenue = float(dept_data.get("exp_revenue", 0) or 0)

    exp_from_prod_used = strict_total if strict_total > 0 else exp_from_prod_manual
    prod_source = "strict" if strict_total > 0 else "manual"

    cost_of_goods_sold = (
        exp_stock_prev + exp_from_butchering + exp_from_prod_used + exp_external
    ) - exp_returns - exp_stock_current
    exp_profit = exp_revenue - cost_of_goods_sold

    butcher_profit = float(dept_data.get("butcher_meat_value", 0) or 0) - float(
        dept_data.get("butcher_paid_goods", 0) or 0
    )
    butcher_revaluation = float(dept_data.get("butcher_process_value", 0) or 0) + float(
        dept_data.get("butcher_returns_value", 0) or 0
    )

    total_profit = (
        butcher_profit
        + exp_profit
        + production_view_data["summary"]["total_profit"]
        - float(dept_data.get("general_costs", 0) or 0)
    )

    dept_data_out = dict(dept_data)
    dept_data_out["exp_from_prod_strict"] = strict_total
    dept_data_out["exp_from_prod_used"] = exp_from_prod_used
    dept_data_out["exp_from_prod_source"] = prod_source

    production_view_data = dict(production_view_data)
    production_view_data["strict_revenue"] = strict_total
    production_view_data["strict_items"] = strict_prod.get("items") or []

    return {
        "year": year,
        "month": month,
        "department_data": dept_data_out,
        "sales_channels_view": sales_channels_data,
        "calculations_view": calculations_data,
        "production_view": production_view_data,
        "production_strict": strict_prod, 
        "calculations": {
            "expedition_profit": exp_profit,
            "butchering_profit": butcher_profit,
            "butchering_revaluation": butcher_revaluation,
            "production_profit": production_view_data["summary"]["total_profit"],
            "total_profit": total_profit,
        },
    }
# -----------------------------------------------------------------
# Predajné kanály – spracovanie a vizualizácia
# -----------------------------------------------------------------
def get_sales_channels_view(year, month):
    year, month = _ym_int(year, month)
    
    if not _has_col("b2b_zakaznici", "predajny_kanal"):
        try:
            db_connector.execute_query("ALTER TABLE b2b_zakaznici ADD COLUMN predajny_kanal VARCHAR(100) DEFAULT NULL", fetch="none")
        except Exception:
            pass

    sales_by_channel = {}

    # SQL bezpečne sčíta dáta podľa prideleného kanálu k zákazníkovi alebo jeho matke
    real_sales_sql = """
        SELECT 
            COALESCE(z.predajny_kanal, parent.predajny_kanal, 'Nezaradené') AS kanal,
            op.ean_produktu,
            COALESCE(p.nazov_vyrobku, op.nazov_vyrobku) AS nazov_vyrobku,
            op.mj,
            SUM(op.mnozstvo) AS real_sales_qty,
            SUM(op.mnozstvo * op.cena_bez_dph) AS total_trzba,
            SUM(op.mnozstvo * COALESCE(p.nakupna_cena, 0)) AS total_naklad
        FROM b2b_objednavky o
        LEFT JOIN b2b_zakaznici z ON CONVERT(TRIM(o.zakaznik_id) USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(TRIM(z.zakaznik_id) USING utf8mb4) COLLATE utf8mb4_general_ci
        LEFT JOIN b2b_zakaznici parent ON z.parent_id = parent.id
        JOIN b2b_objednavky_polozky op ON o.id = op.objednavka_id
        LEFT JOIN produkty p ON CONVERT(TRIM(op.ean_produktu) USING utf8mb4) COLLATE utf8mb4_general_ci = CONVERT(TRIM(p.ean) USING utf8mb4) COLLATE utf8mb4_general_ci
        WHERE YEAR(o.pozadovany_datum_dodania) = %s AND MONTH(o.pozadovany_datum_dodania) = %s
          AND o.stav NOT IN ('Zrušená', 'Stornovaná', 'Zrusena')
        GROUP BY kanal, op.ean_produktu, nazov_vyrobku, op.mj
        ORDER BY kanal, total_trzba DESC
    """
    real_sales = db_connector.execute_query(real_sales_sql, (year, month), fetch='all') or []

    for r in real_sales:
        kanal = r["kanal"]
        if kanal not in sales_by_channel:
            sales_by_channel[kanal] = {
                "items": [],
                "summary": {"total_kg": 0.0, "total_purchase": 0.0, "total_sell": 0.0, "total_profit": 0.0}
            }
            
        qty = float(r['real_sales_qty'] or 0)
        trzba = float(r['total_trzba'] or 0)
        naklad = float(r['total_naklad'] or 0)
        zisk = trzba - naklad
        avg_sell = (trzba / qty) if qty > 0 else 0
        avg_buy = (naklad / qty) if qty > 0 else 0
        
        sales_by_channel[kanal]["items"].append({
            "product_ean": r["ean_produktu"],
            "product_name": r["nazov_vyrobku"],
            "unit": r["mj"] or "kg",
            "quantity": qty,
            "purchase_price_net": avg_buy,
            "sell_price_net": avg_sell,
            "total_profit_eur": zisk
        })
        
        s = sales_by_channel[kanal]["summary"]
        if str(r["mj"]).lower() == "kg":
            s["total_kg"] += qty
        s["total_purchase"] += naklad
        s["total_sell"] += trzba
        s["total_profit"] += zisk

    query_manual = "SELECT DISTINCT sales_channel FROM profit_sales_monthly WHERE report_year = %s AND report_month = %s"
    manual_channels = db_connector.execute_query(query_manual, (year, month)) or []
    for c in manual_channels:
        ch_name = c["sales_channel"]
        if ch_name not in sales_by_channel:
            sales_by_channel[ch_name] = {
                "items": [],
                "summary": {"total_kg": 0.0, "total_purchase": 0.0, "total_sell": 0.0, "total_profit": 0.0}
            }

    return sales_by_channel


# -----------------------------------------------------------------
# Predajné kanály – uloženie a integrované mazanie
# -----------------------------------------------------------------
def setup_new_sales_channel(data):
    channel_name = str(data.get("channel_name") or "").strip()
    
    # === MAZANIE KANÁLU ===
    if data.get("delete_channel"):
        try:
            db_connector.execute_query("DELETE FROM profit_sales_monthly WHERE sales_channel = %s", (channel_name,), fetch="none")
            db_connector.execute_query("UPDATE b2b_zakaznici SET predajny_kanal = NULL WHERE predajny_kanal = %s", (channel_name,), fetch="none")
            return {"message": f"Kanál '{channel_name}' bol trvalo odstránený."}
        except Exception as e:
            return {"error": str(e)}

    # === VYTVORENIE KANÁLU ===
    try:
        year = int(data.get("year", 0))
        month = int(data.get("month", 0))
    except (TypeError, ValueError):
        return {"error": "Chybný formát dátumu."}

    chain_id = data.get("chain_id")

    if not year or not month or not channel_name:
        return {"error": "Chýbajú dáta pre vytvorenie."}

    if not _has_col("b2b_zakaznici", "predajny_kanal"):
        try:
            db_connector.execute_query("ALTER TABLE b2b_zakaznici ADD COLUMN predajny_kanal VARCHAR(100) DEFAULT NULL", fetch="none")
        except: pass

    # Explicitná aktualizácia zákazníkov - matka aj VŠETKY jej dcéry
    if chain_id and str(chain_id).strip():
        try:
            db_connector.execute_query(
                "UPDATE b2b_zakaznici SET predajny_kanal = %s WHERE id = %s OR parent_id = %s",
                (channel_name, int(chain_id), int(chain_id)), fetch="none"
            )
        except Exception as e:
            print("UPDATE DB ERROR:", e)
    else:
        # Fallback pre istotu, ak chýba chain_id
        try:
            db_connector.execute_query(
                "UPDATE b2b_zakaznici SET predajny_kanal = %s WHERE nazov_firmy LIKE %s",
                (channel_name, f"%{channel_name}%"), fetch="none"
            )
        except: pass

    products_q = "SELECT ean, nazov_vyrobku FROM produkty WHERE typ_polozky LIKE 'VÝROBOK%%' OR typ_polozky LIKE 'TOVAR%%'"
    all_products = db_connector.execute_query(products_q) or []
    
    if all_products:
        available_products_with_costs = get_calculations_view(year, month).get("available_products", [])
        prod_costs = {p["ean"]: p.get("avg_cost", 0) for p in available_products_with_costs}

        records_to_insert = [
            (year, month, channel_name, p["ean"], float(prod_costs.get(p["ean"], 0) or 0)) 
            for p in all_products
        ]
        query = """
            INSERT IGNORE INTO profit_sales_monthly
                (report_year, report_month, sales_channel, product_ean, purchase_price_net)
            VALUES (%s, %s, %s, %s, %s)
        """
        try:
            conn = db_connector.get_connection()
            cur = conn.cursor()
            cur.executemany(query, records_to_insert)
            conn.commit()
            cur.close()
            conn.close()
        except: pass

    return {"message": f"Kanál '{channel_name}' úspešne vytvorený a prepojený."}


# -----------------------------------------------------------------
# Predajné kanály – uloženie a integrované mazanie
# -----------------------------------------------------------------
def setup_new_sales_channel(data):
    channel_name = str(data.get("channel_name") or "").strip()
    
    # === 1. MAZANIE KANÁLU (Opravený commit) ===
    if data.get("delete_channel"):
        conn_del = None
        try:
            conn_del = db_connector.get_connection()
            cur_del = conn_del.cursor()
            cur_del.execute("DELETE FROM profit_sales_monthly WHERE sales_channel = %s", (channel_name,))
            cur_del.execute("UPDATE b2b_zakaznici SET predajny_kanal = NULL WHERE predajny_kanal = %s", (channel_name,))
            conn_del.commit() # TOTO chýbalo, ukladá zmazanie napevno
            return {"message": f"Kanál '{channel_name}' bol trvalo odstránený."}
        except Exception as e:
            if conn_del: conn_del.rollback()
            return {"error": str(e)}
        finally:
            if conn_del and conn_del.is_connected():
                cur_del.close()
                conn_del.close()

    # === 2. VYTVORENIE KANÁLU ===
    try:
        year = int(data.get("year", 0))
        month = int(data.get("month", 0))
    except (TypeError, ValueError):
        return {"error": "Chybný formát dátumu."}

    chain_id = data.get("chain_id")

    if not year or not month or not channel_name:
        return {"error": "Chýbajú dáta pre vytvorenie."}

    if not _has_col("b2b_zakaznici", "predajny_kanal"):
        try:
            db_connector.execute_query("ALTER TABLE b2b_zakaznici ADD COLUMN predajny_kanal VARCHAR(100) DEFAULT NULL", fetch="none")
        except: pass

    # === 3. PREPOJENIE MATKY AJ DCÉR (Opravené) ===
    if chain_id and str(chain_id).strip():
        conn_upd = None
        try:
            conn_upd = db_connector.get_connection()
            cur_upd = conn_upd.cursor()
            # Updatne matku (id) aj jej pobočky (parent_id)
            cur_upd.execute(
                "UPDATE b2b_zakaznici SET predajny_kanal = %s WHERE id = %s OR parent_id = %s",
                (channel_name, int(chain_id), int(chain_id))
            )
            conn_upd.commit()
        except Exception as e:
            if conn_upd: conn_upd.rollback()
            print("UPDATE DB ERROR:", e)
        finally:
            if conn_upd and conn_upd.is_connected():
                cur_upd.close()
                conn_upd.close()
    else:
        # Fallback pre istotu, ak sa nevyberie reťazec, ale zadá sa len názov
        try:
            conn_upd = db_connector.get_connection()
            cur_upd = conn_upd.cursor()
            cur_upd.execute(
                "UPDATE b2b_zakaznici SET predajny_kanal = %s WHERE nazov_firmy LIKE %s",
                (channel_name, f"%{channel_name}%")
            )
            conn_upd.commit()
            cur_upd.close()
            conn_upd.close()
        except: pass

    # === 4. Vygenerovanie riadkov produktov ===
    products_q = "SELECT ean, nazov_vyrobku FROM produkty WHERE typ_polozky LIKE 'VÝROBOK%%' OR typ_polozky LIKE 'TOVAR%%'"
    all_products = db_connector.execute_query(products_q) or []
    
    if all_products:
        available_products_with_costs = get_calculations_view(year, month).get("available_products", [])
        prod_costs = {p["ean"]: p.get("avg_cost", 0) for p in available_products_with_costs}

        records_to_insert = [
            (year, month, channel_name, p["ean"], float(prod_costs.get(p["ean"], 0) or 0)) 
            for p in all_products
        ]
        query = """
            INSERT IGNORE INTO profit_sales_monthly
                (report_year, report_month, sales_channel, product_ean, purchase_price_net)
            VALUES (%s, %s, %s, %s, %s)
        """
        try:
            conn = db_connector.get_connection()
            cur = conn.cursor()
            cur.executemany(query, records_to_insert)
            conn.commit()
            cur.close()
            conn.close()
        except: pass

    return {"message": f"Kanál '{channel_name}' úspešne vytvorený a prepojený na prevádzky."}
# -----------------------------------------------------------------
# Kalkulácie / súťaže
# -----------------------------------------------------------------
def get_calculations_view(year, month):
    year, month = _ym_int(year, month)
    calc_q = (
        "SELECT * FROM profit_calculations WHERE report_year = %s AND report_month = %s ORDER BY name"
    )
    calculations = db_connector.execute_query(calc_q, (year, month))

    if calculations:
        calc_ids = [c["id"] for c in calculations]
        if calc_ids:
            placeholders = ",".join(["%s"] * len(calc_ids))
            items_q = f"""
    SELECT pci.*, p.nazov_vyrobku AS product_name
    FROM profit_calculation_items pci
    JOIN produkty p
      ON pci.product_ean COLLATE {COLL} = p.ean COLLATE {COLL}
    WHERE pci.calculation_id IN ({placeholders})
"""
            all_items = db_connector.execute_query(items_q, tuple(calc_ids)) or []
            items_by_calc_id = {c_id: [] for c_id in calc_ids}
            for item in all_items:
                item["purchase_price_net"] = float(item.get("purchase_price_net") or 0)
                item["sell_price_net"] = float(item.get("sell_price_net") or 0)
                item["estimated_kg"] = float(item.get("estimated_kg") or 0)
                items_by_calc_id[item["calculation_id"]].append(item)
            for calc in calculations:
                calc["items"] = items_by_calc_id.get(calc["id"], [])

    products_q = f"""
    SELECT 
        p.ean,
        p.nazov_vyrobku,
        p.predajna_kategoria,
        (
          SELECT ROUND(zv.celkova_cena_surovin / NULLIF(zv.realne_mnozstvo_kg, 0), 4)
          FROM zaznamy_vyroba zv
          WHERE zv.nazov_vyrobku COLLATE {COLL} = p.nazov_vyrobku COLLATE {COLL}
            AND zv.stav IN ('Dokončené','Ukončené')
            AND zv.celkova_cena_surovin IS NOT NULL
            AND zv.realne_mnozstvo_kg IS NOT NULL
          ORDER BY COALESCE(zv.datum_ukoncenia, zv.datum_vyroby) DESC
          LIMIT 1
        ) AS avg_cost
    FROM produkty p
    WHERE p.typ_polozky LIKE 'VÝROBOK%%' OR p.typ_polozky LIKE 'TOVAR%%'
    ORDER BY p.predajna_kategoria, p.nazov_vyrobku
"""

    vehicles_q = "SELECT id, name, license_plate FROM fleet_vehicles WHERE is_active = TRUE ORDER BY name"
    customers_q = """
        SELECT id, nazov_firmy
        FROM b2b_zakaznici
        WHERE je_admin = 0 AND je_schvaleny = 1
        ORDER BY nazov_firmy
    """

    all_products = db_connector.execute_query(products_q) or []
    all_vehicles = db_connector.execute_query(vehicles_q) or []
    all_customers = db_connector.execute_query(customers_q) or []

    for v in all_vehicles:
        analysis = fleet_handler.get_fleet_analysis(v["id"], year, month)
        v["cost_per_km"] = float(analysis.get("cost_per_km", 0) or 0)

    return {
        "calculations": calculations,
        "available_products": all_products,
        "available_vehicles": all_vehicles,
        "available_customers": all_customers,
    }


def save_calculation(data):
    data["year"] = int(data.get("year"))
    data["month"] = int(data.get("month"))

    calc_id = data.get("id") or None
    conn = db_connector.get_connection()
    try:
        cursor = conn.cursor()
        calc_params = (
            data["name"],
            data["year"],
            data["month"],
            data.get("vehicle_id") or None,
            float(data.get("distance_km") or 0),
            float(data.get("transport_cost") or 0),
        )
        if calc_id:
            cursor.execute(
                """
                UPDATE profit_calculations
                SET name=%s, report_year=%s, report_month=%s, vehicle_id=%s, distance_km=%s, transport_cost=%s
                WHERE id=%s
                """,
                calc_params + (calc_id,),
            )
        else:
            cursor.execute(
                """
                INSERT INTO profit_calculations
                  (name, report_year, report_month, vehicle_id, distance_km, transport_cost)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                calc_params,
            )
            calc_id = cursor.lastrowid

        cursor.execute(
            "DELETE FROM profit_calculation_items WHERE calculation_id = %s", (calc_id,)
        )
        items = data.get("items", [])
        if items:
            items_to_insert = [
                (
                    calc_id,
                    i["product_ean"],
                    float(i.get("estimated_kg") or 0),
                    float(i.get("purchase_price_net") or 0),
                    float(i.get("sell_price_net") or 0),
                )
                for i in items
            ]
            if items_to_insert:
                cursor.executemany(
                    """
                    INSERT INTO profit_calculation_items
                      (calculation_id, product_ean, estimated_kg, purchase_price_net, sell_price_net)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    items_to_insert,
                )
        conn.commit()
        return {"message": f"Kalkulácia '{data['name']}' bola úspešne uložená."}
    except Exception as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if conn and conn.is_connected():
            conn.close()


def delete_calculation(data):
    db_connector.execute_query(
        "DELETE FROM profit_calculations WHERE id = %s",
        (data.get("id"),),
        fetch="none",
    )
    return {"message": "Kalkulácia bola vymazaná."}


# -----------------------------------------------------------------
# Predajné kanály – uloženie
# -----------------------------------------------------------------
def setup_new_sales_channel(data):
    year = int(data.get("year"))
    month = int(data.get("month"))
    channel_name = (data.get("channel_name") or "").strip()
    chain_id = data.get("chain_id")

    if not all([year, month, channel_name]):
        return {"error": "Chýbajú dáta."}
        
    # 1. AUTOMATICKÁ OPRAVA DATABÁZY
    if not _has_col("b2b_zakaznici", "predajny_kanal"):
        try:
            db_connector.execute_query("ALTER TABLE b2b_zakaznici ADD COLUMN predajny_kanal VARCHAR(100) DEFAULT NULL", fetch="none")
        except Exception:
            pass

    # 2. TVRDÝ UPDATE PREDAJNÉHO KANÁLU S COMMITOM PRE MATKU AJ POBOČKY
    if chain_id:
        conn_upd = None
        try:
            conn_upd = db_connector.get_connection()
            cur_upd = conn_upd.cursor()
            cur_upd.execute(
                "UPDATE b2b_zakaznici SET predajny_kanal = %s WHERE id = %s OR parent_id = %s",
                (channel_name, int(chain_id), int(chain_id))
            )
            conn_upd.commit()
        except Exception as e:
            if conn_upd:
                conn_upd.rollback()
            import traceback
            traceback.print_exc()
        finally:
            if conn_upd and conn_upd.is_connected():
                cur_upd.close()
                conn_upd.close()

    # 3. Vytvorenie záznamov pre manuálny cenník (aby sa ukázal v systéme)
    products_q = """
        SELECT ean, nazov_vyrobku
        FROM produkty
        WHERE typ_polozky LIKE 'VÝROBOK%%' OR typ_polozky LIKE 'TOVAR%%'
    """
    all_products = db_connector.execute_query(products_q) or []
    if not all_products:
        return {"message": "V katalógu nie sú žiadne produkty na pridanie."}

    available_products_with_costs = get_calculations_view(year, month)["available_products"]
    prod_costs = {p["ean"]: p.get("avg_cost", 0) for p in available_products_with_costs}

    records_to_insert = [
        (
            year,
            month,
            channel_name,
            p["ean"],
            float(prod_costs.get(p["ean"], 0) or 0),
        )
        for p in all_products
    ]

    query = """
        INSERT IGNORE INTO profit_sales_monthly
            (report_year, report_month, sales_channel, product_ean, purchase_price_net)
        VALUES (%s, %s, %s, %s, %s)
    """
    conn = db_connector.get_connection()
    cur = None
    try:
        cur = conn.cursor()
        cur.executemany(query, records_to_insert)
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cur:
            try:
                cur.close()
            except Exception:
                pass
        if conn and conn.is_connected():
            conn.close()

    return {
        "message": f"Kanál '{channel_name}' bol úspešne vytvorený a všetky pobočky boli trvalo prepojené."
    }
def save_sales_channel_data(data):
    year = int(data.get("year"))
    month = int(data.get("month"))
    channel = data.get("channel")
    rows = data.get("rows", [])
    if not all([year, month, channel, rows]):
        return {"error": "Chýbajú dáta."}

    data_to_save = []
    for r in rows:
        data_to_save.append(
            (
                float(r.get("sales_kg") or 0),
                float(r.get("purchase_price_net") or 0),
                float(r.get("purchase_price_vat") or 0),
                float(r.get("sell_price_net") or 0),
                float(r.get("sell_price_vat") or 0),
                year,
                month,
                channel,
                r["ean"],
            )
        )

    query = """
        UPDATE profit_sales_monthly
        SET sales_kg=%s,
            purchase_price_net=%s,
            purchase_price_vat=%s,
            sell_price_net=%s,
            sell_price_vat=%s
        WHERE report_year=%s
          AND report_month=%s
          AND sales_channel=%s
          AND product_ean=%s
    """

    conn = db_connector.get_connection()
    cur = None
    try:
        cur = conn.cursor()
        cur.executemany(query, data_to_save)
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cur:
            try:
                cur.close()
            except Exception:
                pass
        if conn and conn.is_connected():
            conn.close()

    return {"message": f"Dáta pre kanál '{channel}' boli uložené."}


# -----------------------------------------------------------------
# Oddelenia – manuálne dáta
# -----------------------------------------------------------------
def save_department_data(data):
    year = int(data.get("year"))
    month = int(data.get("month"))
    if not year or not month:
        return {"error": "Chýba rok alebo mesiac."}

    fields = [
        "exp_stock_prev",
        "exp_from_butchering",
        "exp_from_prod",
        "exp_external",
        "exp_returns",
        "exp_stock_current",
        "exp_revenue",
        "butcher_meat_value",
        "butcher_paid_goods",
        "butcher_process_value",
        "butcher_returns_value",
        "general_costs",
    ]

    existing = (
        db_connector.execute_query(
            """
            SELECT *
            FROM profit_department_monthly
            WHERE report_year=%s AND report_month=%s
            """,
            (year, month),
            fetch="one",
        )
        or {}
    )

    values = {}
    for f in fields:
        if f in data and data.get(f) not in (None, ""):
            try:
                values[f] = float(data.get(f))
            except Exception:
                values[f] = 0.0
        else:
            values[f] = float(existing.get(f, 0) or 0)

    params = {"report_year": year, "report_month": month, **values}

    query = """
        INSERT INTO profit_department_monthly
          (report_year, report_month,
           exp_stock_prev, exp_from_butchering, exp_from_prod, exp_external, exp_returns, exp_stock_current, exp_revenue,
           butcher_meat_value, butcher_paid_goods, butcher_process_value, butcher_returns_value, general_costs)
        VALUES
          (%(report_year)s, %(report_month)s,
           %(exp_stock_prev)s, %(exp_from_butchering)s, %(exp_from_prod)s, %(exp_external)s, %(exp_returns)s, %(exp_stock_current)s, %(exp_revenue)s,
           %(butcher_meat_value)s, %(butcher_paid_goods)s, %(butcher_process_value)s, %(butcher_returns_value)s, %(general_costs)s)
        ON DUPLICATE KEY UPDATE
           exp_stock_prev        = VALUES(exp_stock_prev),
           exp_from_butchering   = VALUES(exp_from_butchering),
           exp_from_prod         = VALUES(exp_from_prod),
           exp_external          = VALUES(exp_external),
           exp_returns           = VALUES(exp_returns),
           exp_stock_current     = VALUES(exp_stock_current),
           exp_revenue           = VALUES(exp_revenue),
           butcher_meat_value    = VALUES(butcher_meat_value),
           butcher_paid_goods    = VALUES(butcher_paid_goods),
           butcher_process_value = VALUES(butcher_process_value),
           butcher_returns_value = VALUES(butcher_returns_value),
           general_costs         = VALUES(general_costs)
    """
    db_connector.execute_query(query, params, fetch="none")
    return {"message": "Dáta boli úspešne uložené."}


# -----------------------------------------------------------------
# Výroba – ziskovosť po výrobkoch
# -----------------------------------------------------------------
def get_production_profit_view(year, month):
    year, month = _ym_int(year, month)

    products_query = """
        SELECT
            ean,
            nazov_vyrobku,
            typ_polozky,
            mj,
            vaha_balenia_g,
            COALESCE(aktualny_sklad_finalny_kg, 0) AS exp_stock_kg
        FROM produkty
        WHERE typ_polozky LIKE 'VÝROBOK%%'
        ORDER BY nazov_vyrobku
    """
    all_products = db_connector.execute_query(products_query) or []

    prod_manual_rows = (
        db_connector.execute_query(
            "SELECT * FROM profit_production_monthly WHERE report_year = %s AND report_month = %s",
            (year, month),
        )
        or []
    )
    prod_manual_data = {str(row["product_ean"]): row for row in prod_manual_rows}

    available_products_with_costs = (
        get_calculations_view(year, month).get("available_products", []) or []
    )
    prod_costs_by_name = {
        p["nazov_vyrobku"]: float(p.get("avg_cost") or 0.0)
        for p in available_products_with_costs
    }

    table_rows = []
    summary = {
        "total_kg": 0.0,
        "total_kg_no_pkg": 0.0,
        "total_profit": 0.0,
        "jars_200": 0.0,
        "jars_500": 0.0,
        "lids": 0.0,
    }

    for p in all_products:
        ean = str(p.get("ean") or "").strip()
        if not ean:
            continue

        name = p.get("nazov_vyrobku") or ""
        typ = p.get("typ_polozky") or ""
        weight_g = float(p.get("vaha_balenia_g") or 0.0)
        exp_stock_kg = float(p.get("exp_stock_kg") or 0.0)

        manual = prod_manual_data.get(ean, {}) or {}
        sales_kg = float(manual.get("expedition_sales_kg") or 0.0)

        prod_cost = float(prod_costs_by_name.get(name, 0.0) or 0.0)

        tp_raw = manual.get("transfer_price_per_unit")
        try:
            transfer_price = float(tp_raw) if tp_raw not in (None, "") else 0.0
        except Exception:
            transfer_price = 0.0

        if transfer_price <= 0.0 and prod_cost > 0.0:
            transfer_price = prod_cost * 1.2

        profit = (transfer_price - prod_cost) * sales_kg if (
            sales_kg > 0 and prod_cost > 0
        ) else 0.0

        summary["total_profit"] += profit
        summary["total_kg"] += sales_kg

        is_packaged_or_sliced = typ in ("VÝROBOK_KUSOVY", "VÝROBOK_KRAJANY")
        if not is_packaged_or_sliced:
            summary["total_kg_no_pkg"] += sales_kg

        if weight_g > 0 and sales_kg > 0:
            num_pieces = (sales_kg * 1000.0) / weight_g
            lowname = (name or "").lower()
            if any(x in lowname for x in ("paštéta", "pašteta", "pečeňový", "pecenovy")):
                if int(weight_g) == 200:
                    summary["jars_200"] += num_pieces
                if int(weight_g) == 500:
                    summary["jars_500"] += num_pieces
                summary["lids"] += num_pieces

        table_rows.append(
            {
                "ean": ean,
                "name": name,
                "exp_stock_kg": exp_stock_kg,
                "exp_sales_kg": sales_kg,
                "production_cost": prod_cost,
                "transfer_price": transfer_price,
                "profit": profit,
            }
        )

    return {"rows": table_rows, "summary": summary}


def save_production_profit_data(data):
    year = int(data.get("year") or 0)
    month = int(data.get("month") or 0)
    rows = data.get("rows") or []

    if not year or not month or not rows:
        return {"error": "Chýbajú dáta."}

    all_eans = []
    for row in rows:
        ean = str(row.get("ean") or "").strip()
        if ean:
            all_eans.append(ean)

    if not all_eans:
        return {"error": "Žiadny EAN nebol odoslaný."}

    placeholders = ",".join(["%s"] * len(all_eans))
    existing_rows = db_connector.execute_query(
        f"SELECT ean FROM produkty WHERE ean IN ({placeholders})",
        tuple(all_eans)
    ) or []
    existing_eans = {str(r["ean"]).strip() for r in existing_rows}

    data_to_save = []
    skipped = 0
    for row in rows:
        ean = str(row.get("ean") or "").strip()
        if not ean or ean not in existing_eans:
            skipped += 1
            continue

        try:
            sales_kg = float(row.get("expedition_sales_kg") or 0.0)
        except Exception:
            sales_kg = 0.0

        try:
            transfer_price = float(row.get("transfer_price") or 0.0)
        except Exception:
            transfer_price = 0.0

        data_to_save.append((year, month, ean, sales_kg, transfer_price))

    if not data_to_save:
        return {"error": "Nie je čo uložiť – žiadny riadok nemal platný EAN z katalógu."}

    query = """
        INSERT IGNORE INTO profit_production_monthly
          (report_year, report_month, product_ean, expedition_sales_kg, transfer_price_per_unit)
        VALUES (%s, %s, %s, %s, %s)
        AS new
        ON DUPLICATE KEY UPDATE
          expedition_sales_kg     = new.expedition_sales_kg,
          transfer_price_per_unit = new.transfer_price_per_unit
    """

    conn = db_connector.get_connection()
    cur = None
    try:
        cur = conn.cursor()
        cur.executemany(query, data_to_save)
        conn.commit()
        msg = (
            f"Dáta pre ziskovosť výroby boli uložené. Preskočených riadkov: {skipped}."
            if skipped
            else "Dáta pre ziskovosť výroby boli uložené."
        )
        return {"message": msg}
    except Exception as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if cur:
            try:
                cur.close()
            except Exception:
                pass
        if conn and conn.is_connected():
            conn.close()

# -----------------------------------------------------------------
# HTML report (pôvodný mesačný)
# -----------------------------------------------------------------
def get_profitability_report_html(year, month, report_type):
    year, month = _ym_int(year, month)
    full_data = get_profitability_data(year, month)

    if report_type == "calculations":
        for calc in full_data.get("calculations_view", {}).get("calculations", []) or []:
            calc["distance_km"] = float(calc.get("distance_km") or 0)
            calc["transport_cost"] = float(calc.get("transport_cost") or 0)
            for item in calc.get("items", []) or []:
                item["purchase_price_net"] = float(item.get("purchase_price_net") or 0)
                item["sell_price_net"] = float(item.get("sell_price_net") or 0)
                item["estimated_kg"] = float(item.get("estimated_kg") or 0)

    title_map = {
        "departments": "Report Výnosov Oddelení",
        "production": "Report Výnosu Výroby",
        "sales_channels": "Report Predajných Kanálov",
        "calculations": "Report Kalkulácií a Súťaží",
        "summary": "Celkový Prehľad Ziskovosti",
    }
    template_data = {
        "title": title_map.get(report_type, "Report Ziskovosti"),
        "report_type": report_type,
        "period": f"{month}/{year}",
        "data": full_data,
        "today": datetime.now().strftime("%d.%m.%Y"),
    }
    return make_response(
        render_template("profitability_report_template.html", **template_data)
    )


# -----------------------------------------------------------------
# História a reporting (Ziskovosť)
# -----------------------------------------------------------------
def _parse_ym_param(s: str) -> tuple[int, int]:
    y, m = s.split("-", 1)
    return int(y), int(m)


def _iter_months(fy: int, fm: int, ty: int, tm: int):
    y, m = fy, fm
    while (y < ty) or (y == ty and m <= tm):
        yield y, m
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1


def _mk_summary_row(year: int, month: int, data: dict) -> dict:
    c = data.get("calculations") or {}
    return {
        "year": year,
        "month": month,
        "label": f"{year}-{month:02d}",
        "expedition_profit": float(c.get("expedition_profit") or 0),
        "butchering_profit": float(c.get("butchering_profit") or 0),
        "production_profit": float(c.get("production_profit") or 0),
        "total_profit": float(c.get("total_profit") or 0),
    }


def get_profitability_history(args: dict):
    scope = (args.get("scope") or "month").lower()
    rtype = (args.get("type") or "summary").lower()

    if scope == "year":
        y = int(args.get("year") or date.today().year)
        fy, fm, ty, tm = y, 1, y, 12
    elif scope == "range":
        fy, fm = _parse_ym_param(args.get("from") or f"{date.today().year}-01")
        ty, tm = _parse_ym_param(args.get("to") or f"{date.today().year}-12")
    else:
        y = int(args.get("year") or date.today().year)
        m = int(args.get("month") or date.today().month)
        fy, fm, ty, tm = y, m, y, m

    series = []
    totals = {
        "expedition_profit": 0.0,
        "butchering_profit": 0.0,
        "production_profit": 0.0,
        "total_profit": 0.0,
    }

    if rtype == "summary":
        for y, m in _iter_months(fy, fm, ty, tm):
            d = get_profitability_data(y, m)
            row = _mk_summary_row(y, m, d)
            series.append(row)
            for k in totals.keys():
                totals[k] += float(row.get(k) or 0.0)

        months = max(1, len(series))
        averages = {k: round(v / months, 2) for k, v in totals.items()}
        return {
            "range": {"from": f"{fy}-{fm:02d}", "to": f"{ty}-{tm:02d}"},
            "type": rtype,
            "series": series,
            "totals": {k: round(v, 2) for k, v in totals.items()},
            "averages": averages,
        }

    for y, m in _iter_months(fy, fm, ty, tm):
        d = get_profitability_data(y, m)
        c = d.get("calculations") or {}
        series.append(
            {
                "year": y,
                "month": m,
                "label": f"{y}-{m:02d}",
                "total_profit": float(c.get("total_profit") or 0),
            }
        )

    return {
        "range": {"from": f"{fy}-{fm:02d}", "to": f"{ty}-{tm:02d}"},
        "type": rtype,
        "series": series,
    }


def get_profitability_report_html_ex(params: dict):
    scope = (params.get("scope") or "month").lower()
    rtype = (params.get("type") or "summary").lower()

    if scope == "year":
        y = int(params.get("year") or date.today().year)
        fy, fm, ty, tm = y, 1, y, 12
        title = f"Ziskovosť – Report za rok {y}"
    elif scope == "range":
        fy, fm = _parse_ym_param(params.get("from") or f"{date.today().year}-01")
        ty, tm = _parse_ym_param(params.get("to") or f"{date.today().year}-12")
        title = f"Ziskovosť – Report {fy}-{fm:02d} až {ty}-{tm:02d}"
    else:
        y = int(params.get("year") or date.today().year)
        m = int(params.get("month") or date.today().month)
        fy, fm, ty, tm = y, m, y, m
        title = f"Ziskovosť – Report {y}-{m:02d}"

    if scope == "month":
        return get_profitability_report_html(y, m, rtype)

    if rtype == "summary":
        rows_html = ""
        totals = {
            "expedition_profit": 0.0,
            "butchering_profit": 0.0,
            "production_profit": 0.0,
            "total_profit": 0.0,
        }
        for yy, mm in _iter_months(fy, fm, ty, tm):
            d = get_profitability_data(yy, mm)
            c = d.get("calculations") or {}
            ep = float(c.get("expedition_profit") or 0)
            bp = float(c.get("butchering_profit") or 0)
            pp = float(c.get("production_profit") or 0)
            tp = float(c.get("total_profit") or 0)
            rows_html += (
                f"<tr><td>{yy}-{mm:02d}</td>"
                f"<td style='text-align:right'>{ep:.2f}</td>"
                f"<td style='text-align:right'>{bp:.2f}</td>"
                f"<td style='text-align:right'>{pp:.2f}</td>"
                f"<td style='text-align:right'>{tp:.2f}</td></tr>"
            )
            totals["expedition_profit"] += ep
            totals["butchering_profit"] += bp
            totals["production_profit"] += pp
            totals["total_profit"] += tp

        total_row = (
            "<tr style='font-weight:700;background:#fff7f7'>"
            f"<td>SPOLU</td>"
            f"<td style='text-align:right'>{totals['expedition_profit']:.2f}</td>"
            f"<td style='text-align:right'>{totals['butchering_profit']:.2f}</td>"
            f"<td style='text-align:right'>{totals['production_profit']:.2f}</td>"
            f"<td style='text-align:right'>{totals['total_profit']:.2f}</td>"
            "</tr>"
        )

        html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>
body{{font-family:Inter,system-ui,Arial,sans-serif;padding:16px}}
table{{border-collapse:collapse;width:100%}}
th,td{{border:1px solid #e5e7eb;padding:6px 8px;text-align:right}}
th:first-child,td:first-child{{text-align:left}}
th{{background:#f9fafb}}
h2{{margin:0 0 12px 0}}
.small{{color:#555;margin:4px 0 12px 0}}
</style></head><body>
<h2>{title}</h2>
<p class="small">Rozsah: {fy}-{fm:02d} až {ty}-{tm:02d}</p>
<table>
  <thead><tr><th>Obdobie</th><th>Expedícia (€)</th><th>Rozrábka (€)</th><th>Výroba (€)</th><th>Spolu zisk (€)</th></tr></thead>
  <tbody>{rows_html}{total_row}</tbody>
</table>
<script>window.print()</script>
</body></html>"""
        return make_response(html)

    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head>
<body><h3>{title}</h3><p>Viacmesačný report typu <b>{rtype}</b> zatiaľ nie je dostupný. Zvoľte typ <b>summary</b> alebo tlačte po mesiacoch.</p>
<script>window.print()</script></body></html>"""
    return make_response(html)

