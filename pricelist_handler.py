import os
from flask import Blueprint, request, jsonify
from flask_mail import Message
from datetime import datetime

# Importujeme mail instanciu z app (alebo lazy import vo funkcii, ak je circular import)
try:
    from app import mail
except ImportError:
    mail = None

pricelist_bp = Blueprint('pricelist', __name__)

# --- POMOCNÁ FUNKCIA NA GENEROVANIE HTML ---
def generate_pricelist_html(items, customer_name, valid_from):
    html_content = f"""
    <html>
    <head>
        <style>
            body {{ font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; }}
            h1 {{ color: #333; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
            th {{ background-color: #f2f2f2; padding: 8px; border: 1px solid #ddd; text-align: left; }}
            td {{ padding: 8px; border: 1px solid #ddd; }}
            .price-up {{ color: red; font-weight: bold; }}
            .price-down {{ color: green; font-weight: bold; }}
            .action-row {{ background-color: #fffacd; }}
            .action-badge {{ background-color: #ff9800; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; }}
        </style>
    </head>
    <body>
        <h1>Cenník pre: {customer_name}</h1>
        <p>Platný od: {valid_from}</p>
        <table>
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>MJ</th>
                    <th>Cena (bez DPH)</th>
                    <th>Zmena</th>
                </tr>
            </thead>
            <tbody>
    """

    for item in items:
        row_class = "action-row" if item.get('is_action') else ""
        price_class = ""
        diff_text = "-"
        
        old = float(item.get('old_price', 0) or 0)
        new = float(item.get('price', 0) or 0)

        if old > 0:
            if new > old:
                price_class = "price-up"
                pct = ((new - old) / old) * 100
                diff_text = f"+{pct:.1f}% ⬆"
            elif new < old:
                price_class = "price-down"
                pct = ((old - new) / old) * 100
                diff_text = f"-{pct:.1f}% ⬇"

        product_name = item.get('name', 'Produkt')
        if item.get('is_action'):
            product_name += ' <span class="action-badge">AKCIA!</span>'

        mj = item.get('mj', 'kg')

        html_content += f"""
            <tr class="{row_class}">
                <td>{product_name}</td>
                <td>{mj}</td>
                <td class="{price_class}">{new:.2f} €</td>
                <td class="{price_class}">{diff_text}</td>
            </tr>
        """

    html_content += f"""
            </tbody>
        </table>
        <p><small>Vygenerované dňa {datetime.now().strftime("%d.%m.%Y")}</small></p>
    </body>
    </html>
    """
    return html_content

# --- API ENDPOINT ---
@pricelist_bp.route('/api/send_custom_pricelist', methods=['POST'])
def send_custom_pricelist():
    # Lazy import pre mail, aby sme predišli circular import errorom
    from app import mail
    if not mail:
        return jsonify({'status': 'error', 'message': 'Mail služba nie je inicializovaná.'}), 500

    try:
        data = request.json
        customers = data.get('customers', []) 
        items = data.get('items', [])         
        valid_from = data.get('valid_from', datetime.now().strftime("%d.%m.%Y"))

        if not customers or not items:
            return jsonify({'status': 'error', 'message': 'Chýbajú zákazníci alebo položky'}), 400

        sent_count = 0
        import pdfkit # Uistite sa, že máte nainštalované: pip install pdfkit a wkhtmltopdf v systéme

        # Nastavenie pre PDF (ak treba cestu k binárke)
        # config = pdfkit.configuration(wkhtmltopdf='/usr/bin/wkhtmltopdf') 
        
        for customer in customers:
            customer_name = customer.get('name', 'Zákazník')
            customer_email = customer.get('email')

            if not customer_email:
                continue

            # 1. Generovanie HTML
            html_source = generate_pricelist_html(items, customer_name, valid_from)
            
            # 2. Generovanie PDF do pamäte (nie na disk, je to rýchlejšie)
            try:
                pdf_data = pdfkit.from_string(html_source, False) # False = vráti bytes
            except Exception as e:
                print(f"Chyba PDF: {e}")
                return jsonify({'status': 'error', 'message': f'Chyba pri generovaní PDF: {str(e)}'}), 500

            # 3. Odoslanie emailu
            msg = Message(
                subject=f"Nový Cenník MIK (Platný od {valid_from})",
                recipients=[customer_email],
                body=f"Dobrý deň {customer_name},\n\nv prílohe vám zasielame nový cenník platný od {valid_from}.\n\nS pozdravom,\nTím MIK"
            )
            
            # Pridanie PDF ako prílohy
            msg.attach(
                filename=f"Cennik_{valid_from}.pdf",
                content_type="application/pdf",
                data=pdf_data
            )

            mail.send(msg)
            sent_count += 1

        return jsonify({'status': 'success', 'message': f'Cenník úspešne odoslaný {sent_count} zákazníkom.'})

    except Exception as e:
        print(f"CRITICAL ERROR sending pricelist: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500