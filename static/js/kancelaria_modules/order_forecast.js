// static/js/kancelaria_modules/order_forecast.js
// =================================================================
// === SUB-MODUL KANCELÁRIA: EXPEDIČNÝ PLÁN / INVENTÚRY / AKCIE ====
// =================================================================

function initializeOrderForecastModule() {
  const container = document.getElementById('section-order-forecast');
  if (!container) return;

  // Shell s tabmi
  container.innerHTML = `
    <div class="btn-grid" style="margin-bottom:.5rem; display:flex; gap:10px; flex-wrap:wrap;">
      <button class="btn btn-primary js-tab" data-tab="forecast">7-dňový Prehľad</button>
      <button class="btn btn-secondary js-tab" data-tab="purchase">Návrh Nákupu Tovaru</button>
      <button class="btn btn-secondary js-tab" data-tab="promotions">Správa Akcií</button>
      <button class="btn btn-secondary js-tab" data-tab="promo_eval" style="background-color: #0f766e; border-color: #0f766e; color: white;">Vyhodnotenie Akcií</button>
      <button class="btn btn-secondary js-tab" data-tab="inventory">Inventúra Expedície</button>
    </div>

    <div id="ofc-views" class="stat-card" style="padding:1rem;">
      <div id="forecast-tab-content"   data-view="forecast"   style="display:block;"></div>
      <div id="purchase-tab-content"   data-view="purchase"   style="display:none;"></div>
      <div id="promotions-tab-content" data-view="promotions" style="display:none;"></div>
      <div id="promo-eval-tab-content" data-view="promo_eval" style="display:none;"></div>
      <div id="inventory-tab-content"  data-view="inventory"  style="display:none;"></div>
    </div>
  `;

  const tabs = container.querySelectorAll('.js-tab');
  const viewsWrap = container.querySelector('#ofc-views');

  function setActiveTab(key) {
    tabs.forEach(btn => {
      // Špeciálny styling pre vyhodnotenie, aby vizuálne ladilo
      if(btn.dataset.tab === 'promo_eval') {
          btn.style.backgroundColor = (key === 'promo_eval') ? '#0f766e' : 'transparent';
          btn.style.color = (key === 'promo_eval') ? 'white' : '#0f766e';
      } else {
          btn.classList.remove('btn-primary'); btn.classList.add('btn-secondary');
          if (btn.dataset.tab === key) { btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary'); }
      }
    });
    Array.from(viewsWrap.children).forEach(v => v.style.display = (v.getAttribute('data-view') === key ? 'block' : 'none'));

    switch (key) {
      case 'forecast':  loadAndRenderForecast(); break;
      case 'purchase':  loadAndRenderPurchaseSuggestion(); break;
      case 'promotions':loadAndRenderPromotionsManager(); break;
      case 'promo_eval':loadAndRenderPromotionEvaluation(); break;
      case 'inventory': loadAndRenderExpeditionInventory(); break;
    }
  }

  tabs.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
  setActiveTab('forecast');
}

// ---- Helpers ----
async function getJSON(url) {
  const r = await fetch(url, { method: 'GET', credentials: 'same-origin' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function postJSON(url, payload) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    credentials: 'same-origin', body: JSON.stringify(payload || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function safeToFixed(v, d=2) { const n=parseFloat(v); return isNaN(n)?(0).toFixed(d):n.toFixed(d); }
function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }


// =================================================================
// === 1. INVENTÚRA EXPEDÍCIE ======================================
// =================================================================

async function loadAndRenderExpeditionInventory() {
    const container = document.getElementById('inventory-tab-content');
    container.innerHTML = '<div class="text-muted">Načítavam históriu inventúr...</div>';

    try {
        const data = await getJSON('/api/kancelaria/getExpeditionInventoryHistory');
        const rows = data.history || [];

        if (rows.length === 0) {
            container.innerHTML = '<p>Zatiaľ nebola vykonaná žiadna inventúra v expedícii.</p>';
            return;
        }

        let html = `
            <h4>História Inventúr (Sklad 2 - Finálne výrobky)</h4>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Dátum</th>
                            <th>Vykonal</th>
                            <th>Status</th>
                            <th>Počet položiek</th>
                            <th>Hodnota rozdielu</th>
                            <th>Akcia</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        rows.forEach(r => {
            const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('sk-SK') : r.datum;
            const val = parseFloat(r.celkova_hodnota_rozdielu || 0);
            const color = val < 0 ? 'red' : (val > 0 ? 'green' : 'black');
            
            html += `
                <tr>
                    <td>${dateStr}</td>
                    <td>${escapeHtml(r.vytvoril)}</td>
                    <td>${escapeHtml(r.status)}</td>
                    <td>${r.poloziek}</td>
                    <td style="font-weight:bold; color:${color}">${safeToFixed(val)} €</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="viewExpeditionInventoryDetail(${r.id})">
                            <i class="fas fa-eye"></i> Detail / Tlač
                        </button>
                    </td>
                </tr>
            `;
        });
        
        html += `</tbody></table></div><div id="exp-inv-detail-area" style="margin-top:20px;"></div>`;
        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = `<div class="error">Chyba: ${e.message}</div>`;
    }
}

window.viewExpeditionInventoryDetail = async function(invId) {
    const area = document.getElementById('exp-inv-detail-area');
    area.innerHTML = '<div class="text-muted">Načítavam detail...</div>';
    area.scrollIntoView({behavior: 'smooth'});

    try {
        const data = await getJSON(`/api/kancelaria/getExpeditionInventoryDetail?id=${invId}`);
        const head = data.head;
        const items = data.items || [];

        const groups = {};
        let grandTotal = 0;

        items.forEach(i => {
            const cat = i.kategoria || 'Nezaradené';
            if (!groups[cat]) groups[cat] = { items: [], sum: 0 };
            
            groups[cat].items.push(i);
            const val = parseFloat(i.hodnota_eur || 0);
            groups[cat].sum += val;
            grandTotal += val;
        });

        const grandColor = grandTotal < 0 ? 'red' : (grandTotal > 0 ? 'green' : 'black');
        const dateStr = new Date(head.created_at).toLocaleString('sk-SK');

        let html = `
            <div class="stat-card" style="border:1px solid #ccc; padding:15px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:10px; margin-bottom:10px;">
                    <div>
                        <h3 style="margin:0;">Detail Inventúry #${head.id}</h3>
                        <div class="text-muted">Dátum: ${dateStr} | Vykonal: ${escapeHtml(head.vytvoril)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.9em;">Celková bilancia</div>
                        <div style="font-size:1.4em; font-weight:bold; color:${grandColor}">${safeToFixed(grandTotal)} €</div>
                    </div>
                </div>
                
                <button class="btn btn-warning" style="width:100%; margin-bottom:20px;" onclick='printExpeditionInventoryPDF(${JSON.stringify(head)}, ${JSON.stringify(groups)}, ${grandTotal})'>
                    <i class="fas fa-print"></i> STIAHNUŤ / TLAČIŤ PDF (A4)
                </button>

                <div class="table-container" style="max-height:500px; overflow-y:auto;">
        `;

        for (const cat of Object.keys(groups).sort()) {
            const g = groups[cat];
            const gColor = g.sum < 0 ? 'red' : (g.sum > 0 ? 'green' : 'black');
            
            html += `
                <h5 style="background:#f3f4f6; padding:8px; margin:15px 0 0 0; border-left:4px solid #3b82f6;">${escapeHtml(cat)}</h5>
                <table style="font-size:0.9rem; width:100%;">
                    <thead>
                        <tr style="background:#fff;">
                            <th>EAN</th> <th>Produkt</th>
                            <th style="text-align:right">Sys (kg)</th>
                            <th style="text-align:right">Real (kg)</th>
                            <th style="text-align:right">Rozdiel</th>
                            <th style="text-align:right">Hodnota</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            g.items.forEach(it => {
                const diff = parseFloat(it.rozdiel_kg);
                const val = parseFloat(it.hodnota_eur);
                html += `
                    <tr style="border-bottom:1px solid #eee;">
                        <td style="font-family:monospace; color:#555;">${escapeHtml(it.ean || '')}</td> <td>${escapeHtml(it.nazov)}</td>
                        <td style="text-align:right">${safeToFixed(it.system_stav_kg, 3)}</td>
                        <td style="text-align:right"><strong>${safeToFixed(it.realny_stav_kg, 3)}</strong></td>
                        <td style="text-align:right; color:${diff<0?'red':(diff>0?'green':'inherit')}">${diff>0?'+':''}${safeToFixed(diff, 3)}</td>
                        <td style="text-align:right; font-weight:bold; color:${val<0?'red':(val>0?'green':'inherit')}">${val>0?'+':''}${safeToFixed(val, 2)} €</td>
                    </tr>
                `;
            });

            html += `
                    </tbody>
                    <tfoot>
                        <tr style="background:#fafafa; font-weight: bold;">
                            <td colspan="5" style="text-align:right;">Bilancia ${escapeHtml(cat)}:</td>
                            <td style="text-align:right; color:${gColor}">${safeToFixed(g.sum)} €</td>
                        </tr>
                    </tfoot>
                </table>
            `;
        }

        html += `</div></div>`;
        area.innerHTML = html;

    } catch (e) {
        area.innerHTML = `<div class="error">Chyba: ${e.message}</div>`;
    }
};

window.printExpeditionInventoryPDF = function(head, groups, grandTotal) {
    const win = window.open('', '_blank');
    const dateStr = new Date(head.created_at).toLocaleString('sk-SK');
    const grandColor = grandTotal < 0 ? 'red' : 'black';

    let content = '';

    for (const cat of Object.keys(groups).sort()) {
        const g = groups[cat];
        const gColor = g.sum < 0 ? 'red' : 'black';

        let rows = '';
        g.items.forEach(it => {
             const diff = parseFloat(it.rozdiel_kg);
             const val = parseFloat(it.hodnota_eur);
             rows += `
                <tr>
                    <td style="font-family:monospace;">${escapeHtml(it.ean || '')}</td> <td>${escapeHtml(it.nazov)}</td>
                    <td class="num">${safeToFixed(it.system_stav_kg, 3)}</td>
                    <td class="num"><strong>${safeToFixed(it.realny_stav_kg, 3)}</strong></td>
                    <td class="num" style="color:${diff<0?'red':'inherit'}">${diff>0?'+':''}${safeToFixed(diff, 3)}</td>
                    <td class="num" style="font-weight:bold; color:${val<0?'red':'inherit'}">${val>0?'+':''}${safeToFixed(val, 2)} €</td>
                </tr>
             `;
        });

        content += `
            <div class="category-block">
                <h3>${escapeHtml(cat)}</h3>
                <table>
                    <thead>
                        <tr>
                            <th style="width:18%">EAN</th> <th style="width:32%">Produkt</th>
                            <th class="num" style="width:12%">Systém</th>
                            <th class="num" style="width:12%">Realita</th>
                            <th class="num" style="width:12%">Rozdiel</th>
                            <th class="num" style="width:14%">Hodnota</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" class="num" style="border-top:2px solid #000;">Bilancia ${escapeHtml(cat)}:</td>
                            <td class="num" style="border-top:2px solid #000; color:${gColor}">${safeToFixed(g.sum)} €</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    win.document.write(`
        <html>
        <head>
            <title>Inventúra Expedície ${head.id}</title>
            <style>
                @page { size: A4 portrait; margin: 1.5cm; }
                body { font-family: 'Segoe UI', sans-serif; font-size: 11px; color: #333; -webkit-print-color-adjust: exact; }
                h1 { margin: 0; font-size: 22px; text-transform: uppercase; }
                .header { border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:flex-end; }
                .meta { font-size: 14px; }
                
                .category-block { margin-bottom: 30px; page-break-inside: avoid; }
                h3 { margin: 0 0 5px 0; font-size: 14px; border-left: 5px solid #555; padding-left: 8px; text-transform: uppercase; }
                
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: middle; }
                th { background-color: #f0f0f0; font-weight: bold; font-size: 11px; }
                .num { text-align: right; }
                
                .grand-total { text-align: right; margin-top: 40px; font-size: 18px; font-weight: bold; border-top: 3px double #000; padding-top: 10px; }
                
                .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; text-align: center; color: #888; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>INVENTÚRA EXPEDÍCIE (Sklad 2)</h1>
                    <div class="meta">ID: <strong>${head.id}</strong> &nbsp;|&nbsp; Dátum: <strong>${dateStr}</strong></div>
                </div>
                <div class="meta">
                    Vykonal: <strong>${escapeHtml(head.vytvoril)}</strong>
                </div>
            </div>

            ${content}

            <div class="grand-total">
                CELKOVÁ BILANCIA: <span style="color:${grandColor}">${safeToFixed(grandTotal)} €</span>
            </div>

            <div class="footer">
                Vygenerované systémom MIK
            </div>

            <script>
                setTimeout(() => { window.print(); }, 500);
            <\/script>
        </body>
        </html>
    `);
    win.document.close();
};


// =================================================================
// === 2. 7-DŇOVÝ PREHĽAD A NÁKUP ==================================
// =================================================================

async function loadAndRenderForecast() {
  const container = document.getElementById('forecast-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="text-muted" style="padding:1rem;">Načítavam dáta...</div>';

  let base;
  try {
    base = await getJSON('/api/kancelaria/get_7_day_forecast');
  } catch (e) {
    container.innerHTML = `<div class="error" style="padding:1rem;">Chyba: ${e.message}</div>`;
    return;
  }

  const b2cCandidate = (base && (base.b2c_forecast || base.forecast_b2c || base.b2c)) 
    ? { dates: base.dates||[], forecast: (base.b2c_forecast||base.forecast_b2c||base.b2c)||{} } 
    : null;
  const payload = (b2cCandidate && b2cCandidate.forecast) ? mergeForecastPayloads(base, b2cCandidate) : base;

  try {
    const data = payload;
    if (!data?.forecast || Object.keys(data.forecast).length === 0) {
      container.innerHTML = '<div class="text-muted" style="padding:1rem;">Žiadne objednávky na 7 dní.</div>';
      return;
    }

    const dates = (data.dates || []).slice();
    const formattedDates = dates.map(d => new Date(d).toLocaleDateString('sk-SK', {day:'2-digit',month:'2-digit'}));

    let finalHtml = `<p>Prehľad potreby produktov (B2B + B2C). Deficit zvýraznený.</p>`;

    for (const category of Object.keys(data.forecast)) {
      finalHtml += `<h4 style="margin-top:1rem;">${category}</h4>`;
      let tableHtml = `
        <div class="table-container" style="max-height:none;">
          <table style="table-layout:fixed;">
            <thead>
              <tr>
                <th style="width:25%;">Produkt</th>
                <th style="width:10%;">Sklad</th>
                ${formattedDates.map(d => `<th style="width:7%;">${d}</th>`).join('')}
                <th style="width:10%;">Potreba</th>
                <th style="width:10%;">Deficit</th>
                <th style="width:11%;">Akcia</th>
              </tr>
            </thead>
            <tbody>
      `;

      (data.forecast[category] || []).forEach(product => {
        const total = dates.reduce((s, d) => s + (Number(product.daily_needs?.[d] || 0)), 0);
        const stockNum = parseStockNum(product.stock_display, product.mj);
        const deficit = Math.max(total - stockNum, 0);
        const isDeficit = deficit > 0;
        
        const actionBtn = (isDeficit && product.isManufacturable)
          ? `<button class="btn btn-primary" style="margin:0;" onclick="openUrgentProductionModal('${(product.name||'').replace(/'/g, "\\'")}', ${Math.ceil(deficit)})">Vytvoriť výrobu</button>`
          : '';

        tableHtml += `
          <tr ${isDeficit ? 'style="background:#fee2e2;"' : ''}>
            <td><strong>${product.name}</strong></td>
            <td>${product.stock_display}</td>
            ${dates.map(d => {
              const v = Number(product.daily_needs?.[d] || 0);
              return `<td>${v > 0 ? `${v} ${product.mj}` : ''}</td>`;
            }).join('')}
            <td>${total} ${product.mj}</td>
            <td class="${isDeficit ? 'loss' : ''}">${isDeficit ? Math.ceil(deficit) + ' ' + product.mj : '0'}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      });
      finalHtml += tableHtml + `</tbody></table></div>`;
    }
    container.innerHTML = finalHtml;
  } catch (e) { container.innerHTML = `<div class="error">${e.message}</div>`; }
}

function mergeForecastPayloads(a, b) {
  const dates = Array.from(new Set([...(a?.dates||[]), ...(b?.dates||[])])).sort();
  const out = { dates, forecast: {} };
  const add = (src) => {
    if (!src?.forecast) return;
    for (const cat of Object.keys(src.forecast)) {
      out.forecast[cat] = out.forecast[cat] || [];
      const idxByKey = new Map(out.forecast[cat].map((p, i) => [`${p.name}__${p.mj}`, i]));
      for (const p of src.forecast[cat]) {
        const key = `${p.name}__${p.mj}`;
        let target;
        if (idxByKey.has(key)) {
          target = out.forecast[cat][idxByKey.get(key)];
        } else {
          target = { name: p.name, mj: p.mj, stock_display: p.stock_display || '—', isManufacturable: !!p.isManufacturable, daily_needs: {} };
          dates.forEach(d => target.daily_needs[d] = 0);
          out.forecast[cat].push(target);
          idxByKey.set(key, out.forecast[cat].length - 1);
        }
        target.isManufacturable = !!(target.isManufacturable || p.isManufacturable);
        if ((p.stock_display||'').length > (target.stock_display||'').length) target.stock_display = p.stock_display;
        dates.forEach(d => { target.daily_needs[d] = Number(target.daily_needs[d]||0) + Number(p.daily_needs?.[d]||0); });
      }
    }
  };
  add(a); add(b);
  for (const cat of Object.keys(out.forecast)) {
    out.forecast[cat].forEach(p => {
      p.total_needed = out.dates.reduce((s, d) => s + Number(p.daily_needs?.[d]||0), 0);
      p.deficit = Math.max(p.total_needed - parseStockNum(p.stock_display, p.mj), 0);
    });
  }
  return out;
}
function parseStockNum(stock_display, mj) {
  if (!stock_display) return 0;
  const m = String(stock_display).match(/([0-9]+(?:[.,][0-9]+)?)\s*[a-zA-Z]*/);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// ---------- Návrh Nákupu ----------
async function loadAndRenderPurchaseSuggestion() {
  const container = document.getElementById('purchase-tab-content');
  container.innerHTML = '<div class="text-muted">Načítavam...</div>';
  try {
    const suggestions = await getJSON('/api/kancelaria/get_goods_purchase_suggestion');
    if (!suggestions || !suggestions.length) { container.innerHTML = '<div>Netreba nič objednať.</div>'; return; }
    
    const byCat = {};
    suggestions.forEach(i => {
        const h = i.predajna_kategoria || i.item_type || 'Bez kategórie';
        if(!byCat[h]) byCat[h]=[]; byCat[h].push(i);
    });
    
    let html = '';
    Object.keys(byCat).sort().forEach(h => {
        html += `<h4>${h}</h4><div class="table-container"><table><thead><tr><th>Tovar</th><th>Sklad</th><th>Min</th><th>Cena</th><th>Návrh</th></tr></thead><tbody>`;
        byCat[h].forEach(i => {
            const isLow = (i.stock - i.reserved) < i.min_stock;
            const priceStr = (i.price != null) ? Number(i.price).toFixed(2) + ' €' : '-';

            html += `<tr ${isLow?'style="background:#fff7ed"':''}>
                <td>${escapeHtml(i.name)}</td>
                <td>${i.stock} ${i.unit}</td>
                <td>${i.min_stock}</td>
                <td>${priceStr}</td>
                <td class="loss"><b>${i.suggestion}</b></td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    });
    container.innerHTML = html;
  } catch(e) { container.innerHTML = `<div class="error">${e.message}</div>`; }
}

// =================================================================
// === 3. SPRÁVA AKCIÍ =============================================
// =================================================================

async function loadAndRenderPromotionsManager() {
  const container = document.getElementById('promotions-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="text-muted" style="padding:1rem;">Načítavam správu akcií...</div>';

  try {
    const data = await getJSON('/api/kancelaria/get_promotions_data');
    const { chains = [], promotions = [], products = [] } = data || {};
    const today = new Date().toISOString().split('T')[0];

    const productMap = {};
    const categoriesSet = new Set();
    
    products.forEach(p => {
        productMap[p.ean] = p;
        p._searchStr = `${p.name} ${p.ean}`.toLowerCase();
        if(p.predajna_kategoria) categoriesSet.add(p.predajna_kategoria);
    });
    const categories = Array.from(categoriesSet).sort();

    promotions.forEach(p => {
        let prod = null;
        if (p.product_ean) prod = productMap[p.product_ean];
        if (!prod && p.product_name) prod = products.find(x => x.name === p.product_name);
        p._category = prod ? (prod.predajna_kategoria || 'Nezaradené') : 'Nezaradené';
        p._ean = prod ? prod.ean : (p.product_ean || '');
        p._searchStr = `${p.product_name} ${p._ean}`.toLowerCase();
    });

    const chainOptions = chains.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const catOptions = categories.map(c => `<option value="${c}">${c}</option>`).join('');

    container.innerHTML = `
      <div class="form-grid">
        <div>
          <h4>Vytvoriť Novú Akciu</h4>
          <form id="add-promotion-form">
            <div class="form-group">
              <label>Obchodný Reťazec</label>
              <select name="chain_id" required class="form-control"><option value="">-- vyber --</option>${chainOptions}</select>
            </div>

            <div class="form-group" style="background:#f0f9ff; padding:10px; border:1px solid #bae6fd; border-radius:5px; position:relative;">
              <label style="color:#0284c7; font-weight:bold;">Produkt v Akcii</label>
              <div style="margin-bottom:5px;">
                 <label style="font-size:0.75rem; color:#666;">Kategória:</label>
                 <select id="picker-category-filter" class="form-control" style="font-size:0.9rem;"><option value="">Všetky kategórie</option>${catOptions}</select>
              </div>
              <div style="position:relative;">
                  <input type="text" id="picker-search-input" class="form-control" placeholder="Hľadaj názov alebo EAN..." autocomplete="off" style="font-weight:bold;">
                  <input type="hidden" name="ean" id="real-ean-input" required>
                  <div id="picker-results-list" style="display:none; position:absolute; top:100%; left:0; right:0; max-height:250px; overflow-y:auto; background:white; border:1px solid #ccc; z-index:1000; box-shadow:0 4px 6px rgba(0,0,0,0.1);"></div>
              </div>
              <div id="selected-product-display" style="margin-top:5px; font-size:0.85rem; color:#059669; font-weight:bold; min-height:1.2em;"></div>
            </div>

            <div class="form-grid">
              <div class="form-group"><label>Platnosť Od</label><input type="date" name="start_date" value="${today}" required class="form-control"></div>
              <div class="form-group"><label>Platnosť Do</label><input type="date" name="end_date" value="${today}" required class="form-control"></div>
            </div>

            <div class="form-group"><label>Cena Počas Akcie (bez DPH)</label><input type="number" name="sale_price_net" step="0.01" required class="form-control"></div>
            <button type="submit" class="btn btn-success" style="width:100%;">Uložiť Akciu</button>
          </form>
        </div>

        <div>
          <h4>Správa Obchodných Reťazcov</h4>
          <ul id="chains-list">
            ${chains.map(c => `<li>${c.name} <button onclick="manageChain('delete', ${c.id})" class="btn btn-danger" style="padding:.125rem .4rem; font-size:.8rem; margin-left:.5rem;">X</button></li>`).join('')}
          </ul>
          <div class="form-group" style="display:flex; gap:.5rem; align-items:flex-end;">
            <div style="flex:1;"><label>Nový reťazec:</label><input type="text" id="new-chain-name" class="form-control"></div>
            <button onclick="manageChain('add')" class="btn btn-primary" style="margin:0; height:38px;">Pridať</button>
          </div>
        </div>
      </div>

      <hr style="margin: 2rem 0;">

      <h4 style="margin-top:1rem;">Prehľad Naplánovaných Akcií</h4>
      <div style="background:#f8f9fa; padding:15px; border-radius:5px; margin-bottom:15px; display:flex; gap:15px; flex-wrap:wrap; align-items:end;">
        <div style="flex:1; min-width:200px;"><label style="font-size:0.85rem; font-weight:bold;">Hľadať (Názov, EAN)</label><input type="text" id="promo-filter-search" class="form-control" placeholder="Napíšte názov alebo EAN..."></div>
        <div style="flex:1; min-width:200px;"><label style="font-size:0.85rem; font-weight:bold;">Kategória</label><select id="promo-filter-cat" class="form-control"><option value="">Všetky kategórie</option>${catOptions}</select></div>
        <div style="flex:1; min-width:200px;"><label style="font-size:0.85rem; font-weight:bold;">Reťazec</label><select id="promo-filter-chain" class="form-control"><option value="">Všetky reťazce</option>${chainOptions}</select></div>
      </div>

      <div class="table-container" style="max-height:600px;">
        <table class="table table-striped">
          <thead><tr><th>Reťazec</th><th>EAN</th><th>Produkt</th><th>Kategória</th><th>Trvanie</th><th>Akciová Cena</th><th>Akcia</th></tr></thead>
          <tbody id="promotions-table-body"></tbody>
        </table>
      </div>
    `;

    const pickerSearch = document.getElementById('picker-search-input');
    const pickerCat = document.getElementById('picker-category-filter');
    const pickerList = document.getElementById('picker-results-list');
    const realEanInput = document.getElementById('real-ean-input');
    const selectedDisplay = document.getElementById('selected-product-display');

    function renderPickerResults() {
        const txt = pickerSearch.value.toLowerCase().trim();
        const cat = pickerCat.value;
        if (txt.length === 0 && cat === '') { pickerList.style.display = 'none'; return; }

        let matches = products.filter(p => {
            if (cat && p.predajna_kategoria !== cat) return false;
            if (txt && !p._searchStr.includes(txt)) return false;
            return true;
        }).slice(0, 50);

        if (matches.length === 0) {
            pickerList.innerHTML = '<div style="padding:8px; color:#888;">Žiadny produkt sa nenašiel.</div>';
            pickerList.style.display = 'block'; return;
        }

        pickerList.innerHTML = matches.map(p => `
            <div class="picker-item" data-ean="${p.ean}" data-name="${escapeHtml(p.name)}" style="padding:8px; border-bottom:1px solid #eee; cursor:pointer; display:flex; justify-content:space-between;">
                <span style="font-weight:bold;">${escapeHtml(p.name)}</span>
                <span style="color:#666; font-family:monospace;">${p.ean}</span>
            </div>
        `).join('');
        pickerList.style.display = 'block';

        pickerList.querySelectorAll('.picker-item').forEach(item => {
            item.addEventListener('click', () => {
                realEanInput.value = item.dataset.ean; pickerSearch.value = item.dataset.name;
                selectedDisplay.innerText = `Vybrané: ${item.dataset.name} (EAN: ${item.dataset.ean})`;
                pickerList.style.display = 'none';
            });
            item.addEventListener('mouseenter', () => item.style.backgroundColor = '#e0f2fe');
            item.addEventListener('mouseleave', () => item.style.backgroundColor = 'white');
        });
    }

    pickerSearch.addEventListener('input', renderPickerResults);
    pickerSearch.addEventListener('focus', renderPickerResults);
    pickerCat.addEventListener('change', () => { pickerSearch.value = ''; renderPickerResults(); });

    document.addEventListener('click', (e) => {
        if (!pickerSearch.contains(e.target) && !pickerList.contains(e.target) && !pickerCat.contains(e.target)) pickerList.style.display = 'none';
    });

    const tbody = document.getElementById('promotions-table-body');
    const searchInput = document.getElementById('promo-filter-search');
    const catSelect = document.getElementById('promo-filter-cat');
    const chainSelect = document.getElementById('promo-filter-chain');

    function renderTable() {
        const searchText = searchInput.value.toLowerCase().trim();
        const catFilter = catSelect.value;
        const chainFilter = chainSelect.value; 

        const filtered = promotions.filter(p => {
            if (searchText && !p._searchStr.includes(searchText)) return false;
            if (catFilter && p._category !== catFilter) return false;
            if (chainFilter && String(p.chain_id) !== chainFilter) return false;
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Žiadne akcie nezodpovedajú filtru.</td></tr>'; return;
        }

        tbody.innerHTML = filtered.map(p => {
            const from = p.start_date ? new Date(p.start_date).toLocaleDateString('sk-SK') : '';
            const to   = p.end_date   ? new Date(p.end_date).toLocaleDateString('sk-SK')   : '';
            return `<tr><td>${escapeHtml(p.chain_name || '')}</td><td style="font-family:monospace; font-size:0.9em;">${escapeHtml(p._ean)}</td><td>${escapeHtml(p.product_name || '')}</td><td><span class="badge badge-info" style="font-weight:normal; background:#e0f2fe; color:#0369a1;">${escapeHtml(p._category)}</span></td><td>${from} - ${to}</td><td style="font-weight:bold;">${Number(p.sale_price_net || 0).toFixed(2)} €</td><td><button class="btn btn-danger btn-sm" onclick="deletePromotion(${p.id})"><i class="fas fa-trash"></i></button></td></tr>`;
        }).join('');
    }

    searchInput.addEventListener('input', renderTable);
    catSelect.addEventListener('change', renderTable);
    chainSelect.addEventListener('change', renderTable);
    renderTable();

    const form = document.getElementById('add-promotion-form');
    if (form) form.onsubmit = saveNewPromotion;

  } catch (e) { container.innerHTML = `<div class="error" style="padding:1rem;">${e.message}</div>`; }
}

async function saveNewPromotion(e) {
  e.preventDefault();
  const eanInput = document.getElementById('real-ean-input');
  if (!eanInput || !eanInput.value) { alert('Prosím, vyberte produkt zo zoznamu (kliknite naň v našepkávači).'); return; }
  const formData = new FormData(e.target);
  try {
    await postJSON('/api/kancelaria/save_promotion', Object.fromEntries(formData.entries()));
    e.target.reset(); document.getElementById('selected-product-display').innerText = '';
    loadAndRenderPromotionsManager();
  } catch (err) { alert('Chyba pri ukladaní akcie: ' + err.message); }
}

async function deletePromotion(id) {
  if (!confirm('Naozaj chceš zmazať túto akciu?')) return;
  try { await postJSON('/api/kancelaria/delete_promotion', { id }); loadAndRenderPromotionsManager(); }
  catch (err) { alert('Chyba pri mazaní akcie: ' + err.message); }
}

async function manageChain(action, id) {
  try {
    if (action === 'add') {
      const input = document.getElementById('new-chain-name');
      const name = (input.value || '').trim();
      if (!name) { alert('Zadaj názov reťazca.'); return; }
      await postJSON('/api/kancelaria/manage_promotion_chain', { action: 'add', name });
      input.value = '';
    } else if (action === 'delete') {
      if (!confirm('Naozaj chceš zmazať tento reťazec?')) return;
      await postJSON('/api/kancelaria/manage_promotion_chain', { action: 'delete', id });
    }
    loadAndRenderPromotionsManager();
  } catch (err) { alert('Chyba pri správe reťazca: ' + err.message); }
}

// =================================================================
// === 4. VYHODNOTENIE AKCIÍ (Ziskovosť) ===========================
// =================================================================

async function loadAndRenderPromotionEvaluation() {
  const container = document.getElementById('promo-eval-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="text-muted" style="padding:1rem;"><i class="fas fa-spinner fa-spin"></i> Načítavam dáta pre vyhodnotenie...</div>';

  try {
    const data = await getJSON('/api/kancelaria/get_promotions_data');
    
    // Bezpečné načítanie polí (ochrana pred "undefined")
    const chains = Array.isArray(data.chains) ? data.chains : [];
    const promotions = Array.isArray(data.promotions) ? data.promotions : [];
    const products = Array.isArray(data.products) ? data.products : [];

    const productMap = {};
    const categoriesSet = new Set();
    
    products.forEach(p => {
        productMap[p.ean] = p;
        if(p.predajna_kategoria) categoriesSet.add(p.predajna_kategoria);
    });

    const todayObj = new Date();
    todayObj.setHours(0,0,0,0);

    // Obohatenie akcií
    window.enrichedPromos = promotions.map(p => {
        let prod = null;
        if (p.product_ean) prod = productMap[p.product_ean];
        if (!prod && p.product_name) prod = products.find(x => x.name === p.product_name);
        
        const isEnded = p.end_date ? new Date(p.end_date) < todayObj : false;
        const sysBuyPrice = prod ? (parseFloat(prod.nakupna_cena) || 0) : 0;
        const savedBuyPrice = p.actual_purchase_price !== null && p.actual_purchase_price !== undefined ? parseFloat(p.actual_purchase_price) : sysBuyPrice;

        return {
            ...p,
            _category: prod ? (prod.predajna_kategoria || 'Nezaradené') : 'Nezaradené',
            _ean: prod ? prod.ean : (p.product_ean || ''),
            _mj: prod ? (prod.mj || 'kg') : 'kg',
            _isEnded: isEnded,
            _sysBuyPrice: sysBuyPrice,
            _savedBuyPrice: savedBuyPrice,
            _soldQty: parseFloat(p.sold_quantity) || 0,
            _searchStr: `${p.product_name} ${prod ? prod.ean : ''}`.toLowerCase()
        };
    });

    const chainOptions = chains.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const catOptions = Array.from(categoriesSet).sort().map(c => `<option value="${c}">${escapeHtml(c)}</option>`).join('');

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="color:#0f766e;">📊 Vyhodnotenie Ziskovosti Akcií</h3>
          <button class="btn btn-secondary" onclick="printPromoEvalReport()"><i class="fas fa-print"></i> Tlačiť Report</button>
      </div>
      <p class="text-muted" style="font-size:0.9rem;">Zadajte predané množstvo a upravte skutočnú nákupnú cenu pre výpočet marže a zisku ukončených akcií.</p>

      <div style="background:#f8f9fa; padding:15px; border-radius:5px; margin-bottom:15px; display:flex; gap:10px; flex-wrap:wrap; align-items:end; border:1px solid #dee2e6;">
        <div style="flex:1; min-width:150px;">
            <label style="font-size:0.8rem; font-weight:bold; color:#666;">Hľadať</label>
            <input type="text" id="peval-search" class="filter-input" style="width:100%;" placeholder="Názov, EAN...">
        </div>
        <div style="flex:1; min-width:130px;">
            <label style="font-size:0.8rem; font-weight:bold; color:#666;">Obdobie OD</label>
            <input type="date" id="peval-date-from" class="filter-input" style="width:100%;">
        </div>
        <div style="flex:1; min-width:130px;">
            <label style="font-size:0.8rem; font-weight:bold; color:#666;">Obdobie DO</label>
            <input type="date" id="peval-date-to" class="filter-input" style="width:100%;">
        </div>
        <div style="flex:1; min-width:150px;">
            <label style="font-size:0.8rem; font-weight:bold; color:#666;">Kategória</label>
            <select id="peval-cat" class="filter-input" style="width:100%;"><option value="">Všetky</option>${catOptions}</select>
        </div>
        <div style="flex:1; min-width:150px;">
             <label style="font-size:0.8rem; font-weight:bold; color:#666;">Reťazec</label>
             <select id="peval-chain" class="filter-input" style="width:100%;"><option value="">Všetky</option>${chainOptions}</select>
        </div>
        <div style="flex:1; min-width:120px;">
             <label style="font-size:0.8rem; font-weight:bold; color:#666;">Stav akcie</label>
             <select id="peval-status" class="filter-input" style="width:100%;">
                <option value="ended" selected>Tieto sú Ukončené</option>
                <option value="all">Všetky (aj aktívne)</option>
             </select>
        </div>
      </div>

      <div class="table-container" style="max-height: 60vh; overflow-y:auto;">
        <table class="table-refined" id="peval-table" style="width:100%; font-size:0.85rem;">
          <thead style="position:sticky; top:0; background:#f1f5f9; z-index:10; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
            <tr>
              <th>Stav & Trvanie</th>
              <th>Reťazec</th>
              <th>Produkt</th>
              <th style="text-align:right;">Akciová Cena<br>(Predaj)</th>
              <th style="text-align:right;">Nákupná cena<br>(Náklad)</th>
              <th style="text-align:right;">Predané<br>Množstvo</th>
              <th style="text-align:right;">Zisk €</th>
              <th style="text-align:right;">Marža %</th>
              <th style="text-align:center;">Uložiť</th>
            </tr>
          </thead>
          <tbody id="peval-tbody"></tbody>
          <tfoot style="position:sticky; bottom:0; background:#e2e8f0; font-weight:bold;">
            <tr>
               <td colspan="5" style="text-align:right;">SUMÁR ZOBRAZENÝCH:</td>
               <td style="text-align:right;" id="peval-sum-qty">0</td>
               <td style="text-align:right; color:#15803d;" id="peval-sum-profit">0.00 €</td>
               <td style="text-align:right; color:#15803d;" id="peval-sum-margin">0.0 %</td>
               <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    // Renderovanie tabuľky
    window.renderEvalTable = function() {
        const tbody = document.getElementById('peval-tbody');
        if (!tbody) return;
        
        const searchEl = document.getElementById('peval-search');
        const sSearch = searchEl ? searchEl.value.toLowerCase().trim() : '';
        const sFrom = document.getElementById('peval-date-from')?.value || '';
        const sTo = document.getElementById('peval-date-to')?.value || '';
        const sCat = document.getElementById('peval-cat')?.value || '';
        const sChain = document.getElementById('peval-chain')?.value || '';
        const sStatus = document.getElementById('peval-status')?.value || '';

        // OPRAVA: Prevedenie zadaných textov z kalendára na skutočné JS Dátumy
        let dFrom = null, dTo = null;
        if (sFrom) { dFrom = new Date(sFrom); dFrom.setHours(0,0,0,0); }
        if (sTo) { dTo = new Date(sTo); dTo.setHours(23,59,59,999); }

        let totalProfit = 0, totalRevenue = 0, totalQty = 0, html = '';

        if (Array.isArray(window.enrichedPromos)) {
            window.enrichedPromos.forEach(p => {
                if (sSearch && !p._searchStr.includes(sSearch)) return;
                if (sCat && p._category !== sCat) return;
                if (sChain && String(p.chain_id) !== sChain) return;
                if (sStatus === 'ended' && !p._isEnded) return;
                
                // OPRAVA: Prevedenie dátumov z databázy a ich korektné matematické porovnanie
                if (dFrom || dTo) {
                    let pStart = p.start_date ? new Date(p.start_date) : null;
                    let pEnd = p.end_date ? new Date(p.end_date) : null;
                    
                    if (pStart) pStart.setHours(0,0,0,0);
                    if (pEnd) pEnd.setHours(23,59,59,999);

                    // Akcia skončila pred našim filtrom "Od"
                    if (dFrom && pEnd && pEnd < dFrom) return;
                    // Akcia začne až po našom filtri "Do"
                    if (dTo && pStart && pStart > dTo) return;
                }

                const fromStr = p.start_date ? new Date(p.start_date).toLocaleDateString('sk-SK') : '';
                const toStr   = p.end_date   ? new Date(p.end_date).toLocaleDateString('sk-SK')   : '';
                const badge = p._isEnded 
                    ? `<span style="background:#fee2e2; color:#b91c1c; padding:2px 5px; border-radius:3px; font-size:0.7rem; font-weight:bold;">UKONČENÁ</span>` 
                    : `<span style="background:#dcfce7; color:#15803d; padding:2px 5px; border-radius:3px; font-size:0.7rem; font-weight:bold;">PREBIEHA</span>`;

                const sellPrice = parseFloat(p.sale_price_net || 0);
                const rowRev = sellPrice * p._soldQty;
                const rowCost = p._savedBuyPrice * p._soldQty;
                const rowProfit = rowRev - rowCost;
                
                totalQty += p._soldQty;
                totalRevenue += rowRev;
                totalProfit += rowProfit;

                html += `
                <tr data-promo-id="${p.id}" data-sell="${sellPrice}">
                  <td>${badge}<br><span style="font-size:0.8em; color:#666;">${fromStr} - ${toStr}</span></td>
                  <td style="font-weight:bold; color:#0369a1;">${escapeHtml(p.chain_name || '')}</td>
                  <td>
                    <div style="font-weight:600; color:#1e293b;">${escapeHtml(p.product_name)}</div>
                    <div style="font-size:0.75rem; color:#64748b;">EAN: ${escapeHtml(p._ean)} | Kat: ${escapeHtml(p._category)}</div>
                  </td>
                  <td style="text-align:right; font-weight:bold; color:#1d4ed8; vertical-align:middle;">${safeToFixed(sellPrice, 2)} €</td>
                  <td style="vertical-align:middle;">
                     <input type="number" step="0.01" class="filter-input p-buy-input" value="${p._savedBuyPrice}" style="width:80px; text-align:right;" oninput="recalcEvalRow(${p.id})">
                  </td>
                  <td style="vertical-align:middle;">
                     <div style="display:flex; align-items:center; justify-content:flex-end; gap:5px;">
                        <input type="number" step="0.01" class="filter-input p-qty-input" value="${p._soldQty || ''}" placeholder="0" style="width:80px; text-align:right;" oninput="recalcEvalRow(${p.id})">
                        <span style="color:#64748b;">${escapeHtml(p._mj)}</span>
                     </div>
                  </td>
                  <td style="text-align:right; vertical-align:middle; font-weight:bold;" class="p-profit-cell">0.00 €</td>
                  <td style="text-align:right; vertical-align:middle; font-weight:bold;" class="p-margin-cell">0.0 %</td>
                  <td style="text-align:center; vertical-align:middle;">
                     <button class="btn btn-success btn-sm p-save-btn" onclick="savePromoEval(${p.id})" style="padding:4px 8px; opacity:0.5;" title="Uložiť zmeny"><i class="fas fa-save"></i></button>
                  </td>
                </tr>
                `;
            });
        }

        if (!html) html = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">Žiadne akcie nevyhovujú filtrom.</td></tr>`;
        tbody.innerHTML = html;
        
        let totalMargin = 0;
        if(totalRevenue > 0) totalMargin = (totalProfit / totalRevenue) * 100;
        
        const elSumQty = document.getElementById('peval-sum-qty');
        if(elSumQty) elSumQty.innerText = safeToFixed(totalQty, 2);

        const pSum = document.getElementById('peval-sum-profit');
        const mSum = document.getElementById('peval-sum-margin');
        if(pSum) {
            pSum.innerText = `${safeToFixed(totalProfit, 2)} €`;
            pSum.style.color = totalProfit < 0 ? '#dc2626' : '#15803d';
        }
        if(mSum) {
            mSum.innerText = `${safeToFixed(totalMargin, 1)} %`;
            mSum.style.color = totalMargin < 10 ? (totalMargin < 0 ? '#dc2626' : '#d97706') : '#15803d';
        }

        if (Array.isArray(window.enrichedPromos)) {
            window.enrichedPromos.forEach(p => recalcEvalRow(p.id, false));
        }
    };

    window.recalcEvalRow = function(id, enableSaveBtn = true) {
        const row = document.querySelector(`tr[data-promo-id="${id}"]`);
        if (!row) return;

        const sell = parseFloat(row.dataset.sell) || 0;
        const buy = parseFloat(row.querySelector('.p-buy-input').value) || 0;
        const qty = parseFloat(row.querySelector('.p-qty-input').value) || 0;

        const rev = sell * qty;
        const profit = rev - (buy * qty);
        let margin = 0;
        if (rev > 0) margin = (profit / rev) * 100;

        const pCell = row.querySelector('.p-profit-cell');
        const mCell = row.querySelector('.p-margin-cell');
        const sBtn = row.querySelector('.p-save-btn');

        if(pCell) {
            pCell.innerText = `${profit > 0 ? '+' : ''}${safeToFixed(profit, 2)} €`;
            pCell.style.color = profit < 0 ? '#dc2626' : (profit > 0 ? '#15803d' : '#64748b');
        }
        if(mCell) {
            mCell.innerText = `${safeToFixed(margin, 1)} %`;
            mCell.style.color = margin < 0 ? '#dc2626' : (margin < 15 ? '#d97706' : '#15803d');
        }

        if(enableSaveBtn && sBtn) { 
            sBtn.style.opacity = '1'; 
            sBtn.style.boxShadow = '0 0 5px rgba(22, 163, 74, 0.5)'; 
        }
    };

    window.savePromoEval = async function(id) {
        const row = document.querySelector(`tr[data-promo-id="${id}"]`);
        if (!row) return;
        const sBtn = row.querySelector('.p-save-btn');
        if(sBtn) sBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const buy = parseFloat(row.querySelector('.p-buy-input').value) || 0;
        const qty = parseFloat(row.querySelector('.p-qty-input').value) || 0;

        try {
            await postJSON('/api/kancelaria/save_promotion_evaluation', { id: id, sold_quantity: qty, actual_purchase_price: buy });
            if (Array.isArray(window.enrichedPromos)) {
                const pObj = window.enrichedPromos.find(x => x.id === id);
                if(pObj) { pObj._soldQty = qty; pObj._savedBuyPrice = buy; }
            }
            if(sBtn) {
                sBtn.innerHTML = '<i class="fas fa-check"></i>';
                sBtn.style.opacity = '0.5'; sBtn.style.boxShadow = 'none';
                setTimeout(() => { sBtn.innerHTML = '<i class="fas fa-save"></i>'; }, 2000);
            }
            renderEvalTable();
        } catch (e) { 
            alert('Chyba pri ukladaní: ' + e.message); 
            if(sBtn) sBtn.innerHTML = '<i class="fas fa-save"></i>'; 
        }
    };

    window.printPromoEvalReport = function() {
        const sFrom = document.getElementById('peval-date-from')?.value;
        const sTo = document.getElementById('peval-date-to')?.value;
        const tbody = document.getElementById('peval-tbody');
        if(!tbody) return;
        
        const tBodyHTML = tbody.innerHTML;
        const sumQty = document.getElementById('peval-sum-qty')?.innerText || '0';
        const sumProfit = document.getElementById('peval-sum-profit')?.innerText || '0 €';
        const sumMargin = document.getElementById('peval-sum-margin')?.innerText || '0 %';

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = `<table><tbody>${tBodyHTML}</tbody></table>`;
        tempDiv.querySelectorAll('tr').forEach(tr => {
            if(tr.children.length >= 9) tr.removeChild(tr.lastElementChild);
            tr.querySelectorAll('input').forEach(inp => { inp.parentNode.innerHTML = `<span>${inp.value}</span>`; });
        });

        let periodStr = "Všetky obdobia";
        if (sFrom && sTo) periodStr = `Od ${new Date(sFrom).toLocaleDateString('sk-SK')} do ${new Date(sTo).toLocaleDateString('sk-SK')}`;
        else if (sFrom) periodStr = `Od ${new Date(sFrom).toLocaleDateString('sk-SK')}`;
        else if (sTo) periodStr = `Do ${new Date(sTo).toLocaleDateString('sk-SK')}`;

        const printWin = window.open('', '_blank');
        printWin.document.write(`
            <html><head><title>Vyhodnotenie Akcií</title><style>
                body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
                h2 { text-align: center; margin-bottom: 5px; }
                .subtitle { text-align: center; color: #555; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #000; padding: 6px; text-align: left; }
                th { background-color: #f0f0f0; } .num { text-align: right; }
            </style></head><body>
                <h2>Vyhodnotenie ziskovosti akcií</h2>
                <div class="subtitle">Obdobie: ${periodStr} | Vytlačené: ${new Date().toLocaleString('sk-SK')}</div>
                <table><thead><tr><th>Trvanie</th><th>Reťazec</th><th>Produkt</th><th class="num">Predajná Cena</th><th class="num">Nákupná (Náklad)</th><th class="num">Predané Množstvo</th><th class="num">Zisk €</th><th class="num">Marža %</th></tr></thead>
                <tbody>${tempDiv.querySelector('tbody').innerHTML}</tbody>
                <tfoot><tr style="font-weight:bold; background-color:#f0f0f0;"><td colspan="5" class="num">CELKOVÝ SUMÁR:</td><td class="num">${sumQty}</td><td class="num">${sumProfit}</td><td class="num">${sumMargin}</td></tr></tfoot>
                </table><script>setTimeout(()=>{window.print(); window.close();}, 500);</script>
            </body></html>`);
        printWin.document.close();
    };

    ['peval-search', 'peval-date-from', 'peval-date-to', 'peval-cat', 'peval-chain', 'peval-status']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(id === 'peval-search' ? 'input' : 'change', renderEvalTable);
        });

    renderEvalTable();

  } catch (e) { 
      container.innerHTML = `<div class="error" style="padding:1rem;">Zlyhanie pri načítaní dát. Prekontrolujte databázu alebo pripojenie.<br><br>Detail chyby: ${e.message}</div>`; 
  }
}
// Globálny export
window.initializeOrderForecastModule = initializeOrderForecastModule;
window.viewExpeditionInventoryDetail = viewExpeditionInventoryDetail;
window.printExpeditionInventoryPDF = printExpeditionInventoryPDF;