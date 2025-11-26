# Nepoužíva saný import, ale je tu pre prípad, že by si chcel
# calendar_service.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Iterable

from sqlalchemy.orm import Session
from sqlalchemy import and_

from dateutil.rrule import rrulestr  # pip install python-dateutil

from calendar_models import (
    CalendarEvent,
    CalendarResource,
    CalendarEventReminder,
    EventType,
    MeetingType,
    VacationStatus,
    Priority,
    ReminderChannel,
    ReminderTargetType,
)


# -------------------- VLASTNÉ CHYBY ------------------------------


class EventValidationError(Exception):
    """Chyba pri validácii vstupu (povinné polia, zlé typy, atď.)."""
    pass


class ResourceConflictError(Exception):
    """Konflikt zdrojov (auto, zasadačka, ...) v danom čase."""

    def __init__(self, conflicts: List[CalendarEvent]):
        super().__init__("Resource conflict")
        self.conflicts = conflicts


# -------------------- DTO PRE PRIPOMIENKY ------------------------


@dataclass
class ReminderSpec:
    """
    Špecifikácia pripomienky pri vytváraní eventu.

    anchor_field: z ktorého dátumu počítame (napr. "start_at",
                  "vo_submission_deadline").
    minutes_before: koľko minút pred anchor_field.
    """

    minutes_before: int
    channel: ReminderChannel
    target_type: ReminderTargetType
    anchor_field: str = "start_at"
    target_group_code: Optional[str] = None
    custom_email: Optional[str] = None
    custom_phone: Optional[str] = None
    message_template: Optional[str] = None


# -------------------- SERVICE ------------------------------------


class CalendarService:
    def __init__(self, session: Session):
        self.session = session

    # --------- PUBLIC API -----------------------------------------

    def list_events(
        self,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        event_type: Optional[EventType] = None,
    ) -> List[CalendarEvent]:
        """
        Zoznam udalostí v danom intervale. Nič sa NEmaže – historické
        udalosti zostávajú v DB.
        """
        q = self.session.query(CalendarEvent).filter(CalendarEvent.is_cancelled == False)

        if start is not None:
            q = q.filter(CalendarEvent.start_at >= start)
        if end is not None:
            q = q.filter(CalendarEvent.start_at <= end)
        if event_type is not None:
            q = q.filter(CalendarEvent.event_type == event_type)

        # necháme poradie podľa začiatku
        return list(q.order_by(CalendarEvent.start_at.asc()).all())

    def get_event(self, event_id: int) -> Optional[CalendarEvent]:
        return self.session.get(CalendarEvent, event_id)

    def create_event(
        self,
        *,
        title: str,
        event_type: EventType,
        start_at: datetime,
        end_at: Optional[datetime],
        created_by_id: int,
        all_day: bool = False,
        description: Optional[str] = None,
        priority: Priority = Priority.NORMAL,
        color: Optional[str] = None,
        location: Optional[str] = None,
        attendees_ids: Optional[List[int]] = None,
        resource_ids: Optional[List[int]] = None,
        recurrence_rule: Optional[str] = None,
        recurrence_until: Optional[datetime] = None,
        reminders: Optional[List[ReminderSpec]] = None,
        # špecifické polia podľa typu:
        meeting_type: Optional[MeetingType] = None,
        online_url: Optional[str] = None,
        vo_declaration_date: Optional[datetime] = None,
        vo_questions_deadline: Optional[datetime] = None,
        vo_submission_deadline: Optional[datetime] = None,
        vo_envelope_opening: Optional[datetime] = None,
        vo_estimated_value: Optional[float] = None,
        vo_docs_url: Optional[str] = None,
        vacation_status: Optional[VacationStatus] = None,
        asset_id: Optional[int] = None,
        service_type: Optional[str] = None,
        project_id: Optional[int] = None,
        task_id: Optional[int] = None,
    ) -> CalendarEvent:
        """
        Vytvorí nový event, skontroluje validitu, konflikty resource-ov,
        vytvorí pripomienky a uloží do DB.
        """

        # ---- základná validácia ----------------------------------
        if not title:
            raise EventValidationError("Title is required.")

        if end_at is not None and end_at < start_at:
            raise EventValidationError("End time must be after start time.")

        if event_type not in EventType:
            raise EventValidationError("Invalid event type.")

        # špecifické pravidlá podľa typu
        self._validate_event_type_specific(
            event_type=event_type,
            vacation_status=vacation_status,
            asset_id=asset_id,
        )

        # ---- vytvor objekt eventu -------------------------------
        event = CalendarEvent(
            title=title,
            event_type=event_type,
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
            description=description,
            priority=priority,
            color_hex=color,
            location=location,
            recurrence_rule=recurrence_rule,
            recurrence_until=recurrence_until,
            created_by_id=created_by_id,
            project_id=project_id,
            task_id=task_id,
        )

        # typovo špecifické polia
        if event_type == EventType.MEETING:
            event.meeting_type = meeting_type
            event.online_url = online_url

        if event_type == EventType.TENDER:
            event.vo_declaration_date = vo_declaration_date
            event.vo_questions_deadline = vo_questions_deadline
            event.vo_submission_deadline = vo_submission_deadline
            event.vo_envelope_opening = vo_envelope_opening
            event.vo_estimated_value = vo_estimated_value
            event.vo_docs_url = vo_docs_url

        if event_type in {EventType.VACATION, EventType.ABSENCE}:
            event.vacation_status = vacation_status

        if event_type == EventType.SERVICE:
            event.asset_id = asset_id
            event.service_type = service_type

        # ---- resources (auta, zasadačky, ...) -------------------
        if resource_ids:
            resources = (
                self.session.query(CalendarResource)
                .filter(CalendarResource.id.in_(resource_ids))
                .all()
            )
            event.resources = resources

        # (attendees – účastníci) – môžeš doplniť ak máš User model
        # if attendees_ids:
        #     ...

        self.session.add(event)
        self.session.flush()  # nech máme event.id

        # ---- konflikty zdrojov ----------------------------------
        conflicts = self._check_resource_conflicts(event)
        if conflicts:
            raise ResourceConflictError(conflicts)

        # ---- pripomienky ----------------------------------------
        if reminders:
            self._create_reminders_for_event(event, reminders)

        self.session.commit()
        self.session.refresh(event)
        return event

    # --------- VALIDÁCIA -----------------------------------------

    def _validate_event_type_specific(
        self,
        *,
        event_type: EventType,
        vacation_status: Optional[VacationStatus],
        asset_id: Optional[int],
    ) -> None:
        """
        Dodatočné pravidlá podľa typu udalosti.
        """
        if event_type in {EventType.VACATION, EventType.ABSENCE}:
            # status môže byť None – default PENDING
            if vacation_status is not None and vacation_status not in VacationStatus:
                raise EventValidationError("Invalid vacation status.")

        if event_type == EventType.SERVICE:
            if not asset_id:
                raise EventValidationError(
                    "Service event must have asset_id (which car/asset)."
                )

    # ---------- KONFLIKTY RESOURCE-OV -----------------------------

    def _check_resource_conflicts(self, event: CalendarEvent) -> List[CalendarEvent]:
        """
        Skontroluje, či nie je v rovnakom čase nejaký zdroj obsadený inou
        udalosťou. Berieme všetky resources priradené k eventu.
        """
        if not event.resources:
            return []

        resource_ids = [r.id for r in event.resources]
        if not resource_ids:
            return []

        # jednoduchá logika prekrytia:
        # (existing.start < new_end) AND (existing.end > new_start)
        start = event.start_at
        end = event.end_at or event.start_at

        q = (
            self.session.query(CalendarEvent)
            .join(CalendarEvent.resources)
            .filter(
                CalendarEvent.id != event.id,
                CalendarEvent.is_cancelled == False,
                CalendarResource.id.in_(resource_ids),
                CalendarEvent.start_at < end,
                CalendarEvent.end_at > start,
            )
            .distinct()
        )

        return list(q.all())

    # ---------- OPAKOVANIE (RECURRENCE) ---------------------------

    def iter_occurrences(
        self,
        event: CalendarEvent,
        range_start: datetime,
        range_end: datetime,
    ) -> Iterable[tuple[datetime, datetime]]:
        """
        Vygeneruje jednotlivé výskyty eventu v danom intervale.
        Používa iCal RRULE reťazec v event.recurrence_rule.
        Vracia dvojice (occ_start, occ_end).
        """
        if not event.recurrence_rule:
            yield (event.start_at, event.end_at or event.start_at)
            return

        rule_str = event.recurrence_rule
        dtstart = event.start_at
        until = event.recurrence_until

        rule = rrulestr(rule_str, dtstart=dtstart)
        if until:
            rule = rule.replace(until=until)

        duration = (event.end_at or event.start_at) - event.start_at

        for occ_start in rule.between(range_start, range_end, inc=True):
            yield (occ_start, occ_start + duration)

    # ---------- PRIPOMIENKY ---------------------------------------

    def _create_reminders_for_event(
        self,
        event: CalendarEvent,
        reminder_specs: List[ReminderSpec],
    ) -> None:
        for spec in reminder_specs:
            anchor_dt = getattr(event, spec.anchor_field, None)
            if anchor_dt is None:
                # ak anchor neexistuje, radšej chyba ako ticho
                raise EventValidationError(
                    f"Reminder anchor_field '{spec.anchor_field}' neexistuje na CalendarEvent."
                )

            remind_at = anchor_dt - timedelta(minutes=spec.minutes_before)
            if remind_at <= datetime.utcnow() - timedelta(minutes=1):
                # pripomienka v minulosti – zbytočne ju vytvárať
                continue

            reminder = CalendarEventReminder(
                event_id=event.id,
                remind_at=remind_at,
                channel=spec.channel,
                target_type=spec.target_type,
                target_group_code=spec.target_group_code,
                custom_email=spec.custom_email,
                custom_phone=spec.custom_phone,
                message_template=spec.message_template,
                is_sent=False,
            )
            self.session.add(reminder)
