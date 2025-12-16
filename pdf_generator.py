# pdf_generator.py
# -----------------------------------------------------------------------------
# PDF + CSV potvrdenie objednávky.
# - PDF: Dodávateľ + kontakt na expedíciu, Odberateľ, Dátum dodania + ČAS VYZDVIHNUTIA,
#        položky, rozpis DPH, súhrn, podpisy, poďakovanie.
# -----------------------------------------------------------------------------

import os
import io
import csv
from html import escape as html_escape
from datetime import datetime, date

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ──────────────── Brand / farby ────────────────
BRAND = colors.HexColor("#b91c1c")
ACC   = colors.HexColor("#111827")
GRAY  = colors.HexColor("#6b7280")
LINE  = colors.HexColor("#e5e7eb")

# Dodávateľ + logo (konštanty)
SUPPLIER_NAME = "MIK, s.r.o."
SUPPLIER_LINES = [
    "MIK, s.r.o.",
    "IČO: 34099514",
    "DIČ: 2020374125",
    "IČ DPH: SK 2020374125",
    "Hollého 1999/13",
    "927 05 Šaľa",
    "Expedícia: 0905 518 114",
    "E-mail: miksroexpedicia@gmail.com",
]

# tvoje logo – Projekt/static/favicon.ico
LOGO_PATH = os.path.join(os.path.dirname(__file__), "static", "favicon.ico")


# ──────────────── Utility ────────────────

def _to_float(x, default=0.0):
    try:
        if x is None or x == "":
            return float(default)
        return float(x)
    except Exception:
        return float(default)


def _fmt_eur(val: float) -> str:
    s = f"{float(val):,.2f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", " ")
    return s + " €"


def _safe_date_str(s):
    """DD.MM.RRRR – používané v PDF."""
    if not s:
        return ""
    if isinstance(s, (datetime, date)):
        return s.strftime("%d.%m.%Y")
    try:
        return datetime.strptime(str(s), "%Y-%m-%d").strftime("%d.%m.%Y")
    except Exception:
        return str(s)


def _date_simple(s):
    """d.M.RRRR – požadované do CSV (napr. 28.8.2025)."""
    if not s:
        return ""
    if isinstance(s, (datetime, date)):
        return f"{s.day}.{s.month}.{s.year}"
    # skúsiť ISO
    try:
        d = datetime.strptime(str(s), "%Y-%m-%d")
        return f"{d.day}.{d.month}.{d.year}"
    except Exception:
        # skúsiť DD.MM.RRRR
        try:
            d = datetime.strptime(str(s), "%d.%m.%Y")
            return f"{d.day}.{d.month}.{d.year}"
        except Exception:
            return str(s)


def _fmt_dw(raw: str) -> str:
    """Ľudský popis vyzdvihnutia/doručenia (formátuje ID na text)."""
    if not raw:
        return ""
    raw = str(raw).strip()
    low = raw.lower()
    if low == "am":
        return "Dopoludnia"
    if low == "pm":
        return "Popoludní"
    if "workdays_08_12" in low:
        return "Po–Pia 08:00–12:00"
    if "workdays_12_15" in low:
        return "Po–Pia 12:00–15:00"
    
    # Formát: YYYY-MM-DD_HHMM-HHMM
    if "_" in raw and raw[:10].count("-") == 2:
        try:
            d = datetime.strptime(raw[:10], "%Y-%m-%d").strftime("%d.%m.%Y")
            label = raw[11:].replace("-", "–")
            # Ak label obsahuje čas (napr. 0800–1200), naformátujeme ho krajšie
            if len(label) >= 9 and label[0].isdigit():
                 # 0800–1200 -> 08:00–12:00
                 return f"{d} • {label[:2]}:{label[2:4]}–{label[5:7]}:{label[7:9]}"
            return f"{d} • {label}"
        except Exception:
            pass
    return raw


def _pick(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


# ──────────────── Fonty s diakritikou ──

def _try_register_font(name, path):
    try:
        if not os.path.isfile(path):
            return False
        pdfmetrics.registerFont(TTFont(name, path))
        return True
    except Exception:
        return False


def _register_fonts():
    """
    Skúsi zaregistrovať DejaVuSans (alebo NotoSans / Arial), vráti (base_font, bold_font).
    """
    base_env = os.getenv("PDF_BASE_FONT_PATH")
    bold_env = os.getenv("PDF_BOLD_FONT_PATH")

    base_candidates = [
        base_env,
        "static/fonts/DejaVuSans.ttf",
        "assets/fonts/DejaVuSans.ttf",
        "fonts/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/DejaVuSans.ttf",
    ]
    bold_candidates = [
        bold_env,
        "static/fonts/DejaVuSans-Bold.ttf",
        "assets/fonts/DejaVuSans-Bold.ttf",
        "fonts/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/DejaVuSans-Bold.ttf",
    ]

    base_name = "DejaVuSans"
    bold_name = "DejaVuSans-Bold"
    base_ok = any(_try_register_font(base_name, p) for p in base_candidates if p)
    bold_ok = any(_try_register_font(bold_name, p) for p in bold_candidates if p)

    if not base_ok:
        if _try_register_font("NotoSans", "static/fonts/NotoSans-Regular.ttf"):
            base_name = "NotoSans"
            if _try_register_font("NotoSans-Bold", "static/fonts/NotoSans-Bold.ttf"):
                bold_name = "NotoSans-Bold"
            else:
                bold_name = base_name
        elif _try_register_font("Arial", "C:/Windows/Fonts/arial.ttf"):
            base_name = "Arial"
            if _try_register_font("Arial-Bold", "C:/Windows/Fonts/arialbd.ttf"):
                bold_name = "Arial-Bold"
            else:
                bold_name = base_name

    return base_name, bold_name


# ──────────────── CSV (COOP štýl) ────────────────

def _make_csv(order):
    """
    COOP-štýl CSV pre expedíciu.
    """
    sio = io.StringIO(newline="")

    cust_name = order.get("customer_name") or ""
    cust_addr = order.get("customer_address") or ""
    cust_code = str(order.get("customer_code") or "").strip()
    date_str  = _date_simple(order.get("delivery_date"))
    
    order_no_val = str(order.get("order_no") or "").strip() 
    if not order_no_val:
        order_no_val = "000000"

    header_cols = [
        cust_name,   # názov odberateľa
        cust_name,   # názov odberateľa
        cust_addr,   # adresa
        cust_name,   # mesto/názov
        cust_name,   # prevádzka
        "",          # PSČ
        "",          
        date_str,    # dátum dodania
        "",          
    ]
    sio.write(";".join(header_cols) + "\n")

    konst = order_no_val 

    prev_label = cust_name.strip()
    if len(prev_label) > 25:
        prev_label = prev_label[:25]

    for it in order.get("items", []):
        ean   = str(it.get("ean") or "")
        name  = (it.get("name") or "").strip()
        qty   = _to_float(it.get("qty") or it.get("quantity"))
        price = _to_float(it.get("price"))

        code_field = ean[:13].ljust(13)
        desc_field = name[:45].ljust(45)
        qty_str    = f"{qty:.2f}"
        qty_field  = qty_str.rjust(5)
        odb_field  = cust_code[:13].ljust(13) if cust_code else "".ljust(13)

        line = (
            "  " +
            code_field + " " +
            desc_field +
            qty_field + " " +
            konst + " " +
            prev_label + " " +
            odb_field +
            " " * 15 +
            "0.00 " +
            f"{price:.2f}"
        )
        sio.write(line + "\n")

    return sio.getvalue().encode("cp1250", errors="replace")


# ──────────────── PDF ────────────────

def _make_pdf(order):
    base_font, bold_font = _register_fonts()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=26, bottomMargin=26, leftMargin=28, rightMargin=28
    )
    styles = getSampleStyleSheet()

    # Upravíme 'Title', aby nepadal KeyError
    try:
        styles['Title'].fontName = bold_font
        styles['Title'].fontSize = 14
        styles['Title'].textColor = ACC
    except KeyError:
        styles.add(ParagraphStyle(name='Title', parent=styles['Normal'],
                                  fontName=bold_font, fontSize=14, textColor=ACC))

    styles.add(ParagraphStyle(name='Small',  parent=styles['Normal'], fontName=base_font, fontSize=9,  leading=11))
    styles.add(ParagraphStyle(name='Label',  parent=styles['Normal'], fontName=bold_font, fontSize=9,  textColor=GRAY))
    styles.add(ParagraphStyle(name='Value',  parent=styles['Normal'], fontName=base_font, fontSize=9,  textColor=ACC))
    styles.add(ParagraphStyle(name='TH',     parent=styles['Normal'], fontName=bold_font, fontSize=8,  alignment=TA_CENTER, textColor=colors.white))
    styles.add(ParagraphStyle(name='TC',     parent=styles['Normal'], fontName=base_font, fontSize=8))
    styles.add(ParagraphStyle(name='Num',    parent=styles['Normal'], fontName=base_font, fontSize=8,  alignment=TA_RIGHT))
    styles.add(ParagraphStyle(name='Muted',  parent=styles['Normal'], fontName=base_font, fontSize=7,  textColor=GRAY))

    story = []

    # --- HLAVIČKA PDF ---
    left_top = [
        Paragraph("Potvrdenie objednávky", styles['Title']),
        Paragraph(f"Číslo: {html_escape(str(order['order_no']))}", styles['Small']),
        Paragraph(f"Dátum dodania: {_safe_date_str(order['delivery_date'])}", styles['Small']),
    ]

    # === TU SA PRIDÁVA ČASOVÉ OKNO VYZDVIHNUTIA ===
    if order.get("delivery_window"):
        dw_text = order["delivery_window"]
        left_top.append(Paragraph(f"<b>Čas vyzdvihnutia:</b> {html_escape(dw_text)}", styles['Small']))

    logo_flow = None
    if LOGO_PATH and os.path.isfile(LOGO_PATH):
        try:
            logo_flow = Image(LOGO_PATH, width=40, height=40)
        except Exception:
            logo_flow = None

    if logo_flow:
        top_tbl = Table(
            [[Paragraph("<br/>".join([p.text for p in left_top]), styles['Small']), logo_flow]],
            colWidths=[400, 80]
        )
        top_tbl.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('ALIGN',  (1,0), (1,0), 'RIGHT'),
        ]))
        story.append(top_tbl)
    else:
        for p in left_top:
            story.append(p)

    story.append(Spacer(1, 10))

    # Odberateľ vľavo, Dodávateľ vpravo
    cust_name = html_escape(order["customer_name"])
    cust_addr = html_escape(order["customer_address"] or "")

    odberatel_html = f"<b>Odberateľ</b><br/>{cust_name}"
    if cust_addr:
        odberatel_html += f"<br/>{cust_addr}"

    dodavatel_html = "<b>Dodávateľ</b><br/>" + "<br/>".join(html_escape(x) for x in SUPPLIER_LINES)

    sides_tbl = Table(
        [
            [Paragraph(odberatel_html, styles['Value']),
             Paragraph(dodavatel_html, styles['Value'])]
        ],
        colWidths=[260, 260]
    )
    sides_tbl.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(sides_tbl)
    story.append(Spacer(1, 10))

    # Poznámka
    if order["note"]:
        story.append(Paragraph("Poznámka", styles['Label']))
        story.append(Paragraph(html_escape(order["note"]), styles['Value']))
        story.append(Spacer(1, 6))

    # Vernostná odmena (za body)
    if order.get("points_reward_note"):
        story.append(Paragraph("Vernostná odmena (body)", styles['Label']))
        story.append(Paragraph(html_escape(order["points_reward_note"]), styles['Value']))
        story.append(Spacer(1, 6))

    # Odmeny (darčeky – napr. z kódu odmeny)
    if order.get("rewards"):
        story.append(Paragraph("Uplatnené darčeky/kódy", styles['Label']))
        for r in order["rewards"]:
            name = html_escape(r.get("label") or "Odmena")
            qty  = r.get("qty") or 1
            txt  = f"• {name} (× {qty})"
            story.append(Paragraph(txt, styles['Value']))
        story.append(Spacer(1, 6))

    # Položky
    story.append(Paragraph("Položky objednávky", styles['Label']))
    story.append(Spacer(1, 4))

    thead = [
        Paragraph("Položka", styles['TH']),
        Paragraph("MJ", styles['TH']),
        Paragraph("Množstvo", styles['TH']),
        Paragraph("Cena bez DPH", styles['TH']),
        Paragraph("DPH %", styles['TH']),
        Paragraph("Základ bez DPH", styles['TH']),
        Paragraph("DPH €", styles['TH']),
        Paragraph("Spolu s DPH", styles['TH']),
    ]

    rows = [thead]
    for it in order["items"]:
        # základ: názov + EAN
        base_label = (
            f"{html_escape(it['name'])}"
            f"<br/><font size=7 color='#6b7280'>EAN: {html_escape(str(it['ean']))}</font>"
        )

        # ak je poznámka k položke
        note = (it.get("item_note") or "").strip()
        if note:
            base_label += (
                f"<br/><font size=7 color='{BRAND.hexval()}'>"
                f"Pozn.: {html_escape(note)}"
                f"</font>"
            )

        rows.append([
            Paragraph(base_label, styles['TC']),
            Paragraph(html_escape(it['unit']), styles['TC']),
            Paragraph(f"{it['qty']:.3f}", styles['Num']),
            Paragraph(_fmt_eur(it['price']), styles['Num']),
            Paragraph(f"{it['dph']:.2f}", styles['Num']),
            Paragraph(_fmt_eur(it['line_net']), styles['Num']),
            Paragraph(_fmt_eur(it['line_vat']), styles['Num']),
            Paragraph(_fmt_eur(it['line_gross']), styles['Num']),
        ])

    tbl = Table(rows, colWidths=[180, 30, 45, 70, 40, 70, 50, 70], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), BRAND),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('LINEBELOW', (0,0), (-1,0), 0.5, colors.white),
        ('ALIGN', (2,1), (-1,-1), 'RIGHT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('GRID', (0,0), (-1,-1), 0.25, LINE),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white]),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 10))

    # Rozpis DPH
    story.append(Paragraph("Rozpis podľa sadzieb DPH", styles['Label']))

    drows = [[
        Paragraph("Sadzba", styles['TH']),
        Paragraph("Základ bez DPH", styles['TH']),
        Paragraph("DPH €", styles['TH']),
    ]]
    printed = set()
    for r in order["canonical_rates"]:
        base = order["base_by_rate"].get(r, 0.0)
        vat  = order["vat_by_rate"].get(r, 0.0)
        if base == 0 and vat == 0:
            continue
        printed.add(r)
        drows.append([
            Paragraph(f"{r:.2f} %", styles['TC']),
            Paragraph(_fmt_eur(base), styles['Num']),
            Paragraph(_fmt_eur(vat), styles['Num']),
        ])
    for r in order["rates_sorted"]:
        if r in printed:
            continue
        base = order["base_by_rate"].get(r, 0.0)
        vat  = order["vat_by_rate"].get(r, 0.0)
        drows.append([
            Paragraph(f"{r:.2f} %", styles['TC']),
            Paragraph(_fmt_eur(base), styles['Num']),
            Paragraph(_fmt_eur(vat), styles['Num']),
        ])

    dtab = Table(drows, colWidths=[60, 90, 70])
    dtab.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), BRAND),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('GRID', (0,0), (-1,-1), 0.25, LINE),
        ('ALIGN', (1,1), (-1,-1), 'RIGHT'),
    ]))
    story.append(dtab)
    story.append(Spacer(1, 10))

    # Súhrn
    story.append(Paragraph("Súhrn", styles['Label']))
    srows = [
        [Paragraph("Celkom bez DPH:", styles['TC']), Paragraph(_fmt_eur(order["total_net"]),   styles['Num'])],
        [Paragraph("DPH spolu:",     styles['TC']),  Paragraph(_fmt_eur(order["total_vat"]),   styles['Num'])],
        [Paragraph("Celkom s DPH:",  styles['TC']),  Paragraph(_fmt_eur(order["total_gross"]), styles['Num'])],
    ]
    stab = Table(srows, colWidths=[120, 80])
    stab.setStyle(TableStyle([
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('TEXTCOLOR', (0,0), (-1,-1), ACC),
    ]))
    story.append(stab)
    story.append(Spacer(1, 10))

    # Vystavil / Prevzal
    vp_rows = [
        [Paragraph("Vystavil", styles['Muted']), Paragraph("Prevzal", styles['Muted'])],
        [Paragraph("__________", styles['TC']), Paragraph("__________", styles['TC'])],
    ]
    vp_tab = Table(vp_rows, colWidths=[200, 200])
    vp_tab.setStyle(TableStyle([
        ('ALIGN', (0,1), (-1,1), 'CENTER'),
    ]))
    story.append(vp_tab)
    story.append(Spacer(1, 8))

    # Poďakovanie + vygenerované
    story.append(Paragraph("Ďakujeme za vašu objednávku.", styles['Small']))
    gen = datetime.now().strftime("%d.%m.%Y %H:%M")
    story.append(Paragraph(
        f"<font size='8' color='{GRAY.hexval()}'>Vygenerované {gen}</font>",
        ParagraphStyle('Foot', fontName=base_font, alignment=TA_RIGHT)
    ))

    doc.build(story)
    return buf.getvalue()


# ──────────────── Public API ────────────────
def create_order_files(order_data: dict):
    """
    Vráti (pdf_bytes, csv_bytes, csv_filename).
    """
    order_no   = _pick(order_data, "orderNumber", "order_number", default="—")
    cust_name  = _pick(order_data, "customerName", "customer_name", default="")
    cust_addr  = _pick(order_data, "customerAddress", "customer_address", default="")
    deliv_date = _pick(order_data, "deliveryDate", "delivery_date", default="")
    note       = _pick(order_data, "note", default="")
    raw_items  = order_data.get("items", []) or []
    cust_code  = _pick(order_data, "customerCode", "customer_code", default="")

    # Časové okno
    dw_raw     = _pick(order_data, "deliveryWindowPretty", "delivery_window", default="")
    delivery_window = _fmt_dw(dw_raw) if dw_raw else ""
    
    # Odmeny
    points_reward_note = _pick(order_data, "uplatnena_odmena_poznamka", "points_reward_note", default="")
    
    rewards_list = []
    for r in (order_data.get("rewards") or []):
        if not isinstance(r, dict):
            continue
        rewards_list.append({"label": r.get("label") or "Odmena", "qty": r.get("qty") or 1})

    items = []
    rates = set()
    total_net = 0.0
    total_vat = 0.0
    for it in raw_items:
        name = it.get("name") or it.get("nazov_vyrobku") or ""
        ean  = it.get("ean")  or it.get("ean_produktu") or ""
        unit = it.get("unit") or it.get("mj") or "ks"
        qty  = _to_float(it.get("quantity") or it.get("mnozstvo"))
        price= _to_float(it.get("price") or it.get("cena") or it.get("cena_bez_dph"))
        dph  = abs(_to_float(it.get("dph") or it.get("vat") or it.get("dph_percent")))
        line_net   = _to_float(it.get("line_net"),   default=price * qty)
        line_vat   = _to_float(it.get("line_vat"),   default=line_net * (dph/100.0))
        line_gross = _to_float(it.get("line_gross"), default=line_net + line_vat)
        total_net += line_net
        total_vat += line_vat
        rates.add(dph)
        items.append({
            "name": name, "ean": ean, "unit": unit,
            "qty": qty, "price": price, "dph": dph,
            "line_net": line_net, "line_vat": line_vat, "line_gross": line_net + line_vat,
            "item_note": it.get("item_note") or "",
        })

    # Použijeme sumy z order_data ak sú, inak vypočítané
    final_total_gross = _to_float(order_data.get("totalWithVat"), total_net + total_vat)
    final_total_net   = _to_float(order_data.get("totalNet"), total_net)
    final_total_vat   = _to_float(order_data.get("totalVat"), total_vat)

    canonical = [5.0, 10.0, 19.0, 23.0]
    base_by_rate = {r: 0.0 for r in canonical}
    vat_by_rate  = {r: 0.0 for r in canonical}
    for it in items:
        r = float(it["dph"])
        base_by_rate[r] = base_by_rate.get(r, 0.0) + it["line_net"]
        vat_by_rate[r]  = vat_by_rate.get(r, 0.0)  + it["line_vat"]
    others = sorted([r for r in rates if r not in canonical])

    order = {
        "order_no": order_no,
        "customer_name": cust_name,
        "customer_address": cust_addr,
        "delivery_date": deliv_date,
        "delivery_window": delivery_window, # <--- Tu sa ukladá formátovaný string
        "points_reward_note": points_reward_note,
        "rewards": rewards_list,
        "note": note,
        "items": items,
        "total_net": final_total_net,
        "total_vat": final_total_vat,
        "total_gross": final_total_gross,
        "canonical_rates": canonical,
        "rates_sorted": others,
        "base_by_rate": base_by_rate,
        "vat_by_rate":  vat_by_rate,
        "company_logo_path": order_data.get("company_logo_path"),
        "customer_code": cust_code,
    }

    # 1. Generovanie obsahu
    csv_bytes = _make_csv(order)
    pdf_bytes = _make_pdf(order)

    # 2. Generovanie názvu súboru
    safe_order_no = str(order_no).strip()
    parts = safe_order_no.split('-')

    if len(parts) >= 3:
        csv_filename = f"{parts[1]}_{parts[2]}.csv"
    else:
        safe_cust = str(cust_code).strip() if cust_code else "000000"
        now_str = datetime.now().strftime("%Y%m%d%H%M%S")
        csv_filename = f"{safe_cust}_{now_str}.csv"

    return pdf_bytes, csv_bytes, csv_filename

# ──────────────── PRIDANÉ PRE KOMPATIBILITU (SMART CENNÍKY) ────────────────
import re

def from_string(input_string: str, output_path=None, **kwargs):
    """
    Inteligentná funkcia, ktorá dokáže spracovať HTML tabuľku z API
    a vyrobiť z nej peknú PDF tabuľku.
    """
    base_font, bold_font = _register_fonts()
    
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, 
        pagesize=A4,
        topMargin=30, bottomMargin=30, leftMargin=30, rightMargin=30
    )
    
    styles = getSampleStyleSheet()
    style_normal = ParagraphStyle('Normal', parent=styles['Normal'], fontName=base_font, fontSize=9)
    style_title = ParagraphStyle('Title', parent=styles['Title'], fontName=bold_font, fontSize=16, spaceAfter=20, textColor=ACC)
    style_th = ParagraphStyle('TH', parent=styles['Normal'], fontName=bold_font, fontSize=9, textColor=colors.white, alignment=TA_CENTER)
    style_td = ParagraphStyle('TD', parent=styles['Normal'], fontName=base_font, fontSize=9)
    style_num = ParagraphStyle('Num', parent=styles['Normal'], fontName=base_font, fontSize=9, alignment=TA_RIGHT)
    
    story = []

    # 1. Extrahovanie nadpisu (ak je v <h1>)
    title_match = re.search(r'<h1>(.*?)</h1>', input_string, re.IGNORECASE)
    title_text = title_match.group(1) if title_match else "Cenník"
    # Odstránenie HTML tagov z nadpisu
    title_text = re.sub(r'<[^>]+>', '', title_text)
    story.append(Paragraph(title_text, style_title))

    # 2. Extrahovanie dátumu (ak je v <p>)
    date_match = re.search(r'<p>(.*?)</p>', input_string, re.IGNORECASE)
    if date_match:
        date_text = re.sub(r'<[^>]+>', '', date_match.group(1))
        story.append(Paragraph(date_text, style_normal))
        story.append(Spacer(1, 10))

    # 3. PARSOVANIE HTML TABUĽKY (Zázrak, ktorý opraví chybu)
    # Nájdi všetky riadky <tr>
    rows = re.findall(r'<tr.*?>(.*?)</tr>', input_string, re.DOTALL | re.IGNORECASE)
    
    table_data = []
    
    if rows:
        # Spracuj hlavičku (prvý riadok alebo <th>)
        header_cells = re.findall(r'<th.*?>(.*?)</th>', rows[0], re.DOTALL | re.IGNORECASE)
        if not header_cells:
             # Skúsime či prvy riadok nie sú td
             header_cells = re.findall(r'<td.*?>(.*?)</td>', rows[0], re.DOTALL | re.IGNORECASE)
        
        header_row = [Paragraph(re.sub(r'<[^>]+>', '', c).strip(), style_th) for c in header_cells]
        if header_row:
            table_data.append(header_row)

        # Spracuj zvyšné riadky (<tbody>)
        for i, row_html in enumerate(rows):
            # Preskočíme hlavičku ak sme ju už spracovali
            if i == 0 and header_cells: 
                # Kontrola či to bol naozaj header row
                if '<th' in rows[0]:
                    continue

            cells = re.findall(r'<td.*?>(.*?)</td>', row_html, re.DOTALL | re.IGNORECASE)
            if not cells: continue

            parsed_row = []
            for idx, cell_html in enumerate(cells):
                # Vyčisti HTML tagy (span, strong, atď)
                clean_text = re.sub(r'<[^>]+>', '', cell_html).strip()
                # Decode HTML entities (&euro; -> €)
                clean_text = clean_text.replace('&euro;', '€').replace('&#8364;', '€')
                
                # Urči štýl (Cena zarovnaná doprava)
                current_style = style_num if idx >= 1 and any(x in clean_text for x in ['€', '%']) else style_td
                
                # Zafarbíme zľavy na zeleno (ak to bol price-down)
                if 'price-down' in cell_html or 'green' in cell_html:
                    clean_text = f"<font color='green'>{clean_text}</font>"
                
                parsed_row.append(Paragraph(clean_text, current_style))
            
            if parsed_row:
                table_data.append(parsed_row)

    # 4. Vykreslenie tabuľky
    if table_data:
        # Dynamická šírka stĺpcov
        col_count = len(table_data[0])
        # Rozdelíme A4 šírku (cca 450 bodov)
        col_widths = [None] * col_count
        if col_count == 4:
            col_widths = [180, 80, 80, 80] # Pre váš formát: Produkt, Stará, Nová, Zmena
        
        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), BRAND),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('GRID', (0,0), (-1,-1), 0.5, LINE),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white]),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(t)
    else:
        # Fallback ak parsovanie zlyhá
        clean_text = re.sub(r'<[^>]+>', ' ', input_string)
        story.append(Paragraph(clean_text, style_normal))

    # Pätička
    gen = datetime.now().strftime("%d.%m.%Y %H:%M")
    story.append(Spacer(1, 20))
    story.append(Paragraph(f"<font color='#6b7280' size=7>Vygenerované {gen}</font>", style_normal))

    try:
        doc.build(story)
    except Exception as e:
        print(f"CRITICAL PDF ERROR: {e}")
        # Núdzový režim - čistý text
        fallback = io.BytesIO()
        fdoc = SimpleDocTemplate(fallback, pagesize=A4)
        fdoc.build([Paragraph("Chyba spracovania cenníka. Kontaktujte správcu.", style_normal)])
        return fallback.getvalue()

    pdf_bytes = buf.getvalue()
    
    if output_path:
        with open(output_path, 'wb') as f:
            f.write(pdf_bytes)
        return True

    return pdf_bytes
# ──────────────── CENNÍKY (DATABÁZOVÉ PDF) ────────────────

def create_pricelist_pdf(pricelist_data: dict):
    """
    Generuje PDF z dát (nie z HTML stringu).
    Očakáva: { "name": "Názov", "items": [{name, unit, price}, ...] }
    """
    # 1. Fonty
    base_font, bold_font = _register_fonts()
    
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=30, bottomMargin=30, leftMargin=30, rightMargin=30
    )
    styles = getSampleStyleSheet()

    # Vlastné štýly
    style_title = ParagraphStyle('PT', parent=styles['Title'], fontName=bold_font, fontSize=16, textColor=ACC, spaceAfter=10)
    style_sub = ParagraphStyle('PS', parent=styles['Normal'], fontName=base_font, fontSize=10, textColor=GRAY, spaceAfter=20)
    style_th = ParagraphStyle('PTH', parent=styles['Normal'], fontName=bold_font, fontSize=9, textColor=colors.white, alignment=TA_CENTER)
    style_td = ParagraphStyle('PTD', parent=styles['Normal'], fontName=base_font, fontSize=9)
    style_num = ParagraphStyle('PN', parent=styles['Normal'], fontName=base_font, fontSize=9, alignment=TA_RIGHT)

    story = []

    # 1. Nadpis
    name = pricelist_data.get("name", "Cenník")
    story.append(Paragraph(name, style_title))
    
    dt = datetime.now().strftime("%d.%m.%Y")
    story.append(Paragraph(f"Dátum vytvorenia: {dt}", style_sub))

    # 2. Dáta do tabuľky
    # Hlavička
    rows = [[
        Paragraph("Produkt", style_th),
        Paragraph("MJ", style_th),
        Paragraph("Cena", style_th)
    ]]

    # Položky
    items = pricelist_data.get("items", [])
    if not items:
        story.append(Paragraph("Žiadne položky.", style_td))
    else:
        for item in items:
            p_name = str(item.get("name", "")).strip()
            p_unit = str(item.get("unit", "ks"))
            try:
                p_price = float(item.get("price", 0))
            except:
                p_price = 0.0
            
            # Formátovanie ceny
            p_price_str = f"{p_price:.2f} €".replace(".", ",")

            rows.append([
                Paragraph(html_escape(p_name), style_td),
                Paragraph(html_escape(p_unit), style_td),
                Paragraph(p_price_str, style_num)
            ])

        # Vykreslenie tabuľky
        # Šírky stĺpcov (spolu cca 480-500 bodov na A4)
        t = Table(rows, colWidths=[330, 50, 100], repeatRows=1)
        
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), BRAND),       # Červená hlavička
            ('TEXTCOLOR', (0,0), (-1,0), colors.white), 
            ('ALIGN', (0,0), (-1,-1), 'LEFT'),
            ('ALIGN', (2,0), (-1,-1), 'RIGHT'),         # Ceny doprava
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('GRID', (0,0), (-1,-1), 0.5, LINE),        # Mriežka
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.whitesmoke, colors.white]),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 4),
            ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(t)

    # Pätička
    story.append(Spacer(1, 30))
    story.append(Paragraph("Vygenerované systémom MIK, s.r.o.", style_sub))

    doc.build(story)
    return buf.getvalue()