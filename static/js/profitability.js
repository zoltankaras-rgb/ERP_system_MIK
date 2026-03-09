// ============================================================================
// === KANCELÁRIA: ZISKOVOSŤ / NÁKLADY (profitability.js) =====================
// ============================================================================

// ----- drobné utility (safe fallbacks) --------------------------------------
function _escapeHtmlLocal(str){
  return String(str ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}
function escapeHtml(s){
  try{
    const w = (typeof window !== 'undefined') ? window : {};
    const ext = (typeof w.escapeHtml === 'function' && w.escapeHtml !== escapeHtml) ? w.escapeHtml : null;
    return (ext || _escapeHtmlLocal)(s);
  }catch(_){
    return _escapeHtmlLocal(s);
  }
}
function safeToFixed(v, d=2){
  const n = Number(v ?? 0);
  if (!isFinite(n)) return (0).toFixed(d);
  return n.toLocaleString('sk-SK',{minimumFractionDigits:d, maximumFractionDigits:d});
}
async function apiP(url, opts={}){ return await apiRequest(url, opts); }

// Tichý JSON fetch – žiadne chyby do konzoly pri 404/CT
async function tryFetchJSON(url, options={}){
  try{
    const res = await fetch(url, { credentials:'include', ...options });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return await res.json();
  }catch(_){ return null; }
}

// CSS.escape fallback
const CSS_ESCAPE = (window.CSS && CSS.escape) ? CSS.escape : (s)=>String(s).replace(/[^a-zA-Z0-9_-]/g, ch => '\\'+ch);

// Integrácie (Fleet ON, Customers OFF by default)
const PROFITABILITY_INTEGRATIONS = (() => {
  const def = { fleet: true, customers: false };
  const ext = (typeof window.PROFITABILITY_INTEGRATIONS === 'object' && window.PROFITABILITY_INTEGRATIONS) || {};
  return { ...def, ...ext };
})();

// ----- lokálne štýly ---------------------------------------------------------
function ensureProfitPillStyles(){
  if (document.getElementById('profit-pill-styles')) return;
  const s = document.createElement('style');
  s.id = 'profit-pill-styles';
  s.textContent = `
    #section-profitability .b2b-tab-nav{ display:flex; gap:.5rem; flex-wrap:wrap; }
    #section-profitability .b2b-tab-button{
      appearance:none;border:0;cursor:pointer;
      padding:.55rem .9rem;border-radius:9999px;
      background: var(--light); color: var(--dark);
      font-family: var(--font); font-weight:600; letter-spacing:.2px;
      box-shadow: 0 1px 2px rgba(0,0,0,.06) inset;
      transition: transform .12s ease, box-shadow .15s ease, background-color .15s ease, color .15s ease;
    }
    #section-profitability .b2b-tab-button:hover{ filter: brightness(0.98); }
    #section-profitability .b2b-tab-button:active{ transform: translateY(1px); }
    #section-profitability .b2b-tab-button.active{
      color:#fff; background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.06)), var(--primary-color);
      box-shadow: var(--shadow);
    }
    #section-profitability .b2b-tab-content{ display:none; }
    #section-profitability .b2b-tab-content.active{ display:block; }

    #section-profitability .btn,
    #section-profitability .btn-success,
    #section-profitability .btn-info,
    #section-profitability .btn-warning,
    #section-profitability .btn-danger { border-radius:9999px; }

    /* Kanály – scroll tabuľky + akcie pod ňou */
    #section-profitability .channel-card{ margin-bottom: 2rem; }
    #section-profitability .table-scroll{ max-height:60vh; overflow:auto; }
    #section-profitability .channel-actions{ margin-top:1rem; }
    #section-profitability .channel-actions .btn-success{ width:100%; display:block; position: static !important; }

    /* Výroba – obaly */
    #section-profitability .prod-card{ margin-bottom: 1.5rem; }
    #section-profitability .prod-card .table-scroll{ max-height:50vh; overflow:auto; }
    #section-profitability .prod-actions{ margin-top:1rem; }
    #section-profitability .prod-actions .btn-success{ width:100%; display:block; position: static !important; }

    /* Badge/štítky */
    #section-profitability .kpi-badge{ display:inline-flex; align-items:center; gap:.35rem; padding:.3rem .55rem; border-radius:9999px; background:var(--light); font-weight:600; box-shadow: 0 1px 2px rgba(0,0,0,.06) inset; }
    #section-profitability .label-badge{ display:inline-block; padding:.2rem .5rem; border-radius:9999px; font-size:.8rem; font-weight:700; }
    #section-profitability .badge-green{ background:#e9f9ef; color:#126b2e; }
    #section-profitability .badge-gray{ background:#f2f2f2; color:#555; }
  `;
  document.head.appendChild(s);
}

// ----- globálny stav ---------------------------------------------------------
let profitabilityState = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth()+1,
  data:  {},
  currentCalculation: null
};

// ====== INIT ================================================================
function initializeProfitabilityModule(){
  ensureProfitPillStyles();
  const root = document.getElementById('section-profitability');
  if (!root) return;

  root.innerHTML = `
    <h3>Ziskovosť / Náklady</h3>

    <div style="display:flex; gap:1rem; align-items:flex-end; margin-bottom:1.5rem; flex-wrap:wrap;">
      <div class="form-group" style="margin-bottom:0;">
        <label for="profit-year-select" style="margin-top:0;">Rok:</label>
        <select id="profit-year-select"></select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label for="profit-month-select" style="margin-top:0;">Mesiac:</label>
        <select id="profit-month-select"></select>
      </div>
    </div>

    <div class="b2b-tab-nav" id="profit-main-nav">
      <button class="b2b-tab-button active" data-view="summary">Celkový prehľad</button>
      <button class="b2b-tab-button" data-view="departments">Oddelenia</button>
      <button class="b2b-tab-button" data-view="production">Výroba</button>
      <button class="b2b-tab-button" data-view="sales">Predajné kanály</button>
      <button class="b2b-tab-button" data-view="calculations">Kalkulácie / Súťaže</button>
    </div>

    <div id="profitability-content" class="b2b-tab-content active" style="margin-top:1.5rem;"></div>
  `;

  const yearSelect  = document.getElementById('profit-year-select');
  const monthSelect = document.getElementById('profit-month-select');
  const cy = new Date().getFullYear();
  for (let y=cy; y>=cy-3; y--) yearSelect.add(new Option(y, y));
  ["Január","Február","Marec","Apríl","Máj","Jún","Júl","August","September","Október","November","December"]
    .forEach((m,i)=>monthSelect.add(new Option(m, i+1)));
  yearSelect.value  = profitabilityState.year;
  monthSelect.value = profitabilityState.month;

  const loadData = ()=>{ 
    profitabilityState.year  = Number(yearSelect.value); 
    profitabilityState.month = Number(monthSelect.value); 
    loadAndRenderProfitabilityData(); 
  };
  yearSelect.onchange  = loadData;
  monthSelect.onchange = loadData;

  const buttons  = root.querySelectorAll('#profit-main-nav .b2b-tab-button');
  buttons.forEach(btn=>{
    btn.onclick = ()=>{
      buttons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderCurrentView();
    };
  });

  loadData();
}

// ====== LOAD DATA ===========================================================
async function loadAndRenderProfitabilityData(){
  const c = document.getElementById('profitability-content');
  c.innerHTML = `<p>Načítavam dáta za ${profitabilityState.month}/${profitabilityState.year}…</p>`;
  try{
    const data = await apiP(`/api/kancelaria/profitability/getData?year=${profitabilityState.year}&month=${profitabilityState.month}`);
    profitabilityState.data = data || {};
    renderCurrentView();
  }catch(e){
    c.innerHTML = `<p class="error">Chyba pri načítaní dát ziskovosti: ${escapeHtml(e.message||'Neznáma chyba')}</p>`;
    profitabilityState.data = {};
  }
}

// ====== RENDER: pohľady =====================================================
function renderCurrentView(){
  const active = document.querySelector('#profit-main-nav .b2b-tab-button.active')?.dataset.view || 'summary';
  const d = profitabilityState.data || {};
  switch(active){
    case 'summary':     return renderSummaryView(d.calculations, d.department_data);
    case 'departments': return renderDepartmentsView(d.department_data, d.calculations);
    case 'production':  return renderProductionView(d.production_view);
    case 'sales':       return renderSalesChannelsView(d.sales_channels_view);
    case 'calculations':return renderCalculationsView(d.calculations_view);
    default:            document.getElementById('profitability-content').innerHTML = `<p>Neznámy pohľad.</p>`;
  }
}

// ----- SUMMARY --------------------------------------------------------------
function renderSummaryView(calculations, dept){
  const c = document.getElementById('profitability-content');
  if (!calculations){
    c.innerHTML = '<h4>Celkový prehľad ziskovosti</h4><p class="error">Dáta sa nepodarilo načítať.</p>';
    return;
  }
  c.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
      <button class="btn-info" onclick="handlePrintProfitabilityReport('summary')"><i class="fas fa-print"></i> Tlačiť Report</button>
    </div>
    <h4>Celkový prehľad ziskovosti</h4>
    <div class="table-container">
      <table><tbody>
        <tr><td>Zisk z Expedície</td><td>${safeToFixed(calculations.expedition_profit)} €</td></tr>
        <tr><td>Zisk z Rozrábky</td><td>${safeToFixed(calculations.butchering_profit)} €</td></tr>
        <tr><td>Zisk z Výroby</td><td>${safeToFixed(calculations.production_profit)} €</td></tr>
        <tr style="font-weight:700;"><td>Celkové náklady</td>
          <td><input type="number" step="0.01" id="general_costs_summary" value="${(dept||{}).general_costs || ''}"></td></tr>
        <tr style="font-weight:700; font-size:1.1rem; background:#fafafa;"><td>Firemný zisk</td><td>${safeToFixed(calculations.total_profit)} €</td></tr>
      </tbody></table>
    </div>
    <button class="btn-success" style="width:100%; margin-top:1rem;" onclick="saveDepartmentData()">Uložiť celkové náklady</button>
  `;
}

async function saveDepartmentData(){
  const d = {
    year: profitabilityState.year, month: profitabilityState.month,
    exp_stock_prev: document.getElementById('exp_stock_prev')?.value,
    exp_from_butchering: document.getElementById('exp_from_butchering')?.value,
    exp_from_prod: document.getElementById('exp_from_prod')?.value,
    exp_external: document.getElementById('exp_external')?.value,
    exp_returns: document.getElementById('exp_returns')?.value,
    exp_stock_current: document.getElementById('exp_stock_current')?.value,
    exp_revenue: document.getElementById('exp_revenue')?.value,
    butcher_meat_value: document.getElementById('butcher_meat_value')?.value,
    butcher_paid_goods: document.getElementById('butcher_paid_goods')?.value,
    butcher_process_value: document.getElementById('butcher_process_value')?.value,
    butcher_returns_value: document.getElementById('butcher_returns_value')?.value,
    general_costs: document.getElementById('general_costs_summary')?.value
      || document.querySelector('#profitability-content input[type="number"][id^="general_costs"]')?.value
  };
  try{
    await apiP('/api/kancelaria/profitability/saveDepartmentData',{method:'POST', body:d});
    loadAndRenderProfitabilityData();
  }catch(e){}
}

// ----- DEPARTMENTS ----------------------------------------------------------
function renderDepartmentsView(data, calculations){
  const c = document.getElementById('profitability-content');
  data = data || {};
  calculations = calculations || {};

  const strictVal = Number(data.exp_from_prod_strict || 0);
  const usedVal   = Number(data.exp_from_prod_used   || 0);
  const source    = String(data.exp_from_prod_source || '').toLowerCase(); 
  const badge = (source === 'strict')
    ? `<span class="label-badge badge-green">Zdroj: PRÍSNY (expedícia → reálne prijaté)</span>`
    : `<span class="label-badge badge-gray">Zdroj: MANUÁLNY (pole „Príjem z výroby“)</span>`;

  c.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
      <button class="btn-info" onclick="handlePrintProfitabilityReport('departments')"><i class="fas fa-print"></i> Tlačiť Report</button>
    </div>

    <div class="analysis-card">
      <h4>Expedícia</h4>
      <div style="margin:.25rem 0 .5rem 0;">${badge}</div>

      <div class="form-grid" style="grid-template-columns: repeat(2, minmax(180px,1fr)); gap:.75rem;">
        <div class="form-group"><label>Stav skladu – predošlý mesiac [€]</label><input type="number" step="0.01" id="exp_stock_prev" value="${data.exp_stock_prev||''}"></div>
        <div class="form-group"><label>Príjem z rozrábky [€]</label><input type="number" step="0.01" id="exp_from_butchering" value="${data.exp_from_butchering||''}"></div>

        <div class="form-group"><label>Príjem z výroby [€] (manuálne)</label><input type="number" step="0.01" id="exp_from_prod" value="${data.exp_from_prod||''}"></div>
        <div class="form-group">
          <label>Príjem z výroby (PRÍSNY, len na čítanie) [€]</label>
          <input type="number" step="0.01" value="${safeToFixed(strictVal)}" disabled>
          <div class="b2c-row-meta">Suma reálne prijatých výrobkov v Expedícii v mesiaci × výrobná €/kg.</div>
        </div>

        <div class="form-group"><label>Externý príjem [€]</label><input type="number" step="0.01" id="exp_external" value="${data.exp_external||''}"></div>
        <div class="form-group"><label>Vrátenky [€]</label><input type="number" step="0.01" id="exp_returns" value="${data.exp_returns||''}"></div>

        <div class="form-group"><label>Stav skladu – koniec mesiaca [€]</label><input type="number" step="0.01" id="exp_stock_current" value="${data.exp_stock_current||''}"></div>
        <div class="form-group"><label>Tržby expedícia [€]</label><input type="number" step="0.01" id="exp_revenue" value="${data.exp_revenue||''}"></div>
      </div>

      <div class="stat-card" style="margin-top:.75rem;">
        <h5>Vypočítaný zisk z expedície</h5>
        <p>${safeToFixed(calculations.expedition_profit)} €</p>
        <div class="b2c-row-meta">Použitá hodnota „Príjem z výroby“ v COGS: ${safeToFixed(usedVal)} € (${source === 'strict' ? 'prísny' : 'manuálny'} zdroj)</div>
      </div>
    </div>

    <div class="analysis-card" style="margin-top:1rem;">
      <h4>Rozrábka</h4>
      <div class="form-grid" style="grid-template-columns: repeat(2, minmax(180px,1fr)); gap:.75rem;">
        <div class="form-group"><label>Mäso z rozrábky [€]</label><input type="number" step="0.01" id="butcher_meat_value" value="${data.butcher_meat_value||''}"></div>
        <div class="form-group"><label>Zaplatený tovar [€]</label><input type="number" step="0.01" id="butcher_paid_goods" value="${data.butcher_paid_goods||''}"></div>
        <div class="form-group"><label>Rozrábka [€]</label><input type="number" step="0.01" id="butcher_process_value" value="${data.butcher_process_value||''}"></div>
        <div class="form-group"><label>Vrátenka [€]</label><input type="number" step="0.01" id="butcher_returns_value" value="${data.butcher_returns_value||''}"></div>
      </div>
      <div class="form-grid" style="grid-template-columns: repeat(2, minmax(180px,1fr)); gap:.75rem; margin-top:.5rem;">
        <div class="stat-card"><h5>Zisk (Mäso − Zaplatené)</h5><p>${safeToFixed(calculations.butchering_profit)} €</p></div>
        <div class="stat-card"><h5>Precenenie (Rozrábka + Vrátenka)</h5><p>${safeToFixed(calculations.butchering_revaluation)} €</p></div>
      </div>
    </div>

    <button class="btn-success" style="width:100%; margin-top:1.5rem;" onclick="saveDepartmentData()">Uložiť dáta oddelení</button>
  `;
}

// ----- PRODUCTION -----------------------------------------------------------
function renderProductionView(data){
  const c = document.getElementById('profitability-content');
  if (!data){
    c.innerHTML = '<h4>Ziskovosť výroby</h4><p class="error">Dáta pre výrobu sa nepodarilo načítať.</p>';
    return;
  }

  const rows = (data.rows||[]).map(row=>`
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${safeToFixed(row.exp_stock_kg,3)}</td>
      <td><input type="number" step="0.01" class="profit-prod-input" data-ean="${escapeHtml(row.ean)}" data-field="expedition_sales_kg" value="${row.exp_sales_kg||''}" style="width:90px;"></td>
      <td>${safeToFixed(row.production_cost,4)} €</td>
      <td><input type="number" step="0.0001" class="profit-prod-input" data-field="transfer_price" value="${row.transfer_price||''}" style="width:110px;"></td>
      <td>${safeToFixed(row.profit)} €</td>
    </tr>`).join('');

  c.innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:1rem;">
      <button class="btn-info" onclick="handlePrintProfitabilityReport('production')"><i class="fas fa-print"></i> Tlačiť Report</button>
    </div>

    <div class="prod-card">
      <h4>Ziskovosť výroby</h4>
      <div class="table-container table-scroll">
        <table id="production-profit-table">
          <thead><tr><th>Produkt</th><th>Zásoba Exp. [kg]</th><th>Predaj Exp. [kg]</th><th>Výrobná cena [€/jed]</th><th>Príjem Exp. [€/jed]</th><th>Zisk predané [€]</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="prod-actions">
        <button class="btn-success" onclick="saveProductionProfitData()">Uložiť dáta výroby</button>
      </div>
    </div>

    <h4 style="margin-top:1rem;">Súhrn výroby</h4>
    <div class="table-container"><table><tbody>
      <tr><td>Spolu KG predané (vrátane pohárov)</td><td id="summary-total-kg">${safeToFixed((data.summary||{}).total_kg)}</td></tr>
      <tr><td>Počet pohárikov 200 g</td><td>${Math.round((data.summary||{}).jars_200||0)}</td></tr>
      <tr><td>Počet pohárikov 500 g</td><td>${Math.round((data.summary||{}).jars_500||0)}</td></tr>
      <tr><td>Počet viečok</td><td>${Math.round((data.summary||{}).lids||0)}</td></tr>
    </tbody></table></div>
  `;

  renderProductionStrictHistory(data);
}

async function saveProductionProfitData(){
  const rows = Array.from(document.querySelectorAll('#production-profit-table tbody tr')).map(tr => ({
    ean: tr.querySelector('.profit-prod-input').dataset.ean,
    expedition_sales_kg: tr.querySelector('[data-field="expedition_sales_kg"]').value,
    transfer_price:       tr.querySelector('[data-field="transfer_price"]').value
  }));
  try{
    await apiP('/api/kancelaria/profitability/saveProductionData', { method:'POST', body:{ year:profitabilityState.year, month:profitabilityState.month, rows } });
  }catch(_){}
  loadAndRenderProfitabilityData();
}

function renderProductionStrictHistory(prodData){
  const c = document.getElementById('profitability-content');
  const items = (prodData && prodData.strict_items) || [];
  const total = Number((prodData && prodData.strict_revenue) || 0);

  const rows = items.map(it => `
    <tr>
      <td>${new Date((it.date||'') + 'T00:00:00').toLocaleDateString('sk-SK')}</td>
      <td>${escapeHtml(it.batchId || '')}</td>
      <td>${escapeHtml(it.product || '')}</td>
      <td>${escapeHtml(it.ean || '')}</td>
      <td style="text-align:right;">${safeToFixed(it.qty_kg,3)} kg</td>
      <td style="text-align:right;">${safeToFixed(it.unit_cost_per_kg,4)} €/kg</td>
      <td style="text-align:right;">${safeToFixed(it.value_eur,2)} €</td>
    </tr>
  `).join('');

  const html = `
    <h4 style="margin:1rem 0 .5rem 0;">Príjem z výroby v EXPEDÍCII (PRÍSNY) – história</h4>
    <div class="table-container table-scroll">
      <table>
        <thead>
          <tr><th>Dátum</th><th>Šarža</th><th>Produkt</th><th>EAN</th><th>Množstvo (kg)</th><th>Výrobná cena (€/kg)</th><th>Hodnota (€)</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="7">Žiadne prijmy v tomto mesiaci.</td></tr>'}</tbody>
        <tfoot>
          <tr style="font-weight:700;"><td colspan="6">Výroba – výnos (PRÍSNY) spolu</td><td style="text-align:right;">${safeToFixed(total,2)} €</td></tr>
        </tfoot>
      </table>
    </div>
  `;
  c.insertAdjacentHTML('beforeend', html);
}

// ----- SALES CHANNELS (Sumarizácia reálnych predajov podľa produktov) ----------------------------------------------
function renderSalesChannelsView(data){
  const c = document.getElementById('profitability-content');
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h4>Predajné kanály (Agregácia podľa odberných skupín)</h4>
      <div>
        <button id="add-sales-channel-btn" class="btn-success" style="margin-right:.5rem;"><i class="fas fa-plus"></i> Pridať nový kanál</button>
        <button class="btn-info" onclick="handlePrintProfitabilityReport('sales_channels')"><i class="fas fa-print"></i> Tlačiť Report</button>
      </div>
    </div>
  `;

  const hasAnyData = data && Object.keys(data).length > 0;

  if (!hasAnyData){
    html += `<div class="stat-card" style="text-align:center; padding:40px; color:#64748b;">
                V danom mesiaci neexistujú žiadne expedované objednávky ani vytvorené kanály.
             </div>`;
  } else {
    for (const channel in data){
      const ch = data[channel]||{};
      const summary = ch.summary||{};
      const items = ch.items || [];
      
      const zisk = summary.total_profit || 0;
      const trzba = summary.total_sell || 0;
      const marza = trzba > 0 ? (zisk / trzba * 100) : 0;
      
      const ziskColor = zisk < 0 ? '#dc2626' : '#15803d';
      const marzaColor = marza < 10 ? '#dc2626' : (marza >= 20 ? '#16a34a' : '#d97706');

      let tableRows = '';
      let ksSum = 0;
      let kgSum = 0;

      if (items.length === 0) {
          tableRows = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748b;">Tento kanál v danom mesiaci nemá žiadne odoberané produkty.</td></tr>';
      } else {
          tableRows = items.map(row => {
            const unit = row.unit || 'kg';
            const qty  = Number(row.quantity || 0);
            
            if (unit.toLowerCase() === 'kg') kgSum += qty;
            if (unit.toLowerCase() === 'ks') ksSum += qty;

            const profitColorRow = row.total_profit_eur < 0 ? '#dc2626' : '#15803d';

            return `
              <tr>
                <td style="font-weight:600; color:#1e293b;">${escapeHtml(row.product_name)}<br><small style="color:#64748b; font-weight:normal;">EAN: ${escapeHtml(row.product_ean)}</small></td>
                <td style="text-align:right; font-weight:bold; font-size:1.05rem;">${safeToFixed(qty, 2)}</td>
                <td>${escapeHtml(unit)}</td>
                <td style="text-align:right; color:#64748b;">${safeToFixed(row.purchase_price_net, 4)} €</td>
                <td style="text-align:right; color:#1d4ed8; font-weight:bold;">${safeToFixed(row.sell_price_net, 4)} €</td>
                <td style="text-align:right; font-weight:bold; color:${profitColorRow};">${row.total_profit_eur > 0 ? '+' : ''}${safeToFixed(row.total_profit_eur)} €</td>
              </tr>
            `;
          }).join('');
      }

      html += `
        <div class="channel-card" style="border:1px solid #cbd5e1; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.05); margin-bottom: 2rem; background:#fff; overflow:hidden;">
            
          <div style="background:#f1f5f9; padding:15px; border-bottom:2px solid #0ea5e9; display:flex; justify-content:space-between; align-items:center;">
              <h5 style="margin:0; font-size:1.2rem; color:#0f172a;">${escapeHtml(channel)}</h5>
              <div style="display:flex; gap:20px; font-size:0.9rem; align-items:center;">
                  <div><span style="color:#64748b;">Tržba:</span> <strong style="color:#1d4ed8; font-size:1.1rem;">${safeToFixed(trzba)} €</strong></div>
                  <div><span style="color:#64748b;">Zisk:</span> <strong style="color:${ziskColor}; font-size:1.1rem;">${zisk > 0 ? '+' : ''}${safeToFixed(zisk)} €</strong></div>
                  <div><span style="color:#64748b;">Marža:</span> <strong style="color:${marzaColor}; font-size:1.1rem;">${safeToFixed(marza, 1)} %</strong></div>
                  ${channel !== 'Nezaradené' ? `<button class="btn btn-danger btn-sm" onclick="window.deleteSalesChannel('${escapeHtml(channel)}')"><i class="fas fa-trash"></i> Zmazať kanál</button>` : ''}
              </div>
          </div>

          <div class="table-container table-scroll" style="max-height: 400px; padding: 0;">
            <table style="width:100%; border-collapse: collapse;">
              <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 10;">
                <tr>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">Produkt</th>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;">Odobraté množstvo</th>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:left;">MJ</th>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;">Priem. Nákup/Výroba (€/MJ)</th>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;">Priem. Predajná (€/MJ)</th>
                    <th style="padding:10px; border-bottom:1px solid #e2e8f0; text-align:right;">Celkový Zisk</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
              <tfoot>
                <tr style="background:#f8fafc; font-weight:bold; border-top:2px solid #e2e8f0;">
                  <td style="padding:10px;">SPOLU ZA SKUPINU</td>
                  <td colspan="2" style="text-align:right; padding:10px; color:#1e293b;">${safeToFixed(kgSum, 2)} kg ${ksSum > 0 ? (' + ' + safeToFixed(ksSum, 0) + ' ks') : ''}</td>
                  <td style="text-align:right; padding:10px; color:#64748b;">${safeToFixed(summary.total_purchase)} €</td>
                  <td style="text-align:right; padding:10px; color:#1d4ed8;">${safeToFixed(summary.total_sell)} €</td>
                  <td style="text-align:right; padding:10px; color:${ziskColor};">${zisk > 0 ? '+' : ''}${safeToFixed(summary.total_profit)} €</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;
    }
  }

  c.innerHTML = html;
  const addBtn = document.getElementById('add-sales-channel-btn');
  if (addBtn) addBtn.onclick = showAddSalesChannelModal;
}

window.deleteSalesChannel = async function(channelName) {
    if (!confirm(`Naozaj chcete zmazať kanál "${channelName}"?\nZákazníci z tohto kanálu spadnú do kategórie "Nezaradené".`)) return;
    try {
        await apiP('/api/kancelaria/profitability/deleteSalesChannel', {
            method: 'POST',
            body: { channel: channelName }
        });
        showStatus("Kanál zmazaný");
        loadAndRenderProfitabilityData();
    } catch (e) {
        showStatus("Chyba: " + e.message, true);
    }
};
window.filterChannelOrders = function(channel) {
    const tbody = document.getElementById('chan-orders-tbody');
    if (!tbody || !window.currentChannelOrders) return;
    
    const filtered = window.currentChannelOrders.filter(o => channel === 'all' || o.kanal === channel);
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;">Nenašli sa žiadne objednávky vyhovujúce filtru.</td></tr>';
        return;
    }

    let html = '';
    filtered.forEach(o => {
        const dateStr = o.datum !== 'None' ? new Date(o.datum).toLocaleDateString('sk-SK') : '-';
        const profitColor = o.zisk < 0 ? '#dc2626' : '#15803d';
        const marginColor = o.marza < 10 ? '#dc2626' : (o.marza >= 20 ? '#16a34a' : '#d97706');
        
        html += `
            <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px 10px; color:#475569; font-size:0.85rem;">${dateStr}</td>
                <td style="padding:8px 10px; font-weight:bold; color:#0f172a; font-family:monospace;">${escapeHtml(o.cislo_objednavky)}</td>
                <td style="padding:8px 10px; font-weight:600;">${escapeHtml(o.nazov_firmy)}</td>
                <td style="padding:8px 10px;"><span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:99px; font-size:0.75rem; font-weight:bold; border:1px solid #bae6fd;">${escapeHtml(o.kanal)}</span></td>
                <td style="padding:8px 10px; text-align:right; color:#1d4ed8; font-weight:600;">${safeToFixed(o.trzba)} €</td>
                <td style="padding:8px 10px; text-align:right; font-weight:bold; color:${profitColor};">${o.zisk > 0 ? '+' : ''}${safeToFixed(o.zisk)} €</td>
                <td style="padding:8px 10px; text-align:right; font-weight:bold; color:${marginColor};">${safeToFixed(o.marza, 1)} %</td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
};

async function showAddSalesChannelModal(){
  // Načítanie existujúcich reťazcov (Centrál) z API
  let chainsOptions = '<option value="">-- Vlastný názov (Bez väzby na reťazec) --</option>';
  try {
      const res = await apiP('/api/chains'); 
      if (res && res.chains) {
          res.chains.forEach(c => {
              chainsOptions += `<option value="${c.id}">${escapeHtml(c.nazov_firmy)}</option>`;
          });
      }
  } catch (e) {
      console.warn("Nepodarilo sa načítať reťazce:", e);
  }

  showModal('Nový predajný kanál', () => Promise.resolve({
    html: `
      <form id="new-channel-form">
        <div class="form-group" style="margin-bottom:15px; background:#f0fdf4; padding:15px; border:1px solid #bbf7d0; border-radius:6px;">
            <label style="color:#166534; font-size:1.05rem;"><strong>1. Prepojiť s reťazcom z EDI modulu (Odporúčané)</strong></label>
            <select id="new-channel-chain" class="filter-input" style="width:100%; font-weight:bold; margin-top:8px;">
                ${chainsOptions}
            </select>
            <small style="color:#15803d; display:block; margin-top:5px;">Všetky pobočky tohto reťazca sa automaticky združia do jedného kanálu.</small>
        </div>
        
        <div class="form-group" style="padding:0 5px;">
            <label><strong>2. Názov kanálu</strong></label>
            <input type="text" id="new-channel-name" class="filter-input" style="width:100%; font-size:1.1rem;" placeholder="Napr. COOP Jednota, Väznice, Maloobchod...">
        </div>
        
        <button class="btn btn-success" style="width:100%; margin-top:1.5rem; padding:12px; font-size:1.1rem; font-weight:bold;">Vytvoriť predajný kanál</button>
      </form>
    `,
    onReady: ()=>{
      const selChain = document.getElementById('new-channel-chain');
      const inpName = document.getElementById('new-channel-name');
      
      // Auto-vyplnenie textového poľa podľa výberu z dropdownu
      selChain.addEventListener('change', (e) => {
          if (e.target.value) {
              inpName.value = e.target.options[e.target.selectedIndex].text;
          } else {
              inpName.value = '';
          }
      });

      const f = document.getElementById('new-channel-form');
      f.onsubmit = async (e)=>{
        e.preventDefault();
        const name = inpName.value.trim();
        const chainId = selChain.value;
        
        if (!name) {
            showStatus("Zadajte názov kanálu alebo vyberte reťazec.", true);
            return;
        }
        
        try{
          await apiP('/api/kancelaria/profitability/setupSalesChannel', { 
              method:'POST', 
              body:{ 
                  year: profitabilityState.year, 
                  month: profitabilityState.month, 
                  channel_name: name,
                  chain_id: chainId || null
              } 
          });
          document.getElementById('modal-container').style.display='none';
          showStatus(`Kanál ${name} úspešne vytvorený a prevádzky boli prepojené.`);
          loadAndRenderProfitabilityData();
        }catch(err){
            showStatus("Chyba pri vytváraní: " + err.message, true);
        }
      };
    }
  }));
}

async function saveSalesChannelData(channel){
  const table = document.querySelector(`.sales-channel-table[data-channel="${CSS_ESCAPE(channel)}"]`);
  if (!table) return;

  const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr=>{
    const unit = tr.querySelector('.sales-unit')?.value || 'kg';
    const qty  = tr.querySelector('.sales-qty')?.value || '';

    const row = {
      ean: tr.dataset.ean,
      unit,
      quantity: qty,
      sales_qty: qty,
      sales_kg: qty,
      purchase_price_vat: 0,
      sell_price_vat: 0
    };

    tr.querySelectorAll('input.sales-input').forEach(inp => {
      const f = inp.dataset.field; if (f) row[f] = inp.value;
    });

    return row;
  });

  try{
    await apiP('/api/kancelaria/profitability/saveSalesChannelData', {
      method:'POST',
      body:{ year:profitabilityState.year, month:profitabilityState.month, channel, rows }
    });
  }catch(_){}
  loadAndRenderProfitabilityData();
}

// ----- CALCULATIONS (kg/ks + tlač jednej kalkulácie) ------------------------
function renderCalculationsView(data){
  const c = document.getElementById('profitability-content');
  const list = (data && data.calculations) || [];
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h4>Kalkulácie a súťaže</h4>
      <div>
        <button id="add-calculation-btn" class="btn-success" style="margin-right:.5rem;"><i class="fas fa-plus"></i> Nová kalkulácia</button>
      </div>
    </div>
  `;
  if (!list.length){
    html += `<p>Pre tento mesiac neboli vytvorené žiadne kalkulácie.</p>`;
  } else {
    html += `<div class="table-container"><table>
      <thead><tr><th>Názov</th><th>Položiek</th><th>Akcie</th></tr></thead>
      <tbody>
        ${list.map(calc=>`
          <tr>
            <td>${escapeHtml(calc.name)}</td>
            <td>${(calc.items||[]).length}</td>
            <td>
              <button class="btn-warning btn-xs" onclick='showCalculationModal(${JSON.stringify(calc).replace(/'/g, "&#39;")})'><i class="fas fa-edit"></i> Upraviť</button>
              <button class="btn-secondary btn-xs" style="margin-left:.3rem;" onclick="openCalculationPrint(${calc.id})"><i class="fas fa-print"></i> Tlačiť</button>
              <button class="btn-danger btn-xs" style="margin-left:.3rem;" onclick="handleDeleteCalculation(${calc.id})"><i class="fas fa-trash"></i> Vymazať</button>
            </td>
          </tr>`).join('')}
      </tbody></table></div>`;
  }
  c.innerHTML = html;
  const addBtn = document.getElementById('add-calculation-btn');
  if (addBtn) addBtn.onclick = ()=> showCalculationModal(null);
}

function showCalculationModal(calc){
  profitabilityState.currentCalculation = calc || { id:null, name:'', items:[], distance_km:0, transport_cost:0 };
  showModal(calc ? 'Upraviť kalkuláciu' : 'Nová kalkulácia', () => Promise.resolve({
    html: `
      <form id="calculation-form">
        <div class="form-group"><label>Názov kalkulácie</label><input type="text" id="calc-name" value="${escapeHtml(profitabilityState.currentCalculation.name||'')}" required></div>

        <div class="form-grid" style="grid-template-columns:repeat(4,minmax(160px,1fr)); gap:.75rem;">
          <div class="form-group"><label>Vozidlo</label><select id="calc-vehicle"></select></div>
          <div class="form-group"><label>Cena/km (manuálne)</label><input type="number" step="0.01" id="calc-costkm-manual" placeholder="napr. 0.45"><div id="calc-autokm-badge" class="b2c-row-meta" style="margin-top:.25rem;"></div></div>
          <div class="form-group"><label>Vzdialenosť (km) – jednosmerne</label><input type="number" step="0.1" id="calc-distance" value="${Number(profitabilityState.currentCalculation.distance_km||0)}"><div class="b2c-row-meta">Doprava sa ráta tam & späť.</div></div>
          <div class="form-group"><label>Zákazník (voliteľné)</label><select id="calc-customer-ref"></select></div>
        </div>

        <h5 style="margin-top:1rem;">Položky kalkulácie</h5>
        <datalist id="calc-product-hints"></datalist>
        <div class="table-container" style="max-height:40vh;">
          <table>
            <thead><tr><th>Produkt</th><th>EAN</th><th>Jedn.</th><th>Množstvo</th><th>Nákup (€/jed)</th><th>Predaj (€/jed)</th><th>Zisk (€)</th><th></th></tr></thead>
            <tbody id="calc-items-tbody"></tbody>
          </table>
        </div>
        <button type="button" id="calc-add-row" class="btn btn-secondary" style="width:100%; margin-top:.5rem;"><i class="fas fa-plus"></i> Pridať riadok</button>

        <div class="table-container" style="margin-top:1rem;">
          <table><tbody>
            <tr><td>Tržba spolu</td><td id="summary-total-sell">0.00 €</td></tr>
            <tr><td>Nákup spolu</td><td id="summary-total-purchase">0.00 €</td></tr>
            <tr><td>Doprava (tam&späť)</td><td id="summary-transport-cost">0.00 €</td></tr>
            <tr style="font-weight:700;"><td>Finálny zisk</td><td id="summary-final-profit">0.00 €</td></tr>
          </tbody></table>
        </div>

        <div style="display:flex; gap:.5rem; margin-top:1rem;">
          <button class="btn btn-success"><i class="fas fa-save"></i> Uložiť</button>
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-container').style.display='none'">Zavrieť</button>
        </div>
      </form>
    `,
    onReady: async ()=>{
      await populateVehiclesAndCustomers();
      buildProductHints();
      const selV = document.getElementById('calc-vehicle');
      selV.onchange = handleVehicleChangeAndAutoKm;
      await handleVehicleChangeAndAutoKm();

      document.getElementById('calc-distance').oninput = updateCalculationSummary;
      document.getElementById('calc-costkm-manual').oninput = updateCalculationSummary;

      populateCalculationItems(profitabilityState.currentCalculation.items||[]);
      document.getElementById('calc-add-row').onclick = ()=> addCalculationRow('', '', 'kg', '', '', '');
      document.getElementById('calculation-form').onsubmit = handleSaveCalculation;
      updateCalculationSummary();
    }
  }));
}

async function openCalculationPrint(calcId){
  let calc = null;
  const fromState = profitabilityState.data?.calculations_view?.calculations || [];
  calc = fromState.find(x => String(x.id) === String(calcId));
  if (!calc){
    const data = await tryFetchJSON(`/api/kancelaria/profitability/getData?year=${profitabilityState.year}&month=${profitabilityState.month}`);
    if (data && data.calculations_view && Array.isArray(data.calculations_view.calculations)){
      profitabilityState.data.calculations_view = data.calculations_view;
      calc = data.calculations_view.calculations.find(x => String(x.id) === String(calcId));
    }
  }
  if (!calc){ showStatus('Nepodarilo sa načítať kalkuláciu.', true); return; }

  const rows = Array.isArray(calc.items) ? calc.items : [];
  const totals = rows.reduce((acc, r)=>{
    const qty  = Number(r.qty ?? r.quantity ?? r.estimated_kg ?? 0);
    const buy  = Number(r.purchase_price_net||0);
    const sell = Number(r.sell_price_net||0);
    acc.purchase += buy  * qty;
    acc.sell     += sell * qty;
    return acc;
  }, {purchase:0, sell:0});
  const transport = Number(calc.transport_cost || 0);
  const finalProfit = (totals.sell - totals.purchase) - transport;

  showModal('Tlač kalkulácie', () => Promise.resolve({
    html: `
      <div id="calc-print-area">
        <h4 style="margin:0 0 .5rem 0;">${escapeHtml(calc.name || ('Kalkulácia #'+calcId))}</h4>
        <div class="form-grid" style="grid-template-columns: repeat(3, minmax(180px,1fr)); gap:.5rem;">
          <div class="stat-card"><strong>Obdobie</strong><div>${profitabilityState.month}/${profitabilityState.year}</div></div>
          <div class="stat-card"><strong>Vzdialenosť (km)</strong><div>${safeToFixed(calc.distance_km||0,1)}</div></div>
          <div class="stat-card"><strong>Doprava (tam&späť)</strong><div>${safeToFixed(transport)} €</div></div>
        </div>

        <div class="table-container" style="margin-top:.75rem;">
          <table>
            <thead><tr><th>Produkt</th><th>EAN</th><th>Jedn.</th><th>Množstvo</th><th>Nákup (€/jed)</th><th>Predaj (€/jed)</th><th>Zisk riadku (€)</th></tr></thead>
            <tbody>
              ${rows.map(r=>{
                const unit = r.unit || 'kg';
                const qty  = Number(r.qty ?? r.quantity ?? r.estimated_kg ?? 0);
                const buy  = Number(r.purchase_price_net||0);
                const sell = Number(r.sell_price_net||0);
                const profit = (sell - buy) * qty;
                return `<tr>
                  <td>${escapeHtml(r.product_name || '')}</td>
                  <td>${escapeHtml(r.product_ean || '')}</td>
                  <td>${escapeHtml(unit)}</td>
                  <td>${safeToFixed(qty, unit==='kg'?3:0)}</td>
                  <td>${safeToFixed(buy,4)}</td>
                  <td>${safeToFixed(sell,4)}</td>
                  <td>${safeToFixed(profit)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="font-weight:700;">
                <td colspan="4">Spolu</td>
                <td>${safeToFixed(totals.purchase)} €</td>
                <td>${safeToFixed(totals.sell)} €</td>
                <td>${safeToFixed(finalProfit)} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div style="display:flex; gap:.5rem; margin-top:1rem;">
        <button id="calc-print-btn" class="btn btn-success"><i class="fas fa-print"></i> Tlačiť túto kalkuláciu</button>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('modal-container').style.display='none'">Zavrieť</button>
      </div>
    `,
    onReady: ()=>{
      document.getElementById('calc-print-btn').onclick = ()=>{
        const area = document.getElementById('calc-print-area');
        if (!area) return;
        printHTMLInIframe(`
          <html>
            <head>
              <meta charset="utf-8">
              <title>${escapeHtml(calc.name || 'Kalkulácia')}</title>
              <style>
                body{ font-family: sans-serif; padding:16px; }
                table{ width:100%; border-collapse: collapse; }
                th,td{ border:1px solid #ddd; padding:6px 8px; font-size:12px; }
                th{ background:#f3f3f3; }
                h4{ margin:0 0 8px 0; }
                .stat-card{ padding:6px 8px; border:1px solid #eee; border-radius:8px; }
              </style>
            </head>
            <body>${area.outerHTML}</body>
          </html>
        `);
      };
    }
  }));
}

function printHTMLInIframe(html){
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right    = '0';
  iframe.style.bottom   = '0';
  iframe.style.width    = '0';
  iframe.style.height   = '0';
  iframe.style.border   = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow || iframe.contentDocument;
  const idoc = doc.document || doc;
  idoc.open(); idoc.write(html); idoc.close();
  setTimeout(()=>{
    try{
      (iframe.contentWindow || iframe).focus();
      (iframe.contentWindow || iframe).print();
    } finally {
      setTimeout(()=> document.body.removeChild(iframe), 400);
    }
  }, 60);
}

async function populateVehiclesAndCustomers(){
  const selV = document.getElementById('calc-vehicle');
  const selC = document.getElementById('calc-customer-ref');

  let vehicles = null;
  if (window.fleetState && Array.isArray(window.fleetState.vehicles) && window.fleetState.vehicles.length){
    vehicles = window.fleetState.vehicles;
    if (window.fleetState.selected_vehicle_id){
      selV.dataset.selected = String(window.fleetState.selected_vehicle_id);
    }
  }
  if (!vehicles && PROFITABILITY_INTEGRATIONS.fleet){
    const fd = await tryFetchJSON(`/api/kancelaria/fleet/getData?year=${profitabilityState.year}&month=${profitabilityState.month}`);
    if (fd && Array.isArray(fd.vehicles) && fd.vehicles.length){
      vehicles = fd.vehicles;
      if (fd.selected_vehicle_id){ selV.dataset.selected = String(fd.selected_vehicle_id); }
    }
  }
  if (!vehicles && PROFITABILITY_INTEGRATIONS.fleet){
    const list = await tryFetchJSON('/api/kancelaria/fleet/vehicles/list');
    if (Array.isArray(list) && list.length){ vehicles = list; }
  }

  if (Array.isArray(vehicles) && vehicles.length){
    selV.innerHTML = '<option value="">— Vyber —</option>';
    vehicles.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = v.id;
      const label = v.name ? `${v.name} (${v.license_plate||''})` : (v.license_plate || v.id);
      opt.textContent = label;
      const kmCost = Number(v.cost_per_km ?? v.km_cost ?? v.avg_cost_per_km ?? 0);
      if (kmCost > 0) opt.dataset.costKm = kmCost;
      selV.add(opt);
    });
    if (selV.dataset.selected) selV.value = selV.dataset.selected;
  } else {
    selV.innerHTML = '<option value="">— nie je k dispozícii —</option>';
  }

  if (PROFITABILITY_INTEGRATIONS.customers){
    const customers = await tryFetchJSON('/api/kancelaria/customers/list');
    if (Array.isArray(customers) && customers.length){
      selC.innerHTML = '<option value="">— Vyber —</option>';
      customers.forEach(c=>{
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name || c.company || c.id;
        selC.add(opt);
      });
    } else {
      selC.innerHTML = '<option value="">— nie je k dispozícii —</option>';
    }
  } else {
    selC.innerHTML = '<option value="">— nie je k dispozícii —</option>';
  }
}

function buildProductHints(){
  const dl = document.getElementById('calc-product-hints');
  if (!dl) return;
  const names = new Map();
  const pv = profitabilityState.data?.production_view?.rows || [];
  pv.forEach(r=>{
    if (r?.name) names.set(String(r.name), String(r.ean||''));
  });
  const sc = profitabilityState.data?.sales_channels_view || {};
  Object.keys(sc).forEach(k=>{
    (sc[k]?.items || []).forEach(it=>{
      if (it?.product_name) names.set(String(it.product_name), String(it.product_ean||''));
    });
  });
  dl.innerHTML = '';
  names.forEach((ean, name)=>{
    const opt = document.createElement('option');
    opt.value = name;
    opt.label = ean ? `${name} • ${ean}` : name;
    dl.appendChild(opt);
  });
}

function populateCalculationItems(items){
  const tbody = document.getElementById('calc-items-tbody');
  tbody.innerHTML = '';
  (items||[]).forEach(it=> addCalculationRow(
    it.product_name || '', it.product_ean || '', (it.unit||'kg'), (it.qty ?? it.quantity ?? it.estimated_kg ?? ''), it.purchase_price_net, it.sell_price_net
  ));
  addCalculationRow('', '', 'kg', '', '', '');
}

function addCalculationRow(name, ean, unit, qty, pBuy, pSell){
  const tbody = document.getElementById('calc-items-tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="calc-input" data-field="product_name" list="calc-product-hints" value="${escapeHtml(name||'')}" placeholder="Názov" style="width:180px;"></td>
    <td><input class="calc-input" data-field="product_ean" value="${escapeHtml(ean||'')}" placeholder="EAN/kód" style="width:120px;"></td>
    <td>
      <select class="calc-input" data-field="unit" style="width:80px;">
        <option value="kg" ${unit==='kg'?'selected':''}>kg</option>
        <option value="ks" ${unit==='ks'?'selected':''}>ks</option>
      </select>
    </td>
    <td><input type="number" step="${(unit==='kg')?'0.001':'1'}" class="calc-input" data-field="qty" value="${qty||''}" style="width:110px;"></td>
    <td><input type="number" step="0.0001" class="calc-input" data-field="purchase_price_net" value="${pBuy||''}" style="width:110px;"></td>
    <td><input type="number" step="0.0001" class="calc-input" data-field="sell_price_net" value="${pSell||''}" style="width:110px;"></td>
    <td class="row-profit">0.00</td>
    <td><button type="button" class="btn btn-danger btn-xs" style="padding:5px;" onclick="this.closest('tr').remove(); updateCalculationSummary();"><i class="fas fa-times"></i></button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelectorAll('.calc-input').forEach(inp=> inp.oninput = ()=>{
    if (inp.dataset.field === 'unit'){
      const q = tr.querySelector('[data-field="qty"]');
      q.step = (inp.value === 'kg') ? '0.001' : '1';
    }
    updateCalculationSummary();
  });
  tr.querySelector('[data-field="product_name"]').addEventListener('change', (e)=>{
    const label = String(e.target.value||'');
    const dl = document.getElementById('calc-product-hints');
    const opt = Array.from(dl.options).find(o => o.value === label);
    if (opt && opt.label && opt.label.includes('•')){
      const eanStr = opt.label.split('•').pop().trim();
      tr.querySelector('[data-field="product_ean"]').value = eanStr || '';
    }
    updateCalculationSummary();
  });
  updateCalculationSummary();
}

function updateCalculationSummary(){
  let totalPurchase=0, totalSell=0;
  document.querySelectorAll('#calc-items-tbody tr').forEach(row=>{
    const qty   = parseFloat(row.querySelector('[data-field="qty"]').value)||0;
    const pBuy  = parseFloat(row.querySelector('[data-field="purchase_price_net"]').value)||0;
    const pSell = parseFloat(row.querySelector('[data-field="sell_price_net"]').value)||0;
    const rowProfit = (pSell - pBuy) * qty;
    row.querySelector('.row-profit').textContent = safeToFixed(rowProfit);
    totalPurchase += pBuy  * qty;
    totalSell     += pSell * qty;
  });

  const selV = document.getElementById('calc-vehicle');
  const manualKm = parseFloat(document.getElementById('calc-costkm-manual')?.value)||0;
  const autoKmComputed = parseFloat(selV?.dataset?.autoKm || 0);
  const autoKmOpt      = parseFloat(selV?.selectedOptions?.[0]?.dataset?.costKm || 0);
  const autoKm = autoKmComputed > 0 ? autoKmComputed : autoKmOpt;
  const costPerKm = autoKm > 0 ? autoKm : manualKm;

  const distance  = parseFloat(document.getElementById('calc-distance').value)||0;
  const transport = costPerKm * distance * 2;
  const finalProfit = (totalSell - totalPurchase) - transport;

  document.getElementById('summary-total-sell').textContent      = `${safeToFixed(totalSell)} €`;
  document.getElementById('summary-total-purchase').textContent  = `${safeToFixed(totalPurchase)} €`;
  document.getElementById('summary-transport-cost').textContent  = `${safeToFixed(transport)} €`;
  document.getElementById('summary-final-profit').textContent    = `${safeToFixed(finalProfit)} €`;
}

async function handleSaveCalculation(e){
  e.preventDefault();
  const items = Array.from(document.querySelectorAll('#calc-items-tbody tr')).map(row => ({
    product_name:       row.querySelector('[data-field="product_name"]').value,
    product_ean:        row.querySelector('[data-field="product_ean"]').value,
    unit:               row.querySelector('[data-field="unit"]').value || 'kg',
    qty:                row.querySelector('[data-field="qty"]').value,
    purchase_price_net: row.querySelector('[data-field="purchase_price_net"]').value,
    sell_price_net:     row.querySelector('[data-field="sell_price_net"]').value,
    estimated_kg:       row.querySelector('[data-field="qty"]').value
  })).filter(r => (r.product_ean || r.product_name));

  const selV = document.getElementById('calc-vehicle');
  const manualKm = parseFloat(document.getElementById('calc-costkm-manual')?.value)||0;
  const autoKmComputed = parseFloat(selV?.dataset?.autoKm || 0);
  const autoKmOpt      = parseFloat(selV?.selectedOptions?.[0]?.dataset?.costKm || 0);
  const autoKm = autoKmComputed > 0 ? autoKmComputed : autoKmOpt;
  const costPerKm = autoKm > 0 ? autoKm : manualKm;

  const distance  = parseFloat(document.getElementById('calc-distance').value) || 0;

  const dataToSave = {
    id: profitabilityState.currentCalculation.id,
    year: profitabilityState.year, month: profitabilityState.month,
    name: document.getElementById('calc-name').value,
    vehicle_id: document.getElementById('calc-vehicle').value || null,
    distance_km: distance,
    transport_cost: costPerKm * distance * 2,
    items
  };
  try{
    await apiP('/api/kancelaria/profitability/saveCalculation', { method:'POST', body:dataToSave });
  }catch(_){}
  document.getElementById('modal-container').style.display='none';
  loadAndRenderProfitabilityData();
}

async function handleDeleteCalculation(id){
  showConfirmationModal({
    title:'Potvrdenie vymazania',
    message:'Naozaj chcete natrvalo vymazať túto kalkuláciu?',
    warning:'Táto akcia je nezvratná!',
    onConfirm: async ()=>{
      try{ await apiP('/api/kancelaria/profitability/deleteCalculation', { method:'POST', body:{ id } }); }catch(_){}
      loadAndRenderProfitabilityData();
    }
  });
}

function shiftMonth(year, month, delta){
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
async function computeVehicleAutoKmCost(vehicleId){
  if (!vehicleId) return 0;
  for (let back=0; back<6; back++){
    const {year, month} = shiftMonth(profitabilityState.year, profitabilityState.month, -back);
    const a = await tryFetchJSON(`/api/kancelaria/fleet/getAnalysis?vehicle_id=${encodeURIComponent(vehicleId)}&year=${year}&month=${month}`);
    if (a && Number(a.total_km)>0){
      let cpk = Number(a.cost_per_km || 0);
      if (cpk > 0) return cpk;
      const costs = Number(a.total_costs || 0);
      const km    = Number(a.total_km || 0);
      if (km > 0 && costs > 0) return costs / km;
    }
  }
  return 0;
}
function setAutoKmBadge(value){
  const badge = document.getElementById('calc-autokm-badge');
  if (!badge) return;
  if (value > 0){
    badge.innerHTML = `<span class="kpi-badge">Auto €/km z Fleet: <strong>${safeToFixed(value, 3)} €/km</strong></span>`;
  } else {
    badge.innerHTML = `<span class="b2c-row-meta">Auto €/km sa nenašlo – použite pole „Cena/km (manuálne)“.</span>`;
  }
}
async function handleVehicleChangeAndAutoKm(){
  const selV = document.getElementById('calc-vehicle');
  const vid = selV.value;
  let autoKm = 0;
  if (vid){
    autoKm = await computeVehicleAutoKmCost(vid);
  }
  selV.dataset.autoKm = autoKm > 0 ? String(autoKm) : '';
  setAutoKmBadge(autoKm);
  updateCalculationSummary();
}

function handlePrintProfitabilityReport(type){
  const { year, month } = profitabilityState;
  window.open(`/report/profitability?year=${year}&month=${month}&type=${type}`, '_blank');
}

(function(){
  const s = document.getElementById('section-profitability');
  if (s) initializeProfitabilityModule();
})();