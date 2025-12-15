import os
from flask import Blueprint, request, jsonify, render_template_string
from db_connector import get_connection
import mail_handler  # Tvoj existujúci mail handler
import pdf_generator # Tvoj existujúci PDF generátor (bude treba malú úpravu)
from datetime import datetime

pricelist_bp = Blueprint('pricelist', __name__)

# --- POMOCNÁ FUNKCIA NA GENEROVANIE HTML PRE PDF ---
def generate_pricelist_html(items, customer_name, valid_from):
    """
    Vytvorí HTML tabuľku pre PDF. 
    Červená = Zdraženie
    Zelená = Zlacnenie
    Žltá = AKCIA
    """
    html_content = f"""
    <html>
    <head>
        <style>
            body {{ font-family: DejaVu Sans, Arial; }}
            h1 {{ color: #333; }}
            table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
            th {{ background-color: #f2f2f2; padding: 10px; border: 1px solid #ddd; text-align: left; }}
            td {{ padding: 8px; border: 1px solid #ddd; }}
            .price-up {{ color: red; font-weight: bold; }}
            .price-down {{ color: green; font-weight: bold; }}
            .action-row {{ background-color: #fffacd; }} /* Žlté pozadie pre akciu */
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
                    <th>Pôvodná cena</th>
                    <th>Nová cena</th>
                    <th>Zmena</th>
                </tr>
            </thead>
            <tbody>
    """

    for item in items:
        # Logika pre farby
        row_class = "action-row" if item.get('is_action') else ""
        price_class = ""
        diff_text = "-"
        
        old = float(item.get('old_price', 0))
        new = float(item.get('price', 0))

        if old > 0:
            if new > old:
                price_class = "price-up"
                diff_text = f"+{round(((new - old) / old) * 100, 1)}% ⬆"
            elif new < old:
                price_class = "price-down"
                diff_text = f"{round(((new - old) / old) * 100, 1)}% ⬇"

        product_name = item['name']
        if item.get('is_action'):
            product_name += ' <span class="action-badge">AKCIA!</span>'

        html_content += f"""
            <tr class="{row_class}">
                <td>{product_name}</td>
                <td>{f"{old:.2f} €" if old > 0 else "-"}</td>
                <td class="{price_class}">{new:.2f} €</td>
                <td class="{price_class}">{diff_text}</td>
            </tr>
        """

    html_content += """
            </tbody>
        </table>
        <p><small>Vygenerované systémom ERP MIK dňa """ + datetime.now().strftime("%d.%m.%Y") + """</small></p>
    </body>
    </html>
    """
    return html_content

# --- API ENDPOINT PRE ODOSLANIE CENNÍKA ---
@pricelist_bp.route('/api/send_custom_pricelist', methods=['POST'])
def send_custom_pricelist():
    try:
        data = request.json
        customers = data.get('customers', []) # Zoznam emailov: [{'email': '...', 'name': '...'}]
        items = data.get('items', [])         # Zoznam produktov s cenami
        valid_from = data.get('valid_from', datetime.now().strftime("%d.%m.%Y"))

        if not customers or not items:
            return jsonify({'status': 'error', 'message': 'Chýbajú zákazníci alebo položky'}), 400

        # 1. Vygenerovanie PDF (jedno PDF pre všetkých alebo custom pre každého)
        # Tu generujeme HTML, ktoré potom PDF generátor prerobí
        
        # Pre každého zákazníka vygenerujeme a pošleme mail
        sent_count = 0
        
        for customer in customers:
            # Generujeme HTML cenník
            html_source = generate_pricelist_html(items, customer['name'], valid_from)
            
            # Uloženie dočasného PDF
            pdf_filename = f"cennik_{customer['name'].replace(' ', '_')}_{datetime.now().strftime('%Y%m%d')}.pdf"
            pdf_path = os.path.join('static', 'temp_pdf', pdf_filename)
            
            # Volať tvoj existujúci PDF generátor (alebo použiť knižnicu napr. pdfkit/weasyprint)
            # Tu predpokladám, že tvoj pdf_generator má funkciu 'create_from_html'
            # Ak nie, dá sa to spraviť jednoducho cez 'pdfkit.from_string(html_source, pdf_path)'
            import pdf_generator # Prípadne použi tvoj pdf_generator
            try:
                # Konfigurácia pre wkhtmltopdf (treba mať nainštalované na serveri)
              pdf_generator.from_string(html_source, pdf_path)
            except Exception as e:
                # Fallback ak nemáš pdfkit, len pre ukážku
                print(f"Chyba PDF generovania: {e}")
                continue

            # 2. Odoslanie mailu cez tvoj mail_handler
            subject = f"Nový Cenník MIK (Platný od {valid_from})"
            body = f"""
            Dobrý deň {customer['name']},
            
            v prílohe vám zasielame aktualizovaný cenník platný od {valid_from}.
            
            V cenníku sú vyznačené zmeny cien a aktuálne AKCIE.
            
            S pozdravom,
            Tím MIK
            """
            
            # Odoslanie
            mail_handler.send_email_with_attachment(
                to_email=customer['email'],
                subject=subject,
                body=body,
                attachment_path=pdf_path
            )
            
            sent_count += 1
            
            # Upratanie (zmazanie PDF po odoslaní)
            # os.remove(pdf_path) 

        return jsonify({'status': 'success', 'message': f'Cenník odoslaný {sent_count} zákazníkom.'})

    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500