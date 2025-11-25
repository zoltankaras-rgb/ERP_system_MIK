# calendar_models.py
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, Enum,
    ForeignKey, Numeric, Table
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


# -------------------- ENUMY --------------------------------------


class EventType(str, enum.Enum):
    MEETING = "MEETING"              # stretnutie
    TENDER = "TENDER"                # verejné obstarávanie / súťaž
    VACATION = "VACATION"            # dovolenka
    ABSENCE = "ABSENCE"              # iná absencia
    SERVICE = "SERVICE"              # servis / správa majetku
    DEADLINE = "DEADLINE"            # deadline bez projektu
    TASK = "TASK"                    # úloha naviazaná na projekt


class MeetingType(str, enum.Enum):
    INTERNAL = "INTERNAL"
    EXTERNAL = "EXTERNAL"


class VacationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Priority(str, enum.Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ResourceType(str, enum.Enum):
    MEETING_ROOM = "MEETING_ROOM"
    VEHICLE = "VEHICLE"
    ASSET = "ASSET"
    OTHER = "OTHER"


class ReminderChannel(str, enum.Enum):
    EMAIL = "EMAIL"
    SMS = "SMS"
    BOTH = "BOTH"


class ReminderTargetType(str, enum.Enum):
    CREATOR = "CREATOR"          # len tvorca
    ALL_ATTENDEES = "ALL_ATTENDEES"
    GROUP = "GROUP"              # napr. "Veduci_dopravy"
    CUSTOM_EMAIL = "CUSTOM_EMAIL"
    CUSTOM_PHONE = "CUSTOM_PHONE"


# -------------------- ASSOC TABUĽKY ------------------------------


calendar_event_attendees = Table(
    "calendar_event_attendees",
    Base.metadata,
    Column("event_id", ForeignKey("calendar_events.id"), primary_key=True),
    Column("user_id", ForeignKey("users.id"), primary_key=True),
)

calendar_event_resources = Table(
    "calendar_event_resources",
    Base.metadata,
    Column("event_id", ForeignKey("calendar_events.id"), primary_key=True),
    Column("resource_id", ForeignKey("calendar_resources.id"), primary_key=True),
)


# -------------------- POMOCNÉ MODELY (User/Group placeholder) ----
# Predpokladám, že už máš svoje User / UserGroup modely, toto je len
# mapping pre FK. Kľudne to nahraď svojimi existujúcimi klasami.

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False)
    phone = Column(String(32))
    full_name = Column(String(255))


class UserGroup(Base):
    __tablename__ = "user_groups"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)   # napr. "VEDUCI_DOPRAVY"
    name = Column(String(255), nullable=False)


# -------------------- RESOURCE -----------------------------------


class CalendarResource(Base):
    __tablename__ = "calendar_resources"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    resource_type = Column(Enum(ResourceType), nullable=False)
    # väzba na konkrétne assety (auto, budova, ...):
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    location = Column(String(255))
    capacity = Column(Integer)  # zasadačka – počet ľudí

    events = relationship(
        "CalendarEvent",
        secondary=calendar_event_resources,
        back_populates="resources",
    )


# -------------------- HLAVNÁ TABUĽKA EVENT -----------------------


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True)

    title = Column(String(255), nullable=False)
    description = Column(Text)

    event_type = Column(Enum(EventType), nullable=False)

    start_at = Column(DateTime, nullable=False)
    end_at = Column(DateTime, nullable=True)
    all_day = Column(Boolean, default=False)

    location = Column(String(255))
    color = Column(String(20))
    priority = Column(Enum(Priority), default=Priority.NORMAL, nullable=False)

    # Recurrence – RRULE string podľa iCal, napr. "FREQ=WEEKLY;BYDAY=MO"
    recurrence_rule = Column(String(255), nullable=True)
    recurrence_until = Column(DateTime, nullable=True)

    # Audit
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    modified_at = Column(DateTime, nullable=True)
    modified_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_cancelled = Column(Boolean, default=False)

    # MEETING špecifiká
    meeting_type = Column(Enum(MeetingType), nullable=True)
    online_url = Column(String(512), nullable=True)

    # VEREJNÉ OBSTARÁVANIE / SÚŤAŽ
    vo_declaration_date = Column(DateTime, nullable=True)
    vo_questions_deadline = Column(DateTime, nullable=True)
    vo_submission_deadline = Column(DateTime, nullable=True)
    vo_envelope_opening = Column(DateTime, nullable=True)
    vo_estimated_value = Column(Numeric(18, 2), nullable=True)
    vo_docs_url = Column(String(512), nullable=True)

    # DOVOLENKY / ABSENCIE
    vacation_status = Column(Enum(VacationStatus), nullable=True)
    vacation_approved_by_id = Column(Integer, ForeignKey("users.id"))
    vacation_approved_at = Column(DateTime, nullable=True)

    # SERVIS / SPRÁVA MAJETKU
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    service_type = Column(String(50))  # STK, EK, Poistka, Revízia,...

    # DEADLINE / TASK – prepojenie na projekty
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    task_id = Column(Integer, nullable=True)

    # väzby
    created_by = relationship("User", foreign_keys=[created_by_id])
    modified_by = relationship("User", foreign_keys=[modified_by_id])
    vacation_approved_by = relationship("User", foreign_keys=[vacation_approved_by_id])

    attendees: List[User] = relationship(
        "User",
        secondary=calendar_event_attendees,
        backref="calendar_events",
    )

    resources: List[CalendarResource] = relationship(
        "CalendarResource",
        secondary=calendar_event_resources,
        back_populates="events",
    )

    reminders = relationship(
        "CalendarEventReminder",
        back_populates="event",
        cascade="all, delete-orphan",
    )

    attachments = relationship(
        "CalendarEventAttachment",
        back_populates="event",
        cascade="all, delete-orphan",
    )


class CalendarEventAttachment(Base):
    __tablename__ = "calendar_event_attachments"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("calendar_events.id"), nullable=False)

    file_path = Column(String(512), nullable=True)  # cesta na serveri
    external_url = Column(String(512), nullable=True)
    label = Column(String(255))

    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    event = relationship("CalendarEvent", back_populates="attachments")
    uploaded_by = relationship("User")


class CalendarEventReminder(Base):
    __tablename__ = "calendar_event_reminders"

    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("calendar_events.id"), nullable=False)

    # Absolútny čas pripomienky – už spočítaný pri vytvorení/zmene eventu
    remind_at = Column(DateTime, nullable=False)

    channel = Column(Enum(ReminderChannel), nullable=False)
    target_type = Column(Enum(ReminderTargetType), nullable=False)

    # GROUP – kód skupiny (napr. "VEDUCI_DOPRAVY")
    target_group_code = Column(String(50), nullable=True)

    # CUSTOM_* – priame ciele, ak treba
    custom_email = Column(String(255), nullable=True)
    custom_phone = Column(String(32), nullable=True)

    message_template = Column(Text, nullable=True)

    is_sent = Column(Boolean, default=False, nullable=False)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    event = relationship("CalendarEvent", back_populates="reminders")
