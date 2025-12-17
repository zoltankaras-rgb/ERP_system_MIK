# =================================================================
# === HANDLER: HACCP – TEPLOTA JADRA VÝROBKOV ======================
# =================================================================
#
# Bez zásahu do existujúcich tabuliek:
#   - čítame iba zo zaznamy_vyroba
#   - zapisujeme iba do:
#       haccp_core_temp_product_defaults
#       haccp_core_temp_measurements
#
# DÔLEŽITÉ:
#   - list_items je spravené ako 3 jednoduché query (bez rizikových JOINov):
#       1) načítaj výrobu (batchId, dátum, stav, produkt, plán/reál)
#       2) načítaj CCP defaulty pre produkty (is_required, limit_c)
#       3) načítaj posledné meranie pre batchId (deterministicky)
#

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from flask import jsonify, make_response, session

import db_connector
from expedition_handler import _zv_name_col


# -----------------------------------------------------------------
# Schema
# -----------------------------------------------------------------

def _ensure_schema() -> None:
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_product_defaults (
            product_name VARCHAR(255) PRIMARY KEY,
            is_required TINYINT(1) NOT NULL DEFAULT 0,
            limit_c DECIMAL(5,2) NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """,
        fetch="none",
    )

    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS haccp_core_temp_measurements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            batch_id VARCHAR(255) NOT NULL,
            product_name VARCHAR(255) NULL,
            production_date DATE NULL,
            limit_c DECIMAL(5,2) NULL,
            measured_c DECIMAL(5,2) NOT NULL,
            measured_at DATETIME NOT NULL,
            measured_by VARCHAR(255) NULL,
            note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_coretemp_batch (batch_id),
            INDEX idx_coretemp_date (production_date),
            INDEX idx_coretemp_prod (product_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """,
        fetch="none",
    )


# -----------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------

def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        s = str(x).strip().replace(",", ".")
        if s == "":
            return None
        return float(s)
    except Exception:
        return None


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        return int(x)
    except Exception:
        return default


def _norm_name(s: Optional[str]) -> str:
    return (s or "").strip()


def _chunks(lst: List[Any], n: int) -> List[List[Any]]:
    out = []
    for i in range(0, len(lst), n):
        out.append(lst[i:i + n])
    return out


# -----------------------------------------------------------------
# API: list pre UI
# -----------------------------------------------------------------

def list_items(days: int = 365):
    _ensure_schema()

    if not days or days < 1:
        days = 365
    if days > 3650:
        days = 3650

    from_d = date.today() - timedelta(days=int(days))
    zv_name = _zv_name_col()
    eff_dt = "COALESCE(zv.datum_vyroby, zv.datum_spustenia, zv.datum_ukoncenia)"

    # 1) Výroba – jednoduché, overené v MySQL
    prod_rows = db_connector.execute_query(
        f"""
        SELECT
          zv.id_davky AS batchId,
          DATE({eff_dt}) AS productionDate,
          zv.stav AS status,
          zv.{zv_name} AS productName,
          zv.planovane_mnozstvo_kg AS plannedQtyKg,
          zv.realne_mnozstvo_kg AS realQtyKg,
          zv.realne_mnozstvo_ks AS realQtyKs
        FROM zaznamy_vyroba zv
        WHERE {eff_dt} IS NOT NULL
          AND DATE({eff_dt}) >= %s
        ORDER BY {eff_dt} DESC, zv.{zv_name} ASC
        """,
        (from_d,),
    ) or []

    if not prod_rows:
        return jsonify([])

    # normalizácia + zber kľúčov
    batch_ids: List[str] = []
    product_names: List[str] = []

    norm_prod: List[Dict[str, Any]] = []
    for r in prod_rows:
        bid = _norm_name(r.get("batchId"))
        pname = _norm_name(r.get("productName"))
        if not bid or not r.get("productionDate"):
            continue

        batch_ids.append(bid)
        if pname:
            product_names.append(pname)

        pd = r.get("productionDate")
        if isinstance(pd, datetime):
            pd = pd.date()
        pd_str = pd.strftime("%Y-%m-%d") if isinstance(pd, date) else str(pd)

        norm_prod.append({
            "batchId": bid,
            "productionDate": pd_str,
            "status": r.get("status"),
            "productName": pname,
            "plannedQtyKg": float(r.get("plannedQtyKg") or 0.0),
            "realQtyKg": float(r.get("realQtyKg") or 0.0),
            "realQtyKs": int(r.get("realQtyKs") or 0),
        })

    # 2) Defaulty CCP/limit pre produkty (iba pre tie, ktoré sa vyskytli)
    defaults_map: Dict[str, Dict[str, Any]] = {}
    uniq_products = sorted(set(product_names))
    if uniq_products:
        # IN query v chunk-och (ak by bolo veľa produktov)
        for ch in _chunks(uniq_products, 500):
            placeholders = ",".join(["%s"] * len(ch))
            drows = db_connector.execute_query(
                f"""
                SELECT product_name AS productName, is_required AS isRequired, limit_c AS limitC
                FROM haccp_core_temp_product_defaults
                WHERE TRIM(product_name) IN ({placeholders})
                """,
                tuple(ch),
            ) or []
            for d in drows:
                n = _norm_name(d.get("productName"))
                defaults_map[n] = {
                    "isRequired": bool(int(d.get("isRequired") or 0)),
                    "limitC": _safe_float(d.get("limitC")),
                }

    # 3) Posledné meranie pre batchId – deterministicky (measured_at + id)
    meas_map: Dict[str, Dict[str, Any]] = {}
    uniq_batches = sorted(set(batch_ids))
    if uniq_batches:
        for ch in _chunks(uniq_batches, 500):
            placeholders = ",".join(["%s"] * len(ch))
            mrows = db_connector.execute_query(
                f"""
                SELECT mm.*
                FROM haccp_core_temp_measurements mm
                JOIN (
                  SELECT batch_id,
                         MAX(CONCAT(DATE_FORMAT(measured_at,'%Y%m%d%H%i%s'), LPAD(id,10,'0'))) AS mx
                  FROM haccp_core_temp_measurements
                  WHERE batch_id IN ({placeholders})
                  GROUP BY batch_id
                ) t
                  ON t.batch_id = mm.batch_id
                 AND CONCAT(DATE_FORMAT(mm.measured_at,'%Y%m%d%H%i%s'), LPAD(mm.id,10,'0')) = t.mx
                """,
                tuple(ch),
            ) or []
            for m in mrows:
                bid = _norm_name(m.get("batch_id"))
                if not bid:
                    continue
                meas_at = m.get("measured_at")
                if isinstance(meas_at, datetime):
                    meas_at_str = meas_at.isoformat(sep=" ", timespec="seconds")
                else:
                    meas_at_str = str(meas_at) if meas_at else None

                meas_map[bid] = {
                    "measuredC": _safe_float(m.get("measured_c")),
                    "measuredAt": meas_at_str,
                    "measuredBy": m.get("measured_by"),
                    "note": m.get("note"),
                    "measuredLimitC": _safe_float(m.get("limit_c")),
                }

    # Výstup pre UI
    out: List[Dict[str, Any]] = []
    for r in norm_prod:
        pname = r.get("productName") or ""
        bid = r.get("batchId")

        d = defaults_map.get(pname, {"isRequired": False, "limitC": None})
        m = meas_map.get(bid, None)

        is_required = bool(d.get("isRequired"))
        default_limit = _safe_float(d.get("limitC"))
        measured_limit = _safe_float(m.get("measuredLimitC")) if m else None

        # limit: priorita snapshot z merania, inak default
        limit_c = measured_limit if measured_limit is not None else default_limit

        measured_c = _safe_float(m.get("measuredC")) if m else None
        measured_at = m.get("measuredAt") if m else None
        measured_by = m.get("measuredBy") if m else None
        note = m.get("note") if m else None

        rec = {
            "batchId": bid,
            "productionDate": r.get("productionDate"),
            "status": r.get("status"),
            "productName": pname,
            "plannedQtyKg": float(r.get("plannedQtyKg") or 0.0),
            "realQtyKg": float(r.get("realQtyKg") or 0.0),
            "realQtyKs": int(r.get("realQtyKs") or 0),
            "mj": "kg",
            "pieceWeightG": 0.0,
            "isRequired": is_required,
            "limitC": float(limit_c) if limit_c is not None else None,
            "measuredC": float(measured_c) if measured_c is not None else None,
            "measuredAt": measured_at,
            "measuredBy": measured_by,
            "note": note,
        }

        if is_required:
            if rec["measuredC"] is None:
                rec["haccpStatus"] = "MISSING"
            elif rec["limitC"] is not None and rec["measuredC"] < rec["limitC"]:
                rec["haccpStatus"] = "FAIL"
            else:
                rec["haccpStatus"] = "OK"
        else:
            rec["haccpStatus"] = "NA"

        out.append(rec)

    # sort: dátum DESC, potom názov ASC
    out.sort(key=lambda x: (x.get("productName") or ""))
    out.sort(key=lambda x: (x.get("productionDate") or ""), reverse=True)

    return jsonify(out)


# -----------------------------------------------------------------
# API: defaults (CCP/limit)
# -----------------------------------------------------------------
def list_product_defaults():
    """Zoznam výrobkov pre nastavenie CCP/limit – stabilne z výroby."""
    _ensure_schema()

    zv_name = _zv_name_col()

    rows = db_connector.execute_query(
        f"""
        SELECT
            c.productName AS productName,
            'VÝROBA'      AS itemType,
            COALESCE(d.is_required,0) AS isRequired,
            d.limit_c     AS limitC,
            d.updated_at  AS updatedAt
        FROM (
            SELECT DISTINCT TRIM(zv.{zv_name}) AS productName
            FROM zaznamy_vyroba zv
            WHERE zv.{zv_name} IS NOT NULL AND TRIM(zv.{zv_name}) <> ''
            UNION
            SELECT DISTINCT TRIM(product_name) AS productName
            FROM haccp_core_temp_product_defaults
            WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
        ) c
        LEFT JOIN haccp_core_temp_product_defaults d
               ON TRIM(d.product_name) = TRIM(c.productName)
        ORDER BY c.productName
        """
    ) or []

    out = []
    for r in rows:
        # db_connector niekedy dáva kľúče lowercase
        pn = r.get("productName") or r.get("productname")
        it = r.get("itemType") or r.get("itemtype") or "VÝROBA"
        ir = r.get("isRequired") if "isRequired" in r else r.get("isrequired")
        lc = r.get("limitC") if "limitC" in r else r.get("limitc")
        ua = r.get("updatedAt") if "updatedAt" in r else r.get("updatedat")

        if isinstance(ua, datetime):
            ua = ua.isoformat(sep=" ", timespec="seconds")

        out.append({
            "productName": pn,
            "itemType": it,
            "isRequired": bool(int(ir or 0)),
            "limitC": float(lc) if lc is not None else None,
            "updatedAt": ua,
        })

    return jsonify(out)


def save_product_default(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()

    if not isinstance(payload, dict):
        return {"error": "Missing JSON body"}

    name = _norm_name(payload.get("productName") or payload.get("product_name") or payload.get("name"))
    if not name:
        return {"error": "Chýba productName."}

    is_required = 1 if str(payload.get("isRequired") or payload.get("is_required") or "0") in ("1", "true", "True", "on") else 0
    limit_c = _safe_float(payload.get("limitC") or payload.get("limit_c"))

    if not is_required:
        limit_c = None
    else:
        if limit_c is None:
            limit_c = 72.0

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_product_defaults (product_name, is_required, limit_c)
        VALUES (%s,%s,%s)
        ON DUPLICATE KEY UPDATE
            is_required=VALUES(is_required),
            limit_c=VALUES(limit_c)
        """,
        (name, is_required, limit_c),
        fetch="none",
    )

    return {"message": "Uložené.", "productName": name, "isRequired": bool(is_required), "limitC": limit_c}


# -----------------------------------------------------------------
# API: merania
# -----------------------------------------------------------------

def save_measurement(payload: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()

    if not isinstance(payload, dict):
        return {"error": "Missing JSON body"}

    batch_id = _norm_name(payload.get("batchId") or payload.get("batch_id") or payload.get("id_davky"))
    if not batch_id:
        return {"error": "Chýba batchId."}

    measured_c = _safe_float(payload.get("measuredC") or payload.get("measured_c") or payload.get("temp") or payload.get("temperature"))
    if measured_c is None:
        return {"error": "Chýba measuredC (nameraná teplota)."}

    measured_at_raw = payload.get("measuredAt") or payload.get("measured_at")
    if measured_at_raw:
        try:
            s = str(measured_at_raw).strip()
            if "T" in s:
                measured_at = datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
            else:
                measured_at = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        except Exception:
            measured_at = datetime.now()
    else:
        measured_at = datetime.now()

    measured_by = _norm_name(payload.get("measuredBy") or payload.get("measured_by") or payload.get("worker"))
    if not measured_by:
        user = session.get("user") or {}
        measured_by = (user.get("full_name") or user.get("username") or "Neznámy")

    note = payload.get("note") or payload.get("poznamka") or ""
    note = str(note).strip() if note is not None else ""

    zv_name = _zv_name_col()
    zv = db_connector.execute_query(
        f"""
        SELECT
            {zv_name} AS productName,
            DATE(COALESCE(datum_vyroby, datum_spustenia, datum_ukoncenia)) AS productionDate
        FROM zaznamy_vyroba
        WHERE id_davky=%s
        LIMIT 1
        """,
        (batch_id,),
        fetch="one",
    ) or {}

    product_name = _norm_name(zv.get("productName")) or None
    prod_date = zv.get("productionDate")
    if isinstance(prod_date, datetime):
        prod_date = prod_date.date()

    # limit snapshot: z payloadu, inak z defaultov
    limit_c = _safe_float(payload.get("limitC") or payload.get("limit_c"))
    if limit_c is None and product_name:
        d = db_connector.execute_query(
            "SELECT is_required, limit_c FROM haccp_core_temp_product_defaults WHERE TRIM(product_name)=TRIM(%s) LIMIT 1",
            (product_name,),
            fetch="one",
        ) or {}
        if int(d.get("is_required") or 0) == 1:
            limit_c = _safe_float(d.get("limit_c"))
            if limit_c is None:
                limit_c = 72.0

    db_connector.execute_query(
        """
        INSERT INTO haccp_core_temp_measurements
            (batch_id, product_name, production_date, limit_c, measured_c, measured_at, measured_by, note)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
        """,
        (batch_id, product_name, prod_date, limit_c, measured_c, measured_at, measured_by, note or None),
        fetch="none",
    )

    return {
        "message": "Meranie uložené.",
        "batchId": batch_id,
        "productName": product_name,
        "productionDate": prod_date.strftime("%Y-%m-%d") if isinstance(prod_date, date) else None,
        "measuredC": measured_c,
        "measuredAt": measured_at.isoformat(sep=" ", timespec="seconds"),
        "measuredBy": measured_by,
        "limitC": limit_c,
    }


def list_measurement_history(batch_id: str):
    _ensure_schema()
    bid = _norm_name(batch_id)
    if not bid:
        return make_response("Chýba batchId.", 400)

    rows = db_connector.execute_query(
        """
        SELECT id, batch_id AS batchId, product_name AS productName, production_date AS productionDate,
               limit_c AS limitC, measured_c AS measuredC, measured_at AS measuredAt, measured_by AS measuredBy,
               note, created_at AS createdAt
          FROM haccp_core_temp_measurements
         WHERE batch_id=%s
         ORDER BY measured_at DESC, id DESC
        """,
        (bid,),
    ) or []

    for r in rows:
        if isinstance(r.get("measuredAt"), datetime):
            r["measuredAt"] = r["measuredAt"].isoformat(sep=" ", timespec="seconds")
        if isinstance(r.get("createdAt"), datetime):
            r["createdAt"] = r["createdAt"].isoformat(sep=" ", timespec="seconds")
        pd = r.get("productionDate")
        if isinstance(pd, datetime):
            pd = pd.date()
        if isinstance(pd, date):
            r["productionDate"] = pd.strftime("%Y-%m-%d")

    return jsonify(rows)
