# hygiene_handler.py
# PROFESIONÁLNA VERZIA - ISO 22000 / HACCP
# Obsahuje: Delete funkcií

import db_connector
from datetime import datetime, date, timedelta
AUTO_HYGIENE_PERFORMER = "Oravcová"
AUTO_HYGIENE_CHECKER = "Riadiaci pracovník"
# --- Pomocné funkcie ---

def _fmt_time(dt):
    """Formátuje datetime na HH:MM"""
    if not dt: return ""
    try: return dt.strftime("%H:%M")
    except: return str(dt)

def _iso_date(d):
    if isinstance(d, (datetime, date)): return d.strftime("%Y-%m-%d")
    return str(d)

def _fix_time_serialization(rows):
    """Oprava timedelta objektov pre JSON"""
    if not rows: return []
    is_single = isinstance(rows, dict)
    if is_single: rows = [rows]
    for r in rows:
        if 'scheduled_time' in r:
            val = r['scheduled_time']
            if isinstance(val, timedelta):
                total_seconds = int(val.total_seconds())
                h = total_seconds // 3600
                m = (total_seconds % 3600) // 60
                r['scheduled_time'] = f"{h:02d}:{m:02d}"
            elif val is None:
                r['scheduled_time'] = None
            else:
                r['scheduled_time'] = str(val)[:5]
    return rows[0] if is_single else rows

# --- Hlavná logika ---

def get_hygiene_plan_for_date(target_date_str=None):
    try:
        target_date = datetime.strptime(target_date_str, '%Y-%m-%d').date() if target_date_str else date.today()
    except ValueError:
        target_date = date.today()

    # 1. Načítame všetky aktívne úlohy
    all_tasks = db_connector.execute_query(
        "SELECT * FROM hygiene_tasks WHERE is_active = TRUE ORDER BY location, task_name"
    ) or []
    all_tasks = _fix_time_serialization(all_tasks)

    # 2. Načítame existujúce záznamy pre daný deň
    logs = db_connector.execute_query("""
        SELECT h.*, a.agent_name 
        FROM hygiene_log h
        LEFT JOIN hygiene_agents a ON h.agent_id = a.id
        WHERE h.completion_date = %s
    """, (target_date,)) or []
    
    logs_map = {int(log['task_id']): log for log in logs if log.get('task_id')}
    plan_by_location = {}
    
    for task in all_tasks:
        task_id = int(task['id'])
        is_due = False
        freq = task.get('frequency')
        
        if freq == 'denne': is_due = True
        elif freq == 'tyzdenne' and target_date.weekday() == 0: is_due = True 
        elif freq == 'mesacne' and target_date.day == 1: is_due = True
        elif freq == 'stvrtronne' and target_date.day == 1 and target_date.month in [1, 4, 7, 10]: is_due = True
        elif freq == 'rocne' and target_date.day == 1 and target_date.month == 1: is_due = True
        
        if task_id in logs_map: is_due = True

        if is_due:
            loc = task.get('location') or 'Neurčené'
            if loc not in plan_by_location: plan_by_location[loc] = []
            task['log'] = logs_map.get(task_id)
            plan_by_location[loc].append(task)
            
    return {"plan": plan_by_location, "date": _iso_date(target_date)}

def run_hygiene_autostart_tick():
    """
    Auto-štart hygienických úloh.
    Volané zo scheduler.py (ideálne každú minútu).

    Logika:
      - spúšťa sa len v pracovné dni (Po–Pi)
      - pre aktuálnu minútu nájde úlohy s auto_start=1 a scheduled_time
      - ak pre dnešný deň ešte neexistuje log, vytvorí ho
      - do logu zapíše task_name, location, user_fullname aj checked_by_fullname
        a nastaví verification_status='OK'
    """
    now = datetime.now()
    today = now.date()

    # 0 = pondelok, 6 = nedeľa
    if today.weekday() >= 5:
        return {"message": "Víkend – auto-štart hygieny sa nespúšťa.", "created": 0}

    time_str = now.strftime("%H:%M")

    # 1. Nájdeme úlohy, ktoré majú v danú minútu scheduled_time
    tasks = db_connector.execute_query(
        """
        SELECT t.id,
               t.task_name,
               t.location,
               t.default_agent_id,
               t.default_concentration,
               t.default_exposure_time,
               a.agent_name
        FROM hygiene_tasks t
        LEFT JOIN hygiene_agents a ON a.id = t.default_agent_id
        WHERE t.is_active = 1
          AND t.auto_start = 1
          AND t.scheduled_time IS NOT NULL
          AND t.scheduled_time <> ''
          -- !!! FIX: NIKDY nepoužívaj '%%H:%%i' !!!
          AND TIME_FORMAT(t.scheduled_time, '%H:%i') = %s
        """,
        (time_str,),
        fetch="all",
    ) or []

    created = 0
    skipped_existing = 0

    for t in tasks:
        task_id = t["id"]

        # 2. Skontrolujeme, či už na dnešný deň existuje log
        exist = db_connector.execute_query(
            "SELECT id FROM hygiene_log WHERE task_id=%s AND completion_date=%s LIMIT 1",
            (task_id, today),
            fetch="one",
        )
        if exist:
            skipped_existing += 1
            continue

        # 3. Pripravíme údaje na INSERT
        start_at = now.replace(second=0, microsecond=0)

        # ak default_exposure_time existuje, použi ho; inak 10
        exp_minutes = 10
        try:
            if t.get("default_exposure_time") not in (None, "", 0):
                exp_minutes = int(t["default_exposure_time"])
        except Exception:
            exp_minutes = 10

        exposure_end_at = start_at + timedelta(minutes=exp_minutes)
        rinse_end_at = exposure_end_at + timedelta(minutes=10)
        finished_at = rinse_end_at

        performer_name = AUTO_HYGIENE_PERFORMER
        checker_name = AUTO_HYGIENE_CHECKER

        agent_id = t.get("default_agent_id")
        agent_name = t.get("agent_name")
        concentration = t.get("default_concentration")
        exposure_time = t.get("default_exposure_time")

        db_connector.execute_query(
            """
            INSERT INTO hygiene_log
                (task_id,
                 task_name,
                 location,
                 user_fullname,
                 agent_id,
                 agent_name,
                 concentration,
                 exposure_time,
                 start_at,
                 exposure_end_at,
                 rinse_end_at,
                 finished_at,
                 completion_date,
                 checked_by_fullname,
                 checked_at,
                 verification_status)
            VALUES
                (%s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s,
                 %s)
            """,
            (
                task_id,
                t["task_name"],
                t["location"],
                performer_name,
                agent_id,
                agent_name,
                concentration,
                exposure_time,
                start_at,
                exposure_end_at,
                rinse_end_at,
                finished_at,
                today,
                checker_name,
                now,
                "OK",
            ),
            fetch="none",
        )

        created += 1

        # Voliteľné: ak máš v hygiene_tasks stĺpec status a chceš ho prepnúť
        # (ak stĺpec neexistuje, tak to nechaj zakomentované alebo obal try/except)
        # db_connector.execute_query(
        #     "UPDATE hygiene_tasks SET status='hotova' WHERE id=%s",
        #     (task_id,),
        #     fetch="none",
        # )

    return {
        "message": f"Auto-štart hygieny {today.isoformat()} {time_str}",
        "created": created,
        "skipped_existing": skipped_existing,
        "matched_tasks": len(tasks),  # aby si v logu videl, či vôbec našlo úlohy
    }


def log_hygiene_completion(data):
    task_id = data.get('task_id')
    date_str = data.get('completion_date')
    performer = (data.get('performer_name') or '').strip()

    if not task_id or not date_str or not performer:
        return {"error": "Chýbajú povinné údaje."}

    # 1. Výpočet časov
    start_time_str = data.get('start_time') or datetime.now().strftime("%H:%M")
    try:
        start_dt = datetime.strptime(f"{date_str} {start_time_str}", "%Y-%m-%d %H:%M")
    except Exception:
        start_dt = datetime.now()

    # Predvolený model časov – môžeš upraviť podľa reálnych expozičných časov
    exposure_end = start_dt + timedelta(minutes=10)
    rinse_start = exposure_end
    rinse_end = rinse_start + timedelta(minutes=10)
    finished_at = rinse_end

    # 2. Skúsime nájsť existujúci záznam pre tú istú úlohu a deň
    exist = db_connector.execute_query(
        "SELECT id FROM hygiene_log WHERE task_id=%s AND completion_date=%s",
        (task_id, date_str),
        fetch='one'
    )

    agent_id = data.get('agent_id') or None
    agent_batch = data.get('agent_batch') or None
    conc = data.get('concentration')
    temp = data.get('temperature') or None
    notes = data.get('notes') or None

    if exist:
        # UPDATE existujúceho logu – task_name a location už v riadku sú
        sql = """
            UPDATE hygiene_log 
            SET user_fullname=%s,
                agent_id=%s,
                agent_batch=%s,
                concentration=%s,
                water_temperature=%s,
                start_at=%s,
                exposure_end_at=%s,
                rinse_end_at=%s,
                finished_at=%s,
                notes=%s
            WHERE id=%s
        """
        db_connector.execute_query(
            sql,
            (
                performer, agent_id, agent_batch, conc, temp,
                start_dt, exposure_end, rinse_end, finished_at, notes,
                exist['id'],
            ),
            fetch='none'
        )
        return {"message": "Záznam aktualizovaný."}
    else:
        # INSERT nového záznamu – musíme vyplniť aj task_name a location (NOT NULL)
        task_row = db_connector.execute_query(
            "SELECT task_name, location FROM hygiene_tasks WHERE id = %s",
            (task_id,),
            fetch='one'
        )
        if not task_row:
            return {"error": "Úloha hygieny neexistuje."}

        sql = """
            INSERT INTO hygiene_log 
                (task_id,
                 task_name,
                 location,
                 user_fullname,
                 agent_id,
                 agent_batch,
                 concentration,
                 water_temperature,
                 start_at,
                 exposure_end_at,
                 rinse_end_at,
                 finished_at,
                 notes,
                 completion_date)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        db_connector.execute_query(
            sql,
            (
                task_id,
                task_row['task_name'],
                task_row['location'],
                performer,
                agent_id,
                agent_batch,
                conc,
                temp,
                start_dt,
                exposure_end,
                rinse_end,
                finished_at,
                notes,
                date_str,
            ),
            fetch='none'
        )
        return {"message": "Sanitácia zaznamenaná."}


def check_hygiene_log(data):
    log_id = data.get('log_id')
    checker = data.get('checker_name')
    status = data.get('status')
    corrective = data.get('corrective_action')

    if not log_id or not checker or not status: return {"error": "Chýbajú údaje."}
    if status == 'NOK' and not corrective: return {"error": "Zadajte nápravné opatrenie."}

    db_connector.execute_query("""
        UPDATE hygiene_log 
        SET checked_by_fullname=%s, checked_at=NOW(), verification_status=%s, corrective_action=%s
        WHERE id=%s
    """, (checker, status, corrective, log_id), fetch='none')
    return {"message": "Kontrola potvrdená."}

# --- Admin: Čítať ---

def get_hygiene_agents():
    return db_connector.execute_query("SELECT * FROM hygiene_agents WHERE is_active=1 ORDER BY agent_name") or []

def get_all_hygiene_tasks():
    rows = db_connector.execute_query("SELECT * FROM hygiene_tasks ORDER BY location, task_name") or []
    return _fix_time_serialization(rows)

# --- Admin: Uložiť ---

def save_hygiene_agent(data):
    aid = data.get('id')
    name = data.get('agent_name')
    if not name: return {"error": "Názov je povinný."}
    if aid:
        db_connector.execute_query("UPDATE hygiene_agents SET agent_name=%s WHERE id=%s", (name, aid), fetch='none')
    else:
        db_connector.execute_query("INSERT INTO hygiene_agents (agent_name, is_active) VALUES (%s, 1)", (name,), fetch='none')
    return {"message": "Uložené."}

def save_hygiene_task(data):
    tid = data.get('id')
    name = data.get('task_name')
    loc = data.get('location')
    freq = data.get('frequency')
    
    sched_time = data.get('scheduled_time') or None
    auto_start = 1 if data.get('auto_start') else 0

    if not name or not loc or not freq: return {"error": "Povinné polia chýbajú."}
    
    params = (name, loc, freq, data.get('description'), data.get('default_agent_id') or None, 
              data.get('default_concentration'), data.get('default_exposure_time'), 
              1 if data.get('is_active') else 0, sched_time, auto_start)

    if tid:
        sql = """UPDATE hygiene_tasks SET task_name=%s, location=%s, frequency=%s, description=%s, 
                 default_agent_id=%s, default_concentration=%s, default_exposure_time=%s, is_active=%s,
                 scheduled_time=%s, auto_start=%s WHERE id=%s"""
        db_connector.execute_query(sql, params + (tid,), fetch='none')
    else:
        sql = """INSERT INTO hygiene_tasks (task_name, location, frequency, description, 
                 default_agent_id, default_concentration, default_exposure_time, is_active, scheduled_time, auto_start) 
                 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"""
        db_connector.execute_query(sql, params, fetch='none')
    return {"message": "Uložené."}

# --- Admin: Vymazať (NOVÉ) ---

def delete_hygiene_task(data):
    tid = data.get('id')
    if not tid: return {"error": "Chýba ID."}
    # Hard delete (záznamy v logu ostanú vďaka ON DELETE SET NULL)
    db_connector.execute_query("DELETE FROM hygiene_tasks WHERE id=%s", (tid,), fetch='none')
    return {"message": "Úloha bola vymazaná."}

def delete_hygiene_agent(data):
    aid = data.get('id')
    if not aid: return {"error": "Chýba ID."}
    # Hard delete (v úlohách sa nastaví NULL vďaka ON DELETE SET NULL)
    db_connector.execute_query("DELETE FROM hygiene_agents WHERE id=%s", (aid,), fetch='none')
    return {"message": "Prostriedok bol vymazaný."}


# --- REPORTY (A4 Formát) ---

def get_hygiene_report_html(filters):
    """
    Report hygieny v HTML (A4) – doplnený stĺpec Dátum v tabuľke (DD.MM.YYYY).
    """
    date_from = filters.get('date_from')
    date_to = filters.get('date_to')
    task_id = filters.get('task_id')
    agent_id = filters.get('agent_id')

    if not date_from:
        date_from = date.today().strftime("%Y-%m-%d")
    if not date_to:
        date_to = date_from

    def _fmt_date_sk(d):
        """Formátuje date/datetime/str na DD.MM.YYYY."""
        if not d:
            return ""
        if isinstance(d, (datetime, date)):
            return d.strftime("%d.%m.%Y")
        s = str(d)
        # typicky 'YYYY-MM-DD' alebo 'YYYY-MM-DD HH:MM:SS'
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").strftime("%d.%m.%Y")
        except Exception:
            return s

    where = ["l.completion_date BETWEEN %s AND %s"]
    params = [date_from, date_to]

    if task_id and task_id not in ("null", ""):
        where.append("l.task_id = %s")
        params.append(task_id)

    # Filter agent_id je už posielaný z app.py, tak ho tu reálne podporíme
    if agent_id and agent_id not in ("null", ""):
        where.append("l.agent_id = %s")
        params.append(agent_id)

    sql = f"""
        SELECT l.*, t.task_name, t.location, t.frequency, a.agent_name
        FROM hygiene_log l
        JOIN hygiene_tasks t ON t.id = l.task_id
        LEFT JOIN hygiene_agents a ON a.id = l.agent_id
        WHERE {' AND '.join(where)}
        ORDER BY l.completion_date, t.location, l.start_at
    """

    rows = db_connector.execute_query(sql, tuple(params)) or []

    html_rows = ""
    for r in rows:
        d_comp = _fmt_date_sk(r.get('completion_date'))

        t_start = _fmt_time(r.get('start_at'))
        t_exp_end = _fmt_time(r.get('exposure_end_at'))
        t_rinse_start = t_exp_end
        t_rinse_end = _fmt_time(r.get('rinse_end_at'))

        status = r.get('verification_status') or "Čaká"
        row_bg = "#fff"
        if status == 'NOK':
            row_bg = "#fff0f0"

        html_rows += f"""
        <tr style="background:{row_bg};">
            <td style="text-align:center;">{d_comp}</td>
            <td>
                <b>{r['task_name']}</b><br>
                <span class="meta">{r['frequency']}</span>
            </td>
            <td style="text-align:center;">{status}</td>
            <td>{r.get('user_fullname') or ''}</td>
            <td style="text-align:center;">{t_start}</td>
            <td style="text-align:center;">{t_exp_end}</td>
            <td style="text-align:center;">{t_rinse_start}</td>
            <td style="text-align:center;">{t_rinse_end}</td>
            <td>
                {r.get('agent_name') or '-'}<br>
                <span class="meta">T: {r.get('water_temperature') or '-'}°C</span>
            </td>
            <td>{r.get('checked_by_fullname') or ''}</td>
        </tr>
        """

    disp_from = _fmt_date_sk(date_from)
    disp_to = _fmt_date_sk(date_to)
    date_label = disp_from if disp_from == disp_to else f"{disp_from} – {disp_to}"

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Report Hygieny</title>
        <style>
            @page {{ size: A4 portrait; margin: 1cm; }}
            body {{ font-family: Arial, sans-serif; font-size: 10px; color: #000; }}
            h1 {{ text-align: center; font-size: 16px; text-transform: uppercase; margin-bottom: 5px; }}
            .header {{ text-align: center; margin-bottom: 20px; border-bottom: 1px solid #000; padding-bottom: 5px; }}
            table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
            th, td {{ border: 1px solid #000; padding: 4px; vertical-align: middle; word-wrap: break-word; }}
            th {{ background: #eee; text-align: center; font-weight: bold; font-size: 9px; }}
            td {{ font-size: 9px; }}
            .meta {{ font-size: 8px; color: #555; }}
            .footer {{ position: fixed; bottom: 0; width: 100%; text-align: center; font-size: 9px; }}
        </style>
    </head>
    <body>
        <h1>Záznam o čistení a dezinfekcii</h1>
        <div class="header">
            Dátum: {date_label} | Vygeneroval: Systém MIK | ISO 22000
        </div>

        <table>
            <thead>
                <tr>
                    <th style="width:9%;">Dátum</th>
                    <th style="width:17%;">Úloha / Frekvencia</th>
                    <th style="width:7%;">Stav</th>
                    <th style="width:11%;">Vykonal</th>
                    <th style="width:7%;">Začiatok<br>pôsobenia</th>
                    <th style="width:7%;">Koniec<br>pôsobenia</th>
                    <th style="width:7%;">Začiatok<br>oplachu</th>
                    <th style="width:7%;">Koniec<br>oplachu</th>
                    <th style="width:14%;">Prostriedok / Teplota</th>
                    <th style="width:14%;">Skontroloval</th>
                </tr>
            </thead>
            <tbody>
                {html_rows or '<tr><td colspan="10" style="text-align:center;padding:20px;">Žiadne záznamy.</td></tr>'}
            </tbody>
        </table>

        <div class="footer">Interný dokument | Strana 1</div>
        <script>window.print()</script>
    </body>
    </html>
    """