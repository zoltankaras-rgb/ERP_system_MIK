import os
import subprocess
import base64
from flask import Blueprint, request, jsonify, current_app
from flask_mail import Message
from datetime import datetime

# Lazy import
try:
    from app import mail
except ImportError:
    mail = None

pricelist_bp = Blueprint('pricelist', __name__)

def get_wkhtmltopdf_config():
    """
    Nájde cestu k wkhtmltopdf.
    """
    import pdfkit
    possible_paths = [
        '/usr/bin/wkhtmltopdf',
        '/usr/local/bin/wkhtmltopdf',
        '/opt/bin/wkhtmltopdf'
    ]
    found_path = next((p for p in possible_paths if os.path.exists(p)), None)

    if not found_path:
        try:
            found_path = subprocess.check_output(['which', 'wkhtmltopdf']).decode('utf-8').strip()
        except:
            pass

    if found_path:
        return pdfkit.configuration(wkhtmltopdf=found_path)
    return None

def get_logo_base64():
    """
    Načíta logo zo zložky static a vráti ho ako base64 string pre vloženie do HTML.
    """
    try:
        logo_path = os.path.join(current_app.root_path, 'static', 'mik logo.jpg')
        
        if not os.path.exists(logo_path):
            return None

        with open(logo_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            return f"data:image/jpeg;base64,{encoded_string}"
    except Exception:
        return None

def generate_pricelist_html(items, customer_name, valid_from):
    # Načítanie loga
    logo_src = get_logo_base64()
    logo_html = ""
    if logo_src:
        logo_html = f'<div style="text-align:center; margin-bottom:10px;"><img src="{logo_src}" style="max-height:80px; width:auto;"></div>'

    # Začiatok HTML
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; }}
            
            /* HLAVIČKA */
            h1 {{ color: #333; text-align: center; margin-bottom: 2px; margin-top: 0; font-size: 22px; }}
            .sub-header {{ text-align: center; font-size: 12px; color: #555; margin-bottom: 25px; }}
            
            .meta {{ margin-bottom: 15px; font-size: 14px; text-align: center; color: #000; border-top: 1px solid #eee; border-bottom: 1px solid #eee; padding: 10px; }}
            
            /* TABUĽKA */
            table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
            th {{ background-color: #333; color: #fff; padding: 8px; border: 1px solid #000; text-align: left; }}
            td {{ padding: 8px; border: 1px solid #ddd; }}
            
            /* ZVÝRAZNENIE AKCIE */
            .action-row {{ background-color: #ffff99 !important; font-weight: bold; }}
            .action-badge {{ 
                background-color: #d32f2f; color: white; 
                padding: 2px 6px; border-radius: 4px; 
                font-size: 0.8em; font-weight: bold; text-transform: uppercase;
                float: right;
            }}
            
            .price-up {{ color: red; font-weight: bold; }}
            .price-down {{ color: green; font-weight: bold; }}
        </style>
    </head>
    <body>
        {logo_html}
        
        <h1>Cenník produktov MIK, s.r.o.</h1>
        <div class="sub-header">
            Hollého č.1999/13, 927 05 Šaľa
        </div>

        <div class="meta">
            <strong>Partner:</strong> {customer_name} &nbsp;|&nbsp; 
            <strong>Platnosť od:</strong> {valid_from}
        </div>

        <table>
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th style="width: 50px;">MJ</th>
                    <th style="width: 50px;">DPH</th>
                    <th style="width: 100px;">Cena (bez DPH)</th>
                    <th style="width: 80px;">Zmena</th>
                </tr>
            </thead>
            <tbody>
    """

    for item in items:
        # Bezpečné načítanie hodnôt s ošetrením chýb
        is_action = item.get('is_action', False)
        row_class = "action-row" if is_action else ""
        
        try:
            old = float(item.get('old_price') or 0)
            new = float(item.get('price') or 0)
            dph = float(item.get('dph') or 20)
        except (ValueError, TypeError):
            # Ak sú dáta poškodené, nastavíme nuly aby to nepadlo
            old, new, dph = 0, 0, 20

        diff_text = "-"
        price_class = ""
        
        # Logika pre šípky a farby
        if old > 0:
            if new > old:
                price_class = "price-up"
                diff_text = "&#11014;" # Šípka hore
            elif new < old:
                price_class = "price-down"
                diff_text = "&#11015;" # Šípka dole

        product_name = item.get('name', 'Produkt')
        
        badge = ""
        if is_action:
            badge = '<span class="action-badge">AKCIA</span>'

        html_content += f"""
            <tr class="{row_class}">
                <td>{product_name} {badge}</td>
                <td>{item.get('mj', 'kg')}</td>
                <td>{int(dph)}%</td>
                <td class="{price_class}">{new:.2f} €</td>
                <td style="text-align:center">{diff_text}</td>
            </tr>
        """

    html_content += f"""
            </tbody>
        </table>
        <p style="text-align:center; margin-top:30px; color:#888; font-size:10px;">
            Vygenerované systémom MIK dňa {datetime.now().strftime("%d.%m.%Y %H:%M")}
        </p>
    </body>
    </html>
    """
    return html_content

@pricelist_bp.route('/api/send_custom_pricelist', methods=['POST'])
def send_custom_pricelist():
    from app import mail
    if not mail: return jsonify({'error': 'Mail nie je nakonfigurovaný'}), 500

    try:
        data = request.json
        customers = data.get('customers', []) 
        items = data.get('items', [])         
        valid_from = data.get('valid_from', datetime.now().strftime("%d.%m.%Y"))

        import pdfkit
        config = get_wkhtmltopdf_config()
        
        options = {
            'encoding': "UTF-8",
            'no-outline': None,
            'enable-local-file-access': None,
            'quiet': '',
            'margin-top': '10mm',
            'margin-bottom': '10mm',
            'margin-left': '10mm',
            'margin-right': '10mm'
        }

        sent_count = 0
        errors = []
        
        for cust in customers:
            raw_emails = cust.get('email', '').replace(';', ',').split(',')
            valid_emails = [e.strip() for e in raw_emails if '@' in e]

            if not valid_emails: 
                errors.append(f"Zákazník {cust.get('name')} nemá platný email.")
                continue

            # Tu sa volá nová funkcia
            html = generate_pricelist_html(items, cust.get('name', 'Zákazník'), valid_from)
            
            try:
                if config:
                    pdf_bytes = pdfkit.from_string(html, False, configuration=config, options=options)
                else:
                    pdf_bytes = pdfkit.from_string(html, False, options=options)
            except Exception as e:
                err_msg = f"CHYBA PDF pre {cust.get('name')}: {str(e)}"
                print(err_msg)
                errors.append(err_msg)
                continue

            try:
                msg = Message(
                    subject=f"Cenník MIK (od {valid_from})",
                    recipients=valid_emails,
                    body=f"Dobrý deň,\n\nv prílohe posielame aktuálny cenník.\n\nS pozdravom,\nMIK"
                )
                msg.attach(f"Cennik_{valid_from}.pdf", "application/pdf", pdf_bytes)
                
                mail.send(msg)
                sent_count += len(valid_emails)
            except Exception as e:
                errors.append(f"CHYBA SMTP pre {valid_emails}: {str(e)}")

        if sent_count == 0 and errors:
            return jsonify({'error': 'Nepodarilo sa odoslať žiadny email.', 'details': errors}), 500

        msg_text = f'Odoslané na {sent_count} adries.'
        if errors:
            msg_text += f" (Chyby: {'; '.join(errors)})"

        return jsonify({'success': True, 'message': msg_text})

    except Exception as e:
        print(f"CRITICAL MAIL ERROR: {e}")
        return jsonify({'error': str(e)}), 500