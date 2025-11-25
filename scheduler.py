# scheduler.py
# ===========================================
# Centrálna plánovačka pre ERP:
#  - uloha_kontrola_skladu (denne o 14:00)
#  - vykonaj_db_ulohu (automatizované SQL úlohy z DB)
#  - check_calendar_notifications (Enterprise kalendár – pripomienky)
# ===========================================

from __future__ import annotations
import json
import os
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from pytz import timezone
from tasks import check_calendar_notifications
import office_handler #
import db_connector
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
        fetch="all"
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


def main() -> None:
    """
    Spustí blokujúci scheduler.
    Ak scheduler spúšťaš z app.py v samostatnom vlákne,
    jednoducho zavolaj scheduler.main() v tom vlákne.
    """
    sched = BlockingScheduler(timezone=TZ)

    # Hardcoded joby (sklad + kalendár)
    _schedule_builtin_jobs(sched)
    # DB definované úlohy
    _load_db_tasks(sched)

    # pravidelne refreshni definície úloh (napr. každých 5 minút)
    sched.add_job(
        lambda: _load_db_tasks(sched),
        CronTrigger(minute="*/5", timezone=TZ),
        id="refresh_db_tasks",
        replace_existing=True,
        misfire_grace_time=120,
    )

    print("[scheduler] Spustený. (Ctrl+C na ukončenie)")
    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        print("[scheduler] Stop.")
def _schedule_erp_export(sched: BlockingScheduler) -> None:
    """
    Načíta nastavenia ERP exportu z JSON a naplánuje úlohu.
    """
    # Získame nastavenia cez office_handler (aby sme nemenili logiku čítania cesty)
    settings = office_handler._get_erp_settings()
    job_id = "erp_auto_export_job"

    # Najprv odstránime existujúci job, ak existuje (aby sa pri refreshi aktualizoval čas)
    if sched.get_job(job_id):
        sched.remove_job(job_id)

    if settings.get("enabled"):
        time_str = settings.get("time", "06:00")
        try:
            h, m = map(int, time_str.split(":"))
            
            # Definícia úlohy: zavolá funkciu generovania súboru
            def run_export():
                try:
                    path = office_handler.generate_erp_export_file()
                    print(f"[scheduler] ERP Export OK: {path}")
                except Exception as e:
                    print(f"[scheduler] ERP Export CHYBA: {e}")

            sched.add_job(
                run_export,
                CronTrigger(hour=h, minute=m, timezone=TZ),
                id=job_id,
                replace_existing=True
            )
            print(f"[scheduler] ERP Export naplánovaný na {time_str}")
        except Exception as e:
            print(f"[scheduler] Chyba formátu času pre ERP export: {e}")

# UPRAVTE FUNKCIU main():
def main() -> None:
    """
    Spustí blokujúci scheduler.
    """
    sched = BlockingScheduler(timezone=TZ)

    # 1. Hardcoded joby (sklad + kalendár)
    _schedule_builtin_jobs(sched)
    
    # 2. DB definované úlohy
    _load_db_tasks(sched)

    # 3. NOVÉ: ERP Export úloha
    _schedule_erp_export(sched)

    # Pravidelný refresh (refreshne DB úlohy AJ ERP nastavenia)
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

