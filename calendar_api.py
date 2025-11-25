# calendar_api.py
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from flask import Blueprint, request, jsonify, g

from auth_handler import login_required
from db_sqlalchemy import SessionLocal

from calendar_models import (
    CalendarEvent,
    CalendarEventReminder,
    EventType,
    Priority,
    ReminderChannel,
    ReminderTargetType,
)
from calendar_service import (
    CalendarService,
    ReminderSpec,
    EventValidationError,
    ResourceConflictError,
)

import db_connector  # na kontakty (calendar_contacts)


calendar_bp = Blueprint("calendar_api", __name__)


# ---------- POMOCNÉ PARSERY --------------------------------------


def _parse_iso(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


def _parse_event_type(raw: Optional[str]) -> Optional[EventType]:
    if not raw:
        return None
    raw = raw.strip().upper()
    try:
        return EventType[raw]
    except Exception:
        # možno už je to hodnota (MEETING, TENDER, ...)
        try:
            return EventType(raw)
        except Exception:
            return None


def _parse_priority(raw: Optional[str]) -> Priority:
    if not raw:
        return Priority.NORMAL
    raw = raw.strip().upper()
    try:
        return Priority[raw]
    except Exception:
        return Priority.NORMAL


def _parse_reminders(data_list: Any) -> List[ReminderSpec]:
    out: List[ReminderSpec] = []
    if not data_list:
        return out
    for item in data_list:
        if not isinstance(item, dict):
            continue
        try:
            minutes = int(item.get("minutes_before") or 0)
        except Exception:
            continue
        if minutes <= 0:
            continue

        channel_raw = (item.get("channel") or "").upper()
        target_type_raw = (item.get("target_type") or "").upper()

        try:
            channel = ReminderChannel[channel_raw]
        except Exception:
            continue
        try:
            target_type = ReminderTargetType[target_type_raw]
        except Exception:
            continue

        spec = ReminderSpec(
            minutes_before=minutes,
            channel=channel,
            target_type=target_type,
            anchor_field=item.get("anchor_field") or "start_at",
            target_group_code=item.get("target_group_code") or None,
            custom_email=item.get("custom_email") or None,
            custom_phone=item.get("custom_phone") or None,
            message_template=item.get("message_template") or None,
        )
        out.append(spec)
    return out


def _serialize_event(ev: CalendarEvent) -> Dict[str, Any]:
    """
    Základné info pre mesačný kalendár.
    """
    return {
        "id": ev.id,
        "title": ev.title,
        "type": ev.event_type.name if ev.event_type else None,
        "start": ev.start_at.isoformat() if ev.start_at else None,
        "end": ev.end_at.isoformat() if ev.end_at else None,
        "all_day": bool(ev.all_day),
        "priority": ev.priority.name if ev.priority else "NORMAL",
        "color_hex": ev.color_hex,  # DÔLEŽITÉ: frontend očakáva color_hex
        "location": ev.location,
        "description": ev.description,
    }


def _serialize_event_detail(ev: CalendarEvent) -> Dict[str, Any]:
    """
    Detail udalosti – doplnené pripomienky atď. Pre editáciu vo formulári.
    """
    base = _serialize_event(ev)

    reminders_payload: List[Dict[str, Any]] = []
    for r in (ev.reminders or []):
        reminders_payload.append(
            {
                "id": r.id,
                "remind_at": r.remind_at.isoformat() if r.remind_at else None,
                "channel": r.channel.name if r.channel else None,
                "target_type": r.target_type.name if r.target_type else None,
                "target_group_code": r.target_group_code,
                "custom_email": r.custom_email,
                "custom_phone": r.custom_phone,
                "message_template": r.message_template,
                "is_sent": bool(r.is_sent),
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                # minutes_before nevieme spätne spočítať 100%, ale do UI
                # to zatiaľ nepotrebujeme – ak bude treba, doplníme.
            }
        )

    base["reminders"] = reminders_payload
    return base


# =================================================================
#  UDALOSTI
# =================================================================


@calendar_bp.route("/events", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_list() -> Any:
    """
    Zoznam udalostí pre mesiac:
    /api/calendar/events?start=YYYY-MM-DDTHH:MM&end=YYYY-MM-DDTHH:MM
    """
    start_dt = _parse_iso(request.args.get("start"))
    end_dt = _parse_iso(request.args.get("end"))
    event_type = _parse_event_type(request.args.get("type"))

    with SessionLocal() as session:
        svc = CalendarService(session)
        events = svc.list_events(start=start_dt, end=end_dt, event_type=event_type)
        return jsonify([_serialize_event(e) for e in events])


@calendar_bp.route("/events/<int:event_id>", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_detail(event_id: int) -> Any:
    with SessionLocal() as session:
        ev = session.get(CalendarEvent, event_id)
        if not ev:
            return jsonify({"error": "Udalosť neexistuje."}), 404
        return jsonify(_serialize_event_detail(ev))


@calendar_bp.route("/events", methods=["POST"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_events_create_or_update() -> Any:
    """
    Vytvorenie / úprava udalosti z frontendu.

    Očakávaný JSON payload (calendar.js):

    {
      "id": optional int,
      "title": "...",
      "type": "MEETING" | "TENDER" | "VACATION" | ...,
      "start_date": "YYYY-MM-DD",
      "start_time": "HH:MM",  (ak all_day = false)
      "end_date": "YYYY-MM-DD",
      "end_time": "HH:MM",
      "all_day": true/false,
      "priority": "NORMAL"|"HIGH"|"CRITICAL",
      "description": "...",
      "location": "...",
      "color_hex": "#ff0000",
      "reminders": [...]
    }
    """
    data = request.get_json(force=True) or {}

    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Názov udalosti je povinný."}), 400

    # dátumy z formulára: date + time
    start_date = data.get("start_date")
    end_date = data.get("end_date") or start_date
    all_day = bool(data.get("all_day"))

    def _combine(dt_str: Optional[str], tm_str: Optional[str]) -> Optional[datetime]:
        if not dt_str:
            return None
        if all_day:
            return datetime.fromisoformat(dt_str + "T00:00:00")
        tm = tm_str or "00:00"
        return datetime.fromisoformat(dt_str + "T" + tm + ":00")

    start_at = _combine(start_date, data.get("start_time"))
    end_at = _combine(end_date, data.get("end_time")) or start_at

    if not start_at or not end_at:
        return jsonify({"error": "Začiatok aj koniec udalosti sú povinné."}), 400

    etype = _parse_event_type(data.get("type"))
    if not etype:
        return jsonify({"error": "Neplatný typ udalosti."}), 400

    priority = _parse_priority(data.get("priority"))
    desc = data.get("description") or None
    location = data.get("location") or None
    color_hex = data.get("color_hex") or None

    # pripomienky
    reminders = _parse_reminders(data.get("reminders"))

    # kto to vytvoril / upravil – vezmeme user_id z g.user alebo session
    user_id = None
    try:
        user_id = int(getattr(g, "user", {}).get("id", 0))
    except Exception:
        user_id = 0
    if not user_id:
        # fallback, ak nemáš g.user
        user_id = 1

    with SessionLocal() as session:
        svc = CalendarService(session)

        # momentálne len CREATE – UPDATE by bolo treba doplniť v service
        try:
            ev = svc.create_event(
                title=title,
                event_type=etype,
                start_at=start_at,
                end_at=end_at,
                created_by_id=user_id,
                all_day=all_day,
                description=desc,
                priority=priority,
                color=color_hex,
                location=location,
                reminders=reminders,
            )
        except EventValidationError as e:
            session.rollback()
            return jsonify({"error": str(e)}), 400
        except ResourceConflictError as e:
            session.rollback()
            # vrátime jednoduchú informáciu – môžeš vylepšiť text
            return jsonify(
                {
                    "error": "Konflikt zdrojov (auto / zasadačka).",
                    "conflicts": [c.id for c in e.conflicts],
                }
            ), 409
        except Exception as e:
            session.rollback()
            return jsonify({"error": f"Chyba pri ukladaní udalosti: {e}"}), 500

        return jsonify({"id": ev.id, "event": _serialize_event_detail(ev)})


# =================================================================
#  KONTAKTY PRE KALENDÁR
#  (kalendár -> kontakt, ktorému sa posielajú notifikácie)
# =================================================================


@calendar_bp.route("/contacts", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_calendar_contacts_list() -> Any:
    """
    Zoznam kontaktov pre Enterprise kalendár.

    Frontend (calendar.js) očakáva pole:
      [
        {"id":1, "name":"Mgr. Test", "email":"x@y.z", "phone":"+421..."},
        ...
      ]
    """
    rows = db_connector.execute_query(
        """
        SELECT id, name, email, phone
        FROM calendar_contacts
        WHERE is_active = 1
        ORDER BY name
        """,
        fetch="all",
    ) or []
    return jsonify(rows)


@calendar_bp.route("/contacts", methods=["POST"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_calendar_contacts_save() -> Any:
    """
    Vytvorenie / úprava kontaktnej osoby.

    Payload:
      {
        "id": 1,            # voliteľné, pri editácii
        "name": "Meno",
        "email": "x@y.z",
        "phone": "+421..."
      }

    Odpoveď:
      {"id": <ID_kontaktu>}
    """
    data = request.get_json(silent=True) or request.form.to_dict() or {}

    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip() or None
    phone = (data.get("phone") or "").strip() or None
    raw_id = data.get("id")

    if not name:
        return jsonify({"error": "Meno kontaktnej osoby je povinné."}), 400

    contact_id: Optional[int] = None
    if raw_id not in (None, "", 0, "0"):
        try:
            contact_id = int(raw_id)
        except Exception:
            return jsonify({"error": "Neplatné ID kontaktu."}), 400

    if contact_id is not None:
        db_connector.execute_query(
            """
            UPDATE calendar_contacts
               SET name=%s,
                   email=%s,
                   phone=%s
             WHERE id=%s
            """,
            params=(name, email, phone, contact_id),
            fetch=None,
        )
        return jsonify({"id": contact_id})

    db_connector.execute_query(
        """
        INSERT INTO calendar_contacts (name, email, phone)
        VALUES (%s, %s, %s)
        """,
        params=(name, email, phone),
        fetch=None,
    )
    row = db_connector.execute_query("SELECT LAST_INSERT_ID() AS id", fetch="one") or {}
    new_id = int(row.get("id", 0) or 0)
    return jsonify({"id": new_id})


# =================================================================
#  REPORT: HISTÓRIA NOTIFIKÁCIÍ
# =================================================================


@calendar_bp.route("/notifications/history", methods=["GET"])
@login_required(role=("kancelaria", "veduci", "admin"))
def api_notifications_history() -> Any:
    """
    Jednoduchý report „história notifikácií“:
      čo, komu, kedy, cez aký kanál a či bolo odoslané.

    Číta z tabuľky calendar_event_reminders (SQLAlchemy model).
    """
    date_from = _parse_iso(request.args.get("from"))
    date_to = _parse_iso(request.args.get("to"))

    with SessionLocal() as session:
        q = (
            session.query(CalendarEventReminder, CalendarEvent)
            .join(CalendarEvent, CalendarEvent.id == CalendarEventReminder.event_id)
        )

        if date_from is not None:
            q = q.filter(CalendarEventReminder.remind_at >= date_from)
        if date_to is not None:
            q = q.filter(CalendarEventReminder.remind_at <= date_to)

        q = q.order_by(CalendarEventReminder.remind_at.desc()).limit(500)

        rows = []
        for r, ev in q.all():
            rows.append(
                {
                    "id": r.id,
                    "event_id": ev.id,
                    "event_title": ev.title,
                    "event_type": ev.event_type.name if ev.event_type else None,
                    "remind_at": r.remind_at.isoformat() if r.remind_at else None,
                    "channel": r.channel.name if r.channel else None,
                    "target_type": r.target_type.name if r.target_type else None,
                    "target_group_code": r.target_group_code,
                    "custom_email": r.custom_email,
                    "custom_phone": r.custom_phone,
                    "message_template": r.message_template,
                    "is_sent": bool(r.is_sent),
                    "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                }
            )

        return jsonify(rows)
