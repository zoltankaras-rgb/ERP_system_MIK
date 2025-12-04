# scheduler.py
# ===========================================
# Centrálna plánovačka pre ERP:
#  - uloha_kontrola_skladu (denne o 14:00)
#  - vykonaj_db_ulohu (automatizované SQL úlohy z DB)
#  - check_calendar_notifications (Enterprise kalendár – pripomienky)
#  - ERP export (VYROBKY.CSV) podľa nastavení v ERP (automatický export)
# ===========================================

from __future__ import annotations

import os
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from pytz import timezone
import requests
import db_connector
import office_handler
from tasks import (
    uloha_kontrola_skladu,
    vykonaj_db_ulohu,
    check_calendar_notifications,
)

TZ = timezone(os.getenv("APP_TZ", "Europe/Bratislava"))


def _schedule_builtin_jobs(sched: BlockingScheduler) -> None:
    """
    Vnútorné (hardcoded) joby – sklad, kalendár.
    """

    # 1) Denná kontrola skladu – ak je nastavený e-mail
    email_to = os.getenv("LOW_STOCK_EMAIL", "")  # môžeš nechať prázdne a riešiť len DB úlohy
    if email_to:
        sched.add_job(
            lambda: uloha_kontrola_skladu(email_to),
            CronTrigger(hour=14, minute=0, timezone=TZ),
            id="builtin_low_stock_14",
            replace_existing=True,
            misfire_grace_time=300,
        )

    # 2) Enterprise kalendár – kontrola notifikácií každú minútu
    #    (berie PENDING zápisy z calendar_event_notifications)
    sched.add_job(
        check_calendar_notifications,
        CronTrigger(minute="*", timezone=TZ),
        id="calendar_notifications",
        replace_existing=True,
        misfire_grace_time=60,
    )


def _load_db_tasks(sched: BlockingScheduler) -> None:
    """
    Načíta a zaregistruje automatizované úlohy z tabuľky automatizovane_ulohy.
    Každá úloha má cron_retazec (napr. '0 7 * * *').
    """
    rows = db_connector.execute_query(
        "SELECT * FROM automatizovane_ulohy WHERE is_enabled=1",
        fetch="all",
    ) or []

    # odstráň staré joby z DB (ponecháme iba tie s id začínajúcim na 'dbtask_')
    for j in list(sched.get_jobs()):
        if j.id.startswith("dbtask_"):
            sched.remove_job(j.id)

    for t in rows:
        try:
            tid = int(t["id"])
        except Exception:
            continue

        cron = (t.get("cron_retazec") or "").strip() or "0 14 * * *"
        try:
            trig = CronTrigger.from_crontab(cron, timezone=TZ)
        except Exception:
            # ak je cron reťazec zlý, túto úlohu preskočíme
            continue

        # lambda i=tid – aby sme nezamkli posledné tid v cykle
        sched.add_job(
            lambda i=tid: vykonaj_db_ulohu(i),
            trig,
            id=f"dbtask_{tid}",
            replace_existing=True,
            misfire_grace_time=300,
        )


def _schedule_erp_export(sched: BlockingScheduler) -> None:
    """
    Načíta nastavenia ERP exportu z DB (cez office_handler._get_erp_settings)
    a naplánuje úlohu generate_erp_export_file na zadaný čas.

    Nastavenia sú v JSON:
      {
        "enabled": true,
        "time": "06:00"
      }
    """
    job_id = "erp_auto_export_job"

    # Zmažeme starý job, aby sa pri zmene času/nastavení neplánoval dvakrát
    try:
        old_job = sched.get_job(job_id)
        if old_job:
            old_job.remove()
            print(f"[scheduler] ERP Export: starý job {job_id} odstránený.")
    except Exception as e:
        print(f"[scheduler] ERP Export: chyba pri odstraňovaní starého jobu: {e}")

    try:
        settings = office_handler._get_erp_settings() or {}
    except Exception as e:
        print(f"[scheduler] ERP Export: neviem načítať nastavenia: {e}")
        return

    enabled = bool(settings.get("enabled"))
    time_str = settings.get("time", "06:00")

    print(f"[scheduler] ERP Export settings: enabled={enabled}, time={time_str}")

    if not enabled:
        print("[scheduler] ERP Export: deaktivovaný (enabled = False).")
        return

    try:
        hour_str, minute_str = time_str.split(":")
        hour = int(hour_str)
        minute = int(minute_str)
    except Exception as e:
        print(f"[scheduler] ERP Export: neplatný čas '{time_str}': {e}")
        return

    def run_export():
        try:
            print("[scheduler] ERP Export: spúšťam generate_erp_export_file()")
            path = office_handler.generate_erp_export_file()
            print(f"[scheduler] ERP Export OK: {path}")
        except Exception as e:
            print(f"[scheduler] ERP Export ERROR: {e}")

    # Naplánujeme job na daný čas (každý deň)
    try:
        sched.add_job(
            run_export,
            CronTrigger(hour=hour, minute=minute, timezone=TZ),
            id=job_id,
            replace_existing=True,
            misfire_grace_time=300,
        )
        print(f"[scheduler] ERP Export job naplánovaný na {time_str} (id={job_id})")
    except Exception as e:
        print(f"[scheduler] ERP Export: chyba pri plánovaní jobu: {e}")

def _schedule_b2c_birthday_bonus(sched: BlockingScheduler) -> None:
    """
    Spúšťa B2C narodeninový bonus cez HTTP endpoint raz denne.
    Volá /api/kancelaria/b2c/run_birthday_bonus s JSON telom, aby nepadal 415.
    """
    url = os.getenv("B2C_BDAY_URL", "").strip()
    secret = os.getenv("B2C_BDAY_SECRET", "").strip()

    if not url:
        print("[scheduler] B2C birthday bonus: B2C_BDAY_URL nie je nastavené, úloha sa nespustí.")
        return

    def run_bonus_job():
        try:
            print("[scheduler] B2C birthday bonus: volám endpoint...")

            # query parametre (secret je voliteľný)
            params = {}
            if secret:
                params["secret"] = secret

            # JSON telo – prázdne = normálny beh (nie dry_run)
            payload = {}

            resp = requests.post(
                url,
                params=params,
                json=payload,   # dôležité – pošle Content-Type: application/json
                timeout=30,
            )
            print(f"[scheduler] B2C birthday bonus: status={resp.status_code}, body={resp.text[:200]}")
        except Exception as e:
            print(f"[scheduler] B2C birthday bonus ERROR: {e}")

    # každý deň o 13:20
    sched.add_job(
        run_bonus_job,
        CronTrigger(hour=13, minute=20, timezone=TZ),
        id="b2c_birthday_bonus",
        replace_existing=True,
        misfire_grace_time=600,
    )
    print("[scheduler] B2C birthday bonus job naplánovaný (každý deň o 13:20).")


def main() -> None:
    """
    Spustí blokujúci scheduler.
    """
    sched = BlockingScheduler(timezone=TZ)

    # 1. Hardcoded joby (sklad + kalendár)
    _schedule_builtin_jobs(sched)

    # 2. DB definované úlohy
    _load_db_tasks(sched)

    # 3. ERP Export úloha (auto export podľa nastavení v ERP)
    _schedule_erp_export(sched)

    # 3b. B2C narodeninový bonus
    _schedule_b2c_birthday_bonus(sched)

    # 4. Pravidelný refresh (refreshne DB úlohy AJ ERP nastavenia)
    def refresh_all():
        _load_db_tasks(sched)
        _schedule_erp_export(sched)

    sched.add_job(
        refresh_all,
        CronTrigger(minute="*/5", timezone=TZ),
        id="refresh_tasks_global",
        replace_existing=True,
        misfire_grace_time=120,
    )

    print("[scheduler] Spustený. (Ctrl+C na ukončenie)")
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        print("[scheduler] Stop.")


if __name__ == "__main__":
    main()
