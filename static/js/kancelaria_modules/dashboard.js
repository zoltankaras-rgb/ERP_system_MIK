// =================================================================
// === SUB-MODUL KANCELÁRIA: DASHBOARD (Nový dizajn + Best Sellers) ===
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
        // 1. Načítame dáta z nového/upraveného API
        const data = await apiRequest('/api/kancelaria/getDashboardData');
        
        dashboardState.data = data || {};
        dashboardState.period = data?.period || null;

        // 2. Vykreslíme UI
        buildDashboardUI(content, data);
        
        // 3. Dotiahneme Google Charts (pre graf výroby)
        if (data.timeSeriesData && data.timeSeriesData.length > 0) {
            drawProductionChart(data.timeSeriesData);
        }

        // 4. Dotiahneme akcie (Promo) z druhého API
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
    // Rozbalenie dát (s ochranou proti null)
    const rawLow = data.lowStockRaw || [];
    const goodsLow = data.lowStockGoods || {}; // grouped object
    const topProd = data.topProducts || [];
    const timeSeries = data.timeSeriesData || [];
    const bestSellers = data.bestSellers || []; 

    // === HLAVNÝ GRID ===
    let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h3 style="margin:0; color:#1e3a8a;">📊 Prehľad firmy</h3>
        <button class="btn-secondary btn-sm" onclick="initializeDashboardModule()">🔄 Obnoviť</button>
    </div>

    <div class="dashboard-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
        
        <div class="dash-col">
            
            <div class="stat-card warn-card" style="border-left: 5px solid #f59e0b;">
                <h4 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> 
                    Výrobné suroviny pod minimom
                </h4>
                ${renderRawTable(rawLow)}
            </div>
            
            <div class="stat-card warn-card" style="margin-top:20px; border-left: 5px solid #ef4444;">
                <h4 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-boxes" style="color:#ef4444;"></i> 
                    Expedičný tovar pod minimom
                </h4>
                ${renderGoodsTable(goodsLow)}
            </div>

            <div id="promotions-block" style="margin-top:20px;">
                </div>

        </div>

        <div class="dash-col">
            
            <div class="stat-card success-card" style="border-left: 5px solid #10b981;">
                <h4 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-chart-line" style="color:#10b981;"></i> 
                    Top predaj (30 dní) B2B + B2C
                </h4>
                ${renderBestSellersTable(bestSellers)}
            </div>

            <div class="stat-card info-card" style="margin-top:20px; border-left: 5px solid #3b82f6;">
                <h4 style="margin-top:0; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-industry" style="color:#3b82f6;"></i> 
                    Výroba (30 dní)
                </h4>
                
                <div id="production-chart-container" style="height: 250px; position:relative;">
                     ${timeSeries.length === 0 ? '<p class="text-muted" style="padding:40px; text-align:center;">Žiadna dokončená výroba za posl. 30 dní.</p>' : ''}
                </div>
                
                ${topProd.length > 0 ? renderTopProductsTable(topProd) : ''}
                
                <div style="margin-top:10px; font-size:0.75rem; color:#64748b; text-align:center;">
                    * Zobrazuje sa len výroba so stavom "Ukončené" (prijaté na sklad).
                </div>
            </div>

        </div>
    </div>
    `;

    container.innerHTML = html;
}

// --- Renderers ---

function renderRawTable(items) {
    if (!items || items.length === 0) return '<div class="ok-text" style="color:#166534; background:#dcfce7; padding:10px; border-radius:6px;">✅ Všetky suroviny sú v poriadku.</div>';
    
    let h = '<div class="table-container" style="max-height:200px; overflow-y:auto;"><table class="tbl" style="width:100%"><thead><tr><th>Surovina</th><th style="text-align:right">Sklad</th><th style="text-align:right">Min</th></tr></thead><tbody>';
    items.forEach(i => {
        h += `<tr>
            <td>${escapeHtml(i.name)}</td>
            <td style="text-align:right; font-weight:bold; color:#dc2626;">${parseFloat(i.quantity).toFixed(2)}</td>
            <td style="text-align:right; color:#64748b;">${parseFloat(i.minStock).toFixed(2)}</td>
        </tr>`;
    });
    h += '</tbody></table></div>';
    return h;
}

function renderGoodsTable(grouped) {
    const keys = Object.keys(grouped || {});
    if (keys.length === 0) return '<div class="ok-text" style="color:#166534; background:#dcfce7; padding:10px; border-radius:6px;">✅ Všetok tovar je v poriadku.</div>';
    
    let h = '<div class="table-container" style="max-height:250px; overflow-y:auto;">';
    keys.forEach(cat => {
        h += `<h5 style="margin:10px 0 5px 0; color:#475569; font-size:0.85rem; text-transform:uppercase;">${escapeHtml(cat)}</h5>
              <table class="tbl" style="width:100%"><tbody>`;
        grouped[cat].forEach(i => {
            h += `<tr>
                <td>${escapeHtml(i.name)}</td>
                <td style="text-align:right; font-weight:bold; color:#dc2626; width:80px;">${i.currentStock}</td>
                <td style="text-align:right; color:#64748b; width:80px;">Min: ${i.minStock}</td>
            </tr>`;
        });
        h += '</tbody></table>';
    });
    h += '</div>';
    return h;
}

function renderBestSellersTable(items) {
    if (!items || items.length === 0) return '<p class="text-muted" style="padding:20px; text-align:center;">Žiadne predaje za posledných 30 dní.</p>';
    
    let h = `<div class="table-container"><table class="tbl" style="width:100%">
        <thead>
            <tr>
                <th>Produkt</th>
                <th style="text-align:right">Predané</th>
                <th style="text-align:right">Nákup €</th>
                <th style="text-align:right">Predaj €</th>
            </tr>
        </thead>
        <tbody>`;
    
    items.forEach(i => {
        // Farba pre zisk/stratu
        const isLoss = i.avg_sell_price < i.avg_buy_price;
        const color = isLoss ? '#dc2626' : '#166534';
        
        h += `<tr>
            <td title="EAN: ${escapeHtml(i.ean)}" style="font-weight:500; font-size:0.9rem;">${escapeHtml(i.name)}</td>
            <td style="text-align:right; font-weight:bold;">${parseFloat(i.total_qty).toFixed(2)}</td>
            <td style="text-align:right; color:#64748b; font-size:0.85rem;">${parseFloat(i.avg_buy_price).toFixed(2)}</td>
            <td style="text-align:right; color:${color}; font-weight:bold;">${parseFloat(i.avg_sell_price).toFixed(2)}</td>
        </tr>`;
    });
    
    h += '</tbody></table></div>';
    return h;
}

function renderTopProductsTable(items) {
    if (!items || items.length === 0) return '';
    
    let h = `<h5 style="margin-top:15px; margin-bottom:5px;">Top výroba (kg)</h5>
             <table class="tbl" style="width:100%"><tbody>`;
    items.forEach(i => {
        h += `<tr>
            <td>${escapeHtml(i.name)}</td>
            <td style="text-align:right; font-weight:bold;">${parseFloat(i.total).toFixed(2)} kg</td>
        </tr>`;
    });
    h += '</tbody></table>';
    return h;
}

// --- AKCIE (Hydratácia po načítaní) ---
async function hydratePromotions() {
    const block = document.getElementById('promotions-block');
    if (!block) return;

    try {
        const data = await apiRequest('/api/kancelaria/get_promotions_data'); // { chains, products, promotions }
        const list = Array.isArray(data?.promotions) ? data.promotions : [];

        // Filtrujeme (rovnaká logika ako predtým)
        const today = new Date(); today.setHours(0,0,0,0);
        const mapped = list.map(p => {
            const s = p.start_date ? new Date(p.start_date) : null;
            const e = p.end_date ? new Date(p.end_date) : null;
            let state = 'upcoming';
            
            if (s && today < s) state = 'upcoming';
            else if (e && today > e) state = 'ended';
            else state = 'active';

            return { ...p, state, s, e };
        }).filter(p => p.state !== 'ended');

        // Render
        if (mapped.length === 0) {
            block.innerHTML = ''; // Skryjeme ak nie sú akcie, alebo dáme správu
            return;
        }

        let h = `<div class="stat-card" style="border:1px solid #e2e8f0;">
            <h4 style="margin:0 0 10px 0;">📢 Aktuálne Akcie</h4>
            <div class="table-container"><table class="tbl" style="width:100%">
            <thead><tr><th>Reťazec</th><th>Produkt</th><th>Cena</th><th>Koniec</th></tr></thead><tbody>`;
        
        mapped.forEach(p => {
            const endStr = p.e ? p.e.toLocaleDateString('sk-SK') : '-';
            const badge = p.state === 'active' 
                ? '<span style="background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px; font-size:0.75rem;">Beží</span>'
                : '<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.75rem;">Budúca</span>';

            h += `<tr>
                <td>${escapeHtml(p.chain_name)}</td>
                <td>${escapeHtml(p.product_name)}</td>
                <td style="font-weight:bold;">${parseFloat(p.sale_price_net).toFixed(2)} €</td>
                <td>${endStr} ${badge}</td>
            </tr>`;
        });
        h += '</tbody></table></div></div>';
        block.innerHTML = h;

    } catch (e) {
        console.warn("Chyba pri načítaní akcií:", e);
    }
}

// --- GOOGLE CHARTS (Graf) ---
let googleChartsPromise = null;
function loadGoogleCharts() {
    if (googleChartsPromise) return googleChartsPromise;
    googleChartsPromise = new Promise((resolve) => {
        if (typeof google !== 'undefined' && google.charts) {
            google.charts.load('current', { 'packages': ['corechart'] });
            google.charts.setOnLoadCallback(resolve);
        } else {
            // Fallback ak Google script nie je v HTML
            resolve(false);
        }
    });
    return googleChartsPromise;
}

async function drawProductionChart(timeSeriesData) {
    if (!timeSeriesData || timeSeriesData.length === 0) return;
    
    await loadGoogleCharts();
    if (typeof google === 'undefined' || !google.visualization) return;

    const container = document.getElementById('production-chart-container');
    if (!container) return;
    
    // Príprava dát
    const chartData = new google.visualization.DataTable();
    chartData.addColumn('string', 'Dátum');
    chartData.addColumn('number', 'Kg');
    
    timeSeriesData.forEach(row => {
        // Formát dátumu d.M.
        const d = new Date(row.production_date);
        const label = `${d.getDate()}.${d.getMonth()+1}.`;
        chartData.addRow([label, parseFloat(row.total_kg)]);
    });

    const options = {
        title: '',
        legend: { position: 'none' },
        colors: ['#3b82f6'],
        chartArea: { width: '85%', height: '80%' },
        vAxis: { minValue: 0, gridlines: { color: '#f1f5f9' } },
        hAxis: { textStyle: { fontSize: 10 } }
    };

    const chart = new google.visualization.ColumnChart(container);
    chart.draw(chartData, options);
}

// --- UTILS ---
function escapeHtml(text) {
    if (!text) return text;
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function apiRequest(url, opts={}) {
    // Používame globálny apiRequest z common.js ak existuje
    if (typeof window.apiRequest === 'function') {
        return window.apiRequest(url, opts);
    }
    return fetch(url, opts).then(r => r.json());
}

// Export pre kancelaria.js
window.initializeDashboardModule = initializeDashboardModule;