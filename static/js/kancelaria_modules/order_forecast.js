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
      <button class="btn btn-secondary js-tab" data-tab="inventory">Inventúra Expedície</button>
    </div>

    <div id="ofc-views" class="stat-card" style="padding:1rem;">
      <div id="forecast-tab-content"   data-view="forecast"   style="display:block;"></div>
      <div id="purchase-tab-content"   data-view="purchase"   style="display:none;"></div>
      <div id="promotions-tab-content" data-view="promotions" style="display:none;"></div>
      <div id="inventory-tab-content"  data-view="inventory"  style="display:none;"></div>
    </div>
  `;

  const tabs = container.querySelectorAll('.js-tab');
  const viewsWrap = container.querySelector('#ofc-views');

  function setActiveTab(key) {
    tabs.forEach(btn => {
      btn.classList.remove('btn-primary'); btn.classList.add('btn-secondary');
      if (btn.dataset.tab === key) { btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary'); }
    });
    Array.from(viewsWrap.children).forEach(v => v.style.display = (v.getAttribute('data-view') === key ? 'block' : 'none'));

    switch (key) {
      case 'forecast':  loadAndRenderForecast(); break;
      case 'purchase':  loadAndRenderPurchaseSuggestion(); break;
      case 'promotions':loadAndRenderPromotionsManager(); break;
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
// === 2. EXISTUJÚCE FUNKCIE (Forecast, Purchase, Promo) ===========
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
        html += `<h4>${h}</h4><div class="table-container"><table><thead><tr><th>Tovar</th><th>Sklad</th><th>Min</th><th>Návrh</th></tr></thead><tbody>`;
        byCat[h].forEach(i => {
            const isLow = (i.stock - i.reserved) < i.min_stock;
            html += `<tr ${isLow?'style="background:#fff7ed"':''}><td>${escapeHtml(i.name)}</td><td>${i.stock} ${i.unit}</td><td>${i.min_stock}</td><td class="loss"><b>${i.suggestion}</b></td></tr>`;
        });
        html += `</tbody></table></div>`;
    });
    container.innerHTML = html;
  } catch(e) { container.innerHTML = `<div class="error">${e.message}</div>`; }
}

// ---------- Správa akcií (VYLEPŠENÉ PRIDÁVANIE - COMBOBOX) ----------
async function loadAndRenderPromotionsManager() {
  const container = document.getElementById('promotions-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="text-muted" style="padding:1rem;">Načítavam správu akcií...</div>';

  try {
    const data = await getJSON('/api/kancelaria/get_promotions_data');
    const { chains = [], promotions = [], products = [] } = data || {};
    const today = new Date().toISOString().split('T')[0];

    // --- SPRACOVANIE DÁT ---
    const productMap = {};
    const categoriesSet = new Set();
    
    products.forEach(p => {
        productMap[p.ean] = p;
        p._searchStr = `${p.name} ${p.ean}`.toLowerCase(); // Pre rýchlejšie hľadanie
        if(p.predajna_kategoria) categoriesSet.add(p.predajna_kategoria);
    });
    const categories = Array.from(categoriesSet).sort();

    // Obohatenie akcií o dáta
    promotions.forEach(p => {
        let prod = null;
        if (p.product_ean) prod = productMap[p.product_ean];
        if (!prod && p.product_name) {
             prod = products.find(x => x.name === p.product_name);
        }
        p._category = prod ? (prod.predajna_kategoria || 'Nezaradené') : 'Nezaradené';
        p._ean = prod ? prod.ean : (p.product_ean || '');
        p._searchStr = `${p.product_name} ${p._ean}`.toLowerCase();
    });

    const chainOptions = chains.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const catOptions = categories.map(c => `<option value="${c}">${c}</option>`).join('');

    container.innerHTML = `
      <div class="form-grid">
        <!-- FORMULÁR NA PRIDANIE AKCIE (S NAŠEPKÁVAČOM) -->
        <div>
          <h4>Vytvoriť Novú Akciu</h4>
          <form id="add-promotion-form">
            <div class="form-group">
              <label>Obchodný Reťazec</label>
              <select name="chain_id" required class="form-control">
                <option value="">-- vyber --</option>
                ${chainOptions}
              </select>
            </div>

            <!-- INTELIGENTNÝ VÝBER PRODUKTU -->
            <div class="form-group" style="background:#f0f9ff; padding:10px; border:1px solid #bae6fd; border-radius:5px; position:relative;">
              <label style="color:#0284c7; font-weight:bold;">Produkt v Akcii</label>
              
              <!-- 1. Filter Kategórie -->
              <div style="margin-bottom:5px;">
                 <label style="font-size:0.75rem; color:#666;">Kategória:</label>
                 <select id="picker-category-filter" class="form-control" style="font-size:0.9rem;">
                    <option value="">Všetky kategórie</option>
                    ${catOptions}
                 </select>
              </div>

              <!-- 2. Vyhľadávacie pole (Našepkávač) -->
              <div style="position:relative;">
                  <input type="text" id="picker-search-input" class="form-control" placeholder="Hľadaj názov alebo EAN..." autocomplete="off" style="font-weight:bold;">
                  <!-- Skryté pole pre skutočnú EAN hodnotu -->
                  <input type="hidden" name="ean" id="real-ean-input" required>
                  
                  <!-- Zoznam výsledkov (Dropdown) -->
                  <div id="picker-results-list" style="display:none; position:absolute; top:100%; left:0; right:0; max-height:250px; overflow-y:auto; background:white; border:1px solid #ccc; z-index:1000; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
                  </div>
              </div>
              <div id="selected-product-display" style="margin-top:5px; font-size:0.85rem; color:#059669; font-weight:bold; min-height:1.2em;"></div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Platnosť Od</label>
                <input type="date" name="start_date" value="${today}" required class="form-control">
              </div>
              <div class="form-group">
                <label>Platnosť Do</label>
                <input type="date" name="end_date" value="${today}" required class="form-control">
              </div>
            </div>

            <div class="form-group">
              <label>Cena Počas Akcie (bez DPH)</label>
              <input type="number" name="sale_price_net" step="0.01" required class="form-control">
            </div>

            <button type="submit" class="btn btn-success" style="width:100%;">
              Uložiť Akciu
            </button>
          </form>
        </div>

        <!-- SPRÁVA REŤAZCOV -->
        <div>
          <h4>Správa Obchodných Reťazcov</h4>
          <ul id="chains-list">
            ${chains.map(c => `
              <li>
                ${c.name}
                <button onclick="manageChain('delete', ${c.id})" class="btn btn-danger" style="padding:.125rem .4rem; font-size:.8rem; margin-left:.5rem;">X</button>
              </li>
            `).join('')}
          </ul>
          <div class="form-group" style="display:flex; gap:.5rem; align-items:flex-end;">
            <div style="flex:1;">
              <label>Nový reťazec:</label>
              <input type="text" id="new-chain-name" class="form-control">
            </div>
            <button onclick="manageChain('add')" class="btn btn-primary" style="margin:0; height:38px;">Pridať</button>
          </div>
        </div>
      </div>

      <hr style="margin: 2rem 0;">

      <!-- FILTRE PRE TABUĽKU -->
      <h4 style="margin-top:1rem;">Prehľad Naplánovaných Akcií</h4>
      
      <div style="background:#f8f9fa; padding:15px; border-radius:5px; margin-bottom:15px; display:flex; gap:15px; flex-wrap:wrap; align-items:end;">
        <div style="flex:1; min-width:200px;">
            <label style="font-size:0.85rem; font-weight:bold;">Hľadať (Názov, EAN)</label>
            <input type="text" id="promo-filter-search" class="form-control" placeholder="Napíšte názov alebo EAN...">
        </div>
        <div style="flex:1; min-width:200px;">
            <label style="font-size:0.85rem; font-weight:bold;">Kategória</label>
            <select id="promo-filter-cat" class="form-control">
                <option value="">Všetky kategórie</option>
                ${catOptions}
            </select>
        </div>
        <div style="flex:1; min-width:200px;">
             <label style="font-size:0.85rem; font-weight:bold;">Reťazec</label>
             <select id="promo-filter-chain" class="form-control">
                <option value="">Všetky reťazce</option>
                ${chainOptions}
            </select>
        </div>
      </div>

      <!-- TABUĽKA -->
      <div class="table-container" style="max-height:600px;">
        <table class="table table-striped">
          <thead>
            <tr>
              <th>Reťazec</th>
              <th>EAN</th>
              <th>Produkt</th>
              <th>Kategória</th>
              <th>Trvanie</th>
              <th>Akciová Cena</th>
              <th>Akcia</th>
            </tr>
          </thead>
          <tbody id="promotions-table-body"></tbody>
        </table>
      </div>
    `;

    // --- 1. LOGIKA PRE "INTELIGENTNÝ VÝBER" PRODUKTU ---
    const pickerSearch = document.getElementById('picker-search-input');
    const pickerCat = document.getElementById('picker-category-filter');
    const pickerList = document.getElementById('picker-results-list');
    const realEanInput = document.getElementById('real-ean-input');
    const selectedDisplay = document.getElementById('selected-product-display');

    function renderPickerResults() {
        const txt = pickerSearch.value.toLowerCase().trim();
        const cat = pickerCat.value;

        // Ak nič nepíše, nezobrazuj nič (alebo môžeme zobraziť top 10 z kategórie)
        if (txt.length === 0 && cat === '') {
            pickerList.style.display = 'none';
            return;
        }

        let matches = products.filter(p => {
            if (cat && p.predajna_kategoria !== cat) return false;
            if (txt && !p._searchStr.includes(txt)) return false;
            return true;
        });

        // Obmedzíme počet výsledkov na 50 aby to nesekalo
        matches = matches.slice(0, 50);

        if (matches.length === 0) {
            pickerList.innerHTML = '<div style="padding:8px; color:#888;">Žiadny produkt sa nenašiel.</div>';
            pickerList.style.display = 'block';
            return;
        }

        pickerList.innerHTML = matches.map(p => `
            <div class="picker-item" 
                 data-ean="${p.ean}" 
                 data-name="${escapeHtml(p.name)}"
                 style="padding:8px; border-bottom:1px solid #eee; cursor:pointer; display:flex; justify-content:space-between;">
                <span style="font-weight:bold;">${escapeHtml(p.name)}</span>
                <span style="color:#666; font-family:monospace;">${p.ean}</span>
            </div>
        `).join('');
        
        pickerList.style.display = 'block';

        // Pridanie click eventov na položky
        pickerList.querySelectorAll('.picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const ean = item.dataset.ean;
                const name = item.dataset.name;
                
                realEanInput.value = ean;
                pickerSearch.value = name; // Do inputu dáme názov
                selectedDisplay.innerText = `Vybrané: ${name} (EAN: ${ean})`;
                pickerList.style.display = 'none';
            });
            // Hover efekt cez JS (alebo CSS)
            item.addEventListener('mouseenter', () => item.style.backgroundColor = '#e0f2fe');
            item.addEventListener('mouseleave', () => item.style.backgroundColor = 'white');
        });
    }

    pickerSearch.addEventListener('input', () => {
        // Ak používateľ píše, vymažeme predchádzajúci výber EAN (aby neostal starý)
        if(realEanInput.value && pickerSearch.value !== selectedDisplay.innerText) {
             // realEanInput.value = ''; // Môžeme nechať, ale...
        }
        renderPickerResults();
    });
    pickerSearch.addEventListener('focus', renderPickerResults);
    pickerCat.addEventListener('change', () => {
        pickerSearch.value = ''; // Reset textu pri zmene kategórie
        renderPickerResults();
    });

    // Kliknutie mimo zatvorí zoznam
    document.addEventListener('click', (e) => {
        if (!pickerSearch.contains(e.target) && !pickerList.contains(e.target) && !pickerCat.contains(e.target)) {
            pickerList.style.display = 'none';
        }
    });


    // --- 2. LOGIKA FILTROVANIA TABUĽKY (Dolná časť) ---
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
            if (chainFilter) {
                 if (p.chain_id && String(p.chain_id) !== chainFilter) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Žiadne akcie nezodpovedajú filtru.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(p => {
            const from = p.start_date ? new Date(p.start_date).toLocaleDateString('sk-SK') : '';
            const to   = p.end_date   ? new Date(p.end_date).toLocaleDateString('sk-SK')   : '';
            const price = Number(p.sale_price_net || 0).toFixed(2);
            
            return `
            <tr>
              <td>${escapeHtml(p.chain_name || '')}</td>
              <td style="font-family:monospace; font-size:0.9em;">${escapeHtml(p._ean)}</td>
              <td>${escapeHtml(p.product_name || '')}</td>
              <td><span class="badge badge-info" style="font-weight:normal; background:#e0f2fe; color:#0369a1;">${escapeHtml(p._category)}</span></td>
              <td>${from} - ${to}</td>
              <td style="font-weight:bold;">${price} €</td>
              <td>
                <button class="btn btn-danger btn-sm" onclick="deletePromotion(${p.id})">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          `;
        }).join('');
    }

    searchInput.addEventListener('input', renderTable);
    catSelect.addEventListener('change', renderTable);
    chainSelect.addEventListener('change', renderTable);

    renderTable();

    const form = document.getElementById('add-promotion-form');
    if (form) form.onsubmit = saveNewPromotion;

  } catch (e) {
    container.innerHTML = `<div class="error" style="padding:1rem;">${e.message}</div>`;
  }
}

async function saveNewPromotion(e) {
  e.preventDefault();
  
  // Validácia EAN (či bol vybratý z našepkávača)
  const eanInput = document.getElementById('real-ean-input');
  if (!eanInput || !eanInput.value) {
      alert('Prosím, vyberte produkt zo zoznamu (kliknite naň v našepkávači).');
      return;
  }

  const formData = new FormData(e.target);
  const payload = Object.fromEntries(formData.entries());
  try {
    await postJSON('/api/kancelaria/save_promotion', payload);
    e.target.reset();
    // Reset custom polí
    document.getElementById('selected-product-display').innerText = '';
    
    loadAndRenderPromotionsManager();
  } catch (err) {
    alert('Chyba pri ukladaní akcie: ' + err.message);
  }
}

async function deletePromotion(id) {
  if (!confirm('Naozaj chceš zmazať túto akciu?')) return;
  try {
    await postJSON('/api/kancelaria/delete_promotion', { id });
    loadAndRenderPromotionsManager();
  } catch (err) {
    alert('Chyba pri mazaní akcie: ' + err.message);
  }
}

async function manageChain(action, id) {
  try {
    if (action === 'add') {
      const input = document.getElementById('new-chain-name');
      const name = (input.value || '').trim();
      if (!name) {
        alert('Zadaj názov reťazca.');
        return;
      }
      await postJSON('/api/kancelaria/manage_promotion_chain', { action: 'add', name });
      input.value = '';
    } else if (action === 'delete') {
      if (!confirm('Naozaj chceš zmazať tento reťazec?')) return;
      await postJSON('/api/kancelaria/manage_promotion_chain', { action: 'delete', id });
    }
    loadAndRenderPromotionsManager();
  } catch (err) {
    alert('Chyba pri správe reťazca: ' + err.message);
  }
}


// Urgent modal
function openUrgentProductionModal(name, qty) {
    const today = new Date().toISOString().split('T')[0];
    showModal('Urgentná výroba', `
      <form onsubmit="submitUrgent(event, '${name}')">
        <h3>${name}</h3>
        <label>Množstvo:</label><input id="u-qty" value="${qty}" class="form-control">
        <label>Dátum:</label><input id="u-date" type="date" value="${today}" class="form-control">
        <button class="btn btn-success" style="margin-top:10px;">Odoslať</button>
      </form>
    `);
}
window.submitUrgent = async (e, name) => {
    e.preventDefault();
    const q = document.getElementById('u-qty').value;
    const d = document.getElementById('u-date').value;
    try {
        await postJSON('/api/kancelaria/create_urgent_task', { productName: name, quantity: q, productionDate: d });
        closeModal(); loadAndRenderForecast();
    } catch(err) { alert(err.message); }
}

// Globálny export
window.initializeOrderForecastModule = initializeOrderForecastModule;
window.viewExpeditionInventoryDetail = viewExpeditionInventoryDetail;
window.printExpeditionInventoryPDF = printExpeditionInventoryPDF;