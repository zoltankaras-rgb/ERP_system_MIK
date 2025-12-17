import os
import subprocess
from flask import Blueprint, request, jsonify
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
    Nájde cestu k wkhtmltopdf. Skúša štandardné cesty.
    """
    import pdfkit
    
    # Zoznam miest, kde to zvyčajne býva na Linuxe
    possible_paths = [
        '/usr/bin/wkhtmltopdf',
        '/usr/local/bin/wkhtmltopdf',
        '/opt/bin/wkhtmltopdf'
    ]

    # 1. Skúsime nájsť súbor v bežných cestách
    found_path = None
    for path in possible_paths:
        if os.path.exists(path):
            found_path = path
            break
    
    # 2. Ak sme nenašli, skúsime príkaz 'which'
    if not found_path:
        try:
            found_path = subprocess.check_output(['which', 'wkhtmltopdf']).decode('utf-8').strip()
        except:
            pass

    # 3. Ak máme cestu, vrátime konfiguráciu
    if found_path:
        print(f"DEBUG: wkhtmltopdf found at {found_path}")
        return pdfkit.configuration(wkhtmltopdf=found_path)
    
    # 4. Ak nič, vrátime None (pdfkit skúsi default, ale asi zlyhá)
    print("DEBUG: wkhtmltopdf NOT FOUND")
    return None

def generate_pricelist_html(items, customer_name, valid_from):
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; }}
            h1 {{ color: #333; }}
            .meta {{ margin-bottom: 20px; font-size: 14px; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
            th {{ background-color: #333; color: #fff; padding: 8px; border: 1px solid #000; text-align: left; }}
            td {{ padding: 8px; border: 1px solid #ddd; }}
            
            /* ZVÝRAZNENIE AKCIE */
            .action-row {{ background-color: #ffff99 !important; font-weight: bold; }}
            .action-badge {{ 
                background-color: #d32f2f; color: white; 
                padding: 3px 8px; border-radius: 4px; 
                font-size: 0.9em; font-weight: bold; text-transform: uppercase;
                margin-left: 5px;
            }}
            
            .price-up {{ color: red; font-weight: bold; }}
            .price-down {{ color: green; font-weight: bold; }}
        </style>
    </head>
    <body>
        <h1>Cenník produktov</h1>
        <div class="meta">
            <strong>Pre:</strong> {customer_name}<br>
            <strong>Platný od:</strong> {valid_from}
        </div>
        <table>
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>MJ</th>
                    <th>DPH</th>
                    <th>Cena (bez DPH)</th>
                    <th>Zmena</th>
                </tr>
            </thead>
            <tbody>
    """

    for item in items:
        is_action = item.get('is_action')
        row_class = "action-row" if is_action else ""
        
        old = float(item.get('old_price', 0) or 0)
        new = float(item.get('price', 0) or 0)
        dph = float(item.get('dph', 20))

        diff_text = "-"
        price_class = ""
        if old > 0:
            if new > old:
                price_class = "price-up"
                diff_text = f"⬆"
            elif new < old:
                price_class = "price-down"
                diff_text = f"⬇"

        product_name = item.get('name', 'Produkt')
        if is_action:
            product_name += ' <span class="action-badge">AKCIA</span>'

        html_content += f"""
            <tr class="{row_class}">
                <td>{product_name}</td>
                <td>{item.get('mj', 'kg')}</td>
                <td>{int(dph)}%</td>
                <td class="{price_class}">{new:.2f} €</td>
                <td style="text-align:center">{diff_text}</td>
            </tr>
        """

    html_content += f"""
            </tbody>
        </table>
        <p><small>Vygenerované dňa {datetime.now().strftime("%d.%m.%Y %H:%M")}</small></p>
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
        # Získame konfiguráciu s cestou k exe súboru
        config = get_wkhtmltopdf_config()
        
        # Nastavenia pre PDFKit
        options = {
            'encoding': "UTF-8",
            'no-outline': None,
            'enable-local-file-access': None,
            'quiet': ''
        }

        sent_count = 0
        errors = []
        
        for cust in customers:
            # Spracovanie emailov (oddeľovač čiarka alebo bodkočiarka)
            raw_emails = cust.get('email', '').replace(';', ',').split(',')
            valid_emails = [e.strip() for e in raw_emails if '@' in e]

            if not valid_emails: 
                errors.append(f"Zákazník {cust.get('name')} nemá platný email.")
                continue

            html = generate_pricelist_html(items, cust.get('name', 'Zákazník'), valid_from)
            
            try:
                # Generovanie PDF s použitím konfigurácie
                if config:
                    pdf_bytes = pdfkit.from_string(html, False, configuration=config, options=options)
                else:
                    # Pokus bez configu (ak sa nenašla cesta), ale pravdepodobne zlyhá
                    pdf_bytes = pdfkit.from_string(html, False, options=options)

            except Exception as e:
                err_msg = f"CHYBA PDF pre {cust.get('name')}: {str(e)}"
                print(err_msg)
                errors.append(err_msg)
                continue

            # Odoslanie emailu
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