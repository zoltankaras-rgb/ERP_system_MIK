import os
from flask import Blueprint, request, jsonify
from flask_mail import Message
from datetime import datetime

# Lazy import
try:
    from app import mail
except ImportError:
    mail = None

pricelist_bp = Blueprint('pricelist', __name__)

def generate_pricelist_html(items, customer_name, valid_from):
    html_content = f"""
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
        # Konfigurácia pre server (ak je potrebná)
        # config = pdfkit.configuration(wkhtmltopdf='/usr/bin/wkhtmltopdf')

        sent_count = 0
        
        for cust in customers:
            # Ak je v poli 'email' viac adries oddelených čiarkou
            raw_emails = cust.get('email', '').replace(';', ',').split(',')
            valid_emails = [e.strip() for e in raw_emails if '@' in e]

            if not valid_emails: continue

            html = generate_pricelist_html(items, cust.get('name', 'Zákazník'), valid_from)
            
            try:
                pdf_bytes = pdfkit.from_string(html, False) # options={'encoding': 'UTF-8'}
            except Exception as e:
                print(f"PDF Error: {e}")
                continue

            msg = Message(
                subject=f"Cenník MIK (od {valid_from})",
                recipients=valid_emails, # Flask-Mail berie zoznam ['a@a.sk', 'b@b.sk']
                body=f"Dobrý deň,\n\nv prílohe posielame aktuálny cenník.\n\nS pozdravom,\nMIK"
            )
            msg.attach(f"Cennik_{valid_from}.pdf", "application/pdf", pdf_bytes)
            
            mail.send(msg)
            sent_count += len(valid_emails)

        return jsonify({'success': True, 'message': f'Odoslané na {sent_count} adries.'})

    except Exception as e:
        print(f"MAIL ERROR: {e}")
        return jsonify({'error': str(e)}), 500