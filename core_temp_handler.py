# =================================================================
# === HANDLER: HACCP – TEPLOTA JADRA VÝROBKOV ======================
# =================================================================

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from flask import jsonify, make_response, session

import db_connector
from expedition_handler import _zv_name_col


def _ensure_schema() -> None:
    """Vytvorí tabuľky pre modul, ak neexistujú."""
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


# -----------------------------------------------------------------
# API: dáta pre UI
# -----------------------------------------------------------------

def list_items(days: int = 365):
    """Zoznam výroby za posledných `days` dní + defaulty + posledné meranie."""
    _ensure_schema()

    if not days or days < 1:
        days = 365
    if days > 3650:
        days = 3650

    from_d = date.today() - timedelta(days=int(days))
    zv_name = _zv_name_col()

    eff_dt = "COALESCE(zv.datum_vyroby, zv.datum_spustenia, zv.datum_ukoncenia)"

    # DÔLEŽITÉ: bez JOIN na produkty (p.mj / p.vaha_balenia_g), aby SQL nepadalo
    rows = db_connector.execute_query(
        f"""
        SELECT
            zv.id_davky                           AS batchId,
            DATE({eff_dt})                        AS productionDate,
            zv.stav                               AS status,
            zv.{zv_name}                          AS productName,
            zv.planovane_mnozstvo_kg              AS plannedQtyKg,
            zv.realne_mnozstvo_kg                 AS realQtyKg,
            zv.realne_mnozstvo_ks                 AS realQtyKs,
            'kg'                                  AS mj,
            0                                     AS pieceWeightG,
            COALESCE(d.is_required,0)             AS isRequired,
            d.limit_c                             AS defaultLimitC,
            m.id                                  AS measId,
            m.measured_c                          AS measuredC,
            m.measured_at                         AS measuredAt,
            m.measured_by                         AS measuredBy,
            m.note                                AS note,
            m.limit_c                             AS measuredLimitC
        FROM zaznamy_vyroba zv
        LEFT JOIN haccp_core_temp_product_defaults d
               ON TRIM(d.product_name) = TRIM(zv.{zv_name})
        LEFT JOIN (
            SELECT mm.*
              FROM haccp_core_temp_measurements mm
              JOIN (
                    SELECT batch_id, MAX(measured_at) AS max_at
                      FROM haccp_core_temp_measurements
                     GROUP BY batch_id
              ) t
                ON t.batch_id = mm.batch_id AND t.max_at = mm.measured_at
        ) m
               ON m.batch_id = zv.id_davky
        WHERE {eff_dt} IS NOT NULL
          AND DATE({eff_dt}) >= %s
        ORDER BY {eff_dt} DESC, productName ASC
        """,
        (from_d,),
    ) or []

    # Dedup (ak viac meraní s rovnakým measured_at) – necháme najvyššie measId
    by_batch: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        bid = str(r.get("batchId") or "").strip()
        if not bid:
            continue
        prev = by_batch.get(bid)
        if prev is None:
            by_batch[bid] = r
        else:
            if _safe_int(r.get("measId"), 0) > _safe_int(prev.get("measId"), 0):
                by_batch[bid] = r

    out: List[Dict[str, Any]] = []
    for r in by_batch.values():
        pd = r.get("productionDate")
        if isinstance(pd, datetime):
            pd = pd.date()
        if isinstance(pd, date):
            pd_str = pd.strftime("%Y-%m-%d")
        else:
            pd_str = str(pd) if pd else None

        measured_at = r.get("measuredAt")
        if isinstance(measured_at, datetime):
            measured_at_str = measured_at.isoformat(sep=" ", timespec="seconds")
        elif measured_at:
            measured_at_str = str(measured_at)
        else:
            measured_at_str = None

        # limit: snapshot z merania má prioritu, inak default
        limit_c = r.get("measuredLimitC")
        if limit_c is None:
            limit_c = r.get("defaultLimitC")

        planned = _safe_float(r.get("plannedQtyKg")) or 0.0
        real_kg = _safe_float(r.get("realQtyKg")) or 0.0
        real_ks = _safe_int(r.get("realQtyKs"), 0)

        piece_w = _safe_float(r.get("pieceWeightG")) or 0.0

        rec = {
            "batchId": str(r.get("batchId") or "").strip(),
            "productionDate": pd_str,
            "status": r.get("status"),
            "productName": r.get("productName"),
            "plannedQtyKg": planned,
            "realQtyKg": real_kg,
            "realQtyKs": real_ks,
            "mj": r.get("mj") or "kg",
            "pieceWeightG": piece_w,
            "isRequired": bool(int(r.get("isRequired") or 0)),
            "limitC": float(limit_c) if limit_c is not None else None,
            "measuredC": float(r.get("measuredC")) if r.get("measuredC") is not None else None,
            "measuredAt": measured_at_str,
            "measuredBy": r.get("measuredBy"),
            "note": r.get("note"),
        }

        # stav pre UI
        if rec["isRequired"]:
            if rec["measuredC"] is None:
                rec["haccpStatus"] = "MISSING"
            elif rec["limitC"] is not None and rec["measuredC"] < rec["limitC"]:
                rec["haccpStatus"] = "FAIL"
            else:
                rec["haccpStatus"] = "OK"
        else:
            rec["haccpStatus"] = "NA"

        out.append(rec)

    out.sort(key=lambda x: (x.get("productName") or ""))
    out.sort(key=lambda x: (x.get("productionDate") or ""), reverse=True)

    return jsonify(out)


def list_product_defaults():
    """Zoznam výrobkov + nastavenie (varený?/limit)."""
    _ensure_schema()

    rows = db_connector.execute_query(
        """
        SELECT
            p.nazov_vyrobku AS productName,
            p.typ_polozky   AS itemType,
            COALESCE(d.is_required,0) AS isRequired,
            d.limit_c       AS limitC,
            d.updated_at    AS updatedAt
        FROM produkty p
        LEFT JOIN haccp_core_temp_product_defaults d
               ON TRIM(d.product_name) = TRIM(p.nazov_vyrobku)
        WHERE TRIM(UPPER(p.typ_polozky)) IN ('VÝROBOK','VÝROBOK_KUSOVY','VÝROBOK_KRAJANY','PRODUKT')
        ORDER BY p.nazov_vyrobku
        """
    ) or []

    for r in rows:
        if isinstance(r.get("updatedAt"), datetime):
            r["updatedAt"] = r["updatedAt"].isoformat(sep=" ", timespec="seconds")
        r["isRequired"] = bool(int(r.get("isRequired") or 0))
        try:
            r["limitC"] = float(r.get("limitC")) if r.get("limitC") is not None else None
        except Exception:
            r["limitC"] = None

    return jsonify(rows)


# -----------------------------------------------------------------
# API: ukladanie
# -----------------------------------------------------------------

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

    limit_c = _safe_float(payload.get("limitC") or payload.get("limit_c"))
    if limit_c is None and product_name:
        d = db_connector.execute_query(
            """
            SELECT is_required, limit_c
              FROM haccp_core_temp_product_defaults
             WHERE TRIM(product_name)=TRIM(%s)
             LIMIT 1
            """,
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
