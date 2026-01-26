// =================================================================
// === MODUL EXPEDÍCIA (v2.5 - Fix Tlačidlá & Collation) ===
// =================================================================
let html5QrCode = null;
let isSubmitting = false; 
let isSlicingTransitioning = false;

// --- POMOCNÁ FUNKCIA ---
function safeToFixed(value, decimals = 2) {
    const num = parseFloat(value);
    return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
}

function showExpeditionView(viewId) {
  document.querySelectorAll('#expedition-module-container > .view').forEach(v => v.style.display = 'none');
  const view = document.getElementById(viewId);
  if (view) view.style.display = 'block';
  if (typeof clearStatus === 'function') clearStatus();
  isSubmitting = false; 
}

// ---------- MENU ----------
async function loadAndShowExpeditionMenu() {
  try {
    const data = await apiRequest('/api/expedicia/getExpeditionData');
    populatePendingSlicing(data.pendingTasks);
    
    const menuView = document.getElementById('view-expedition-menu');
    let slicingOrdersDiv = document.getElementById('slicing-orders-section');
    if (!slicingOrdersDiv) {
        slicingOrdersDiv = document.createElement('div');
        slicingOrdersDiv.id = 'slicing-orders-section';
        slicingOrdersDiv.className = 'section';
        slicingOrdersDiv.innerHTML = `
            <h4><i class="fas fa-list-alt"></i> Objednávky na krájanie (Zákazníci)</h4>
            <div id="slicing-orders-container" class="table-container"></div>
        `;
        menuView.appendChild(slicingOrdersDiv);
    }
    
    loadSlicingRequirements(); 
    showExpeditionView('view-expedition-menu');
    isSlicingTransitioning = false;

  } catch (e) {}
}
function populatePendingSlicing(tasks) {
  const container = document.getElementById('pending-slicing-container');
  const section = container.closest('.section');

  if (!tasks || tasks.length === 0) { 
    section.style.display = 'none'; 
    return; 
  }

  section.style.display = 'block';

  let html = `
    <table class="table" style="width:100%; border-collapse: collapse; margin-top: 10px;">
      <thead>
        <tr style="background:#f3f4f6; border-bottom: 2px solid #ddd;">
          <th style="padding:10px; text-align:left;">Zdroj (Surovina)</th>
          <th style="padding:10px; text-align:left;">Cieľ / Zákazník</th>
          <th style="padding:10px; text-align:center;">Plán</th>
          <th style="padding:10px; text-align:right;">Akcia</th>
        </tr>
      </thead>
      <tbody>`;

  tasks.forEach(t => {
    // 1. Zobrazenie Cieľa a Zákazníka
    let targetDisplay = `<strong>${escapeHtml(t.targetProductName || t.bulkProductName)}</strong>`;
    
    if (t.customer && t.customer !== 'null') {
        targetDisplay += `<div style="color:#2563eb; font-size:0.9em; margin-top:4px;">
            <i class="fas fa-user"></i> Pre: ${escapeHtml(t.customer)}
        </div>`;
    }
    if (t.dueDate && t.dueDate !== 'null') {
         targetDisplay += `<div style="color:#666; font-size:0.85em;">
            <i class="fas fa-calendar"></i> ${escapeHtml(t.dueDate)}
         </div>`;
    }

    // 2. Množstvo - PRIORITA PRE KUSY
    let qtyDisplay = '';
    let unit = 'kg';
    
    // Konverzia na čísla pre istotu
    const pcs = parseInt(t.plannedPieces || 0);
    const kgs = parseFloat(t.plannedKg || 0);

    if (pcs > 0) {
        // Ak máme naplánované kusy, zobrazíme KUSY
        qtyDisplay = `<span style="font-size:1.3em; font-weight:800; color:#1e40af;">${pcs} ks</span>`;
        unit = 'ks';
    } else {
        // Inak zobrazíme KG
        qtyDisplay = `<span style="font-size:1.1em; font-weight:600;">${safeToFixed(kgs)} kg</span>`;
        unit = 'kg';
    }

    html += `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:10px;">${escapeHtml(t.bulkProductName)}</td>
      <td style="padding:10px;">${targetDisplay}</td>
      <td style="padding:10px; text-align:center;">${qtyDisplay}</td>
      <td style="padding:10px; text-align:right;">
        <button class="btn-danger" style="padding: 8px 12px; font-size:14px; margin-right:5px; border-radius:4px; border:none; background:#dc2626; color:white; cursor:pointer;" 
                onclick="cancelSlicingTask('${t.logId}')" title="Zrušiť úlohu">
          <i class="fas fa-times"></i>
        </button>

        <button class="btn-success" style="padding: 8px 16px; font-size:14px; cursor:pointer; border-radius:4px; border:none; background:#16a34a; color:white;" 
                onclick="finalizeSlicing('${t.logId}', '${unit}')">
          <i class="fas fa-check"></i> Hotovo
        </button>
      </td>
    </tr>`;
  });

  container.innerHTML = html + '</tbody></table>';
}
async function cancelSlicingTask(logId) {
    if (!confirm("Naozaj zrušiť túto úlohu? Materiál sa vráti na sklad.")) return;
    const workerName = document.getElementById('expedition-worker-name')?.value || 'Neznámy';

    try {
        await apiRequest('/api/expedicia/cancelSlicingJob', {
            method: 'POST',
            body: { logId: logId, workerName: workerName }
        });
        // Obnoviť zoznam
        loadAndShowExpeditionMenu();
    } catch (e) {
        alert("Chyba: " + (e.message || e));
    }
}
// ---------- OBJEDNÁVKY NA KRÁJANIE ----------
async function loadSlicingRequirements() {
    const container = document.getElementById('slicing-orders-container');
    if (!container) return;
    container.innerHTML = '<p>Načítavam požiadavky z objednávok...</p>';

    try {
        const data = await apiRequest('/api/expedicia/getSlicingRequirementsFromOrders');

        if (!data || !Array.isArray(data) || data.length === 0) {
            container.innerHTML = '<p class="text-muted">Žiadne objednávky na krájanie.</p>';
            return;
        }

        let html = `
        <table style="font-size:0.9rem; width:100%; border-collapse:collapse;">
            <thead>
                <tr style="background:#fff7ed; border-bottom:1px solid #e5e7eb;">
                    <th style="width: 90px; padding:6px 8px; text-align:left;">Termín</th>
                    <th style="padding:6px 8px; text-align:left;">Zákazník</th>
                    <th style="padding:6px 8px; text-align:left;">Produkt</th>
                    <th style="width: 110px; padding:6px 8px; text-align:right;">Množstvo</th>
                    <th style="width: 140px; padding:6px 8px; text-align:center;">Akcia</th>
                </tr>
            </thead>
            <tbody>`;

        data.forEach(r => {
            let btnHtml = '';
            let rowStyle = '';

            if (r.is_running) {
                // Už beží krájanie → sivé tlačidlo, nedá sa kliknúť
                btnHtml = `
                    <button class="btn-secondary slice-btn"
                            style="padding:4px 8px; font-size:0.8rem; cursor:default; opacity:0.8;"
                            disabled>
                        <i class="fas fa-pause-circle"></i> Prebieha krájanie
                    </button>`;
                rowStyle = 'style="background-color:#fef2f2; opacity:0.9;"'; // jemne červené
            } else {
                // Pripravené na spustenie krájania
                btnHtml = `
                    <button class="btn-info slice-btn"
                            style="padding:4px 8px; font-size:0.8rem;"
                            onclick="startSlicingFromOrder(this, '${escapeHtml(r.product)}', ${r.pieces_calc})">
                        <i class="fas fa-play"></i> Krájať
                    </button>`;
            }

            html += `
            <tr ${rowStyle}>
                <td style="padding:4px 8px; font-weight:bold;">${escapeHtml(r.date)}</td>
                <td style="padding:4px 8px;">
                    <strong>${escapeHtml(r.customer)}</strong><br>
                    <small class="text-muted">${escapeHtml(r.order)}</small>
                </td>
                <td style="padding:4px 8px;">${escapeHtml(r.product)}</td>
                <td style="padding:4px 8px; text-align:right;">${escapeHtml(r.quantity_display)}</td>
                <td style="padding:4px 8px; text-align:center;">${btnHtml}</td>
            </tr>`;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<p class="error">Chyba: ${e && e.message ? e.message : e}</p>`;
    }
}


async function startSlicingFromOrder(btnElement, productName, pieces, orderNo, dateDisplay, targetEan, customerName) {
    if (isSlicingTransitioning) return;
    isSlicingTransitioning = true;

    if (!targetEan) {
        alert("Pre tento produkt nemáme EAN – nedá sa vytvoriť príkaz na krájanie.");
        isSlicingTransitioning = false;
        return;
    }

    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Vytváram...';
    }

    try {
        const payload = {
            ean: targetEan,
            quantity: pieces || 0,
            unit: 'ks',                // objednávky sú v kusoch
            customer: customerName || '',
            order_id: orderNo || '',
            due_date: dateDisplay || ''  // uloží sa do JSONu ako string
        };

        const res = await apiRequest('/api/expedicia/createManualSlicingJob', {
            method: 'POST',
            body: payload
        });

        showStatus(res.message || 'Príkaz na krájanie vytvorený.', false);

        // Obnovíme menu + zoznam objednávok na krájanie
        await loadAndShowExpeditionMenu();
    } catch (e) {
        alert("Chyba pri vytváraní príkazu na krájanie: " + (e.message || e));
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i class="fas fa-play"></i> Krájať';
        }
        isSlicingTransitioning = false;
        return;
    }

    isSlicingTransitioning = false;
}


// =================================================================
// === 3. FORMULÁRE + TLAČIDLÁ SPÄŤ (Fix) ===
// =================================================================
async function loadAndShowManualReceive() {
  showExpeditionView('view-expedition-manual-receive');
  
  // Pridanie tlačidla Späť HNEĎ
  const container = document.querySelector('#view-expedition-manual-receive .section');
  if (!document.getElementById('manual-back-btn')) {
      const back = document.createElement('button');
      back.id = 'manual-back-btn'; back.className = 'btn-secondary'; back.style.marginTop = '20px';
      back.innerHTML = '<i class="fas fa-arrow-left"></i> Späť do menu';
      back.onclick = loadAndShowExpeditionMenu;
      container.appendChild(back);
  }

  try {
    const products = await apiRequest('/api/expedicia/getAllFinalProducts');
    const sel = document.getElementById('manual-receive-product-select');
    sel.innerHTML = '<option value="">Vyberte produkt...</option>';
    products.forEach(p=>{ const o = document.createElement('option'); o.value = p.ean; o.textContent = `${p.name} (${p.unit})`; sel.add(o); });
    document.getElementById('manual-receive-date').valueAsDate = new Date();
    
    isSubmitting = false;
    const btn = document.querySelector('#view-expedition-manual-receive .btn-success');
    if(btn) { btn.disabled = false; btn.innerHTML = "Potvrdiť Príjem"; }
  } catch(e) {}
}

async function submitManualReceive() {
  if (isSubmitting) return; 
  const btn = document.querySelector('#view-expedition-manual-receive .btn-success');
  const data = {
    workerName: document.getElementById('manual-receive-worker-name').value,
    receptionDate: document.getElementById('manual-receive-date').value,
    ean: document.getElementById('manual-receive-product-select').value,
    quantity: document.getElementById('manual-receive-quantity').value
  };
  if (!data.workerName || !data.ean || !data.quantity || !data.receptionDate) { showStatus("Všetky polia sú povinné.", true); return; }
  
  isSubmitting = true;
  if(btn) { btn.disabled = true; btn.innerHTML = "Odosielam..."; }

  try {
    const res = await apiRequest('/api/expedicia/manualReceiveProduct', { method:'POST', body:data });
    showStatus(res.message, false);
    setTimeout(loadAndShowExpeditionMenu, 1500);
  } catch(e) {
      showStatus(e.message, true); isSubmitting = false;
      if(btn) { btn.disabled = false; btn.innerHTML = "Potvrdiť Príjem"; }
  }
}

async function loadAndShowSlicingRequest() {
  showExpeditionView('view-expedition-slicing-request');

  // Pridanie tlačidla Späť HNEĎ
  const container = document.querySelector('#view-expedition-slicing-request .section');
  if (!document.getElementById('slicing-back-btn')) {
      const back = document.createElement('button');
      back.id = 'slicing-back-btn'; back.className = 'btn-secondary'; back.style.marginTop = '20px';
      back.innerHTML = '<i class="fas fa-arrow-left"></i> Späť do menu';
      back.onclick = () => { isSlicingTransitioning = false; showExpeditionView('view-expedition-menu'); };
      container.appendChild(back);
  }

  try {
    const products = await apiRequest('/api/expedicia/getSlicableProducts');
    const sel = document.getElementById('slicing-product-select');
    sel.innerHTML = '<option value="">Vyberte finálny balíček...</option>';
    products.forEach(p => { const o = document.createElement('option'); o.value = p.ean; o.textContent = p.name; sel.add(o); });
    
    isSubmitting = false;
    const btn = document.querySelector('#view-expedition-slicing-request .btn-info');
    if(btn) { btn.disabled = false; btn.innerHTML = "Vytvoriť Požiadavku"; }
  } catch(e) {}
}

async function submitSlicingRequest() {
  if (isSubmitting) return; 
  const ean = document.getElementById('slicing-product-select').value;
  const pcs = document.getElementById('slicing-planned-pieces').value;
  const btn = document.querySelector('#view-expedition-slicing-request .btn-info');

  if (!ean || !pcs || Number(pcs)<=0) { showStatus("Zadajte produkt a počet kusov.", true); return; }
  
  isSubmitting = true;
  if(btn) { btn.disabled = true; btn.innerHTML = "Vytváram..."; }

  try {
    const res = await apiRequest('/api/expedicia/startSlicingRequest', { method:'POST', body:{ ean, pieces: parseInt(pcs) } });
    showStatus(res.message, false);
    setTimeout(loadAndShowExpeditionMenu, 1000);
  } catch(e) {
      showStatus("Chyba: " + e.message, true); isSubmitting = false;
      if(btn) { btn.disabled = false; btn.innerHTML = "Vytvoriť Požiadavku"; }
  }
}

// =================================================================
// === 4. OSTATNÉ FUNKCIE (BEZ ZMENY) ===
// =================================================================
async function loadProductionDates() {
  try {
    const dates = await apiRequest('/api/expedicia/getProductionDates');
    showExpeditionView('view-expedition-date-selection');
    const container = document.getElementById('expedition-date-container');
    container.innerHTML = dates.length === 0 ? '<p>Žiadne výroby na prevzatie.</p>' : '';
    dates.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = new Date(d + 'T00:00:00').toLocaleDateString('sk-SK');
      btn.onclick = () => loadProductionsByDate(d);
      container.appendChild(btn);
    });
  } catch(e) {}
}

async function loadProductionsByDate(dateStr) {
  try {
    showExpeditionView('view-expedition-batch-list');
    document.getElementById('expedition-batch-list-title').textContent =
      `Príjem výrobkov – deň výroby: ${new Date(dateStr + 'T00:00:00').toLocaleDateString('sk-SK')}`;
    document.getElementById('expedition-accept-date').value = dateStr;
    document.getElementById('view-expedition-batch-list').dataset.currentDate = dateStr;

    const data = await apiRequest('/api/expedicia/getProductionsByDate', { method:'POST', body:{ date: dateStr }});
    
    if (!data || data.length === 0) {
        document.getElementById('expedition-batch-table').innerHTML = `
            <div class="stat-card" style="text-align:center; background:#f0fdf4; border-color:#bbf7d0;">
                <h4><i class="fas fa-check-circle" style="color:green;"></i> Všetko vybavené</h4>
                <p>Pre tento deň nie sú žiadne čakajúce výroby.</p>
            </div>`;
        renderActionButtons(true); 
        return;
    }

    let html = `<table><thead><tr><th>Produkt</th><th>Stav</th><th>Plán</th><th>Príjem (Realita)</th><th>Poznámka</th><th>Akcia</th></tr></thead><tbody>`;
    let hasAcceptedItems = false;

    data.forEach(p => {
      const isAccepted = (p.status === 'Prijaté, čaká na tlač');
      if (isAccepted) hasAcceptedItems = true;
      const rowClass = isAccepted ? 'style="background-color:#ecfdf5;"' : '';
      
      let realityDisplay = '';
      if (isAccepted) {
          const val = p.mj === 'ks' ? `${p.realPieces} ks` : `${safeToFixed(p.realQty)} kg`;
          realityDisplay = `<strong>${val}</strong>`;
      } else {
          const defaultVal = p.mj === 'ks' ? (p.expectedPieces || '') : (p.plannedQty || '');
          realityDisplay = `<input type="number" step="${p.mj==='ks' ? 1 : 0.01}" id="actual_${p.batchId}" value="${defaultVal}" style="width:80px; font-weight:bold;"> ${p.mj}`;
      }

      let buttons = '';
      if (isAccepted) {
          buttons = `<div style="display:flex; gap:5px;"><button class="btn-secondary" style="margin:0; padding:5px 10px;" onclick="printLabel('${p.batchId}', '${escapeHtml(p.productName)}')"><i class="fas fa-print"></i> List</button><button class="btn-danger" style="margin:0; padding:5px 10px;" onclick="cancelAcceptancePrompt('${p.batchId}')"><i class="fas fa-undo"></i></button></div>`;
      } else {
          buttons = `<div style="display:flex; gap:5px;"><button class="btn-success" style="margin:0; padding:5px 10px;" onclick="acceptSingleProduction('${p.batchId}','${p.mj}', this, '${dateStr}')"><i class="fas fa-check"></i> Prijať</button><button class="btn-warning" style="margin:0; padding:5px 10px; background-color:#f59e0b;" onclick="returnToProductionPrompt('${p.batchId}')" title="Vrátiť do výroby"><i class="fas fa-wrench"></i></button></div>`;
      }
      const planned = p.mj === 'ks' ? `${p.expectedPieces || '?'} ks` : `${safeToFixed(p.plannedQty)} kg`;
      html += `<tr ${rowClass} data-batch-id="${p.batchId}"><td><strong>${escapeHtml(p.productName)}</strong><br><small class="text-muted">${p.batchId}</small></td><td>${escapeHtml(p.status)}</td><td>${planned}</td><td>${realityDisplay}</td><td>${buttons}</td></tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('expedition-batch-table').innerHTML = html;
    renderActionButtons(false, hasAcceptedItems);
  } catch(e) { console.error(e); showStatus("Chyba pri načítaní položiek.", true); }
}

function renderActionButtons(isEmpty, showFinishButton = false) {
    const actions = document.getElementById('expedition-action-buttons');
    let finishBtn = '';
    let printReportBtn = `<button class="btn-info" style="padding:12px 20px; font-size:1.1em;" onclick="printDailyReport()"><i class="fas fa-print"></i> Denný Protokol</button>`;
    if (showFinishButton) {
        finishBtn = `<button class="btn-success" style="padding:12px 20px; font-size:1.1em;" onclick="finishDailyReception()"><i class="fas fa-flag-checkered"></i> UKONČIŤ DENNÝ PRÍJEM</button>`;
    }
    actions.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top:1px solid #ddd; padding-top:15px;"><div class="btn-grid" style="gap:10px;"><button class="btn-secondary" onclick="loadProductionDates()"><i class="fas fa-arrow-left"></i> Späť</button><button class="btn-primary" onclick="openAcceptanceDays()"><i class="fas fa-folder-open"></i> Archív</button></div><div style="display:flex; gap:10px;">${printReportBtn}${finishBtn}</div></div>`;
}

async function acceptSingleProduction(batchId, unit, btnEl, currentDate) {
  if (isSubmitting) return;
  const workerName = document.getElementById('expedition-worker-name').value;
  const acceptDate = document.getElementById('expedition-accept-date').value || new Date().toISOString().slice(0,10);
  if (!workerName) { showStatus("Zadajte meno preberajúceho pracovníka (hore).", true); document.getElementById('expedition-worker-name').focus(); return; }
  const valRaw = (document.getElementById(`actual_${batchId}`)?.value || '').trim();
  if (!valRaw || Number(valRaw) <= 0) { showStatus("Zadajte reálne množstvo.", true); return; }
  const valNorm = String(valRaw).replace(',', '.');
  const note = document.getElementById(`note_${batchId}`)?.value || '';
  isSubmitting = true; btnEl.disabled = true; btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  try {
    const res = await apiRequest('/api/expedicia/acceptProductionItem', { method:'POST', body: { batchId, unit, actualValue: valNorm, workerName, note, acceptDate } });
    showStatus(res.message, false); loadProductionsByDate(currentDate);
  } catch(e) { showStatus("Chyba: " + e.message, true); btnEl.disabled = false; btnEl.innerHTML = '<i class="fas fa-check"></i> Prijať'; } finally { isSubmitting = false; }
}

// --- INVENTÚRA ---
async function loadAndShowStockOverview() {
  try {
    const data = await apiRequest('/api/expedicia/getProductsForInventory'); 
    showExpeditionView('view-expedition-stock-overview');
    stockOverviewItems = data;
    const categories = Object.keys(data).sort();
    const container = document.getElementById('stock-overview-tables-container');
    
    if (!categories.length) { 
        container.innerHTML = "<div class='stat-card'><p>Sklad je prázdny.</p></div>"; 
        return; 
    }

    // --- ZMENA: Pridané vyhľadávacie pole ---
    const searchHtml = `
        <div style="margin-bottom: 15px;">
            <input type="text" id="stock-search-input" class="form-control" placeholder="🔍 Hľadať produkt podľa názvu..." style="width: 100%; padding: 10px; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px;">
        </div>
    `;

    let tabs = `<div class="inventory-tabs" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">` + categories.map((c,i)=>`<button class="btn-tab ${i===0?'btn-primary':'btn-secondary'}" onclick="renderStockOverviewTab('${escapeHtml(c)}',this); document.getElementById('stock-search-input').value=''; document.getElementById('stock-search-input').dispatchEvent(new Event('input'));">${escapeHtml(c)}</button>`).join('') + `</div>`;
    
    container.innerHTML = searchHtml + tabs + `<div id="active-stock-overview-tab"></div>`;
    
    renderStockOverviewTab(categories[0]);

    // Aktivácia vyhľadávania
    attachTableSearch('stock-search-input', 'active-stock-overview-tab');

  } catch(e) {}
}
function renderStockOverviewTab(cat, btn){
  if(btn){ document.querySelectorAll('#stock-overview-tables-container .btn-tab').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-secondary')}); btn.classList.remove('btn-secondary');btn.classList.add('btn-primary'); }
  const items=stockOverviewItems[cat]||[];
  let h=`<div class="stat-card" style="border:1px solid #bfdbfe;background:#eff6ff"><h4 style="margin:0;color:#1e40af">${escapeHtml(cat)}</h4><div class="table-container" style="max-height:600px;background:white"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f3f4f6;border-bottom:2px solid #ddd"><th style="padding:10px">Názov</th><th style="padding:10px;text-align:center">MJ</th><th style="padding:10px;text-align:right">Sklad (kg)</th><th style="padding:10px;text-align:right">Prepočet</th></tr></thead><tbody>`;
  items.forEach(i=>h+=`<tr style="border-bottom:1px solid #eee"><td style="padding:8px;font-weight:500">${escapeHtml(i.nazov_vyrobku)}</td><td style="padding:8px;text-align:center;color:#666">${escapeHtml(i.mj)}</td><td style="padding:8px;text-align:right;font-weight:bold">${safeToFixed(i.aktualny_sklad_finalny_kg||0)}</td><td style="padding:8px;text-align:right;color:#555">${i.system_stock_display}</td></tr>`);
  document.getElementById('active-stock-overview-tab').innerHTML = h + `</tbody></table></div></div>`;
}

async function loadAndShowProductInventory() {
  try {
    const data = await apiRequest('/api/expedicia/getProductsForInventory'); 
    showExpeditionView('view-expedition-inventory');
    const oldBtn = document.querySelector('#view-expedition-inventory > .section > button.btn-warning');
    if(oldBtn) oldBtn.style.display = 'none';
    
    productInventoryItems = data;
    const categories = Object.keys(data).sort();
    const container = document.getElementById('product-inventory-tables-container');

    if (!categories.length) { 
        container.innerHTML = "<p>Sklad je prázdny.</p>"; 
        return; 
    }

    // --- ZMENA: Pridané vyhľadávacie pole ---
    const searchHtml = `
        <div style="margin-bottom: 15px;">
            <input type="text" id="inventory-search-input" class="form-control" placeholder="🔍 Hľadať produkt v inventúre..." style="width: 100%; padding: 10px; font-size: 1rem; border: 1px solid #ccc; border-radius: 6px;">
        </div>
    `;

    let tabs = `<div class="inventory-tabs" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">` + categories.map((c,i)=>`<button class="btn-tab ${i===0?'btn-primary':'btn-secondary'}" onclick="renderProductInventoryTab('${escapeHtml(c)}',this); document.getElementById('inventory-search-input').value=''; document.getElementById('inventory-search-input').dispatchEvent(new Event('input'));">${escapeHtml(c)}</button>`).join('') + `</div>`;
    
    container.innerHTML = searchHtml + tabs + `<div id="active-product-inventory-tab"></div>`;
    
    let finishBtnContainer = document.getElementById('finish-inventory-btn-container');
    if (!finishBtnContainer) {
        finishBtnContainer = document.createElement('div');
        finishBtnContainer.id = 'finish-inventory-btn-container';
        finishBtnContainer.style.marginTop='30px'; finishBtnContainer.style.borderTop='2px solid #ccc'; finishBtnContainer.style.paddingTop='20px'; finishBtnContainer.style.display='flex'; finishBtnContainer.style.justifyContent='space-between';
        document.querySelector('#view-expedition-inventory .section').appendChild(finishBtnContainer);
    }
    finishBtnContainer.innerHTML = `<button class="btn-secondary" onclick="showExpeditionView('view-expedition-menu')"><i class="fas fa-arrow-left"></i> Späť do menu</button><div style="text-align:right;"><span class="text-muted" style="margin-right:10px;">Po dokončení všetkých kategórií:</span><button class="btn-danger" onclick="finishProductInventoryGlobal()" style="padding:15px 25px;font-size:1.1em;"><i class="fas fa-flag-checkered"></i> UKONČIŤ INVENTÚRU</button></div>`;
    
    renderProductInventoryTab(categories[0]);

    // Aktivácia vyhľadávania
    attachTableSearch('inventory-search-input', 'active-product-inventory-tab');

  } catch(e) {}
}
function renderProductInventoryTab(cat, btn){
    if(btn){ document.querySelectorAll('#view-expedition-inventory .btn-tab').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-secondary')}); btn.classList.remove('btn-secondary');btn.classList.add('btn-primary'); }
    const items=productInventoryItems[cat]||[];
    let h=`<div class="stat-card" style="border:1px solid #bfdbfe;background:#eff6ff"><h4 style="margin:0;color:#1e40af">${escapeHtml(cat)}</h4><div class="table-container" style="max-height:500px;background:white"><table class="table-inventory-prod" data-category="${escapeHtml(cat)}"><thead><tr><th>Názov</th><th>MJ</th><th>Systém</th><th>Reálne</th></tr></thead><tbody>`;
    items.forEach(i=>h+=`<tr><td>${escapeHtml(i.nazov_vyrobku)}</td><td>${escapeHtml(i.mj)}</td><td>${i.system_stock_display}</td><td><input type="number" step="0.01" class="prod-inv-input form-control" data-ean="${escapeHtml(i.ean)}" placeholder="${i.system_stock_display}" style="font-weight:bold;width:100px;"></td></tr>`);
    document.getElementById('active-product-inventory-tab').innerHTML = h + `</tbody></table></div><div style="text-align:right;margin-top:15px"><button onclick="saveProductCategoryInventory('${escapeHtml(cat)}')" style="background-color:#16a34a;color:white;padding:12px 24px;border:none;border-radius:6px;font-size:1rem;cursor:pointer;font-weight:600"><i class="fas fa-save"></i> Uložiť ${escapeHtml(cat)}</button></div></div>`;
}
async function saveProductCategoryInventory(category) {
    const workerName = document.getElementById('inventory-worker-name').value;
    if (!workerName) { showStatus("Zadajte meno pracovníka (hore).", true); document.getElementById('inventory-worker-name').focus(); return; }
    const inputs = document.querySelectorAll(`.table-inventory-prod[data-category="${category}"] .prod-inv-input`);
    const itemsToSave = [];
    inputs.forEach(input => { if (input.value !== '') itemsToSave.push({ ean: input.dataset.ean, realQty: input.value }); });
    if (!itemsToSave.length) { showStatus(`Nezadali ste žiadne hodnoty pre ${category}.`, true); return; }
    try {
        const res = await apiRequest('/api/expedicia/saveInventoryCategory', { method:'POST', body: { items: itemsToSave, category: category, workerName: workerName } });
        showStatus(res.message, false);
    } catch(e) { showStatus("Chyba: " + e.message, true); }
}
async function finishProductInventoryGlobal() {
    if (!confirm("Naozaj chcete UKONČIŤ inventúru Skladu 2?")) return;
    try {
        const res = await apiRequest('/api/expedicia/finishInventory', { method: 'POST' });
        alert(res.message);
        loadAndShowExpeditionMenu();
    } catch(e) { showStatus("Chyba: " + e.message, true); }
}

// --- OSTATNÉ FUNKCIE ---
async function openAcceptanceDays(){try{const d=await apiRequest('/api/expedicia/getAcceptanceDays');showExpeditionView('view-expedition-acceptance-days');const c=document.getElementById('acceptance-days-container');c.innerHTML=d.length?'':'<p>Zatiaľ žiadne prijmy.</p>';d.forEach(x=>{const b=document.createElement('button');b.className='btn-primary';b.textContent=new Date(x+'T00:00:00').toLocaleDateString('sk-SK');b.onclick=()=>openAcceptanceArchive(x);c.appendChild(b)})}catch(e){}}
function openAcceptanceArchive(d){document.getElementById('accept-archive-date').value=d||new Date().toISOString().slice(0,10);loadAcceptanceArchive()}
async function loadAcceptanceArchive(){const d=document.getElementById('accept-archive-date').value;try{const r=await apiRequest(`/api/expedicia/getAcceptanceArchive?date=${encodeURIComponent(d)}`);showExpeditionView('view-expedition-acceptance-archive');const c=document.getElementById('acceptance-archive-table');let h=`<table><thead><tr><th>Čas</th><th>Produkt</th><th>Množstvo</th><th>Prijal</th><th>Akcie</th></tr></thead><tbody>`;(r.items||[]).forEach(i=>{h+=`<tr><td>${escapeHtml(new Date(i.updated_at||i.created_at).toLocaleTimeString('sk-SK',{hour:'2-digit',minute:'2-digit'}))}</td><td>${escapeHtml(i.productName)}</td><td><strong>${i.unit==='kg'?safeToFixed(i.prijem_kg,2)+' kg':i.prijem_ks+' ks'}</strong></td><td>${escapeHtml(i.prijal||'')}</td><td style="display:flex;gap:6px"><button class="btn-info" onclick="editAcceptancePrompt(${i.id},'${i.unit}','${i.batchId}')"><i class="fas fa-pen"></i></button><button class="btn-danger" onclick="deleteAcceptancePrompt(${i.id})"><i class="fas fa-trash"></i></button></td></tr>`});c.innerHTML=h+`</tbody></table>`}catch(e){}}
async function editAcceptancePrompt(id,u,bid){const n=prompt(`Nová hodnota (${u}):`);if(!n||Number(n)<=0)return;const r=prompt("Dôvod:");if(!r)return;const w=document.getElementById('expedition-worker-name')?.value||'Neznámy';try{const res=await apiRequest('/api/expedicia/editAcceptance',{method:'POST',body:{id,newValue:n,unit:u,reason:r,workerName:w}});showStatus(res.message,false);loadAcceptanceArchive()}catch(e){}}
async function deleteAcceptancePrompt(id){if(!confirm("Zmazať príjem?"))return;const r=prompt("Dôvod:");if(!r)return;const w=document.getElementById('expedition-worker-name')?.value||'Neznámy';try{const res=await apiRequest('/api/expedicia/deleteAcceptance',{method:'POST',body:{id,reason:r,workerName:w}});showStatus(res.message,false);loadAcceptanceArchive()}catch(e){}}
// expedicia.js

async function printLabel(batchId, productName) {
    const btn = document.activeElement;
    let originalText = '';
    if (btn && btn.tagName === 'BUTTON') {
        originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generujem...';
        btn.disabled = true;
    }

    try {
        // 1. Stiahnutie dát (vrátane meta_info)
        const res = await apiRequest(`/api/traceability/${batchId}`);
        
        if (res.error) throw new Error(res.error);

        const info = res.batch_info;
        const ingredients = res.ingredients || [];
        const meta = res.meta_info || {}; // <--- NOVÉ DÁTA

        // 2. Formátovanie
        const fmtDate = (d) => d ? new Date(d).toLocaleString('sk-SK') : '---';
        
        let qtyStr = '';
        if (info.mj === 'ks') {
            qtyStr = `${info.realne_mnozstvo_ks || 0} ks`;
        } else {
            qtyStr = `${safeToFixed(info.realne_mnozstvo_kg)} kg`;
        }

        // Zloženie
        let ingredientsRows = '';
        if (ingredients.length > 0) {
            ingredients.forEach(ing => {
                ingredientsRows += `
                <tr>
                    <td>${escapeHtml(ing.nazov_suroviny)}</td>
                    <td style="text-align:right;">${parseFloat(ing.pouzite_mnozstvo_kg).toFixed(3)} kg</td>
                </tr>`;
            });
        } else {
            ingredientsRows = '<tr><td colspan="2" style="font-style:italic; text-align:center;">Žiadne záznamy o surovinách.</td></tr>';
        }

        // Príprava nutričných hodnôt (ak existujú)
        let nutritionHtml = '';
        if (meta.energia_kj || meta.tuky) {
            nutritionHtml = `
            <div class="nutrition-box">
                <h3>Výživové údaje na 100g</h3>
                <table class="nutri-table">
                    <tr><td>Energia:</td><td class="right">${meta.energia_kj || '-'} kJ / ${meta.energia_kcal || '-'} kcal</td></tr>
                    <tr><td>Tuky:</td><td class="right">${meta.tuky || '-'} g</td></tr>
                    <tr><td>z toho nasýtené mastné kyseliny:</td><td class="right">${meta.nasytene_tuky || '-'} g</td></tr>
                    <tr><td>Sacharidy:</td><td class="right">${meta.sacharidy || '-'} g</td></tr>
                    <tr><td>z toho cukry:</td><td class="right">${meta.cukry || '-'} g</td></tr>
                    <tr><td>Bielkoviny:</td><td class="right">${meta.bielkoviny || '-'} g</td></tr>
                    <tr><td>Soľ:</td><td class="right">${meta.sol || '-'} g</td></tr>
                </table>
            </div>
            `;
        }

        // Príprava info o skladovaní a alergénoch
        let storageHtml = '';
        if (meta.skladovanie || meta.trvacnost || meta.alergeny) {
            storageHtml = `
            <div class="info-block">
                ${meta.skladovanie ? `<p><strong>Skladovanie:</strong> ${escapeHtml(meta.skladovanie)}</p>` : ''}
                ${meta.trvacnost ? `<p><strong>Trvanlivosť:</strong> ${meta.trvacnost} dní</p>` : ''}
                ${meta.alergeny ? `<p><strong>Alergény:</strong> ${escapeHtml(meta.alergeny)}</p>` : ''}
            </div>
            `;
        }

        // 3. HTML Dokument (A4 štýl)
        const win = window.open('', '_blank', 'width=800,height=900');
        
        win.document.write(`
            <!DOCTYPE html>
            <html lang="sk">
            <head>
                <title>Sprievodný list - ${batchId}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; color: #333; font-size: 14px; line-height: 1.4; }
                    h1 { font-size: 24px; margin-bottom: 5px; text-transform: uppercase; border-bottom: 3px solid #333; padding-bottom: 10px; }
                    h2, h3 { font-size: 16px; margin-top: 20px; border-bottom: 1px solid #ccc; padding-bottom: 5px; color: #555; text-transform: uppercase; }
                    
                    .header-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 20px; }
                    .info-box p { margin: 5px 0; font-size: 14px; }
                    .info-box strong { min-width: 120px; display: inline-block; }
                    
                    .big-qty { font-size: 20px; font-weight: bold; color: #000; margin-top: 10px; border: 2px solid #000; display: inline-block; padding: 5px 15px; }

                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
                    th { background-color: #f5f5f5; font-weight: bold; font-size:12px; }
                    .right { text-align: right; }

                    .nutrition-box { margin-top: 20px; border: 1px solid #333; padding: 10px; width: 45%; float: right; margin-left: 20px; background: #fff; }
                    .nutrition-box h3 { margin-top: 0; border-bottom: 1px solid #000; }
                    .nutri-table td { border: none; border-bottom: 1px solid #eee; padding: 4px 0; }
                    
                    .info-block { margin-top: 20px; clear: both; border: 1px solid #ddd; padding: 10px; background: #f9fafb; }

                    .qr-wrapper { text-align: center; border: 1px solid #ddd; padding: 10px; border-radius: 8px; }
                    .qr-label { font-size: 10px; color: #777; margin-top: 5px; }

                    .footer { margin-top: 50px; padding-top: 20px; border-top: 1px dashed #999; font-size: 12px; display: flex; justify-content: space-between; clear: both; }
                    .signature-box { border-top: 1px solid #000; width: 200px; text-align: center; padding-top: 5px; margin-top: 30px; }

                    @media print {
                        body { padding: 0; margin: 20px; }
                        .no-print { display: none; }
                        .nutrition-box { break-inside: avoid; }
                    }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
                <h1>Sprievodný list výrobku</h1>
                
                <div class="header-grid">
                    <div class="info-box">
                        <p><strong>Názov výrobku:</strong> <span style="font-size:18px; font-weight:bold;">${escapeHtml(info.nazov_vyrobku)}</span></p>
                        <p><strong>ID Šarže (Batch):</strong> ${escapeHtml(info.id_davky)}</p>
                        <p><strong>Výroba:</strong> ${fmtDate(info.datum_spustenia)}</p>
                        <p><strong>Exspirácia:</strong> ${meta.trvacnost ? 'Viď obal / '+meta.trvacnost+' dní' : '---'}</p>
                        
                        <div class="big-qty">MNOŽSTVO: ${qtyStr}</div>
                    </div>
                    
                    <div class="qr-wrapper">
                        <div id="qrcode" style="display:flex; justify-content:center;"></div>
                        <div class="qr-label">ID Šarže pre skener</div>
                    </div>
                </div>

                ${nutritionHtml}

                <div style="width: ${nutritionHtml ? '50%' : '100%'}; float:left;">
                    <h2>Zloženie (Reálne použité)</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Surovina</th>
                                <th class="right">Množstvo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${ingredientsRows}
                        </tbody>
                    </table>
                </div>
                
                ${storageHtml}

                ${meta.ccp ? `<div style="margin-top:10px; font-size:11px;"><strong>CCP Body:</strong> ${escapeHtml(meta.ccp)}</div>` : ''}

                <div class="footer">
                    <div>
                        Vygenerované systémom MIK<br>
                        Dátum tlače: ${new Date().toLocaleString('sk-SK')}
                    </div>
                    <div>
                        <div class="signature-box">Podpis expedienta</div>
                    </div>
                </div>

                <script>
                    new QRCode(document.getElementById("qrcode"), {
                        text: "${info.id_davky}",
                        width: 120,
                        height: 120
                    });
                    setTimeout(() => { window.print(); }, 600);
                <\/script>
            </body>
            </html>
        `);
        win.document.close();

    } catch (e) {
        console.error(e);
        showStatus("Chyba tlače: " + e.message, true);
    } finally {
        if (btn && originalText) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}
async function printDailyReport(){const d=document.getElementById('view-expedition-batch-list').dataset.currentDate;if(!d)return;try{const r=await fetch('/api/expedicia/printDailyReport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:d})});if(!r.ok)throw new Error("Chyba reportu");const h=await r.text();const w=window.open('','_blank');w.document.write(h);w.document.close()}catch(e){showStatus(e.message,true)}}
// V súbore: static/js/expedicia.js

async function finishDailyReception() {
    const d = document.getElementById('view-expedition-batch-list').dataset.currentDate;
    const w = document.getElementById('expedition-worker-name').value;

    // 1. KONTROLA MENA - Ak chýba, vyskočí upozornenie
    if (!w || w.trim() === "") {
        alert("⚠️ CHYBA: Nie je vyplnené meno pracovníka (v hornej časti obrazovky)!\n\nProsím, zadajte meno a skúste to znova.");
        
        // Automaticky presunieme kurzor do poľa pre meno
        const nameInput = document.getElementById('expedition-worker-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.style.border = "2px solid red"; // Vizuálne zvýraznenie chyby
            setTimeout(() => nameInput.style.border = "", 3000); // Po 3s zmizne
        }
        return;
    }

    if (!confirm("Naozaj chcete UKONČIŤ tento deň?")) return;

    try {
        const r = await apiRequest('/api/expedicia/finishDailyReception', {
            method: 'POST',
            body: { date: d, workerName: w }
        });
        
        // Zobrazíme úspech
        showStatus(r.message, false);
        alert(r.message); 
        
        // Obnovíme zoznam
        loadProductionsByDate(d);
    } catch (e) {
        showStatus(e.message, true);
        alert("Chyba: " + e.message);
    }
}
async function returnToProductionPrompt(bid){const r=prompt("Dôvod vrátenia:");if(!r)return;const w=document.getElementById('expedition-worker-name').value||'Expedícia';try{const res=await apiRequest('/api/expedicia/returnToProduction',{method:'POST',body:{batchId:bid,reason:r,workerName:w}});showStatus(res.message,false);loadProductionsByDate(document.getElementById('view-expedition-batch-list').dataset.currentDate)}catch(e){showStatus(e.message,true)}}
async function cancelAcceptancePrompt(bid){if(!confirm("Zrušiť príjem?"))return;const w=prompt("Podpis:");if(!w)return;const r=prompt("Dôvod:");if(!r)return;try{const res=await apiRequest('/api/expedicia/cancelAcceptance',{method:'POST',body:{batchId:bid,workerName:w,reason:r}});showStatus(res.message,false);loadProductionsByDate(document.getElementById('view-expedition-batch-list').dataset.currentDate)}catch(e){showStatus(e.message,true)}}
function startBarcodeScanner(){showExpeditionView('view-expedition-scanner');html5QrCode=new Html5Qrcode("scanner-container");html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:250},t=>{showBatchDetailModal(t);stopBarcodeScanner();});}
function stopBarcodeScanner(){if(html5QrCode)html5QrCode.stop();showExpeditionView('view-expedition-menu');}
async function finalizeSlicing(id, unit) {
    let promptText = "Zadajte reálne vyrobené množstvo:";
    if (unit === 'ks') {
        promptText = "Zadajte reálny počet vyrobených KUSOV:";
    } else {
        promptText = "Zadajte reálnu váhu v KG (napr. 5.23):";
    }

    const p = prompt(promptText);
    if (!p) return;

    // Validácia (číslo)
    const val = parseFloat(p.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
        alert("Neplatné množstvo!");
        return;
    }

    try {
        await apiRequest('/api/expedicia/finalizeSlicing', {
            method: 'POST',
            body: { logId: id, actualPieces: val } // Backend si to preberie ako číslo
        });
        
        // Obnovenie stránky
        loadAndShowExpeditionMenu();
    } catch (e) {
        alert("Chyba: " + (e.message || e));
    }
}
async function showBatchDetailModal(bid){let m=document.getElementById('batch-detail-modal');if(!m){m=document.createElement('div');m.id='batch-detail-modal';m.style.cssText="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)";document.body.appendChild(m)}m.innerHTML=`<div style="background:white;padding:40px;border-radius:15px;text-align:center"><i class="fas fa-circle-notch fa-spin" style="font-size:3rem;color:#f59e0b"></i></div>`;m.style.display='flex';try{const r=await apiRequest(`/api/traceability/${bid}`);if(r.error)throw new Error(r.error);const i=r.batch_info,ings=r.ingredients||[];const fd=d=>d?new Date(d).toLocaleString('sk-SK'):'-';const ir=ings.map(x=>`<tr style="border-bottom:1px solid #eee"><td style="padding:8px 10px">${escapeHtml(x.nazov_suroviny)}</td><td style="padding:8px 10px;text-align:right;font-weight:bold">${parseFloat(x.pouzite_mnozstvo_kg).toFixed(3)} kg</td></tr>`).join('');m.innerHTML=`<div style="background:white;width:95%;max-width:600px;max-height:95vh;overflow-y:auto;border-radius:12px;display:flex;flex-direction:column"><div style="background:#f59e0b;color:white;padding:15px 20px;display:flex;justify-content:space-between;align-items:center;border-radius:12px 12px 0 0"><h3 style="margin:0;font-size:1.3rem">${escapeHtml(i.nazov_vyrobku)}</h3><button onclick="document.getElementById('batch-detail-modal').style.display='none';showExpeditionView('view-expedition-menu')" style="background:none;border:none;color:white;font-size:2rem;line-height:1;cursor:pointer">&times;</button></div><div style="padding:20px;flex:1"><div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:25px;background:#f9fafb;padding:15px;border-radius:8px;border:1px solid #e5e7eb"><div><div style="font-size:0.8rem;color:#6b7280">ID</div><div style="font-weight:bold;font-family:monospace;word-break:break-all">${escapeHtml(i.id_davky)}</div></div><div><div style="font-size:0.8rem;color:#6b7280">Stav</div><div style="font-weight:bold;color:${i.stav==='Ukončené'?'#16a34a':'#d97706'}">${escapeHtml(i.stav)}</div></div><div><div style="font-size:0.8rem;color:#6b7280">Množstvo</div><div style="font-size:1.4rem;font-weight:bold;color:#111827">${safeToFixed(i.realne_mnozstvo_kg)} <small>kg</small></div></div></div><h4 style="margin:0 0 10px 0;border-bottom:2px solid #f59e0b;display:inline-block">Zloženie</h4><table style="width:100%;border-collapse:collapse;font-size:0.95rem"><thead style="background:#f3f4f6"><tr><th style="text-align:left;padding:10px">Surovina</th><th style="text-align:right;padding:10px">Množstvo</th></tr></thead><tbody>${ir||'<tr><td>Žiadne suroviny</td></tr>'}</tbody></table></div><div style="padding:15px;text-align:right;background:#fafafa;border-radius:0 0 12px 12px"><button onclick="document.getElementById('batch-detail-modal').style.display='none';showExpeditionView('view-expedition-menu')" class="btn-secondary" style="margin:0;font-size:1.1rem;padding:10px 25px">Zavrieť</button></div></div>`}catch(e){m.innerHTML=`<div style="background:white;padding:30px;border-radius:12px;text-align:center"><h3 style="color:#ef4444">Chyba</h3><p>${escapeHtml(e.message)}</p><button class="btn-secondary" onclick="document.getElementById('batch-detail-modal').style.display='none'">Zavrieť</button></div>`}}
// Pomocná funkcia pre vyhľadávanie v tabuľke (ignoruje diakritiku)
function attachTableSearch(inputId, containerId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', function() {
        const filter = this.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        // Hľadáme v aktuálne viditeľnej tabuľke vo vnútri kontajnera
        const rows = document.querySelectorAll(`#${containerId} table tbody tr`);

        rows.forEach(row => {
            // Predpokladáme, že názov je v prvom stĺpci (index 0)
            const text = row.cells[0].textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            if (text.includes(filter)) {
                row.style.display = "";
            } else {
                row.style.display = "none";
            }
        });
    });
}
// ALIAS
window.submitProductInventory = finishProductInventoryGlobal;
window.loadAndShowExpeditionMenu=loadAndShowExpeditionMenu;
window.loadProductionDates=loadProductionDates;
window.loadProductionsByDate=loadProductionsByDate;
window.acceptSingleProduction=acceptSingleProduction;
window.openAcceptanceDays=openAcceptanceDays;
window.openAcceptanceArchive=openAcceptanceArchive;
window.loadAcceptanceArchive=loadAcceptanceArchive;
window.printLabel=printLabel;
window.loadAndShowProductInventory=loadAndShowProductInventory;
window.renderProductInventoryTab=renderProductInventoryTab;
window.saveProductCategoryInventory=saveProductCategoryInventory;
window.finishProductInventoryGlobal=finishProductInventoryGlobal;
window.loadAndShowManualReceive=loadAndShowManualReceive;
window.submitManualReceive=submitManualReceive;
window.loadAndShowSlicingRequest=loadAndShowSlicingRequest;
window.submitSlicingRequest=submitSlicingRequest;
window.startBarcodeScanner=startBarcodeScanner;
window.finalizeSlicing=finalizeSlicing;
window.loadAndShowStockOverview=loadAndShowStockOverview;
window.renderStockOverviewTab=renderStockOverviewTab;
window.printDailyReport=printDailyReport;
window.finishDailyReception=finishDailyReception;
window.returnToProductionPrompt=returnToProductionPrompt;
window.cancelAcceptancePrompt=cancelAcceptancePrompt;
window.startSlicingFromOrder=startSlicingFromOrder;
window.showBatchDetailModal=showBatchDetailModal;
window.cancelSlicingTask = cancelSlicingTask;