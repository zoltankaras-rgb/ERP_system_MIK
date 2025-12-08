# hr_handler.py
# HR & dochádzka – zamestnanci, dochádzka, neprítomnosti, náklady na prácu

from datetime import datetime, date
from typing import Any, Dict, List, Optional

import traceback

import db_connector


# -------------------------------------------------------------------
# Pomocné
# -------------------------------------------------------------------
def _parse_date(val) -> Optional[date]:
    if not val:
        return None
    if isinstance(val, date):
        return val
    try:
        return datetime.strptime(str(val), "%Y-%m-%d").date()
    except Exception:
        return None


def _parse_float(val, default: float = 0.0) -> float:
    if val in (None, ""):
        return default
    try:
        return float(str(val).replace(",", "."))
    except Exception:
        return default


def _ensure_schema() -> None:
    # EMPLOYEES
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS hr_employees (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            code                VARCHAR(50) NULL,
            full_name           VARCHAR(255) NOT NULL,
            section             ENUM('VYROBA','EXPEDICIA','ROZVOZ','ADMIN','INE')
                                NOT NULL DEFAULT 'VYROBA',
            punch_code          VARCHAR(50) NULL,
            monthly_salary      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            base_hours_month    DECIMAL(6,2) NOT NULL DEFAULT 168.00,
            vacation_days_total DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            vacation_days_used  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            is_active           TINYINT(1) NOT NULL DEFAULT 1,
            created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """,
        fetch="none",
    )

    # ATTENDANCE
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS hr_attendance (
            id               BIGINT AUTO_INCREMENT PRIMARY KEY,
            employee_id      INT NOT NULL,
            work_date        DATE NOT NULL,
            time_in          TIME NULL,
            time_out         TIME NULL,
            worked_hours     DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            section_override ENUM('VYROBA','EXPEDICIA','ROZVOZ','ADMIN','INE') NULL,
            note             VARCHAR(255) NULL,
            created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_hr_attendance_employee
                FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """,
        fetch="none",
    )

    # LEAVES
    db_connector.execute_query(
        """
        CREATE TABLE IF NOT EXISTS hr_leaves (
            id          BIGINT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            date_from   DATE NOT NULL,
            date_to     DATE NOT NULL,
            leave_type  ENUM('VACATION','SICK','PASS','OTHER')
                        NOT NULL DEFAULT 'VACATION',
            full_day    TINYINT(1) NOT NULL DEFAULT 1,
            hours       DECIMAL(5,2) NULL,
            days_count  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            note        VARCHAR(255) NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_hr_leaves_employee
                FOREIGN KEY (employee_id) REFERENCES hr_employees(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_slovak_ci
        """,
        fetch="none",
    )


# -------------------------------------------------------------------
# Zamestnanci
# -------------------------------------------------------------------
def list_employees() -> Dict[str, Any]:
    _ensure_schema()
    try:
        rows = db_connector.execute_query(
            """
            SELECT id, code, full_name, section, punch_code,
                   monthly_salary, base_hours_month,
                   vacation_days_total, vacation_days_used,
                   (vacation_days_total - vacation_days_used) AS vacation_days_balance,
                   is_active,
                   created_at, updated_at
            FROM hr_employees
            ORDER BY is_active DESC, full_name
            """,
            fetch="all",
        ) or []
        return {"employees": rows}
    except Exception:
        print("[HR] list_employees ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri načítaní zamestnancov."}


def save_employee(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    if not isinstance(data, dict):
        return {"error": "Chýbajú dáta zamestnanca."}

    emp_id = data.get("id")
    full_name = (data.get("full_name") or "").strip()
    if not full_name:
        return {"error": "Meno zamestnanca je povinné."}

    section = (data.get("section") or "VYROBA").upper()
    if section not in ("VYROBA", "EXPEDICIA", "ROZVOZ", "ADMIN", "INE"):
        section = "VYROBA"

    code = (data.get("code") or "").strip() or None
    punch_code = (data.get("punch_code") or "").strip() or None
    monthly_salary = _parse_float(data.get("monthly_salary"), 0.0)
    base_hours_month = _parse_float(data.get("base_hours_month"), 168.0)
    vacation_total = _parse_float(data.get("vacation_days_total"), 0.0)
    is_active = 1 if data.get("is_active", True) else 0

    try:
        if emp_id:
            # UPDATE
            db_connector.execute_query(
                """
                UPDATE hr_employees
                   SET code                = %s,
                       full_name           = %s,
                       section             = %s,
                       punch_code          = %s,
                       monthly_salary      = %s,
                       base_hours_month    = %s,
                       vacation_days_total = %s,
                       is_active           = %s
                 WHERE id = %s
                """,
                (
                    code,
                    full_name,
                    section,
                    punch_code,
                    monthly_salary,
                    base_hours_month,
                    vacation_total,
                    is_active,
                    emp_id,
                ),
                fetch="none",
            )
            return {"message": "Zamestnanec uložený.", "id": emp_id}
        else:
            # INSERT
            db_connector.execute_query(
                """
                INSERT INTO hr_employees
                    (code, full_name, section, punch_code,
                     monthly_salary, base_hours_month,
                     vacation_days_total, vacation_days_used,
                     is_active)
                VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s)
                """,
                (
                    code,
                    full_name,
                    section,
                    punch_code,
                    monthly_salary,
                    base_hours_month,
                    vacation_total,
                    is_active,
                ),
                fetch="none",
            )
            row = db_connector.execute_query(
                "SELECT LAST_INSERT_ID() AS id", fetch="one"
            ) or {}
            return {"message": "Zamestnanec vytvorený.", "id": row.get("id")}
    except Exception:
        print("[HR] save_employee ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri ukladaní zamestnanca."}


def delete_employee(emp_id: Any) -> Dict[str, Any]:
    _ensure_schema()
    if not emp_id:
        return {"error": "Chýba ID zamestnanca."}
    try:
        db_connector.execute_query(
            "DELETE FROM hr_employees WHERE id=%s", (emp_id,), fetch="none"
        )
        return {"message": "Zamestnanec vymazaný."}
    except Exception:
        print("[HR] delete_employee ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri mazaní zamestnanca."}


# -------------------------------------------------------------------
# Dochádzka
# -------------------------------------------------------------------
def list_attendance(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Vracia zoznam dochádzky podľa dátumu/employee_id.
    JOIN na zamestnancov robíme v Pythone, aby SQL bolo čo najjednoduchšie.
    """
    _ensure_schema()
    d_from = _parse_date(params.get("date_from")) or date.today().replace(day=1)
    d_to = _parse_date(params.get("date_to")) or date.today()
    emp_id = params.get("employee_id")

    where = ["work_date >= %s", "work_date <= %s"]
    args: List[Any] = [d_from, d_to]
    if emp_id:
        where.append("employee_id = %s")
        args.append(emp_id)

    try:
        # 1) načítame dochádzku
        sql_att = f"""
            SELECT
              id,
              employee_id,
              work_date,
              time_in,
              time_out,
              worked_hours,
              section_override,
              note
            FROM hr_attendance
            WHERE {" AND ".join(where)}
            ORDER BY work_date DESC, employee_id
        """
        attendance = db_connector.execute_query(
            sql_att, tuple(args), fetch="all"
        ) or []

        # 2) načítame zamestnancov (meno, sekcia)
        sql_emp = """
            SELECT id, full_name, section
            FROM hr_employees
        """
        employees = db_connector.execute_query(sql_emp, fetch="all") or []
        emp_map = {e["id"]: e for e in employees}

        # 3) spojíme to v Pythone
        items: List[Dict[str, Any]] = []
        for row in attendance:
            e = emp_map.get(row["employee_id"], {})
            out = dict(row)
            out["full_name"] = e.get("full_name", "")
            out["section"] = e.get("section", "")
            items.append(out)

        return {
            "date_from": d_from.isoformat(),
            "date_to": d_to.isoformat(),
            "items": items,
        }

    except Exception:
        print("[HR] list_attendance ERROR")
        print(traceback.format_exc())
        # aby frontend nespadol, vrátime prázdny zoznam a info o chybe
        return {
            "date_from": d_from.isoformat(),
            "date_to": d_to.isoformat(),
            "items": [],
            "error": "Chyba pri načítaní dochádzky.",
        }



def save_attendance(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    if not isinstance(data, dict):
        return {"error": "Chýbajú dáta dochádzky."}

    rec_id = data.get("id")
    emp_id = data.get("employee_id")
    if not emp_id:
        return {"error": "Chýba zamestnanec."}

    work_date = _parse_date(data.get("work_date")) or date.today()
    time_in_str = (data.get("time_in") or "").strip() or None
    time_out_str = (data.get("time_out") or "").strip() or None
    note = (data.get("note") or "").strip() or None

    section_override = data.get("section_override")
    if section_override:
        section_override = section_override.upper()
        if section_override not in ("VYROBA", "EXPEDICIA", "ROZVOZ", "ADMIN", "INE"):
            section_override = None
    else:
        section_override = None

    # výpočet hodín
    worked_hours = _parse_float(data.get("worked_hours"), 0.0)
    try:
        if time_in_str and time_out_str:
            dt_in = datetime.strptime(
                f"{work_date} {time_in_str}", "%Y-%m-%d %H:%M"
            )
            dt_out = datetime.strptime(
                f"{work_date} {time_out_str}", "%Y-%m-%d %H:%M"
            )
            if dt_out < dt_in:
                dt_out = dt_out.replace(day=dt_out.day + 1)
            diff_h = (dt_out - dt_in).total_seconds() / 3600.0
            worked_hours = round(max(diff_h, 0.0), 2)
    except Exception:
        # necháme worked_hours z requestu
        pass

    try:
        if rec_id:
            # UPDATE
            db_connector.execute_query(
                """
                UPDATE hr_attendance
                   SET employee_id      = %s,
                       work_date        = %s,
                       time_in          = %s,
                       time_out         = %s,
                       worked_hours     = %s,
                       section_override = %s,
                       note             = %s
                 WHERE id = %s
                """,
                (
                    emp_id,
                    work_date,
                    time_in_str,
                    time_out_str,
                    worked_hours,
                    section_override,
                    note,
                    rec_id,
                ),
                fetch="none",
            )
            return {"message": "Dochádzka upravená.", "id": rec_id}
        else:
            # INSERT
            db_connector.execute_query(
                """
                INSERT INTO hr_attendance
                    (employee_id, work_date, time_in, time_out,
                     worked_hours, section_override, note)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    emp_id,
                    work_date,
                    time_in_str,
                    time_out_str,
                    worked_hours,
                    section_override,
                    note,
                ),
                fetch="none",
            )
            row = db_connector.execute_query(
                "SELECT LAST_INSERT_ID() AS id", fetch="one"
            ) or {}
            return {"message": "Dochádzka uložená.", "id": row.get("id")}
    except Exception:
        print("[HR] save_attendance ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri ukladaní dochádzky."}


def delete_attendance(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    rec_id = (data or {}).get("id")
    if not rec_id:
        return {"error": "Chýba ID záznamu dochádzky."}
    try:
        db_connector.execute_query(
            "DELETE FROM hr_attendance WHERE id=%s", (rec_id,), fetch="none"
        )
        return {"message": "Dochádzka vymazaná."}
    except Exception:
        print("[HR] delete_attendance ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri mazaní dochádzky."}


# -------------------------------------------------------------------
# Neprítomnosti (PN/dovolenka/priepustky)
# -------------------------------------------------------------------
def _recalc_days_count(
    d_from: date, d_to: date, full_day: bool, hours: Optional[float]
) -> float:
    """
    Zatiaľ jednoduchý model:
      - full_day = True -> celé dni, vrátane d_from aj d_to
      - full_day = False -> hours / 8.0
    """
    if not d_from or not d_to:
        return 0.0
    if full_day:
        return round((d_to - d_from).days + 1, 2)
    if hours is None:
        return 0.0
    return round(float(hours) / 8.0, 2)


def list_leaves(params: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    d_from = _parse_date(params.get("date_from")) or date.today().replace(day=1)
    d_to = _parse_date(params.get("date_to")) or date.today()
    emp_id = params.get("employee_id")

    where = ["l.date_from <= %s", "l.date_to >= %s"]
    args: List[Any] = [d_to, d_from]
    if emp_id:
        where.append("l.employee_id = %s")
        args.append(emp_id)

    sql = f"""
        SELECT
            l.id,
            l.employee_id,
            e.full_name,
            l.date_from,
            l.date_to,
            l.leave_type,
            l.full_day,
            l.hours,
            l.days_count,
            l.note
        FROM hr_leaves l
        JOIN hr_employees e ON e.id = l.employee_id
        WHERE {" AND ".join(where)}
        ORDER BY l.date_from DESC, e.full_name
    """
    try:
        rows = db_connector.execute_query(sql, tuple(args), fetch="all") or []
        return {
            "date_from": d_from.isoformat(),
            "date_to": d_to.isoformat(),
            "items": rows,
        }
    except Exception:
        print("[HR] list_leaves ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri načítaní neprítomností."}


def save_leave(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Uloží neprítomnosť.
    - pri type VACATION upraví hr_employees.vacation_days_used
    - pri UPDATE najprv vráti staré days_count a potom pripočíta nové
    """
    _ensure_schema()
    if not isinstance(data, dict):
        return {"error": "Chýbajú dáta neprítomnosti."}

    leave_id = data.get("id")
    emp_id = data.get("employee_id")
    if not emp_id:
        return {"error": "Chýba zamestnanec."}

    d_from = _parse_date(data.get("date_from"))
    d_to = _parse_date(data.get("date_to"))
    if not d_from or not d_to:
        return {"error": "Chýba alebo je neplatný dátum."}
    if d_to < d_from:
        d_from, d_to = d_to, d_from

    leave_type = (data.get("leave_type") or "VACATION").upper()
    if leave_type not in ("VACATION", "SICK", "PASS", "OTHER"):
        leave_type = "VACATION"

    full_day = bool(data.get("full_day", True))
    hours = None
    if not full_day:
        hours = _parse_float(data.get("hours"), 0.0)

    note = (data.get("note") or "").strip() or None
    new_days = _recalc_days_count(d_from, d_to, full_day, hours)

    def _tx(conn):
        cur = conn.cursor(dictionary=True)
        current_id = leave_id

        # starý záznam pri update
        old = None
        if current_id:
            cur.execute(
                "SELECT * FROM hr_leaves WHERE id=%s FOR UPDATE", (current_id,)
            )
            old = cur.fetchone()
            if not old:
                return {"error": "Neplatné ID neprítomnosti."}

        # vrátenie starých dní dovolenky
        if old and (old.get("leave_type") or "").upper() == "VACATION":
            old_days = float(old.get("days_count") or 0.0)
            if old_days != 0.0:
                cur.execute(
                    """
                    UPDATE hr_employees
                       SET vacation_days_used = GREATEST(vacation_days_used - %s, 0)
                     WHERE id=%s
                    """,
                    (old_days, old["employee_id"]),
                )

        # uloženie nového záznamu
        if current_id:
            cur.execute(
                """
                UPDATE hr_leaves
                   SET employee_id = %s,
                       date_from   = %s,
                       date_to     = %s,
                       leave_type  = %s,
                       full_day    = %s,
                       hours       = %s,
                       days_count  = %s,
                       note        = %s,
                       updated_at  = NOW()
                 WHERE id = %s
                """,
                (
                    emp_id,
                    d_from,
                    d_to,
                    leave_type,
                    1 if full_day else 0,
                    hours,
                    new_days,
                    note,
                    current_id,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO hr_leaves
                    (employee_id, date_from, date_to,
                     leave_type, full_day, hours, days_count, note,
                     created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                """,
                (
                    emp_id,
                    d_from,
                    d_to,
                    leave_type,
                    1 if full_day else 0,
                    hours,
                    new_days,
                    note,
                ),
            )
            current_id = cur.lastrowid

        # nový typ VACATION -> pripočítať dni
        if leave_type == "VACATION" and new_days > 0:
            cur.execute(
                """
                UPDATE hr_employees
                   SET vacation_days_used = vacation_days_used + %s
                 WHERE id=%s
                """,
                (new_days, emp_id),
            )

        return {"message": "Neprítomnosť uložená.", "id": current_id}

    try:
        return db_connector.with_transaction(_tx)
    except Exception:
        print("[HR] save_leave ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri ukladaní neprítomnosti."}


def delete_leave(data: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_schema()
    leave_id = (data or {}).get("id")
    if not leave_id:
        return {"error": "Chýba ID neprítomnosti."}

    def _tx(conn):
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM hr_leaves WHERE id=%s FOR UPDATE", (leave_id,))
        row = cur.fetchone()
        if not row:
            return {"error": "Neprítomnosť sa nenašla."}

        if (row.get("leave_type") or "").upper() == "VACATION":
            days = float(row.get("days_count") or 0.0)
            if days > 0:
                cur.execute(
                    """
                    UPDATE hr_employees
                       SET vacation_days_used = GREATEST(vacation_days_used - %s, 0)
                     WHERE id=%s
                    """,
                    (days, row["employee_id"]),
                )
        cur.execute("DELETE FROM hr_leaves WHERE id=%s", (leave_id,))
        return {"message": "Neprítomnosť vymazaná."}

    try:
        return db_connector.with_transaction(_tx)
    except Exception:
        print("[HR] delete_leave ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri mazaní neprítomnosti."}


# -------------------------------------------------------------------
# Súhrn nákladov na prácu + cena práce / kg
# -------------------------------------------------------------------
def get_labor_summary(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Vstup (request.args):
      - date_from, date_to (YYYY-MM-DD)
    Výstup:
      - total_hours, total_cost
      - total_prod_kg
      - cost_per_kg_total
      - sekcie + zamestnanci
    """
    _ensure_schema()
    d_from = _parse_date(params.get("date_from")) or date.today().replace(day=1)
    d_to = _parse_date(params.get("date_to")) or date.today()

    try:
        # 1) hodiny + náklady podľa zamestnanca a sekcie
        rows = db_connector.execute_query(
            """
            SELECT
                e.id AS employee_id,
                e.full_name,
                COALESCE(a.section_override, e.section) AS section,
                e.monthly_salary,
                e.base_hours_month,
                SUM(a.worked_hours) AS total_hours
            FROM hr_attendance a
            JOIN hr_employees e ON e.id = a.employee_id
            WHERE a.work_date BETWEEN %s AND %s
            GROUP BY e.id, e.full_name,
                     COALESCE(a.section_override, e.section),
                     e.monthly_salary, e.base_hours_month
            """,
            (d_from, d_to),
            fetch="all",
        ) or []
    except Exception:
        print("[HR] get_labor_summary – SELECT attendance ERROR")
        print(traceback.format_exc())
        return {"error": "Chyba pri výpočte nákladov na prácu."}

    employees_out: List[Dict[str, Any]] = []
    sections_map: Dict[str, Dict[str, float]] = {}
    total_hours = 0.0
    total_cost = 0.0

    for r in rows:
        sec = (r.get("section") or "VYROBA").upper()
        hours = float(r.get("total_hours") or 0.0)
        msal = float(r.get("monthly_salary") or 0.0)
        base_h = float(r.get("base_hours_month") or 1.0) or 1.0
        hourly_rate = msal / base_h if base_h > 0 else 0.0
        cost = hours * hourly_rate

        total_hours += hours
        total_cost += cost

        employees_out.append(
            {
                "employee_id": r.get("employee_id"),
                "full_name": r.get("full_name"),
                "section": sec,
                "hours": round(hours, 2),
                "hourly_rate": round(hourly_rate, 4),
                "labor_cost": round(cost, 2),
            }
        )

        sec_rec = sections_map.setdefault(sec, {"hours": 0.0, "cost": 0.0})
        sec_rec["hours"] += hours
        sec_rec["cost"] += cost

    # 2) koľko kg sa vyrobilo v danom období (z zaznamy_vyroba)
    try:
        prod = db_connector.execute_query(
            """
            SELECT SUM(COALESCE(realne_mnozstvo_kg,0)) AS total_kg
              FROM zaznamy_vyroba
             WHERE datum_ukoncenia BETWEEN %s AND %s
            """,
            (d_from, d_to),
            fetch="one",
        ) or {}
        total_kg = float(prod.get("total_kg") or 0.0)
    except Exception:
        print("[HR] get_labor_summary – SELECT výroba ERROR")
        print(traceback.format_exc())
        total_kg = 0.0

    cost_per_kg_total = round(total_cost / total_kg, 4) if total_kg > 0 else 0.0

    sections_out: List[Dict[str, Any]] = []
    for sec, rec in sections_map.items():
        c = rec["cost"]
        sections_out.append(
            {
                "section": sec,
                "hours": round(rec["hours"], 2),
                "labor_cost": round(c, 2),
                "cost_per_kg": round(c / total_kg, 4) if total_kg > 0 else 0.0,
            }
        )

    return {
        "period": {"date_from": d_from.isoformat(), "date_to": d_to.isoformat()},
        "total_hours": round(total_hours, 2),
        "total_labor_cost": round(total_cost, 2),
        "total_prod_kg": round(total_kg, 3),
        "cost_per_kg_total": cost_per_kg_total,
        "sections": sections_out,
        "employees": employees_out,
    }
