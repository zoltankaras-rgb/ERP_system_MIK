# calendar_api.py
from __future__ import annotations
from datetime import datetime
from flask import Blueprint, request, jsonify, g
from auth_handler import login_required
import db_connector

calendar_bp = Blueprint("calendar_api", __name__)

# --- Pomocné ---
def _combine_date_time(d_str, t_str, is_end=False):
    """Spojí dátum a čas do formátu pre MySQL (YYYY-MM-DD HH:MM:SS)"""
    if not d_str: return None
    t = t_str or ("23:59:59" if is_end else "00:00:00")
    if len(t) == 5: t += ":00" # dopln sekundy ak chybaju
    return f"{d_str} {t}"

# --- ENDPOINTY ---

@calendar_bp.route("/events", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_list():
    """Zoznam udalostí (SQL SELECT)"""
    start = request.args.get("start")
    end = request.args.get("end")
    
    # Načítame udalosti (cez db_connector)
    query = """
        SELECT id, title, event_type, start_at, end_at, all_day, 
               priority, color AS color_hex, description
        FROM calendar_events
        WHERE start_at >= %s AND start_at <= %s
    """
    # Ak nemáme filter, dáme default rozsah (aby to nepadlo)
    if not start: start = "2000-01-01"
    if not end: end = "2100-01-01"

    rows = db_connector.execute_query(query, (start, end)) or []
    
    # Formátovanie pre frontend
    events = []
    for r in rows:
        events.append({
            "id": r["id"],
            "title": r["title"],
            "type": r["event_type"],
            "start": str(r["start_at"]).replace(" ", "T"),
            "end": str(r["end_at"]).replace(" ", "T"),
            "all_day": bool(r["all_day"]),
            "priority": r["priority"],
            "color_hex": r["color_hex"],
            "description": r["description"]
        })
    
    return jsonify(events)

@calendar_bp.route("/events", methods=["POST"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_create():
    """Vytvorenie udalosti (SQL INSERT)"""
    data = request.get_json(force=True) or {}
    
    title = data.get("title")
    if not title: return jsonify({"error": "Chýba názov"}), 400

    # Spracovanie dátumov z frontendu
    start_date = data.get("start_date")
    end_date = data.get("end_date") or start_date
    all_day = 1 if data.get("all_day") else 0
    
    # Ak je all_day, časy ignorujeme
    if all_day:
        start_at = f"{start_date} 00:00:00"
        end_at = f"{end_date} 23:59:59"
    else:
        start_at = _combine_date_time(start_date, data.get("start_time"))
        end_at = _combine_date_time(end_date, data.get("end_time"), is_end=True)

    user_id = getattr(g, "user", {}).get("id", 1)
    
    # SQL INSERT
    query = """
        INSERT INTO calendar_events 
        (title, event_type, start_at, end_at, all_day, priority, color, description, created_by_id, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    """
    params = (
        title,
        data.get("type", "MEETING"),
        start_at,
        end_at,
        all_day,
        data.get("priority", "NORMAL"),
        data.get("color_hex", "#2563eb"),
        data.get("description", ""),
        user_id
    )
    
    # Použijeme db_connector na zápis
    db_connector.execute_query(query, params, fetch="none")
    
    return jsonify({"message": "Uložené"})

@calendar_bp.route("/events/<int:event_id>", methods=["DELETE"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_delete(event_id):
    """Vymazanie udalosti (SQL DELETE)"""
    query = "DELETE FROM calendar_events WHERE id = %s"
    db_connector.execute_query(query, (event_id,), fetch="none")
    return jsonify({"message": "Vymazané"})