// =================================================================
// === SUB-MODUL KANCELÁRIA: VOZOVÝ PARK (fleet.js) ================
// =================================================================

// --- Fallback pre escapeHtml (ak by nebol načítaný z common.js) ---
var escapeHtml = (typeof window.escapeHtml === 'function')
  ? window.escapeHtml
  : function (str) {
      return String(str || '').replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m];
      });
    };

// --- Fallback pre showStatus / apiRequest ---
if (typeof window.showStatus !== 'function') {
  window.showStatus = function (msg, isError) {
    (isError ? console.error : console.log)('[status]', msg);
  };
}
if (typeof window.apiRequest !== 'function') {
  window.apiRequest = async function (url, opts) {
    const o = Object.assign({ credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body && typeof o.body === 'object' && !(o.body instanceof FormData)) {
      o.headers['Content-Type'] = o.headers['Content-Type'] || 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const res = await fetch(url, o);
    const ct  = (res.headers.get('content-type')||'').toLowerCase();
    const data= ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || res.statusText || ('HTTP '+res.status));
    return data;
  };
}

// --- Bezpečný globálny stav (ak by ešte nebol inicializovaný) ---
(function () {
  if (typeof window.fleetState !== 'object' || window.fleetState === null) {
    window.fleetState = {
      vehicles: [], logs: [], refuelings: [], costs: [],
      selected_vehicle_id: null, selected_year: null, selected_month: null,
      last_odometer: 0, analysis: null
    };
  }
})();

// --- Pomocné – načítanie a sanitizácia výberov ---
function _num(v, fb){ var n = parseInt(v,10); return isNaN(n)?fb:n; }
function _todayY(){ return new Date().getFullYear(); }
function _todayM(){ return new Date().getMonth()+1; }
function safeToFixed(num, digits = 2) {
  const val = parseFloat(String(num).replace(",","."));
  return isNaN(val) ? '0.00' : val.toFixed(digits);
}
function _syncPeriodFromUI(){
  var ySel = document.getElementById('fleet-year-select');
  var mSel = document.getElementById('fleet-month-select');
  var y = _num(ySel && ySel.value, _todayY());
  var m = _num(mSel && mSel.value, _todayM());
  fleetState.selected_year = y; fleetState.selected_month = m;
  return {year:y, month:m};
}
function _syncVehicleFromUI(){
  var vSel = document.getElementById('fleet-vehicle-select');
  if (vSel && vSel.value) fleetState.selected_vehicle_id = vSel.value;
  return fleetState.selected_vehicle_id;
}
// --- UX: pri prepnutí auta/mesiaca vyčisti zobrazenie aby “nepreskakovali” dáta ---
function _clearFleetViewsOnReload() {
  try {
    const log = document.getElementById('fleet-logbook-container');
    if (log) log.innerHTML = '<p>Načítavam knihu jázd…</p>';

    const ref = document.getElementById('fleet-refueling-container');
    if (ref) ref.innerHTML = '<p>Načítavam tankovania…</p>';

    const costs = document.getElementById('fleet-costs-container');
    if (costs) costs.innerHTML = '<p>Načítavam náklady…</p>';

    const ana = document.getElementById('fleet-analysis-container');
    if (ana) ana.innerHTML = '<p>Načítavam analýzu…</p>';

    const cmpCont = document.getElementById('fleet-compare-container');
    if (cmpCont) cmpCont.innerHTML = '';

    const cmpChart = document.getElementById('fleet-compare-chart');
    if (cmpChart) cmpChart.innerHTML = '';
  } catch (e) {
    // ticho – je to len UX helper
  }
}

// --- Porovnanie: spoľahlivo vráti zoznam vozidiel (fleetState -> DOM -> API) ---
async function _getVehiclesList() {
  try {
    // 1) Najprv globálny stav
    if (window.fleetState && Array.isArray(window.fleetState.vehicles) && window.fleetState.vehicles.length) {
      return window.fleetState.vehicles;
    }

    // 2) Fallback: z DOM selectu (ak je naplnený)
    const sel = document.getElementById('fleet-vehicle-select');
    if (sel && sel.options && sel.options.length) {
      const list = Array.from(sel.options)
        .filter(o => o && o.value)
        .map(o => {
          const text = (o.textContent || '').trim();
          let name = text, plate = '';
          const m = text.match(/^(.*)\(([^)]+)\)\s*$/);
          if (m) {
            name = (m[1] || '').trim();
            plate = (m[2] || '').trim();
          }
          return { id: o.value, name, license_plate: plate };
        });

      if (list.length) return list;
    }

    // 3) Fallback: dotiahni z API (SPRÁVNE cez GET)
    const period = (typeof _syncPeriodFromUI === 'function')
      ? _syncPeriodFromUI()
      : { year: _todayY(), month: _todayM() };

    const year = period.year || _todayY();
    const month = period.month || _todayM();
    const vehicleId = (window.fleetState && window.fleetState.selected_vehicle_id) || (sel && sel.value) || '';

    const url =
      '/api/kancelaria/fleet/getData'
      + '?vehicle_id=' + encodeURIComponent(vehicleId || '')
      + '&year=' + encodeURIComponent(year)
      + '&month=' + encodeURIComponent(month);

    const data = await apiRequest(url);

    if (data && Array.isArray(data.vehicles)) {
      window.fleetState = window.fleetState || {};
      window.fleetState.vehicles = data.vehicles;
      return data.vehicles;
    }
  } catch (e) {
    console.error('[_getVehiclesList] Nepodarilo sa načítať vozidlá:', e);
  }

  return [];
}

// --- Stub: staré hromadné uloženie nahradil modalový editor dňa ---
function handleSaveLogbook(e) {
  if (e && e.preventDefault) e.preventDefault();
  try { showStatus('Úpravy sa ukladajú cez modálne okná po dňoch. Hromadné uloženie je skryté.', false); } catch (_) {}
}

// =================== UI: Inicializácia modulu =====================
function initializeFleetModule() {
  if (typeof window.ensureFleetTemplates === 'function') window.ensureFleetTemplates();
  const container = document.getElementById('section-fleet');
  if (!container) return;

  // Lokálny štýl (zaoblené „pill“ tlačidlá + fallback na taby + analýza)
  const inlineStyles = `
    <style id="fleet-inline-styles">
      #section-fleet .b2b-tab-button{
        appearance:none;border:0;cursor:pointer;
        padding:.55rem .9rem;border-radius:9999px;
        background: var(--light); color: var(--dark);
        font-family: var(--font); font-weight:600; letter-spacing:.2px;
        box-shadow: 0 1px 2px rgba(0,0,0,.06) inset;
        transition: transform .12s ease, box-shadow .15s ease, background-color .15s ease, color .15s ease;
      }
      #section-fleet .b2b-tab-button:hover{ filter: brightness(0.98); }
      #section-fleet .b2b-tab-button:active{ transform: translateY(1px); }
      #section-fleet .b2b-tab-button.active{
        color:#fff; background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.06)), var(--primary-color);
        box-shadow: var(--shadow);
      }
      #section-fleet .btn { border-radius:9999px; }
      /* Fallback na tab obsah */
      #section-fleet .b2b-tab-content { display:none; }
      #section-fleet .b2b-tab-content.active { display:block; }
      /* Analýza – krajšie karty */
      #section-fleet .analysis-card { background:#fff; border-radius: var(--radius); box-shadow: var(--shadow); padding:1rem; }
      #section-fleet .analysis-table { width:100%; border-collapse: collapse; font-size: .95rem; }
      #section-fleet .analysis-table th, #section-fleet .analysis-table td { border-bottom:1px solid var(--mid); padding:.6rem .7rem; text-align:left; }
      #section-fleet .analysis-table tbody tr:hover { background:#fafafa; }
      #section-fleet .kpi-badges { display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:.75rem; }
      #section-fleet .kpi-badge { display:inline-flex; align-items:center; gap:.4rem; padding:.45rem .7rem; border-radius:9999px; background:var(--light); font-weight:600; box-shadow: 0 1px 2px rgba(0,0,0,.06) inset; }
      #section-fleet .delta { font-weight: 700; }
      #section-fleet .delta.up { color: var(--success-color); }
      #section-fleet .delta.down { color: var(--danger-color); }
      #section-fleet .table-container { border:1px solid var(--mid); border-radius: .5rem; overflow:auto; }
      #section-fleet table { width:100%; border-collapse: collapse; }
      #section-fleet th, #section-fleet td { padding:.6rem .7rem; border-bottom:1px solid var(--mid); text-align:left; }
      #section-fleet th { position:sticky; top:0; background:var(--light); font-weight:600; }
      .btn-xs{ padding:.25rem .5rem; font-size:.8rem; }
    </style>
  `;

  container.innerHTML = `
    ${inlineStyles}
    <h3>Správa Vozového Parku</h3>
    <div style="display:flex; gap:1rem; align-items:flex-end; margin-bottom:1.5rem; flex-wrap:wrap;">
      <div class="form-group" style="margin-bottom:0;">
        <label for="fleet-vehicle-select" style="margin-top:0;">Vozidlo:</label>
        <select id="fleet-vehicle-select"></select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label for="fleet-year-select" style="margin-top:0;">Rok:</label>
        <select id="fleet-year-select"></select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label for="fleet-month-select" style="margin-top:0;">Mesiac:</label>
        <select id="fleet-month-select"></select>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label for="fleet-report-type" style="margin-top:0;">Typ reportu:</label>
        <select id="fleet-report-type">
          <option value="all">Všetko</option>
          <option value="logs">Len kniha jázd</option>
          <option value="consumption">Len spotreba</option>
          <option value="costs">Len náklady</option>
        </select>
      </div>
      <div style="margin-left:auto; display:flex; gap:.5rem;">
        <button id="add-vehicle-btn" class="btn btn-success" style="margin-top:auto;"><i class="fas fa-plus"></i> Nové</button>
        <button id="edit-vehicle-btn" class="btn btn-warning" style="margin-top:auto;"><i class="fas fa-edit"></i> Upraviť</button>
        <button id="print-fleet-report-btn" class="btn btn-secondary" style="margin-top:auto;"><i class="fas fa-print"></i> Tlačiť Report</button>
      </div>
    </div>

    <div class="b2b-tab-nav" id="fleet-main-nav">
      <button class="b2b-tab-button active" data-fleet-tab="logbook">Kniha Jázd</button>
      <button class="b2b-tab-button" data-fleet-tab="refueling">Tankovanie</button>
      <button class="b2b-tab-button" data-fleet-tab="costs">Náklady</button>
      <button class="b2b-tab-button" data-fleet-tab="analysis">Analýza</button>
      <button class="b2b-tab-button" data-fleet-tab="compare">Porovnanie</button>
    </div>

    <div id="logbook-tab" class="b2b-tab-content active" style="margin-top:1.5rem; display:block;">
      <div id="fleet-logbook-container" class="table-container"></div>
      <button id="save-logbook-changes-btn" class="btn btn-success" style="width:100%; margin-top:1rem;"><i class="fas fa-save"></i> Uložiť zmeny v knihe jázd</button>
    </div>

    <div id="refueling-tab" class="b2b-tab-content" style="margin-top:1.5rem;">
      <div id="fleet-refueling-container"></div>
      <button id="add-refueling-btn" class="btn btn-success" style="width:100%; margin-top:1rem;"><i class="fas fa-gas-pump"></i> Pridať záznam o tankovaní</button>
    </div>

    <div id="costs-tab" class="b2b-tab-content" style="margin-top:1.5rem;">
      <div id="fleet-costs-container"></div>
      <button id="add-cost-btn" class="btn btn-success" style="width:100%; margin-top:1rem;"><i class="fas fa-plus"></i> Pridať nový náklad</button>
    </div>

    <div id="analysis-tab" class="b2b-tab-content" style="margin-top:1.5rem;">
      <div id="fleet-analysis-container"></div>
    </div>

    <div id="compare-tab" class="b2b-tab-content" style="margin-top:1.5rem;">
      <div id="fleet-compare-filters" class="filter-row" style="display:flex; flex-wrap:wrap; gap:.75rem; align-items:flex-end;"></div>
      <div id="fleet-compare-chart" style="height:320px; margin-top:1rem;"></div>
      <div id="fleet-compare-container" class="table-container" style="margin-top:1rem;"></div>
    </div>
  `;

  // Predvyplnenie filtrov
  const vehicleSelect = document.getElementById('fleet-vehicle-select');
  const yearSelect    = document.getElementById('fleet-year-select');
  const monthSelect   = document.getElementById('fleet-month-select');

  const currentYear = new Date().getFullYear();
  for (let i = currentYear; i >= currentYear - 5; i--) { yearSelect.add(new Option(i, i)); }
  ["Január","Február","Marec","Apríl","Máj","Jún","Júl","August","September","Október","November","December"]
    .forEach((name, index) => { monthSelect.add(new Option(name, index + 1)); });

  // Defaulty
  const today = new Date();
  yearSelect.value  = today.getFullYear();
  monthSelect.value = today.getMonth() + 1;
  _syncPeriodFromUI();

  const loadData = function(){ _syncPeriodFromUI(); loadAndRenderFleetData(); };

  // Drž state v sync s UI
 vehicleSelect.onchange = function(){
  _syncVehicleFromUI();
  _clearFleetViewsOnReload();
  loadData();
};

yearSelect.onchange = function(){
  _syncPeriodFromUI();
  _clearFleetViewsOnReload();
  loadData();
};

monthSelect.onchange = function(){
  _syncPeriodFromUI();
  _clearFleetViewsOnReload();
  loadData();
};


  document.getElementById('add-vehicle-btn').onclick     = function(){ openAddEditVehicleModal(); };
  document.getElementById('edit-vehicle-btn').onclick    = function(){
    if (_syncVehicleFromUI()) { openAddEditVehicleModal(fleetState.selected_vehicle_id); }
    else { showStatus("Najprv vyberte vozidlo, ktoré chcete upraviť.", true); }
  };
  var _sbtn = document.getElementById('save-logbook-changes-btn');
  if (_sbtn) { _sbtn.style.display = 'none'; _sbtn.onclick = handleSaveLogbook; }

  document.getElementById('add-refueling-btn').onclick   = function(){ openAddRefuelingModal(_syncVehicleFromUI()); };
  document.getElementById('print-fleet-report-btn').onclick = handlePrintFleetReport;

  // Delete vozidla (double confirm) – voliteľné
  (function(){
    try{
      const printBtn = document.getElementById('print-fleet-report-btn');
      const bar = printBtn && printBtn.parentElement;
      if (bar && !document.getElementById('delete-vehicle-btn')){
        const del = document.createElement('button');
        del.id = 'delete-vehicle-btn';
        del.className = 'btn btn-danger';
        del.style.marginTop = 'auto';
        del.innerHTML = '<i class="fas fa-trash"></i> Zmazať';
        bar.appendChild(del);
        del.addEventListener('click', async () => {
          const sel = document.getElementById('fleet-vehicle-select');
          const vid = sel && sel.value;
          const v   = (window.fleetState && window.fleetState.vehicles || []).find(x => String(x.id)===String(vid));
          if (!vid || !v){ alert('Vyberte vozidlo.'); return; }
          if (!confirm(`Naozaj zmazať vozidlo ${v.name||''} (${v.license_plate||''})?`)) return;
          const typed = prompt(`Pre potvrdenie zadajte presnú ŠPZ: ${v.license_plate||''}`);
          if (!typed || String(typed).trim().toUpperCase() !== String(v.license_plate||'').toUpperCase()){
            alert('ŠPZ nesedí, zmazanie zrušené.'); return;
          }
          try{
            await apiRequest('/api/kancelaria/fleet/deleteVehicle', { method:'POST', body:{ id: vid, confirm_plate: String(v.license_plate||'').toUpperCase() } });
            showStatus('Vozidlo bolo zmazané.', false);
            await loadAndRenderFleetData(true);
          }catch(e){}
        });
      }
    }catch(e){}
  })();

  document.getElementById('add-cost-btn').onclick = function(){ openAddEditCostModal(); };

  // Prepnutie tabov – vždy len jeden viditeľný
  const tabButtons  = document.querySelectorAll('#section-fleet .b2b-tab-button');
  const tabContents = document.querySelectorAll('#section-fleet .b2b-tab-content');
  tabButtons.forEach(function(button){
    button.onclick = function(){
      tabButtons.forEach(function(btn){ btn.classList.remove('active'); });
      button.classList.add('active');
      tabContents.forEach(function(content){ content.classList.remove('active'); content.style.display = 'none'; });
      const active = document.getElementById(button.dataset.fleetTab + '-tab');
      if (active) { active.classList.add('active'); active.style.display = 'block'; }

      // lazy načítanie
      if (button.dataset.fleetTab === 'analysis') loadAndRenderFleetAnalysis();
      else if (button.dataset.fleetTab === 'costs') loadAndRenderFleetCosts();
      else if (button.dataset.fleetTab === 'compare') {
        if (!fleetState.vehicles || !fleetState.vehicles.length){
          loadAndRenderFleetData(true).then(setupFleetComparisonUI);
        } else {
          setupFleetComparisonUI();
        }
      }
    };
  });

  // Úvodný stav: len Kniha jázd
  tabContents.forEach(function(c){ c.style.display = 'none'; });
  var firstTab = document.getElementById('logbook-tab');
  if (firstTab) firstTab.style.display = 'block';

  loadAndRenderFleetData(true);
}

// ======================= Data load/render =========================

// --- Double confirm delete: vymazanie všetkých záznamov dňa ---
// === NÁHRADA: vymazanie všetkých záznamov dňa cez MODÁL (FF-safe) ===
async function handleDeleteDayLogs(dateISO) {
  const pretty = dateISO.split('-').reverse().join('.');
  // otvor modál (žiadny alert/prompt)
  if (typeof showModal !== 'function') {
    // fallback ak by modál nebol dostupný
    const typed = prompt(`Pre potvrdenie zadajte presný dátum ${pretty} alebo napíšte ZMAZAŤ:`); 
    if (!typed) return;
    return _doDeleteDayLogs(dateISO, typed);
  }

  showModal(`Vymazať knihu jázd – ${pretty}`, function () {
    const html = `
      <div class="form-grid" style="display:grid;grid-template-columns:1fr;gap:.75rem;min-width:360px">
        <p><strong>Upozornenie:</strong> Táto akcia <u>trvalo vymaže</u> všetky záznamy knihy jázd pre deň <strong>${pretty}</strong> pre vybrané vozidlo.</p>
        <p>Pre potvrdenie napíšte <code>ZMAZAŤ</code> alebo presný dátum: <code>${pretty}</code> alebo <code>${dateISO}</code>.</p>
        <input id="del-confirm-input" placeholder="napr. ZMAZAŤ alebo ${pretty}" autocomplete="off">
        <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:.25rem">
          <button type="button" class="btn btn-secondary" id="del-cancel">Zrušiť</button>
          <button type="button" class="btn btn-danger" id="del-ok">Vymazať deň</button>
        </div>
      </div>
    `;
    return {
      html,
      onReady: function () {
        const input = document.getElementById('del-confirm-input');
        const btnOk = document.getElementById('del-ok');
        const btnCancel = document.getElementById('del-cancel');

        function normalize(v){ return String(v||'').trim(); }
        async function submit() {
          const typed = normalize(input.value);
          const ok = [ 'ZMAZAŤ', pretty, dateISO ].some(t => t.toUpperCase() === typed.toUpperCase());
          if (!ok) {
            showStatus('Potvrdenie nesedí. Zadajte dátum dňa alebo ZMAZAŤ.', true);
            input.focus();
            return;
          }
          // disable počas requestu
          btnOk.disabled = true;
          btnOk.textContent = 'Mažem…';
          try {
            await _doDeleteDayLogs(dateISO, typed);
            // zatvor modál
            const modal = document.getElementById('modal-container');
            if (modal) modal.style.display = 'none';
          } catch(_) {
            // chyba je ošetrená v _doDeleteDayLogs
          } finally {
            btnOk.disabled = false;
            btnOk.textContent = 'Vymazať deň';
          }
        }

        btnCancel.onclick = () => { const modal = document.getElementById('modal-container'); if (modal) modal.style.display = 'none'; };
        btnOk.onclick     = submit;
        input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') submit(); });
        setTimeout(()=> input.focus(), 0);
      }
    };
  });
}

// Pomocná: samotný request + refresh
async function _doDeleteDayLogs(dateISO, confirmText){
  try {
    const vehicle_id = window.fleetState && window.fleetState.selected_vehicle_id;
    if (!vehicle_id) { showStatus('Najprv vyberte vozidlo.', true); return; }

    const res = await apiRequest('/api/kancelaria/fleet/deleteDayLogs', {
      method: 'POST',
      body: { vehicle_id, date: dateISO, confirm_text: confirmText }
    });

    if (res && res.error) {
      showStatus(res.error, true);
      return;
    }
    showStatus('Denné záznamy boli vymazané.', false);
    await loadAndRenderFleetData(true);
  } catch (e) {
    showStatus(e && e.message ? e.message : 'Vymazanie zlyhalo.', true);
  }
}


async function loadAndRenderFleetData(initialLoad) {
  _syncVehicleFromUI();
  _syncPeriodFromUI();

  const vehicleSelect = document.getElementById('fleet-vehicle-select');
  const yearSelect    = document.getElementById('fleet-year-select');
  const monthSelect   = document.getElementById('fleet-month-select');

  var vehicleId = vehicleSelect && vehicleSelect.value ? vehicleSelect.value : (fleetState.selected_vehicle_id || '');
  var period = _syncPeriodFromUI();
  var year = period.year, month = period.month;

  try {
    const url  = '/api/kancelaria/fleet/getData?vehicle_id=' + (vehicleId || '') + '&year=' + year + '&month=' + month;
    const data = await apiRequest(url);

    Object.assign(fleetState, data);
window.fleetState = fleetState;
    if (!fleetState.selected_vehicle_id) fleetState.selected_vehicle_id = data.selected_vehicle_id || (data.vehicles && data.vehicles[0] && data.vehicles[0].id) || null;
    if (!fleetState.selected_year)  fleetState.selected_year  = data.selected_year  || year;
    if (!fleetState.selected_month) fleetState.selected_month = data.selected_month || month;

    if (vehicleSelect && fleetState.selected_vehicle_id) vehicleSelect.value = String(fleetState.selected_vehicle_id);
    if (yearSelect)  yearSelect.value  = String(fleetState.selected_year);
    if (monthSelect) monthSelect.value = String(fleetState.selected_month);

    renderVehicleSelect(data.vehicles, fleetState.selected_vehicle_id);
    renderLogbookTable(data.logs, fleetState.selected_year, fleetState.selected_month, data.last_odometer);
    renderRefuelingTable(data.refuelings);

    if (document.querySelector('#analysis-tab.active')) { loadAndRenderFleetAnalysis(); }
    if (document.querySelector('#costs-tab.active')) { loadAndRenderFleetCosts(); }
  } catch (e) {
    console.error("Chyba pri načítaní dát vozového parku:", e);
    var cont = document.getElementById('fleet-logbook-container');
    if (cont) cont.innerHTML = '<p class="error">' + (e.message || 'Chyba pri načítaní.') + '</p>';
  }
}

function renderVehicleSelect(vehicles, selectedId) {
  const select = document.getElementById('fleet-vehicle-select');
  const currentVal = select.value;
  select.innerHTML = '';
  if (!vehicles || vehicles.length === 0) {
    select.add(new Option('Žiadne vozidlá v systéme', ''));
    return;
  }
  vehicles.forEach(function(v){ select.add(new Option(v.name + ' (' + v.license_plate + ')', v.id)); });
  if (vehicles.some(function(v){ return String(v.id) === String(currentVal); })) {
    select.value = currentVal;
  } else if (selectedId) {
    select.value = selectedId;
  }
  _syncVehicleFromUI();
}

// =================== KNIHA JÁZD (tabuľka + modal) =================
function _getPrevEndOdometer(currentDateISO) {
  try {
    // Prevedieme cieľový dátum na číslo (čas v ms), aby sme sa vyhli chybám v texte
    // Nastavíme čas na 00:00:00 pre istotu
    var targetTime = new Date(currentDateISO).setHours(0,0,0,0);
    
    var logs = fleetState.logs || [];
    var bestTime = 0;
    var bestValue = 0;

    // Prejdeme všetky záznamy v aktuálnom mesiaci
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      if (!log.log_date) continue;

      // Prevedieme dátum záznamu na číslo
      var logTime = new Date(log.log_date).setHours(0,0,0,0);

      // Podmienka 1: Záznam musí byť v minulosti (logTime < targetTime)
      // Podmienka 2: Musí byť novší než to, čo sme zatiaľ našli (logTime > bestTime)
      if (logTime < targetTime && logTime >= bestTime) {
        var val = Number(log.end_odometer);
        if (!isNaN(val) && val > 0) {
          bestTime = logTime;
          bestValue = val;
        }
      }
    }

    // Ak sme našli hodnotu v tomto mesiaci, vrátime ju
    if (bestValue > 0) {
      return bestValue;
    }

    // Ak nie, vrátime počiatočný stav z konca minulého mesiaca (z backendu)
    var lastMonth = Number(fleetState.last_odometer || 0);
    return lastMonth > 0 ? lastMonth : '';

  } catch (e) {
    console.error("Chyba v _getPrevEndOdometer:", e);
    return '';
  }
}
// po uložení dňa nastav začiatočný stav nasledujúceho dňa na práve zadaný koncový (iba v rovnakom mesiaci)
function _applyEndToNextStart(dateISO, endVal){
  const d = new Date(dateISO);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1);
  if (next.getMonth() !== d.getMonth() || next.getFullYear() !== d.getFullYear()) return;
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth()+1).padStart(2,'0');
  const dd = String(next.getDate()).padStart(2,'0');
  const nextISO = `${yyyy}-${mm}-${dd}`;
  _upsertLogByDate(nextISO, { start_odometer: Number(endVal) });
}

// lokálny upsert do fleetState.logs (aby sa UI hneď prepočítalo)
function _upsertLogByDate(dateISO, patch){
  const logs = Array.isArray(fleetState.logs) ? fleetState.logs : (fleetState.logs = []);
  const d = new Date(dateISO);
  const idx = logs.findIndex(l=>{
    const ld=new Date(l.log_date);
    return ld.getFullYear()===d.getFullYear() && ld.getMonth()===d.getMonth() && ld.getDate()===d.getDate();
  });
  if (idx === -1){
    logs.push(Object.assign({log_date: dateISO}, patch));
  } else {
    logs[idx] = Object.assign({}, logs[idx], patch);
  }
}

function renderLogbookTable(logs, year, month, lastOdometer) {
  const container = document.getElementById('fleet-logbook-container');
  const daysInMonth = new Date(year, month, 0).getDate();

  // Zoskupíme logy podľa dňa v mesiaci
  const logsByDay = {};
  (logs || []).forEach(l => {
    const d = new Date(l.log_date).getDate();
    if (!logsByDay[d]) logsByDay[d] = [];
    logsByDay[d].push(l);
  });

  let html = '<div class="table-container"><table><thead><tr>'
    + '<th style="width:90px">Dátum</th>'
    + '<th>Čas</th>'
    + '<th>Trasa (Odkiaľ &rarr; Kam)</th>'
    + '<th>Účel jazdy</th>'
    + '<th>Šofér</th>'
    + '<th>Tachometer</th>'
    + '<th>KM</th>'
    + '<th style="width:90px">Akcia</th>'
    + '</tr></thead><tbody>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateSK  = `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`;
    const dateISO = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayLogs = logsByDay[day] || [];

    if (dayLogs.length === 0) {
        // Prázdny deň - riadok na pridanie prvej jazdy
        html += `<tr style="background:#fafafa; color:#999; font-size:0.9em;">
            <td>${dateSK}</td>
            <td colspan="6" style="text-align:center;"><i>Žiadna jazda</i></td>
            <td><button class="btn btn-success btn-xs" onclick="openEditLogModal('${dateISO}', null)">+ Jazda</button></td>
        </tr>`;
    } else {
        // Existujúce jazdy
        dayLogs.forEach((log, index) => {
            const timeStr = (log.time_start ? log.time_start.substr(0,5) : '') + ' - ' + (log.time_end ? log.time_end.substr(0,5) : '');
            const routeStr = (log.location_start || '') + ' &rarr; ' + (log.location_end || '');
            const odoStr = (log.start_odometer || '?') + ' - ' + (log.end_odometer || '?');
            
            // Dátum a tlačidlo "+" zobrazíme len v prvom riadku dňa
            let dateCell = '';
            if (index === 0) {
                dateCell = `<td rowspan="${dayLogs.length}" style="vertical-align:top; background:#fff; border-right:1px solid #eee;">
                    <strong>${dateSK}</strong><br>
                    <button class="btn btn-success btn-xs" style="margin-top:5px" title="Pridať ďalšiu jazdu" onclick="openEditLogModal('${dateISO}', null)">+</button>
                </td>`;
            }

            html += `<tr>`;
            if (index === 0) html += dateCell;
            
            html += `
              <td>${timeStr}</td>
              <td>${routeStr}</td>
              <td>${escapeHtml(log.purpose || '')}</td>
              <td>${escapeHtml(log.driver || '')}</td>
              <td>${odoStr}</td>
              <td><strong>${log.km_driven}</strong></td>
              <td>
                <button class="btn btn-secondary btn-xs" onclick='openEditLogModal("${dateISO}", ${JSON.stringify(log)})'><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-xs" onclick="handleDeleteTripLog(${log.id})"><i class="fas fa-trash"></i></button>
              </td>
            </tr>`;
        });
    }
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;


  const oldSave = document.getElementById('save-logbook-changes-btn');
  if (oldSave) oldSave.style.display = 'none';

  // edit / delete handlers
  container.querySelectorAll('button[data-edit-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateISO = btn.dataset.date;
      const d       = new Date(dateISO);
      const y       = d.getFullYear(), m = d.getMonth()+1, day = d.getDate();
      const log     = (fleetState.logs||[]).find(l=>{
        const ld = new Date(l.log_date);
        return ld.getFullYear()===y && (ld.getMonth()+1)===m && ld.getDate()===day;
      }) || {};
      openEditLogModal(dateISO, log);
    });
  });

  container.querySelectorAll('button[data-del-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateISO = btn.dataset.date;
      handleDeleteDayLogs(dateISO);
    });
  });
}

// --- 1. Oprava modálu pre Jazdu (načíta správneho šoféra) ---
function openEditLogModal(dateISO, existing) {
  existing = existing || {};
  var currentVehicleId = fleetState.selected_vehicle_id;
  var isEdit = !!existing.id; 
  
  // Default šofér
  var defaultDriver = '';
  if (fleetState.vehicles && currentVehicleId) {
      var v = fleetState.vehicles.find(function(x) { return String(x.id) === String(currentVehicleId); });
      if (v) defaultDriver = v.default_driver || '';
  }
  var driverValue = (existing.driver && existing.driver.trim() !== '') ? existing.driver : defaultDriver;

  // --- DEFAULTNÉ HODNOTY PRE MIK ---
  var defaultStartLoc = "MIK, s.r.o , Šaľa, 92705, ul. Hollého 1999/13";
  var defaultPurpose = "Rozvoz tovaru po zákazníkoch";

  showModal((isEdit ? 'Upraviť' : 'Nová') + ' jazda – ' + dateISO.split('-').reverse().join('.'), function () {
    var html = ''
      + '<form id="log-modal-form">'
      +   '<input type="hidden" name="vehicle_id" value="'+(currentVehicleId||'')+'"/>'
      +   '<input type="hidden" name="log_date" value="'+dateISO+'"/>'
      +   '<input type="hidden" name="id" value="'+(existing.id || '')+'"/>'
      
      +   '<div class="form-grid">'
            // ČASY
      +     '<div class="form-group"><label>Čas od</label><input type="time" name="time_start" value="'+(existing.time_start||'')+'"/></div>'
      +     '<div class="form-group"><label>Čas do</label><input type="time" name="time_end" value="'+(existing.time_end||'')+'"/></div>'
      
            // MIESTA (S DEFAULT HODNOTAMI)
      +     '<div class="form-group"><label>Odkiaľ (Miesto)</label><input type="text" name="location_start" value="'+(existing.location_start || defaultStartLoc)+'" placeholder="Napr. Sídlo firmy"/></div>'
      +     '<div class="form-group"><label>Kam / Smer</label><input type="text" name="location_end" value="'+(existing.location_end||'')+'" placeholder="Napr. Okruh Bratislava"/></div>'
      
            // ÚČEL (S DEFAULT HODNOTOU)
      +     '<div class="form-group" style="grid-column:1/-1"><label>Účel jazdy</label><input type="text" name="purpose" value="'+(existing.purpose || defaultPurpose)+'" placeholder="Napr. Rozvoz tovaru"/></div>'

            // TACHOMETER
      +     '<div class="form-group"><label>Stav tach. (zač.)</label><input id="start-odo" type="number" name="start_odometer" step="1" value="'+(existing.start_odometer||'')+'"/></div>'
      +     '<div class="form-group"><label>Stav tach. (kon.)</label><input id="end-odo" type="number" name="end_odometer" step="1" value="'+(existing.end_odometer||'')+'"/></div>'
      
      +     '<div class="form-group"><label>Šofér</label><input type="text" name="driver" value="'+escapeHtml(driverValue)+'"/></div>'
      
            // TOVAR
      +     '<div class="form-group"><label>Vývoz (kg)</label><input type="number" name="goods_out_kg" step="0.1" value="'+(existing.goods_out_kg||'')+'"/></div>'
      +     '<div class="form-group"><label>DL (ks)</label><input type="number" name="delivery_notes_count" step="1" value="'+(existing.delivery_notes_count||'')+'"/></div>'
      +   '</div>'

      +   '<div style="display:flex; gap:.5rem; margin-top:1rem;">'
      +     '<button type="submit" class="btn btn-success">Uložiť jazdu</button>'
      +   '</div>'
      + '</form>';
    
    return {
      html: html,
      onReady: function () { 
        var form = document.getElementById('log-modal-form');
        var startInput = document.getElementById('start-odo');

        // Auto-fetch posledného stavu tachometra
        if (!isEdit && (!startInput.value || startInput.value == 0)) {
            apiRequest('/api/kancelaria/fleet/getPrevOdo', {
                method: 'POST', body: { vehicle_id: currentVehicleId, date: dateISO }
            }).then(function(res) {
                if (res && res.value) startInput.value = res.value;
            }).catch(function(e) {
                console.error(e);
            });
        }

        form.onsubmit = function(e){
          e.preventDefault();
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());
          
          let s = data.start_odometer ? Number(data.start_odometer) : null;
          let e_odo = data.end_odometer ? Number(data.end_odometer) : null;
          if (s!=null && e_odo!=null && e_odo < s) { alert('Konečný stav tachometra je menší ako začiatočný!'); return; }
          data.km_driven = (s!=null && e_odo!=null) ? (e_odo - s) : 0;

          apiRequest('/api/kancelaria/fleet/saveLog', { method: 'POST', body: { logs: [data] } })
            .then(function() {
                document.getElementById('modal-container').style.display = 'none';
                loadAndRenderFleetData(); 
            })
            .catch(function(err) {
                alert(err.message);
            });
        }
      }
    };
  });
}

  
// =================== TANKOVANIE ===================
function renderRefuelingTable(refuelings) {
  const container = document.getElementById('fleet-refueling-container');
  if (!refuelings || refuelings.length === 0) {
    container.innerHTML = '<p>Pre tento mesiac neboli nájdené žiadne záznamy o tankovaní.</p>';
    return;
  }
  var table = '<div class="table-container"><table><thead><tr>'
    + '<th>Dátum</th><th>Šofér</th><th>Typ</th><th>Litre</th><th>Cena/L (€)</th><th>Cena celkom (€)</th><th>Akcie</th>'
    + '</tr></thead><tbody>';
  refuelings.forEach(function(r){
    table += '<tr>'
      + '<td>' + new Date(r.refueling_date).toLocaleDateString('sk-SK') + '</td>'
      + '<td>' + escapeHtml(r.driver || '') + '</td>'
      + '<td>' + (r.fuel_type ? (String(r.fuel_type).toUpperCase()==='ADBLUE'?'AdBlue':'Nafta') : 'Nafta') + '</td>'
      + '<td>' + r.liters + '</td>'
      + '<td>' + (r.price_per_liter ? safeToFixed(r.price_per_liter, 3) : '') + '</td>'
      + '<td>' + (r.total_price ? safeToFixed(r.total_price) : '') + '</td>'
      + '<td><button class="btn btn-danger btn-xs" style="margin:0; padding:5px;" onclick="handleDeleteRefueling(' + r.id + ')"><i class="fas fa-trash"></i></button></td>'
      + '</tr>';
  });
  table += '</tbody></table></div>';
  container.innerHTML = table;
}

function handleDeleteRefueling(refuelingId) {
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Potvrdenie vymazania',
      message: 'Naozaj chcete vymazať tento záznam o tankovaní?',
      onConfirm: async function () {
        try {
          await apiRequest('/api/kancelaria/fleet/deleteRefueling', { method: 'POST', body: { id: refuelingId } });
          loadAndRenderFleetData();
        } catch (e) {}
      }
    });
  } else {
    if (window.confirm('Naozaj chcete vymazať tento záznam o tankovaní?')) {
      (async function(){
        try {
          await apiRequest('/api/kancelaria/fleet/deleteRefueling', { method: 'POST', body: { id: refuelingId } });
          loadAndRenderFleetData();
        } catch (e) {}
      })();
    }
  }
}

// --- 2. Oprava modálu pre Tankovanie (načíta správneho šoféra) ---
function openAddRefuelingModal(vehicleId) {
  if (!vehicleId) { showStatus("Vyberte vozidlo.", true); return; }
  var defaultDriver = '';
  if (fleetState.vehicles) {
      var v = fleetState.vehicles.find(x => String(x.id) === String(vehicleId));
      if (v) defaultDriver = v.default_driver || '';
  }

  showModal('Pridať tankovanie', function () {
    return {
      html: document.getElementById('refueling-modal-template').innerHTML,
      onReady: function () {
        var form = document.getElementById('refueling-form');
        form.elements.vehicle_id.value = vehicleId;
        form.elements.refueling_date.valueAsDate = new Date();
        form.elements.driver.value = defaultDriver; // Tu sa nastaví správny šofér
        
        form.onsubmit = async function (e) {
          e.preventDefault();
          try {
            await apiRequest('/api/kancelaria/fleet/saveRefueling', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
            document.getElementById('modal-container').style.display = 'none';
            loadAndRenderFleetData();
          } catch (err) {}
        };
      }
    };
  });
}

// =================== NÁKLADY ===================
async function loadAndRenderFleetCosts() {
  const container = document.getElementById('fleet-costs-container');
  const sel = _syncVehicleFromUI();
  if (!sel) { container.innerHTML = '<p>Najprv vyberte vozidlo.</p>'; return; }
  container.innerHTML = '<p>Načítavam náklady...</p>';
  try {
    const costs = await apiRequest('/api/kancelaria/fleet/getCosts?vehicle_id=' + sel);
    fleetState.costs = costs;
    if (!costs || costs.length === 0) { container.innerHTML = '<p>Pre toto vozidlo neboli nájdené žiadne náklady.</p>'; return; }
    var table = '<div class="table-container"><table><thead><tr>'
      + '<th>Názov</th><th>Typ</th><th>Platnosť</th><th>Spôsob</th><th>Mesačná suma (€)</th><th>Akcie</th>'
      + '</tr></thead><tbody>';
    costs.forEach(function(c){
      var validity = c.valid_to ? (new Date(c.valid_from).toLocaleDateString('sk-SK') + ' - ' + new Date(c.valid_to).toLocaleDateString('sk-SK')) :
                                  ('od ' + new Date(c.valid_from).toLocaleDateString('sk-SK'));
      var mode = (c.cost_mode || 'monthly');
      var modeTxt = (mode==='amortized'
          ? ('Rozrátať (' + (c.amortize_months ? c.amortize_months+' m.' : (c.valid_to?'podľa obdobia':'?')) + ')'
             + (c.total_amount? ' / celkom '+Number(c.total_amount).toFixed(2)+' €' : ''))
          : 'Mesačne');
      table += '<tr>'
        + '<td>'+escapeHtml(c.cost_name)+'</td>'
        + '<td>'+escapeHtml(c.cost_type)+'</td>'
        + '<td>'+validity+'</td>'
        + '<td>'+escapeHtml(modeTxt)+'</td>'
        + '<td>'+safeToFixed(c.monthly_cost)+'</td>'
        + '<td>'
        +   '<button class="btn btn-warning btn-xs" style="margin:0; padding:5px;" onclick="openAddEditCostModal('+c.id+')"><i class="fas fa-edit"></i></button> '
        +   '<button class="btn btn-danger  btn-xs" style="margin:0; padding:5px;" onclick="handleDeleteCost('+c.id+')"><i class="fas fa-trash"></i></button>'
        + '</td>'
        + '</tr>';
    });
    container.innerHTML = table + '</tbody></table></div>';
  } catch (e) {
    container.innerHTML = '<p class="error">Chyba pri načítaní nákladov: ' + (e.message || '') + '</p>';
  }
}

function openAddEditCostModal(cost) {
  var selected_vehicle_id = _syncVehicleFromUI();
  if (typeof cost === 'number') {
    cost = (fleetState.costs || []).find(function(c){ return c.id === cost; }) || null;
  }
  if (!selected_vehicle_id && !(cost && cost.vehicle_id)) {
    showStatus("Najprv vyberte vozidlo, ku ktorému chcete pridať náklad.", true);
    return;
  }

  showModal(cost ? 'Upraviť náklad' : 'Pridať nový náklad', function () {
    var mode = (cost && cost.cost_mode) || 'onetime'; // Defaultne jednorazový (častejší)
    var totalAmt = (cost && cost.total_amount) != null ? Number(cost.total_amount) : '';
    var monthsMeta = (cost && cost.amortize_months) != null ? Number(cost.amortize_months) : '';

    var html = ''
      + '<form id="cost-form">'
      + '<input type="hidden" name="id" value="'+(cost && cost.id || '')+'">'
      + '<input type="hidden" name="vehicle_id" value="'+(cost && cost.vehicle_id || selected_vehicle_id)+'">'

      + '<div class="form-group"><label>Názov nákladu (napr. Servis bŕzd, PZP)</label>'
      +   '<input type="text" name="cost_name" value="'+(cost && (cost.cost_name || '') || '')+'" required></div>'

      + '<div class="form-group"><label>Typ nákladu</label><select name="cost_type" required>'
      +   '<option value="SERVIS"'+(cost && cost.cost_type==='SERVIS'?' selected':'')+'>SERVIS / OPRAVY</option>'
      +   '<option value="PNEUMATIKY"'+(cost && cost.cost_type==='PNEUMATIKY'?' selected':'')+'>PNEUMATIKY</option>'
      +   '<option value="SKODA"'+(cost && cost.cost_type==='SKODA'?' selected':'')+'>ŠKODOVÁ UDALOSŤ</option>'
      +   '<option value="POISTENIE"'+(cost && cost.cost_type==='POISTENIE'?' selected':'')+'>POISTENIE</option>'
      +   '<option value="DIALNICNA"'+(cost && cost.cost_type==='DIALNICNA'?' selected':'')+'>DIAĽNIČNÁ ZNÁMKA / DAŇ</option>'
      +   '<option value="MZDA"'+(cost && cost.cost_type==='MZDA'?' selected':'')+'>MZDA VODIČA</option>'
      +   '<option value="INE"'+(cost && cost.cost_type==='INE'?' selected':'')+'>INÉ</option>'
      + '</select></div>'

      // VÝBER REŽIMU
      + '<div class="form-group"><label>Spôsob účtovania</label>'
      +   '<select name="cost_mode" id="cost-mode" style="font-weight:bold;">'
      +     '<option value="onetime" '+(mode==='onetime'?'selected':'')+'>🔴 Jednorazový (napr. Servis, Umyvárka)</option>'
      +     '<option value="amortized" '+(mode==='amortized'?'selected':'')+'>🔵 Rozrátať (napr. Poistka, Diaľničná)</option>'
      +     '<option value="monthly" '+(mode==='monthly'?'selected':'')+'>🔄 Mesačný paušál (napr. Leasing)</option>'
      +   '</select>'
      + '</div>'

      // 1. JEDNORAZOVÝ & AMORTIZOVANÝ (Zdieľajú input pre celkovú sumu)
      + '<div id="total-amount-box">'
      +   '<div class="form-group"><label id="total-amount-label">Suma (€)</label>'
      +     '<input type="number" step="0.01" name="total_amount" id="total-amount-input" value="'+(totalAmt!==''?totalAmt:'')+'"></div>'
      + '</div>'

      // 2. MESAČNÝ PAUŠÁL
      + '<div class="form-group" id="monthly-cost-row" style="display:none;"><label>Mesačná suma (€)</label>'
      +   '<input type="number" step="0.01" name="monthly_cost" value="'+(cost && cost.monthly_cost || '')+'"></div>'

      // AMORTIZÁCIA - NASTAVENIA
      + '<div id="amortized-box" style="display:none; background:#f8f9fa; padding:10px; border-radius:5px; margin-bottom:15px;">'
      +   '<div class="form-group" style="display:flex; gap:.75rem; align-items:center;">'
      +     '<label style="margin:0;"><input type="checkbox" id="amortize-use-period" checked> Rozrátať podľa dátumov (Od - Do)</label>'
      +   '</div>'
      +   '<div class="form-group" id="manual-months-box" style="display:none;"><label>Alebo zadaj počet mesiacov</label>'
      +     '<input type="number" step="1" min="1" name="amortize_months" id="amortize-months-input" value="'+(monthsMeta!==''?monthsMeta:'')+'" placeholder="napr. 12"></div>'
      +   '<div class="form-group muted" id="amortized-preview" style="font-size:.9rem; color:#0d6efd;"></div>'
      + '</div>'

      + '<div class="form-grid">'
      +   '<div class="form-group"><label id="valid-from-label">Dátum (Kedy vznikol)</label>'
      +     '<input type="date" name="valid_from" id="valid-from" value="'+(cost ? new Date(cost.valid_from).toISOString().split('T')[0] : '')+'" required></div>'
      +   '<div class="form-group" id="valid-to-box"><label>Platné do</label>'
      +     '<input type="date" name="valid_to" id="valid-to" value="'+(cost && cost.valid_to ? new Date(cost.valid_to).toISOString().split('T')[0] : '')+'"></div>'
      + '</div>'

      + '<div class="form-group" style="display:flex; align-items:center; gap:10px;">'
      +   '<input type="checkbox" id="is-vehicle-specific-checkbox" name="is_vehicle_specific" '+(cost && cost.vehicle_id ? 'checked' : (cost==null ? 'checked' : ''))+' style="width:auto; margin-top:0;">'
      +   '<label for="is-vehicle-specific-checkbox" style="margin:0;">Náklad sa viaže na toto konkrétne vozidlo</label>'
      + '</div>'

      + '<button type="submit" class="btn btn-success" style="width:100%;">'+(cost ? 'Uložiť zmeny' : 'Vytvoriť náklad')+'</button>'
      + '</form>';

    return {
      html: html,
      onReady: function () {
        var form  = document.getElementById('cost-form');
        if (!cost) form.elements.valid_from.valueAsDate = new Date();
        document.getElementById('is-vehicle-specific-checkbox').onchange = function (e) {
          form.elements.vehicle_id.value = e.target.checked ? selected_vehicle_id : '';
        };

        // Elementy
        var modeSel   = form.querySelector('#cost-mode');
        var totalBox  = form.querySelector('#total-amount-box');
        var monthlyBox= form.querySelector('#monthly-cost-row');
        var amortBox  = form.querySelector('#amortized-box');
        var validToBox= form.querySelector('#valid-to-box');
        var lblAmount = form.querySelector('#total-amount-label');
        var lblDate   = form.querySelector('#valid-from-label');
        
        var totalIn   = form.querySelector('#total-amount-input');
        var monthsIn  = form.querySelector('#amortize-months-input');
        var usePeriod = form.querySelector('#amortize-use-period');
        var manualMths= form.querySelector('#manual-months-box');
        var vf        = form.querySelector('#valid-from');
        var vt        = form.querySelector('#valid-to');
        var prevEl    = form.querySelector('#amortized-preview');

        function updateUI() {
            var m = modeSel.value;
            
            if (m === 'onetime') {
                totalBox.style.display = 'block';
                monthlyBox.style.display = 'none';
                amortBox.style.display = 'none';
                validToBox.style.display = 'none'; // Pri jednorazovom nepotrebujeme "do"
                lblAmount.textContent = 'Celková suma (€)';
                lblDate.textContent = 'Dátum nákladu';
            } else if (m === 'amortized') {
                totalBox.style.display = 'block';
                monthlyBox.style.display = 'none';
                amortBox.style.display = 'block';
                validToBox.style.display = 'block';
                lblAmount.textContent = 'Celková suma na rozrátanie (€)';
                lblDate.textContent = 'Platné od';
            } else { // monthly
                totalBox.style.display = 'none';
                monthlyBox.style.display = 'block';
                amortBox.style.display = 'none';
                validToBox.style.display = 'block';
                lblDate.textContent = 'Platné od';
            }
            recomputePreview();
        }

        function recomputePreview(){
          if (modeSel.value !== 'amortized'){ prevEl.textContent=''; return; }
          
          // Show/Hide manual months input
          if (usePeriod.checked) { manualMths.style.display = 'none'; vt.required = true; }
          else { manualMths.style.display = 'block'; vt.required = false; }

          var total = parseFloat(totalIn.value||'0');
          if (!isFinite(total) || total<=0){ prevEl.textContent='Zadaj sumu.'; return; }
          
          var mths = null;
          if (usePeriod.checked && vf.value && vt.value){
             // Vypočítame rozdiel mesiacov
             var d1 = new Date(vf.value);
             var d2 = new Date(vt.value);
             mths = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
          } else if (!usePeriod.checked) {
             mths = parseInt(monthsIn.value);
          }

          if (mths && mths > 0) {
              var per = total / mths;
              prevEl.innerHTML = `Rozráta sa na <b>${mths}</b> mesiacov.<br>Mesačný náklad: <b>${per.toFixed(2)} €</b>`;
          } else {
              prevEl.textContent = 'Vyberte dátumy alebo zadajte počet mesiacov.';
          }
        }

        modeSel.addEventListener('change', updateUI);
        usePeriod.addEventListener('change', updateUI); // prekreslí inputs
        [totalIn, monthsIn, vf, vt].forEach(el => el.addEventListener('input', recomputePreview));
        
        // Init state
        updateUI();

        form.onsubmit = async function (e) {
          e.preventDefault();
          const fd = new FormData(form);
          var data = Object.fromEntries(fd.entries());
          data.is_vehicle_specific = document.getElementById('is-vehicle-specific-checkbox').checked;
          // Checkbox fix
          data.amortize_use_period = usePeriod.checked ? '1' : '0';

          try {
            await apiRequest('/api/kancelaria/fleet/saveCost', { method: 'POST', body: data });
            document.getElementById('modal-container').style.display = 'none';
            loadAndRenderFleetCosts();
            loadAndRenderFleetAnalysis(); // Prepočítať aj analýzu
          } catch (err) { alert(err.message); }
        };
      }
    };
  });
}

function handleDeleteCost(costId) {
  var cost = (fleetState.costs || []).find(function(c){ return c.id === costId; });
  if (!cost) return;
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Potvrdenie vymazania',
      message: 'Naozaj chcete natrvalo vymazať náklad "' + cost.cost_name + '"?',
      warning: 'Táto akcia je nezvratná!',
      onConfirm: async function () {
        try {
          await apiRequest('/api/kancelaria/fleet/deleteCost', { method: 'POST', body: { id: costId } });
        } catch (e) {}
        loadAndRenderFleetCosts();
        loadAndRenderFleetAnalysis();
      }
    });
  } else {
    if (window.confirm('Naozaj chcete natrvalo vymazať náklad "' + cost.cost_name + '"?')) {
      (async function(){
        try {
          await apiRequest('/api/kancelaria/fleet/deleteCost', { method: 'POST', body: { id: costId } });
        } catch (e) {}
        loadAndRenderFleetCosts();
        loadAndRenderFleetAnalysis();
      })();
    }
  }
}

// =================== VOZIDLÁ: Nové / Upraviť ===================
function openAddEditVehicleModal(vehicleId) {
  showModal(vehicleId ? 'Upraviť vozidlo' : 'Pridať nové vozidlo', function () {
    // Načítame HTML z templatu (ktorý už musí obsahovať input pre VIN)
    var html = document.getElementById('vehicle-modal-template').innerHTML;
    
    return {
      html: html,
      onReady: function () {
        var form = document.getElementById('vehicle-form');

        // Ak editujeme existujúce vozidlo, naplníme formulár
        if (vehicleId) {
          var v = (fleetState.vehicles || []).find(function(x) { 
            return String(x.id) === String(vehicleId); 
          });

          if (v) {
            form.elements.id.value = v.id;
            form.elements.license_plate.value = v.license_plate || '';
            
            // --- NOVÉ PRE ZÁKON 2026: Naplnenie VIN ---
            if (form.elements.vin) {
                form.elements.vin.value = v.vin || ''; 
            }
            // ------------------------------------------

            form.elements.name.value = v.name || '';
            form.elements.type.value = v.type || '';
            form.elements.default_driver.value = v.default_driver || '';
            form.elements.initial_odometer.value = v.initial_odometer || '';
          }
        }

        // Odoslanie formulára
        form.onsubmit = async function (e) {
          e.preventDefault();
          
          // Získanie dát z formulára
          const fd = new FormData(form);
          const data = Object.fromEntries(fd.entries());

          try {
            // Vizuálna odozva - disable tlačidla
            const btn = form.querySelector('button[type="submit"]');
            if(btn) {
                btn.disabled = true;
                btn.textContent = 'Ukladám...';
            }

            // Odoslanie na server
            await apiRequest('/api/kancelaria/fleet/saveVehicle', { method: 'POST', body: data });
            
            // Zatvorenie modálu a reload dát
            document.getElementById('modal-container').style.display = 'none';
            loadAndRenderFleetData(true);
            
          } catch (err) { 
            console.error(err);
            alert('Chyba pri ukladaní vozidla: ' + (err.message || 'Neznáma chyba'));
            
            // Vrátenie tlačidla do pôvodného stavu
            const btn = form.querySelector('button[type="submit"]');
            if(btn) {
                btn.disabled = false;
                btn.textContent = 'Uložiť vozidlo';
            }
          }
        };
      }
    };
  });
}
// =================== REPORT: tlač ===================
function handlePrintFleetReport() {
  var vSel = document.getElementById('fleet-vehicle-select');
  var ySel = document.getElementById('fleet-year-select');
  var mSel = document.getElementById('fleet-month-select');
  var vehicle_id = vSel && vSel.value ? vSel.value : (fleetState.selected_vehicle_id || '');
  var year = _num(ySel && ySel.value, _todayY());
  var month = _num(mSel && mSel.value, _todayM());
  if (!vehicle_id){ showStatus("Najprv vyberte vozidlo.", true); return; }
  var sel = document.getElementById('fleet-report-type');
  var rtype = (sel && sel.value) ? sel.value : 'all';
  window.open('/report/fleet?vehicle_id='+vehicle_id+'&year='+year+'&month='+month+'&type='+rtype, '_blank');
}

// =================== ANALÝZA (KPI + tabuľka) ===================
async function loadAndRenderFleetAnalysis() {
  const container = document.getElementById('fleet-analysis-container');
  _syncVehicleFromUI();
  _syncPeriodFromUI();

  const selected_vehicle_id = fleetState.selected_vehicle_id;
  const selected_year  = fleetState.selected_year  || _todayY();
  const selected_month = fleetState.selected_month || _todayM();
  
  if (!selected_vehicle_id) { 
      container.innerHTML = '<p>Najprv vyberte vozidlo pre zobrazenie analýzy.</p>'; 
      return; 
  }
  
  container.innerHTML = '<p>Načítavam analýzu...</p>';
  
  try {
    const analysis = await apiRequest('/api/kancelaria/fleet/getAnalysis?vehicle_id='+selected_vehicle_id+'&year='+selected_year+'&month='+selected_month);
    const monthData = await apiRequest('/api/kancelaria/fleet/getData?vehicle_id='+selected_vehicle_id+'&year='+selected_year+'&month='+selected_month);
    
    // Dáta pre tabuľku
    const logs = monthData.logs || [];
    const refuelings = monthData.refuelings || [];
    
    // Výpočty súčtov z knihy jázd
    const sum = function(arr, sel){ return (arr || []).reduce(function(a,b){ return a + (Number(b[sel] || 0) || 0); }, 0); };
    const deliveryNotes = sum(logs, 'delivery_notes_count');
    const goodsOut      = sum(logs, 'goods_out_kg');
    const goodsIn       = sum(logs, 'goods_in_kg');

    // Počet dní s aktivitou
    const daysWithDrive = logs.filter(function(l){
      return (Number(l.km_driven || 0) > 0) || (Number(l.goods_out_kg || 0) > 0) || (Number(l.delivery_notes_count || 0) > 0);
    }).length;

    // Hodnoty z backend analýzy (už rozdelené naftu a adblue)
    const totalKm    = Number(analysis.total_km || 0);
    const totalCosts = Number(analysis.total_costs || 0);
    const cpk        = Number(analysis.cost_per_km || 0);
    
    // Nafta
    const dieselCons = Number(analysis.avg_consumption || 0); 
    // Vypočítame litre nafty z backendu alebo zo zoznamu, pre istotu z refuelings pre zobrazenie
    const dieselLiters = (refuelings||[]).reduce((a,b) => {
        if (!b.fuel_type || b.fuel_type === 'DIESEL') return a + (Number(b.liters)||0);
        return a;
    }, 0);
    const dieselCost = (refuelings||[]).reduce((a,b) => {
        if (!b.fuel_type || b.fuel_type === 'DIESEL') return a + (Number(b.total_price)||0);
        return a;
    }, 0);
    const dieselPricePerL = dieselLiters > 0 ? (dieselCost / dieselLiters) : 0;

    // AdBlue
    const adblueCons   = Number(analysis.adblue_per_100km || 0);
    const adblueLiters = Number(analysis.total_adblue_liters || 0);
    const adblueCost   = Number(analysis.total_adblue_cost || 0);
    const adbluePricePerL = adblueLiters > 0 ? (adblueCost / adblueLiters) : 0;

    // Pomocné prepočty
    const kmPerDay   = daysWithDrive ? (totalKm / daysWithDrive) : 0;
    const fuelPerKm  = totalKm ? ((dieselCost + adblueCost) / totalKm) : 0;

    // Vykreslenie HTML - PRESNE PODĽA TVOJHO KÓDU
    container.innerHTML = ''
      + '<div class="analysis-card">'
      + '  <div class="kpi-badges">'
      + '    <span class="kpi-badge">Najazdené: <strong>'+totalKm.toFixed(0)+' km</strong></span>'
      + '    <span class="kpi-badge">Nafta: <strong>'+dieselCons.toFixed(2)+' L/100km</strong></span>'
      + '    <span class="kpi-badge" style="background:#eefbff; color:#0056b3;">AdBlue: <strong>'+adblueCons.toFixed(2)+' L/100km</strong></span>'
      + '    <span class="kpi-badge">Cena/km: <strong>'+cpk.toFixed(3)+' €</strong></span>'
      + '    <span class="kpi-badge">Náklady: <strong>'+totalCosts.toFixed(2)+' €</strong></span>'
      + '  </div>'
      + '  <table class="analysis-table">'
      + '    <thead><tr><th>Metrika</th><th>Hodnota</th><th>Poznámka</th></tr></thead>'
      + '    <tbody>'
      + '      <tr><td>Počet dní s jazdou</td><td>'+daysWithDrive+'</td><td></td></tr>'
      + '      <tr><td>KM na deň (priemer)</td><td>'+kmPerDay.toFixed(1)+' km</td><td>len dni s jazdou</td></tr>'
      + '      <tr><td>Vývoz tovaru</td><td>'+goodsOut.toFixed(1)+' kg</td><td></td></tr>'
      + '      <tr style="border-top:2px solid #eee;"><td><strong>Spotreba NAFTA</strong></td><td><strong>'+dieselCons.toFixed(2)+' L/100km</strong></td><td></td></tr>'
      + '      <tr><td>Natankovaná Nafta</td><td>'+dieselLiters.toFixed(1)+' L</td><td>'+dieselCost.toFixed(2)+' €</td></tr>'
      + '      <tr><td>Ø cena Nafty</td><td>'+dieselPricePerL.toFixed(3)+' €/L</td><td></td></tr>'
      + '      <tr style="background:#f4fcff; border-top:2px solid #eee;"><td><strong>Spotreba ADBLUE</strong></td><td><strong>'+adblueCons.toFixed(2)+' L/100km</strong></td><td></td></tr>'
      + '      <tr style="background:#f4fcff;"><td>Natankované AdBlue</td><td>'+adblueLiters.toFixed(1)+' L</td><td>'+adblueCost.toFixed(2)+' €</td></tr>'
      + '      <tr style="background:#f4fcff;"><td>Ø cena AdBlue</td><td>'+adbluePricePerL.toFixed(3)+' €/L</td><td></td></tr>'
      + '      <tr style="border-top:2px solid #ccc;"><td><strong>Náklady spolu</strong></td><td><strong>'+totalCosts.toFixed(2)+' €</strong></td><td>fixné + variabilné + palivo</td></tr>'
      + '      <tr><td>Cena za 1 km</td><td>'+cpk.toFixed(3)+' €</td><td>kompletné náklady / km</td></tr>'
      + '      <tr><td>Cena paliva na 1 km</td><td>'+fuelPerKm.toFixed(3)+' €</td><td>nafta + adblue</td></tr>'
      + '    </tbody>'
      + '  </table>'
      + '</div>';
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="error">Chyba pri načítaní analýzy: ' + (e.message || '') + '</p>';
  }
}

// Spoľahlivo vráti zoznam vozidiel (fleetState -> DOM -> API)
async function _getVehiclesList() {
  try {
    // 1) Najprv globálny stav
    if (window.fleetState && Array.isArray(window.fleetState.vehicles) && window.fleetState.vehicles.length) {
      return window.fleetState.vehicles;
    }

    // 2) Fallback: z DOM selectu (ak už je naplnený)
    const sel = document.getElementById('fleet-vehicle-select');
    if (sel && sel.options && sel.options.length) {
      const list = Array.from(sel.options)
        .filter(o => o && o.value)
        .map(o => {
          const text = (o.textContent || '').trim();
          // text je typicky "Názov (ŠPZ)"
          let name = text, plate = '';
          const m = text.match(/^(.*)\(([^)]+)\)\s*$/);
          if (m) {
            name = (m[1] || '').trim();
            plate = (m[2] || '').trim();
          }
          return { id: o.value, name, license_plate: plate };
        });

      if (list.length) return list;
    }

    // 3) Fallback: dotiahni z API (GET – toto je správny spôsob v tvojom module)
    const period = (typeof _syncPeriodFromUI === 'function') ? _syncPeriodFromUI() : { year: _todayY(), month: _todayM() };
    const year = period.year || _todayY();
    const month = period.month || _todayM();

    // vehicle_id môže byť prázdne – backend si zvolí default; cieľ je dostať vehicles[]
    const vehicleId = (window.fleetState && window.fleetState.selected_vehicle_id) || (sel && sel.value) || '';

    const url =
      '/api/kancelaria/fleet/getData'
      + '?vehicle_id=' + encodeURIComponent(vehicleId || '')
      + '&year=' + encodeURIComponent(year)
      + '&month=' + encodeURIComponent(month);

    const data = await apiRequest(url);

    if (data && Array.isArray(data.vehicles)) {
      window.fleetState = window.fleetState || {};
      window.fleetState.vehicles = data.vehicles;
      return data.vehicles;
    }
  } catch (e) {
    console.error('[_getVehiclesList] Nepodarilo sa načítať vozidlá:', e);
  }
  return [];
}

// =================== POROVNANIE (UI + dáta + graf) ===================
async function setupFleetComparisonUI(){
  const filters = document.getElementById('fleet-compare-filters');
  const cont    = document.getElementById('fleet-compare-container');
  const chart   = document.getElementById('fleet-compare-chart');
  if (!filters || !cont || !chart) return;

  // Skeleton
  filters.innerHTML = '<p>Načítavam vozidlá…</p>';
  cont.innerHTML = '';
  chart.innerHTML = '';

  // Spoľahlivo získať vozidlá (stav → DOM → API)
  const vehicles = await _getVehiclesList();

  if (!vehicles.length){
    filters.innerHTML = '<p>V systéme nie sú dostupné aktívne vozidlá (alebo sa nepodarilo načítať).</p>';
    return;
  }

  const yNow = new Date().getFullYear();
  const monthOpts   = [...Array(12)].map((_,i)=>`<option value="${i+1}" ${i===0?'selected':''}>${i+1}</option>`).join('');
  const monthToOpts = [...Array(12)].map((_,i)=>`<option value="${i+1}" ${i===new Date().getMonth()?'selected':''}>${i+1}</option>`).join('');
  const yearOpts    = [yNow-2,yNow-1,yNow,yNow+1].map(y=>`<option value="${y}" ${y===yNow?'selected':''}>${y}</option>`).join('');

  filters.innerHTML = `
    <div class="form-group" style="min-width:220px;">
      <label>Režim porovnania</label>
      <div id="cmp-mode" style="display:flex; gap:.5rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary active" data-mode="by-vehicle">Mesiace jedného auta</button>
        <button type="button" class="btn btn-secondary" data-mode="by-fleet">Vozidlá medzi sebou</button>
      </div>
    </div>

    <!-- Režim: mesiace jedného auta -->
    <div id="cmp-row-vehicle" style="display:flex; gap:.75rem; flex-wrap:wrap; align-items:flex-end; margin-top:.75rem;">
      <div class="form-group">
        <label>Vozidlo</label>
        <select id="cmp-vehicle-single" style="min-width:260px;">
          ${vehicles.map(v => `<option value="${v.id}" ${String(v.id)===String(fleetState.selected_vehicle_id)?'selected':''}>${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Rok</label>
        <select id="cmp-year-single">${yearOpts}</select>
      </div>
      <div class="form-group">
        <label>Od mesiaca</label>
        <select id="cmp-month-from-single">${monthOpts}</select>
      </div>
      <div class="form-group">
        <label>Do mesiaca</label>
        <select id="cmp-month-to-single">${monthToOpts}</select>
      </div>
    </div>

    <!-- Režim: vozidlá medzi sebou -->
    <div id="cmp-row-fleet" style="display:none; gap:.75rem; flex-wrap:wrap; align-items:flex-end; margin-top:.75rem;">
      <div class="form-group">
        <label>Vozidlá</label>
        <div id="cmp-vehicle-checks" style="display:flex; gap:.5rem; flex-wrap:wrap; max-width:820px;">
          ${vehicles.map(v => `
            <label style="display:inline-flex; align-items:center; gap:.35rem; background:var(--light); padding:.4rem .6rem; border-radius:9999px;">
              <input type="checkbox" value="${v.id}"> ${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})
            </label>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Rok</label>
        <select id="cmp-year-fleet">${yearOpts}</select>
      </div>
      <div class="form-group">
        <label>Od mesiaca</label>
        <select id="cmp-month-from-fleet">${monthOpts}</select>
      </div>
      <div class="form-group">
        <label>Do mesiaca</label>
        <select id="cmp-month-to-fleet">${monthToOpts}</select>
      </div>
    </div>

    <div style="margin-top:.75rem;">
      <button id="compare-run-btn" class="btn btn-success"><i class="fas fa-chart-line"></i> Porovnať</button>
    </div>
  `;

  // Prepínač režimu
  const modeBtns   = filters.querySelectorAll('#cmp-mode [data-mode]');
  const rowVehicle = document.getElementById('cmp-row-vehicle');
  const rowFleet   = document.getElementById('cmp-row-fleet');
  modeBtns.forEach(b=>{
    b.onclick = () => {
      modeBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      if (b.dataset.mode === 'by-vehicle') { rowVehicle.style.display='flex'; rowFleet.style.display='none'; }
      else { rowVehicle.style.display='none'; rowFleet.style.display='flex'; }
    };
  });

  document.getElementById('compare-run-btn').onclick = runComparison;
}

async function runComparison(){
  const cont  = document.getElementById('fleet-compare-container');
  const chart = document.getElementById('fleet-compare-chart');
  cont.innerHTML = '<p>Načítavam…</p>'; chart.innerHTML = '';

  const activeModeBtn = document.querySelector('#cmp-mode .active');
  const mode = activeModeBtn ? activeModeBtn.dataset.mode : 'by-vehicle';

  if (mode === 'by-vehicle'){
    await runVehicleTimelineComparison();
  } else {
    await runFleetSnapshotComparison();
  }
}

// --- Režim: vozidlá medzi sebou (sumár za rozsah) ---
async function runFleetSnapshotComparison(){
  const cont  = document.getElementById('fleet-compare-container');
  const chart = document.getElementById('fleet-compare-chart');

  const year  = parseInt(document.getElementById('cmp-year-fleet').value,10);
  let mFrom   = parseInt(document.getElementById('cmp-month-from-fleet').value,10);
  let mTo     = parseInt(document.getElementById('cmp-month-to-fleet').value,10);
  if (mFrom > mTo) [mFrom,mTo] = [mTo,mFrom];

  const vs = Array.from(document.querySelectorAll('#cmp-vehicle-checks input[type="checkbox"]:checked')).map(i=>i.value);
  if (!vs.length){ cont.innerHTML = '<p>Vyber aspoň jedno vozidlo.</p>'; return; }

  const rows = [];
  for (const vid of vs){
    let sumKm=0, sumCosts=0, sumGoodsOut=0, sumDL=0, sumLiters=0;
    for (let m=mFrom; m<=mTo; m++){
      const a = await apiRequest(`/api/kancelaria/fleet/getAnalysis?vehicle_id=${vid}&year=${year}&month=${m}`);
      const d = await apiRequest(`/api/kancelaria/fleet/getData?vehicle_id=${vid}&year=${year}&month=${m}`);
      sumKm    += Number(a.total_km||0);
      sumCosts += Number(a.total_costs||0);
      sumGoodsOut += (d.logs||[]).reduce((acc,l)=>acc+(parseFloat(l.goods_out_kg||0)||0),0);
      sumDL += (d.logs||[]).reduce((acc,l)=>acc+(parseInt(l.delivery_notes_count||0,10)||0),0);
      sumLiters += (d.refuelings||[]).reduce((acc,r)=>acc+(parseFloat(r.liters||0)||0),0);
    }
    const cpk  = sumKm>0 ? (sumCosts/sumKm) : 0;
    const cons = sumKm>0 ? (sumLiters/sumKm*100) : 0;
    const v    = (fleetState.vehicles||[]).find(x=>String(x.id)===String(vid));
    rows.push({
      vid, vehicle: v ? `${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})` : '#'+vid,
      km: sumKm, costs: sumCosts, cpk, cons, goods_out: sumGoodsOut, dl: sumDL
    });
  }

  const totKm = rows.reduce((a,b)=>a+b.km,0);
  const totCosts = rows.reduce((a,b)=>a+b.costs,0);
  const avgCpk = totKm>0 ? (totCosts/totKm) : 0;

  const kpi = `
    <div class="analysis-card">
      <div class="kpi-badges">
        <span class="kpi-badge">Obdobie: <strong>${String(mFrom).padStart(2,'0')}/${year} – ${String(mTo).padStart(2,'0')}/${year}</strong></span>
        <span class="kpi-badge">Vozidlá: <strong>${rows.length}</strong></span>
        <span class="kpi-badge">KM spolu: <strong>${totKm}</strong></span>
        <span class="kpi-badge">Náklady spolu: <strong>${totCosts.toFixed(2)} €</strong></span>
        <span class="kpi-badge">Ø cena/km: <strong>${avgCpk.toFixed(3)} €</strong></span>
      </div>
    </div>`;

  const table = ['<div class="table-container"><table><thead><tr>',
    '<th>Vozidlo</th><th>KM</th><th>Ø spotreba (L/100km)</th><th>Ø cena/km (€)</th><th>Náklady (€)</th><th>Vývoz (kg)</th><th>DL (ks)</th>',
    '</tr></thead><tbody>',
    ...rows.sort((a,b)=>a.vehicle.localeCompare(b.vehicle)).map(r=>`<tr>
      <td>${r.vehicle}</td>
      <td>${r.km}</td>
      <td>${r.cons.toFixed(2)}</td>
      <td>${r.cpk.toFixed(3)}</td>
      <td>${r.costs.toFixed(2)}</td>
      <td>${r.goods_out.toFixed(1)}</td>
      <td>${r.dl}</td>
    </tr>`),
    '</tbody></table></div>'
  ].join('');

  cont.innerHTML = kpi + table;

  if (window.google && window.google.charts){
    google.charts.load('current', {'packages':['corechart']});
    google.charts.setOnLoadCallback(()=>{
      const data = new google.visualization.DataTable();
      data.addColumn('string', 'Vozidlo');
      data.addColumn('number', 'Cena/km (€)');
      data.addRows(rows.map(r=>[r.vehicle, r.cpk]));
      const options = { title: 'Cena/km podľa vozidiel', legend:{position:'none'} };
      const c = new google.visualization.ColumnChart(chart);
      c.draw(data, options);
    });
  }
}

// --- Režim: mesiace jedného auta (timeline) ---
async function runVehicleTimelineComparison(){
  const cont  = document.getElementById('fleet-compare-container');
  const chart = document.getElementById('fleet-compare-chart');

  const vehicleId = document.getElementById('cmp-vehicle-single').value;
  const year  = parseInt(document.getElementById('cmp-year-single').value,10);
  let mFrom   = parseInt(document.getElementById('cmp-month-from-single').value,10);
  let mTo     = parseInt(document.getElementById('cmp-month-to-single').value,10);
  if (mFrom > mTo) [mFrom,mTo] = [mTo,mFrom];

  const rows = [];
  let sumKm=0, sumCosts=0, sumLiters=0, sumGoodsOut=0, sumDL=0;

  for (let m=mFrom; m<=mTo; m++){
    const a = await apiRequest(`/api/kancelaria/fleet/getAnalysis?vehicle_id=${vehicleId}&year=${year}&month=${m}`);
    const d = await apiRequest(`/api/kancelaria/fleet/getData?vehicle_id=${vehicleId}&year=${year}&month=${m}`);

    const km    = Number(a.total_km||0);
    const costs = Number(a.total_costs||0);
    const cpk   = Number(a.cost_per_km||0);
    const cons  = Number(a.avg_consumption||0);
    const goods = (d.logs||[]).reduce((acc,l)=>acc+(parseFloat(l.goods_out_kg||0)||0),0);
    const dl    = (d.logs||[]).reduce((acc,l)=>acc+(parseInt(l.delivery_notes_count||0,10)||0),0);
    const liters= (d.refuelings||[]).reduce((acc,r)=>acc+(parseFloat(r.liters||0)||0),0);

    rows.push({ month:m, km, costs, cpk, cons, goods_out:goods, dl, liters });
    sumKm+=km; sumCosts+=costs; sumLiters+=liters; sumGoodsOut+=goods; sumDL+=dl;
  }

  const avgCons = sumKm>0 ? (sumLiters / sumKm * 100) : 0;
  const avgCpk  = sumKm>0 ? (sumCosts / sumKm) : 0;

  const vehicle = (fleetState.vehicles||[]).find(v=>String(v.id)===String(vehicleId));
  const vLabel = vehicle ? `${escapeHtml(vehicle.name)} (${escapeHtml(vehicle.license_plate)})` : `#${vehicleId}`;

  const kpi = `
    <div class="analysis-card">
      <div class="kpi-badges">
        <span class="kpi-badge">Vozidlo: <strong>${vLabel}</strong></span>
        <span class="kpi-badge">Obdobie: <strong>${String(mFrom).padStart(2,'0')}/${year} – ${String(mTo).padStart(2,'0')}/${year}</strong></span>
        <span class="kpi-badge">KM spolu: <strong>${sumKm}</strong></span>
        <span class="kpi-badge">Náklady spolu: <strong>${sumCosts.toFixed(2)} €</strong></span>
        <span class="kpi-badge">Ø spotreba: <strong>${avgCons.toFixed(2)} L/100km</strong></span>
        <span class="kpi-badge">Ø cena/km: <strong>${avgCpk.toFixed(3)} €</strong></span>
        <span class="kpi-badge">Vývoz (kg): <strong>${sumGoodsOut.toFixed(1)}</strong></span>
        <span class="kpi-badge">DL (ks): <strong>${sumDL}</strong></span>
      </div>
    </div>`;

  const table = ['<div class="table-container"><table><thead><tr>',
    '<th>Mesiac</th><th>KM</th><th>Spotreba (L/100km)</th><th>Cena/km (€)</th><th>Náklady (€)</th><th>Vývoz (kg)</th><th>DL (ks)</th>',
    '</tr></thead><tbody>',
    ...rows.map(r=>`<tr>
      <td>${String(r.month).padStart(2,'0')}/${year}</td>
      <td>${r.km}</td>
      <td>${r.cons.toFixed(2)}</td>
      <td>${r.cpk.toFixed(3)}</td>
      <td>${r.costs.toFixed(2)}</td>
      <td>${r.goods_out.toFixed(1)}</td>
      <td>${r.dl}</td>
    </tr>`),
    '</tbody></table></div>'
  ].join('');

  cont.innerHTML = kpi + table;

  if (window.google && window.google.charts){
    google.charts.load('current', {'packages':['corechart']});
    google.charts.setOnLoadCallback(()=>{
      const data = new google.visualization.DataTable();
      data.addColumn('string', 'Mesiac');
      data.addColumn('number', 'KM');
      data.addRows(rows.map(r=>[String(r.month).padStart(2,'0')+'/'+String(year), r.km]));
      const options = { title: 'Najazdené km podľa mesiacov', legend:{position:'none'} };
      const c = new google.visualization.ColumnChart(chart);
      c.draw(data, options);
    });
  }
}

// =================== AUTO-INJECT TEMPLATES ===================
(function () {
  function ensureFleetTemplates() {
    var mount = document.body || document.documentElement;

    if (!document.getElementById('vehicle-modal-template')) {
      var t1 = document.createElement('template');
      t1.id = 'vehicle-modal-template';
      t1.innerHTML = `
        <form id="vehicle-form">
          <input type="hidden" name="id">
          <div class="form-grid">
            <div class="form-group">
              <label>ŠPZ *</label>
              <input type="text" name="license_plate" required>
            </div>
            <div class="form-group">
              <label>VIN (Povinné od 2026)</label>
              <input type="text" name="vin" placeholder="XXXXXXXXXXXXXXXXX">
            </div>
          </div>
          <div class="form-group">
            <label>Názov vozidla</label>
            <input type="text" name="name" required>
          </div>
          <div class="form-group">
            <label>Typ vozidla</label>
            <input type="text" name="type" placeholder="dodávka / osobné / …">
          </div>
          <div class="form-group">
            <label>Predvolený šofér</label>
            <input type="text" name="default_driver">
          </div>
          <div class="form-group">
            <label>Počiatočný stav tachometra</label>
            <input type="number" name="initial_odometer" step="1" required>
          </div>
          <button type="submit" class="btn btn-success w-full">Uložiť vozidlo</button>
        </form>`;
      mount.appendChild(t1);
    }

    if (!document.getElementById('refueling-modal-template')) {
      var t2 = document.createElement('template');
      t2.id = 'refueling-modal-template';
      t2.innerHTML = `
        <form id="refueling-form">
          <input type="hidden" name="vehicle_id">
          <div class="form-group">
            <label>Dátum tankovania</label>
            <input type="date" name="refueling_date" required>
          </div>
          <div class="form-group">
            <label>Šofér</label>
            <input type="text" name="driver">
          </div>
          <div class="form-group">
            <label>Typ paliva</label>
            <select name="fuel_type">
              <option value="DIESEL" selected>Nafta</option>
              <option value="ADBLUE">AdBlue</option>
            </select>
          </div>
          <div class="form-group">
            <label>Litrov</label>
            <input type="number" name="liters" step="0.01" required>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Cena za liter (€)</label>
              <input type="number" name="price_per_liter" step="0.001" placeholder="napr. 1.629">
            </div>
            <div class="form-group">
              <label>Cena celkom (€)</label>
              <input type="number" name="total_price" step="0.01" placeholder="ak nevyplníš, dopočíta sa">
            </div>
          </div>
          <p class="b2c-row-meta">Tip: keď vyplníš <em>Cena/L</em>, <strong>Cena celkom</strong> dopočíta server.</p>
          <button type="submit" class="btn btn-success w-full">Uložiť záznam</button>
        </form>`;
      mount.appendChild(t2);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureFleetTemplates, { once: true });
  } else {
    ensureFleetTemplates();
  }
  window.ensureFleetTemplates = ensureFleetTemplates;
})();

// === Append AdBlue rows into analysis table if available ===
try{
  const ana = window.fleetState && window.fleetState.analysis;
  const tbody = document.querySelector('#fleet-analysis-container .analysis-table tbody');
  if (ana && tbody && !document.getElementById('adblue-rows-marker')){
    const tr1 = document.createElement('tr'); tr1.innerHTML = '<td>AdBlue (L/100km)</td><td>'+(Number(ana.adblue_per_100km||0).toFixed(2))+' L</td><td>z analýzy</td>';
    const tr2 = document.createElement('tr'); tr2.innerHTML = '<td>AdBlue spolu</td><td>'+Number(ana.total_adblue_liters||0).toFixed(1)+' L / '+Number(ana.total_adblue_cost||0).toFixed(2)+' €</td><td>tankovania v mesiaci</td>';
    const cpl = Number(ana.total_adblue_liters||0)>0 ? (Number(ana.total_adblue_cost||0)/Number(ana.total_adblue_liters||1)) : 0;
    const tr3 = document.createElement('tr'); tr3.innerHTML = '<td>Priemerná cena AdBlue</td><td>'+cpl.toFixed(3)+' €/L</td><td></td>';
    const m = document.createElement('tr'); m.id = 'adblue-rows-marker'; m.style.display='none';
    tbody.appendChild(tr1); tbody.appendChild(tr2); tbody.appendChild(tr3); tbody.appendChild(m);
  }
}catch(e){}

// === AUTO DEFAULT DRIVER (predvolený šofér z vozidla) =======================
(function(){
  function getDefaultDriver(){
    const sel = document.getElementById('fleet-vehicle-select');
    const vid = sel && sel.value;
    const vs  = (window.fleetState && window.fleetState.vehicles) || [];
    const v   = vs.find(x => String(x.id) === String(vid));
    return (v && v.default_driver) ? String(v.default_driver) : '';
  }

  function applyDefaultToInput(el){
    if (!el || el.name !== 'driver') return;
    if (el.value && el.dataset.userEdited === '1') return;  // užívateľ už písal
    const def = getDefaultDriver();
    if (def && !el.value) { el.value = def; el.dataset.autofilled = '1'; }
  }

  document.addEventListener('input', (e)=>{
    const t = e.target;
    if (t && t.name === 'driver') t.dataset.userEdited = '1';
  }, true);

  function scanAndApply(){
    document.querySelectorAll('input[name="driver"]').forEach(applyDefaultToInput);
    const ref = document.querySelector('#refueling-form input[name="driver"]');
    if (ref) applyDefaultToInput(ref);
  }

  const mo = new MutationObserver(()=>{ scanAndApply(); });
  mo.observe(document.body, {childList:true, subtree:true});

  const sel = document.getElementById('fleet-vehicle-select');
  if (sel) sel.addEventListener('change', ()=>{ 
    document.querySelectorAll('input[name="driver"]').forEach(el => { if (el.dataset.autofilled==='1') el.value=''; el.dataset.autofilled=''; });
    scanAndApply();
  });

  document.addEventListener('DOMContentLoaded', scanAndApply);
  setTimeout(scanAndApply, 0);
})();
async function handleDeleteTripLog(id) {
    if (!confirm("Naozaj vymazať túto jazdu?")) return;
    try {
        await apiRequest('/api/kancelaria/fleet/deleteTripLog', { method: 'POST', body: { id: id } });
        loadAndRenderFleetData();
    } catch (e) {
        alert("Chyba: " + e.message);
    }
}