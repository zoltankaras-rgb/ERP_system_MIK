# stock_handler.py
from flask import Blueprint, request, jsonify, Response, g
from datetime import datetime
from typing import Any, Dict, Optional, List
import re

import db_connector

stock_bp = Blueprint("stock", __name__)

# ------------------------- helpers (schema) -------------------------

def _has_col(table: str, col: str) -> bool:
    try:
        r = db_connector.execute_query("""
            SELECT 1
              FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME   = %s
               AND COLUMN_NAME  = %s
             LIMIT 1
        """, (table, col), fetch='one')
        return bool(r)
    except Exception:
        return False

def _first_col(table: str, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if _has_col(table, c):
            return c
    return None

def _conn_coll(default='utf8mb4_general_ci') -> str:
    try:
        r = db_connector.execute_query("SELECT @@collation_connection AS c", fetch='one') or {}
        return r.get('c') or default
    except Exception:
        return default

def _index_exists(table: str, idx: str) -> bool:
    r = db_connector.execute_query("""
        SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=%s AND INDEX_NAME=%s
         LIMIT 1
    """, (table, idx), fetch='one')
    return bool(r)

def _index_on_col_exists(table: str, column: str) -> bool:
    r = db_connector.execute_query("""
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = %s
          AND COLUMN_NAME  = %s
        LIMIT 1
    """, (table, column), fetch='one')
    return bool(r)

def _fk_exists(table: str, fk: str) -> bool:
    r = db_connector.execute_query("""
        SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME=%s
           AND CONSTRAINT_TYPE='FOREIGN KEY' AND CONSTRAINT_NAME=%s
         LIMIT 1
    """, (table, fk), fetch='one')
    return bool(r)

# ------------------------- small DB setup --------------------------

def _ensure_suppliers_schema():
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS suppliers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(64),
          email VARCHAR(255),
          address VARCHAR(255),
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS supplier_categories (
          supplier_id INT NOT NULL,
          category VARCHAR(64) NOT NULL,
          PRIMARY KEY (supplier_id, category),
          CONSTRAINT fk_supcat_supplier FOREIGN KEY (supplier_id)
            REFERENCES suppliers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')

def _ensure_link_to_supplier():
    if not _has_col("sklad", "dodavatel_id"):
        db_connector.execute_query("ALTER TABLE sklad ADD COLUMN dodavatel_id INT NULL", fetch='none')
    if not _index_exists("sklad", "idx_sklad_dodavatel_id"):
        db_connector.execute_query("CREATE INDEX idx_sklad_dodavatel_id ON sklad(dodavatel_id)", fetch='none')
    if not _fk_exists("sklad", "fk_sklad_supplier"):
        db_connector.execute_query("""
            ALTER TABLE sklad
              ADD CONSTRAINT fk_sklad_supplier
              FOREIGN KEY (dodavatel_id) REFERENCES suppliers(id)
              ON DELETE SET NULL
        """, fetch='none')
    for col in ("typ","podtyp","kategoria"):
        if not _has_col("sklad", col):
            try:
                db_connector.execute_query(f"ALTER TABLE sklad ADD COLUMN {col} VARCHAR(64) NULL", fetch='none')
            except Exception:
                pass

def _ensure_meat_templates_schema():
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS prijem_sablony (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nazov VARCHAR(128) NOT NULL,
          scope ENUM('rozrabka','expedicia') NOT NULL,
          created_by VARCHAR(64) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')

    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS prijem_sablony_polozky (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sablona_id INT NOT NULL,
          sklad_nazov VARCHAR(255) NOT NULL,
          default_cena DECIMAL(12,4) NULL,
          poznamka VARCHAR(255) NULL,
          CONSTRAINT fk_prijem_sablony_polozky_sablona
            FOREIGN KEY (sablona_id) REFERENCES prijem_sablony(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')

    if not _index_on_col_exists("prijem_sablony", "scope"):
        db_connector.execute_query("CREATE INDEX idx_ps_scope ON prijem_sablony(scope)", fetch='none')
    if not _index_on_col_exists("prijem_sablony_polozky", "sablona_id"):
        db_connector.execute_query("CREATE INDEX idx_psp_sablona ON prijem_sablony_polozky(sablona_id)", fetch='none')

def _ensure_sklad_supplier_links_schema():
    # Multi-dodávatelia pre jednu položku (viazané na sklad.nazov)
    db_connector.execute_query("""
        CREATE TABLE IF NOT EXISTS sklad_supplier_links (
          sklad_nazov VARCHAR(255) NOT NULL,
          supplier_id INT NOT NULL,
          is_default TINYINT(1) NOT NULL DEFAULT 0,
          priority SMALLINT NULL,
          PRIMARY KEY (sklad_nazov, supplier_id),
          CONSTRAINT fk_ssl_supplier FOREIGN KEY (supplier_id)
            REFERENCES suppliers(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
    """, fetch='none')
    # indexy podľa potreby (PK už pokrýva sklad_nazov+supplier_id)

# stock_handler.py

# ... (existujúce funkcie _ensure_suppliers_schema atď nechajte tak) ...

def _fix_decimal_precision():
    """
    Opraví stĺpce na DECIMAL(12,3), aby sa zmestili čísla nad 1000 kg.
    Pôvodne to mohlo byť malé (napr. 999.99).
    """
    # 1. Sklad (suroviny)
    if _has_col("sklad", "mnozstvo"):
        db_connector.execute_query(
            "ALTER TABLE sklad MODIFY mnozstvo DECIMAL(12,3)", 
            fetch='none'
        )
    
    # 2. Produkty (hotové výrobky)
    if _has_col("produkty", "aktualny_sklad_finalny_kg"):
        db_connector.execute_query(
            "ALTER TABLE produkty MODIFY aktualny_sklad_finalny_kg DECIMAL(12,3)", 
            fetch='none'
        )

def init_stock():
    _ensure_suppliers_schema()
    _ensure_link_to_supplier()
    _ensure_meat_templates_schema()
    _ensure_sklad_supplier_links_schema()
    _fix_decimal_precision()  # <--- TOTO SME PRIDALI

# ------------------------- core queries ----------------------------

def _get_production_overview():
    """
    Prehľad surovín pre modul Sklad – VŠETKY karty zo `sklad`,
    množstvo berieme z `sklad_vyroba` (ak neexistuje, tak 0).
    Vďaka tomu sú viditeľné aj úplne nové karty bez príjmu.
    """
    sql = """
        SELECT
            s.nazov,
            COALESCE(sv.mnozstvo, 0)  AS quantity,
            LOWER(COALESCE(s.typ, ''))    AS typ,
            LOWER(COALESCE(s.podtyp, '')) AS podtyp
        FROM sklad s
        LEFT JOIN sklad_vyroba sv ON sv.nazov = s.nazov
        ORDER BY s.nazov
    """
    rows = db_connector.execute_query(sql) or []
    return {
        "items": [
            {
                "nazov":   r["nazov"],
                "quantity": float(r["quantity"] or 0.0),
                "typ":     r["typ"] or "",
                "podtyp":  r["podtyp"] or "",
            }
            for r in rows
        ]
    }

def _get_allowed_names(category: Optional[str]):
    cat = (category or "").strip().lower()
    cat_col = _first_col("sklad", ["kategoria","typ","podtyp"])
    if not cat_col:
        rows = db_connector.execute_query("SELECT nazov FROM sklad ORDER BY nazov") or []
        return {"items": [{"name": r["nazov"], "last_price": None} for r in rows]}

    coll = _conn_coll()
    label_map = {
        'maso': 'Mäso',
        'koreniny': 'Koreniny',
        'obal': 'Obaly - Črevá',
        'pomocny_material': 'Pomocný materiál',
    }
    patterns = {
        'maso': ['maso%','mäso%','brav%','hoväd%','hovad%','kurac%','hydin%','ryb%','mlet%'],
        'koreniny': ['koren%','korenin%','paprik%','rasc%','kmín%','kmin%','cesnak%','sol%','soľ%','dusit%'],
        'obal': ['obal%','črev%','cerv%','vak%','fóli%','foli%','sieť%','spag%','špag%'],
        'pomocny_material': ['pomoc%','voda%','ľad%','lad%','ovar%']
    }
    where_parts, params = [], []
    if cat in label_map:
        where_parts.append(f"s.{cat_col} COLLATE {coll} = %s COLLATE {coll}")
        params.append(label_map[cat])
    elif cat:
        pats = patterns.get(cat, [])
        if pats:
            where_parts.append("(" + " OR ".join([f"s.{cat_col} COLLATE {coll} LIKE %s"]*len(pats)) + ")")
            params.extend(pats)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
    rows = db_connector.execute_query(f"""
        SELECT s.nazov AS name,
               (SELECT z.nakupna_cena_eur_kg
                  FROM zaznamy_prijem z
                 WHERE z.nazov_suroviny COLLATE {coll} = s.nazov COLLATE {coll}
                 ORDER BY z.datum DESC
                 LIMIT 1) AS last_price
          FROM sklad s
          {where_sql}
         ORDER BY s.nazov
         LIMIT 1000
    """, tuple(params)) or []
    return {"items": [{"name": r["name"], "last_price": (float(r["last_price"]) if r["last_price"] is not None else None)} for r in rows]}

def _last_price_for(name: str):
    coll = _conn_coll()
    row = db_connector.execute_query(f"""
        SELECT z.nakupna_cena_eur_kg AS price
          FROM zaznamy_prijem z
         WHERE z.nazov_suroviny COLLATE {coll} = %s COLLATE {coll}
         ORDER BY z.datum DESC
         LIMIT 1
    """, (name,), fetch='one')
    if row and row.get("price") is not None:
        return float(row["price"])
    price_col = _first_col("sklad", ["default_cena_eur_kg","nakupna_cena","cena","cena_kg"])
    r2 = db_connector.execute_query(
        f"SELECT {price_col} AS price FROM sklad WHERE nazov=%s", (name,), fetch='one'
    ) if price_col else None
    return (float(r2["price"]) if (r2 and r2.get("price") is not None) else None)

# ------------------------- MEAT intake helpers & templates ---------

@stock_bp.get("/api/kancelaria/meat/intake/items")
def meat_intake_items():
    _ensure_meat_templates_schema()
    scope = (request.args.get('scope') or '').strip().lower()
    rows = db_connector.execute_query("""
        SELECT
            sv.nazov                            AS nazov,
            sv.mnozstvo                         AS available_qty,
            s.ean                               AS ean,
            COALESCE(s.nakupna_cena, s.default_cena_eur_kg, 0) AS price,
            s.typ                               AS typ,
            s.podtyp                            AS podtyp
        FROM sklad_vyroba sv
        LEFT JOIN sklad s ON s.nazov = sv.nazov
        WHERE
            (LOWER(IFNULL(s.podtyp,'')) = 'maso'
             OR LOWER(IFNULL(s.typ,'')) IN ('mäso','maso'))
        ORDER BY sv.nazov
    """, fetch='all') or []
    for r in rows:
        if r.get('price') is None:
            r['price'] = 0
    return jsonify(rows)

@stock_bp.post("/api/kancelaria/meat/templates")
def meat_template_create():
    _ensure_meat_templates_schema()
    data = request.get_json(force=True) or {}
    name  = (data.get('name') or '').strip()
    scope = (data.get('scope') or '').strip().lower()
    items = data.get('items') or []

    if not name:
        return jsonify({"error": "Chýba názov šablóny."}), 400
    if scope not in ('rozrabka', 'expedicia'):
        return jsonify({"error": "Neplatný scope."}), 400
    if not isinstance(items, list) or not items:
        return jsonify({"error": "Šablóna musí obsahovať aspoň 1 položku."}), 400

    created_by = None
    try:
        created_by = getattr(getattr(g, 'user', None), 'username', None) or getattr(g, 'user', {}).get('username')
    except Exception:
        pass

    tpl_id = db_connector.execute_query(
        "INSERT INTO prijem_sablony (nazov, scope, created_by) VALUES (%s,%s,%s)",
        (name, scope, created_by),
        fetch='lastrowid'
    )

    batch = []
    for it in items:
        nazov = (it.get('nazov') or it.get('sklad_nazov') or '').strip()
        if not nazov:
            continue
        cena = it.get('price')
        if cena in (None, ''):
            cena = None
        else:
            try:
                cena = float(cena)
            except Exception:
                cena = None
        batch.append((tpl_id, nazov, cena))

    if batch:
        db_connector.execute_query(
            "INSERT INTO prijem_sablony_polozky (sablona_id, sklad_nazov, default_cena) VALUES (%s,%s,%s)",
            batch, multi=True, fetch='none'
        )

    return jsonify({"message": "Šablóna vytvorená.", "id": tpl_id})

@stock_bp.get("/api/kancelaria/meat/templates")
def meat_template_list():
    _ensure_meat_templates_schema()
    scope = (request.args.get('scope') or '').strip().lower()
    params = ()
    where = ""
    if scope:
        if scope not in ('rozrabka','expedicia'):
            return jsonify({"error": "Neplatný scope."}), 400
        where = "WHERE t.scope=%s"
        params = (scope,)

    rows = db_connector.execute_query(f"""
        SELECT t.id, t.nazov, t.scope, t.created_at, COUNT(p.id) AS items_count
        FROM prijem_sablony t
        LEFT JOIN prijem_sablony_polozky p ON p.sablona_id = t.id
        {where}
        GROUP BY t.id
        ORDER BY t.created_at DESC
    """, params, fetch='all') or []
    return jsonify(rows)

@stock_bp.get("/api/kancelaria/meat/templates/<int:tpl_id>")
def meat_template_detail(tpl_id: int):
    _ensure_meat_templates_schema()
    head = db_connector.execute_query("""
        SELECT id, nazov, scope, created_at
        FROM prijem_sablony WHERE id=%s
        LIMIT 1
    """, (tpl_id,), fetch='one')
    if not head:
        return jsonify({"error": "Šablóna neexistuje."}), 404

    items = db_connector.execute_query("""
        SELECT
          p.id,
          p.sablona_id,
          p.sklad_nazov  AS nazov,
          p.default_cena AS default_price,
          sv.mnozstvo    AS available_qty,
          COALESCE(s.nakupna_cena, s.default_cena_eur_kg) AS current_price,
          s.ean
        FROM prijem_sablony_polozky p
        LEFT JOIN sklad s ON s.nazov = p.sklad_nazov
        LEFT JOIN sklad_vyroba sv ON sv.nazov = p.sklad_nazov
        WHERE p.sablona_id=%s
        ORDER BY p.id
    """, (tpl_id,), fetch='all') or []

    head['items'] = items
    return jsonify(head)

@stock_bp.put("/api/kancelaria/meat/templates/<int:tpl_id>")
def meat_template_update(tpl_id: int):
    _ensure_meat_templates_schema()
    data  = request.get_json(force=True) or {}
    name  = (data.get('name') or '').strip()
    scope = (data.get('scope') or '').strip().lower()
    items = data.get('items') or []

    head = db_connector.execute_query("SELECT id FROM prijem_sablony WHERE id=%s", (tpl_id,), fetch='one')
    if not head:
        return jsonify({"error": "Šablóna neexistuje."}), 404

    if name:
        db_connector.execute_query("UPDATE prijem_sablony SET nazov=%s WHERE id=%s", (name, tpl_id), fetch='rowcount')
    if scope:
        if scope not in ('rozrabka','expedicia'):
            return jsonify({"error":"Neplatný scope."}), 400
        db_connector.execute_query("UPDATE prijem_sablony SET scope=%s WHERE id=%s", (scope, tpl_id), fetch='rowcount')

    if isinstance(items, list):
        db_connector.execute_query("DELETE FROM prijem_sablony_polozky WHERE sablona_id=%s", (tpl_id,), fetch='rowcount')
        batch = []
        for it in items:
            nazov = (it.get('nazov') or it.get('sklad_nazov') or '').strip()
            if not nazov:
                continue
            cena = it.get('price')
            if cena in (None, ''):
                cena = None
            else:
                try:
                    cena = float(cena)
                except Exception:
                    cena = None
            batch.append((tpl_id, nazov, cena))
        if batch:
            db_connector.execute_query(
                "INSERT INTO prijem_sablony_polozky (sablona_id, sklad_nazov, default_cena) VALUES (%s,%s,%s)",
                batch, multi=True, fetch='none'
            )

    return jsonify({"message": "Šablóna upravená."})

@stock_bp.delete("/api/kancelaria/meat/templates/<int:tpl_id>")
def meat_template_delete(tpl_id: int):
    _ensure_meat_templates_schema()
    db_connector.execute_query("DELETE FROM prijem_sablony WHERE id=%s", (tpl_id,), fetch='rowcount')
    return jsonify({"message":"Šablóna zmazaná."})

# ------------------------- Multi-suppliers pre položku  ------------

@stock_bp.get("/api/kancelaria/stock/item-suppliers")
def stock_item_suppliers_get():
    """
    Vráti dodávateľov pre danú položku (vrátane defaultu a kategórií dodávateľov).
    Query: ?name=...
    """
    _ensure_suppliers_schema()
    _ensure_sklad_supplier_links_schema()

    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error":"Chýba parameter 'name'."}), 400

    # default z karty sklad
    default_id_row = db_connector.execute_query(
        "SELECT dodavatel_id FROM sklad WHERE nazov=%s LIMIT 1", (name,), fetch='one'
    ) or {}
    default_id = default_id_row.get('dodavatel_id')

    rows = db_connector.execute_query("""
        SELECT s.id, s.name, s.phone, s.email, s.address,
               l.is_default, l.priority
        FROM sklad_supplier_links l
        JOIN suppliers s ON s.id = l.supplier_id AND s.is_active=1
        WHERE l.sklad_nazov=%s
        ORDER BY COALESCE(l.priority, 9999), s.name
    """, (name,), fetch='all') or []

    # kategórie pre každého dodávateľa
    cats = db_connector.execute_query("""
        SELECT supplier_id, category
        FROM supplier_categories
        WHERE supplier_id IN (
            SELECT supplier_id FROM sklad_supplier_links WHERE sklad_nazov=%s
        )
    """, (name,), fetch='all') or []
    by = {}
    for c in cats:
        by.setdefault(c['supplier_id'], []).append(c['category'])

    out = []
    for r in rows:
        out.append({
            "id": r['id'], "name": r['name'],
            "phone": r.get('phone'), "email": r.get('email'), "address": r.get('address'),
            "categories": by.get(r['id'], []),
            "is_default": bool(r.get('is_default')),
            "priority": r.get('priority')
        })

    return jsonify({
        "name": name,
        "default_supplier_id": default_id,
        "suppliers": out
    })

@stock_bp.post("/api/kancelaria/stock/item-suppliers")
def stock_item_suppliers_set():
    """
    Nastaví zoznam dodávateľov pre položku + predvoleného.
    payload:
    {
      "name": "Paprika sladká mletá",
      "supplier_ids": [3,5,7],
      "default_id": 5,                # voliteľné (ak nepríde, ponechá sa pôvodný)
      "priorities": {"3":1,"5":2}     # voliteľné
    }
    """
    _ensure_suppliers_schema()
    _ensure_sklad_supplier_links_schema()

    d = request.get_json(force=True) or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"error":"Chýba name."}), 400

    supplier_ids = d.get("supplier_ids") or []
    if not isinstance(supplier_ids, list):
        return jsonify({"error":"supplier_ids musí byť zoznam."}), 400
    # deduplikácia + sanitizácia na int
    cleaned = []
    for x in supplier_ids:
        try:
            val = int(x)
            if val not in cleaned:
                cleaned.append(val)
        except Exception:
            continue

    default_id = d.get("default_id")
    if default_id in (None, ''):
        # ak nie je zadaný default, necháme pôvodný z karty; ale ak zoznam obsahuje presne 1 položku, nastavíme ju ako default
        if len(cleaned) == 1:
            default_id = cleaned[0]
        else:
            default_id = None
    else:
        try:
            default_id = int(default_id)
        except Exception:
            default_id = None

    priorities = d.get("priorities") or {}
    # pre jednoduchost očakávame dict {supplier_id: priority}
    pri_map = {}
    if isinstance(priorities, dict):
        for k, v in priorities.items():
            try:
                sid = int(k)
                pri_map[sid] = int(v)
            except Exception:
                pass

    # prepíš väzby
    db_connector.execute_query("DELETE FROM sklad_supplier_links WHERE sklad_nazov=%s", (name,), fetch='none')

    if cleaned:
        batch = []
        for sid in cleaned:
            batch.append((name, sid, 1 if (default_id is not None and sid == default_id) else 0, pri_map.get(sid)))
        db_connector.execute_query(
            "INSERT INTO sklad_supplier_links (sklad_nazov, supplier_id, is_default, priority) VALUES (%s,%s,%s,%s)",
            batch, multi=True, fetch='none'
        )

    # nastav default do karty (ak máme stĺpec a default_id prišiel)
    if default_id is not None and _has_col("sklad","dodavatel_id"):
        db_connector.execute_query("UPDATE sklad SET dodavatel_id=%s WHERE nazov=%s", (default_id, name), fetch='none')

    return jsonify({"message":"Dodávatelia uložené.", "count": len(cleaned), "default_id": default_id})

# ------------------------- unified intake --------------------------

@stock_bp.post("/api/kancelaria/stock/receiveProduction")
def receive_production():
    """
    Unified intake:
    payload: { items: [
      {category:'maso'|'koreniny'|'obal'|'pomocny_material',
       source?:'rozrabka'|'expedicia'|'externy'|'ine',     # len pre Mäso
       supplier_id?: <int>,                                # legacy default (ostatné kategórie)
       supplier_ids?: [<int>, ...], default_id?: <int>,    # nové multi-dodávatelia (ostatné kategórie)
       name:'...', quantity:<float>, price?:<float>, note?:'...', date?:'YYYY-mm-dd HH:MM:SS'}
    ] }
    """
    _ensure_suppliers_schema()
    _ensure_sklad_supplier_links_schema()

    data = request.get_json(force=True) or {}
    items = data.get('items') or []
    if not items:
        return jsonify({"error":"Žiadne položky na príjem."}), 400

    conn = db_connector.get_connection()
    try:
        cur = conn.cursor()
        for it in items:
            cat   = (it.get('category') or '').strip().lower()
            name  = (it.get('name') or '').strip()
            qty   = float(it.get('quantity') or 0)
            price = (it.get('price') if it.get('price') not in (None, '') else None)
            note  = (it.get('note') or '').strip()
            when  = (it.get('date') or datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

            if not name or qty <= 0:
                conn.rollback()
                return jsonify({"error": f"Neplatná položka (name/quantity): {name}"}), 400

            # zdroj alebo dodávateľ
            if cat in ('maso','mäso'):
                src = (it.get('source') or '').strip().lower()
                if src not in ('rozrabka','expedicia','externy','ine'):
                    conn.rollback()
                    return jsonify({"error": f"Zvoľ Zdroj pre mäso (rozrabka/expedicia/externy/ine) — {name}"}), 400
                prijem_typ = src
            else:
                prijem_typ = 'dodavatel'
                # podpora legacy single supplier + novej multi väzby
                default_id = None
                if it.get('supplier_id') not in (None, ''):
                    try: default_id = int(it.get('supplier_id'))
                    except: default_id = None
                if it.get('default_id') not in (None, ''):
                    try: default_id = int(it.get('default_id'))
                    except: pass

                supplier_ids = it.get('supplier_ids') or []
                # ak prišli multi, prepíš väzbu pre túto položku
                if isinstance(supplier_ids, list) and supplier_ids:
                    # deduplikácia
                    cleaned = []
                    for x in supplier_ids:
                        try:
                            sid = int(x)
                            if sid not in cleaned: cleaned.append(sid)
                        except: pass
                    # ak default nie je daný a máme 1 položku → nastav ju
                    if default_id is None and len(cleaned) == 1:
                        default_id = cleaned[0]
                    # ulož mapovanie + default do karty
                    db_connector.execute_query("DELETE FROM sklad_supplier_links WHERE sklad_nazov=%s", (name,), fetch='none')
                    rows = [(name, sid, 1 if (default_id is not None and sid == default_id) else 0, None) for sid in cleaned]
                    db_connector.execute_query(
                        "INSERT INTO sklad_supplier_links (sklad_nazov, supplier_id, is_default, priority) VALUES (%s,%s,%s,%s)",
                        rows, multi=True, fetch='none'
                    )
                    if default_id is not None and _has_col("sklad","dodavatel_id"):
                        db_connector.execute_query("UPDATE sklad SET dodavatel_id=%s WHERE nazov=%s", (default_id, name), fetch='none')
                elif default_id is not None and _has_col("sklad","dodavatel_id"):
                    db_connector.execute_query("UPDATE sklad SET dodavatel_id=%s WHERE nazov=%s", (default_id, name), fetch='none')

            # karta v sklade musí existovať
            cur.execute("SELECT COALESCE(mnozstvo,0), COALESCE(nakupna_cena,0) FROM sklad WHERE nazov=%s FOR UPDATE", (name,))
            r0 = cur.fetchone()
            if r0 is None:
                conn.rollback()
                return jsonify({"error": f"Položka '{name}' nie je založená v sklad(e)."}), 400
            central_qty, avg_now = float(r0[0] or 0), float(r0[1] or 0)

            # zásoba výrobný sklad
            cur.execute("SELECT COALESCE(mnozstvo,0) FROM sklad_vyroba WHERE nazov=%s FOR UPDATE", (name,))
            r1 = cur.fetchone()
            prod_qty = float(r1[0]) if r1 else 0.0

            # vážený priemer
            if price is not None:
                total_before = central_qty + prod_qty
                new_total = total_before + qty
                new_avg = (avg_now * total_before + float(price) * qty) / new_total if new_total > 0 else float(price)
                cur.execute("UPDATE sklad SET nakupna_cena=%s WHERE nazov=%s", (new_avg, name))

            # navýš výrobný sklad
            cur.execute("""
                INSERT INTO sklad_vyroba (nazov, mnozstvo) VALUES (%s,%s)
                ON DUPLICATE KEY UPDATE mnozstvo = mnozstvo + VALUES(mnozstvo)
            """, (name, qty))

            # log do príjmov
            cur.execute("""
                INSERT INTO zaznamy_prijem (datum, nazov_suroviny, mnozstvo_kg, nakupna_cena_eur_kg, typ, poznamka_dodavatel)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (when, name, qty, price if price is not None else None, prijem_typ, note))

        conn.commit()
        return jsonify({"message": f"Príjem uložený ({len(items)} riadkov)."})
    except Exception as e:
        if conn: conn.rollback()
        raise e
    finally:
        if conn and conn.is_connected(): conn.close()

# ------------------------- read views ------------------------------

@stock_bp.get("/api/kancelaria/getRawMaterialStockOverview")
def get_raw_material_stock_overview():
    return jsonify(_get_production_overview())

@stock_bp.get("/api/kancelaria/getComprehensiveStockView")
def get_comprehensive_stock_view():
    q = """
        SELECT
            p.ean,
            p.nazov_vyrobku      AS name,
            p.predajna_kategoria AS category,
            p.aktualny_sklad_finalny_kg AS stock_kg,
            p.vaha_balenia_g,
            p.mj                 AS unit,
            COALESCE(
              NULLIF(p.nakupna_cena, 0),   -- 1. pokus: nákupná cena z tabuľky produkty
              (
                -- 2. fallback: posledná výrobná cena na kg
                SELECT ROUND(zv.celkova_cena_surovin / NULLIF(zv.realne_mnozstvo_kg, 0), 4)
                FROM zaznamy_vyroba zv
                WHERE zv.nazov_vyrobku = p.nazov_vyrobku
                  AND zv.celkova_cena_surovin IS NOT NULL
                  AND zv.realne_mnozstvo_kg IS NOT NULL
                ORDER BY COALESCE(zv.datum_ukoncenia, zv.datum_vyroby) DESC
                LIMIT 1
              )
            ) AS price
        FROM produkty p
        WHERE p.typ_polozky = 'produkt'
           OR p.typ_polozky LIKE 'VÝROBOK%'
           OR p.typ_polozky LIKE 'TOVAR%'
        ORDER BY category, name
    """

    rows = db_connector.execute_query(q) or []

    grouped = {}
    for r in rows:
        unit = r.get('unit') or 'kg'
        qty_kg = float(r.get('stock_kg') or 0.0)
        w = float(r.get('vaha_balenia_g') or 0.0)

        # ak je jednotka "ks" a máme váhu balenia v gramoch, prepočítame na kusy
        if unit == 'ks' and w > 0:
            qty = qty_kg * 1000.0 / w
        else:
            qty = qty_kg

        item = {
            "ean":      r.get('ean'),
            "name":     r.get('name'),
            "category": r.get('category') or 'Nezaradené',
            "quantity": qty,
            "unit":     unit,
            "price":    float(r.get('price') or 0.0),
            "sklad1":   0.0,        # rezervované do budúcna
            "sklad2":   qty_kg      # reálne kg na sklade
        }
        grouped.setdefault(item['category'], []).append(item)

    return jsonify({"groupedByCategory": grouped})


@stock_bp.route('/api/kancelaria/stock/allowed-names')
def stock_allowed_names():
    """
    Vracia skladové položky pre tvorbu receptu.

    category:
      - maso             -> sklad.typ = 'Mäso'
      - koreniny         -> sklad.typ = 'Koreniny'
      - obal             -> sklad.typ = 'Obaly - Črevá'
      - pomocny_material -> sklad.typ = 'Pomocný materiál'
      - __all            -> všetko zo skladu
    """
    cat_raw = (request.args.get('category') or '').strip().lower()

    # namapuj parameter na stĺpec `typ` v tabuľke `sklad` – NIE podtyp!
    if cat_raw == '__all':
      where_sql = ""
      params    = ()
    elif cat_raw in ('mäso', 'maso', 'meat'):
      where_sql = "WHERE typ = %s"
      params    = ('Mäso',)
    elif cat_raw.startswith('koren'):
      where_sql = "WHERE typ = %s"
      params    = ('Koreniny',)
    elif cat_raw.startswith('obal'):
      where_sql = "WHERE typ = %s"
      params    = ('Obaly - Črevá',)
    elif cat_raw.startswith('pomoc'):
      where_sql = "WHERE typ = %s"
      params    = ('Pomocný materiál',)
    else:
      # neznáma kategória -> nič
      return jsonify({"items": []})

    rows = db_connector.execute_query(f"""
        SELECT
          nazov          AS name,
          COALESCE(nakupna_cena, 0) AS last_price
        FROM sklad
        {where_sql}
        ORDER BY nazov
    """, params, fetch="all") or []

    items = []
    for r in rows:
        nm = (r.get("name") or "").strip()
        if not nm:
            continue
        items.append({
            "name": nm,
            "last_price": float(r.get("last_price") or 0.0),
        })

    # ŠPECIÁLNY BONUS: pre pomocný materiál vždy doplníme Ľad / Ovar / Voda s cenou 0.20 €
    if cat_raw.startswith('pomoc'):
        specials = ["Ľad", "Lad", "Ovar", "Voda"]
        by_name = {i["name"].lower(): i for i in items}
        for nm in specials:
            key = nm.lower()
            if key in by_name:
                by_name[key]["last_price"] = 0.20
            else:
                items.append({"name": nm, "last_price": 0.20})

    return jsonify({"items": items})

@stock_bp.get("/api/kancelaria/stock/last-price")
def stock_last_price():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"last_price": None})
    return jsonify({"last_price": _last_price_for(name)})

# ------------------------- item CRUD / FULL edit -------------------

@stock_bp.post("/api/kancelaria/stock/createProductionItem")
def create_production_item():
    """
    payload: {
      category, ean?, name, mnozstvo, nakupna_cena?,
      balenie_mnozstvo?, balenie_mj?,
      supplier_ids?: [int,...],     # nové: multi dodávatelia (koreniny/obal/pomocny_material)
      default_supplier_id?: int     # voliteľný default
    }
    - ak položka v `sklad` neexistuje, založí kartu,
    - zapíše multi-dodávateľov (ak prišli),
    - navýši `sklad_vyroba`.
    """
    _ensure_suppliers_schema()
    _ensure_sklad_supplier_links_schema()

    data = request.get_json(force=True) or {}

    cat = (data.get('kategoria') or '').strip().lower() # ZMENA: frontend posiela 'kategoria'
    if cat in ('mäso', 'maso', 'meat'):
        cat = 'maso'

    name  = (data.get('name') or '').strip()
    ean   = (data.get('ean') or None)
    
    # --- OPRAVA 1: Zmenené kľúče ---
    qty   = float(data.get('mnozstvo') or 0)  # Bolo 'quantity'
    price = (data.get('nakupna_cena') if data.get('nakupna_cena') not in (None, '') else None) # Bolo 'price'
    
    # --- OPRAVA 2: Pridané nové kľúče ---
    packQty = (data.get('balenie_mnozstvo') if data.get('balenie_mnozstvo') not in (None, '') else None)
    packMj = (data.get('balenie_mj') or None)
    min_zasoba = (data.get('min_zasoba') if data.get('min_zasoba') not in (None, '') else None)

    supplier_ids = data.get('supplier_ids') or []
    if not isinstance(supplier_ids, list):
        supplier_ids = []
    # deduplikácia
    cleaned_sups = []
    for x in supplier_ids:
        try:
            sid = int(x)
            if sid not in cleaned_sups:
                cleaned_sups.append(sid)
        except Exception:
            pass
    default_sup = data.get('default_supplier_id')
    if default_sup not in (None, ''):
        try:
            default_sup = int(default_sup)
        except Exception:
            default_sup = None
    if default_sup is None and cleaned_sups and len(cleaned_sups) == 1:
        default_sup = cleaned_sups[0]

    if not name:
        return jsonify({"error": "Chýba názov."}), 400
    if qty < 0:
        return jsonify({"error": "Neplatné množstvo."}), 400

    # helper ENUM čítač
    def _enum_choices(table: str, col: str):
        info = db_connector.execute_query("""
            SELECT COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND COLUMN_NAME = %s
            LIMIT 1
        """, (table, col), fetch='one') or {}
        ct = (info.get('COLUMN_TYPE') or '').lower()
        if ct.startswith("enum(") and ct.endswith(")"):
            inside = ct[5:-1]
            import re as _re
            return [m for m in _re.findall(r"'([^']*)'", inside)]
        return None

    # 1) karta v `sklad`
    exists = db_connector.execute_query(
        "SELECT 1 FROM sklad WHERE nazov=%s",
        (name,), fetch='one'
    )

    if not exists:
        map_typ = {
            'maso':             'Mäso',
            'koreniny':         'Koreniny',
            'obal':             'Obaly - Črevá',
            'pomocny_material': 'Pomocný materiál',
        }

        fields, values = ['nazov'], [name]

        if _has_col("sklad", "typ"):
            fields.append("typ")
            values.append(map_typ.get(cat, ''))

        if _has_col("sklad", "podtyp"):
            podtyp_val = None
            choices = _enum_choices("sklad", "podtyp")
            if choices and cat in choices:
                podtyp_val = cat
            fields.append("podtyp")
            values.append(podtyp_val)

        if _has_col("sklad", "kategoria"):
            fields.append("kategoria")
            values.append(cat or None)

        if _has_col("sklad", "ean") and ean:
            fields.append("ean")
            values.append(ean)

        if _has_col("sklad", "mnozstvo"):
            fields.append("mnozstvo")
            values.append(0) # Pri založení karty je centrálny sklad 0, navýši sa len výrob.

        if price is not None:
            if _has_col("sklad", "nakupna_cena"):
                fields.append("nakupna_cena")
                values.append(float(price))
            elif _has_col("sklad", "default_cena_eur_kg"):
                fields.append("default_cena_eur_kg")
                values.append(float(price))

        # --- OPRAVA 3: Pridanie nových polí do INSERT ---
        if packQty is not None and _has_col("sklad", "balenie_mnozstvo"):
            fields.append("balenie_mnozstvo")
            try:
                values.append(float(str(packQty).replace(',', '.')))
            except Exception:
                values.append(None)

        if packMj is not None and _has_col("sklad", "balenie_mj"):
            fields.append("balenie_mj")
            values.append(packMj)
            
        if min_zasoba is not None:
            min_col = _first_col("sklad", ["min_zasoba", "min_mnozstvo", "min_stav_kg"])
            if min_col:
                fields.append(min_col)
                try:
                    values.append(float(str(min_zasoba).replace(',', '.')))
                except Exception:
                    values.append(None)
        # -----------------------------------------------

        # ak prišiel default dodávateľ (nech je uložený aj v karte)
        if default_sup is not None and _has_col("sklad", "dodavatel_id"):
            fields.append("dodavatel_id")
            values.append(default_sup)

        ph = ",".join(["%s"] * len(values))
        db_connector.execute_query(
            f"INSERT INTO sklad ({', '.join(fields)}) VALUES ({ph})",
            tuple(values),
            fetch='none'
        )
    else:
        # existuje karta → nastav default dodávateľa, ak bol poslaný
        if default_sup is not None and _has_col("sklad","dodavatel_id"):
            db_connector.execute_query("UPDATE sklad SET dodavatel_id=%s WHERE nazov=%s", (default_sup, name), fetch='none')

    # 1b) Multi-dodávatelia – len pre nekategóriu 'maso'
    if cat not in ('maso','mäso') and cleaned_sups:
        db_connector.execute_query("DELETE FROM sklad_supplier_links WHERE sklad_nazov=%s", (name,), fetch='none')
        rows = [(name, sid, 1 if (default_sup is not None and sid == default_sup) else 0, None) for sid in cleaned_sups]
        db_connector.execute_query(
            "INSERT INTO sklad_supplier_links (sklad_nazov, supplier_id, is_default, priority) VALUES (%s,%s,%s,%s)",
            rows, multi=True, fetch='none'
        )

    # 2) Navýš výrob. sklad (iba ak je qty > 0)
    if qty > 0:
        db_connector.execute_query("""
            INSERT INTO sklad_vyroba (nazov, mnozstvo)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE mnozstvo = mnozstvo + VALUES(mnozstvo)
        """, (name, qty), fetch='none')

    return jsonify({"message": "Položka pridaná do výrobného skladu."})

@stock_bp.post("/api/kancelaria/stock/updateProductionItemQty")
def update_production_item_qty():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name or "quantity" not in data:
        return jsonify({"error":"Chýba name/quantity."}), 400
    try:
        qty = float(str(data.get("quantity")).replace(',', '.'))
    except Exception:
        return jsonify({"error":"Neplatné množstvo."}), 400
    if qty < 0:
        return jsonify({"error":"Neplatné množstvo."}), 400

    exists = db_connector.execute_query("SELECT 1 FROM sklad_vyroba WHERE nazov=%s", (name,), fetch='one')
    if exists:
        db_connector.execute_query("UPDATE sklad_vyroba SET mnozstvo=%s WHERE nazov=%s", (qty, name), fetch='none')
    else:
        db_connector.execute_query("INSERT INTO sklad_vyroba (nazov, mnozstvo) VALUES (%s,%s)", (name, qty), fetch='none')
    return jsonify({"message":"Množstvo uložené."})

@stock_bp.post("/api/kancelaria/stock/deleteProductionItem")
def delete_production_item():
    """
    Zmaže položku z výrobného skladu.

    - vždy: DELETE zo `sklad_vyroba`
    - ak delete_card=True: DELETE aj z `sklad` (úplné zmazanie karty)

    Frontend posiela:
      { "name": "...", "delete_card": true/false }
    """
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Chýba názov."}), 400

    delete_card = bool(
        data.get("delete_card") or
        data.get("also_delete_card") or
        data.get("full_delete")
    )

    # 1) vždy zmaž z výrobného skladu
    db_connector.execute_query(
        "DELETE FROM sklad_vyroba WHERE nazov=%s",
        (name,),
        fetch='none'
    )

    # 2) ak máme zmazať aj kartu, skús ju zmazať zo `sklad`
    if delete_card:
        try:
            db_connector.execute_query(
                "DELETE FROM sklad WHERE nazov=%s",
                (name,),
                fetch='none'
            )
            msg = f"Položka '{name}' bola vymazaná z výrobného skladu aj zo skladu (karta odstránená)."
        except Exception as e:
            # napr. ak je cudzí kľúč v inej tabulke
            return jsonify({
                "error": f"Nepodarilo sa vymazať kartu zo skladu (používa sa inde): {e}"
            }), 400
    else:
        msg = f"Položka '{name}' bola vymazaná len z výrobného skladu (karta v sklade ponechaná)."

    return jsonify({"message": msg})



@stock_bp.get("/api/kancelaria/stock/item")
def get_stock_item():
    name = (request.args.get("name") or "").strip()
    if not name:
        return jsonify({"error":"Chýba name"}), 400

    def has(table, col):
        r = db_connector.execute_query("""
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s LIMIT 1
        """, (table, col), fetch='one')
        return bool(r)

    cols = [
        "nazov","ean","typ","podtyp","kategoria","jednotka","unit","mj",
        "mnozstvo","min_mnozstvo","min_zasoba","min_stav_kg",
        "nakupna_cena","default_cena_eur_kg","dodavatel","dodavatel_id",
        "balenie_mnozstvo", "balenie_mj" # Pridané chýbajúce stĺpce
    ]
    have = [c for c in cols if has("sklad", c)]
    sel = ", ".join(have) if have else "nazov"
    row = db_connector.execute_query(f"SELECT {sel} FROM sklad WHERE nazov=%s", (name,), fetch='one') or {}
    return jsonify({"item": row})

@stock_bp.post("/api/kancelaria/stock/saveItem")
def save_stock_item():
    """
    Plná editácia karty v `sklad`.
    payload: {
      original_name: 'pôvodný názov' (POVINNÉ),
      name?, ean?, typ?, podtyp?, kategoria?,
      jednotka?/mj?, min_mnozstvo?/min_zasoba?/min_stav_kg?,
      nakupna_cena?/default_cena_eur_kg?,
      balenie_mnozstvo?, balenie_mj?,
      dodavatel_id? (preferované), dodavatel? (meno)
    }
    """
    d = request.get_json(force=True) or {}
    old = (d.get("original_name") or "").strip()
    if not old:
        return jsonify({"error":"Chýba original_name"}), 400

    def has(col):
        r = db_connector.execute_query("""
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='sklad' AND COLUMN_NAME=%s LIMIT 1
        """, (col,), fetch='one')
        return bool(r)

    if (not d.get("dodavatel_id")) and d.get("dodavatel"):
        r = db_connector.execute_query("SELECT id FROM suppliers WHERE name=%s LIMIT 1", (d["dodavatel"],), fetch='one')
        if r: d["dodavatel_id"] = r["id"]

    sets, params = [], []
    
    # --- OPRAVA 4: Pridané mapovanie pre balenie ---
    mapping = [
        ("name","nazov"), ("ean","ean"),
        ("typ","typ"), ("podtyp","podtyp"), ("kategoria","kategoria"),
        ("jednotka","jednotka"), ("mj","mj"),
        ("min_mnozstvo","min_mnozstvo"), ("min_zasoba","min_zasoba"), ("min_stav_kg","min_stav_kg"),
        ("nakupna_cena","nakupna_cena"), ("default_cena_eur_kg","default_cena_eur_kg"),
        ("dodavatel_id","dodavatel_id"), ("dodavatel","dodavatel"),
        ("balenie_mnozstvo", "balenie_mnozstvo"), # <-- PRIDANÉ
        ("balenie_mj", "balenie_mj"),           # <-- PRIDANÉ
    ]
    # -----------------------------------------------

    for src, col in mapping:
        # Použijeme 'in d' aby sme povolili aj explicitné nastavenie na null/None
        if src in d and has(col):
            val = d.get(src)
            # Špeciálna konverzia pre desatinné čísla, ak prídu ako string s čiarkou
            if col in ("balenie_mnozstvo", "min_zasoba", "min_mnozstvo", "min_stav_kg", "nakupna_cena", "default_cena_eur_kg"):
                if val not in (None, ''):
                    try:
                        val = float(str(val).replace(',', '.'))
                    except (ValueError, TypeError):
                        val = None # alebo ponechať pôvodnú logiku, ak preferujete chybu
                else:
                    val = None
            
            sets.append(f"{col}=%s"); 
            params.append(val)

    if not sets:
        return jsonify({"message":"Bez zmien."})

    params.append(old)
    db_connector.execute_query(f"UPDATE sklad SET {', '.join(sets)} WHERE nazov=%s", tuple(params), fetch='none')

    # premenuj aj výrob. sklad a väzby na dodávateľov
    if "name" in d and (d.get("name") or "").strip() and d["name"].strip() != old:
        new_name = d["name"].strip()
        db_connector.execute_query("UPDATE sklad_vyroba SET nazov=%s WHERE nazov=%s", (new_name, old), fetch='none')
        db_connector.execute_query("UPDATE sklad_supplier_links SET sklad_nazov=%s WHERE sklad_nazov=%s", (new_name, old), fetch='none')

    return jsonify({"message":"Karta uložená."})

@stock_bp.get("/api/sklad/under-min")
def stock_under_min():
    """
    Vráti položky z výrobného skladu, ktoré sú pod minimom nastaveným na karte `sklad`.
    Výstup: { items: [
      { id?, nazov, ean?, jednotka?, qty, min_qty, to_buy, price?, supplier_id?, supplier_name? }
    ] }
    """
    # zabezpeč CRM tabuľky (ak ešte neexistujú)
    try:
        _ensure_suppliers_schema()
    except Exception:
        pass

    # zistime dostupné stĺpce
    coll = _conn_coll()
    unit_col = _first_col("sklad", ["jednotka", "mj", "unit"]) or None
    has_ean  = _has_col("sklad", "ean")
    has_id   = _has_col("sklad", "id")
    min_cols = [c for c in ("min_mnozstvo", "min_stav_kg", "min_zasoba") if _has_col("sklad", c)]

    if not min_cols:
        # nemáme žiadny "min" stĺpec -> niet čo počítať
        return jsonify({"items": []})

    min_expr = "COALESCE(" + ", ".join([f"s.{c}" for c in min_cols]) + ")"

    price_fallbacks = []
    if _has_col("sklad", "nakupna_cena"):
        price_fallbacks.append("s.nakupna_cena")
    if _has_col("sklad", "default_cena_eur_kg"):
        price_fallbacks.append("s.default_cena_eur_kg")
    price_expr = (
        f"COALESCE((SELECT z.nakupna_cena_eur_kg "
        f"           FROM zaznamy_prijem z "
        f"          WHERE z.nazov_suroviny COLLATE {coll} = s.nazov COLLATE {coll} "
        f"          ORDER BY z.datum DESC LIMIT 1)"
        + (", " + ", ".join(price_fallbacks) if price_fallbacks else "")
        + ")"
    )

    select_cols = []
    if has_id:  select_cols.append("s.id AS id")
    else:       select_cols.append("NULL AS id")
    select_cols.append("s.nazov AS nazov")
    select_cols.append(("s.ean" if has_ean else "NULL") + " AS ean")
    select_cols.append((f"s.{unit_col}" if unit_col else "NULL") + " AS jednotka")
    select_cols.append(f"COALESCE(sv.mnozstvo, 0) AS qty")
    select_cols.append(f"{min_expr} AS min_qty")
    select_cols.append(f"{price_expr} AS price")
    # dodávateľ (default na karte)
    if _has_col("sklad", "dodavatel_id"):
        select_cols.append("s.dodavatel_id AS supplier_id")
        select_cols.append("sup.name AS supplier_name")
        join_sup = "LEFT JOIN suppliers sup ON sup.id = s.dodavatel_id"
    else:
        select_cols.append("NULL AS supplier_id")
        select_cols.append("NULL AS supplier_name")
        join_sup = ""

    sql = f"""
        SELECT
            {", ".join(select_cols)}
        FROM sklad s
        LEFT JOIN sklad_vyroba sv
               ON sv.nazov COLLATE {coll} = s.nazov COLLATE {coll}
        {join_sup}
        WHERE {min_expr} IS NOT NULL
          AND {min_expr} > 0
          AND COALESCE(sv.mnozstvo, 0) < {min_expr}
        ORDER BY supplier_name IS NULL, supplier_name, s.nazov
    """

    rows = db_connector.execute_query(sql, fetch='all') or []
    out = []
    for r in rows:
        qty = float(r.get("qty") or 0.0)
        mn  = float(r.get("min_qty") or 0.0)
        to_buy = round(max(mn - qty, 0.0), 3)
        out.append({
            "id": r.get("id"),
            "nazov": r.get("nazov"),
            "ean": r.get("ean"),
            "jednotka": r.get("jednotka") or "kg",
            "qty": qty,
            "min_qty": mn,
            "to_buy": to_buy,
            "price": (float(r["price"]) if r.get("price") is not None else None),
            "supplier_id": r.get("supplier_id"),
            "supplier_name": r.get("supplier_name") or None,
        })
    return jsonify({"items": out})

# ------------------------- suppliers CRUD --------------------------

@stock_bp.get("/api/kancelaria/suppliers")
def suppliers_list():
    _ensure_suppliers_schema()
    cat = (request.args.get("category") or "").strip().lower() or None
    rows = db_connector.execute_query("SELECT id, name, phone, email, address FROM suppliers WHERE is_active=1 ORDER BY name") or []
    cats = db_connector.execute_query("SELECT supplier_id, category FROM supplier_categories", fetch='all') or []
    by = {}
    for c in cats: by.setdefault(c['supplier_id'], []).append(c['category'])
    out = []
    for r in rows:
        cs = by.get(r['id'], [])
        if cat and cat not in cs: continue
        o = dict(r); o["categories"] = cs
        out.append(o)
    return jsonify({"items": out})

@stock_bp.post("/api/kancelaria/suppliers")
def supplier_create():
    _ensure_suppliers_schema()
    d = request.get_json(force=True) or {}
    name = (d.get("name") or "").strip()
    if not name: return jsonify({"error":"Názov je povinný."}), 400
    phone = d.get("phone"); email = d.get("email"); address = d.get("address")
    new_id = db_connector.execute_query(
        "INSERT INTO suppliers (name, phone, email, address, is_active, created_at, updated_at) VALUES (%s,%s,%s,%s,1,NOW(),NOW())",
        (name, phone, email, address), fetch='lastrowid'
    )
    cats = d.get("categories") or []
    if cats:
        db_connector.execute_query("INSERT INTO supplier_categories (supplier_id, category) VALUES (%s,%s)",
                                   [(new_id, c) for c in cats], multi=True, fetch='none')
    return jsonify({"message":"Dodávateľ pridaný.", "id": new_id})

@stock_bp.put("/api/kancelaria/suppliers/<int:sup_id>")
def supplier_update(sup_id: int):
    _ensure_suppliers_schema()
    d = request.get_json(force=True) or {}
    name = (d.get("name") or "").strip()
    if not name: return jsonify({"error":"Názov je povinný."}), 400
    phone = d.get("phone"); email = d.get("email"); address = d.get("address")
    db_connector.execute_query("UPDATE suppliers SET name=%s, phone=%s, email=%s, address=%s, updated_at=NOW() WHERE id=%s",
                               (name, phone, email, address, sup_id), fetch='none')
    db_connector.execute_query("DELETE FROM supplier_categories WHERE supplier_id=%s", (sup_id,), fetch='none')
    cats = d.get("categories") or []
    if cats:
        db_connector.execute_query("INSERT INTO supplier_categories (supplier_id, category) VALUES (%s,%s)",
                                   [(sup_id, c) for c in cats], multi=True, fetch='none')
    return jsonify({"message":"Dodávateľ upravený."})

@stock_bp.delete("/api/kancelaria/suppliers/<int:sup_id>")
def supplier_delete(sup_id: int):
    _ensure_suppliers_schema()
    db_connector.execute_query("UPDATE suppliers SET is_active=0, updated_at=NOW() WHERE id=%s", (sup_id,), fetch='none')
    return jsonify({"message":"Dodávateľ zmazaný."})