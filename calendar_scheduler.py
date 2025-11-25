# calendar_scheduler.py
from __future__ import annotations

from datetime import datetime
from typing import Iterable, List

from sqlalchemy.orm import Session

from calendar_models import (
    CalendarEvent,
    CalendarEventReminder,
    ReminderChannel,
    ReminderTargetType,
    User,
    UserGroup,
)

# Tu si naimportuj svoje existujúce funkcie
# (prispôsob cesty podľa projektu)
from notifications import send_email_existing, send_sms_existing  # type: ignore


def check_notifications(session: Session, now: datetime | None = None) -> None:
  """
  Prejde tabuľku pripomienok a odošle tie, ktorým nastal čas.
  Spúšťaj napr. každú minútu.
  """
  now = now or datetime.utcnow()

  # vyber všetky neodoslané pripomienky, ktorým už uplynul čas
  reminders: List[CalendarEventReminder] = (
      session.query(CalendarEventReminder)
      .join(CalendarEventReminder.event)
      .filter(
          CalendarEventReminder.is_sent == False,
          CalendarEventReminder.remind_at <= now,
          CalendarEvent.is_cancelled == False,
      )
      .all()
  )

  for r in reminders:
      event = r.event
      recipients = _resolve_recipients(session, r)

      if not recipients:
          # nikomu neposielame, len označíme ako sent
          r.is_sent = True
          r.sent_at = now
          continue

      subject = f"[ERP] Pripomienka: {event.title}"
      # jednoduchý text – môžeš si upraviť template
      email_body = (
          f"Udalosť: {event.title}\n"
          f"Typ: {event.event_type.value}\n"
          f"Začiatok: {event.start_at}\n"
          f"Koniec: {event.end_at}\n"
      )
      sms_text = f"Pripomienka: {event.title} o {event.start_at.strftime('%d.%m.%Y %H:%M')}"

      if r.message_template:
          # jednoduché nahradenie {title}, {start}, ...
          msg = r.message_template.format(
              title=event.title,
              start=event.start_at,
              end=event.end_at,
          )
          email_body = msg
          sms_text = msg[:160]

      emails = [u.email for u in recipients if u.email]
      phones = [u.phone for u in recipients if u.phone]

      if r.channel in (ReminderChannel.EMAIL, ReminderChannel.BOTH) and emails:
          for e in emails:
              send_email_existing(
                  to=e,
                  subject=subject,
                  body=email_body,
              )

      if r.channel in (ReminderChannel.SMS, ReminderChannel.BOTH) and phones:
          for p in phones:
              send_sms_existing(
                  to=p,
                  text=sms_text,
              )

      r.is_sent = True
      r.sent_at = now

  session.commit()


def _resolve_recipients(
    session: Session,
    reminder: CalendarEventReminder,
) -> List[User]:
  """
  Podľa target_type rozhodne, komu sa má notifikácia poslať.
  Vracia list User objektov.
  """
  event = reminder.event

  if reminder.target_type == ReminderTargetType.CREATOR:
      return [event.created_by] if event.created_by else []

  if reminder.target_type == ReminderTargetType.ALL_ATTENDEES:
      # účastníci + tvorca (ak tam nie je)
      users = set(event.attendees or [])
      if event.created_by:
          users.add(event.created_by)
      return list(users)

  if reminder.target_type == ReminderTargetType.GROUP:
      if not reminder.target_group_code:
          return []
      group = (
          session.query(UserGroup)
          .filter(UserGroup.code == reminder.target_group_code)
          .first()
      )
      if not group:
          return []
      # Tu predpokladám prepojovaciu tabuľku user_group_members,
      # ktorú si doplníš podľa svojho ERP.
      # Pre jednoduchosť ju tu neimplementujem – pridaj si query na
      # výber User-ov v danej skupine.
      # Napr.:
      #   users = (
      #       session.query(User)
      #       .join(UserGroupMember, User.id == UserGroupMember.user_id)
      #       .filter(UserGroupMember.group_id == group.id)
      #       .all()
      #   )
      return []  # TODO: doplň implementáciu podľa svojho modelu skupín

  if reminder.target_type == ReminderTargetType.CUSTOM_EMAIL:
      if not reminder.custom_email:
          return []
      u = User(email=reminder.custom_email)
      return [u]

  if reminder.target_type == ReminderTargetType.CUSTOM_PHONE:
      if not reminder.custom_phone:
          return []
      u = User(phone=reminder.custom_phone)
      return [u]

  return []
