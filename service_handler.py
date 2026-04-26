from flask import Blueprint, jsonify, request
from auth_handler import login_required
import db_connector

service_bp = Blueprint('service', __name__)

# ==========================================
# VÁHY - METROLÓGIA
# ==========================================
@service_bp.route('/api/service/vahy', methods=['GET'])
@login_required(role='kancelaria')
def get_vahy():
    sql = """
        SELECT id, cislo_vahy, umiestnenie, 
               DATE_FORMAT(datum_poslednej_skusky, '%Y-%m-%d') as datum_poslednej,
               DATE_FORMAT(datum_dalsej_skusky, '%Y-%m-%d') as datum_dalsej,
               poznamka,
               DATEDIFF(datum_dalsej_skusky, CURDATE()) as dni_do_konca
        FROM servis_vahy
        ORDER BY datum_dalsej_skusky ASC
    """
    rows = db_connector.execute_query(sql, fetch='all') or []
    return jsonify(rows)

@service_bp.route('/api/service/vahy', methods=['POST'])
@login_required(role='kancelaria')
def save_vaha():
    data = request.json
    try:
        if data.get('id'):
            sql = "UPDATE servis_vahy SET cislo_vahy=%s, umiestnenie=%s, datum_poslednej_skusky=%s, datum_dalsej_skusky=%s, poznamka=%s WHERE id=%s"
            db_connector.execute_query(sql, (data['cislo_vahy'], data['umiestnenie'], data['datum_poslednej'], data['datum_dalsej'], data.get('poznamka', ''), data['id']), fetch='none')
        else:
            sql = "INSERT INTO servis_vahy (cislo_vahy, umiestnenie, datum_poslednej_skusky, datum_dalsej_skusky, poznamka) VALUES (%s, %s, %s, %s, %s)"
            db_connector.execute_query(sql, (data['cislo_vahy'], data['umiestnenie'], data['datum_poslednej'], data['datum_dalsej'], data.get('poznamka', '')), fetch='none')
        return jsonify({"message": "Váha bola úspešne uložená."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@service_bp.route('/api/service/vahy/<int:item_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def delete_vaha(item_id):
    try:
        db_connector.execute_query("DELETE FROM servis_vahy WHERE id=%s", (item_id,), fetch='none')
        return jsonify({"message": "Záznam o váhe bol zmazaný."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==========================================
# STROJE A OPRAVY
# ==========================================
@service_bp.route('/api/service/stroje', methods=['GET'])
@login_required(role='kancelaria')
def get_stroje():
    sql = """
        SELECT id, nazov_stroja, typ_zaznamu, 
               DATE_FORMAT(datum_opravy, '%Y-%m-%d') as datum_opravy,
               popis_prace, dodavatel_servisu, 
               cena_bez_dph, cena_s_dph, poznamka
        FROM servis_opravy
        ORDER BY datum_opravy DESC
    """
    rows = db_connector.execute_query(sql, fetch='all') or []
    return jsonify(rows)

@service_bp.route('/api/service/stroje', methods=['POST'])
@login_required(role='kancelaria')
def save_stroj():
    data = request.json
    try:
        cena_bez = float(data.get('cena_bez_dph') or 0)
        cena_s = float(data.get('cena_s_dph') or 0)
        
        if data.get('id'):
            sql = "UPDATE servis_opravy SET nazov_stroja=%s, typ_zaznamu=%s, datum_opravy=%s, popis_prace=%s, dodavatel_servisu=%s, cena_bez_dph=%s, cena_s_dph=%s, poznamka=%s WHERE id=%s"
            db_connector.execute_query(sql, (data['nazov_stroja'], data['typ_zaznamu'], data['datum_opravy'], data['popis_prace'], data['dodavatel_servisu'], cena_bez, cena_s, data.get('poznamka', ''), data['id']), fetch='none')
        else:
            sql = "INSERT INTO servis_opravy (nazov_stroja, typ_zaznamu, datum_opravy, popis_prace, dodavatel_servisu, cena_bez_dph, cena_s_dph, poznamka) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"
            db_connector.execute_query(sql, (data['nazov_stroja'], data['typ_zaznamu'], data['datum_opravy'], data['popis_prace'], data['dodavatel_servisu'], cena_bez, cena_s, data.get('poznamka', '')), fetch='none')
        return jsonify({"message": "Záznam o servise bol uložený."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@service_bp.route('/api/service/stroje/<int:item_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def delete_stroj(item_id):
    try:
        db_connector.execute_query("DELETE FROM servis_opravy WHERE id=%s", (item_id,), fetch='none')
        return jsonify({"message": "Záznam o servise bol zmazaný."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
# ==========================================
# BEŽNÁ ÚDRŽBA BUDOVY (RVPS, HYGIENA atď.)
# ==========================================
@service_bp.route('/api/service/budova', methods=['GET'])
@login_required(role='kancelaria')
def get_budova():
    sql = """
        SELECT id, DATE_FORMAT(datum, '%Y-%m-%d') as datum, miestnost,
               popis_prace, nariadene_kym, vykonal, cena, stav
        FROM servis_budova
        ORDER BY datum DESC
    """
    rows = db_connector.execute_query(sql, fetch='all') or []
    return jsonify(rows)

@service_bp.route('/api/service/budova', methods=['POST'])
@login_required(role='kancelaria')
def save_budova():
    data = request.json
    cena = float(data.get('cena') or 0)
    try:
        if data.get('id'):
            sql = "UPDATE servis_budova SET datum=%s, miestnost=%s, popis_prace=%s, nariadene_kym=%s, vykonal=%s, cena=%s, stav=%s WHERE id=%s"
            db_connector.execute_query(sql, (data['datum'], data['miestnost'], data['popis_prace'], data['nariadene_kym'], data['vykonal'], cena, data['stav'], data['id']), fetch='none')
        else:
            sql = "INSERT INTO servis_budova (datum, miestnost, popis_prace, nariadene_kym, vykonal, cena, stav) VALUES (%s, %s, %s, %s, %s, %s, %s)"
            db_connector.execute_query(sql, (data['datum'], data['miestnost'], data['popis_prace'], data['nariadene_kym'], data['vykonal'], cena, data['stav']), fetch='none')
        return jsonify({"message": "Záznam údržby bol uložený."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@service_bp.route('/api/service/budova/<int:item_id>', methods=['DELETE'])
@login_required(role='kancelaria')
def delete_budova(item_id):
    try:
        db_connector.execute_query("DELETE FROM servis_budova WHERE id=%s", (item_id,), fetch='none')
        return jsonify({"message": "Záznam bol zmazaný."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500