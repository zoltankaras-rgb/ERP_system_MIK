// =================================================================
// === SUB-MODUL KANCELÁRIA: DASHBOARD (Vertikálne rozloženie + B2B/B2C) ===
// =================================================================

let dashboardState = {
    period: null,
    data: null,
    googleChartsReady: null
};

// Táto funkcia sa volá z kancelaria.js po načítaní stránky
function initializeDashboardModule() {
    loadDashboardData();
}

async function loadDashboardData() {
    const content = document.getElementById('section-dashboard');
    if (!content) return;
    
    content.innerHTML = '<div class="stat-card" style="text-align:center; padding:40px;"><i class="fas fa-spinner fa-spin fa-2x" style="color:#3b82f6;"></i><br><br>Načítavam prehľady...</div>';

    try {
        // 1. Načítame dáta z API
        const data = await apiRequest('/api/kancelaria/getDashboardData');
        
        dashboardState.data = data || {};
        dashboardState.period = data?.period || "30 dní";

        // 2. Vykreslíme UI
        buildDashboardUI(content, data);
        
        // 3. Graf výroby
        if (data.timeSeriesData && data.timeSeriesData.length > 0) {
            drawProductionChart(data.timeSeriesData);
        }

        // 4. Akcie
        hydratePromotions();

    } catch (e) {
        console.error(e);
        content.innerHTML = `<div class="stat-card error">
            <h3>Chyba</h3>
            <p>Nepodarilo sa načítať dashboard: ${escapeHtml(e.message || String(e))}</p>
        </div>`;
    }
}

function buildDashboardUI(container, data) {
    const rawLow = data.lowStockRaw || [];
    const goodsLow = data.lowStockGoods || {}; 
    const topProd = data.topProducts || [];
    const timeSeries = data.timeSeriesData || [];
    const bestSellers = data.bestSellers || []; 
    
    // Čísla pre notifikácie (zo servera)
    const pendingB2B = data.pendingB2B || 0;
    const activeB2COrders = data.activeB2COrders || 0;

    let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h3 style="margin:0; color:#1e3a8a;">📊 Prehľad systému</h3>
        <button class="btn-secondary btn-sm" onclick="initializeDashboardModule()">🔄 Obnoviť</button>
    </div>

    <div class="dashboard-stack" style="display:flex; flex-direction:column; gap:20px;">
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
            <div class="stat-card ${pendingB2B > 0 ? 'warn-card' : 'success-card'}" style="cursor:pointer; border-left:5px solid ${pendingB2B > 0 ? '#f59e0b':'#10b981'}" onclick="showSection('b2b-admin')">
                <div style="display:flex; align-items:center; gap:15px;">
                    <i class="fas fa-user-plus fa-2x"></i>
                    <div>
                        <div style="font-size:0.9rem; opacity:0.8;">Čakajúce B2B registrácie</div>
                        <div style="font-size:1.8rem; font-weight:bold;">${pendingB2B}</div>
                    </div>
                </div>
            </div>
            <div class="stat-card info-card" style="cursor:pointer; border-left:5px solid #3b82f6" onclick="showSection('b2c-admin')">
                <div style="display:flex; align-items:center; gap:15px;">
                    <i class="fas fa-shopping-cart fa-2x"></i>
                    <div>
                        <div style="font-size:0.9rem; opacity:0.8;">Aktívne B2C objednávky</div>
                        <div style="font-size:1.8rem; font-weight:bold;">${activeB2COrders}</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="stat-card warn-card" style="border-left: 5px solid #f59e0b;">
            <h4 style="margin-top:0;"><i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> Výrobné suroviny pod minimom</h4>
            ${renderRawTable(rawLow)}
        </div>
        
        <div class="stat-card warn-card" style="border-left: 5px solid #ef4444;">
            <h4 style="margin-top:0;"><i class="fas fa-boxes" style="color:#ef4444;"></i> Expedičný tovar pod minimom</h4>
            ${renderGoodsTable(goodsLow)}
        </div>

        <div class="stat-card success-card" style="border-left: 5px solid #10b981;">
            <h4 style="margin-top:0;"><i class="fas fa-chart-line" style="color:#10b981;"></i> Top predaj (B2B + B2C)</h4>
            ${renderBestSellersTable(bestSellers)}
        </div>

        <div class="stat-card info-card" style="border-left: 5px solid #3b82f6;">
            <h4 style="margin-top:0;"><i class="fas fa-industry" style="color:#3b82f6;"></i> Výroba (posledných 30 dní)</h4>
            <div id="production-chart-container" style="height: 250px; width:100%;">
                 ${timeSeries.length === 0 ? '<p class="text-muted" style="padding:40px; text-align:center;">Žiadna dokončená výroba.</p>' : ''}
            </div>
            ${topProd.length > 0 ? renderTopProductsTable(topProd) : ''}
        </div>

        <div id="promotions-block"></div>

    </div>
    `;

    container.innerHTML = html;
}

// Pomocná funkcia pre navigáciu z dashboardu
function showSection(id) {
    const navLink = document.querySelector(`.nav-link[data-section="${id}"]`);
    if (navLink) navLink.click();
}

function renderRawTable(items) {
    if (!items || items.length === 0) return '<div class="ok-text" style="color:#166534; background:#dcfce7; padding:10px; border-radius:6px;">✅ Všetky suroviny sú v poriadku.</div>';
    let h = '<div class="table-container"><table class="tbl" style="width:100%"><thead><tr><th>Surovina</th><th style="text-align:right">Sklad</th><th style="text-align:right">Min</th></tr></thead><tbody>';
    items.forEach(i => {
        h += `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right; font-weight:bold; color:#dc2626;">${parseFloat(i.quantity).toFixed(2)}</td><td style="text-align:right; color:#64748b;">${parseFloat(i.minStock).toFixed(2)}</td></tr>`;
    });
    h += '</tbody></table></div>';
    return h;
}

function renderGoodsTable(grouped) {
    const keys = Object.keys(grouped || {});
    if (keys.length === 0) return '<div class="ok-text" style="color:#166534; background:#dcfce7; padding:10px; border-radius:6px;">✅ Všetok tovar je v poriadku.</div>';
    let h = '<div class="table-container">';
    keys.forEach(cat => {
        h += `<h5 style="margin:10px 0 5px 0; color:#475569; font-size:0.85rem;">${escapeHtml(cat)}</h5><table class="tbl" style="width:100%"><tbody>`;
        grouped[cat].forEach(i => {
            h += `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right; font-weight:bold; color:#dc2626; width:100px;">${i.currentStock}</td><td style="text-align:right; color:#64748b; width:100px;">${i.minStock}</td></tr>`;
        });
        h += '</tbody></table>';
    });
    h += '</div>';
    return h;
}

function renderBestSellersTable(items) {
    if (!items || items.length === 0) return '<p class="text-muted" style="padding:10px;">Žiadne predaje.</p>';
    let h = `<div class="table-container"><table class="tbl" style="width:100%"><thead><tr><th>Produkt</th><th style="text-align:right">Predané</th><th style="text-align:right">Predaj €</th></tr></thead><tbody>`;
    items.forEach(i => {
        h += `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right; font-weight:bold;">${parseFloat(i.total_qty).toFixed(2)}</td><td style="text-align:right; font-weight:bold; color:#166534;">${parseFloat(i.avg_sell_price).toFixed(2)}</td></tr>`;
    });
    h += '</tbody></table></div>';
    return h;
}

function renderTopProductsTable(items) {
    let h = `<h5 style="margin-top:15px; margin-bottom:5px;">Top výroba (kg)</h5><table class="tbl" style="width:100%"><tbody>`;
    items.forEach(i => {
        h += `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right; font-weight:bold;">${parseFloat(i.total).toFixed(2)} kg</td></tr>`;
    });
    h += '</tbody></table>';
    return h;
}

async function hydratePromotions() {
    const block = document.getElementById('promotions-block');
    if (!block) return;
    try {
        const data = await apiRequest('/api/kancelaria/get_promotions_data');
        const list = Array.isArray(data?.promotions) ? data.promotions : [];
        const active = list.filter(p => new Date(p.end_date) >= new Date());
        if (active.length === 0) return;

        let h = `<div class="stat-card" style="border:1px solid #e2e8f0;"><h4 style="margin:0 0 10px 0;">📢 Aktuálne Akcie</h4><table class="tbl" style="width:100%"><thead><tr><th>Reťazec</th><th>Produkt</th><th>Cena</th></tr></thead><tbody>`;
        active.forEach(p => {
            h += `<tr><td>${escapeHtml(p.chain_name)}</td><td>${escapeHtml(p.product_name)}</td><td style="font-weight:bold;">${parseFloat(p.sale_price_net).toFixed(2)} €</td></tr>`;
        });
        h += '</tbody></table></div>';
        block.innerHTML = h;
    } catch (e) { console.warn("Akcie error:", e); }
}

async function drawProductionChart(timeSeriesData) {
    await loadGoogleCharts();
    if (typeof google === 'undefined' || !google.visualization) return;
    const container = document.getElementById('production-chart-container');
    if (!container) return;
    const chartData = new google.visualization.DataTable();
    chartData.addColumn('string', 'Dátum');
    chartData.addColumn('number', 'Kg');
    timeSeriesData.forEach(row => {
        const d = new Date(row.production_date);
        chartData.addRow([`${d.getDate()}.${d.getMonth()+1}.`, parseFloat(row.total_kg)]);
    });
    const options = { legend: { position: 'none' }, colors: ['#3b82f6'], chartArea: { width: '90%', height: '80%' } };
    const chart = new google.visualization.ColumnChart(container);
    chart.draw(chartData, options);
}

function loadGoogleCharts() {
    if (googleChartsPromise) return googleChartsPromise;
    googleChartsPromise = new Promise((resolve) => {
        if (typeof google !== 'undefined' && google.charts) {
            google.charts.load('current', { 'packages': ['corechart'] });
            google.charts.setOnLoadCallback(resolve);
        } else { resolve(false); }
    });
    return googleChartsPromise;
}

let googleChartsPromise = null;

function escapeHtml(text) {
    if (!text) return "";
    return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function apiRequest(url, opts = {}) {
    if (window.apiRequest && window.apiRequest !== apiRequest) {
        return await window.apiRequest(url, opts);
    }
    try {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e) { throw e; }
}

window.initializeDashboardModule = initializeDashboardModule;