import os
import traceback
import re
from datetime import datetime, time as dt_time, timedelta
from functools import wraps
from typing import Optional
from dotenv import load_dotenv
from flask import (
    Flask, g, render_template, jsonify, request, session, redirect,
    url_for, make_response, send_from_directory, Blueprint, Response,
)
from flask_mail import Mail
from flask import request
from models import db, Cennik, PolozkaCennika
# === B2C BLUEPRINTY (VERejný + Admin) ===========================
from b2c_public_api_nodb import b2c_public_bp
from erp_import import process_erp_stock_bytes
from kancelaria_b2c_api import kancelaria_b2c_bp
from functools import wraps
from flask import session, jsonify, make_response
from gemini_agent import ask_gemini_agent
from dotenv import load_dotenv
load_dotenv()
from nastroje_ai import vykonaj_bezpecny_sql_prikaz
from flask_mail import Mail, Message
from flask import current_app
from flask_mail import Message
import io, csv, html as py_html
import time as pytime
import uuid
from services.ai_tasks import preview_nl, run_task, build_cron_expr, _send_task_email
from services.ai_tasks import run_task
from auth_handler import login_required, module_required
from leader_handler import leader_bp 
from flask import request, render_template
from flask import render_template
from apscheduler.schedulers.background import BackgroundScheduler # type: ignore
from apscheduler.triggers.cron import CronTrigger # type: ignore
import atexit
from flask import Blueprint, request, jsonify
import mail_handler
import hr_handler
from flask import (
    Flask, render_template, session, redirect,
    url_for, request, jsonify, g
)
from flask import Flask, render_template, session, redirect, url_for, jsonify, request
from auth_handler import login_required, canonicalize_role
from pricelist_handler import pricelist_bp # Import
import temperature_handler
import core_temp_handler
from pdf_generator import create_pricelist_pdf
# ===================== ENTERPRISE KALENDÁR – KONŠTANTY =========================

EVENT_STATUS_OPEN = 'OPEN'
EVENT_STATUS_DONE = 'DONE'
EVENT_STATUS_CANCELLED = 'CANCELLED'


CAL_EVENTS_MEMORY = []
CAL_EVENT_NEXT_ID = 1
# ──────────────────────────────────────────────────────────────
# Načítanie .env a inicializácia Flask
# ──────────────────────────────────────────────────────────────
load_dotenv()
app = Flask(__name__, template_folder='templates', static_folder='static')
from datetime import timedelta

app.config.update(
    SESSION_COOKIE_SAMESITE='Lax',      # cookie sa po presmerovaní nestratí
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=False,        # True iba na https
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    SESSION_REFRESH_EACH_REQUEST=True   # predĺž život pri každom requeste
)

# Secret key – povinné
app.secret_key = os.getenv('SECRET_KEY')
if not app.secret_key:
    raise ValueError("KRITICKÁ CHYBA: SECRET_KEY nie je nastavený v .env súbore!")
app.permanent_session_lifetime = timedelta(hours=8)

# ──────────────────────────────────────────────────────────────
# Konfigurácia Mail
# ──────────────────────────────────────────────────────────────
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 465))
app.config['MAIL_USE_TLS'] = str(os.getenv('MAIL_USE_TLS', 'False')).lower() in ['true', '1', 't']
app.config['MAIL_USE_SSL'] = str(os.getenv('MAIL_USE_SSL', 'True')).lower() in ['true', '1', 't']
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
app.config['MAIL_DEFAULT_SENDER'] = os.getenv("MAIL_DEFAULT_SENDER")
app.config['MAIL_ASCII_ATTACHMENTS'] = False
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
if not all([app.config['MAIL_SERVER'], app.config['MAIL_USERNAME'], app.config['MAIL_PASSWORD'], app.config['MAIL_DEFAULT_SENDER']]):
    print("!!! VAROVANIE: Chýbajú niektoré konfiguračné premenné pre e-mail v .env súbore! Odosielanie e-mailov bude zlyhávať. !!!")

mail = Mail(app)
ERP_EXCHANGE_DIR = os.getenv("ERP_EXCHANGE_DIR") or "/var/app/static/erp_exchange"
ERP_IMPORT_FILENAME = "ZASOBA.CSV"

db.init_app(app)

with app.app_context():
    db.create_all()
# ──────────────────────────────────────────────────────────────
# Projektové moduly (importy po vytvorení app)
# ──────────────────────────────────────────────────────────────
import db_connector
import auth_handler
import production_handler as vyroba
import expedition_handler
import office_handler
import b2b_handler
import b2c_handler
import costs_handler
import pdf_generator
import mail_handler
import fleet_handler
import hygiene_handler
import profitability_handler
import temperature_handler
import meat_calc_handler
from orders_handler import orders_bp, init_orders
from stock_handler import stock_bp, init_stock
from flask import Flask, render_template, request, jsonify, send_from_directory
from notification_handler import (
    send_order_confirmation_email,                # ak ho používate pre B2B
    send_b2c_order_confirmation_email_with_pdf,   # viz funkcia nižšie
)
# ──────────────────────────────────────────────────────────────
# Registrácia blueprintov a init
# ──────────────────────────────────────────────────────────────
# DÔLEŽITÉ: zaregistruj B2C blueprinty, nech ich nič neprepisuje
app.register_blueprint(b2c_public_bp)      # /api/b2c/*
app.register_blueprint(kancelaria_b2c_bp)  # /api/kancelaria/b2c/*  (admin)
app.register_blueprint(leader_bp) 
# Ostatné blueprinty / moduly
app.register_blueprint(stock_bp)
init_stock()
mail_bp = Blueprint("mail_api", __name__)
# Voliteľné: štart teplomerov
try:
    temperature_handler.start_generator()
except Exception as e:
    print("VAROVANIE: Nepodarilo sa spustiť temperature_handler.start_generator():", e)
erp_bp = Blueprint("erp_bp", __name__)
app.register_blueprint(pricelist_bp)
# =================================================================
# === DEKORÁTORY A POMOCNÉ FUNKCIE ===
# =================================================================
from functools import wraps
from flask import session, request, redirect, url_for, jsonify, g
from auth_handler import canonicalize_role   # uisti sa, že tento import je NAD týmto kódom

def login_required(view=None, *, role=None):
    """
    Dekorátor, ktorý:
      - skontroluje, či je používateľ prihlásený
      - ak je zadaný `role`, skontroluje aj rolu (plus admin)

    Použitie:
      @login_required
      @login_required(role='kancelaria')
      @login_required(role=['kancelaria', 'veduci'])
    """

    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            user = session.get('user')

            # 1) nie je prihlásený
            if not user:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Prístup zamietnutý. Prosím, prihláste sa.'}), 401
                return redirect(url_for('login'))

            g.user = user  # môžeš používať g.user v handleroch

                        # 2) kontrola role, ak je zadaná
            if role is not None:
                # normalizuj roly rovnako ako v auth_handler.canonicalize_role
                if isinstance(role, (list, tuple, set)):
                    allowed_roles = {canonicalize_role(r) for r in role}
                else:
                    allowed_roles = {canonicalize_role(role)}

                user_role = canonicalize_role(user.get('role'))

                # admin má vždy prístup
                if user_role not in allowed_roles and user_role != 'admin':
                    if request.path.startswith('/api/'):
                        return jsonify({'error': 'Nemáte oprávnenie na prístup do tejto sekcie.'}), 403
                    return redirect(url_for('login'))


            return func(*args, **kwargs)

        return wrapped

    # Podpora oboch zápisov:
    # @login_required
    # @login_required(role='nieco')
    if view is None:
        return decorator
    else:
        return decorator(view)

# Alias – kde používaš @auth_required, správa sa ako login_required(role='kancelaria')
def auth_required(f=None):
    decorator = login_required(role='kancelaria')
    if f is not None:
        return decorator(f)
    return decorator

def handle_request(handler_func, *args, **kwargs):
    try:
        result = handler_func(*args, **kwargs)
        if isinstance(result, dict) and result.get("error"):
            return jsonify(result), 400
        if isinstance(result, make_response('').__class__):
            return result
        return jsonify(result)
    except Exception:
        print(f"!!! SERVER ERROR in handler '{getattr(handler_func,'__name__',str(handler_func))}' !!!")
        print(traceback.format_exc())
        return jsonify({'error': "Interná chyba servera. Kontaktujte administrátora."}), 500
# ------------------------------------------------
# HLAVNÁ STRÁNKA / A LOGIN STRÁNKA
# ------------------------------------------------

@app.route('/')
def index():
    user = session.get('user')
    if not user:
        return redirect(url_for('login'))

    role = canonicalize_role(user.get('role'))

    if role in ('vyroba',):
        return redirect(url_for('page_vyroba'))
    if role in ('expedicia', 'veduci'):
        return redirect(url_for('page_expedicia'))
    if role in ('kancelaria', 'office'):
        return redirect(url_for('page_kancelaria'))
    if role == 'admin':
        return redirect(url_for('page_kancelaria'))

    # fallback – radšej na login
    return redirect(url_for('login'))


@app.route('/login')
def login():
    user = session.get('user')
    if user:
        # už si prihlásený → rovno do modulu
        role = canonicalize_role(user.get('role'))
        if role in ('vyroba',):
            return redirect(url_for('page_vyroba'))
        if role in ('expedicia', 'veduci'):
            return redirect(url_for('page_expedicia'))
        if role in ('kancelaria', 'office'):
            return redirect(url_for('page_kancelaria'))
        if role == 'admin':
            return redirect(url_for('page_kancelaria'))

    return render_template('login.html')


@app.route('/api/internal/me', methods=['GET'])
@login_required()  # stačí, že je prihlásený; rolu tu neriešime
def api_internal_me():
    u = session.get('user')
    if u:
        u = dict(u)
        u['role'] = canonicalize_role(u.get('role'))
    return jsonify({'user': u})


# =================================================================
# === HLAVNÉ ROUTY PRE STRÁNKY (VIEWS) ===
# =================================================================

@app.route('/vyroba')
@login_required(role='vyroba')   # dôležité sú tie zátvorky
def page_vyroba():
    return render_template('vyroba.html', user=session.get('user'))

@app.route('/expedicia')
@login_required(role=('veduci', 'admin', 'expedicia'))   # vedúci určite povolený
def page_expedicia():
    user = session.get('user') or {}
    # použijeme canonicalize_role, nech máš rovnakú logiku ako inde
    role = canonicalize_role(user.get('role'))

    # vedúci (a admin) dostane líder portál
    if role in ('veduci', 'admin'):
        return render_template('leaderexpedicia.html', user=user)

    # bežný pracovník expedície
    return render_template('expedicia.html', user=user)

@app.route('/kancelaria')
@login_required(role='kancelaria')
def page_kancelaria():
    return render_template('kancelaria.html', user=session.get('user'))


@app.route('/b2b')
def page_b2b():
    return render_template('b2b.html')

@app.route('/b2c')
def page_b2c_page():
    return render_template('b2c.html')

@app.route('/favicon.ico')
def favicon():
    path = os.path.join(app.root_path, 'static', 'favicon.ico')
    if os.path.exists(path):
        return send_from_directory(os.path.join(app.root_path, 'static'), 'favicon.ico', mimetype='image/vnd.microsoft.icon')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14"/></svg>'
    return Response(svg, mimetype='image/svg+xml')

# =========================== B2B – VEREJNÉ API PRE PORTÁL =============================
@app.get('/api/b2b/ab-token')
def api_b2b_ab_token():
    return jsonify(b2b_handler.issue_antibot_token())

@app.post('/api/b2b/login')
def api_b2b_login():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.process_b2b_login, data)

@app.post('/api/b2b/register')
def api_b2b_register():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.process_b2b_registration, data)

@app.post('/api/b2b/request-reset')
def api_b2b_request_reset():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.request_password_reset, data)

@app.post('/api/b2b/perform-reset')
def api_b2b_perform_reset():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.perform_password_reset, data)

@app.post('/api/b2b/get-products')
def api_b2b_get_products():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.get_products_for_pricelist, data.get('pricelist_id'))

@app.post('/api/b2b/submit-order')
def api_b2b_submit_order():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.submit_b2b_order, data)

@app.post('/api/b2b/get-order-history')
def api_b2b_get_order_history():
    data = request.get_json(silent=True) or {}
    return handle_request(b2b_handler.get_order_history, data.get('userId'))

# >>> PDF pre zákazníka (zobraziť/stiahnuť)
@app.get('/api/b2b/order-pdf/<int:order_id>')
def api_b2b_order_pdf(order_id):
    user_id = request.args.get('user_id', type=int)
    want_download = request.args.get('download')
    res = b2b_handler.build_order_pdf_for_customer(order_id, user_id)
    if isinstance(res, dict) and res.get('error'):
        code = res.get('code', 400)
        return jsonify({"error": res['error']}), code
    pdf = res['pdf']
    filename = res.get('filename', f'objednavka_{order_id}.pdf')
    disp = 'attachment' if want_download else 'inline'
    resp = make_response(pdf)
    resp.headers['Content-Type'] = 'application/pdf'
    resp.headers['Content-Disposition'] = f'{disp}; filename="{filename}"'
    return resp

# ---- B2B KOMUNIKÁCIA (PORTÁL)
@app.post('/api/b2b/messages/send')
def api_b2b_msg_send():
    # multipart/form-data (FormData), nie JSON
    return handle_request(b2b_handler.portal_message_send, request)

@app.post('/api/b2b/messages/my')
def api_b2b_msg_my():
    data = request.get_json(silent=True) or {}
    user_id = data.get('userId')
    page = int(data.get('page', 1))
    page_size = int(data.get('page_size', 50))
    return handle_request(b2b_handler.portal_my_messages, user_id, page, page_size)
# ---- MINIMÁLNY UPLOAD ENDPOINT (copy–paste) ----
from flask import request, jsonify, abort
from storage import save_upload

# Obmedzenie veľkosti (napr. 20 MB)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

# Povolené cieľové priečinky v APP_DATA_DIR
ALLOWED_FOLDERS = {"uploads", "orders", "invoices", "b2c_meta", "exports", "imports"}

@app.post("/upload")
def upload_file():
    # TODO: nahraď vlastnou autentifikáciou
    # if not session.get("user_id"): abort(401)

    f = request.files.get("file")
    if not f:
        return ("Missing form field 'file'", 400)

    folder = request.form.get("folder", "uploads")
    if folder not in ALLOWED_FOLDERS:
        return ("Invalid folder", 400)

    saved_path = save_upload(f, folder=folder)
    return jsonify({"ok": True, "path": saved_path})

# =================================================================
# === INTERNÉ PRIHLASOVANIE A SESSION MANAGEMENT ===
# =================================================================
@app.route('/api/internal/login', methods=['POST'])
def internal_login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    module   = (data.get('module') or '').strip().lower()  # napr. 'expedicia'; môže byť prázdne

    # načítanie používateľa (is_active ak máš)
    user = db_connector.execute_query(
        "SELECT id, username, role, full_name, password_hash, password_salt, COALESCE(is_active,1) AS is_active "
        "FROM internal_users WHERE username=%s",
        (username,),
        fetch='one'
    )

    # základná kontrola mena/hesla
    if not user or not auth_handler.verify_password(password, user['password_salt'], user['password_hash']):
        return jsonify({'error': 'Nesprávne meno alebo heslo.'}), 401
    if not int(user.get('is_active', 1)):
        return jsonify({'error': 'Účet je deaktivovaný.'}), 401

    # ROZDHODUJÚCA ZMENA: rolu vždy skánonizuj (strip + lower + aliasy: veduca -> veduci)
    role = canonicalize_role(user.get('role'))

    # Prístup do modulov – 'veduci' má prístup do expedície
    allowed_for_module = {
        'expedicia': {'veduci', 'expedicia', 'admin'},
        'kancelaria': {'kancelaria', 'admin'},
        'vyroba': {'vyroba', 'admin'},
    }
    if module:
        allowed = allowed_for_module.get(module, set())
        if role not in allowed and role != 'admin':
            return jsonify({'error': f"Nemáte oprávnenie pre modul '{module}'. Vaša rola: '{role}'"}), 401

    # login OK → session
    session.permanent = True
    session['user'] = {
        'id': user['id'],
        'username': user['username'],
        'role': role,
        'full_name': user.get('full_name') or user['username'],
    }

    # redirect – ak FE pošle module, rešpektuj ho; inak podľa roly
    redirect_to = '/'
    if module:
        if module == 'expedicia':
            redirect_to = '/expedicia'
        elif module == 'kancelaria':
            redirect_to = '/kancelaria'
        elif module == 'vyroba':
            redirect_to = '/vyroba'
    else:
        # fallback podľa roly (nič nerozbiješ, keď FE modul neposiela)
        if role in ('veduci', 'expedicia'):
            redirect_to = '/expedicia'
        elif role == 'kancelaria':
            redirect_to = '/kancelaria'
        elif role == 'vyroba':
            redirect_to = '/vyroba'

    return jsonify({
        'ok': True,
        'message': 'Prihlásenie úspešné.',
        'user': session['user'],
        'redirect': redirect_to
    })

@app.route('/api/internal/logout', methods=['POST'])
def internal_logout():
    session.pop('user', None)
    return jsonify({'message': 'Boli ste úspešne odhlásený.'})

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))


@app.get('/api/internal/check_session', endpoint='internal_check_session')
def internal_check_session():
    u = session.get('user')
    # voliteľne rolu kanonizuj, nech má FE konzistentnú hodnotu
    if u and 'role' in u:
        u = dict(u)  # copy
        u['role'] = canonicalize_role(u['role'])
    return jsonify({'loggedIn': bool(u), 'user': u or None})

# =================================================================
# === API: VÝROBA (vyroba.html) ===================================
# =================================================================

@app.route('/api/kancelaria/getInventoryHistory', methods=['GET'])
@login_required(role='kancelaria')
def api_get_inventory_history():
    return handle_request(office_handler.get_inventory_history_list)

@app.route('/api/kancelaria/getInventoryDetail', methods=['GET'])
@login_required(role='kancelaria')
def api_get_inventory_detail():
    log_id = request.args.get('id')
    return handle_request(office_handler.get_inventory_detail, log_id)

# ---- MENU / PLÁNOVANIE -----------------------------------------

@app.route('/api/getProductionMenuData', methods=['GET'])
@login_required(role=['vyroba', 'kancelaria'])
def api_get_menu():
    return handle_request(vyroba.get_production_menu_data)

@app.route('/api/calculateRequiredIngredients', methods=['POST'])
@login_required(role=['vyroba', 'kancelaria'])
def api_calc_ing():
    body = request.get_json(force=True) or {}
    return handle_request(
        vyroba.calculate_required_ingredients,
        body.get('productName'),
        body.get('plannedWeight'),
    )

@app.route('/api/startProduction', methods=['POST'])
@login_required(role='vyroba')
def api_start_production():
    body = request.get_json(force=True) or {}
    return handle_request(
        vyroba.start_production,
        body.get('productName'),
        body.get('plannedWeight'),
        body.get('productionDate'),
        body.get('ingredients') or [],
        body.get('workerName'),
        body.get('existingLogId'),
    )

# ---- SKLAD SUROVÍN / STAV --------------------------------------

@app.route('/api/getWarehouseState', methods=['GET'])
@login_required(role=['vyroba', 'kancelaria'])
def api_wh_state():
    return handle_request(vyroba.get_warehouse_state)

@app.route('/api/getAllWarehouseItems', methods=['GET'])
@login_required(role=['vyroba', 'kancelaria'])
def api_wh_items():
    return handle_request(vyroba.get_all_warehouse_items)

# ---- INVENTÚRA – STARÝ „JEDNORÁZOVÝ“ SUBMIT --------------------

@app.route('/api/submitInventory', methods=['POST'])
@login_required(role='vyroba')
def api_submit_inventory():
    body = request.get_json(force=True) or []
    return handle_request(vyroba.update_inventory, body)

# ---- INVENTÚRA – NOVÝ ŠTÝL (podľa kategórií) -------------------

@app.route('/api/saveInventoryCategory', methods=['POST'])
@login_required(role='vyroba')
def api_save_inventory_category():
    """
    Uloženie jednej kategórie inventúry (Mäso/Koreniny/Obaly/Pomocný materiál).
    Volá production_handler.save_inventory_category(items, category_name).
    """
    body = request.get_json(force=True) or {}
    items = body.get('items') or []
    category = (body.get('category') or '').strip() or 'Nezaradené'
    return handle_request(vyroba.save_inventory_category, items, category)

@app.route('/api/finishInventory', methods=['POST'])
@login_required(role='vyroba')
def api_finish_inventory():
    """
    Ukončenie inventúry – DRAFT v inventory_logs sa prepne na COMPLETED.
    """
    return handle_request(vyroba.finish_inventory_process)

@app.route('/api/cancelProduction', methods=['POST'])
@login_required(role='vyroba')
def api_cancel_production():
    body = request.get_json(force=True) or {}
    return handle_request(
        vyroba.cancel_production_batch,
        body.get('batchId')
    )

# ---- MANUÁLNY ODPIS --------------------------------------------

@app.route('/api/manualWriteOff', methods=['POST'])
@login_required(role='vyroba')
def api_manual_writeoff():
    body = request.get_json(force=True) or {}
    return handle_request(vyroba.manual_warehouse_write_off, body)

# ---- Cenník --------------------------------------------
@app.route('/api/save_pricelist', methods=['POST'])
def save_pricelist():
    data = request.json
    
    # 1. Vytvoríme hlavičku cenníka
    novy_cennik = Cennik(
        nazov=data.get('nazov', 'Nový Cenník'),
        email=data.get('email', '')
    )
    db.session.add(novy_cennik)
    db.session.commit() # Tu sa pridelí ID

    # 2. Uložíme položky k tomuto cenníku
    polozky_data = data.get('polozky', [])
    for p in polozky_data:
        nova_polozka = PolozkaCennika(
            cennik_id=novy_cennik.id,
            nazov_produktu=p['nazov'],
            mj=p.get('mj', 'ks'),
            cena=float(p['cena'])
        )
        db.session.add(nova_polozka)
    
    db.session.commit() # Uložíme všetko naraz
    
    return jsonify({"message": "Cenník uložený", "id": novy_cennik.id})

@app.route('/api/get_pricelists', methods=['GET'])
def get_pricelists():
    cenniky = Cennik.query.order_by(Cennik.datum_vytvorenia.desc()).all()
    output = []
    for c in cenniky:
        output.append({
            "id": c.id,
            "nazov": c.nazov,
            "email": c.email,
            "datum": c.datum_vytvorenia.strftime("%d.%m.%Y")
        })
    return jsonify(output)


# 1. API: Uložiť nový cenník (CREATE)
@app.route('/api/cenniky/save', methods=['POST'])
def save_cennik_api():
    data = request.json
    c = Cennik(nazov=data.get('nazov'), email=data.get('email'))
    db.session.add(c)
    db.session.commit()
    
    for item in data.get('polozky', []):
        p = PolozkaCennika(
            cennik_id=c.id,
            nazov_produktu=item['name'],
            mj=item.get('mj', 'kg'),      # Default kg
            cena=float(item['price'] or 0),
            povodna_cena=float(item['old_price'] or 0),
            dph=float(item.get('dph', 20)), # Uložíme DPH
            is_action=item.get('is_action', False)
        )
        db.session.add(p)
    db.session.commit()
    return jsonify({"success": True})

# 2. API: Zoznam všetkých cenníkov (LIST)
@app.route('/api/cenniky/list', methods=['GET'])
def list_cenniky():
    vsetky = Cennik.query.order_by(Cennik.created_at.desc()).all()
    out = []
    for c in vsetky:
        out.append({
            "id": c.id,
            "nazov": c.nazov,
            "datum": c.created_at.strftime("%d.%m.%Y %H:%M"),
            "pocet_poloziek": len(c.polozky)
        })
    return jsonify(out)

# 3. API: Odoslať konkrétny cenník emailom (SEND)
@app.route('/api/cenniky/<int:cennik_id>/send', methods=['POST'])
def send_stored_pricelist(cennik_id):
    data = request.json
    email_to = data.get('email')
    
    if not email_to:
        return jsonify({"error": "Chýba email"}), 400

    cennik = Cennik.query.get_or_404(cennik_id)
    
    # Príprava dát pre PDF - musia presne sedieť s pdf_generator.py
    pdf_data = {
        "name": cennik.nazov,
        "items": []
    }
    
    for p in cennik.polozky:
        pdf_data["items"].append({
            "name": p.nazov_produktu,
            "unit": p.mj,
            "price": p.cena, # Cena bez DPH
            "dph": p.dph     # DPH %
        })

    # Generovanie
    from pdf_generator import create_pricelist_pdf
    pdf_bytes = create_pricelist_pdf(pdf_data)

    # Odoslanie (použi svoj existujúci mail kód)
    msg = Message(subject=f"Cenník: {cennik.nazov}", recipients=[email_to])
    msg.body = "Dobrý deň,\n\nv prílohe posielame Váš individuálny cenník."
    msg.attach(f"Cennik.pdf", "application/pdf", pdf_bytes)
    
    try:
        mail.send(msg)
        return jsonify({"success": True, "message": "Odoslané"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
# =========================== KANCELÁRIA – HACCP ===========================
@app.route('/api/kancelaria/getHaccpDocs')
@login_required(role='kancelaria')
def kanc_haccp_docs():
    return handle_request(office_handler.get_haccp_docs)

@app.route('/api/kancelaria/getHaccpDocContent', methods=['POST'])
@login_required(role='kancelaria')
def kanc_haccp_doc_content():
    return handle_request(office_handler.get_haccp_doc_content, request.json)

@app.route('/api/kancelaria/saveHaccpDoc', methods=['POST'])
@login_required(role='kancelaria')
def kanc_haccp_save_doc():
    return handle_request(office_handler.save_haccp_doc, request.json)


@app.route('/api/kancelaria/haccp/import_docx', methods=['POST'])
@login_required(role='kancelaria')
def kanc_haccp_import_docx():
    """
    Importuje .docx HACCP dokument (upload z haccp.js) a uloží ho ako JSON.
    Očakáva multipart/form-data s poľom 'file'.
    """
    res = office_handler.import_haccp_docx()  # používa flask.request.files vo vnútri

    # import_haccp_docx môže vrátiť dict alebo (dict, status)
    if isinstance(res, tuple):
        body, status = res
        return jsonify(body), status

    return jsonify(res)


@app.route('/api/kancelaria/haccp/export_docx')
@login_required(role='kancelaria')
def kanc_haccp_export_docx():
    """
    Exportuje HACCP dokument do .docx (alebo vráti originál, ak bol importovaný).
    Parametre: id (povinné), use_original=1 (voliteľné)
    """
    res = office_handler.export_haccp_docx()
    # export_haccp_docx vracia buď send_file(...) alebo (dict, status)
    if isinstance(res, tuple):
        body, status = res
        if isinstance(body, dict):
            return jsonify(body), status
        return body, status
    return res

@app.route('/api/kancelaria/deleteHaccpDoc', methods=['POST'])
@login_required(role='kancelaria')
def kanc_haccp_delete():
    return handle_request(office_handler.delete_haccp_doc, request.json)
# =================================================================
# === API ENDPOINTY PRE MODUL: EXPEDÍCIA ===
# =================================================================

from auth_handler import module_required
@app.get('/leaderexpedicia')
@login_required(role=('veduci','admin'))
def leader_page():
    return render_template('leaderexpedicia.html')


@app.route('/api/expedicia/cancelSlicingJob', methods=['POST'])
@login_required(role='expedicia')
def api_exp_cancel_slicing():
    body = request.get_json(force=True)
    # Použije tú istú logiku ako leader
    return handle_request(
        expedition_handler.cancel_slicing_job_logic, 
        body.get('logId'), 
        body.get('workerName') or 'Expedícia',
        'Zrušené pracovníkom expedície'
    )

@app.route('/api/expedicia/getExpeditionData')
@login_required(role='expedicia')
def exp_get_data():
    return handle_request(expedition_handler.get_expedition_data)

@app.route('/api/expedicia/getProductionDates')
@login_required(role='expedicia')
def exp_get_prod_dates():
    return handle_request(expedition_handler.get_production_dates)

@app.route('/api/expedicia/getProductionsByDate', methods=['POST'])
@login_required(role='expedicia')
def exp_get_prods_by_date():
    body = request.get_json(force=True) or {}
    return handle_request(expedition_handler.get_productions_by_date, body.get('date'))

@app.route('/api/expedicia/acceptProductionItem', methods=['POST'])
@login_required(role='expedicia')
def exp_accept_production_item():
    return handle_request(expedition_handler.accept_production_item, request.json)

@app.route('/api/expedicia/getAcceptanceDays')
@login_required(role='expedicia')
def exp_get_acceptance_days():
    return handle_request(expedition_handler.get_acceptance_days)

@app.route('/api/expedicia/getAcceptanceArchive')
@login_required(role='expedicia')
def exp_get_acceptance_archive():
    return handle_request(expedition_handler.get_acceptance_archive, request.args.get('date'))

@app.route('/api/expedicia/editAcceptance', methods=['POST'])
@login_required(role='expedicia')
def exp_edit_acceptance():
    return handle_request(expedition_handler.edit_acceptance, request.json)

@app.route('/api/expedicia/deleteAcceptance', methods=['POST'])
@login_required(role='expedicia')
def exp_delete_acceptance():
    return handle_request(expedition_handler.delete_acceptance, request.json)

@app.route('/api/expedicia/getAccompanyingLetter', methods=['POST'])
@login_required(role=['expedicia', 'kancelaria'])
def exp_get_letter():
    data = expedition_handler.get_accompanying_letter_data(request.json.get('batchId'))
    if not data:
        return make_response(f"<h1>Chyba: Dáta pre šaržu '{request.json.get('batchId')}' neboli nájdené.</h1>", 404)
    worker = request.json.get('workerName')
    tpl = {"title":"Sprievodný List","is_accompanying_letter":True,
           "report_date": datetime.now().strftime('%d.%m.%Y %H:%M'),
           "data": {**data, 'prebral': worker}}
    return make_response(render_template('report_template.html', **tpl))

# Krájanie
@app.route('/api/expedicia/getSlicableProducts')
@login_required(role='expedicia')
def exp_get_slicable():
    return handle_request(expedition_handler.get_slicable_products)

@app.route('/api/expedicia/startSlicingRequest', methods=['POST'])
@login_required(role='expedicia')
def exp_start_slicing():
    body = request.get_json(force=True) or {}
    return handle_request(expedition_handler.start_slicing_request, body.get('ean'), body.get('pieces'))

@app.route('/api/expedicia/finalizeSlicing', methods=['POST'])
@login_required(role='expedicia')
def exp_finalize_slicing():
    body = request.get_json(force=True) or {}
    return handle_request(expedition_handler.finalize_slicing_transaction, body.get('logId'), body.get('actualPieces'))

@app.route('/api/expedicia/createManualSlicingJob', methods=['POST'])
@login_required(role='expedicia')
def exp_create_manual_slicing_job():
    """
    Vytvorí úlohu na krájanie priamo z objednávky (Objednávky na krájanie – Zákazníci).
    Očakáva JSON:
      {
        "ean": "...",          # EAN krájaného výrobku (cieľ)
        "quantity": 123,       # počet kusov alebo kg
        "unit": "ks"|"kg",
        "customer": "...",     # meno zákazníka
        "order_id": "...",     # číslo objednávky
        "due_date": "..."      # termín (môže byť aj vo formáte 01.12.2025)
      }
    """
    body = request.get_json(force=True) or {}
    return handle_request(expedition_handler.create_manual_slicing_job, body)


# Manuálny príjem / škoda
@app.route('/api/expedicia/getAllFinalProducts')
@login_required(role='expedicia')
def exp_get_all_final_products():
    return handle_request(expedition_handler.get_all_final_products)

@app.route('/api/expedicia/manualReceiveProduct', methods=['POST'])
@login_required(role='expedicia')
def exp_manual_receive():
    return handle_request(expedition_handler.manual_receive_product, request.json)

@app.route('/api/expedicia/logManualDamage', methods=['POST'])
@login_required(role='expedicia')
def exp_manual_damage():
    return handle_request(expedition_handler.log_manual_damage, request.json)

# Inventúra finálnych produktov (sklad 2)
@app.route('/api/expedicia/getProductsForInventory')
@login_required(role='expedicia')
def exp_get_products_for_inventory():
    return handle_request(expedition_handler.get_products_for_inventory)

@app.route('/api/expedicia/submitProductInventory', methods=['POST'])
@login_required(role='expedicia')
def exp_submit_product_inventory():
    body = request.get_json(force=True) or {}
    return handle_request(expedition_handler.submit_product_inventory, body.get('inventoryData'), body.get('workerName'))

@app.route('/api/kancelaria/getExpeditionInventoryHistory')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_get_exp_inv_history():
    return handle_request(office_handler.get_expedition_inventory_history)

@app.route('/api/kancelaria/getExpeditionInventoryDetail')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_get_exp_inv_detail():
    inv_id = request.args.get('id')
    return handle_request(office_handler.get_expedition_inventory_detail, inv_id)
# Pridajte do app.py pre expedíciu:

def _finish_daily_reception_and_export(date_str: str, worker_name: str):
    """
    1) Uzavrie denný príjem v EXPEDÍCII (expedition_handler.finish_daily_reception)
    2) Ak je všetko OK, vygeneruje VYROBKY.CSV z prijmov expedície za daný deň.
    """
    res = expedition_handler.finish_daily_reception(date_str, worker_name)
    # Ak handler vrátil dict s errorom, nerob export
    if isinstance(res, dict) and res.get("error"):
        return res

    # Ak máme platný dátum, skús spraviť export
    if date_str:
        try:
            office_handler.generate_erp_export_file_for_acceptance_day(date_str)
        except Exception as e:
            # neprerušuj kvôli tomu celý request, len pridaj varovanie
            if isinstance(res, dict):
                res.setdefault("warning", str(e))
    return res
   

@app.route('/api/expedicia/finishDailyReception', methods=['POST'])
@login_required(role='expedicia')
def api_finish_daily_reception():
    body = request.get_json(force=True)
    return handle_request(
        _finish_daily_reception_and_export,
        body.get('date'),
        body.get('workerName')
    )


@app.route('/api/expedicia/returnToProduction', methods=['POST'])
@login_required(role='expedicia')
def api_return_to_production():
    body = request.get_json(force=True)
    return handle_request(expedition_handler.return_to_production, body.get('batchId'), body.get('reason'), body.get('workerName'))

@app.route('/api/expedicia/cancelAcceptance', methods=['POST'])
@login_required(role='expedicia')
def api_cancel_acceptance():
    body = request.get_json(force=True)
    return handle_request(expedition_handler.cancel_acceptance, body.get('batchId'), body.get('workerName'), body.get('reason'))

@app.route('/api/expedicia/printDailyReport', methods=['POST'])
@login_required(role='expedicia')
def api_print_daily_report():
    body = request.get_json(force=True)
    html_content = expedition_handler.get_daily_reception_report_html(body.get('date'))
    return make_response(html_content)


@app.route('/api/expedicia/getSlicingRequirementsFromOrders')
@login_required(role='expedicia')
def api_get_slicing_reqs():
    return handle_request(expedition_handler.get_slicing_requirements_from_orders)

# app.py

@app.route('/api/kancelaria/b2b/deletePricelist', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def delete_b2b_pricelist_route():
    return handle_request(b2b_handler.delete_pricelist, request.json)

@app.route('/api/expedicia/saveInventoryCategory', methods=['POST'])
@login_required(role='expedicia')
def api_save_product_inventory_category():
    body = request.get_json(force=True)
    return handle_request(expedition_handler.save_product_inventory_category, body.get('items'), body.get('category'), body.get('workerName'))

@app.route('/api/expedicia/finishInventory', methods=['POST'])
@login_required(role='expedicia')
def api_finish_product_inventory():
    return handle_request(expedition_handler.finish_product_inventory)
# =================================================================
# === API: GEMINI ...
# =================================================================
@app.route("/api/mail/test", methods=["POST"])
def api_mail_test():
    body = request.get_json(force=True, silent=True) or {}
    to = (body.get("to") or "").strip()
    if not to:
        return jsonify({"ok": False, "message": "Chýba 'to'."}), 400
    try:
        _send_task_email(
            to_addr=to,
            subject="[Asistent Gemini] Test odoslania",
            html_body="<p>Ahoj, toto je testovací email z plánovača (AI ➜ mail).</p>"
        )
        return jsonify({"ok": True, "message": "MAIL SENT OK"})
    except Exception as e:
        return jsonify({"ok": False, "message": f"MAIL ERROR: {e}"}), 500


@app.route("/api/tasks/preview_nl", methods=["POST"])
def api_tasks_preview_nl():
    body = request.get_json(force=True, silent=True) or {}
    question = (body.get("question") or "").strip()
    if not question:
        return jsonify({"ok": False, "message": "Chýba 'question'."}), 400

    conv_id = body.get("conversation_id") or f"task_preview_{uuid.uuid4().hex[:10]}"
    try:
        pv = preview_nl(question=question, conversation_id=conv_id)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "message": f"Gemini zlyhal: {e}"}), 500

    return jsonify({
        "ok": True,
        "preview": {
            "answer": pv["answer"],
            "answer_html": pv["answer_html"],
            "row_count": pv["row_count"],
            "columns": pv["columns"],
            "rows": pv["rows"],
            "used_sql": pv["used_sql"],
            "email_html": pv["email_html"]
        },
        "needs_clarification": pv["needs_clarification"],
        "pending_write": pv["pending_write"],
    })


@app.route("/api/tasks/save_nl", methods=["POST"])
def api_tasks_save_nl():
    body = request.get_json(force=True, silent=True) or {}
    task_id = body.get("task_id")
    name    = (body.get("name") or "").strip()
    question= (body.get("question") or "").strip()
    email   = (body.get("email") or "").strip()
    kind    = (body.get("schedule_type") or "").strip()
    time_str= (body.get("time") or "").strip()
    dow     = body.get("dow")
    dom     = body.get("dom")

    if not name or not question or not email:
        return jsonify({"ok": False, "message": "Chýba 'name' alebo 'question' alebo 'email'."}), 400

    try:
        cron_expr = build_cron_expr(kind, time_str=time_str, dow=dow, dom=dom)
    except Exception as e:
        return jsonify({"ok": False, "message": f"Neplatný rozvrh: {e}"}), 400

    if task_id:
        db_connector.execute_query(
            "UPDATE automatizovane_ulohy SET nazov_ulohy=%s, popis_ulohy_pre_ai=%s, cron_retazec=%s, email_adresata=%s, sql_text=NULL, is_enabled=1, updated_at=NOW() WHERE id=%s",
            (name, question, cron_expr, email, int(task_id)), fetch="none"
        )
        rid = int(task_id)
    else:
        db_connector.execute_query(
            "INSERT INTO automatizovane_ulohy(nazov_ulohy, popis_ulohy_pre_ai, cron_retazec, email_adresata, sql_text, is_enabled, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,NULL,1,NOW(),NOW())",
            (name, question, cron_expr, email), fetch="none"
        )
        rid_row = db_connector.execute_query("SELECT LAST_INSERT_ID() AS id", fetch="one") or {}
        rid = int(rid_row.get("id") or 0)

    return jsonify({"ok": True, "id": rid, "cron": cron_expr})

@app.route("/api/tasks/run", methods=["POST"])
def api_tasks_run():
    body = request.get_json(force=True, silent=True) or {}
    try:
        task_id = int(body.get("task_id") or 0)
    except Exception:
        return jsonify({"ok": False, "message": "Neplatný 'task_id'."}), 400
    if not task_id:
        return jsonify({"ok": False, "message": "Chýba 'task_id'."}), 400

    idem = (body.get("idempotency_key") or "").strip() or None
    try:
        out = run_task(task_id, idempotency_key=idem, throttle_seconds=10)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "message": f"Run zlyhal: {e}"}), 500

    # pri SKIP (throttle/duplica/needs_clar) vráť 409 – UI to nevyhodnotí ako úspech
    status = 200 if out.get("ok") else 409
    return jsonify(out), status




@app.route("/api/gemini/agent", methods=["POST"])
def api_gemini_agent():
    body = request.get_json(force=True, silent=True) or {}
    q        = (body.get("question") or "").strip()
    hist     = body.get("history") or []
    conv_id  = body.get("conversation_id") or request.cookies.get("gemini_conversation_id") or "default"
    user_id  = session.get("user_id")  # ak máš login
    # >>> DOPLŇ TENTO RIADOK:
    confirm  = bool(body.get("confirm"))

    if not q:
        return jsonify({"error": "Chýba 'question'."}), 400
    try:
        # >>> A TENTO RIADOK uprav (pridaj confirm=confirm):
        out = ask_gemini_agent(q, hist, conversation_id=conv_id, user_id=user_id, confirm=confirm)
        return jsonify(out)
    except Exception as e:
        import traceback, os
        print("[GEMINI_AGENT_ERROR]", e); traceback.print_exc()
        return jsonify({"error":"gemini_failed", "detail":str(e), "has_api_key": bool(os.getenv("GEMINI_API_KEY"))}), 500

    
  # === Gemini Tasks API (list/save/delete/run/validate) =======================

import os
try:
    import db_connector
except Exception as _e:
    raise RuntimeError("db_connector chýba v app.py – importuj svoj modul s execute_query(.)") from _e


# LIST – prehľad uložených úloh
@app.route("/api/gemini/tasks/list", methods=["GET", "POST"])
def gemini_tasks_list():
    rows = db_connector.execute_query(
        """
        SELECT id,
               nazov_ulohy,
               popis_ulohy_pre_ai,
               cron_retazec,
               email_adresata,
               sql_text,
               is_enabled
          FROM automatizovane_ulohy
         ORDER BY id DESC
        """,
        fetch="all"
    ) or []
    return jsonify({"items": rows})


# VALIDÁCIA CRON reťazca
@app.route("/api/gemini/tasks/validate_cron", methods=["POST"])
def gemini_tasks_validate_cron():
    body = request.get_json(silent=True) or {}
    cron = (body.get("cron") or "").strip()
    if not cron:
        return jsonify({"valid": False, "error": "CRON je prázdny."})
    try:
        from apscheduler.triggers.cron import CronTrigger # type: ignore
        CronTrigger.from_crontab(cron)
        return jsonify({"valid": True})
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)})


# SAVE – vytvorenie / úprava úlohy (plný save + jednoduchý toggle is_enabled)
@app.route("/api/gemini/tasks/save", methods=["POST"])
def gemini_tasks_save():
    body = request.get_json(silent=True) or {}
    task_id = body.get("id")

    # ---------- 1) ŠPECIÁLNY PRÍPAD: toggle is_enabled ----------
    # Frontend pri prepínači posiela len {id, is_enabled}
    only_toggle = (
        task_id is not None
        and "is_enabled" in body
        and all(
            (k not in body) or (body[k] in (None, ""))
            for k in ("nazov_ulohy", "popis_ulohy_pre_ai",
                      "cron_retazec", "email_adresata", "sql_text")
        )
    )

    if only_toggle:
        try:
            is_enabled = int(body.get("is_enabled") or 0)
        except Exception:
            is_enabled = 0

        db_connector.execute_query(
            """
            UPDATE automatizovane_ulohy
               SET is_enabled = %s,
                   updated_at = NOW()
             WHERE id = %s
            """,
            (is_enabled, int(task_id)),
            fetch="none"
        )
        return jsonify({"ok": True, "id": int(task_id), "is_enabled": is_enabled})

    # ---------- 2) PLNÉ ULOŽENIE / EDITÁCIA ÚLOHY ----------
    name = (body.get("nazov_ulohy") or "").strip()
    if not name:
        return jsonify({"ok": False, "message": "Názov úlohy (nazov_ulohy) je povinný."}), 400

    f = {
        "nazov_ulohy": name,
        "popis_ulohy_pre_ai": (body.get("popis_ulohy_pre_ai") or "").strip() or None,
        "cron_retazec": (body.get("cron_retazec") or "").strip() or None,
        "email_adresata": (body.get("email_adresata") or "").strip() or None,
        "sql_text": (body.get("sql_text") or "").strip() or None,
        "is_enabled": int(body.get("is_enabled") if body.get("is_enabled") is not None else 1),
    }

    if task_id:
        # UPDATE existujúcej úlohy
        db_connector.execute_query(
            """
            UPDATE automatizovane_ulohy
               SET nazov_ulohy        = %s,
                   popis_ulohy_pre_ai = %s,
                   cron_retazec       = %s,
                   email_adresata     = %s,
                   sql_text           = %s,
                   is_enabled         = %s,
                   updated_at         = NOW()
             WHERE id = %s
            """,
            (
                f["nazov_ulohy"],
                f["popis_ulohy_pre_ai"],
                f["cron_retazec"],
                f["email_adresata"],
                f["sql_text"],
                f["is_enabled"],
                int(task_id),
            ),
            fetch="none"
        )
    else:
        # INSERT novej úlohy
        db_connector.execute_query(
            """
            INSERT INTO automatizovane_ulohy(
                nazov_ulohy,
                popis_ulohy_pre_ai,
                cron_retazec,
                email_adresata,
                sql_text,
                is_enabled,
                created_at,
                updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,NOW(),NOW())
            """,
            (
                f["nazov_ulohy"],
                f["popis_ulohy_pre_ai"],
                f["cron_retazec"],
                f["email_adresata"],
                f["sql_text"],
                f["is_enabled"],
            ),
            fetch="none"
        )

    return jsonify({"ok": True})


# DELETE – zmazanie úlohy
@app.route("/api/gemini/tasks/delete", methods=["POST"])
def gemini_tasks_delete():
    body = request.get_json(silent=True) or {}
    task_id = body.get("id")
    if not task_id:
        return jsonify({"error": "missing id"}), 400

    db_connector.execute_query(
        "DELETE FROM automatizovane_ulohy WHERE id=%s",
        (int(task_id),),
        fetch="none"
    )
    return jsonify({"ok": True})


# RUN – ručné spustenie úlohy (využíva tasks.vykonaj_db_ulohu/run_task)
@app.route("/api/gemini/tasks/run", methods=["POST"])
def gemini_tasks_run():
    body = request.get_json(silent=True) or {}
    try:
        task_id = int(body.get("id") or body.get("task_id") or 0)
    except Exception:
        return jsonify({"ok": False, "message": "missing/invalid id"}), 400
    if not task_id:
        return jsonify({"ok": False, "message": "missing id"}), 400

    idem = (body.get("idempotency_key") or (str(uuid.uuid4())[:10])).strip()
    out = run_task(task_id, idempotency_key=idem, throttle_seconds=10)

    status = 200 if out.get("ok") else 409
    return jsonify(out), status
# Pridajte importy ak chýbajú
import json

# ========================= ERP API ROUTY =========================

@app.route('/api/erp/settings', methods=['GET', 'POST'])
@login_required(role=['kancelaria', 'admin'])
def api_erp_settings():
    if request.method == 'GET':
        return jsonify(office_handler._get_erp_settings())
    else:
        return jsonify(office_handler.save_erp_settings(request.json))

@app.route('/api/erp/manual-export')
@login_required(role=['kancelaria', 'admin'])
def api_erp_manual_export():
    try:
        path = office_handler.generate_erp_export_file()
        d = os.path.dirname(path)
        f = os.path.basename(path)
        return send_from_directory(d, f, as_attachment=True)
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/api/erp/manual-import', methods=['POST'])
@login_required(role=['kancelaria', 'admin'])
def api_erp_manual_import():
    """Manuálne nahratie ZASOBA.CSV z PC a spracovanie cez office_handler (Full Sync)."""
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'Žiadny súbor'}), 400

    try:
        # 1. Uložíme súbor dočasne na disk (pretože office_handler potrebuje cestu k súboru)
        # Uistite sa, že ERP_EXCHANGE_DIR je definované (malo by byť z konfigu vyššie)
        temp_path = os.path.join(ERP_EXCHANGE_DIR, 'TEMP_MANUAL_IMPORT.CSV')
        file.save(temp_path)

        print(f">>> ERP MANUAL IMPORT – start: {temp_path}")

        # 2. Zavoláme tú NOVÚ funkciu z office_handler, ktorá robí nulovanie
        result = office_handler.process_erp_import_file(temp_path)

        # 3. Zmažeme dočasný súbor
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass

        # 4. Vrátime výsledok
        if result.get('error'):
            return jsonify(result), 500
            
        return jsonify(result)

    except Exception as e:
        print(">>> ERP MANUAL IMPORT ERROR:", e)
        return jsonify({'error': str(e)}), 500

@app.route('/api/erp/status', methods=['GET'])
@login_required(role=['kancelaria', 'admin'])
def api_erp_status():
    return jsonify(office_handler.get_erp_status())


@app.route("/api/erp/process-server", methods=["POST"])
def erp_process_server():
    """
    Spracuje súbor ZASOBA.CSV zo servera cez office_handler (Full Sync).
    """
    path = os.path.join(ERP_EXCHANGE_DIR, ERP_IMPORT_FILENAME)

    if not os.path.exists(path):
        return jsonify({"error": f"Súbor {ERP_IMPORT_FILENAME} na serveri neexistuje."}), 404

    print(f">>> ERP SERVER IMPORT – start: {path}")

    try:
        # 1. Zavoláme tú NOVÚ funkciu z office_handler
        result = office_handler.process_erp_import_file(path)

        # 2. Ak import prebehol (aj keď s varovaniami), zmažeme zdrojový súbor
        if not result.get('error'):
            try:
                os.remove(path)
            except Exception as ex:
                print(f"Chyba pri mazaní súboru: {ex}")

        if result.get('error'):
            return jsonify(result), 500

        return jsonify(result)

    except Exception as e:
        print(">>> ERP SERVER IMPORT ERROR:", e)
        return jsonify({'error': str(e)}), 500

   # =================================================================
# === API: KANCELÁRIA – ERP / plánovanie / sklad / katalóg / kampane ...
# ================================================================= 
from flask import request
import office_handler


@app.route('/api/kancelaria/importCatalogBulk', methods=['POST'])
@login_required(role='kancelaria')
def api_import_catalog_bulk():
    return handle_request(office_handler.import_catalog_bulk, request.json)

@app.route('/api/kancelaria/saveRecipeMeta', methods=['POST'])
@login_required(role='kancelaria')
def api_save_recipe_meta():
    return handle_request(office_handler.save_recipe_meta, request.json)

@app.route('/api/kancelaria/getRecipeMeta')
@login_required(role='kancelaria')
def api_get_recipe_meta():
    return handle_request(office_handler.get_recipe_meta, request.args)

@app.route('/api/kancelaria/getAllRecipesForEditing')
@login_required(role='kancelaria')
def api_get_all_recipes_for_editing():
    return handle_request(office_handler.get_all_recipes_for_editing)


@app.get('/api/kancelaria/baseData')
def base_data_alias():
    from db_connector import execute_query
    def safe_query(sql, params=None, fetch='all', default=None, label=''):
        try:
            return execute_query(sql, params, fetch=fetch) or default
        except Exception as e:
            print(f'baseData {label} err:', e)
            return default

    products_rows = safe_query("""
        SELECT p.nazov_vyrobku
        FROM produkty p
        WHERE p.typ_polozky LIKE 'VÝROBOK%%'
          AND NOT EXISTS (
            SELECT 1 FROM recepty r
            WHERE TRIM(r.nazov_vyrobku) COLLATE utf8mb4_slovak_ci
                = TRIM(p.nazov_vyrobku) COLLATE utf8mb4_slovak_ci
          )
        ORDER BY p.nazov_vyrobku
    """, default=[], label='products')
    products_without_recipe = [r['nazov_vyrobku'] for r in (products_rows or [])]

    cats_rows = safe_query("""
        SELECT DISTINCT kategoria_pre_recepty AS cat
        FROM produkty
        WHERE kategoria_pre_recepty IS NOT NULL AND kategoria_pre_recepty <> ''
        ORDER BY cat
    """, default=[], label='recipe_categories')
    recipe_categories = [c['cat'] for c in (cats_rows or [])]

    has_kategoria = bool(safe_query("""
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'sklad'
          AND COLUMN_NAME  = 'kategoria'
        LIMIT 1
    """, fetch='one', default=None, label='has_kategoria'))

    if has_kategoria:
        item_types_rows = safe_query("""
            SELECT DISTINCT kategoria FROM sklad
            WHERE kategoria IS NOT NULL AND kategoria <> ''
            ORDER BY kategoria
        """, default=[], label='item_types')
        item_types = [r['kategoria'] for r in (item_types_rows or [])] or \
                     ['Mäso','Koreniny','Obaly - Črevá','Pomocný materiál']
    else:
        item_types = ['Mäso','Koreniny','Obaly - Črevá','Pomocný materiál']

    return jsonify({
        "productsWithoutRecipe": products_without_recipe,
        "recipeCategories":      recipe_categories,
        "itemTypes":             item_types
    })



# Forecast / promo / goods suggestion
# ----- 7-dňový prehľad (B2B + B2C) – jediná platná route -----
# ----- 7-dňový prehľad (B2B + B2C) – jediná platná route -----
from flask import jsonify
from datetime import date, timedelta

@app.route('/api/kancelaria/get_7_day_forecast', methods=['GET'], endpoint='kanc_7d_forecast')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_7d_forecast():
    import db_connector

    # --- pomocné ---
    def dates7():
        base = date.today()
        return [(base + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    DATES = dates7()

    def tbl_exists(t):
        r = db_connector.execute_query(
            "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s",
            (t,), fetch="one"
        )
        return bool(r and int(list(r.values())[0]) > 0)

    def cols(t):
        rows = db_connector.execute_query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s",
            (t,), fetch="all"
        ) or []
        return {x["COLUMN_NAME"] for x in rows}

    def pick(colset, *cands):
        for c in cands:
            if c and c in colset:
                return c
        return None

    def stock_disp(kg):
        try:
            v = float(kg or 0.0)
            return f"{int(v)} kg" if v.is_integer() else f"{v:.2f} kg"
        except Exception:
            return "—"

    # --- meta o produktoch ---
    PRODUCT_META = {}
    if tbl_exists("produkty"):
        cs = cols("produkty")
        name = pick(cs, "nazov_vyrobku", "nazov", "produkt", "name")
        cat  = pick(cs, "kategoria_pre_recepty", "predajna_kategoria", "kategoria", "category")
        stk  = pick(cs, "aktualny_sklad_finalny_kg", "stav_kg", "sklad_kg", "sklad", "aktualny_sklad")
        typ  = pick(cs, "typ_polozky", "typ_produktu", "typ", "product_type")
        pck  = pick(cs, "vaha_balenia_g", "vaha_g", "hmotnost_g", "balenie_g")
        rows = db_connector.execute_query(
            f"SELECT {name} AS n, COALESCE({cat},'Nezaradené') AS c, "
            f"COALESCE({stk},0) AS s, COALESCE({typ},'') AS t, COALESCE({pck},0) AS g "
            f"FROM produkty", fetch="all"
        ) or []
        for r in rows:
            n = (r.get("n") or "").strip()
            if not n: continue
            t = (r.get("t") or "").upper()
            PRODUCT_META[n] = {
                "cat": (r.get("c") or "Nezaradené") or "Nezaradené",
                "stock": float(r.get("s") or 0),
                "is_manu": bool(t.startswith("VÝROBOK") or t.startswith("VYROBOK") or t in ("PRODUKT","PRODUCT")),
                "pack_g": float(r.get("g") or 0),
            }

    # ===================== B2B (pôvodná logika) =====================
    b2b_fc = {}
    try:
        base = office_handler.get_7_day_order_forecast()
        if isinstance(base, dict):
            b2b_fc = base.get("forecast") or {}
    except Exception:
        b2b_fc = {}

    # ===================== B2C (Opravený SQL dotaz) =============================
    # Použijeme bezpečnejšiu koláciu, aby to nepadalo pri JOINoch
    COLL = "utf8mb4_general_ci" 
    
    b2c_fc = {}
    b2c_dbg = {"orders_tbl": None, "items_tbl": None, "date_used": None, "rows": 0}

    orders_tbl = None
    for t in ("b2c_objednavky", "eshop_objednavky", "b2c_orders"):
        if tbl_exists(t): orders_tbl = t; break

    items_tbl = None
    for t in ("b2c_objednavky_polozky", "eshop_objednavky_polozky", "b2c_orders_items"):
        if tbl_exists(t): items_tbl = t; break

    if orders_tbl and items_tbl:
        oc = cols(orders_tbl); ic = cols(items_tbl)
        fk   = pick(ic, "objednavka_id", "order_id")
        name = pick(ic, "nazov_vyrobku", "nazov", "produkt_nazov", "vyrobok_nazov", "product_name", "name")
        qty  = pick(ic, "mnozstvo_kg", "mnozstvo", "qty_kg", "qty", "quantity")
        unit = pick(ic, "mj", "jednotka", "unit")
        pack = pick(ic, "vaha_balenia_g", "balenie_g", "hmotnost_g", "pack_g")
        ean  = pick(ic, "ean_produktu", "ean", "ean_kod")

        # --- OPRAVA: Rozšírený zoznam dátumových stĺpcov ---
        # Pridané: pozadovany_datum_dodania, datum_objednavky
        D_O = [
            "pozadovany_datum_dodania", "datum_dodania", "delivery_date", 
            "datum_objednavky", "datum_vytvorenia",
            "datum_vyzdvihnutia", "pickup_date", "slot_date",
            "termin_vyzdvihnutia", "termin_dodania", "termin", 
            "datum", "date", "created_at", "created", "created_on"
        ]
        
        # Najprv hľadáme v hlavičke (orders), potom v položkách
        present_o = [f"o.{c}" for c in D_O if c in oc]
        
        if present_o:
            # Použijeme prvý nájdený stĺpec (priorita je podľa poradia v D_O)
            date_expr = f"DATE({present_o[0]})"
        else:
            # Fallback, ak sa nenájde nič (aby to nespadlo na 'Unknown column')
            date_expr = "CURDATE()"

        b2c_dbg.update({"orders_tbl": orders_tbl, "items_tbl": items_tbl, "date_used": date_expr})

        status = pick(oc, "stav", "status")
        where = [f"{date_expr} BETWEEN %s AND %s"]
        params = (DATES[0], DATES[-1])
        if status:
            where.append(
                f"COALESCE(CONVERT(o.{status} USING utf8mb4) COLLATE {COLL}, '') NOT IN "
                "('Zrušená','Zrusena','Zrušena','Zrušené','Cancelled')"
            )

        pack_expr = f"pol.{pack}" if pack else "p.vaha_balenia_g"
        
        # Opravený JOIN s CONVERT pre bezpečnosť kolácií
        join_prod = f"""
            LEFT JOIN produkty p ON (
                {"(p.ean IS NOT NULL AND pol."+ean+" IS NOT NULL AND CONVERT(p.ean USING utf8mb4) = CONVERT(pol."+ean+" USING utf8mb4)) OR" if ean else ""}
                (CONVERT(p.nazov_vyrobku USING utf8mb4) = CONVERT(pol.{name} USING utf8mb4))
            )
        """

        sql = f"""
            SELECT
              COALESCE(CONVERT(pol.{name} USING utf8mb4), '') AS n,
              {date_expr} AS d,
              SUM(
                CASE
                  WHEN LOWER(COALESCE(pol.{unit},'')) = 'kg' THEN COALESCE(pol.{qty},0)
                  WHEN LOWER(COALESCE(pol.{unit},'')) = 'g'  THEN COALESCE(pol.{qty},0) / 1000
                  WHEN LOWER(COALESCE(pol.{unit},'')) IN ('ks','pc','pcs')
                       THEN COALESCE(pol.{qty},0) * COALESCE({pack_expr}, 0) / 1000
                  ELSE COALESCE(pol.{qty},0)
                END
              ) AS q
            FROM {orders_tbl} o
            JOIN {items_tbl} pol ON pol.{fk} = o.id
            {join_prod}
            WHERE {" AND ".join(where)}
            GROUP BY n, d
            ORDER BY n, d
        """
        
        try:
            rows = db_connector.execute_query(sql, params, fetch="all") or []
        except Exception as e:
            print(f"B2C Forecast Error: {e}")
            rows = []

        b2c_dbg["rows"] = len(rows)

        # poskladaj forecast mapu
        idx = {}
        for r in rows:
            n = (r.get("n") or "").strip()
            d = (r.get("d") or "")
            if not n or str(d) not in DATES: continue
            q = float(r.get("q") or 0.0)

            meta = PRODUCT_META.get(n, {"cat":"Nezaradené","stock":0.0,"is_manu":True})
            cat = meta["cat"] or "Nezaradené"
            key = (cat, n)

            if key not in idx:
                item = {
                    "name": n,
                    "mj": "kg",
                    "stock_display": stock_disp(meta["stock"]),
                    "isManufacturable": bool(meta["is_manu"]),
                    "daily_needs": {dt: 0 for dt in DATES},
                }
                b2c_fc.setdefault(cat, []).append(item)
                idx[key] = item
            idx[key]["daily_needs"][str(d)] = idx[key]["daily_needs"].get(str(d), 0) + q

        for cat, arr in b2c_fc.items():
            def _total(it): return sum(float(it["daily_needs"].get(dt,0) or 0) for dt in DATES)
            arr.sort(key=lambda it: (-_total(it), it["name"]))

    # ===================== merge B2B + B2C ==========================
    def merge_two(fa, fb):
        out = {}
        for src in (fa or {}), (fb or {}):
            for cat, items in (src or {}).items():
                out.setdefault(cat, [])
                idx = {(p["name"], p.get("mj","kg")): i for i,p in enumerate(out[cat])}
                for p in items or []:
                    k = (p["name"], p.get("mj","kg"))
                    if k in idx:
                        tgt = out[cat][idx[k]]
                    else:
                        tgt = {
                            "name": p["name"],
                            "mj": p.get("mj","kg"),
                            "stock_display": p.get("stock_display","—"),
                            "isManufacturable": bool(p.get("isManufacturable",True)),
                            "daily_needs": {dt: 0 for dt in p.get("daily_needs",{}).keys() or DATES}
                        }
                        if not tgt["daily_needs"]:
                            for dt in DATES: tgt["daily_needs"][dt] = 0
                        out[cat].append(tgt); idx[k] = len(out[cat]) - 1
                    for dt, val in (p.get("daily_needs") or {}).items():
                        tgt["daily_needs"][dt] = float(tgt["daily_needs"].get(dt,0)) + float(val or 0)
                    if len(p.get("stock_display","")) > len(tgt.get("stock_display","")):
                        tgt["stock_display"] = p.get("stock_display","—")
                    tgt["isManufacturable"] = bool(tgt.get("isManufacturable",True) or p.get("isManufacturable",True))
        for cat, arr in out.items():
            def _total(it): return sum(float(v or 0) for v in it["daily_needs"].values())
            arr.sort(key=lambda it: (-_total(it), it["name"]))
        return out

    merged = merge_two(b2b_fc, b2c_fc)

    data = {
        "dates": DATES,
        "forecast": merged,
        "b2c_forecast": b2c_fc,
        "debug": {
            "b2c": b2c_dbg,
            "b2b_present": bool(b2b_fc),
        }
    }
    return jsonify(data), 200

@app.route('/api/kancelaria/get_goods_purchase_suggestion')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_get_goods_purchase_suggestion():
    return handle_request(office_handler.get_goods_purchase_suggestion)

@app.route('/api/kancelaria/get_promotions_data')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_get_promotions_data():
    return handle_request(office_handler.get_promotions_data)

@app.route('/api/kancelaria/manage_promotion_chain', methods=['POST'])
@login_required(role='kancelaria')
def kanc_manage_promotion_chain():
    return handle_request(office_handler.manage_promotion_chain, request.json)

@app.route('/api/kancelaria/save_promotion', methods=['POST'])
@login_required(role='kancelaria')
def kanc_save_promotion():
    return handle_request(office_handler.save_promotion, request.json)

@app.route('/api/kancelaria/delete_promotion', methods=['POST'])
@login_required(role='kancelaria')
def kanc_delete_promotion():
    return handle_request(office_handler.delete_promotion, request.json)

@app.route('/api/kancelaria/stock/allowed-names')
@login_required(role=('kancelaria','veduci','admin'))
def stock_allowed_names():
    return handle_request(office_handler.get_stock_allowed_names, request.args)

@app.route('/kancelaria/report/reception')
@login_required(role='kancelaria')
def reception_report_print():
    """
    HTML report: Príjem z výroby za zadané obdobie (podľa dátumu PRÍJMU).
    Používa existujúcu funkciu office_handler.get_reception_report(date_from, date_to, overhead_coeff).
    """
    date_from = request.args.get("date_from")
    date_to   = request.args.get("date_to")
    overhead  = request.args.get("overhead") or "1.15"

    if not date_from or not date_to:
        return "Chýba date_from alebo date_to (YYYY-MM-DD).", 400

    try:
        dt_from = datetime.strptime(date_from, "%Y-%m-%d")
        dt_to   = datetime.strptime(date_to, "%Y-%m-%d")
    except Exception:
        return "Nesprávny formát dátumu, používaj YYYY-MM-DD.", 400

    # Zavoláme hotovú logiku z office_handler.py:
    # def get_reception_report(date_from: str, date_to: str, overhead_coeff: float = 1.15)
    data = office_handler.get_reception_report(date_from, date_to, float(overhead))

    rows   = data.get("rows")   or []
    totals = data.get("totals") or {}
    period = data.get("period") or {}

    # Poskladáme jednoduchý HTML report – môžeš si ho neskôr prehodiť do šablóny.
    def fmt(x, nd=3):
        try:
            return f"{float(x):.{nd}f}"
        except Exception:
            return "0.000"

    html_rows = []
    for r in rows:
        html_rows.append(f"""
          <tr>
            <td>{r.get('product','')}</td>
            <td>{r.get('unit','kg')}</td>
            <td style="text-align:right;">{fmt(r.get('planned_kg'))}</td>
            <td style="text-align:right;">{fmt(r.get('real_kg'))}</td>
            <td style="text-align:right;">{fmt(r.get('yield_pct', 0.0), 2)}</td>
            <td style="text-align:right;">{fmt(r.get('unit_cost_no_overhead',0),4)} €/{r.get('unit','kg')}</td>
            <td style="text-align:right;">{fmt(r.get('unit_cost_with_overhead',0),4)} €/{r.get('unit','kg')}</td>
          </tr>
        """)

    total_row = f"""
      <tr style="font-weight:bold;background:#f3f4f6;">
        <td colspan="2">Spolu</td>
        <td style="text-align:right;">{fmt(totals.get('planned_kg',0))}</td>
        <td style="text-align:right;">{fmt(totals.get('real_kg',0))}</td>
        <td style="text-align:right;">{fmt(totals.get('yield_pct',0),2)}</td>
        <td colspan="2"></td>
      </tr>
    """

    html = f"""
    <!doctype html>
    <html lang="sk">
    <head>
      <meta charset="utf-8">
      <title>Príjem z výroby {date_from} – {date_to}</title>
      <style>
        body {{ font-family: Arial, sans-serif; font-size: 12px; }}
        table {{ border-collapse: collapse; width: 100%; }}
        th, td {{ border: 1px solid #ccc; padding: 4px 6px; }}
        th {{ background: #f3f4f6; }}
        h1 {{ font-size: 16px; margin-bottom: .5rem; }}
        .muted {{ color:#6b7280; font-size:11px; }}
        @media print {{
          button {{ display:none; }}
          body   {{ margin:0; }}
        }}
      </style>
    </head>
    <body>
      <h1>Príjem z výroby {date_from} – {date_to}</h1>
      <p class="muted">Koeficient réžií: {overhead} • Generované z modulu Kancelária &gt; Plánovanie &gt; Tlač reportov</p>

      <table>
        <thead>
          <tr>
            <th>Produkt</th>
            <th>MJ</th>
            <th>Plán (kg)</th>
            <th>Realita (kg)</th>
            <th>Výťažnosť (%)</th>
            <th>Cena/jed. bez réžií</th>
            <th>Cena/jed. s réžiami</th>
          </tr>
        </thead>
        <tbody>
          {''.join(html_rows) or '<tr><td colspan="7">V zadanom období nebol žiadny príjem.</td></tr>'}
          {total_row}
        </tbody>
      </table>

      <button onclick="window.print()">Tlačiť</button>
    </body>
    </html>
    """
    return html



@app.route('/kancelaria/report/production')
@login_required(role='kancelaria')
def production_report_print():
    date_from = request.args.get('date_from')
    date_to   = request.args.get('date_to')

    if not date_from or not date_to:
        return "Chýba date_from alebo date_to (YYYY-MM-DD).", 400

    from datetime import datetime
    try:
        dt_from = datetime.strptime(date_from, "%Y-%m-%d")
        dt_to   = datetime.strptime(date_to,   "%Y-%m-%d")
    except Exception:
        return "Nesprávny formát dátumu, používaj YYYY-MM-DD.", 400

    # použijeme existujúcu funkciu get_production_stats(period, category)
    res = office_handler.get_production_stats('month', '')  # period='month', category=''

    data   = res.get('data')        or []
    damage = res.get('damage_data') or []

    def parse_dt(val):
        if not val: return None
        if isinstance(val, datetime): return val
        try: return datetime.fromisoformat(str(val))
        except Exception:
            try: return datetime.strptime(str(val), "%Y-%m-%d %H:%M:%S")
            except Exception: return None

    def in_range(dt):
        if not dt: return False
        return dt.date() >= dt_from.date() and dt.date() <= dt_to.date()

    filtered_data   = [r for r in data   if in_range(parse_dt(r.get('datum_ukoncenia')))]
    filtered_damage = [r for r in damage if in_range(parse_dt(r.get('datum')))]

    def fmt(x, nd=2):
        try: return f"{float(x):.{nd}f}"
        except Exception: return "0"

    rows_html = []
    for r in filtered_data:
        rows_html.append(f"""
        <tr>
          <td>{r.get('datum_ukoncenia','')}</td>
          <td>{r.get('nazov_vyrobku','')}</td>
          <td style="text-align:right;">{fmt(r.get('planovane_mnozstvo_kg',0),3)}</td>
          <td style="text-align:right;">{fmt(r.get('realne_mnozstvo_kg',0),3)}</td>
          <td style="text-align:right;">{fmt(r.get('vytaznost',0),2)}</td>
          <td style="text-align:right;">{fmt(r.get('cena_bez_energii',0),4)}</td>
          <td style="text-align:right;">{fmt(r.get('cena_s_energiami',0),4)}</td>
        </tr>
        """)

    damage_html = []
    for d in filtered_damage:
        damage_html.append(f"""
        <tr>
          <td>{d.get('datum','')}</td>
          <td>{d.get('nazov_vyrobu','')}</td>
          <td>{d.get('mnozstvo','')}</td>
          <td>{d.get('pracovnik','')}</td>
          <td>{d.get('dovod','')}</td>
          <td style="text-align:right;">{fmt(d.get('naklady_skody',0),2)} €</td>
        </tr>
        """)

    html = f"""
    <!doctype html>
    <html lang="sk">
    <head>
      <meta charset="utf-8">
      <title>Prehľad výroby {date_from} – {date_to}</title>
      <style>
        body {{ font-family: Arial, sans-serif; font-size: 12px; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom:1rem; }}
        th, td {{ border:1px solid #ccc; padding:4px 6px; }}
        th {{ background:#f3f4f6; }}
        h1 {{ font-size:16px; margin-bottom:.5rem; }}
        h2 {{ font-size:14px; margin:1rem 0 .5rem; }}
        .muted {{ color:#6b7280; font-size:11px; }}
        @media print {{ button {{ display:none; }} body {{ margin:0; }} }}
      </style>
    </head>
    <body>
      <h1>Prehľad výroby {date_from} – {date_to}</h1>
      <p class="muted">Generované z modulu Kancelária &gt; Plánovanie &gt; Tlač reportov.</p>

      <h2>Výroba</h2>
      <table>
        <thead>
          <tr>
            <th>Dátum</th><th>Produkt</th><th>Plán (kg)</th><th>Realita (kg)</th>
            <th>Výťažnosť (%)</th><th>Cena/jed. bez energií</th><th>Cena/jed. s energiami</th>
          </tr>
        </thead>
        <tbody>
          {''.join(rows_html) or '<tr><td colspan="7">Žiadne dáta v danom období.</td></tr>'}
        </tbody>
      </table>

      <h2>Škody</h2>
      <table>
        <thead>
          <tr><th>Dátum</th><th>Produkt</th><th>Množstvo</th><th>Pracovník</th><th>Dôvod</th><th>Náklady</th></tr>
        </thead>
        <tbody>
          {''.join(damage_html) or '<tr><td colspan="6">Žiadne škody v danom období.</td></tr>'}
        </tbody>
      </table>

      <button onclick="window.print()">Tlačiť</button>
    </body>
    </html>
    """
    return html



# centrálne ceny a report príjmov podľa dátumu
@app.route('/api/kancelaria/receptionReport', methods=['POST'])
@login_required(role='kancelaria')
def kancelaria_reception_report():
    body = request.get_json(force=True) or {}
    return handle_request(
        office_handler.get_reception_report,
        body.get('date_from'),
        body.get('date_to'),
        body.get('overhead_coeff', 1.15)
    )

@app.route('/api/kancelaria/avgCosts', methods=['GET'])
@login_required(role='kancelaria')
def kancelaria_avg_costs():
    return handle_request(office_handler.get_avg_costs_catalog)

# Dashboard, plán, sklad
@app.route('/api/kancelaria/getDashboardData')
@login_required(role=('kancelaria','veduci','admin'))
def get_dashboard():
    return handle_request(office_handler.get_kancelaria_dashboard_data)

@app.route('/api/kancelaria/getKancelariaBaseData')
@login_required(role='kancelaria')
def get_kancelaria_base():
    return handle_request(office_handler.get_kancelaria_base_data)

@app.route('/api/kancelaria/getRawMaterialStockOverview', methods=['GET'])
@login_required(role='kancelaria')
def api_get_raw_material_stock_overview():
    # GET – žiadne request.json
    return handle_request(office_handler.get_raw_material_stock_overview)



@app.route('/api/kancelaria/stock/saveItem', methods=['POST'])
@login_required(role='kancelaria')
def api_stock_save_item():
    return handle_request(office_handler.save_stock_item, request.json)

@app.route('/api/kancelaria/getComprehensiveStockView')
@login_required(role='kancelaria')
def get_comprehensive_stock():
    return handle_request(office_handler.get_comprehensive_stock_view)

@app.route('/api/kancelaria/receiveStockItems', methods=['POST'])
@login_required(role='kancelaria')
def receive_stock():
    return handle_request(office_handler.receive_multiple_stock_items, request.json)

@app.route('/api/kancelaria/getProductionPlan')
@login_required(role=('kancelaria','veduci','admin'))
def get_plan():
    return handle_request(office_handler.calculate_production_plan)

@app.route('/api/kancelaria/createTasksFromPlan', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def create_tasks():
    return handle_request(office_handler.create_production_tasks_from_plan, request.json)


    # ===================== Calendar ==========================

@app.route('/api/kancelaria/getProductionCalendar')
@login_required(role=('kancelaria','veduci','admin'))
def get_production_calendar():
    return handle_request(office_handler.get_production_plan_calendar)





# =====================================================================
#  KALENDÁR – KONTAKTNÉ OSOBY (PROFIL)
#  /api/calendar/contacts  (GET, POST)
# =====================================================================





# =================================================================
# === SCHEDULER – spustenie spolu s app.py ========================
# =================================================================

def start_background_scheduler():
    """
    Spustí scheduler.py (BlockingScheduler) v samostatnom daemon threade.
    - používa rovnakú logiku ako `python scheduler.py`
    - ak scheduler spadne, Flask appka beží ďalej
    """
    import threading
    import traceback

    try:
        import scheduler  # súbor scheduler.py v tom istom adresári ako app.py
    except Exception as e:
        print("[SCHEDULER] Nepodarilo sa importovať scheduler.py:", e)
        return

    def _runner():
        try:
            print("[SCHEDULER] Štartujem scheduler v pozadí...")
            scheduler.main()   # BLOCKING – ale len v tomto threade
        except Exception as e:
            print("[SCHEDULER] CHYBA v scheduler.main():", e)
            traceback.print_exc()

    t = threading.Thread(target=_runner, daemon=True, name="apscheduler-thread")
    t.start()
    print("[SCHEDULER] Background thread spustený.")


# =====================================================================
#  KALENDÁR – KONTAKTNÉ OSOBY (PROFIL)
#  /api/calendar/contacts  (GET, POST)
# =====================================================================

@app.route('/api/calendar/contacts', methods=['GET'])
@login_required(role='kancelaria')
def api_calendar_contacts_list():
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
        fetch="all"
    ) or []
    return jsonify(rows)


@app.route('/api/calendar/contacts', methods=['POST'])
@login_required(role='kancelaria')
def api_calendar_contacts_save():
    """
    Vytvorenie / úprava kontaktnej osoby.

    Frontend posiela (JSON alebo form-data):
      {
        "id": 1,            # voliteľné, pri editácii
        "name": "Meno",
        "email": "x@y.z",
        "phone": "+421..."
      }

    Odpoveď:
      {"id": <ID_kontaktu>}
    """
    # podpora JSON aj form-data
    data = request.get_json(silent=True) or request.form.to_dict() or {}

    name  = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip() or None
    phone = (data.get('phone') or '').strip() or None
    raw_id = data.get('id')

    if not name:
        return jsonify({"error": "Meno kontaktnej osoby je povinné."}), 400

    contact_id: Optional[int] = None
    if raw_id not in (None, "", 0, "0"):
        try:
            contact_id = int(raw_id)
        except Exception:
            return jsonify({"error": "Neplatné ID kontaktu."}), 400

    # UPDATE existujúceho kontaktu
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
            fetch=None
        )
        return jsonify({"id": contact_id})

    # INSERT nového kontaktu
    db_connector.execute_query(
        """
        INSERT INTO calendar_contacts (name, email, phone)
        VALUES (%s, %s, %s)
        """,
        params=(name, email, phone),
        fetch=None
    )
    row = db_connector.execute_query(
        "SELECT LAST_INSERT_ID() AS id",
        fetch="one"
    ) or {}
    new_id = int(row.get("id", 0) or 0)
    return jsonify({"id": new_id})
# ===================== Enterprise Calendar – Udalosti ==========================

@app.route('/api/calendar/events', methods=['GET'])
@login_required(role='kancelaria')
def api_calendar_events_list():
    """
    Zoznam udalostí pre kalendár.

    Frontend posiela:
      GET /api/calendar/events?start=YYYY-MM-DDTHH:MM&end=YYYY-MM-DDTHH:MM
    """
    start_str = request.args.get('start')
    end_str   = request.args.get('end')

    where = ["is_deleted = 0"]
    params = []

    from datetime import datetime

    start_dt = None
    end_dt   = None

    if start_str:
        try:
            start_dt = datetime.fromisoformat(start_str)
        except Exception:
            start_dt = None
    if end_str:
        try:
            end_dt = datetime.fromisoformat(end_str)
        except Exception:
            end_dt = None

    if start_dt is not None:
        where.append("end_at >= %s")
        params.append(start_dt)
    if end_dt is not None:
        where.append("start_at <= %s")
        params.append(end_dt)

    sql = """
        SELECT
          id, title, type, start_at, end_at,
          all_day, priority, location, description, status
        FROM calendar_events
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY start_at ASC"

    rows = db_connector.execute_query(sql, tuple(params), fetch='all') or []

    events = []
    for r in rows:
        start_at = r.get('start_at')
        end_at   = r.get('end_at')
        events.append({
            "id": r["id"],
            "title": r["title"],
            "type": r.get("type") or "MEETING",
            "start": start_at.isoformat() if start_at else None,
            "end":   end_at.isoformat() if end_at else None,
            "all_day": bool(r.get("all_day")),
            "priority": (r.get("priority") or "NORMAL").upper(),
            "location": r.get("location"),
            "description": r.get("description"),
            "status": r.get("status") or EVENT_STATUS_OPEN,
        })

    return jsonify(events)


@app.route('/api/calendar/events', methods=['POST'])
@login_required(role='kancelaria')
def api_calendar_event_create_or_update():
    """
    Vytvorenie / úprava udalosti z frontendu.

    Očakávaný JSON payload (calendar.js):

    {
      "id": 123,                      # voliteľné, pri editácii
      "title": "Skuska kalendara",
      "type": "TENDER",               # MEETING / SERVICE / VACATION / ...
      "start_at": "2025-11-22T09:00",
      "end_at":   "2025-11-22T10:00",
      "all_day": false,
      "priority": "HIGH",             # LOW / NORMAL / HIGH / CRITICAL
      "location": "...",
      "description": "...",
      "status": "OPEN"|"DONE"|"CANCELLED" (voliteľné),
      "reminders": [
        {
          "channel": "EMAIL"|"SMS",
          "minutes_before": 60,
          "contact_id": 1,
          "target_email": "x@y.z",
          "target_phone": "+421..."
        },
        ...
      ]
    }
    """
    data = request.get_json(force=True) or {}

    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({"error": "Názov udalosti je povinný."}), 400

    start_val = data.get('start_at') or data.get('start')
    end_val   = data.get('end_at') or data.get('end')
    if not start_val or not end_val:
        return jsonify({"error": "Začiatok aj koniec udalosti sú povinné."}), 400

    from datetime import datetime, timedelta

    try:
        start_dt = datetime.fromisoformat(start_val)
        end_dt   = datetime.fromisoformat(end_val)
    except Exception:
        return jsonify({"error": "Neplatný formát dátumu."}), 400

    ev_type   = (data.get('type') or "MEETING").strip().upper()
    priority  = (data.get('priority') or "NORMAL").strip().upper()
    location  = (data.get('location') or '').strip() or None
    desc      = (data.get('description') or '').strip() or None
    all_day   = 1 if data.get('all_day') else 0
    status    = (data.get('status') or EVENT_STATUS_OPEN).strip().upper()
    if status not in (EVENT_STATUS_OPEN, EVENT_STATUS_DONE, EVENT_STATUS_CANCELLED):
        status = EVENT_STATUS_OPEN

    raw_id = data.get('id')
    event_id = None
    if raw_id not in (None, "", 0, "0"):
        try:
            event_id = int(raw_id)
        except Exception:
            return jsonify({"error": "Neplatné ID udalosti."}), 400

    # INSERT alebo UPDATE
    if event_id is None:
        # nový záznam
        db_connector.execute_query(
            """
            INSERT INTO calendar_events
              (title, type, start_at, end_at, all_day, priority,
               location, description, status, created_by, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            """,
            (
                title, ev_type, start_dt, end_dt, all_day, priority,
                location, desc, status,
                g.user['username'] if hasattr(g, 'user') and g.user else None
            ),
            fetch=None
        )
        row = db_connector.execute_query("SELECT LAST_INSERT_ID() AS id", fetch='one') or {}
        event_id = int(row.get('id') or 0)
    else:
        # update existujúcej udalosti
        db_connector.execute_query(
            """
            UPDATE calendar_events
               SET title=%s,
                   type=%s,
                   start_at=%s,
                   end_at=%s,
                   all_day=%s,
                   priority=%s,
                   location=%s,
                   description=%s,
                   status=%s,
                   updated_at=NOW()
             WHERE id=%s
            """,
            (
                title, ev_type, start_dt, end_dt, all_day, priority,
                location, desc, status, event_id
            ),
            fetch=None
        )

        # pri update môžeš, ak chceš, zmazať staré notifikácie:
        db_connector.execute_query(
            "DELETE FROM calendar_event_notifications WHERE event_id=%s",
            (event_id,), fetch=None
        )

       # Reminders -> naplánovanie do calendar_event_notifications

    # 1) Backward kompatibilita – ak backend dostane pole "reminders"
    #    v pôvodnom formáte, použijeme ho tak ako doteraz.
    reminders = data.get("reminders")

    # 2) Jednoduchý režim z calendar.js:
    #    notify_before + notify_channel + notify_target
    if not reminders:
        reminders = []
        try:
            notify_before = int(data.get("notify_before") or 0)
        except Exception:
            notify_before = 0

        notify_channel = (data.get("notify_channel") or "").strip().upper()
        notify_target = (data.get("notify_target") or "").strip().upper() or "CREATOR"

        if notify_before > 0 and notify_channel in ("EMAIL", "SMS", "BOTH"):
            # kontaktná osoba z formulára (calendar_contacts.id)
            raw_contact_id = data.get("contact_id")
            contact_id = None
            if raw_contact_id not in (None, "", 0, "0"):
                try:
                    contact_id = int(raw_contact_id)
                except Exception:
                    contact_id = None

            # tvorca udalosti – z internal_users
            creator_email = None
            user = session.get("user") or {}
            creator_id = user.get("id")
            if creator_id:
                try:
                    row = db_connector.execute_query(
                        "SELECT email FROM internal_users WHERE id=%s",
                        (creator_id,),
                        fetch="one",
                    ) or {}
                    creator_email = (row.get("email") or "").strip() or None
                except Exception:
                    creator_email = None

            recipients = []

            if notify_target == "CONTACT":
                # pošleme notifikáciu len kontaktnej osobe
                if contact_id:
                    recipients.append(
                        {
                            "contact_id": contact_id,
                            "target_email": None,
                            "target_phone": None,
                        }
                    )

            elif notify_target == "CREATOR":
                # pošleme notifikáciu tvorcovi udalosti (email z internal_users)
                if creator_email:
                    recipients.append(
                        {
                            "contact_id": None,
                            "target_email": creator_email,
                            "target_phone": None,
                        }
                    )

            elif notify_target == "ALL_ATTENDEES":
                # jednoduchá verzia – tvorca + kontaktná osoba
                if creator_email:
                    recipients.append(
                        {
                            "contact_id": None,
                            "target_email": creator_email,
                            "target_phone": None,
                        }
                    )
                if contact_id:
                    recipients.append(
                        {
                            "contact_id": contact_id,
                            "target_email": None,
                            "target_phone": None,
                        }
                    )

            else:
                # fallback – notifikácia tvorcovi
                if creator_email:
                    recipients.append(
                        {
                            "contact_id": None,
                            "target_email": creator_email,
                            "target_phone": None,
                        }
                    )

            # mapovanie kanálov – EMAIL / SMS / BOTH
            if notify_channel == "BOTH":
                channels = ["EMAIL", "SMS"]
            else:
                channels = [notify_channel]

            # z jednej jednoduchej voľby v UI spravíme X konkrétnych notifikácií
            for ch in channels:
                for rcpt in recipients:
                    reminders.append(
                        {
                            "channel": ch,
                            "minutes_before": notify_before,
                            "contact_id": rcpt.get("contact_id"),
                            "target_email": rcpt.get("target_email"),
                            "target_phone": rcpt.get("target_phone"),
                        }
                    )

    # 3) finálne uloženie do calendar_event_notifications
    reminders = reminders or []
    for r in reminders:
        try:
            channel = (r.get("channel") or "EMAIL").strip().upper()
            if channel not in ("EMAIL", "SMS"):
                continue

            minutes_before = int(r.get("minutes_before") or 0)
            if minutes_before < 0:
                minutes_before = 0

            contact_id = r.get("contact_id")
            if contact_id in ("", None, 0, "0"):
                contact_id = None

            target_email = (r.get("target_email") or "").strip() or None
            target_phone = (r.get("target_phone") or "").strip() or None

            planned_at = start_dt - timedelta(minutes=minutes_before)

            db_connector.execute_query(
                """
                INSERT INTO calendar_event_notifications(
                    event_id,
                    event_title, event_type,
                    event_start, event_end,
                    channel, contact_id,
                    target_email, target_phone,
                    minutes_before, planned_at,
                    status, created_at
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'PENDING',NOW())
                """,
                (
                    event_id,
                    title,
                    ev_type,
                    start_dt,
                    end_dt,
                    channel,
                    contact_id,
                    target_email,
                    target_phone,
                    minutes_before,
                    planned_at,
                ),
                fetch=None,
            )
        except Exception as e:
            print("[calendar] Nepodarilo sa uložiť reminder:", e)


    return jsonify({"id": event_id})

@app.route('/api/calendar/events/<int:event_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def api_calendar_event_delete(event_id):
    """
    Soft delete udalosti – nastaví is_deleted=1.
    Historická stopa ostáva v DB, ale neukazuje sa v kalendári.
    """
    db_connector.execute_query(
        "UPDATE calendar_events SET is_deleted=1, updated_at=NOW() WHERE id=%s",
        (event_id,), fetch=None
    )
    # notifikácie k tejto udalosti môžeš tiež deaktivovať:
    db_connector.execute_query(
        "UPDATE calendar_event_notifications SET status='CANCELLED' WHERE event_id=%s AND status='PENDING'",
        (event_id,), fetch=None
    )
    return jsonify({"message": "Udalosť vymazaná."})
@app.route('/api/calendar/notifications/history', methods=['GET'])
@login_required(role='kancelaria')
def api_calendar_notifications_history():
    """
    Jednoduchý report histórie notifikácií.

    Query parametre (voliteľné):
      date_from: YYYY-MM-DD
      date_to:   YYYY-MM-DD
      status:    PENDING|SENT|FAILED
      channel:   EMAIL|SMS
    """
    date_from = request.args.get('date_from')
    date_to   = request.args.get('date_to')
    status    = request.args.get('status')
    channel   = request.args.get('channel')

    where = []
    params = []

    from datetime import datetime, timedelta

    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
            where.append("n.planned_at >= %s")
            params.append(df)
        except Exception:
            pass
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to) + timedelta(days=1)
            where.append("n.planned_at < %s")
            params.append(dt)
        except Exception:
            pass

    if status:
        where.append("n.status = %s")
        params.append(status.upper())

    if channel:
        where.append("n.channel = %s")
        params.append(channel.upper())

    sql = """
        SELECT
            n.id,
            n.event_id,
            n.event_title,
            n.event_type,
            n.channel,
            n.planned_at,
            n.status,
            n.sent_at,
            n.target_email,
            n.target_phone,
            n.error_message,
            c.name  AS contact_name
        FROM calendar_event_notifications n
        LEFT JOIN calendar_contacts c ON c.id = n.contact_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY n.planned_at DESC, n.id DESC LIMIT 500"

    rows = db_connector.execute_query(sql, tuple(params), fetch='all') or []
    return jsonify(rows)
# niekde pri ostatných kalendárových routach
@app.route('/api/calendar/events/status', methods=['POST'])
@login_required(role='kancelaria')
def api_calendar_event_status():
    """
    Zmena stavu udalosti (OPEN / DONE / CANCELLED).
    Udalosť sa NEMAŽE, len sa jej upraví status.
    """
    data = request.get_json(force=True) or {}
    raw_id = data.get('id')
    status = (data.get('status') or '').upper()

    if status not in ('OPEN', 'DONE', 'CANCELLED'):
        return jsonify({"error": "Neplatný stav udalosti."}), 400

    try:
        ev_id = int(raw_id)
    except (TypeError, ValueError):
        return jsonify({"error": "Neplatné ID udalosti."}), 400

    for ev in CAL_EVENTS_MEMORY:
        if int(ev.get('id')) == ev_id:
            ev['status'] = status
            break
    else:
        return jsonify({"error": "Udalosť sa nenašla."}), 404

    return jsonify({"ok": True})

# =========================== KANCELÁRIA – PLÁNOVANIE VÝROBY =============================


@app.route('/api/kancelaria/getPurchaseSuggestions')
@login_required(role='kancelaria')
def get_suggestions():
    return handle_request(office_handler.get_purchase_suggestions)

@app.route('/api/kancelaria/getProductionStats', methods=['POST'])
@login_required(role='kancelaria')
def get_stats():
    return handle_request(office_handler.get_production_stats, request.json.get('period'), request.json.get('category'))

# stock (produkty)

@app.route('/api/kancelaria/stock/receiveProduction', methods=['POST'])
@login_required(role='kancelaria')
def receive_production_stock_route():
    return handle_request(office_handler.receive_production_stock, request.json)

@app.route('/api/kancelaria/stock/createProductionItem', methods=['POST'])
@login_required(role='kancelaria')
def create_production_item_route():
    return handle_request(office_handler.create_production_item, request.json)

@app.route('/api/kancelaria/stock/updateProductionItemQty', methods=['POST'])
@login_required(role='kancelaria')
def update_production_item_qty_route():
    return handle_request(office_handler.update_production_item_qty, request.json)

@app.route('/api/kancelaria/stock/deleteProductionItem', methods=['POST'])
@login_required(role='kancelaria')
def delete_production_item_route():
    return handle_request(office_handler.delete_production_item, request.json)

# Dodávatelia (CRUD)
@app.route('/api/kancelaria/suppliers', methods=['GET'])
@login_required(role='kancelaria')
def suppliers_list():
    category = request.args.get('category')
    return handle_request(office_handler.list_suppliers, category)

@app.route('/api/kancelaria/suppliers', methods=['POST'])
@login_required(role='kancelaria')
def suppliers_create():
    return handle_request(office_handler.create_supplier, request.json)

@app.route('/api/kancelaria/suppliers/<int:supplier_id>', methods=['PUT'])
@login_required(role='kancelaria')
def suppliers_update(supplier_id):
    data = request.json or {}
    data['id'] = supplier_id
    return handle_request(office_handler.update_supplier, data)

@app.route('/api/kancelaria/suppliers/<int:supplier_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def suppliers_delete(supplier_id):
    return handle_request(office_handler.delete_supplier, supplier_id)

@app.route('/api/kancelaria/addNewStockItem', methods=['POST'])
@login_required(role='kancelaria')
def add_stock_item():
    return handle_request(office_handler.add_new_stock_item, request.json)

@app.route('/api/kancelaria/getProductsForMinStock')
@login_required(role='kancelaria')
def get_products_min_stock():
    return handle_request(office_handler.get_products_for_min_stock)

@app.route('/api/kancelaria/updateMinStockLevels', methods=['POST'])
@login_required(role='kancelaria')
def update_min_stock():
    return handle_request(office_handler.update_min_stock_levels, request.json)

# Katalóg / Recepty
@app.route('/api/kancelaria/getCatalogManagementData')
@login_required(role='kancelaria')
def get_catalog_data():
    return handle_request(office_handler.get_catalog_management_data)

@app.route('/api/kancelaria/addCatalogItem', methods=['POST'])
@login_required(role='kancelaria')
def add_catalog_item():
    return handle_request(office_handler.add_catalog_item, request.json)

@app.route('/api/kancelaria/updateCatalogItem', methods=['POST'])
@login_required(role='kancelaria')
def update_catalog_item_route():
    return handle_request(office_handler.update_catalog_item, request.json)

@app.route('/api/kancelaria/deleteCatalogItem', methods=['POST'])
@login_required(role='kancelaria')
def delete_catalog_item_route():
    return handle_request(office_handler.delete_catalog_item, request.json)

@app.route('/api/kancelaria/addNewRecipe', methods=['POST'])
@login_required(role='kancelaria')
def add_recipe():
    return handle_request(office_handler.add_new_recipe, request.json)

@app.route('/api/kancelaria/getAllRecipes')
@login_required(role='kancelaria')
def get_recipes():
    return handle_request(office_handler.get_all_recipes_for_editing)

@app.route('/api/kancelaria/getRecipeDetails', methods=['POST'])
@login_required(role='kancelaria')
def get_recipe_details():
    return handle_request(office_handler.get_recipe_details, request.json.get('productName'))

@app.route('/api/kancelaria/updateRecipe', methods=['POST'])
@login_required(role='kancelaria')
def update_recipe():
    return handle_request(office_handler.update_recipe, request.json)

@app.route('/api/kancelaria/deleteRecipe', methods=['POST'])
@login_required(role='kancelaria')
def delete_recipe():
    return handle_request(office_handler.delete_recipe, request.json.get('productName'))

@app.route('/api/kancelaria/getSlicingManagementData')
@login_required(role='kancelaria')
def get_slicing_data():
    return handle_request(office_handler.get_slicing_management_data)

@app.route('/api/kancelaria/linkSlicedProduct', methods=['POST'])
@login_required(role='kancelaria')
def link_sliced():
    return handle_request(office_handler.link_sliced_product, request.json)

@app.route('/api/kancelaria/createAndLinkSlicedProduct', methods=['POST'])
@login_required(role='kancelaria')
def create_and_link_sliced():
    return handle_request(office_handler.create_and_link_sliced_product, request.json)

# =========================== KANCELÁRIA – B2B =============================
@app.route('/api/kancelaria/b2b/getPendingB2BRegistrations')
@login_required(role='kancelaria')
def kanc_get_pending_b2b():
    return handle_request(b2b_handler.get_pending_b2b_registrations)

@app.route('/api/kancelaria/approveB2BRegistration', methods=['POST'])
@login_required(role='kancelaria')
def kanc_approve_b2b():
    return handle_request(b2b_handler.approve_b2b_registration, request.json)

@app.route('/api/kancelaria/rejectB2BRegistration', methods=['POST'])
@login_required(role='kancelaria')
def kanc_reject_b2b():
    return handle_request(b2b_handler.reject_b2b_registration, request.json)

@app.route('/api/kancelaria/b2b/getCustomersAndPricelists')
@login_required(role=('kancelaria','veduci','admin'))
def get_b2b_customers_pricelists():
    return handle_request(b2b_handler.get_customers_and_pricelists)

@app.route('/api/kancelaria/b2b/updateCustomer', methods=['POST'])
@login_required(role='kancelaria')
def update_b2b_customer():
    return handle_request(b2b_handler.update_customer_details, request.json)

@app.route('/api/kancelaria/b2b/getPricelistsAndProducts')
@login_required(role=('kancelaria','veduci','admin'))
def get_b2b_pricelists_products():
    return handle_request(b2b_handler.get_pricelists_and_products)

@app.route('/api/kancelaria/b2b/createPricelist', methods=['POST'])
@login_required(role='kancelaria')
def create_b2b_pricelist():
    return handle_request(b2b_handler.create_pricelist, request.json)

@app.route('/api/kancelaria/b2b/getPricelistDetails', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def get_b2b_pricelist_details():
    return handle_request(b2b_handler.get_pricelist_details, request.json)

@app.route('/api/kancelaria/b2b/updatePricelist', methods=['POST'])
@login_required(role='kancelaria')
def update_b2b_pricelist():
    return handle_request(b2b_handler.update_pricelist, request.json)

@app.route('/api/kancelaria/b2b/update_pricelist', methods=['POST'])
@login_required(role='kancelaria')
def update_pricelist_alias():
    return handle_request(b2b_handler.update_pricelist, request.json)

@app.route('/api/kancelaria/b2b/getAnnouncement')
@login_required(role='kancelaria')
def get_b2b_announcement():
    return handle_request(b2b_handler.get_announcement)

@app.route('/api/kancelaria/b2b/saveAnnouncement', methods=['POST'])
@login_required(role='kancelaria')
def save_b2b_announcement():
    return handle_request(b2b_handler.save_announcement, request.json)

@app.route('/api/kancelaria/b2b/getAllOrders', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def get_all_b2b_orders_admin():
    return handle_request(b2b_handler.get_all_b2b_orders, request.json)

@app.route('/api/kancelaria/b2b/get_order_details/<int:order_id>')
@login_required(role='kancelaria')
def get_b2b_order_details_route(order_id):
    return handle_request(b2b_handler.get_b2b_order_details, {'id': order_id})

@app.route('/api/kancelaria/b2b/print_order_pdf/<int:order_id>')
@login_required(role=('kancelaria','veduci','admin'))
def print_b2b_order_pdf_route(order_id):
    order_data = b2b_handler.get_b2b_order_details({'id': order_id})
    if not order_data or 'error' in order_data:
        return make_response(f"<h1>Chyba: Objednávka s ID {order_id} nebola nájdená.</h1>", 404)
    
    # ZMENA: Opäť prijmeme 3 hodnoty a CSV ignorujeme, lebo tu chceme len PDF
    pdf_content, _, _ = pdf_generator.create_order_files(order_data)
    
    response = make_response(pdf_content)
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = f"inline; filename=objednavka_{order_data.get('order_number', order_id)}.pdf"
    return response

# ---- B2B KOMUNIKÁCIA (KANCELÁRIA)
@app.get('/api/kancelaria/b2b/messages')
@login_required(role='kancelaria')
def api_kanc_b2b_messages():
    return handle_request(b2b_handler.admin_messages_list, request.args)

@app.get('/api/kancelaria/b2b/messages/unread')
@login_required(role='kancelaria')
def api_kanc_b2b_messages_unread():
    return handle_request(b2b_handler.admin_messages_unread_count)

@app.post('/api/kancelaria/b2b/messages/mark-read')
@login_required(role='kancelaria')
def api_kanc_b2b_messages_mark():
    return handle_request(b2b_handler.admin_messages_mark_read, request.json or {})

@app.post('/api/kancelaria/b2b/messages/reply')
@login_required(role='kancelaria')
def api_kanc_b2b_messages_reply():
    # multipart/form-data kvôli prílohe
    return handle_request(b2b_handler.admin_messages_reply, request)

# voliteľné: download prílohy pre adminov
@app.get('/api/kancelaria/b2b/messages/attachment/<int:msg_id>')
@login_required(role='kancelaria')
def api_kanc_b2b_messages_attachment(msg_id):
    row = db_connector.execute_query("SELECT attachment_path, attachment_filename FROM b2b_messages WHERE id=%s", (msg_id,), fetch="one")
    if not row or not row.get('attachment_path') or not os.path.isfile(row['attachment_path']):
        return jsonify({'error':'Príloha nenájdená.'}), 404
    directory = os.path.dirname(row['attachment_path'])
    fname = os.path.basename(row['attachment_path'])
    return send_from_directory(directory, fname, as_attachment=True, download_name=row.get('attachment_filename') or fname)



# Pomocník: zistí, či tabuľka obsahuje stĺpec (bez pádu na iných DB)
def _table_has_col(table: str, col: str) -> bool:
    try:
        rows = db_connector.execute_query(f"SHOW COLUMNS FROM `{table}` LIKE %s", (col,))
        return bool(rows)
    except Exception:
        return False

def _table_exists(table: str) -> bool:
    try:
        rows = db_connector.execute_query("SHOW TABLES LIKE %s", (table,))
        return bool(rows)
    except Exception:
        return False
# ---------------------------
#  B2B – ZÁKAZNÍK → CENNÍKY
# ---------------------------

def _read_customers():
    """
    Vráti základný zoznam B2B zákazníkov z najpravdepodobnejšej tabuľky.
    Preferuje: b2b_zakaznici -> b2b_customers -> fallback z objednávok.
    """
    if _table_exists('b2b_zakaznici'):
        q = "SELECT id, nazov_firmy AS name, email, ico FROM b2b_zakaznici ORDER BY nazov_firmy LIMIT 1000"
        rows = db_connector.execute_query(q) or []
        return [{'id': r['id'], 'name': r.get('name',''), 'email': r.get('email',''), 'ico': r.get('ico','')} for r in rows]

    if _table_exists('b2b_customers'):
        q = "SELECT id, name, email, ico FROM b2b_customers ORDER BY name LIMIT 1000"
        rows = db_connector.execute_query(q) or []
        return [{'id': r['id'], 'name': r.get('name',''), 'email': r.get('email',''), 'ico': r.get('ico','')} for r in rows]

    # fallback z objednávok
    if _table_exists('b2b_objednavky'):
        q = ("SELECT DISTINCT odberatel AS name FROM b2b_objednavky "
             "WHERE odberatel IS NOT NULL AND odberatel<>'' ORDER BY odberatel LIMIT 1000")
        rows = db_connector.execute_query(q) or []
        out, i = [], 1
        for r in rows:
            out.append({'id': i, 'name': r.get('name',''), 'email': '', 'ico': ''})
            i += 1
        return out

    return []

def _read_pricelists_for_customer(customer_id):
    """
    Pre odberateľa vráti zoznam cenníkov: [{id,name, items:[{ean,price}]}]
    Podporuje viac bežných schém:
      - b2b_pricelists (id, customer_id, name) + b2b_pricelist_items (pricelist_id, ean, price)
      - b2b_cenniky (id, zakaznik_id, nazov) + b2b_cennik_polozky (cennik_id, ean, cena_bez_dph)
      - ak nič z vyššieho neexistuje → prázdny zoznam (NIE default)
    """
    cid = str(customer_id)

    # schéma 1
    if _table_exists('b2b_pricelists') and _table_exists('b2b_pricelist_items'):
        pls = db_connector.execute_query(
            "SELECT id, name FROM b2b_pricelists WHERE customer_id=%s ORDER BY name",
            (cid,)
        ) or []
        out = []
        for p in pls:
            items = db_connector.execute_query(
                "SELECT ean, price FROM b2b_pricelist_items WHERE pricelist_id=%s",
                (p['id'],)
            ) or []
            out.append({'id': p['id'], 'name': p['name'], 'items': [{'ean': i['ean'], 'price': float(i.get('price',0))} for i in items]})
        return out

    # schéma 2
    if _table_exists('b2b_cenniky') and _table_exists('b2b_cennik_polozky'):
        pls = db_connector.execute_query(
            "SELECT id, nazov AS name FROM b2b_cenniky WHERE zakaznik_id=%s ORDER BY nazov",
            (cid,)
        ) or []
        out = []
        for p in pls:
            items = db_connector.execute_query(
                "SELECT ean, cena_bez_dph AS price FROM b2b_cennik_polozky WHERE cennik_id=%s",
                (p['id'],)
            ) or []
            out.append({'id': p['id'], 'name': p['name'], 'items': [{'ean': i['ean'], 'price': float(i.get('price',0))} for i in items]})
        return out

    # nič – nech FE ukáže „bez cenníkov“
    return []
# Fallback: načítaj „default“ cenník z B2C cenníka (ean, price)
def _default_pricelist_items_from_b2c():
    items = []
    if not _table_exists('b2c_cennik_polozky'):
        return items
    try:
        # preferuj stĺpec ean_produktu, inak ean
        col = 'ean_produktu' if _table_has_col('b2c_cennik_polozky', 'ean_produktu') else 'ean'
        rows = db_connector.execute_query(
            f"SELECT {col} AS ean, cena_bez_dph AS price FROM b2c_cennik_polozky"
        ) or []
        for r in rows:
            ean = (r.get('ean') or '').strip()
            price = float(r.get('price') or 0)
            if ean:
                items.append({'ean': ean, 'price': price})
    except Exception:
        pass
    return items

# Skús načítať B2B zákazníkov – postupne viac zdrojov, nech to nikdy nepadá
def _fetch_b2b_customers():
    customers = []

    # 1) Ak máš dedikovanú tabuľku B2B zákazníkov
    if _table_exists('b2b_zakaznici'):
        try:
            rows = db_connector.execute_query(
                "SELECT id, nazov_firmy AS name, email, ico FROM b2b_zakaznici ORDER BY nazov_firmy LIMIT 500"
            ) or []
            for r in rows:
                customers.append({
                    'id': r.get('id'),
                    'name': r.get('name') or '',
                    'email': r.get('email') or '',
                    'ico': r.get('ico') or ''
                })
        except Exception:
            pass

    # 2) Fallback: vyrob zoznam z existujúcich B2B objednávok (distinct odberateľ)
    if not customers and _table_exists('b2b_objednavky'):
        try:
            rows = db_connector.execute_query(
                "SELECT DISTINCT odberatel AS name FROM b2b_objednavky "
                "WHERE odberatel IS NOT NULL AND odberatel<>'' "
                "ORDER BY odberatel LIMIT 500"
            ) or []
            i = 1
            for r in rows:
                customers.append({
                    'id': i,
                    'name': r.get('name') or '',
                    'email': '',
                    'ico': ''
                })
                i += 1
        except Exception:
            pass

    # 3) Posledný fallback – ak nič nemáme, vráť prázdny zoznam
    return [c for c in customers if (c.get('name') or '').strip()]



# ============================================================================
# 1) B2C – ZRUŠIŤ OBJEDNÁVKU
#    POST /api/kancelaria/b2c/cancel_order
#    body: { order_id: int, reason: str }
# ============================================================================
@app.post('/api/kancelaria/b2c/cancel_order')
@login_required(role=('kancelaria','veduci','admin'))
def b2c_cancel_order():
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    reason   = (data.get('reason') or '').strip()
    if not order_id:
        return jsonify({'error': 'Chýba order_id.'}), 400

    # ak je v DB stĺpec so zrušením/dôvodom, ulož aj ten – inak iba stav
    try:
        if _table_has_col('b2c_objednavky', 'dovod_zrusenia'):
            db_connector.execute_query(
                "UPDATE b2c_objednavky SET stav='Zrušená', dovod_zrusenia=%s WHERE id=%s",
                (reason or None, order_id), fetch='none'
            )
        elif _table_has_col('b2c_objednavky', 'zrusenie_dovod'):
            db_connector.execute_query(
                "UPDATE b2c_objednavky SET stav='Zrušená', zrusenie_dovod=%s WHERE id=%s",
                (reason or None, order_id), fetch='none'
            )
        else:
            db_connector.execute_query(
                "UPDATE b2c_objednavky SET stav='Zrušená' WHERE id=%s",
                (order_id,), fetch='none'
            )
    except Exception as e:
        return jsonify({'error': f'Nepodarilo sa zmeniť stav: {e}'}), 500

    # voliteľne: ak máš notifikačné handler-y na zrušenie, môžeš ich ticho skúsiť
    # try: db_connector.execute_query(... alebo volanie mail/sms handlera ...)
    # except: pass

    return jsonify({'message': 'Objednávka zrušená.', 'order_id': order_id})


# ============================================================================
# 2) B2B – UPRAVIŤ OBJEDNÁVKU
#    POST /api/kancelaria/b2b/update_order
#    body: { order_id: int, items: [{ean,name,quantity,unit,cena_bez_dph}] }
#    stratégia: delete-all → insert (jednoduché a robustné)
# ============================================================================
@app.post('/api/kancelaria/b2b/update_order')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_update_order():
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    items    = data.get('items') or []
    if not order_id:
        return jsonify({'error': 'Chýba order_id.'}), 400
    if not isinstance(items, list) or not items:
        return jsonify({'error': 'Pridaj aspoň jednu položku.'}), 400

    try:
        # 1) Vymaž existujúce položky
        db_connector.execute_query(
            "DELETE FROM b2b_objednavky_polozky WHERE objednavka_id=%s",
            (order_id,), fetch='none'
        )
        # 2) Vlož nové
        for it in items:
            ean  = (it.get('ean')  or '').strip()
            name = (it.get('name') or it.get('nazov') or '').strip()
            qty  = float(it.get('quantity') or it.get('mnozstvo') or 0)
            unit = (it.get('unit') or it.get('mj') or 'ks').strip()
            price= float(it.get('cena_bez_dph') or 0)
            if not (ean and name and qty>0):
                continue
            db_connector.execute_query("""
                INSERT INTO b2b_objednavky_polozky
                  (objednavka_id, ean, nazov_vyrobku, mnozstvo, mj, cena_bez_dph)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (order_id, ean, name, qty, unit, price), fetch='none')

        # (voliteľné) prepočítaj predpokladanú sumu, ak máš taký stĺpec
        if _table_has_col('b2b_objednavky', 'predpokladana_suma'):
            row = db_connector.execute_query("""
                SELECT COALESCE(SUM(cena_bez_dph * mnozstvo),0) AS s
                FROM b2b_objednavky_polozky WHERE objednavka_id=%s
            """, (order_id,), fetch='one') or {}
            db_connector.execute_query(
                "UPDATE b2b_objednavky SET predpokladana_suma=%s WHERE id=%s",
                (row.get('s',0), order_id), fetch='none'
            )

    except Exception as e:
        return jsonify({'error': f'Chyba pri ukladaní položiek: {e}'}), 500

    return jsonify({'message': 'Objednávka upravená.', 'order_id': order_id})


# ============================================================================
# 3) B2B – ODOSLAŤ POTVRDENIE OBJEDNÁVKY (+ CSV pre expedíciu)
#    POST /api/kancelaria/b2b/notify_order
#    body: { order_id: int }
#    Poznámka: tu iba zostrojíme údaje a „best effort“ zavoláme mailer, ak ho máš.
# app.py (Pridajte k B2B Kancelária endpointom)

@app.route('/api/kancelaria/b2b/getRouteTemplates')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_get_route_templates():
    return handle_request(b2b_handler.get_route_templates)

@app.route('/api/kancelaria/b2b/saveRouteTemplate', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def b2b_save_route_template():
    return handle_request(b2b_handler.save_route_template, request.json)

@app.route('/api/kancelaria/b2b/deleteRouteTemplate', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def b2b_delete_route_template():
    return handle_request(b2b_handler.delete_route_template, request.json)# ============================================================================



@app.route('/api/b2b/messages/attachment', methods=['POST'])
def b2b_messages_attachment():
    data = request.get_json(silent=True) or {}
    return jsonify(b2b_handler.portal_message_attachment(data))

@app.route('/api/kancelaria/b2b/getDailySummary', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def b2b_get_daily_summary():
    return handle_request(b2b_handler.get_daily_items_summary, request.json)

@app.post('/api/kancelaria/b2b/notify_order')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_notify_order():
    data = request.get_json(silent=True) or {}
    order_id = data.get('order_id')
    if not order_id:
        return jsonify({'error':'Chýba order_id.'}), 400

    try:
        order = db_connector.execute_query("""
            SELECT id, COALESCE(cislo_objednavky,id) AS cislo, odberatel, pozadovany_datum_dodania, email
            FROM b2b_objednavky WHERE id=%s
        """, (order_id,), fetch='one') or {}
        items = db_connector.execute_query("""
            SELECT ean, nazov_vyrobku, mnozstvo, mj, cena_bez_dph
            FROM b2b_objednavky_polozky WHERE objednavka_id=%s
        """, (order_id,), fetch='all') or []

        # CSV ako príloha (text)
        headers = ['order','ean','nazov','mnozstvo','mj','cena_bez_dph']
        rows = [headers] + [[order.get('cislo',''), it['ean'], it['nazov_vyrobku'], it['mnozstvo'], it['mj'], it['cena_bez_dph']] for it in items]
        csv_text = '\n'.join(';'.join(map(lambda x: str(x).replace(';',','), r)) for r in rows)

        # Ak máš interný mailer, môžeš ho zavolať:
        # try:
        #     from mail_handler import send_b2b_confirmation
        #     send_b2b_confirmation(order, items, csv_text)  # implementácia podľa tvojho mailera
        # except Exception:
        #     pass

        # Alebo aspoň zaloguj/vráť CSV späť klientovi (FE to aj tak ignoruje na pozadí)
        return jsonify({
            'message': 'Potvrdenie pripravené (odoslanie je voliteľné).',
            'order_id': order_id,
            'csv_len': len(csv_text)
            # ak chceš debug: 'csv': csv_text
        })
    except Exception as e:
        # FE to volá ako best effort a chyby ignoruje – nech sa to nehroutí
        return jsonify({'error': f'notify zlyhalo: {e}'}), 500

# ----------------------------------------------------------------------------
# 1) MASTER: Zákazníci + ich cenníky (ideálne používať túto jednu cestu)
# ----------------------------------------------------------------------------
@app.get('/api/kancelaria/b2b/getCustomersAndPricelists')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_get_customers_and_pricelists():
    customers = _fetch_b2b_customers()

    # pripni ku každému aspoň default cenník (z B2C cenníka), ak B2B cenníky nemáš
    default_items = _default_pricelist_items_from_b2c()
    enriched = []
    for c in customers:
        enriched.append({
            'id': c.get('id'),
            'name': c.get('name') or '',
            'email': c.get('email') or '',
            'ico': c.get('ico') or '',
            'pricelists': [
                {
                    'id': 'default',
                    'name': 'Default',
                    'items': default_items  # [{ean, price}, ...]
                }
            ]
        })

    return jsonify({'customers': enriched})

# ----------------------------------------------------------------------------
# 3) Alias: cenníky + produkty (kompatibilita s FE fallbackom)
# ----------------------------------------------------------------------------
@app.get('/api/kancelaria/b2b/get_pricelists')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_get_pricelists():
    customer_id = request.args.get('customer_id')
    if not customer_id:
        return jsonify({'error':'chýba customer_id'}), 400
    pls = _read_pricelists_for_customer(customer_id)
    return jsonify(pls)

@app.get('/api/kancelaria/b2b/get_pricelists_and_products')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_get_pricelists_and_products():
    # kompatibilitný alias – vrátime to isté čo get_pricelists, iba zabalené do objektu
    customer_id = request.args.get('customer_id')
    if not customer_id:
        return jsonify({'error':'chýba customer_id'}), 400
    pls = _read_pricelists_for_customer(customer_id)
    return jsonify({'pricelists': pls})
@app.get('/api/kancelaria/b2b/order-pdf')
@login_required(role=('kancelaria','veduci','admin'))
def b2b_order_pdf_alias():
    order_id = request.args.get('order_id','').strip()
    if not order_id:
        return jsonify({'error':'chýba order_id'}), 400

    # ak je číslo → rovno presmeruj
    if order_id.isdigit():
        return redirect(f"/api/kancelaria/b2b/print_order_pdf/{order_id}", code=302)

    # ak je to textový kód → nájdi vnútorné ID
    try:
        row = db_connector.execute_query(
            "SELECT id FROM b2b_objednavky WHERE cislo_objednavky=%s",
            (order_id,), fetch='one'
        )
        if row and row.get('id'):
            return redirect(f"/api/kancelaria/b2b/print_order_pdf/{row['id']}", code=302)
    except Exception as e:
        return jsonify({'error': f'lookup zlyhal: {e}'}), 500

    return jsonify({'error':'Objednávku sa nepodarilo nájsť.'}), 404

# =========================== KANCELÁRIA – rozrábka =============================
# --- KANCELÁRIA / SKLAD / ROZRÁBKA ---

@app.route('/api/kancelaria/stock/rozrabka/status')
@login_required(role='kancelaria')
def api_rozrabka_status():
    return jsonify(office_handler.get_rozrabka_import_status())

@app.route('/api/kancelaria/stock/rozrabka/process', methods=['POST'])
@login_required(role='kancelaria')
def api_rozrabka_process():
    return handle_request(office_handler.process_rozrabka_import)

@app.route('/api/kancelaria/stock/rozrabka/manual-import', methods=['POST'])
@login_required(role='kancelaria')
def api_rozrabka_manual():
    import uuid
    import os
    
    file = request.files.get('file')
    if not file: 
        return jsonify({'error': 'Chýba súbor.'}), 400
    
    # 1. Zabezpečenie existencie adresára
    # Použije globálnu premennú ERP_EXCHANGE_DIR alebo default
    exchange_dir = os.getenv("ERP_EXCHANGE_DIR", "/var/app/data/erp_exchange")
    if not os.path.isabs(exchange_dir):
        exchange_dir = os.path.join(app.root_path, exchange_dir)
        
    if not os.path.exists(exchange_dir):
        try:
            os.makedirs(exchange_dir, exist_ok=True)
        except Exception as e:
            return jsonify({'error': f'Nepodarilo sa vytvoriť adresár: {str(e)}'}), 500
    
    # 2. Uloženie súboru
    temp_filename = f"TEMP_ROZRABKA_{uuid.uuid4().hex}.CSV"
    temp_path = os.path.join(exchange_dir, temp_filename)
    
    try:
        file.save(temp_path)
        
        # 3. Spracovanie
        print(f"Spúšťam manuálny import rozrábky: {temp_path}")
        res = office_handler.process_rozrabka_manual_import(temp_path)
        
        # 4. Upratanie
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        if res.get("error"):
            print(f"Chyba pri spracovaní: {res.get('error')}")
            return jsonify(res), 400
            
        return jsonify(res)
        
    except Exception as e:
        import traceback
        traceback.print_exc() # Vypíše chybu do konzoly servera
        return jsonify({'error': f'Interná chyba servera: {str(e)}'}), 500

@app.route('/api/kancelaria/stock/rozrabka/history')
@login_required(role='kancelaria')
def api_rozrabka_history():
    return handle_request(office_handler.get_rozrabka_history_list)

@app.route('/api/kancelaria/stock/rozrabka/print/<path:import_ref>')
@login_required(role='kancelaria')
def api_rozrabka_print(import_ref):
    data = office_handler.get_rozrabka_pdf_data(import_ref)
    if not data: return "Záznam sa nenašiel", 404
    
    # Jednoduché HTML pre PDF tlač
    html = f"""
    <!doctype html><html><head><meta charset="utf-8">
    <style>body{{font-family:Arial;font-size:12px}} table{{width:100%;border-collapse:collapse;margin-top:20px}} th,td{{border:1px solid #ccc;padding:6px}} th{{background:#eee}} .tr{{text-align:right}} h1{{font-size:18px}}</style>
    </head><body>
    <h1>{data['title']}</h1>
    <p><strong>Dátum príjmu:</strong> {data['date']} &nbsp;|&nbsp; <strong>Sklad:</strong> Výrobný sklad (Rozrábka)</p>
    <table>
        <thead><tr><th>Položka</th><th class="tr">Množstvo (kg)</th><th class="tr">Cena (€)</th><th class="tr">Spolu (€)</th></tr></thead>
        <tbody>
    """
    for item in data['items']:
        val = float(item['mnozstvo']) * float(item['cena'] or 0)
        html += f"<tr><td>{item['nazov']}</td><td class='tr'>{float(item['mnozstvo']):.3f}</td><td class='tr'>{float(item['cena'] or 0):.3f}</td><td class='tr'>{val:.2f}</td></tr>"
    html += f"""
        </tbody>
        <tfoot><tr style="font-weight:bold;background:#f9f9f9;"><td>SPOLU</td><td class="tr">{data['total_kg']:.3f}</td><td></td><td class="tr">{data['total_eur']:.2f}</td></tr></tfoot>
    </table>
    <br><p>Prevzal: ...........................................</p>
    <script>window.print()</script></body></html>
    """
    return make_response(html)
# =========================== KANCELÁRIA – B2C =============================
# POZOR: B2C ADMIN endpointy rieši výlučne blueprint `kancelaria_b2c_api`.
# TU zámerne nenechávame duplicitné /api/kancelaria/b2c/* volania na office_handler,
# aby sa neprepisovali URL a fungoval detail, finálna suma a pripisovanie bodov.

# CENNÍK – tieto (nec kolidujúce) nechávame, ak ich používaš v kancelárii:
@app.route('/api/kancelaria/b2c/get_pricelist_admin')
@login_required(role='kancelaria')
def get_b2c_pricelist_admin():
    return handle_request(office_handler.get_b2c_pricelist_for_admin)

@app.route('/api/kancelaria/b2c/update_pricelist', methods=['POST'])
@login_required(role='kancelaria')
def update_b2c_pricelist_admin():
    return handle_request(office_handler.update_b2c_pricelist, request.json)

@app.route('/api/kancelaria/b2c/add_to_pricelist', methods=['POST'])
@login_required(role='kancelaria')
def add_to_pricelist_admin():
    return handle_request(office_handler.add_products_to_b2c_pricelist, request.json)

@app.route('/api/kancelaria/b2c/upload_image', methods=['POST'])
@login_required(role='kancelaria')
def upload_b2c_image():
    return handle_request(office_handler.upload_b2c_image)

@app.route('/api/kancelaria/b2c/get_rewards')
@login_required(role='kancelaria')
def get_b2c_rewards_admin():
    return handle_request(office_handler.get_b2c_rewards_for_admin)

@app.route('/api/kancelaria/b2c/add_reward', methods=['POST'])
@login_required(role='kancelaria')
def add_b2c_reward_admin():
    return handle_request(office_handler.add_b2c_reward, request.json)

@app.route('/api/kancelaria/b2c/toggle_reward_status', methods=['POST'])
@login_required(role='kancelaria')
def toggle_b2c_reward_status_admin():
    return handle_request(office_handler.toggle_b2c_reward_status, request.json)

@app.route('/api/kancelaria/b2c/update_reward', methods=['POST'])
@login_required(role='kancelaria')
def update_b2c_reward_admin():
    return handle_request(office_handler.update_b2c_reward, request.json)

@app.route('/api/kancelaria/b2c/edit_reward', methods=['POST'])
@login_required(role='kancelaria')
def edit_b2c_reward_admin():
    return handle_request(office_handler.edit_b2c_reward, request.json)



# =================================================================
# === TEMPERATURES (Kancelária) ===
# =================================================================
@app.get('/api/kancelaria/temps/devices')
@login_required(role='kancelaria')
def api_temps_devices():
    return temperature_handler.list_devices()

@app.post('/api/kancelaria/temps/device/save')
@login_required(role='kancelaria')
def api_temps_device_save():
    return handle_request(temperature_handler.save_device, request.json)

@app.post('/api/kancelaria/temps/device/setManual')
@login_required(role='kancelaria')
def api_temps_device_set_manual():
    return handle_request(temperature_handler.set_manual_off, request.json)

@app.post('/api/kancelaria/temps/outage/save')
@login_required(role='kancelaria')
def api_temps_outage_save():
    return handle_request(temperature_handler.save_outage, request.json)

@app.get('/api/kancelaria/temps/readings')
@login_required(role='kancelaria')
def api_temps_readings():
    device_id = request.args.get('device_id', type=int)
    date_str  = request.args.get('date') or datetime.now().strftime("%Y-%m-%d")
    to_now    = (request.args.get('to') == 'now')
    return temperature_handler.get_readings_for_date(device_id, date_str, to_now)

@app.get('/report/temps')
@login_required(role='kancelaria')
def temps_report():
    date_str  = request.args.get('date') or datetime.now().strftime("%Y-%m-%d")
    device_id = request.args.get('device_id', type=int)
    to_now    = (request.args.get('to') == 'now')
    layout    = request.args.get('layout') or 'detail'
    return temperature_handler.report_html(date_str, device_id, to_now, layout)
# =================================================================
# === HACCP – TEPLOTA JADRA VÝROBKOV (Kancelária) ==================
# =================================================================

@app.get('/api/kancelaria/core_temp/list')
@login_required(role=('kancelaria','veduci','admin'))
def api_core_temp_list():
    days = request.args.get('days', type=int) or 365
    return core_temp_handler.list_items(days=days)

@app.get('/api/kancelaria/core_temp/product_defaults')
@login_required(role=('kancelaria','veduci','admin'))
def api_core_temp_product_defaults():
    return core_temp_handler.list_product_defaults()

@app.post('/api/kancelaria/core_temp/product_defaults/save')
@login_required(role=('kancelaria','veduci','admin'))
def api_core_temp_product_defaults_save():
    return handle_request(core_temp_handler.save_product_default, request.json)

@app.post('/api/kancelaria/core_temp/measurement/save')
@login_required(role=('kancelaria','veduci','admin'))
def api_core_temp_measurement_save():
    return handle_request(core_temp_handler.save_measurement, request.json)

@app.get('/api/kancelaria/core_temp/measurement/history')
@login_required(role=('kancelaria','veduci','admin'))
def api_core_temp_measurement_history():
    batch_id = request.args.get('batchId') or request.args.get('batch_id')
    return core_temp_handler.list_measurement_history(batch_id)

# =================================================================
# === SMS notifikácie – B2C =======================================
# =================================================================
@app.route('/api/kancelaria/sms/recipients', methods=['GET'], endpoint='api_sms_recipients')
@login_required
def api_sms_recipients():
    return handle_request(office_handler.sms_get_recipients)

@app.route('/api/kancelaria/sms/send', methods=['POST'], endpoint='api_sms_send')
@login_required
def api_sms_send():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.sms_send, payload)

# Autonotify (server-side)
@app.route('/api/kancelaria/b2c/sms/ready', methods=['POST'], endpoint='b2c_sms_ready')
@login_required
def b2c_sms_ready():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_sms_ready, payload)

@app.route('/api/kancelaria/b2c/sms/completed', methods=['POST'], endpoint='b2c_sms_completed')
@login_required()
def b2c_sms_completed():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_sms_completed, payload)

@app.route('/api/kancelaria/b2c/sms/points', methods=['POST'], endpoint='b2c_sms_points')
@login_required
def b2c_sms_points():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_sms_points, payload)
@app.route('/api/kancelaria/b2c/sms/cancelled', methods=['POST'], endpoint='b2c_sms_cancelled')
@login_required
def b2c_sms_cancelled():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_sms_cancelled, payload)

# Diagnostika
@app.route('/api/kancelaria/b2c/sms/wherePhone', methods=['POST'], endpoint='b2c_sms_where_phone')
@login_required
def api_b2c_sms_where_phone():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_sms_where_phone, payload)

@app.route('/api/kancelaria/b2c/sms/diag', methods=['POST'], endpoint='b2c_sms_diag')
@login_required
def api_b2c_sms_diag():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_sms_diag, payload)

@app.route('/api/kancelaria/b2c/sms/sendTest', methods=['POST'], endpoint='b2c_sms_send_test')
@login_required
def api_b2c_sms_send_test():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_sms_send_test, payload)

# Scan / try map (diagnostika schémy)
@app.route('/api/kancelaria/b2c/sms/schema', methods=['GET'], endpoint='b2c_sms_schema')
@login_required
def api_b2c_sms_schema():
    return handle_request(office_handler.b2c_sms_schema)

@app.route('/api/kancelaria/b2c/sms/tryMap', methods=['POST'], endpoint='b2c_sms_try_map')
@login_required
def api_b2c_sms_try_map():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_sms_try_map, payload)

@app.route('/api/kancelaria/b2c/sms/tryResolve', methods=['POST'], endpoint='b2c_sms_try_resolve')
@login_required
def api_b2c_sms_try_resolve():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_sms_try_resolve, payload)
# --- B2C e-mail notify endpoints (Kancelária) ---
@app.route('/api/kancelaria/b2c/email/ready', methods=['POST'], endpoint='b2c_email_ready')
@login_required
def b2c_email_ready():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_email_ready, payload)

@app.route('/api/kancelaria/b2c/email/completed', methods=['POST'], endpoint='b2c_email_completed')
@login_required
def b2c_email_completed():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.b2c_notify_email_completed, payload)


# (ak UI volá markReady/closeOrder)
@app.route('/api/kancelaria/b2c/markReady', methods=['POST'], endpoint='b2c_mark_ready')
@login_required(role=('kancelaria','veduci','admin'))
def b2c_mark_ready():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.finalize_b2c_order, payload)

@app.route('/api/kancelaria/b2c/closeOrder', methods=['POST'], endpoint='b2c_close_order')
@login_required(role=('kancelaria','veduci','admin'))
def b2c_close_order():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.credit_b2c_loyalty_points, payload)
# Ak ti chýba táto cesta, pridaj ju:

@app.route('/api/kancelaria/updateB2COrderStatus', methods=['POST'], endpoint='kanc_update_b2c_order_status')
@login_required(role=('kancelaria','veduci','admin'))
def kanc_update_b2c_order_status():
    payload = request.get_json(silent=True) or {}
    return handle_request(office_handler.update_b2c_order_status, payload)

# =================================================================
# === FLEET (Kancelária) – doplnené všetky 404 z fleet.js =========
# =================================================================
@app.route('/api/kancelaria/fleet/getData')
@login_required(role='kancelaria')
def api_fleet_get_data():
    return handle_request(
        lambda: fleet_handler.get_fleet_data(
            request.args.get('vehicle_id'),
            request.args.get('year'),
            request.args.get('month')
        )
    )

@app.post('/api/kancelaria/fleet/deleteDayLogs')
@login_required(role=('kancelaria','admin'))   # prípadne rozšír aj na veduci, ak chceš
def fleet_delete_day_logs():
    data = request.get_json(silent=True) or {}
    res = fleet_handler.delete_day_logs(data)
    return (jsonify(res), 200) if 'error' not in res else (jsonify(res), 400)

@app.route('/api/kancelaria/fleet/saveVehicle', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_save_vehicle():
    return handle_request(fleet_handler.save_vehicle, request.json)

@app.post("/api/kancelaria/fleet/deleteVehicle")
def api_fleet_delete_vehicle():
    return handle_request(fleet_handler.delete_vehicle, request.json)


@app.route('/api/kancelaria/fleet/saveLog', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_save_log():
    return handle_request(fleet_handler.save_daily_log, request.json)

@app.route('/api/kancelaria/fleet/saveRefueling', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_save_refueling():
    return handle_request(fleet_handler.save_refueling, request.json)

@app.route('/api/kancelaria/fleet/deleteRefueling', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_delete_refueling():
    return handle_request(fleet_handler.delete_refueling, request.json)

@app.route('/api/kancelaria/fleet/getCosts')
@login_required(role='kancelaria')
def api_fleet_get_costs():
    return handle_request(lambda: fleet_handler.get_fleet_costs(request.args.get('vehicle_id')))

@app.route('/api/kancelaria/fleet/saveCost', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_save_cost():
    return handle_request(fleet_handler.save_fleet_cost, request.json)

@app.route('/api/kancelaria/fleet/deleteCost', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_delete_cost():
    return handle_request(fleet_handler.delete_fleet_cost, request.json)

@app.route('/api/kancelaria/fleet/getAnalysis')
@login_required(role='kancelaria')
def api_fleet_get_analysis():
    return handle_request(
        lambda: fleet_handler.get_fleet_analysis(
            request.args.get('vehicle_id'),
            request.args.get('year'),
            request.args.get('month')
        )
    )

@app.route('/report/fleet')
@login_required(role='kancelaria')
def fleet_report():
    return fleet_handler.get_report_html_content(
        request.args.get('vehicle_id', type=int),
        request.args.get('year', type=int),
        request.args.get('month', type=int),
        request.args.get('type') or 'all'
    )
    
@app.route('/api/kancelaria/fleet/getPrevOdo', methods=['POST'])
@login_required(role='kancelaria')
def api_fleet_get_prev_odo():
    data = request.get_json(silent=True) or {}
    vid = data.get('vehicle_id')
    date_str = data.get('date')
    
    if not vid or not date_str:
        return jsonify({'value': 0})
        
    val = fleet_handler.get_previous_odometer_value(vid, date_str)
    return jsonify({'value': val})
# =================================================================
# === MEAT CALC (Kancelária) ===
# =================================================================
@app.get('/api/kancelaria/meat/materials', endpoint='meat_materials_api')
@login_required(role='kancelaria')
def meat_materials_api():
    return meat_calc_handler.list_materials()

@app.post('/api/kancelaria/meat/material/save', endpoint='meat_material_save_api')
@login_required(role='kancelaria')
def meat_material_save_api():
    return handle_request(meat_calc_handler.save_material, request.json)

@app.get('/api/kancelaria/meat/products', endpoint='meat_products_api')
@login_required(role='kancelaria')
def meat_products_api():
    return meat_calc_handler.list_products()

@app.post('/api/kancelaria/meat/product/save', endpoint='meat_product_save_api')
@login_required(role='kancelaria')
def meat_product_save_api():
    return handle_request(meat_calc_handler.save_product, request.json)

@app.post('/api/kancelaria/meat/breakdown/save', endpoint='meat_breakdown_save_api')
@login_required(role='kancelaria')
def meat_breakdown_save_api():
    return handle_request(meat_calc_handler.save_breakdown, request.json)

@app.get('/api/kancelaria/meat/breakdown', endpoint='meat_breakdown_get_api')
@login_required(role='kancelaria')
def meat_breakdown_get_api():
    bid = request.args.get('id', type=int)
    return meat_calc_handler.get_breakdown(bid)

@app.get('/api/kancelaria/meat/breakdowns', endpoint='meat_breakdowns_list_api')
@login_required(role='kancelaria')
def meat_breakdowns_list_api():
    return meat_calc_handler.list_breakdowns(
        material_id=request.args.get('material_id', type=int),
        date_from=request.args.get('date_from'),
        date_to=request.args.get('date_to'),
        supplier=request.args.get('supplier')
    )

@app.post('/api/kancelaria/meat/estimate', endpoint='meat_estimate_api')
@login_required(role='kancelaria')
def meat_estimate_api():
    data = request.json or {}
    return meat_calc_handler.estimate(
        material_id=int(data.get('material_id')),
        planned_weight_kg=float(data.get('planned_weight_kg')),
        expected_purchase_unit_price=float(data.get('expected_purchase_unit_price')),
        supplier=data.get('supplier') or None,
        date_from=data.get('date_from'),
        date_to=data.get('date_to'),
        extra_costs=data.get('extras') or []
    )
@app.route('/report/meat/summary')
@login_required(role='kancelaria')  # alebo len @login_required, podľa toho ako to máš inde
def meat_summary_report():
    """
    Tlačový report - súhrn ziskov a výťažnosti za viac rozrábok,
    podľa filtrov (surovina, dátum od/do, dodávateľ).
    """
    material_id = request.args.get('material_id', type=int)
    date_from   = request.args.get('date_from') or None
    date_to     = request.args.get('date_to') or None
    supplier    = request.args.get('supplier') or None

    filters = {
        "material_id": material_id,
        "date_from": date_from,
        "date_to": date_to,
        "supplier": supplier,
    }

    where_clauses = ["1=1"]
    params = []

    if material_id:
        where_clauses.append("b.material_id = %s")
        params.append(material_id)
    if date_from:
        where_clauses.append("b.breakdown_date >= %s")
        params.append(date_from)
    if date_to:
        where_clauses.append("b.breakdown_date <= %s")
        params.append(date_to)
    if supplier:
        where_clauses.append("b.supplier LIKE %s")
        params.append(f"%{supplier}%")

    base_sql = f"""
        SELECT
          b.id,
          b.breakdown_date,
          b.input_weight_kg,
          b.purchase_total_cost_eur,
          b.supplier,
          m.name AS material_name
        FROM meat_breakdown b
        JOIN meat_materials m ON m.id = b.material_id
        WHERE {' AND '.join(where_clauses)}
        ORDER BY b.breakdown_date ASC, b.id ASC
    """

    rows = db_connector.execute_query(base_sql, tuple(params)) or []

    if not rows:
        totals = None
        filters["material_label"] = "Všetky"
        return render_template(
            'meat_summary_report.html',
            filters=filters,
            rows=[],
            totals=totals,
        )

    ids = [r["id"] for r in rows]

    # agregácia výstupov a zisku z detailov
    placeholders = ",".join(["%s"] * len(ids))
    sql_agg = f"""
        SELECT
          breakdown_id,
          SUM(weight_kg)  AS total_output_kg,
          SUM(profit_eur) AS total_profit_eur
        FROM meat_breakdown_result
        WHERE breakdown_id IN ({placeholders})
        GROUP BY breakdown_id
    """
    agg_rows = db_connector.execute_query(sql_agg, tuple(ids)) or []
    agg_map = {a["breakdown_id"]: a for a in agg_rows}

    sum_input_kg = 0.0
    sum_output_kg = 0.0
    sum_purchase = 0.0
    sum_profit = 0.0

    for r in rows:
        r["input_weight_kg"] = float(r.get("input_weight_kg") or 0.0)
        r["purchase_total_cost_eur"] = float(r.get("purchase_total_cost_eur") or 0.0)

        agg = agg_map.get(r["id"]) or {}
        r["total_output_kg"] = float(agg.get("total_output_kg") or 0.0)
        r["total_profit_eur"] = float(agg.get("total_profit_eur") or 0.0)

        sum_input_kg  += r["input_weight_kg"]
        sum_output_kg += r["total_output_kg"]
        sum_purchase  += r["purchase_total_cost_eur"]
        sum_profit    += r["total_profit_eur"]

    yield_pct = (sum_output_kg / sum_input_kg * 100.0) if sum_input_kg > 0 else 0.0
    profit_per_kg_input = (sum_profit / sum_input_kg) if sum_input_kg > 0 else 0.0

    totals = {
        "sum_input_kg": round(sum_input_kg, 3),
        "sum_output_kg": round(sum_output_kg, 3),
        "sum_purchase_total_eur": round(sum_purchase, 2),
        "sum_profit_eur": round(sum_profit, 2),
        "yield_pct": round(yield_pct, 2),
        "profit_per_kg_input_eur": round(profit_per_kg_input, 4),
    }

    if material_id and rows:
        filters["material_label"] = rows[0]["material_name"]
    else:
        filters["material_label"] = "Všetky"

    return render_template(
        'meat_summary_report.html',
        filters=filters,
        rows=rows,
        totals=totals,
    )

@app.get('/api/kancelaria/meat/profitability', endpoint='meat_profitability_api')
@login_required(role='kancelaria')
def meat_profitability_api():
    return meat_calc_handler.profitability(request.args.get('breakdown_id', type=int))

@app.get('/api/kancelaria/meat/breakdown/export', endpoint='meat_breakdown_export_api')
@login_required(role='kancelaria')
def meat_breakdown_export_api():
    return meat_calc_handler.export_breakdown_excel(request.args.get('id', type=int))

@app.get('/report/meat/breakdown', endpoint='meat_breakdown_report_api')
@login_required(role='kancelaria')
def meat_breakdown_report_api():
    return meat_calc_handler.report_breakdown_html(request.args.get('id', type=int))

@app.get('/api/kancelaria/meat/locked-prices', endpoint='meat_locked_prices_api')
@login_required(role='kancelaria')
def meat_locked_prices_api():
    mid = request.args.get('material_id', type=int)
    return meat_calc_handler.list_locked_prices(mid)

@app.post('/api/kancelaria/meat/locked-price/set', endpoint='meat_locked_price_set_api')
@login_required(role='kancelaria')
def meat_locked_price_set_api():
    data = request.json or {}
    return meat_calc_handler.set_locked_price(
        material_id = int(data.get('material_id')),
        product_id  = int(data.get('product_id')),
        price_eur_kg= float(data.get('price_eur_kg'))
    )
@app.post('/api/kancelaria/meat/material/delete', endpoint='meat_material_delete_api')
@login_required(role='kancelaria')
def meat_material_delete_api():
    data = request.json or {}
    return handle_request(meat_calc_handler.delete_material, data.get('id'))


@app.post('/api/kancelaria/meat/product/delete', endpoint='meat_product_delete_api')
@login_required(role='kancelaria')
def meat_product_delete_api():
    data = request.json or {}
    return handle_request(meat_calc_handler.delete_product, data.get('id'))
@app.get('/api/kancelaria/meat/suppliers', endpoint='meat_suppliers_api')
@login_required(role='kancelaria')
def meat_suppliers_api():
    return meat_calc_handler.list_suppliers()


@app.post('/api/kancelaria/meat/supplier/save', endpoint='meat_supplier_save_api')
@login_required(role='kancelaria')
def meat_supplier_save_api():
    return handle_request(meat_calc_handler.save_supplier, request.json)

@app.post('/api/kancelaria/meat/breakdown/delete', endpoint='meat_breakdown_delete_api')
@login_required(role='kancelaria')
def meat_breakdown_delete_api():
    data = request.json or {}
    return handle_request(meat_calc_handler.delete_breakdown, data.get('id'))


@app.post('/api/kancelaria/meat/supplier/delete', endpoint='meat_supplier_delete_api')
@login_required(role='kancelaria')
def meat_supplier_delete_api():
    data = request.json or {}
    return handle_request(meat_calc_handler.delete_supplier, data.get('id')) 

@app.post('/api/kancelaria/meat/report/supplier_product', endpoint='meat_report_supplier_product_api')
@login_required(role='kancelaria')
def meat_report_supplier_product_api():
    data = request.json or {}
    return handle_request(meat_calc_handler.supplier_product_stats, data)


# =================================================================
# === HYGIENE (Kancelária) - KOMPLETNÁ SEKCIA ===
# =================================================================

@app.route('/api/kancelaria/hygiene/getPlan')
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_get_plan():
    return handle_request(hygiene_handler.get_hygiene_plan_for_date, request.args.get('date'))

@app.route('/api/kancelaria/hygiene/getAgents')
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_get_agents():
    return handle_request(hygiene_handler.get_hygiene_agents)

@app.route('/api/kancelaria/hygiene/getTasks')
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_get_tasks():
    return handle_request(hygiene_handler.get_all_hygiene_tasks)

@app.route('/api/kancelaria/hygiene/saveTask', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_save_task():
    return handle_request(hygiene_handler.save_hygiene_task, request.json)

@app.route('/api/kancelaria/hygiene/saveAgent', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_save_agent():
    return handle_request(hygiene_handler.save_hygiene_agent, request.json)

@app.route('/api/kancelaria/hygiene/logCompletion', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_log_completion():
    return handle_request(hygiene_handler.log_hygiene_completion, request.json)

@app.route('/api/kancelaria/hygiene/checkLog', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_check_log_api():
    return handle_request(hygiene_handler.check_hygiene_log, request.json)

# --- TOTO VÁM CHÝBALO (MAZANIE) ---
@app.route('/api/kancelaria/hygiene/deleteTask', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_delete_task_api():
    return handle_request(hygiene_handler.delete_hygiene_task, request.json)

@app.route('/api/kancelaria/hygiene/deleteAgent', methods=['POST'])
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_delete_agent_api():
    return handle_request(hygiene_handler.delete_hygiene_agent, request.json)
# ----------------------------------

@app.route('/report/hygiene')
@login_required(role=('kancelaria','veduci','admin'))
def hygiene_report_page():
    # Report s novými filtrami
    filters = {
        "date_from": request.args.get('date_from'),
        "date_to": request.args.get('date_to'),
        "task_id": request.args.get('task_id'),
        "agent_id": request.args.get('agent_id')
    }
    html = hygiene_handler.get_hygiene_report_html(filters)
    return make_response(html)

# =================================================================
# === HR & DOCHÁDZKA (Kancelária) ================================
# =================================================================

@app.get('/api/kancelaria/hr/employees')
@login_required(role=('kancelaria','veduci','admin'))
def hr_employees_list():
    return handle_request(hr_handler.list_employees)


@app.post('/api/kancelaria/hr/employee/save')
@login_required(role=('kancelaria','veduci','admin'))
def hr_employee_save():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.save_employee, data)


@app.post('/api/kancelaria/hr/employee/delete')
@login_required(role=('kancelaria','veduci','admin'))
def hr_employee_delete():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.delete_employee, data.get('id'))


@app.get('/api/kancelaria/hr/attendance')
@login_required(role=('kancelaria','veduci','admin'))
def hr_attendance_list():
    return handle_request(hr_handler.list_attendance, request.args)


@app.post('/api/kancelaria/hr/attendance/save')
@login_required(role=('kancelaria','veduci','admin'))
def hr_attendance_save():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.save_attendance, data)


@app.post('/api/kancelaria/hr/attendance/delete')
@login_required(role=('kancelaria','veduci','admin'))
def hr_attendance_delete():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.delete_attendance, data)


@app.get('/api/kancelaria/hr/leaves')
@login_required(role=('kancelaria','veduci','admin'))
def hr_leaves_list():
    return handle_request(hr_handler.list_leaves, request.args)


@app.post('/api/kancelaria/hr/leave/save')
@login_required(role=('kancelaria','veduci','admin'))
def hr_leave_save():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.save_leave, data)


@app.post('/api/kancelaria/hr/leave/delete')
@login_required(role=('kancelaria','veduci','admin'))
def hr_leave_delete():
    data = request.get_json(silent=True) or {}
    return handle_request(hr_handler.delete_leave, data)


@app.get('/api/kancelaria/hr/summary')
@login_required(role=('kancelaria','veduci','admin'))
def hr_labor_summary():
    return handle_request(hr_handler.get_labor_summary, request.args)


# =================================================================
# === PROFITABILITY (Kancelária) ===
# =================================================================
@app.route('/api/kancelaria/profitability/history')
@login_required(role='kancelaria')
def profitability_history_api():
    return handle_request(profitability_handler.get_profitability_history, request.args)

@app.route('/report/profitability')
@login_required(role='kancelaria')
def profitability_report():
    return profitability_handler.get_profitability_report_html_ex(request.args)

@app.route('/api/kancelaria/profitability/getData')
@login_required(role='kancelaria')
def profitability_get_data():
    y = request.args.get('year')
    m = request.args.get('month')
    return handle_request(profitability_handler.get_profitability_data, y, m)

@app.route('/api/kancelaria/profitability/saveCalculation', methods=['POST'])
@login_required(role='kancelaria')
def profitability_save_calculation():
    return handle_request(profitability_handler.save_calculation, request.json)

@app.route('/api/kancelaria/profitability/deleteCalculation', methods=['POST'])
@login_required(role='kancelaria')
def profitability_delete_calculation():
    return handle_request(profitability_handler.delete_calculation, request.json)

@app.route('/api/kancelaria/profitability/setupSalesChannel', methods=['POST'])
@login_required(role='kancelaria')
def profitability_setup_sales_channel():
    return handle_request(profitability_handler.setup_new_sales_channel, request.json)

@app.route('/api/kancelaria/profitability/saveSalesChannelData', methods=['POST'])
@login_required(role='kancelaria')
def profitability_save_sales_channel_data():
    return handle_request(profitability_handler.save_sales_channel_data, request.json)

@app.route('/api/kancelaria/profitability/saveDepartmentData', methods=['POST'])
@login_required(role='kancelaria')
def profitability_save_department_data():
    return handle_request(profitability_handler.save_department_data, request.json)

@app.route('/api/kancelaria/profitability/saveProductionData', methods=['POST'])
@login_required(role='kancelaria')
def profitability_save_production_data():
    return handle_request(profitability_handler.save_production_profit_data, request.json)

# =================================================================
# === COSTS (Kancelária) ===
# =================================================================
@app.route('/api/kancelaria/costs/getEnergyHistory')
@login_required(role='kancelaria')
def costs_get_energy_history():
    return handle_request(costs_handler.get_energy_history, request.args)


@app.route('/report/costs/energy')
@login_required(role='kancelaria')
def costs_energy_report():
    return costs_handler.get_energy_report_html(request.args)

@app.route('/api/kancelaria/costs/saveElectricity', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_electricity():
    return handle_request(costs_handler.save_electricity_data, request.json)

@app.route('/api/kancelaria/costs/saveGas', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_gas():
    return handle_request(costs_handler.save_gas_data, request.json)

@app.route('/api/kancelaria/costs/saveWater', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_water():
    return handle_request(costs_handler.save_water_data, request.json)

@app.route('/api/kancelaria/costs/getData')
@login_required(role='kancelaria')
def costs_get_data():
    y = request.args.get('year')
    m = request.args.get('month')
    return handle_request(costs_handler.get_costs_data, y, m)

@app.route('/api/kancelaria/costs/saveEnergy', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_energy():
    return handle_request(costs_handler.save_energy_data, request.json)

@app.route('/api/kancelaria/costs/saveHr', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_hr():
    return handle_request(costs_handler.save_hr_data, request.json)

@app.route('/api/kancelaria/costs/saveOperational', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_operational():
    return handle_request(costs_handler.save_operational_cost, request.json)

@app.route('/api/kancelaria/costs/deleteOperational', methods=['POST'])
@login_required(role='kancelaria')
def costs_delete_operational():
    return handle_request(costs_handler.delete_operational_cost, request.json)

@app.route('/api/kancelaria/costs/saveCategory', methods=['POST'])
@login_required(role='kancelaria')
def costs_save_category():
    return handle_request(costs_handler.save_cost_category, request.json)

@app.route('/api/kancelaria/costs/getDashboardData')
@login_required(role='kancelaria')
def costs_dashboard_data():
    y = request.args.get('year')
    m = request.args.get('month')
    return handle_request(costs_handler.get_dashboard_data, year=y, month=m)


@app.route('/report/costs/finance')
@login_required(role='kancelaria')
def report_costs_finance():
    return handle_request(costs_handler.get_finance_report_html, request.args)

@app.get('/api/kancelaria/costs/autoHr')
@login_required(role=('kancelaria','veduci','admin'))
def api_costs_auto_hr():
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    return handle_request(costs_handler.auto_hr_from_hr_module, year, month)

# =================================================================
# === TRACE & REPORTS (zvyšok) ===
# =================================================================
@app.route('/traceability/<batch_id>')
@login_required(role=['expedicia', 'kancelaria', 'admin'])
def page_traceability(batch_id):
    return render_template('traceability.html', batch_id=batch_id)

@app.route('/api/traceability/<batch_id>')
@login_required(role=['expedicia', 'kancelaria', 'admin'])
def get_api_traceability_info(batch_id):
    return handle_request(expedition_handler.get_traceability_info, batch_id)

@app.route('/report/receipt')
@login_required(role='kancelaria')
def report_receipt():
    period = request.args.get('period', 'day')
    category = request.args.get('category', 'Všetky')
    return office_handler.get_receipt_report_html(period, category)

@app.route('/report/inventory')
@login_required(role='kancelaria')
def report_inventory():
    date_str = request.args.get('date')
    return office_handler.get_inventory_difference_report_html(date_str)

# =================================================================
# === MAIL API ===
# =================================================================
# 1) Zoznam zákazníkov pre selectbox v pošte
@mail_bp.get("/api/mail/customers")
def api_mail_customers():
    """
    Vracia: { items: [ { customer_id, customer_name }, ... ] }
    """
    res = mail_handler.customers_list()
    return jsonify(res)

# 2) Trvalé mapovanie e-mailu/domény na zákazníka
@mail_bp.post("/api/mail/contact_links")
def api_mail_contact_links():
    data = request.get_json(silent=True) or {}
    email   = (data.get("email") or "").strip()
    cid     = data.get("customer_id")
    cname   = (data.get("customer_name") or "").strip() or None
    domain  = (data.get("domain") or "").strip() or None

    if not email or not cid:
        return jsonify({"error": "Chýba e‑mail alebo customer_id."}), 400

    res = mail_handler.contact_links_create(email, cid, cname, domain)
    # contact_links_create ti už vracia {"message": "..."} alebo {"error": "..."}
    if res.get("error"):
        return jsonify(res), 400
    return jsonify(res)

# 3) Jednorazové priradenie konkrétnej správy k zákazníkovi
@mail_bp.post("/api/mail/messages/<int:message_id>/assign_customer")
def api_mail_assign_customer(message_id: int):
    data = request.get_json(silent=True) or {}
    cid = data.get("customer_id")
    if not cid:
        return jsonify({"error": "Chýba customer_id."}), 400

    res = mail_handler.message_assign_customer(message_id, cid)
    # message_assign_customer už aktualizuje mail_messages.customer_id
    return jsonify(res)

@app.route('/api/mail/messages')
@login_required(role='kancelaria')
def mail_list():
    folder     = request.args.get('folder', 'INBOX')
    page       = request.args.get('page', 1)
    page_size  = request.args.get('page_size', 50)
    query      = request.args.get('query')
    customer_id= request.args.get('customer_id')
    unread     = request.args.get('unread')
    starred    = request.args.get('starred')
    has_attach = request.args.get('has_attach')
    return handle_request(mail_handler.list_messages, folder, page, page_size, query, customer_id, unread, starred, has_attach)

@app.route('/api/mail/signatures/<int:sig_id>', methods=['GET'])
@login_required(role='kancelaria')
def mail_signatures_get(sig_id):
    return handle_request(mail_handler.signatures_get_one, sig_id)

@app.route('/api/mail/messages/<int:message_id>')
@login_required(role='kancelaria')
def mail_get(message_id):
    return handle_request(mail_handler.get_message, message_id)

@app.route('/api/mail/messages/<int:message_id>/mark_read', methods=['POST'])
@login_required(role='kancelaria')
def mail_mark_read(message_id):
    data = request.json or {}
    return handle_request(mail_handler.mark_read, message_id, data.get('read', True))

@app.route('/api/mail/messages/<int:message_id>/move', methods=['POST'])
@login_required(role='kancelaria')
def mail_move(message_id):
    data = request.json or {}
    return handle_request(mail_handler.move_to_folder, message_id, data.get('folder', 'INBOX'))

@app.route('/api/mail/messages/<int:message_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def mail_delete(message_id):
    return handle_request(mail_handler.delete_message, message_id)

@app.route('/api/mail/send', methods=['POST'])
@login_required(role='kancelaria')
def mail_send():
    return handle_request(mail_handler.send_email_from_form, request)

@app.route('/api/mail/inbound/<token>', methods=['POST'])
def mail_inbound(token):
    result = mail_handler.handle_inbound_webhook(request, token)
    if isinstance(result, tuple):
        body, status = result
        return jsonify(body), status
    return jsonify(result)

@app.route('/api/mail/attachments/<int:att_id>')
@login_required(role='kancelaria')
def mail_download_attachment(att_id):
    att = db_connector.execute_query("SELECT * FROM mail_attachments WHERE id=%s", (att_id,), fetch="one")
    if not att:
        return jsonify({'error': 'Príloha neexistuje.'}), 404
    try:
        directory = os.path.dirname(att['storage_path'])
        fname = os.path.basename(att['storage_path'])
        return send_from_directory(directory=directory, path=fname, as_attachment=True)
    except Exception as e:
        print('download attachment error:', e)
        return jsonify({'error': 'Súbor sa nepodarilo odoslať.'}), 500

@app.route('/api/mail/imap/test', methods=['GET'])
@login_required(role='kancelaria')
def mail_imap_test():
    return handle_request(mail_handler.imap_test_connection)

@app.route('/api/mail/imap/fetch', methods=['POST'])
@login_required(role='kancelaria')
def mail_imap_fetch():
    limit = int(request.args.get('limit', 50))
    folder = request.args.get('folder')
    return handle_request(mail_handler.fetch_imap, limit, folder)

@app.route('/api/mail/folders/summary')
@login_required(role='kancelaria')
def mail_folder_summary():
    return handle_request(mail_handler.folder_summary)

@app.route('/api/mail/signatures', methods=['GET'])
@login_required(role='kancelaria')
def mail_signatures_list():
    return handle_request(mail_handler.signatures_list)

@app.route('/api/mail/signatures', methods=['POST'])
@login_required(role='kancelaria')
def mail_signatures_create():
    data = request.json or {}
    return handle_request(mail_handler.signatures_create, data.get('name'), data.get('html'), data.get('is_default', False))

@app.route('/api/mail/signatures/<int:sig_id>', methods=['PUT'])
@login_required(role='kancelaria')
def mail_signatures_update(sig_id):
    data = request.json or {}
    return handle_request(mail_handler.signatures_update, sig_id, data.get('name'), data.get('html'), data.get('is_default', False))

@app.route('/api/mail/signatures/<int:sig_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def mail_signatures_delete(sig_id):
    return handle_request(mail_handler.signatures_delete, sig_id)

@app.route('/api/mail/signatures/default', methods=['GET'])
@login_required(role='kancelaria')
def mail_signatures_default():
    return handle_request(mail_handler.signatures_get_default)

@app.route('/api/mail/customers', methods=['GET'])
@login_required(role='kancelaria')
def mail_customers_list():
    return handle_request(mail_handler.customers_list)

@app.route('/api/mail/contact_links', methods=['POST'])
@login_required(role='kancelaria')
def mail_contact_links_create():
    data = request.json or {}
    return handle_request(mail_handler.contact_links_create, data.get('email'), data.get('customer_id'), data.get('customer_name'), data.get('domain'))

@app.route('/api/mail/messages/<int:message_id>/assign_customer', methods=['POST'])
@login_required(role='kancelaria')
def mail_message_assign_customer(message_id):
    data = request.json or {}
    return handle_request(mail_handler.message_assign_customer, message_id, data.get('customer_id'))

# =================================================================
# === OBJEDNÁVKY / SKLAD BLUEPRINTY ===
# =================================================================
app.register_blueprint(orders_bp)
init_orders()


# =================================================================
# === SPUSTENIE APLIKÁCIE (len pre lokálny development) ===========
# =================================================================
if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=True,
        use_reloader=False
    )
