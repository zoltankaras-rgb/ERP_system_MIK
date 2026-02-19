// =================================================================
// === SUB-MODUL KANCELÁRIA: DASHBOARD (rozšírená verzia) ==========
// =================================================================
// - KPI karty (B2B/B2C prijaté, nové registrácie B2C, B2B čaká na potvrdenie)
// - Objednávky na najbližších 7 dní (po dňoch: B2C/B2B/Spolu)
// - Akcie na supermarkety (z Plánovača expedície)
// - Suroviny pod minimom, Tovar pod minimom
// - TOP5 výroby a Graf výroby (posledných 30 dní)
// =================================================================

let dashboardState = {
  period: null,
  data: null,
  googleChartsReady: null
};

function initializeDashboardModule() {
  loadDashboardData();
}

async function loadDashboardData() {
  const content = document.getElementById('section-dashboard');
  content.innerHTML = '<div style="padding:40px; text-align:center;"><h3>Dashboard</h3><p>Načítavam dáta...</p></div>';

  try {
    // Základné dáta pre dashboard
    const data = await apiRequest('/api/kancelaria/getDashboardData');

    dashboardState.data = data || {};
    dashboardState.period = data?.period || null;

    let html = `<div id="dashboard-content">`;

    // 0) Hlavička + obdobie
    html += `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px">
               <h3 style="margin:0">Dashboard</h3>
               ${renderPeriodInfo(dashboardState.period)}
             </div>`;

    // 1) KPI karty (Aktualizované pre nové dáta z backendu)
    html += renderKpiCards(data);

    // 2) Objednávky na najbližších 7 dní
    html += renderNext7Days(data?.next7Days);

    // 3) Akcie na supermarkety – placeholder, naplníme po vložení do DOM
    html += renderPromotionsBlock();

    // 4) Výrobné suroviny pod minimálnou zásobou
    html += renderLowStockRaw(data?.lowStockRaw);

    // 5) Expedičný tovar pod minimálnou zásobou
    html += renderLowStockGoods(data?.lowStockGoods);

    // 6) TOP 5 a graf výroby (posledných 30 dní)
    html += `<h4 style="margin-top: 2rem;">TOP 5 produktov (posledných 30 dní)</h4>
             <div class="table-container" id="top-products-container"></div>
             <h4 style="margin-top: 2rem;">Graf výroby (posledných 30 dní)</h4>
             <div id="production-chart-container" style="width: 100%; height: 300px; text-align: center;"></div>`;

    html += `</div>`;
    content.innerHTML = html;

    // Po vložení HTML do DOM doplníme Akcie z /api/kancelaria/get_promotions_data
    hydratePromotionsFromPlanner();

    // TOP5 a graf (ak sú dáta)
    populateTopProductsTable(data?.topProducts || []);
    drawProductionChart(data?.timeSeriesData || []);

  } catch (e) {
    console.error(e);
    content.innerHTML = `<h3>Dashboard</h3>
                         <p class="error">Chyba pri načítaní dát pre dashboard: ${escapeHtml(e.message || String(e))}</p>`;
  }
}

// ---------- Renderers ------------------------------------------------

function renderPeriodInfo(period) {
  if (typeof period === 'string') {
      return `<div style="color:#6b7280;font-size:.9rem">Obdobie: <strong>${escapeHtml(period)}</strong></div>`;
  }
  if (!period?.date_from || !period?.date_to) return '';
  const from = new Date(period.date_from);
  const to   = new Date(period.date_to);
  const fmt  = (d)=> d.toLocaleDateString('sk-SK');
  return `<div style="color:#6b7280;font-size:.9rem">
            Obdobie: <strong>${fmt(from)}</strong> – <strong>${fmt(to)}</strong>
          </div>`;
}

function renderKpiCards(data) {
  // Nové hodnoty z Python backendu
  const pendingB2B = data?.pendingB2B || 0;
  const activeB2C = data?.activeB2COrders || 0;
  
  // Hodnoty z pôvodného kódu (ak ich backend pošle)
  const b2bOrders = data?.cards?.b2b_orders?.count || 0;
  const b2cRegistrations = data?.cards?.b2c_registrations?.count || 0;

  return `
    <div class="dash-cards">
      <div class="dash-card" style="cursor:pointer; border-left: 4px solid ${pendingB2B > 0 ? '#f59e0b' : '#e5e7eb'};" onclick="showSection('b2b-admin')">
        <div class="dash-card-label">Čakajúce B2B registrácie</div>
        <div class="dash-card-value" style="color: ${pendingB2B > 0 ? '#f59e0b' : '#111827'};">${pendingB2B}</div>
      </div>
      
      <div class="dash-card" style="cursor:pointer; border-left: 4px solid #3b82f6;" onclick="showSection('b2c-admin')">
        <div class="dash-card-label">Aktívne B2C objednávky</div>
        <div class="dash-card-value" style="color: #3b82f6;">${activeB2C}</div>
      </div>

      <div class="dash-card">
        <div class="dash-card-label">B2B prijaté (30 dní)</div>
        <div class="dash-card-value">${b2bOrders}</div>
      </div>

      <div class="dash-card">
        <div class="dash-card-label">B2C nové registrácie</div>
        <div class="dash-card-value">${b2cRegistrations}</div>
      </div>
    </div>
  `;
}

function renderNext7Days(next7 = []) {
  // Fallback: ak backend ešte nevracia next7Days, pripravíme 7 dní s nulami
  if (!Array.isArray(next7) || next7.length === 0) {
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      next7.push({
        date: d.toISOString().slice(0,10),
        b2c: 0,
        b2b: 0,
        total: 0
      });
    }
  }

  const weekdaySk = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
  let rows = '';
  next7.forEach(item => {
    const d = new Date(item.date);
    const wd = weekdaySk[d.getDay()];
    const b2c = Number(item.b2c || 0);
    const b2b = Number(item.b2b || 0);
    const total = Number(item.total != null ? item.total : (b2c + b2b));
    rows += `<tr>
      <td>${d.toLocaleDateString('sk-SK')}</td>
      <td>${wd}</td>
      <td class="num">${b2c}</td>
      <td class="num">${b2b}</td>
      <td class="num"><strong>${total}</strong></td>
    </tr>`;
  });

  return `
    <div class="box">
      <div class="box-head">
        <h4 style="margin:0">Objednávky na najbližších 7 dní</h4>
        <div class="muted">podľa dňa vyzdvihnutia/dodania</div>
      </div>
      <div class="table-container">
        <table class="tbl">
          <thead>
            <tr>
              <th>Dátum</th>
              <th>Deň</th>
              <th>B2C</th>
              <th>B2B</th>
              <th>Spolu</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPromotionsBlock() {
  return `
    <div class="box warn" id="promotions-block">
      <h4 class="box-title" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
        <i class="fas fa-bullhorn"></i> Akcie na supermarkety
      </h4>
      <div class="table-container">
        <div style="padding:10px;">Načítavam akcie…</div>
      </div>
      <p class="muted" style="margin-top:.5rem">Zobrazujú sa prebiehajúce a nadchádzajúce akcie z plánovača expedície.</p>
    </div>
  `;
}

async function hydratePromotionsFromPlanner() {
  const block = document.getElementById('promotions-block');
  if (!block) return;

  try {
    const data = await apiRequest('/api/kancelaria/get_promotions_data'); 
    const list = Array.isArray(data?.promotions) ? data.promotions : [];

    const today = new Date(); today.setHours(0,0,0,0);

    const toISO = (d) => {
      const x = new Date(d);
      return isNaN(x) ? null : new Date(x.getFullYear(),x.getMonth(),x.getDate());
    };
    const daysDiff = (a,b) => Math.round((a - b) / 86400000);

    const mapped = list
      .map(p => {
        const s = toISO(p.start_date);
        const e = toISO(p.end_date);
        let state = 'upcoming', badge = 'badge-gray', stateText = 'Bez termínu';
        if (s && e) {
          if (today < s) {
            const d = daysDiff(s, today);
            state = 'upcoming'; badge = 'badge-blue'; stateText = `Začne o ${d} d`;
          } else if (today > e) {
            state = 'ended'; badge = 'badge-gray'; stateText = 'Ukončená';
          } else {
            const left = daysDiff(e, today);
            state = 'active'; badge = left === 0 ? 'badge-orange' : 'badge-green';
            stateText = left === 0 ? 'Končí dnes' : `Prebieha (ešte ${left} d)`;
          }
        } else if (s && !e) {
          state = (today >= s) ? 'active' : 'upcoming';
          badge = (state === 'active') ? 'badge-green' : 'badge-blue';
          stateText = (state === 'active') ? 'Prebieha' : 'Začne čoskoro';
        }
        return {
          chain: p.chain_name || '',
          product: p.product_name || '',
          start: s, end: e,
          state, badge, stateText
        };
      })
      .filter(p => p.state === 'active' || p.state === 'upcoming');

    const order = { active: 0, upcoming: 1 };
    mapped.sort((a,b) => (order[a.state]-order[b.state]) || ((a.start?.getTime()||0)-(b.start?.getTime()||0)));

    block.querySelector('.table-container').innerHTML = renderPromotionsTable(mapped);
  } catch (e) {
    block.querySelector('.table-container').innerHTML =
      `<div class="error" style="padding:10px;">Chyba pri načítaní akcií: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderPromotionsTable(items = []) {
  const fmtSK = (d) => d ? d.toLocaleDateString('sk-SK') : '—';
  if (!items.length) {
    return `<div style="padding:10px;">Aktuálne neprebiehajú žiadne akcie.</div>`;
  }
  let rows = '';
  items.forEach(p => {
    rows += `<tr>
      <td>${escapeHtml(p.chain || '—')}</td>
      <td><strong>${escapeHtml(p.product)}</strong></td>
      <td>${fmtSK(p.start)} – ${fmtSK(p.end)}</td>
      <td><span class="badge ${p.badge}">${escapeHtml(p.stateText)}</span></td>
    </tr>`;
  });
  return `
    <table class="tbl">
      <thead><tr><th>Reťazec</th><th>Produkt</th><th>Obdobie</th><th>Stav</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderLowStockRaw(rows = []) {
  let html = `<h4 style="margin-top: 20px;">Výrobné suroviny pod minimálnou zásobou</h4>`;
  if (!rows || rows.length === 0) {
    html += '<div class="box" style="padding:15px;"><p style="color:#166534; font-weight:500; margin:0;">✅ Všetky výrobné suroviny sú nad minimálnou zásobou.</p></div>';
  } else {
    let table = '<table class="tbl"><thead><tr><th>Surovina</th><th class="num">Aktuálny stav (kg)</th><th class="num">Min. zásoba (kg)</th></tr></thead><tbody>';
    rows.forEach(item => {
      table += `<tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td class="num loss">${safeToFixed(item.quantity)}</td>
                  <td class="num">${safeToFixed(item.minStock)}</td>
                </tr>`;
    });
    html += `<div class="table-container">${table}</tbody></table></div>`;
  }
  html += `<p class="muted">Pre detailný návrh nákupu surovín podľa plánu výroby pozri <strong>Plánovanie &gt; Návrh nákupu</strong>.</p>`;
  return html;
}

function renderLowStockGoods(grouped = {}) {
  let html = `<h4 style="margin-top: 2rem;">Expedičný tovar pod minimálnou zásobou</h4>`;
  const cats = Object.keys(grouped || {});
  if (!cats.length) {
    html += '<div class="box" style="padding:15px;"><p style="color:#166534; font-weight:500; margin:0;">✅ Všetok expedičný tovar je nad minimálnou zásobou.</p></div>';
    html += `<p class="muted">Pre detailný návrh nákupu tovaru podľa objednávok pozri <strong>Expedičný plán &gt; Návrh nákupu tovaru</strong>.</p>`;
    return html;
  }
  cats.forEach(cat => {
    html += `<h5>${escapeHtml(cat)}</h5>`;
    let table = '<table class="tbl"><thead><tr><th>Produkt</th><th class="num">Aktuálny stav</th><th class="num">Min. zásoba</th></tr></thead><tbody>';
    (grouped[cat] || []).forEach(item => {
      table += `<tr>
                  <td>${escapeHtml(item.name)}</td>
                  <td class="num loss">${escapeHtml(item.currentStock)}</td>
                  <td class="num">${escapeHtml(item.minStock)}</td>
                </tr>`;
    });
    html += `<div class="table-container">${table}</tbody></table></div>`;
  });
  html += `<p class="muted" style="margin-top:10px;">Pre detailný návrh nákupu tovaru podľa objednávok pozri <strong>Expedičný plán &gt; Návrh nákupu tovaru</strong>.</p>`;
  return html;
}

// ---------- TOP5 + graf -------------------------------------------

function populateTopProductsTable(items) {
  const container = document.getElementById('top-products-container');
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="box"><p style="margin:0;">Za posledných 30 dní neboli vyrobené žiadne produkty.</p></div>';
    return;
  }
  let table = '<table class="tbl"><thead><tr><th>Produkt</th><th class="num">Vyrobené (kg)</th></tr></thead><tbody>';
  items.forEach(item => {
    table += `<tr><td>${escapeHtml(item.name)}</td><td class="num"><strong>${safeToFixed(item.total)}</strong></td></tr>`;
  });
  container.innerHTML = table + '</tbody></table>';
}

let googleChartsLoadedPromise = null;
function loadGoogleCharts() {
  if (googleChartsLoadedPromise) return googleChartsLoadedPromise;
  googleChartsLoadedPromise = new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.charts) {
      google.charts.load('current', { 'packages': ['corechart'] });
      google.charts.setOnLoadCallback(resolve);
    } else {
      const timer = setInterval(()=>{
        if (typeof google !== 'undefined' && google.charts) {
          clearInterval(timer);
          google.charts.load('current', { 'packages': ['corechart'] });
          google.charts.setOnLoadCallback(resolve);
        }
      }, 120);
    }
  });
  return googleChartsLoadedPromise;
}

async function drawProductionChart(timeSeriesData) {
  try {
    await loadGoogleCharts();
    const container = document.getElementById('production-chart-container');
    if (!container) return;
    if (!timeSeriesData || timeSeriesData.length === 0) {
      container.innerHTML = '<div class="box" style="display:flex; justify-content:center; align-items:center; height:100%;"><p class="muted">Žiadne dáta pre graf výroby za posledných 30 dní.</p></div>';
      return;
    }
    const chartData = new google.visualization.DataTable();
    chartData.addColumn('date', 'Dátum');
    chartData.addColumn('number', 'Vyrobené kg');
    timeSeriesData.forEach(row => {
      chartData.addRow([new Date(row.production_date), parseFloat(row.total_kg)]);
    });
    const options = {
      title: 'Výroba za posledných 30 dní (kg)',
      legend: { position: 'none' },
      colors: ['#3b82f6'],
      vAxis: { title: 'Množstvo (kg)', minValue: 0 },
      hAxis: { title: 'Dátum', format: 'd.M' },
      chartArea: { width: '90%', height: '75%' }
    };
    const chart = new google.visualization.ColumnChart(container);
    chart.draw(chartData, options);
  } catch (error) {
    console.error("Chyba pri kreslení Google Chart:", error);
    const chartContainer = document.getElementById('production-chart-container');
    if (chartContainer) { chartContainer.innerHTML = '<p class="error">Graf sa nepodarilo načítať.</p>'; }
  }
}

// ---------- Pomocné funkcie ---------------------------------------

function showSection(id) {
    const navLink = document.querySelector(`.nav-link[data-section="${id}"]`);
    if (navLink) navLink.click();
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

function safeToFixed(v, d=2){ 
  const n=Number(v); 
  return isFinite(n) ? n.toFixed(d) : '0.00'; 
}

// Bezpečný apiRequest na zabránenie chyby "Maximum call stack size exceeded"
async function apiRequest(url, opts = {}) {
    if (window.apiRequest && window.apiRequest !== apiRequest) {
        return await window.apiRequest(url, opts);
    }
    try {
        const response = await fetch(url, opts);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        console.error("API Request failed:", e);
        throw e;
    }
}

// ---------- Styles (z pôvodného dashboard.js) --------------------
(function injectDashStyles(){
  const css = `
  #dashboard-content{ display:block }
  .dash-cards{ display:flex; gap:15px; flex-wrap:wrap; margin: 0 0 20px 0; }
  .dash-card{ flex:1; min-width:220px; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:20px; box-shadow:0 2px 10px rgba(0,0,0,.04); transition: transform 0.1s; }
  .dash-card:hover { transform: translateY(-2px); }
  .dash-card-label{ font-size:.9rem; color:#6b7280; margin-bottom:8px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;}
  .dash-card-value{ font-size:2.5rem; font-weight:700; color:#111827;}
  .box{ background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:18px;}
  .box.warn{ background:#fffbe6; border-color:#fde68a;}
  .box .box-title{ margin:0 0 8px 0; color:#374151; }
  .table-container{ overflow-x:auto; background:#fff; border:1px solid #e5e7eb; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.05);}
  table.tbl{ width:100%; border-collapse:collapse; }
  table.tbl th, table.tbl td{ padding:12px 10px; border-bottom:1px solid #e5e7eb; text-align:left; }
  table.tbl th { background: #f9fafb; color: #4b5563; font-weight: 600; }
  table .num{ text-align:right; font-variant-numeric: tabular-nums; }
  .muted{ color:#6b7280; font-size:.9rem; }
  .loss{ color:#dc2626; font-weight:600; }

  /* badge pre stav akcií */
  .badge{ display:inline-block; padding:4px 10px; border-radius:999px; font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.02em;}
  .badge-green{ background:#dcfce7; color:#065f46; border:1px solid #a7f3d0; }
  .badge-blue{  background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; }
  .badge-orange{background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; }
  .badge-gray{  background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; }
  `;
  const style = document.createElement('style'); style.textContent = css;
  document.head && document.head.appendChild(style);
})();

window.initializeDashboardModule = initializeDashboardModule;