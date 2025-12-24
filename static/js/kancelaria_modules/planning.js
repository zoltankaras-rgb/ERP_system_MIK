// =================================================================
// === SUB-MODUL KANCELÁRIA: PLÁNOVANIE A REPORTY ===
// (Vyčistené od starého kalendára, ktorý je teraz v calendar_planner.js)
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
          <i class="fas fa-calendar-alt"></i> Plán Výroby (Kalendár)
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

    // 1. Plán výroby - volá funkciu z calendar_planner.js
    document.getElementById('show-plan-btn').onclick = () => {
      const root = document.getElementById('planner-inline-root');
      if (root && typeof window.renderProductionPlanInline === 'function') {
        root.style.display = 'block';
        window.renderProductionPlanInline(); // Voláme nový modul
        root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showStatus('Modul kalendára sa nenačítal (skúste Ctrl+F5).', true);
      }
    };

    document.getElementById('show-reception-report-btn').onclick =
      () => openModal('Príjem z výroby', createReceptionReportContent);

    document.getElementById('show-prod-stats-btn').onclick =
      () => openModal('Prehľad Výroby', createProductionStatsContent);

    document.getElementById('show-print-reports-btn').onclick =
      () => openModal('Tlač Reportov', createPrintReportsContent);

    document.getElementById('show-inventory-history-btn').onclick =
      () => openModal('História Inventúr', createInventoryHistoryContent);
  }

  // =================================================================
  // === HISTÓRIA INVENTÚR ===
  // =================================================================

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
             <button id="inv-export-csv" class="btn-secondary"><i class="fas fa-file-csv"></i> Stiahnuť CSV</button>
             <button id="inv-print-pdf" class="btn-warning"><i class="fas fa-print"></i> Tlačiť / PDF</button>
          </div>
        </div>

        ${groupsHtml}
      `;

      container.innerHTML = html;
      document.getElementById('inv-export-csv').onclick = () => exportInventoryToCSV(log, items);
      document.getElementById('inv-print-pdf').onclick = () => printInventoryGrouped(log, groups, grandTotal);
      container.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
      container.innerHTML = `<div class="error">Chyba: ${e.message}</div>`;
    }
  }

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

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; 
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
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th { background-color: #f0f0f0; font-weight: bold; border-bottom: 1px solid #ccc; padding: 6px; text-align: left;}
            td { border-bottom: 1px solid #eee; padding: 6px; text-align: left; vertical-align: middle; }
            .num { text-align: right; }
            tfoot td { border-top: 2px solid #000; padding-top: 8px; padding-bottom: 8px; background: #fafafa; }
            .total-label { text-align: right; font-weight: bold; text-transform: uppercase; font-size: 11px; color: #666; }
            .total-val { text-align: right; font-weight: bold; font-size: 14px; }
            .grand-total { text-align: right; margin-top: 40px; font-size: 20px; font-weight: bold; border-top: 4px double #000; padding-top: 15px; }
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
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  // ---------- PREHĽAD VÝROBY (Stats) ----------
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

  // ---------- TLAČ REPORTOV ----------
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

      const today = new Date();
      const isoToday = today.toISOString().slice(0,10);
      if (fromEl && !fromEl.value) fromEl.value = isoToday;
      if (toEl   && !toEl.value)   toEl.value   = isoToday;

      function updateOverheadVisible(){
        if (!ohWrap) return;
        const t = typeSel.value;
        ohWrap.style.display = (t === 'reception') ? 'block' : 'none';
      }
      typeSel.addEventListener('change', () => updateOverheadVisible());
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

  // Export
  window.initializePlanningModule = initializePlanningModule;
  // Poznámka: renderProductionPlanInline sme odstránili, aby sa použil ten z calendar_planner.js

})();