# scheduler.py
# ===========================================
# Centrálna plánovačka pre ERP:
#  - uloha_kontrola_skladu (denne o 14:00)       [ak je LOW_STOCK_EMAIL]
#  - vykonaj_db_ulohu (automatizované SQL úlohy z DB)
#  - check_calendar_notifications (Enterprise kalendár – pripomienky)
#  - ERP export (VYROBKY.CSV) podľa nastavení v ERP (automatický export)
#  - Hygiene autostart tick (každú minútu)
#  - B2C birthday bonus (HTTP endpoint raz denne)
# ===========================================

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
from typing import List, Optional

import requests
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED, EVENT_JOB_MISSED
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from pytz import timezone

import db_connector
import office_handler
import hygiene_handler
from tasks import (
    uloha_kontrola_skladu,
    vykonaj_db_ulohu,
    check_calendar_notifications,
)

# -------------------------------------------------
# ENV / TZ
# -------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:
    load_dotenv = None

# Na Ubuntu/systemd často nebýva env načítané, preto skúšame aj .env vedľa scheduler.py
if load_dotenv is not None:
    load_dotenv(BASE_DIR / ".env")  # nevadí, ak súbor neexistuje

TZ = timezone(os.getenv("APP_TZ", "Europe/Bratislava"))

log = logging.getLogger("erp-scheduler")


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [scheduler] %(message)s",
    )
    log.info("Timezone = %s", TZ)


def _add_event_listeners(sched: BlockingScheduler) -> None:
    def listener(event):
        # MISSED
        if event.code == EVENT_JOB_MISSED:
            log.warning(
                "JOB MISSED: %s scheduled_run_time=%s",
                event.job_id,
                getattr(event, "scheduled_run_time", None),
            )
            return

        # ERROR
        if event.exception:
            log.exception("JOB ERROR: %s", event.job_id)
            return

        # OK
        log.info("JOB OK: %s", event.job_id)

    sched.add_listener(listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR | EVENT_JOB_MISSED)


def _dump_jobs(sched: BlockingScheduler) -> None:
    jobs = sched.get_jobs()
    log.info("Naplánované joby: %d", len(jobs))
    for j in sorted(jobs, key=lambda x: (x.next_run_time or 0, x.id)):
        log.info(" - %s | next=%s | trigger=%s", j.id, j.next_run_time, j.trigger)


def _remove_job_if_exists(sched: BlockingScheduler, job_id: str) -> None:
    job = sched.get_job(job_id)
    if job:
        sched.remove_job(job_id)
        log.info("Job odstránený: %s", job_id)


def _make_trigger_from_cron(cron: str) -> CronTrigger:
    """
    Podpora 5-poličkového cronu (min hour dom mon dow) aj 6-poličkového (sec min hour dom mon dow).
    """
    cron = (cron or "").strip()
    parts = cron.split()

    if len(parts) == 5:
        return CronTrigger.from_crontab(cron, timezone=TZ)

    if len(parts) == 6:
        # sec min hour dom mon dow
        sec, minute, hour, day, month, dow = parts
        return CronTrigger(
            second=sec,
            minute=minute,
            hour=hour,
            day=day,
            month=month,
            day_of_week=dow,
            timezone=TZ,
        )

    raise ValueError(f"Cron musí mať 5 alebo 6 polí, má {len(parts)}: '{cron}'")


# -------------------------------------------------
# SCHEDULED JOBS
# -------------------------------------------------
def _schedule_builtin_jobs(sched: BlockingScheduler) -> None:
    """
    Hardcoded joby – sklad + kalendár.
    """
    # 1) Denná kontrola skladu – iba ak je nastavený e-mail
    low_stock_job_id = "builtin_low_stock_14"
    email_to = os.getenv("LOW_STOCK_EMAIL", "").strip()
    if email_to:
        sched.add_job(
            uloha_kontrola_skladu,
            CronTrigger(hour=14, minute=0, timezone=TZ),
            args=[email_to],
            id=low_stock_job_id,
            replace_existing=True,
            misfire_grace_time=3600,
            max_instances=1,
            coalesce=True,
        )
        log.info("Low stock job naplánovaný denne 14:00 -> %s", email_to)
    else:
        _remove_job_if_exists(sched, low_stock_job_id)
        log.info("LOW_STOCK_EMAIL nie je nastavené -> low stock job sa NEplánuje.")

    # 2) Enterprise kalendár – kontrola notifikácií každú minútu
    sched.add_job(
        check_calendar_notifications,
        CronTrigger(minute="*", timezone=TZ),
        id="calendar_notifications",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
        coalesce=True,
    )
    log.info("Calendar notifications naplánované každú minútu.")


def _load_db_tasks(sched: BlockingScheduler) -> None:
    """
    Načíta a zaregistruje automatizované úlohy z tabuľky automatizovane_ulohy.
    Každá úloha má cron_retazec (napr. '0 7 * * *' alebo '0 0 7 * * *').
    """
    rows = db_connector.execute_query(
        "SELECT * FROM automatizovane_ulohy WHERE is_enabled=1",
        fetch="all",
    ) or []

    desired_job_ids = set()

    for t in rows:
        try:
            tid = int(t.get("id"))
        except Exception:
            log.warning("DB task: neplatné id -> preskakujem: %s", t)
            continue

        cron = (t.get("cron_retazec") or "").strip() or "0 14 * * *"

        try:
            trig = _make_trigger_from_cron(cron)
        except Exception as e:
            log.warning("DB task id=%s preskakujem: cron='%s' chyba=%s", tid, cron, e)
            continue

        job_id = f"dbtask_{tid}"
        desired_job_ids.add(job_id)

        job = sched.add_job(
            vykonaj_db_ulohu,
            trig,
            args=[tid],
            id=job_id,
            replace_existing=True,
            misfire_grace_time=3600,
            max_instances=1,
            coalesce=True,
        )
        log.info("DB task naplánovaný: id=%s cron='%s' next=%s", tid, cron, job.next_run_time)

    # Odstráň DB joby, ktoré už nie sú enabled (alebo zmizli)
    for j in sched.get_jobs():
        if j.id.startswith("dbtask_") and j.id not in desired_job_ids:
            sched.remove_job(j.id)
            log.info("DB task odstránený (už nie je enabled): %s", j.id)


def _schedule_erp_export(sched: BlockingScheduler) -> None:
    """
    Načíta nastavenia ERP exportu z DB (cez office_handler._get_erp_settings)
    a naplánuje úlohu generate_erp_export_file na zadaný čas.
    """
    job_id = "erp_auto_export_job"

    try:
        settings = office_handler._get_erp_settings() or {}
    except Exception:
        log.exception("ERP Export: neviem načítať nastavenia.")
        return

    enabled = bool(settings.get("enabled"))
    time_str = str(settings.get("time", "06:00"))

    log.info("ERP Export settings: enabled=%s time=%s", enabled, time_str)

    if not enabled:
        _remove_job_if_exists(sched, job_id)
        log.info("ERP Export je deaktivovaný (enabled=False).")
        return

    try:
        hour_str, minute_str = time_str.split(":")
        hour = int(hour_str)
        minute = int(minute_str)
    except Exception as e:
        log.error("ERP Export: neplatný čas '%s' (%s) -> job ruším", time_str, e)
        _remove_job_if_exists(sched, job_id)
        return

    def run_export():
        try:
            log.info("ERP Export: spúšťam generate_erp_export_file()")
            path = office_handler.generate_erp_export_file()
            log.info("ERP Export OK: %s", path)
        except Exception:
            log.exception("ERP Export ERROR")

    sched.add_job(
        run_export,
        CronTrigger(hour=hour, minute=minute, timezone=TZ),
        id=job_id,
        replace_existing=True,
        misfire_grace_time=3600,
        max_instances=1,
        coalesce=True,
    )
    log.info("ERP Export job naplánovaný denne na %02d:%02d", hour, minute)


def _schedule_hygiene_autostart(sched: BlockingScheduler) -> None:
    """
    Hygiena – auto-štart úloh podľa scheduled_time.
    Volá hygiene_handler.run_hygiene_autostart_tick každú minútu.
    """
    def run_job():
        try:
            result = hygiene_handler.run_hygiene_autostart_tick()
            # debug – aby si videl, že tick reálne beží
            log.debug("Hygiene tick result=%s", result)
            if isinstance(result, dict) and result.get("created"):
                log.info("Hygiena auto-štart vytvoril: %s", result)
        except Exception:
            log.exception("Hygiena auto-štart ERROR")

    sched.add_job(
        run_job,
        CronTrigger(minute="*", timezone=TZ),
        id="hygiene_autostart",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
        coalesce=True,
    )
    log.info("Hygiena auto-štart naplánovaný (každú minútu).")


def _schedule_b2c_birthday_bonus(sched: BlockingScheduler) -> None:
    """
    Spúšťa B2C narodeninový bonus cez HTTP endpoint raz denne.
    """
    job_id = "b2c_birthday_bonus"

    url = os.getenv("B2C_BDAY_URL", "").strip()
    secret = os.getenv("B2C_BDAY_SECRET", "").strip()

    if not url:
        _remove_job_if_exists(sched, job_id)
        log.info("B2C birthday bonus: B2C_BDAY_URL nie je nastavené -> job sa NEplánuje.")
        return

    def run_bonus_job():
        try:
            log.info("B2C birthday bonus: volám endpoint %s", url)
            params = {"secret": secret} if secret else None

            resp = requests.post(
                url,
                params=params,
                json={},      # dôležité kvôli Content-Type: application/json
                timeout=30,
            )
            log.info("B2C birthday bonus: status=%s body=%s", resp.status_code, resp.text[:200])
        except Exception:
            log.exception("B2C birthday bonus ERROR")

    sched.add_job(
        run_bonus_job,
        CronTrigger(hour=13, minute=20, timezone=TZ),
        id=job_id,
        replace_existing=True,
        misfire_grace_time=7200,
        max_instances=1,
        coalesce=True,
    )
    log.info("B2C birthday bonus job naplánovaný (každý deň 13:20).")


def _refresh_all(sched: BlockingScheduler) -> None:
    """
    Refresh definícií:
    - DB tasks
    - ERP export
    - builtin joby (LOW_STOCK_EMAIL sa môže zmeniť)
    - B2C job (URL sa môže zmeniť)
    - hygiene job necháme aj tak cez replace_existing
    """
    log.info("Refresh: reloadujem plánovanie jobov...")
    _schedule_builtin_jobs(sched)
    _load_db_tasks(sched)
    _schedule_erp_export(sched)
    _schedule_b2c_birthday_bonus(sched)
    _schedule_hygiene_autostart(sched)
    _dump_jobs(sched)


def build_scheduler() -> BlockingScheduler:
    sched = BlockingScheduler(
        timezone=TZ,
        job_defaults={
            "coalesce": True,
            "max_instances": 1,
            "misfire_grace_time": 3600,
        },
    )

    _add_event_listeners(sched)

    # initial schedule
    _schedule_builtin_jobs(sched)
    _load_db_tasks(sched)
    _schedule_erp_export(sched)
    _schedule_b2c_birthday_bonus(sched)
    _schedule_hygiene_autostart(sched)

    # refresh každých 5 minút, ale na sekunde 17 (menej kolízií s jobmi na sekunde 0)
    sched.add_job(
        lambda: _refresh_all(sched),
        CronTrigger(minute="*/5", second=17, timezone=TZ),
        id="refresh_tasks_global",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
        coalesce=True,
    )

    return sched


def _diagnose() -> None:
    log.info("ENV APP_TZ=%s", os.getenv("APP_TZ"))
    log.info("ENV LOW_STOCK_EMAIL=%s", os.getenv("LOW_STOCK_EMAIL"))
    log.info("ENV B2C_BDAY_URL=%s", os.getenv("B2C_BDAY_URL"))
    log.info("ENV B2C_BDAY_SECRET=%s", "SET" if os.getenv("B2C_BDAY_SECRET") else "")

    try:
        rows = db_connector.execute_query(
            "SELECT id, cron_retazec, is_enabled FROM automatizovane_ulohy ORDER BY id",
            fetch="all",
        ) or []
        log.info("DB automatizovane_ulohy rows=%d", len(rows))
        for r in rows:
            log.info(" - id=%s enabled=%s cron='%s'",
                     r.get("id"),
                     r.get("is_enabled"),
                     (r.get("cron_retazec") or "").strip())
    except Exception:
        log.exception("Diagnose: DB query failed")

    try:
        settings = office_handler._get_erp_settings() or {}
        log.info("ERP settings: %s", settings)
    except Exception:
        log.exception("Diagnose: ERP settings read failed")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="ERP APScheduler")
    parser.add_argument("--verbose", action="store_true", help="Podrobné logy")
    parser.add_argument("--list", action="store_true", help="Vypíše joby a skončí")
    parser.add_argument("--diagnose", action="store_true", help="Vypíše env/DB/ERP nastavenia a skončí")
    parser.add_argument("--no-start", action="store_true", help="Nespúšťa scheduler (len build + log)")
    args = parser.parse_args(argv)

    _setup_logging(args.verbose)

    if args.diagnose:
        _diagnose()
        return 0

    sched = build_scheduler()
    _dump_jobs(sched)

    if args.list or args.no_start:
        return 0

    log.info("Scheduler spustený. (Ctrl+C na ukončenie)")
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Scheduler stop.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
