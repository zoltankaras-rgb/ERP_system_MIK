// =================================================================
// === SUB-MODUL KANCELÁRIA: PLÁNOVANIE ===
// =================================================================
// /static/js/kancelaria_modules/planning.js
// =================================================================

;(function () {
  'use strict';

  // Bezpečný alias na apiRequest:
  // - ak existuje window.apiRequest (common.js / kancelaria.js), použijeme ho
  // - inak fallback na fetch
  const apiRequest = (typeof window !== 'undefined' && typeof window.apiRequest === 'function')
    ? window.apiRequest.bind(window)
    : async function (url, options = {}) {
        const opts = {
          method: options.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
        };
        if (options.body) {
          opts.body = JSON.stringify(options.body);
        }
        const res = await fetch(url, opts);
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await res.json() : await res.text();
        if (!res.ok) {
          const msg = isJson ? (data?.error || JSON.stringify(data)) : String(data);
          throw new Error(msg || `HTTP ${res.status}`);
        }
        return data;
      };

  const escapeHtml = window.escapeHtml || function (s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const safeToFixed = window.safeToFixed || function (v, d = 3) {
    if (v == null || isNaN(Number(v))) return '0';
    return Number(v).toFixed(d);
  };

  const showStatus = window.showStatus || function (msg, isError) {
    alert(msg);
  };

  const ensureOfficeDataIsLoaded = window.ensureOfficeDataIsLoaded || (async () => {});
  const officeInitialData = window.officeInitialData || {};

  // Pomocná funkcia – zavolá globálny showModal, keď už existuje
  function openModal(title, contentFactory) {
    if (typeof window.showModal === 'function') {
      window.showModal(title, contentFactory);
    } else {
      console.warn('showModal nie je ešte definovaný, obsah sa nezobrazí:', title);
    }
  }

  // ---------- Inicializácia sekcie PLÁNOVANIE ----------
 // --- 1. Nájdite a PREPÍŠTE túto funkciu v planning.js ---
function initializePlanningModule() {
  const container = document.getElementById('section-planning');
  if (!container) return;

  // Pridané tlačidlo "História Inventúr" (id="show-inventory-history-btn")
  container.innerHTML = `
    <h3>Plánovanie a Reporty</h3>
    <div class="btn-grid">
      <button id="show-plan-btn" class="btn-primary">
        <i class="fas fa-tasks"></i> Plán Výroby
      </button>
      <button id="show-prod-stats-btn" class="btn-secondary">
        <i class="fas fa-chart-bar"></i> Prehľad Výroby
      </button>
      <button id="show-reception-report-btn" class="btn-primary">
        <i class="fas fa-clipboard-list"></i> Príjem z výroby
      </button>
      <button id="show-inventory-history-btn" class="btn-info">
        <i class="fas fa-history"></i> História Inventúr
      </button>
      <button id="show-print-reports-btn" class="btn-warning">
        <i class="fas fa-print"></i> Tlač Reportov
      </button>
    </div>

    <div id="planner-inline-root" class="card" style="margin-top:1rem; display:none;"></div>
  `;

  // Event listenery
  document.getElementById('show-reception-report-btn').onclick =
    () => openModal('Príjem z výroby (podľa dátumu)', createReceptionReportContent);

  document.getElementById('show-plan-btn').onclick = () => {
    const root = document.getElementById('planner-inline-root');
    root.style.display = 'block';
    renderProductionPlanInline();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.getElementById('show-prod-stats-btn').onclick =
    () => openModal('Prehľad Výroby', createProductionStatsContent);

  document.getElementById('show-print-reports-btn').onclick =
    () => openModal('Tlač Reportov', createPrintReportsContent);

  // NOVÝ LISTENER PRE INVENTÚRU
  document.getElementById('show-inventory-history-btn').onclick =
    () => openModal('História Inventúr', createInventoryHistoryContent);
}

// --- 2. PRIDAJTE tieto funkcie na koniec planning.js (pred posledné })(); ) ---

async function createInventoryHistoryContent() {
  let logs = [];
  try {
    logs = await apiRequest('/api/kancelaria/getInventoryHistory');
  } catch (e) {
    return { html: `<div class="error">Chyba pri načítaní: ${e.message}</div>` };
  }

  if (!logs || logs.length === 0) {
    return { html: '<p>Zatiaľ neboli vykonané žiadne inventúry.</p>' };
  }

  let listHtml = `
    <div class="table-container" style="max-height: 300px;">
      <table>
        <thead>
          <tr>
            <th>Dátum</th>
            <th>Pracovník</th>
            <th>Počet položiek</th>
            <th>Akcia</th>
          </tr>
        </thead>
        <tbody>
  `;

  logs.forEach(log => {
    // Bezpečné formátovanie dátumu
    let dateStr = log.created_at;
    try { dateStr = new Date(log.created_at).toLocaleString('sk-SK'); } catch(e){}
    
    listHtml += `
      <tr>
        <td>${dateStr}</td>
        <td>${escapeHtml(log.worker_name)}</td>
        <td>${log.item_count}</td>
        <td>
          <button class="btn-primary btn-sm view-inv-detail" data-id="${log.id}">
            <i class="fas fa-eye"></i> Detail
          </button>
        </td>
      </tr>
    `;
  });

  listHtml += `</tbody></table></div><div id="inventory-detail-view" style="margin-top:20px; border-top:1px solid #ddd; padding-top:20px; display:none;"></div>`;

  const onReady = () => {
    document.querySelectorAll('.view-inv-detail').forEach(btn => {
      btn.onclick = async () => {
        await loadInventoryDetail(btn.dataset.id);
      };
    });
  };

  return { html: listHtml, onReady };
}

// planning.js - Nahraďte funkciu loadInventoryDetail

async function loadInventoryDetail(id) {
  const container = document.getElementById('inventory-detail-view');
  container.style.display = 'block';
  container.innerHTML = '<p>Načítavam detail...</p>';

  try {
    const data = await apiRequest(`/api/kancelaria/getInventoryDetail?id=${id}`);
    if (data.error) {
      container.innerHTML = `<div class="error">${data.error}</div>`;
      return;
    }

    const { log, items } = data;
    let dateStr = log.created_at;
    try { dateStr = new Date(log.created_at).toLocaleString('sk-SK'); } catch(e){}

    const groups = {};
    let grandTotal = 0;

    items.forEach(item => {
        const cat = item.category || 'Nezaradené';
        if (!groups[cat]) groups[cat] = { items: [], total: 0 };
        const diffVal = parseFloat(item.diff_value || 0);
        groups[cat].items.push(item);
        groups[cat].total += diffVal;
        grandTotal += diffVal;
    });

    let groupsHtml = '';
    const sortedCats = Object.keys(groups).sort();

    sortedCats.forEach(cat => {
        const group = groups[cat];
        const groupColor = group.total < 0 ? 'red' : (group.total > 0 ? 'green' : 'black');
        
        let rowsHtml = '';
        group.items.forEach(item => {
            const diffQty = parseFloat(item.diff_qty);
            const diffVal = parseFloat(item.diff_value);
            
            rowsHtml += `
              <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.product_name)}</td>
                <td style="text-align:right; padding: 6px;">${safeToFixed(item.system_qty, 2)}</td>
                <td style="text-align:right; padding: 6px;"><strong>${safeToFixed(item.real_qty, 2)}</strong></td>
                <td style="text-align:right; padding: 6px; color:${diffQty < 0 ? 'red' : (diffQty > 0 ? 'green' : 'inherit')}">
                  ${diffQty > 0 ? '+' : ''}${safeToFixed(diffQty, 2)}
                </td>
                <td style="text-align:right; padding: 6px;">${safeToFixed(item.unit_price, 2)} €</td>
                <td style="text-align:right; padding: 6px; font-weight:bold; color:${diffVal < 0 ? 'red' : (diffVal > 0 ? 'green' : 'inherit')}">
                  ${diffVal > 0 ? '+' : ''}${safeToFixed(diffVal, 2)} €
                </td>
              </tr>
            `;
        });

        // TABUĽKA S PEVNOU ŠÍRKOU STĹPCOV
        groupsHtml += `
            <div style="margin-top: 30px; page-break-inside: avoid;">
                <h5 style="margin: 0 0 5px 0; color: #374151; text-transform: uppercase; font-size: 1.1em; border-left: 4px solid #3b82f6; padding-left: 10px;">
                    ${escapeHtml(cat)}
                </h5>
                <div style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.9rem; table-layout: fixed;">
                        <colgroup>
                            <col style="width: 35%;"> <col style="width: 13%;"> <col style="width: 13%;"> <col style="width: 13%;"> <col style="width: 13%;"> <col style="width: 13%;"> </colgroup>
                        <thead>
                            <tr style="background:#f3f4f6; color:#6b7280; border-bottom: 2px solid #e5e7eb;">
                                <th style="text-align:left; padding:8px;">Produkt</th>
                                <th style="text-align:right; padding:8px;">Systém</th>
                                <th style="text-align:right; padding:8px;">Realita</th>
                                <th style="text-align:right; padding:8px;">Rozdiel</th>
                                <th style="text-align:right; padding:8px;">Cena</th>
                                <th style="text-align:right; padding:8px;">Hodnota</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                        <tfoot>
                            <tr style="background-color: #fafafa;">
                                <td colspan="5" style="text-align:right; padding: 10px; border-top: 2px solid #000;">
                                    <span style="text-transform: uppercase; font-size: 0.85em; color: #666; display:block; margin-bottom:2px;">Bilancia skladu:</span>
                                    <strong style="font-size: 1.1em;">${escapeHtml(cat)}</strong>
                                </td>
                                <td style="text-align:right; padding: 10px; border-top: 2px solid #000; vertical-align: bottom;">
                                    <span style="font-weight:bold; font-size: 1.2em; color: ${groupColor};">
                                        ${safeToFixed(group.total, 2)} €
                                    </span>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    });

    const grandColor = grandTotal < 0 ? 'red' : (grandTotal > 0 ? 'green' : 'black');

    const html = `
      <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #e5e7eb;">
        <div style="display:flex; justify-content: space-between; align-items: center;">
            <div>
                <h3 style="margin:0 0 5px 0;">Detail inventúry</h3>
                <div style="color:#555;">Dátum: <strong>${dateStr}</strong> | Vykonal: <strong>${escapeHtml(log.worker_name)}</strong></div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.9em; color:#666;">CELKOVÁ BILANCIA</div>
                <div style="font-size:1.5em; font-weight:bold; color:${grandColor}">
                   ${safeToFixed(grandTotal, 2)} €
                </div>
            </div>
        </div>
        <div class="btn-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top:15px;">
           <button id="inv-print-pdf" class="btn-warning"><i class="fas fa-print"></i> Tlačiť / PDF</button>
        </div>
      </div>

      ${groupsHtml}
    `;

    container.innerHTML = html;
    document.getElementById('inv-print-pdf').onclick = () => printInventoryGrouped(log, groups, grandTotal);
    container.scrollIntoView({ behavior: 'smooth' });

  } catch (e) {
    container.innerHTML = `<div class="error">Chyba: ${e.message}</div>`;
  }
}

// planning.js - Nahraďte funkciu printInventoryGrouped

function printInventoryGrouped(log, groups, grandTotal) {
    const printWindow = window.open('', '_blank');
    const dateStr = new Date(log.created_at).toLocaleString('sk-SK');
    
    let contentHtml = '';
    const sortedCats = Object.keys(groups).sort();

    sortedCats.forEach(cat => {
        const group = groups[cat];
        const groupColor = group.total < 0 ? 'red' : 'black';

        let rows = '';
        group.items.forEach(item => {
            const diffQty = parseFloat(item.diff_qty);
            const diffVal = parseFloat(item.diff_value);
            rows += `
                <tr>
                    <td>${escapeHtml(item.product_name)}</td>
                    <td class="num">${safeToFixed(item.system_qty, 2)}</td>
                    <td class="num"><strong>${safeToFixed(item.real_qty, 2)}</strong></td>
                    <td class="num" style="color:${diffQty < 0 ? 'red' : 'inherit'}">${safeToFixed(diffQty, 2)}</td>
                    <td class="num">${safeToFixed(item.unit_price, 2)}</td>
                    <td class="num" style="font-weight:bold; color:${diffVal < 0 ? 'red' : 'inherit'}">${safeToFixed(diffVal, 2)}</td>
                </tr>
            `;
        });

        contentHtml += `
            <div class="category-block">
                <h3>${escapeHtml(cat)}</h3>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 35%;">Produkt</th>
                            <th style="width: 13%; text-align: right;">Systém</th>
                            <th style="width: 13%; text-align: right;">Realita</th>
                            <th style="width: 13%; text-align: right;">Rozdiel</th>
                            <th style="width: 13%; text-align: right;">Cena</th>
                            <th style="width: 13%; text-align: right;">Hodnota</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot>
                        <tr>
                            <td colspan="5" class="total-label">Bilancia skladu ${escapeHtml(cat)}:</td>
                            <td class="total-val" style="color:${groupColor}">${safeToFixed(group.total, 2)} €</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    });

    const grandColor = grandTotal < 0 ? 'red' : 'black';

    printWindow.document.write(`
      <html>
        <head>
          <title>Inventúra ${dateStr}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; font-size: 12px; color: #333; }
            h1 { margin: 0 0 5px 0; font-size: 24px; }
            .header-info { margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 15px; }
            .category-block { margin-bottom: 40px; page-break-inside: avoid; }
            h3 { margin: 0 0 8px 0; padding-left: 8px; border-left: 5px solid #555; text-transform: uppercase; font-size: 14px; }
            
            table { width: 100%; border-collapse: collapse; table-layout: fixed; } /* Fixná šírka stĺpcov */
            
            th { background-color: #f0f0f0; font-weight: bold; border-bottom: 1px solid #ccc; padding: 6px; text-align: left;}
            td { border-bottom: 1px solid #eee; padding: 6px; text-align: left; vertical-align: middle; }
            
            .num { text-align: right; }
            
            /* Pätička tabuľky */
            tfoot td { border-top: 2px solid #000; padding-top: 8px; padding-bottom: 8px; background: #fafafa; }
            .total-label { text-align: right; font-weight: bold; text-transform: uppercase; font-size: 11px; color: #666; }
            .total-val { text-align: right; font-weight: bold; font-size: 14px; }

            .grand-total { 
                text-align: right; margin-top: 40px; font-size: 20px; font-weight: bold; 
                border-top: 4px double #000; padding-top: 15px; 
            }
          </style>
        </head>
        <body>
          <div class="header-info">
            <h1>Report Inventúry</h1>
            <p style="font-size: 14px;"><strong>Dátum:</strong> ${dateStr} &nbsp;|&nbsp; <strong>Vykonal:</strong> ${escapeHtml(log.worker_name)}</p>
          </div>
          
          ${contentHtml}

          <div class="grand-total">
            CELKOVÁ BILANCIA: <span style="color:${grandColor}">${safeToFixed(grandTotal, 2)} €</span>
          </div>
          
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
}

// =================================================================
// === SUB-MODUL KANCELÁRIA: PLÁNOVANIE ===
// =================================================================
// /static/js/kancelaria_modules/planning.js
// =================================================================

;(function () {
  'use strict';

  // Bezpečný alias na apiRequest
  const apiRequest = (typeof window !== 'undefined' && typeof window.apiRequest === 'function')
    ? window.apiRequest.bind(window)
    : async function (url, options = {}) {
        const opts = {
          method: options.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
        };
        if (options.body) {
          opts.body = JSON.stringify(options.body);
        }
        const res = await fetch(url, opts);
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await res.json() : await res.text();
        if (!res.ok) {
          const msg = isJson ? (data?.error || JSON.stringify(data)) : String(data);
          throw new Error(msg || `HTTP ${res.status}`);
        }
        return data;
      };

  const escapeHtml = window.escapeHtml || function (s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const safeToFixed = window.safeToFixed || function (v, d = 3) {
    if (v == null || isNaN(Number(v))) return '0';
    return Number(v).toFixed(d);
  };

  const showStatus = window.showStatus || function (msg, isError) {
    alert(msg);
  };

  const ensureOfficeDataIsLoaded = window.ensureOfficeDataIsLoaded || (async () => {});
  const officeInitialData = window.officeInitialData || {};

  function openModal(title, contentFactory) {
    if (typeof window.showModal === 'function') {
      window.showModal(title, contentFactory);
    } else {
      console.warn('showModal nie je ešte definovaný:', title);
    }
  }

  // ---------- Inicializácia sekcie PLÁNOVANIE ----------
  function initializePlanningModule() {
    const container = document.getElementById('section-planning');
    if (!container) return;

    container.innerHTML = `
      <h3>Plánovanie a Reporty</h3>
      <div class="btn-grid">
        <button id="show-plan-btn" class="btn-primary">
          <i class="fas fa-tasks"></i> Plán Výroby
        </button>
        <button id="show-prod-stats-btn" class="btn-secondary">
          <i class="fas fa-chart-bar"></i> Prehľad Výroby
        </button>
        <button id="show-reception-report-btn" class="btn-primary">
          <i class="fas fa-clipboard-list"></i> Príjem z výroby
        </button>
        <button id="show-inventory-history-btn" class="btn-info">
          <i class="fas fa-history"></i> História Inventúr
        </button>
        <button id="show-print-reports-btn" class="btn-warning">
          <i class="fas fa-print"></i> Tlač Reportov
        </button>
      </div>

      <div id="planner-inline-root" class="card" style="margin-top:1rem; display:none;"></div>
    `;

    // Event listeners
    document.getElementById('show-reception-report-btn').onclick =
      () => openModal('Príjem z výroby', createReceptionReportContent);

    document.getElementById('show-plan-btn').onclick = () => {
      const root = document.getElementById('planner-inline-root');
      root.style.display = 'block';
      renderProductionPlanInline();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    document.getElementById('show-prod-stats-btn').onclick =
      () => openModal('Prehľad Výroby', createProductionStatsContent);

    document.getElementById('show-print-reports-btn').onclick =
      () => openModal('Tlač Reportov', createPrintReportsContent);

    // NOVÉ: História inventúr
    document.getElementById('show-inventory-history-btn').onclick =
      () => openModal('História Inventúr', createInventoryHistoryContent);
  }

  // =================================================================
  // === NOVÉ: HISTÓRIA INVENTÚR A REPORTY ===
  // =================================================================

  async function createInventoryHistoryContent() {
    // Načítame zoznam inventúr
    let logs = [];
    try {
      logs = await apiRequest('/api/kancelaria/getInventoryHistory');
    } catch (e) {
      return { html: `<div class="error">Chyba pri načítaní: ${e.message}</div>` };
    }

    if (!logs || logs.length === 0) {
      return { html: '<p>Zatiaľ neboli vykonané žiadne inventúry.</p>' };
    }

    let listHtml = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Dátum</th>
              <th>Pracovník</th>
              <th>Počet položiek</th>
              <th>Akcia</th>
            </tr>
          </thead>
          <tbody>
    `;

    logs.forEach(log => {
      const dateStr = new Date(log.created_at).toLocaleString('sk-SK');
      listHtml += `
        <tr>
          <td>${dateStr}</td>
          <td>${escapeHtml(log.worker_name)}</td>
          <td>${log.item_count}</td>
          <td>
            <button class="btn-primary btn-sm view-inv-detail" data-id="${log.id}">
              <i class="fas fa-eye"></i> Detail
            </button>
          </td>
        </tr>
      `;
    });

    listHtml += `</tbody></table></div><div id="inventory-detail-view" style="margin-top:20px; border-top:1px solid #ddd; padding-top:20px; display:none;"></div>`;

    const onReady = () => {
      document.querySelectorAll('.view-inv-detail').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          await loadInventoryDetail(id);
        };
      });
    };

    return { html: listHtml, onReady };
  }

  async function loadInventoryDetail(id) {
    const container = document.getElementById('inventory-detail-view');
    container.style.display = 'block';
    container.innerHTML = '<p>Načítavam detail...</p>';

    try {
      const data = await apiRequest(`/api/kancelaria/getInventoryDetail?id=${id}`);
      if (data.error) {
        container.innerHTML = `<div class="error">${data.error}</div>`;
        return;
      }

      const { log, items } = data;
      const dateStr = new Date(log.created_at).toLocaleString('sk-SK');

      let totalDiffValue = 0;
      let rowsHtml = '';

      items.forEach(item => {
        const diffQty = parseFloat(item.diff_qty);
        const diffVal = parseFloat(item.diff_value);
        totalDiffValue += diffVal;

        const rowClass = diffVal < 0 ? 'loss' : (diffVal > 0 ? 'gain' : ''); // gain treba definovať v CSS, loss už je
        
        rowsHtml += `
          <tr>
            <td>${escapeHtml(item.product_name)}</td>
            <td>${safeToFixed(item.system_qty, 2)}</td>
            <td><strong>${safeToFixed(item.real_qty, 2)}</strong></td>
            <td style="color:${diffQty < 0 ? 'red' : (diffQty > 0 ? 'green' : 'inherit')}">
              ${diffQty > 0 ? '+' : ''}${safeToFixed(diffQty, 2)}
            </td>
            <td>${safeToFixed(item.unit_price, 2)} €</td>
            <td style="font-weight:bold; color:${diffVal < 0 ? 'red' : (diffVal > 0 ? 'green' : 'inherit')}">
              ${diffVal > 0 ? '+' : ''}${safeToFixed(diffVal, 2)} €
            </td>
          </tr>
        `;
      });

      const totalColor = totalDiffValue < 0 ? 'red' : (totalDiffValue > 0 ? 'green' : 'black');

      const html = `
        <div style="background:#f9fafb; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #e5e7eb;">
          <h4 style="margin-top:0;">Detail inventúry zo dňa: ${dateStr}</h4>
          <p><strong>Vykonal:</strong> ${escapeHtml(log.worker_name)}</p>
          <p><strong>Celková finančná bilancia (Manko/Prebytok):</strong> 
             <span style="font-size:1.2em; font-weight:bold; color:${totalColor}">
               ${safeToFixed(totalDiffValue, 2)} €
             </span>
          </p>
          <div class="btn-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top:10px;">
             <button id="inv-export-csv" class="btn-secondary"><i class="fas fa-file-csv"></i> Stiahnuť CSV</button>
             <button id="inv-print-pdf" class="btn-warning"><i class="fas fa-print"></i> Tlačiť (PDF)</button>
          </div>
        </div>

        <div class="table-container">
          <table id="inventory-detail-table">
            <thead>
              <tr>
                <th>Produkt</th>
                <th>Systém (kg)</th>
                <th>Realita (kg)</th>
                <th>Rozdiel (kg)</th>
                <th>Cena/kg</th>
                <th>Hodnota rozdielu</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;

      container.innerHTML = html;

      // Handlers pre tlač a export
      document.getElementById('inv-export-csv').onclick = () => exportInventoryToCSV(log, items);
      document.getElementById('inv-print-pdf').onclick = () => printInventory(log, items, totalDiffValue);

      container.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
      container.innerHTML = `<div class="error">Chyba: ${e.message}</div>`;
    }
  }

  // Funkcia pre export do CSV
  function exportInventoryToCSV(log, items) {
    const headers = ['Produkt', 'Systemove mnozstvo', 'Realne mnozstvo', 'Rozdiel', 'Cena za MJ', 'Hodnota rozdielu'];
    const rows = items.map(item => [
      item.product_name,
      safeToFixed(item.system_qty, 3).replace('.', ','),
      safeToFixed(item.real_qty, 3).replace('.', ','),
      safeToFixed(item.diff_qty, 3).replace('.', ','),
      safeToFixed(item.unit_price, 2).replace('.', ','),
      safeToFixed(item.diff_value, 2).replace('.', ',')
    ]);

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // BOM pre Excel
    csvContent += `Inventura: ${new Date(log.created_at).toLocaleString('sk-SK')} - ${log.worker_name}\n`;
    csvContent += headers.join(';') + "\n";
    rows.forEach(row => {
      csvContent += row.join(';') + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `inventura_${log.created_at.split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Funkcia pre tlač (PDF)
  function printInventory(log, items, totalVal) {
    // Otvoríme nové okno pre čistú tlač
    const printWindow = window.open('', '_blank');
    const dateStr = new Date(log.created_at).toLocaleString('sk-SK');
    
    let rows = '';
    items.forEach(item => {
        const diffQty = parseFloat(item.diff_qty);
        const diffVal = parseFloat(item.diff_value);
        rows += `
            <tr>
                <td>${escapeHtml(item.product_name)}</td>
                <td style="text-align:right">${safeToFixed(item.system_qty, 2)}</td>
                <td style="text-align:right"><strong>${safeToFixed(item.real_qty, 2)}</strong></td>
                <td style="text-align:right; color:${diffQty < 0 ? 'red' : 'inherit'}">${safeToFixed(diffQty, 2)}</td>
                <td style="text-align:right">${safeToFixed(item.unit_price, 2)}</td>
                <td style="text-align:right; font-weight:bold; color:${diffVal < 0 ? 'red' : 'inherit'}">${safeToFixed(diffVal, 2)}</td>
            </tr>
        `;
    });

    printWindow.document.write(`
      <html>
        <head>
          <title>Inventúra ${dateStr}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
            h1 { margin-bottom: 5px; }
            .header-info { margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            th { background-color: #f0f0f0; }
            .total { text-align: right; margin-top: 20px; font-size: 16px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header-info">
            <h1>Report Inventúry</h1>
            <p><strong>Dátum:</strong> ${dateStr} <br> <strong>Vykonal:</strong> ${escapeHtml(log.worker_name)}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Produkt</th>
                <th style="text-align:right">Systém (kg)</th>
                <th style="text-align:right">Realita (kg)</th>
                <th style="text-align:right">Rozdiel (kg)</th>
                <th style="text-align:right">Cena (€)</th>
                <th style="text-align:right">Hodnota rozdielu (€)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <div class="total">
            Celková bilancia: ${safeToFixed(totalVal, 2)} €
          </div>
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }
})();


  // ---------- PLÁNOVAČ (starý – modálny) ----------
  // (stále ho nechávame, ale hlavné plánovanie robíš v kalendári)
  async function createProductionPlanContent() {
    const planDataGrouped = await apiRequest('/api/kancelaria/getProductionPlan');
    let html;

    if (!planDataGrouped || Object.keys(planDataGrouped).length === 0) {
      html = '<p>Nie je potrebné nič vyrábať na základe minimálnych zásob a objednávok.</p>';
    } else {
      const days = ['Nenaplánované', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok'];
      const dayOptions = days.map(d => `<option value="${d}">${d}</option>`).join('');

      let tableBodyHtml = '';
      for (const [category, items] of Object.entries(planDataGrouped)) {
        tableBodyHtml += `
          <tbody class="production-group-tbody">
            <tr class="category-header-row" style="background-color:#f3f4f6;font-weight:bold;">
              <td colspan="7">${escapeHtml(category)}</td>
            </tr>
        `;
        items.forEach(item => {
          tableBodyHtml += `
            <tr data-product-name="${escapeHtml(item.nazov_vyrobku)}">
              <td>${escapeHtml(item.nazov_vyrobku)}</td>
              <td style="text-align:right;">${safeToFixed(item.celkova_potreba)} kg</td>
              <td style="text-align:right;">${safeToFixed(item.aktualny_sklad)} kg</td>
              <td>
                <input type="number" class="planned-qty-input"
                  value="${item.navrhovana_vyroba}" step="10"
                  style="width:80px;text-align:right;padding:4px;">
              </td>
              <td><select class="day-select" style="padding:4px;">${dayOptions}</select></td>
              <td style="text-align:center;"><input type="checkbox" class="priority-checkbox" style="width:20px;height:20px;"></td>
              <td style="text-align:center;"><button class="btn-danger" style="padding:2px 8px;margin:0;" onclick="this.closest('tr').remove()">×</button></td>
            </tr>
          `;
        });
        tableBodyHtml += '</tbody>';
      }

      html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <p>Naplánujte výrobu priradením dňa a priority ku každej položke.</p>
          <button id="planner-inline-open-btn" class="btn-secondary">
            <i class="fas fa-external-link-alt"></i> Otvoriť full-screen plánovač
          </button>
        </div>
        <div class="table-container" style="max-height:60vh;overflow:auto;">
          <table>
            <thead style="position:sticky;top:0;">
              <tr>
                <th>Produkt</th>
                <th>Potreba (Sklad+Obj.)</th>
                <th>Sklad</th>
                <th>Plánovaná výroba (kg)</th>
                <th>Deň výroby</th>
                <th>Priorita</th>
                <th>Akcia</th>
              </tr>
            </thead>
            ${tableBodyHtml}
          </table>
        </div>
        <button id="create-tasks-from-plan-btn" class="btn-success" style="width:100%;margin-top:1rem;">
          <i class="fas fa-tasks"></i> Vytvoriť výrobné úlohy z plánu
        </button>
      `;
    }

    const onReady = () => {
      const btn = document.getElementById('create-tasks-from-plan-btn');
      if (btn) btn.onclick = createTasksFromPlan;

      const inlineBtn = document.getElementById('planner-inline-open-btn');
      if (inlineBtn) {
        inlineBtn.onclick = () => {
          const root = document.getElementById('planner-inline-root');
          if (root) {
            root.style.display = 'block';
            renderProductionPlanInline();
            root.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        };
      }
    };
    return { html, onReady };
  }

  // ---------- NÁVRH NÁKUPU (funkcia ostáva, ale UI tlačidlo sme zrušili) ----------
  async function createPurchaseSuggestionsContent() {
    const suggestionsData = await apiRequest('/api/kancelaria/getPurchaseSuggestions');
    let html;
    if (!suggestionsData || suggestionsData.length === 0) {
      html = '<p>Nie je potrebné nič dokúpiť na základe plánu a minimálnych zásob.</p>';
    } else {
      let tableHtml = `
        <table>
          <thead>
            <tr>
              <th>Surovina</th>
              <th>Sklad (kg)</th>
              <th>Potrebné pre výrobu (kg)</th>
              <th>Min. zásoba (kg)</th>
              <th class="gain">Odporúčaný nákup (kg)</th>
            </tr>
          </thead>
          <tbody>
      `;
      suggestionsData.forEach(s => {
        tableHtml += `
          <tr>
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>${safeToFixed(s.currentStock)}</td>
            <td>${safeToFixed(s.requiredForProduction)}</td>
            <td>${safeToFixed(s.minStock)}</td>
            <td class="gain">${safeToFixed(s.purchaseQty)}</td>
          </tr>
        `;
      });
      tableHtml += '</tbody></table>';
      html = `<div class="table-container">${tableHtml}</div>`;
    }
    return { html };
  }

  // ---------- PREHĽAD VÝROBY ----------
  async function createProductionStatsContent() {
    await ensureOfficeDataIsLoaded();
    const categories = ['Všetky', ...(officeInitialData.recipeCategories || [])];
    const categoryOptions = categories
      .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('');

    const html = `
      <div class="form-grid" style="margin-bottom:1rem;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;">
        <div>
          <label>Obdobie</label>
          <div style="display:flex;gap:.5rem;">
            <button id="prod-stats-week" class="btn-secondary">Týždeň</button>
            <button id="prod-stats-month" class="btn-secondary">Mesiac</button>
          </div>
        </div>
        <div>
          <label>Kategória receptu</label>
          <select id="prod-stats-category">
            ${categoryOptions}
          </select>
        </div>
      </div>
      <div id="production-stats-table-container"></div>
      <div id="production-damage-table-container" style="margin-top:2rem;"></div>
    `;

    const onReady = () => {
      const weekBtn = document.getElementById('prod-stats-week');
      const monthBtn = document.getElementById('prod-stats-month');
      const categoryEl = document.getElementById('prod-stats-category');

      let currentPeriod = 'week';

      const loadStats = async () => {
        const category = categoryEl.value === 'Všetky' ? '' : categoryEl.value;
        const result = await apiRequest('/api/kancelaria/getProductionStats', {
          method: 'POST',
          body: { period: currentPeriod, category }
        });

        const container = document.getElementById('production-stats-table-container');
        if (!result || !result.data || result.data.length === 0) {
          container.innerHTML = '<p>Žiadne dáta pre zvolené filtre.</p>';
        } else {
          let tableHtml = `
            <table>
              <thead>
                <tr>
                  <th>Dátum</th>
                  <th>Produkt</th>
                  <th>Plán (kg)</th>
                  <th>Realita (kg)</th>
                  <th>Výťažnosť (%)</th>
                  <th>Cena/jed. bez energií</th>
                  <th>Cena/jed. s energiami</th>
                </tr>
              </thead>
              <tbody>
          `;
          result.data.forEach(d => {
            tableHtml += `
              <tr>
                <td>${new Date(d.datum_ukoncenia).toLocaleDateString('sk-SK')}</td>
                <td>${escapeHtml(d.nazov_vyrobku)}</td>
                <td>${safeToFixed(d.planovane_mnozstvo_kg)} kg</td>
                <td>${safeToFixed(d.realne_mnozstvo_kg)} kg</td>
                <td>${safeToFixed(d.vytaznost, 2)}%</td>
                <td>${safeToFixed(d.cena_bez_energii)} €/${d.unit}</td>
                <td>${safeToFixed(d.cena_s_energiami)} €/${d.unit}</td>
              </tr>
            `;
          });
          tableHtml += '</tbody></table>';
          container.innerHTML = `<div class="table-container">${tableHtml}</div>`;
        }

        const damageContainer = document.getElementById('production-damage-table-container');
        if (result.damage_data && result.damage_data.length > 0) {
          let damageHtml = `
            <h4>Škody</h4>
            <table>
              <thead>
                <tr>
                  <th>Dátum</th>
                  <th>Produkt</th>
                  <th>Množstvo</th>
                  <th>Pracovník</th>
                  <th>Dôvod</th>
                  <th>Náklady</th>
                </tr>
              </thead>
              <tbody>
          `;
          result.damage_data.forEach(d => {
            damageHtml += `
              <tr>
                <td>${new Date(d.datum).toLocaleDateString('sk-SK')}</td>
                <td>${escapeHtml(d.nazov_vyrobku)}</td>
                <td>${escapeHtml(d.mnozstvo)}</td>
                <td>${escapeHtml(d.pracovnik)}</td>
                <td>${escapeHtml(d.dovod)}</td>
                <td class="loss">${d.naklady_skody ? safeToFixed(d.naklady_skody) + ' €' : 'N/A'}</td>
              </tr>
            `;
          });
          damageHtml += '</tbody></table>';
          damageContainer.innerHTML = `<div class="table-container">${damageHtml}</div>`;
        } else {
          damageContainer.innerHTML = '<h4>Škody</h4><p>Nenašli sa žiadne záznamy o škodách.</p>';
        }
      };

      weekBtn.onclick  = () => { currentPeriod = 'week';  loadStats(); };
      monthBtn.onclick = () => { currentPeriod = 'month'; loadStats(); };
      categoryEl.onchange = () => loadStats();
      loadStats();
    };
    return { html, onReady };
  }

  // ---------- PRÍJEM Z VÝROBY (REPORT) ----------
  async function createReceptionReportContent() {
    const to = new Date();
    const from = new Date(to); from.setDate(from.getDate() - 6);
    const html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;align-items:end">
        <div>
          <label>Od (dátum PRÍJMU):</label>
          <input type="date" id="rr-date-from" value="${from.toISOString().slice(0,10)}">
        </div>
        <div>
          <label>Do (dátum PRÍJMU):</label>
          <input type="date" id="rr-date-to" value="${to.toISOString().slice(0,10)}">
        </div>
        <div>
          <label>Koeficient réžií:</label>
          <input type="number" id="rr-overhead" step="0.01" value="1.15">
        </div>
        <div>
          <button class="btn-primary" id="rr-load-btn">
            <i class="fas fa-download"></i> Načítať
          </button>
        </div>
      </div>
      <div id="rr-table" class="table-container" style="margin-top:1rem"></div>
    `;
    const onReady = () => {
      document.getElementById('rr-load-btn').onclick = loadReceptionReport;
    };
    return { html, onReady };
  }

  async function loadReceptionReport() {
    const date_from = document.getElementById('rr-date-from').value;
    const date_to   = document.getElementById('rr-date-to').value;
    const overhead  = parseFloat(document.getElementById('rr-overhead').value || '1.15');
    if (!date_from || !date_to) { showStatus('Zadajte od-do.', true); return; }

    const res = await apiRequest('/api/kancelaria/receptionReport', {
      method: 'POST',
      body: { date_from, date_to, overhead }
    });

    const table = document.getElementById('rr-table');
    if (!res || !res.rows || res.rows.length === 0) {
      table.innerHTML = '<div style="padding:1rem">V období nebol žiadny príjem.</div>'; return;
    }
    let html = `
      <table>
        <thead>
          <tr>
            <th>Produkt</th>
            <th>MJ</th>
            <th>Plán (kg)</th>
            <th>Realita (kg)</th>
            <th>Výťažnosť (%)</th>
            <th>Cena/jed. bez réžií</th>
            <th>Cena/jed. s réžiami</th>
          </tr>
        </thead>
        <tbody>
    `;
    res.rows.forEach(row => {
      html += `
        <tr>
          <td>${escapeHtml(row.product)}</td>
          <td>${escapeHtml(row.unit)}</td>
          <td>${safeToFixed(row.planned_kg)}</td>
          <td>${safeToFixed(row.real_kg)}</td>
          <td>${row.yield_pct != null ? safeToFixed(row.yield_pct, 2) : '—'}</td>
          <td>${safeToFixed(row.unit_cost_no_overhead)} €/${row.unit}</td>
          <td>${safeToFixed(row.unit_cost_with_overhead)} €/${row.unit}</td>
        </tr>
      `;
    });
    html += `
        </tbody>
      </table>
    `;
    table.innerHTML = html;
  }

  // ---------- Dummy TLAČ REPORTOV (aby to nepadalo) ----------
     function createPrintReportsContent() {
    const html = `
      <div class="stat-card">
        <h3>Tlač reportov</h3>
        <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .75rem; align-items: flex-end;">
          <div class="form-group">
            <label>Typ reportu</label>
            <select id="pr-type">
              <option value="production">Prehľad výroby</option>
              <option value="reception">Príjem z výroby</option>
            </select>
          </div>
          <div class="form-group">
            <label>Od dátum</label>
            <input type="date" id="pr-date-from">
          </div>
          <div class="form-group">
            <label>Do dátum</label>
            <input type="date" id="pr-date-to">
          </div>
          <div class="form-group" id="pr-overhead-wrap">
            <label>Koeficient réžií (len pre príjem)</label>
            <input type="number" id="pr-overhead" step="0.01" value="1.15">
          </div>
          <div class="form-group" style="text-align:right;">
            <button id="pr-open-report" class="btn-primary">
              <i class="fas fa-print"></i> Otvoriť report
            </button>
          </div>
        </div>
        <p class="muted" style="margin-top:.5rem;">
          Report sa otvorí v novej karte ako HTML stránka, ktorú môžete vytlačiť (Ctrl+P).
        </p>
      </div>
    `;

    const onReady = () => {
      const typeSel = document.getElementById('pr-type');
      const fromEl  = document.getElementById('pr-date-from');
      const toEl    = document.getElementById('pr-date-to');
      const ohEl    = document.getElementById('pr-overhead');
      const ohWrap  = document.getElementById('pr-overhead-wrap');
      const btnOpen = document.getElementById('pr-open-report');

      // predvyplníme dnešok
      const today = new Date();
      const isoToday = today.toISOString().slice(0,10);
      if (fromEl && !fromEl.value) fromEl.value = isoToday;
      if (toEl   && !toEl.value)   toEl.value   = isoToday;

      function updateOverheadVisible(){
        if (!ohWrap) return;
        const t = typeSel.value;
        ohWrap.style.display = (t === 'reception') ? 'block' : 'none';
      }
      typeSel.addEventListener('change', updateAréa => updateOverheadVisible());
      updateOverheadVisible();

      btnOpen.addEventListener('click', () => {
        const t  = typeSel.value;
        const df = (fromEl.value || '').trim();
        const dt = (toEl.value   || '').trim();
        const oh = (ohEl.value   || '1.15').trim();

        if (!df || !dt) {
          showStatus('Vyplňte prosím dátumy „od“ a „do“.', true);
          return;
        }

        let url;
        if (t === 'production') {
          url = `/kancelaria/report/production?date_from=${encodeURIComponent(df)}&date_to=${encodeURIComponent(dt)}`;
        } else {
          url = `/kancelaria/report/reception?date_from=${encodeURIComponent(df)}&date_to=${encodeURIComponent(dt)}&overhead=${encodeURIComponent(oh)}`;
        }

        window.open(url, '_blank');
      });
    };

    return { html, onReady };
  }


  // ---------- ŠTÝLY PRE INLINE PLÁNOVAČ (kalendár) ----------
  function ensurePlannerStyles() {
    if (document.getElementById('planner-styles')) return;
    const css = `
      .planner-toolbar {
        display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; flex-wrap:wrap;
      }
      .planner-toolbar .spacer { flex:1; }

      .planner-layout {
        display:grid;
        grid-template-columns: minmax(0, 2.1fr) minmax(0, 1.4fr);
        gap:1rem;
        align-items:flex-start;
      }
      @media (max-width: 1024px) {
        .planner-layout {
          grid-template-columns: minmax(0,1fr);
        }
      }

      .planner-card {
        border:1px solid #e5e7eb;
        border-radius:8px;
        padding:12px;
        background:#fff;
        box-shadow:0 1px 2px rgba(0,0,0,0.04);
      }

      .planner-summary-bar {
        display:flex;
        flex-wrap:wrap;
        gap:.5rem;
        align-items:center;
        margin-top:.75rem;
        font-size:.9rem;
      }

      .chip {
        display:inline-flex;
        align-items:center;
        gap:.35rem;
        padding:.2rem .5rem;
        background:#f1f5f9;
        border-radius:999px;
        font-size:.8rem;
        color:#0f172a;
      }

      /* KALENDÁR */
      .planner-calendar {
        display:flex;
        flex-direction:column;
        gap:.5rem;
      }
      .planner-cal-header {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:.5rem;
      }
      .planner-cal-month-label {
        font-weight:600;
        font-size:1rem;
      }
      .planner-cal-nav-btn {
        border:1px solid #e5e7eb;
        background:#f8fafc;
        border-radius:6px;
        padding:2px 8px;
        cursor:pointer;
      }
      .planner-cal-nav-btn:hover {
        background:#e5e7eb;
      }

      .planner-cal-weekdays,
      .planner-cal-grid {
        display:grid;
        grid-template-columns:repeat(7, minmax(0, 1fr));
        gap:2px;
      }
      .planner-cal-weekday {
        text-align:center;
        font-size:.8rem;
        font-weight:600;
        padding:4px 0;
        color:#64748b;
      }

      .planner-cal-cell {
        min-height:72px;
        background:#f8fafc;
        border-radius:6px;
        padding:4px;
        font-size:.75rem;
        position:relative;
        cursor:pointer;
        display:flex;
        flex-direction:column;
        gap:2px;
      }
      .planner-cal-cell.empty {
        background:transparent;
        cursor:default;
      }
      .planner-cal-cell:hover:not(.empty) {
        outline:1px solid #38bdf8;
        background:#e0f2fe;
      }
      .planner-cal-cell.selected {
        outline:2px solid #0ea5e9;
        background:#e0f2fe;
      }

      .planner-cal-date {
        font-weight:600;
        font-size:.8rem;
        color:#0f172a;
      }
      .planner-cal-summary {
        margin-top:2px;
        line-height:1.2;
        color:#0f172a;
      }
      .planner-cal-summary div {
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .planner-cal-prio {
        position:absolute;
        top:4px;
        right:4px;
        font-size:.8rem;
        color:#ea580c;
      }

      /* Pravý panel – detail dňa */
      .planner-side {
        display:flex;
        flex-direction:column;
        gap:.5rem;
      }
      .planner-side h4 {
        margin:0 0 .25rem 0;
        font-size:1rem;
      }
      .planner-side small {
        color:#64748b;
      }

      .planner-field-row {
        display:flex;
        flex-wrap:wrap;
        gap:.5rem;
        align-items:center;
      }
      .planner-field-row select,
      .planner-field-row input[type="number"],
      .planner-field-row input[type="date"] {
        padding:4px 6px;
        border-radius:6px;
        border:1px solid #e5e7eb;
        font-size:.9rem;
      }

      .planner-day-list {
        list-style:none;
        padding:0;
        margin:.5rem 0 0 0;
        max-height:260px;
        overflow:auto;
      }
      .planner-day-list li {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:.5rem;
        padding:4px 0;
        border-bottom:1px dashed #e5e7eb;
        font-size:.85rem;
      }
      .planner-day-main {
        display:flex;
        flex-direction:column;
        gap:2px;
      }
      .planner-day-prio {
        color:#ea580c;
        font-weight:600;
        margin-left:4px;
      }
      .planner-day-remove {
        border:none;
        background:#fee2e2;
        color:#b91c1c;
        border-radius:999px;
        padding:2px 8px;
        font-size:.75rem;
        cursor:pointer;
      }
      .planner-day-remove:hover {
        background:#fecaca;
      }

      .planner-footer-actions {
        margin-top:.75rem;
        display:flex;
        flex-wrap:wrap;
        gap:.5rem;
        align-items:center;
      }

      .btn-primary-small {
        padding:6px 10px;
        border-radius:6px;
        border:none;
        background:#0f766e;
        color:#fff;
        font-size:.85rem;
        cursor:pointer;
      }
      .btn-primary-small:hover {
        background:#0d9488;
      }
    `;
    const s = document.createElement('style');
    s.id = 'planner-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Globálny stav pre kalendárny plánovač
  let PLANNER_CAL_STATE = null;

  // ---------- INLINE PLÁNOVAČ VÝROBY – KALENDÁR ----------
  async function renderProductionPlanInline() {
    ensurePlannerStyles();
    const root = document.getElementById('planner-inline-root');
    if (!root) return;

    root.innerHTML = `
      <div class="planner-toolbar">
        <h3 style="margin:0">Kalendár výroby</h3>
        <div class="spacer"></div>
        <button id="planner-refresh" class="btn-secondary" style="margin:0">
          <i class="fas fa-sync-alt"></i> Obnoviť návrhy
        </button>
      </div>

      <div class="planner-layout">
        <!-- Ľavá strana: kalendár -->
        <div class="planner-card">
          <div class="planner-calendar" id="planner-calendar"></div>
        </div>

        <!-- Pravá strana: detail vybraného dňa -->
        <div class="planner-card planner-side">
          <div>
            <h4>Plán na deň: <span id="planner-selected-date-label"></span></h4>
            <small>Vyber deň v kalendári a pridaj výrobky, ktoré sa v ten deň majú vyrábať.</small>
          </div>

          <div class="planner-field-row">
            <label for="planner-product-select">Výrobok:</label>
            <select id="planner-product-select" style="min-width:220px;">
              <option value="">-- vyber výrobok --</option>
            </select>
          </div>

          <div class="planner-field-row">
            <label for="planner-qty-input">Množstvo (kg):</label>
            <input id="planner-qty-input" type="number" min="0" step="1" style="width:90px;text-align:right">
            <label style="display:flex;align-items:center;gap:4px;">
              <input type="checkbox" id="planner-priority-input">
              Priorita
            </label>
            <button id="planner-add-to-day" class="btn-primary-small">
              Pridať do dňa
            </button>
          </div>

          <ul id="planner-day-list" class="planner-day-list"></ul>
        </div>
      </div>

      <div class="planner-footer-actions">
        <button id="planner-create-tasks" class="btn-primary">
          <i class="fas fa-play"></i> Vytvoriť výrobné úlohy z kalendára
        </button>
        <div id="planner-summary" class="planner-summary-bar"></div>
      </div>
    `;

    const elCalendar = root.querySelector('#planner-calendar');
    const elProdSel = root.querySelector('#planner-product-select');
    const elQty     = root.querySelector('#planner-qty-input');
    const elPrio    = root.querySelector('#planner-priority-input');
    const elAdd     = root.querySelector('#planner-add-to-day');
    const elDayList = root.querySelector('#planner-day-list');
    const elSelDate = root.querySelector('#planner-selected-date-label');
    const elCreate  = root.querySelector('#planner-create-tasks');
    const elRefresh = root.querySelector('#planner-refresh');
    const elSummary = root.querySelector('#planner-summary');

    const monthNames = ['január','február','marec','apríl','máj','jún','júl','august','september','október','november','december'];
    const weekdays   = ['Po','Ut','St','Št','Pi','So','Ne'];

    const safeToFixedLocal = (v) => (v == null || isNaN(v)) ? '0' : Number(v).toFixed(3);
    const formatDateKey = (y, m, d) => {
      const mm = String(m + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    };

    // --------- Stav kalendára ----------
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const STATE = {
      currentMonth: new Date(today.getFullYear(), today.getMonth(), 1),
      selectedDate: formatDateKey(today.getFullYear(), today.getMonth(), today.getDate()),
      calendar: {}   // { "YYYY-MM-DD": [ { productName, qty, priority } ] }
    };

    PLANNER_CAL_STATE = STATE;
    let calendarLoadedFromDb = false;
    let PRODUCTS = [];

    // --------- Načítanie dát z backendu (návrhy + plán z DB len prvýkrát) ----------
    async function loadData() {
      // 1) návrhy výroby (min. zásoby + objednávky)
      const suggestionsPromise = apiRequest('/api/kancelaria/getProductionPlan');

      // 2) plán z DB – len prvý krát, potom necháme kalendár tak, ako si ho upravil používateľ
      const calendarPromise = calendarLoadedFromDb
        ? Promise.resolve(null)
        : apiRequest('/api/kancelaria/getProductionCalendar').catch(() => null);

      const [res, cal] = await Promise.all([suggestionsPromise, calendarPromise]);

      // --- návrhy -> select výrobkov ---
      PRODUCTS = [];
      if (res && typeof res === 'object') {
        Object.keys(res).forEach((cat) => {
          const items = res[cat] || [];
          items.forEach((it) => {
            PRODUCTS.push({
              category: cat,
              nazov_vyrobku: it.nazov_vyrobku,
              navrhovana_vyroba: Number(it.navrhovana_vyroba || 0),
              aktualny_sklad: Number(it.aktualny_sklad || 0),
              celkova_potreba: Number(it.celkova_potreba || 0)
            });
          });
        });
      }

      elProdSel.innerHTML = '<option value="">-- vyber výrobok --</option>' +
        PRODUCTS.map(p => {
          const label = `${p.category} – ${p.nazov_vyrobku} (navrh: ${safeToFixedLocal(p.navrhovana_vyroba)} kg, sklad: ${safeToFixedLocal(p.aktualny_sklad)} kg)`;
          return `<option value="${p.nazov_vyrobku}" data-default-qty="${p.navrhovana_vyroba}">${label}</option>`;
        }).join('');

      // --- plán z DB -> kalendár (iba keď ešte nebol načítaný) ---
      if (!calendarLoadedFromDb && cal && typeof cal === 'object') {
        STATE.calendar = {};
        Object.entries(cal).forEach(([dateKey, items]) => {
          const arr = [];
          (items || []).forEach((it) => {
            const qty = Number(it.mnozstvo_kg || it.qty || 0);
            if (!qty) return;
            arr.push({
              productName: it.nazov_vyrobku || it.productName,
              qty: qty,
              priority: !!(it.priorita)
            });
          });
          if (arr.length) {
            STATE.calendar[dateKey] = arr;
          }
        });
        calendarLoadedFromDb = true;
      }

      rebuildSummary();
    }

    // --------- Render kalendára ----------
    function renderCalendar() {
      const firstDay = new Date(STATE.currentMonth.getFullYear(), STATE.currentMonth.getMonth(), 1);
      const year = firstDay.getFullYear();
      const month = firstDay.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      // pondelok ako prvý deň: (0=Ne..6=So) -> 0=Po
      const jsFirstDay = firstDay.getDay(); // 0=Ne..6=So
      const startIndex = (jsFirstDay + 6) % 7;

      let html = `
        <div class="planner-cal-header">
          <button type="button" id="planner-cal-prev" class="planner-cal-nav-btn">‹</button>
          <div class="planner-cal-month-label" id="planner-cal-month-label">${monthNames[month]} ${year}</div>
          <button type="button" id="planner-cal-next" class="planner-cal-nav-btn">›</button>
        </div>
        <div class="planner-cal-weekdays">
          ${weekdays.map(d => `<div class="planner-cal-weekday">${d}</div>`).join('')}
        </div>
        <div class="planner-cal-grid">
      `;

      // prázdne bunky pred prvým dňom
      for (let i = 0; i < startIndex; i++) {
        html += `<div class="planner-cal-cell empty"></div>`;
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = formatDateKey(year, month, day);
        const dayItems = STATE.calendar[dateKey] || [];
        const totalQty = dayItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
        const hasPrio = dayItems.some(it => it.priority);

        html += `<div class="planner-cal-cell${STATE.selectedDate === dateKey ? ' selected' : ''}" data-date="${dateKey}">
          <div class="planner-cal-date">${day}</div>`;

        if (dayItems.length) {
          html += `<div class="planner-cal-summary">
            <div>${dayItems.length} položiek</div>
            <div>${safeToFixedLocal(totalQty)} kg</div>
          </div>`;
        }

        if (hasPrio) {
          html += `<div class="planner-cal-prio">★</div>`;
        }

        html += `</div>`;
      }

      html += `</div>`; // .planner-cal-grid
      elCalendar.innerHTML = html;

      const prevBtn = elCalendar.querySelector('#planner-cal-prev');
      const nextBtn = elCalendar.querySelector('#planner-cal-next');

      prevBtn.onclick = () => {
        const d = new Date(STATE.currentMonth);
        d.setMonth(d.getMonth() - 1);
        d.setDate(1);
        STATE.currentMonth = d;
        renderCalendar();
      };
      nextBtn.onclick = () => {
        const d = new Date(STATE.currentMonth);
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        STATE.currentMonth = d;
        renderCalendar();
      };

      elCalendar.querySelectorAll('.planner-cal-cell[data-date]').forEach(cell => {
        const dateKey = cell.dataset.date;
        cell.onclick = () => {
          STATE.selectedDate = dateKey;
          renderCalendar();
          renderSelectedDay();
        };
      });
    }

    // --------- Render zoznamu pre vybraný deň ----------
    function renderSelectedDay() {
      const dateKey = STATE.selectedDate;
      elSelDate.textContent = dateKey || '---';

      const items = STATE.calendar[dateKey] || [];
      if (!items.length) {
        elDayList.innerHTML = '<li><span style="color:#64748b;">Na tento deň zatiaľ nič naplánované.</span></li>';
        return;
      }

      let html = '';
      items.forEach((it, idx) => {
        html += `
          <li data-index="${idx}">
            <div class="planner-day-main">
              <div><strong>${escapeHtml(it.productName)}</strong>${it.priority ? '<span class="planner-day-prio">★</span>' : ''}</div>
              <div>${safeToFixedLocal(it.qty)} kg</div>
            </div>
            <button type="button" class="planner-day-remove">Odstrániť</button>
          </li>
        `;
      });
      elDayList.innerHTML = html;

      elDayList.querySelectorAll('.planner-day-remove').forEach((btn) => {
        btn.onclick = async () => {
          const li = btn.closest('li');
          const idx = Number(li.dataset.index);
          const arr = STATE.calendar[dateKey] || [];
          arr.splice(idx, 1);
          if (!arr.length) delete STATE.calendar[dateKey];
          renderCalendar();
          renderSelectedDay();
          rebuildSummary();

          // Auto-save po odstránení položky
          try {
            await createTasksFromPlan();
            showStatus('Plán uložený po odstránení položky.', false);
          } catch (e) {
            showStatus('Nepodarilo sa uložiť plán po odstránení položky: ' + e.message, true);
          }
        };
      });
    }

    // --------- Súhrn dole (celý mesiac / plán) ----------
    function rebuildSummary() {
      let totalDays = 0;
      let totalItems = 0;
      let totalKg = 0;

      Object.keys(STATE.calendar).forEach(dateKey => {
        const dayItems = STATE.calendar[dateKey] || [];
        if (!dayItems.length) return;
        totalDays += 1;
        totalItems += dayItems.length;
        totalKg += dayItems.reduce((s, it) => s + (Number(it.qty) || 0), 0);
      });

      elSummary.innerHTML = `
        <span class="chip"><b>${totalDays}</b> dní s plánom</span>
        <span class="chip"><b>${totalItems}</b> položiek</span>
        <span class="chip"><b>${safeToFixedLocal(totalKg)}</b> kg spolu</span>
      `;
    }

    // --------- Pridanie položky do vybraného dňa ----------
    elAdd.onclick = async () => {
      if (!STATE.selectedDate) {
        showStatus('Najprv vyber deň v kalendári.', true);
        return;
      }

      const productName = elProdSel.value;
      if (!productName) {
        showStatus('Vyber výrobok.', true);
        return;
      }

      let qty = parseFloat(elQty.value || '0');
      if (!qty || isNaN(qty)) {
        // ak nezadá množstvo, skúsime navrhovanú výrobu
        const opt = elProdSel.selectedOptions[0];
        const def = opt ? parseFloat(opt.getAttribute('data-default-qty') || '0') : 0;
        qty = def;
      }
      if (!qty || isNaN(qty)) {
        showStatus('Zadaj množstvo v kg alebo použi návrh.', true);
        return;
      }

      const priority = !!elPrio.checked;
      const dateKey = STATE.selectedDate;
      const arr = STATE.calendar[dateKey] || [];

      const existing = arr.find(it => it.productName === productName);
      if (existing) {
        existing.qty = qty;
        existing.priority = priority;
      } else {
        arr.push({ productName, qty, priority });
      }
      STATE.calendar[dateKey] = arr;

      renderCalendar();
      renderSelectedDay();
      rebuildSummary();

      // Auto-save po pridaní položky
      try {
        await createTasksFromPlan();
        showStatus('Plán uložený po pridaní položky.', false);
      } catch (e) {
        showStatus('Nepodarilo sa uložiť plán po pridaní položky: ' + e.message, true);
      }
    };

    // --------- Tlačidlo vytvoriť úlohy ----------
    elCreate.onclick = () => createTasksFromPlan();

    // --------- Obnoviť návrhy (nie plán) ----------
    elRefresh.onclick = () => {
      loadData(); // načíta nové návrhy, ale nechá kalendár tak, ako je
    };

    // inicializácia
    await loadData();
    renderCalendar();
    renderSelectedDay();
    rebuildSummary();
  }

  // ---------- Vytvorenie úloh z kalendára / tabuľky ----------
  async function createTasksFromPlan() {
    const scope = document.getElementById('planner-inline-root') || document.getElementById('modal-container');
    if (!scope) {
      showStatus('Plánovač nie je dostupný.', true);
      return;
    }

    let planData = [];

    // 1) Kalendár – hlavný zdroj pravdy
    if (PLANNER_CAL_STATE && PLANNER_CAL_STATE.calendar) {
      Object.entries(PLANNER_CAL_STATE.calendar).forEach(([dateKey, items]) => {
        (items || []).forEach((it) => {
          const qty = Number(it.qty || 0);
          if (!qty) return;
          planData.push({
            nazov_vyrobku: it.productName,
            navrhovana_vyroba: qty,
            datum_vyroby: dateKey,       // "YYYY-MM-DD"
            priorita: it.priority ? 1 : 0
          });
        });
      });
    }

    // 2) Fallback – modálny plánovač (ak by sa ešte používal)
    if (!planData.length) {
      const rows = scope.querySelectorAll('tbody tr[data-product-name]');

      const dayMap = {
        'Pondelok': 1,
        'Utorok': 2,
        'Streda': 3,
        'Štvrtok': 4,
        'Piatok': 5
      };

      const getNextDayDate = (targetName) => {
        const targetDow = dayMap[targetName];
        if (!targetDow) return null;
        const today = new Date();
        let currentDow = today.getDay(); // 0=Ne..6=So
        if (currentDow === 0) currentDow = 7; // Ne=7
        let diff = targetDow - currentDow;
        if (diff < 0) diff += 7;
        const d = new Date(today);
        d.setDate(today.getDate() + diff);
        return d.toISOString().split('T')[0];
      };

      rows.forEach((row) => {
        const dateInput = row.querySelector('.production-date-input');
        const daySelect = row.querySelector('.day-select');
        const qtyInput  = row.querySelector('.planned-qty-input');
        const prioInput = row.querySelector('.priority-checkbox');

        let datum_vyroby = '';
        if (dateInput && dateInput.value) {
          datum_vyroby = dateInput.value;
        } else if (daySelect && daySelect.value && daySelect.value !== 'Nenaplánované') {
          datum_vyroby = getNextDayDate(daySelect.value) || '';
        }

        const qty = qtyInput ? parseFloat(qtyInput.value || '0') : 0;
        const priorita = prioInput && prioInput.checked ? 1 : 0;

        if (!datum_vyroby || !qty) return;

        planData.push({
          nazov_vyrobku: row.dataset.productName,
          navrhovana_vyroba: qty,
          datum_vyroby,
          priorita
        });
      });
    }

    if (!planData.length) {
      showStatus('V kalendári ani v tabuľke nie je žiadna položka na vytvorenie úloh.', true);
      return;
    }

    try {
      await apiRequest('/api/kancelaria/createTasksFromPlan', {
        method: 'POST',
        body: planData
      });
      // Pri auto-save nechceme zbytočne spamovať, takže tu už zvlášť hlášku netlačíme,
      // iba pri ručnom kliknutí ju uvidíš.
      // showStatus('Výrobné úlohy vytvorené.', false);
    } catch (e) {
      showStatus('Chyba pri vytváraní výrobných úloh: ' + e.message, true);
      throw e;
    }
  }

  // ---------- Export do globálneho scope ----------
  window.initializePlanningModule = initializePlanningModule;
  window.renderProductionPlanInline = renderProductionPlanInline; 
})();
