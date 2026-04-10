# calendar_api.py
from __future__ import annotations
from datetime import datetime
from flask import Blueprint, request, jsonify, g
from auth_handler import login_required
import db_connector
import hr_handler  

calendar_bp = Blueprint("calendar_api", __name__)

def _combine_date_time(d_str, t_str, is_end=False):
    if not d_str: return None
    t = t_str or ("23:59:59" if is_end else "00:00:00")
    if len(t) == 5: t += ":00" 
    return f"{d_str} {t}"

@calendar_bp.route("/employees", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_calendar_employees():
    return jsonify(hr_handler.list_employees())

@calendar_bp.route("/events", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_list():
    start = request.args.get("start", "2000-01-01")
    end = request.args.get("end", "2100-01-01")
    event_type_filter = request.args.get("type", None)
    events = []
    
    # 1. Klasické udalosti
    query = """
        SELECT id, title, type, start_at, end_at, all_day, 
               priority, color AS color_hex, description
        FROM calendar_events
        WHERE start_at >= %s AND start_at <= %s
          AND is_deleted = 0 AND status != 'CANCELLED'
    """
    params = [start, end]
    if event_type_filter:
        query += " AND type = %s"
        params.append(event_type_filter)
        
    rows = db_connector.execute_query(query, tuple(params)) or []
    for r in rows:
        events.append({
            "id": str(r["id"]),
            "title": r["title"],
            "type": r["type"],
            "start": str(r["start_at"]).replace(" ", "T"),
            "end": str(r["end_at"]).replace(" ", "T"),
            "all_day": bool(r["all_day"]),
            "priority": r["priority"],
            "color_hex": r["color_hex"],
            "description": r["description"]
        })
        
    # 2. Neprítomnosti z HR modulu (Dovolenky, absencie, PN, Paragrafy)
    if not event_type_filter or event_type_filter in ("VACATION", "ABSENCE", "PASS", "SICK"):
        query_hr = """
            SELECT l.id, l.employee_id, e.full_name, l.date_from, l.date_to, l.leave_type, l.note
            FROM hr_leaves l
            JOIN hr_employees e ON l.employee_id = e.id
            WHERE l.date_from <= %s AND l.date_to >= %s
        """
        hr_rows = db_connector.execute_query(query_hr, (end[:10], start[:10])) or []
        for r in hr_rows:
            leave_type = r["leave_type"]
            
            if leave_type == 'VACATION':
                title, ev_type, color = f"Dovolenka - {r['full_name']}", "VACATION", "#f59e0b"
            elif leave_type == 'PASS':
                title, ev_type, color = f"Paragraf - {r['full_name']}", "PASS", "#8b5cf6"
            elif leave_type == 'SICK':
                title, ev_type, color = f"PN / OČR - {r['full_name']}", "SICK", "#3b82f6"
            else:
                title, ev_type, color = f"Absencia - {r['full_name']}", "ABSENCE", "#ef4444"
            
            events.append({
                "id": f"HR-{r['id']}", 
                "title": title,
                "type": ev_type,
                "start": str(r["date_from"]) + "T00:00:00",
                "end": str(r["date_to"]) + "T23:59:59",
                "all_day": True,
                "priority": "NORMAL",
                "color_hex": color,
                "description": r["note"] or "",
                "employee_id": r["employee_id"],
                "is_hr": True
            })
        
    return jsonify(events)

@calendar_bp.route("/events", methods=["POST"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_create():
    data = request.get_json(force=True) or {}
    
    event_id = data.get("id")
    event_type = data.get("type", "MEETING")
    status = data.get("status", "OPEN")
    
    # =========================================================================
    # --- 1. RÝCHLE AKCIE: ZRUŠIŤ / SPLNIŤ (Ochrana voči 400 Bad Request) ---
    # =========================================================================
    if status == "CANCELLED" and event_id:
        if str(event_id).startswith("HR-"):
            hr_id = int(str(event_id).replace("HR-", ""))
            res = hr_handler.delete_leave({"id": hr_id})
            # Tichý "success" ak sa dovolenka už predtým vymazala
            if "error" in res and "nenašla" not in res.get("error", ""):
                return jsonify(res), 400
            return jsonify({"message": "Neprítomnosť zrušená."})
        else:
            db_connector.execute_query("UPDATE calendar_events SET status='CANCELLED', is_deleted=1 WHERE id=%s", (int(event_id),), fetch="none")
            return jsonify({"message": "Udalosť zrušená."})
            
    if status == "DONE" and event_id:
        if not str(event_id).startswith("HR-"):
            db_connector.execute_query("UPDATE calendar_events SET status='DONE' WHERE id=%s", (int(event_id),), fetch="none")
        return jsonify({"message": "Udalosť splnená."})

    # =========================================================================
    # --- 2. ZÁZNAM PRE HR: TVORBA A ÚPRAVA ---
    # =========================================================================
    if event_type in ("VACATION", "ABSENCE", "PASS", "SICK") or (isinstance(event_id, str) and str(event_id).startswith("HR-")):
        hr_id = int(str(event_id).replace("HR-", "")) if event_id and str(event_id).startswith("HR-") else None
        
        emp_id = data.get("employee_id")
        if not emp_id:
            return jsonify({"error": "Pre túto neprítomnosť musíte vybrať zamestnanca z HR!"}), 400
            
        mapped_leave = "OTHER"
        if event_type == "VACATION": mapped_leave = "VACATION"
        elif event_type == "PASS": mapped_leave = "PASS"
        elif event_type == "SICK": mapped_leave = "SICK"
        
        leave_data = {
            "id": hr_id,
            "employee_id": emp_id,
            "date_from": data.get("start_date") or data.get("date"),
            "date_to": data.get("end_date") or data.get("date"),
            "leave_type": mapped_leave,
            "full_day": True,
            "note": data.get("description", "")
        }
        res = hr_handler.save_leave(leave_data)
        if "error" in res: return jsonify(res), 400
        return jsonify({"message": "Neprítomnosť uložená v HR."})

    # =========================================================================
    # --- 3. ŠTANDARDNÁ UDALOSŤ: TVORBA A ÚPRAVA ---
    # =========================================================================
    title = data.get("title")
    if not title: return jsonify({"error": "Chýba názov"}), 400

    start_date = data.get("start_date") or data.get("date")
    end_date = data.get("end_date") or start_date
    all_day = 1 if data.get("all_day") else 0
    
    if all_day:
        start_at = f"{start_date} 00:00:00"
        end_at = f"{end_date} 23:59:59"
    else:
        start_at = _combine_date_time(start_date, data.get("start_time"))
        end_at = _combine_date_time(end_date, data.get("end_time"), is_end=True)

    user_id = getattr(g, "user", {}).get("id", 1)
    
    if event_id and not str(event_id).startswith("HR-"):
        query = """
            UPDATE calendar_events 
            SET title=%s, type=%s, start_at=%s, end_at=%s, all_day=%s, 
                priority=%s, location=%s, description=%s, status=%s, updated_at=NOW()
            WHERE id=%s
        """
        params = (
            title, event_type, start_at, end_at, all_day,
            data.get("priority", "NORMAL"), data.get("location", ""),
            data.get("description", ""), status, int(event_id)
        )
    else:
        query = """
            INSERT INTO calendar_events 
            (title, type, start_at, end_at, all_day, priority, location, description, status, created_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """
        params = (
            title, event_type, start_at, end_at, all_day,
            data.get("priority", "NORMAL"), data.get("location", ""),
            data.get("description", ""), status, user_id
        )
        
    db_connector.execute_query(query, params, fetch="none")
    return jsonify({"message": "Uložené"})


@calendar_bp.route("/events/<string:event_id>", methods=["DELETE"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_delete(event_id):
    if str(event_id).startswith("HR-"):
        real_id = int(event_id.replace("HR-", ""))
        res = hr_handler.delete_leave({"id": real_id})
        if "error" in res: return jsonify(res), 400
    else:
        query = "UPDATE calendar_events SET is_deleted = 1 WHERE id = %s"
        db_connector.execute_query(query, (int(event_id),), fetch="none")
        
    return jsonify({"message": "Vymazané"})