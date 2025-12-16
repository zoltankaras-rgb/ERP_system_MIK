// =================================================================
// === KANCELÁRIA: HACCP – Teplota jadra výrobkov ==================
// =================================================================
//
// Funkcie:
//  - strom (rok -> mesiac -> deň) podľa dátumu výroby
//  - zoznam výroby za vybraný deň (plán / reál / stav)
//  - meranie teploty jadra (uloženie)
//  - nastavenia výrobkov ("varený" + limit °C)
//
// Backend:
//  - GET  /api/kancelaria/core_temp/list?days=365
//  - GET  /api/kancelaria/core_temp/product_defaults
//  - POST /api/kancelaria/core_temp/product_defaults/save
//  - POST /api/kancelaria/core_temp/measurement/save
//  - GET  /api/kancelaria/core_temp/measurement/history?batchId=...
//

async function _ctApi(url, opts = {}) {
  return await apiRequest(url, opts);
}

function _ctEl(id){ return document.getElementById(id); }
function _ctEsc(s){ return (window.escapeHtml ? window.escapeHtml(s) : String(s||'')); }

function _ctFmtDateSK(iso){
  if (!iso) return '—';
  const s = String(iso).slice(0,10);
  const [y,m,d] = s.split('-');
  if (!y||!m||!d) return s;
  return `${d}.${m}.${y}`;
}

function _ctFmtNum(n, decimals=2){
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return v.toFixed(decimals);
}

function _ctNowIsoLocal(){
  const d = new Date();
  const pad = (x)=> String(x).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function _ctIsMissing(item){
  return !!item?.isRequired && (item?.measuredC == null);
}

function _ctIsFail(item){
  if (!item?.isRequired) return false;
  if (item?.measuredC == null) return false;
  if (item?.limitC == null) return false;
  return Number(item.measuredC) < Number(item.limitC);
}

function _ctStatusBadge(item){
  const st = item?.haccpStatus || 'NA';
  if (st === 'OK') return `<span class="kpi-badge" style="background:#dcfce7;color:#166534;">OK</span>`;
  if (st === 'FAIL') return `<span class="kpi-badge" style="background:#fee2e2;color:#991b1b;">NÍZKA</span>`;
  if (st === 'MISSING') return `<span class="kpi-badge" style="background:#fef3c7;color:#92400e;">CHÝBA</span>`;
  return `<span class="kpi-badge" style="background:#e5e7eb;color:#374151;">N/A</span>`;
}

function initializeCoreTempModule(){
  const mount = _ctEl('section-core-temp');
  if (!mount) return;

  mount.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
      <h3 style="margin:0;">HACCP – Teplota jadra výrobkov</h3>
      <div style="display:flex; gap:.5rem; align-items:center; flex-wrap:wrap;">
        <button class="btn btn-secondary" id="ct-settings"><i class="fas fa-sliders"></i> Nastavenia výrobkov</button>
        <button class="btn btn-secondary" id="ct-refresh"><i class="fas fa-rotate"></i> Obnoviť</button>
      </div>
    </div>

    <div class="analysis-card" style="margin-top:1rem;">
      <div class="form-grid" style="grid-template-columns: repeat(6, minmax(160px, 1fr)); gap:.75rem;">
        <div class="form-group">
          <label>Obdobie (dni)</label>
          <select id="ct-days">
            <option value="30">30</option>
            <option value="90">90</option>
            <option value="180">180</option>
            <option value="365" selected>365</option>
            <option value="730">730</option>
          </select>
        </div>
        <div class="form-group">
          <label>Filter – názov</label>
          <input id="ct-filter-q" placeholder="napr. parky">
        </div>
        <div class="form-group" style="align-self:end;">
          <label style="display:block;">&nbsp;</label>
          <label style="display:flex; gap:.5rem; align-items:center;">
            <input type="checkbox" id="ct-only-required"> Len varené (CCP)
          </label>
        </div>
        <div class="form-group" style="align-self:end;">
          <label style="display:block;">&nbsp;</label>
          <label style="display:flex; gap:.5rem; align-items:center;">
            <input type="checkbox" id="ct-only-missing"> Len bez merania
          </label>
        </div>
        <div class="form-group" style="align-self:end;">
          <button class="btn btn-primary" id="ct-apply"><i class="fas fa-filter"></i> Použiť</button>
        </div>
        <div class="form-group" style="align-self:end;">
          <button class="btn btn-secondary" id="ct-today"><i class="fas fa-calendar-day"></i> Dnes</button>
        </div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 320px 1fr; gap:1rem; margin-top:1rem; align-items:start;">
      <div class="analysis-card" style="min-height:360px;">
        <h4 style="margin:.25rem 0 .75rem 0;">Rok / Mesiac / Deň</h4>
        <div id="ct-tree" style="max-height:70vh; overflow:auto;"></div>
      </div>
      <div class="analysis-card" style="min-height:360px;">
        <div style="display:flex; justify-content:space-between; gap:1rem; align-items:center; flex-wrap:wrap;">
          <h4 style="margin:.25rem 0 .75rem 0;">Záznamy</h4>
          <div id="ct-day-kpis" style="display:flex; gap:.5rem; flex-wrap:wrap;"></div>
        </div>
        <div id="ct-day" style="min-height:220px;"></div>
      </div>
    </div>
  `;

  const state = {
    items: [],
    filtered: [],
    selectedDate: null,
  };

  async function loadData(){
    const days = _ctEl('ct-days')?.value || '365';
    _ctEl('ct-tree').innerHTML = '<p>Načítavam…</p>';
    _ctEl('ct-day').innerHTML = '<p>Načítavam…</p>';
    const rows = await _ctApi(`/api/kancelaria/core_temp/list?days=${encodeURIComponent(days)}`);
    state.items = Array.isArray(rows) ? rows : [];
    // Pri prvom načítaní automaticky vyber najnovší deň.
    const firstLoad = !state.selectedDate;
    applyFilters(firstLoad);
  }

  function applyFilters(resetDate=true){
    const q = (_ctEl('ct-filter-q')?.value || '').trim().toLowerCase();
    const onlyReq = !!_ctEl('ct-only-required')?.checked;
    const onlyMissing = !!_ctEl('ct-only-missing')?.checked;

    let arr = state.items.slice();
    if (q){
      arr = arr.filter(x => String(x.productName||'').toLowerCase().includes(q));
    }
    if (onlyReq){
      arr = arr.filter(x => !!x.isRequired);
    }
    if (onlyMissing){
      arr = arr.filter(x => _ctIsMissing(x));
    }
    state.filtered = arr;

    renderTree();
    if (resetDate){
      // vyber najnovší deň z filtrovaných dát
      const d = (state.filtered[0] && state.filtered[0].productionDate) ? state.filtered[0].productionDate : null;
      state.selectedDate = d;
    }
    renderDay();
  }

  function buildGroups(){
    const g = {};
    for (const it of state.filtered){
      const ds = String(it.productionDate||'');
      if (!ds || ds.length < 10) continue;
      const [y,m,d] = ds.slice(0,10).split('-');
      if (!y||!m||!d) continue;
      if (!g[y]) g[y] = {};
      if (!g[y][m]) g[y][m] = {};
      if (!g[y][m][d]) g[y][m][d] = [];
      g[y][m][d].push(it);
    }
    return g;
  }

  function renderTree(){
    const host = _ctEl('ct-tree');
    if (!host) return;

    const g = buildGroups();
    const years = Object.keys(g).sort((a,b)=>b.localeCompare(a));
    if (!years.length){
      host.innerHTML = '<p>Žiadne záznamy pre zvolené filtre.</p>';
      return;
    }

    let html = '';
    for (const y of years){
      const months = Object.keys(g[y]).sort((a,b)=>b.localeCompare(a));
      const yearCount = months.reduce((acc, m)=> acc + Object.values(g[y][m]).reduce((a2, arr)=>a2+arr.length,0), 0);

      html += `<details open class="ct-tree-year"><summary style="cursor:pointer; font-weight:800;">${_ctEsc(y)} <span class="muted">(${yearCount})</span></summary>`;
      html += `<div style="margin:.25rem 0 .75rem .5rem; display:flex; flex-direction:column; gap:.25rem;">`;

      for (const m of months){
        const days = Object.keys(g[y][m]).sort((a,b)=>b.localeCompare(a));
        const monthCount = days.reduce((acc,d)=> acc + g[y][m][d].length, 0);
        html += `<details class="ct-tree-month"><summary style="cursor:pointer; font-weight:700;">${_ctEsc(m)} <span class="muted">(${monthCount})</span></summary>`;
        html += `<div style="margin:.25rem 0 .5rem .75rem; display:flex; flex-direction:column; gap:.25rem;">`;

        for (const d of days){
          const dateIso = `${y}-${m}-${d}`;
          const list = g[y][m][d] || [];
          const missing = list.filter(_ctIsMissing).length;
          const fails = list.filter(_ctIsFail).length;
          const isActive = (state.selectedDate === dateIso);
          const badge = missing ? `<span class="kpi-badge" style="background:#fef3c7;color:#92400e;">chýba ${missing}</span>` : '';
          const badge2= fails ? `<span class="kpi-badge" style="background:#fee2e2;color:#991b1b;">nízka ${fails}</span>` : '';

          html += `
            <button class="btn btn-secondary" data-date="${_ctEsc(dateIso)}" style="justify-content:flex-start; width:100%; padding:.55rem .75rem; border-radius:10px; ${isActive?'filter:brightness(0.95);':''}">
              <span style="flex:1; text-align:left;">${_ctFmtDateSK(dateIso)} <span class="muted">(${list.length})</span></span>
              ${badge}
              ${badge2}
            </button>
          `;
        }

        html += `</div></details>`;
      }

      html += `</div></details>`;
    }

    host.innerHTML = html;
    host.querySelectorAll('button[data-date]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        state.selectedDate = btn.dataset.date;
        renderTree();
        renderDay();
      });
    });
  }

  function renderDay(){
    const host = _ctEl('ct-day');
    const kpi = _ctEl('ct-day-kpis');
    if (!host || !kpi) return;

    const dateIso = state.selectedDate;
    if (!dateIso){
      host.innerHTML = '<p>Vyberte deň vľavo.</p>';
      kpi.innerHTML = '';
      return;
    }

    const list = state.filtered.filter(x => x.productionDate === dateIso);
    const req = list.filter(x=>!!x.isRequired);
    const missing = req.filter(_ctIsMissing);
    const fails = req.filter(_ctIsFail);
    const ok = req.filter(x => x.haccpStatus === 'OK');

    kpi.innerHTML = `
      <span class="kpi-badge" style="background:#e5e7eb;color:#374151;">Dátum: ${_ctEsc(_ctFmtDateSK(dateIso))}</span>
      <span class="kpi-badge" style="background:#e5e7eb;color:#374151;">Položky: ${list.length}</span>
      <span class="kpi-badge" style="background:#e5e7eb;color:#374151;">Varené: ${req.length}</span>
      <span class="kpi-badge" style="background:#fef3c7;color:#92400e;">Chýba: ${missing.length}</span>
      <span class="kpi-badge" style="background:#fee2e2;color:#991b1b;">Nízka: ${fails.length}</span>
      <span class="kpi-badge" style="background:#dcfce7;color:#166534;">OK: ${ok.length}</span>
    `;

    if (!list.length){
      host.innerHTML = '<p>Pre zvolený deň neexistujú záznamy (podľa filtrov).</p>';
      return;
    }

    // tabuľka
    let html = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Výrobok</th>
              <th>Šarža</th>
              <th>Stav</th>
              <th>Plán</th>
              <th>Reál</th>
              <th>Limit</th>
              <th>Meranie</th>
              <th>HACCP</th>
              <th>Akcie</th>
            </tr>
          </thead>
          <tbody>
    `;

    // stable sort by product
    const listSorted = list.slice().sort((a,b)=> String(a.productName||'').localeCompare(String(b.productName||''), 'sk'));
    for (const it of listSorted){
      const planned = `${_ctFmtNum(it.plannedQtyKg,2)} kg`;
      let realDisp = `${_ctFmtNum(it.realQtyKg,2)} kg`;
      if (String(it.mj||'kg') === 'ks') realDisp = `${it.realQtyKs || 0} ks (${_ctFmtNum(it.realQtyKg,2)} kg)`;

      const limitDisp = (it.isRequired ? (it.limitC!=null? `${_ctFmtNum(it.limitC,1)} °C` : '<span class="muted">—</span>') : '<span class="muted">N/A</span>');
      const measDisp = (it.measuredC!=null ? `${_ctFmtNum(it.measuredC,1)} °C<br><span class="muted">${_ctEsc(it.measuredAt||'')}</span>` : '<span class="muted">—</span>');
      const rowStyle = (it.haccpStatus==='FAIL') ? 'background:#fff7f7;' : (it.haccpStatus==='MISSING' ? 'background:#fffbeb;' : '');

      html += `
        <tr style="${rowStyle}">
          <td>${_ctEsc(it.productName||'')}</td>
          <td><span class="muted">${_ctEsc(it.batchId||'')}</span></td>
          <td>${_ctEsc(it.status||'')}</td>
          <td>${planned}</td>
          <td>${realDisp}</td>
          <td>${limitDisp}</td>
          <td>${measDisp}</td>
          <td>${_ctStatusBadge(it)}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-primary btn-xs" data-action="measure" data-batch="${_ctEsc(it.batchId)}" style="padding:.45rem .7rem; width:auto;"><i class="fas fa-thermometer-half"></i></button>
            <button class="btn btn-secondary btn-xs" data-action="history" data-batch="${_ctEsc(it.batchId)}" style="padding:.45rem .7rem; width:auto;"><i class="fas fa-clock-rotate-left"></i></button>
          </td>
        </tr>
      `;
    }

    html += `</tbody></table></div>`;
    host.innerHTML = html;

    host.querySelectorAll('button[data-action="measure"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const bid = btn.dataset.batch;
        const it = state.items.find(x => String(x.batchId) === String(bid));
        if (it) openMeasureModal(it);
      });
    });
    host.querySelectorAll('button[data-action="history"]').forEach(btn=>{
      btn.addEventListener('click', ()=> openHistoryModal(btn.dataset.batch));
    });
  }

  function openHistoryModal(batchId){
    showModal('História meraní – teplota jadra', async ()=>{
      const rows = await _ctApi(`/api/kancelaria/core_temp/measurement/history?batchId=${encodeURIComponent(batchId)}`);
      const arr = Array.isArray(rows) ? rows : [];
      if (!arr.length){
        return `<p>Pre šaržu <b>${_ctEsc(batchId)}</b> nie sú uložené žiadne merania.</p>`;
      }
      let html = `
        <p>Šarža: <b>${_ctEsc(batchId)}</b></p>
        <div class="table-container"><table>
          <thead><tr><th>Čas merania</th><th>Namerané</th><th>Limit</th><th>Kto</th><th>Poznámka</th></tr></thead>
          <tbody>
      `;
      for (const r of arr){
        html += `
          <tr>
            <td>${_ctEsc(r.measuredAt||'')}</td>
            <td>${r.measuredC!=null ? _ctFmtNum(r.measuredC,1)+' °C' : '—'}</td>
            <td>${r.limitC!=null ? _ctFmtNum(r.limitC,1)+' °C' : '—'}</td>
            <td>${_ctEsc(r.measuredBy||'')}</td>
            <td>${_ctEsc(r.note||'')}</td>
          </tr>
        `;
      }
      html += '</tbody></table></div>';
      return html;
    });
  }

  async function openMeasureModal(item){
    const bid = item.batchId;
    const pname = item.productName || '';

    showModal('Záznam merania – teplota jadra', () => {
      const html = `
        <div class="stat-card">
          <div style="display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
            <div>
              <h3 style="margin:0 0 .25rem 0;">${_ctEsc(pname)}</h3>
              <div class="muted">Šarža: ${_ctEsc(bid)} | Dátum výroby: ${_ctEsc(_ctFmtDateSK(item.productionDate))}</div>
              <div class="muted">Stav: ${_ctEsc(item.status||'')}</div>
            </div>
            <div style="display:flex; gap:.5rem; align-items:center;">
              ${_ctStatusBadge(item)}
            </div>
          </div>

          <div class="form-grid" style="grid-template-columns: repeat(4, minmax(180px, 1fr)); gap:.75rem; margin-top:1rem;">
            <div class="form-group"><label>Plán</label><input value="${_ctFmtNum(item.plannedQtyKg,2)} kg" disabled></div>
            <div class="form-group"><label>Reál (kg)</label><input value="${_ctFmtNum(item.realQtyKg,2)} kg" disabled></div>
            <div class="form-group"><label>Reál (ks)</label><input value="${item.realQtyKs || 0} ks" disabled></div>
            <div class="form-group"><label>Limit (°C)</label>
              <input id="ct-limit" type="number" step="0.1" value="${item.limitC!=null ? _ctFmtNum(item.limitC,1) : ''}" placeholder="napr. 72.0" ${item.isRequired?'':'disabled'}>
              <small class="muted">Limit je viazaný na nastavenie výrobku (varený).</small>
            </div>
          </div>

          <div class="form-grid" style="grid-template-columns: repeat(4, minmax(180px, 1fr)); gap:.75rem;">
            <div class="form-group"><label>Namerané (°C)</label><input id="ct-measured" type="number" step="0.1" min="-50" max="200" placeholder="napr. 74.5" required></div>
            <div class="form-group"><label>Čas merania</label><input id="ct-measured-at" type="text" value="${_ctEsc(_ctNowIsoLocal())}" placeholder="YYYY-MM-DD HH:MM:SS"></div>
            <div class="form-group"><label>Kto meral</label><input id="ct-measured-by" type="text" placeholder="nepovinné"></div>
            <div class="form-group"><label>Poznámka / nápravné opatrenie</label><input id="ct-note" type="text" placeholder="nepovinné"></div>
          </div>

          <div id="ct-haccp-meta" class="analysis-card" style="margin-top:1rem;">
            <h4 style="margin:.25rem 0 .5rem 0;">HACCP / Meta (z recept_meta)</h4>
            <div class="muted">Načítavam…</div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:.5rem; margin-top:1rem;">
            <button class="btn btn-secondary" id="ct-close"><i class="fas fa-xmark"></i> Zavrieť</button>
            <button class="btn btn-success" id="ct-save"><i class="fas fa-save"></i> Uložiť meranie</button>
          </div>
        </div>
      `;

      return {
        html,
        onReady: async ()=>{
          const modal = _ctEl('modal-container');
          const close = ()=>{ if (modal) modal.style.display='none'; };

          const btnClose = _ctEl('ct-close');
          if (btnClose) btnClose.onclick = close;

          // HACCP meta
          try{
            const metaWrap = _ctEl('ct-haccp-meta');
            const resp = await _ctApi(`/api/kancelaria/getRecipeMeta?product_name=${encodeURIComponent(pname)}`);
            const meta = resp?.meta || {};
            const allergens = Array.isArray(meta.allergens) ? meta.allergens.join(', ') : '';
            const htmlMeta = `
              <div class="form-grid" style="grid-template-columns: repeat(4, minmax(180px, 1fr)); gap:.75rem;">
                <div class="form-group"><label>Trvácnosť (dni)</label><input value="${_ctEsc(meta.shelf_life_days ?? '')}" disabled></div>
                <div class="form-group"><label>Skladovanie</label><input value="${_ctEsc(meta.storage ?? '')}" disabled></div>
                <div class="form-group"><label>Alergény</label><input value="${_ctEsc(allergens)}" disabled></div>
                <div class="form-group"><label>CCP body</label><input value="${_ctEsc(meta.ccp_points ?? '')}" disabled></div>
              </div>
              <div class="form-group"><label>Postup výroby</label><textarea rows="5" disabled>${_ctEsc(meta.process_steps ?? '')}</textarea></div>
            `;
            if (metaWrap) metaWrap.innerHTML = `<h4 style="margin:.25rem 0 .5rem 0;">HACCP / Meta (z recept_meta)</h4>` + htmlMeta;
          }catch(e){
            const metaWrap = _ctEl('ct-haccp-meta');
            if (metaWrap) metaWrap.innerHTML = `<h4 style="margin:.25rem 0 .5rem 0;">HACCP / Meta (z recept_meta)</h4><p class="muted">Meta sa nepodarilo načítať.</p>`;
          }

          // upozornenie, ak výrobok nie je označený ako "varený"
          if (!item.isRequired){
            showStatus('Poznámka: výrobok nemá nastavené meranie teploty jadra (nie je označený ako varený). Nastavte ho v "Nastavenia výrobkov".', true);
          }

          const btnSave = _ctEl('ct-save');
          if (btnSave){
            btnSave.onclick = async ()=>{
              const measured = _ctEl('ct-measured')?.value;
              const limit = _ctEl('ct-limit')?.value;
              const measuredAt = _ctEl('ct-measured-at')?.value;
              const measuredBy = _ctEl('ct-measured-by')?.value;
              const note = _ctEl('ct-note')?.value;

              const mc = Number(String(measured||'').replace(',','.'));
              if (!Number.isFinite(mc)){
                showStatus('Zadajte nameranú teplotu (číslo).', true);
                return;
              }

              let lc = null;
              if (item.isRequired){
                const lv = Number(String(limit||'').replace(',','.'));
                lc = Number.isFinite(lv) ? lv : null;
              }

              // ak je required a máme limit, pri FAIL vyžaduj poznámku
              if (item.isRequired && lc != null && mc < lc){
                if (!String(note||'').trim()){
                  showStatus('Teplota je nižšia ako limit – doplňte prosím poznámku / nápravné opatrenie.', true);
                  return;
                }
              }

              const res = await _ctApi('/api/kancelaria/core_temp/measurement/save', {
                method: 'POST',
                body: {
                  batchId: bid,
                  measuredC: mc,
                  measuredAt: (measuredAt||'').trim(),
                  measuredBy: (measuredBy||'').trim(),
                  note: (note||'').trim(),
                  limitC: lc
                }
              });

              if (res && res.error){
                showStatus(res.error, true);
                return;
              }
              showStatus('Meranie uložené.', false);
              close();
              await loadData();
              // po reload-e necháme aktuálny deň
              state.selectedDate = item.productionDate;
              applyFilters(false);
            };
          }
        }
      };
    });
  }

  function openSettingsModal(){
    showModal('Nastavenia výrobkov – teplota jadra', async ()=>{
      const rows = await _ctApi('/api/kancelaria/core_temp/product_defaults');
      const arr = Array.isArray(rows) ? rows : [];
      const html = `
        <div class="stat-card">
          <p class="muted">Tu nastavíte, ktoré výrobky sú „varený výrobok“ (CCP – teplota jadra) a aký je minimálny limit v °C. Limit sa automaticky ponúkne pri meraní.</p>
          <div class="form-grid" style="grid-template-columns: 1fr 220px; gap:.75rem;">
            <div class="form-group"><label>Filter</label><input id="ct-set-q" placeholder="hľadať výrobok"></div>
            <div class="form-group" style="align-self:end;"><button class="btn btn-secondary" id="ct-set-apply"><i class="fas fa-filter"></i> Filtrovať</button></div>
          </div>
          <div id="ct-set-table"></div>
        </div>
      `;

      return {
        html,
        onReady: ()=>{
          const host = _ctEl('ct-set-table');
          const qEl = _ctEl('ct-set-q');
          const btn = _ctEl('ct-set-apply');

          function renderTable(){
            const q = (qEl?.value||'').trim().toLowerCase();
            const list = q ? arr.filter(x => String(x.productName||'').toLowerCase().includes(q)) : arr;
            if (!list.length){
              host.innerHTML = '<p>Žiadne položky.</p>';
              return;
            }
            let html = `
              <div class="table-container"><table>
                <thead><tr><th>Výrobok</th><th>Varený (CCP)</th><th>Limit °C</th><th></th></tr></thead>
                <tbody>
            `;
            for (const r of list){
              html += `
                <tr>
                  <td>${_ctEsc(r.productName||'')}</td>
                  <td><input type="checkbox" class="ct-set-req" data-name="${_ctEsc(r.productName)}" ${r.isRequired?'checked':''}></td>
                  <td><input type="number" step="0.1" class="ct-set-limit" data-name="${_ctEsc(r.productName)}" value="${r.limitC!=null ? _ctFmtNum(r.limitC,1) : ''}" placeholder="72.0" style="width:140px;"></td>
                  <td><button class="btn btn-success btn-xs ct-set-save" data-name="${_ctEsc(r.productName)}" style="padding:.45rem .7rem; width:auto;"><i class="fas fa-save"></i></button></td>
                </tr>
              `;
            }
            html += '</tbody></table></div>';
            host.innerHTML = html;

            host.querySelectorAll('.ct-set-save').forEach(b=>{
              b.addEventListener('click', async ()=>{
                const name = b.dataset.name;
                const chk = host.querySelector(`.ct-set-req[data-name="${CSS.escape(name)}"]`);
                const lim = host.querySelector(`.ct-set-limit[data-name="${CSS.escape(name)}"]`);
                const isRequired = !!chk?.checked;
                const limitC = lim?.value;
                const res = await _ctApi('/api/kancelaria/core_temp/product_defaults/save', {
                  method:'POST',
                  body:{ productName:name, isRequired, limitC }
                });
                if (res && res.error){ showStatus(res.error, true); return; }
                showStatus('Uložené.', false);
                // aktualizuj lokálne dáta
                const r0 = arr.find(x => String(x.productName)===String(name));
                if (r0){
                  r0.isRequired = !!isRequired;
                  const lv = Number(String(limitC||'').replace(',','.'));
                  r0.limitC = (isRequired && Number.isFinite(lv)) ? lv : (isRequired ? 72.0 : null);
                }
                // refresh hlavných dát
                await loadData();
              });
            });
          }

          if (btn) btn.onclick = renderTable;
          if (qEl) qEl.onkeydown = (e)=>{ if (e.key==='Enter'){ e.preventDefault(); renderTable(); } };
          renderTable();
        }
      };
    });
  }

  // bindings
  _ctEl('ct-refresh').onclick = () => loadData();
  _ctEl('ct-apply').onclick = () => applyFilters(true);
  _ctEl('ct-settings').onclick = () => openSettingsModal();
  _ctEl('ct-today').onclick = ()=>{
    const d = new Date();
    const pad = (x)=> String(x).padStart(2,'0');
    const iso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    state.selectedDate = iso;
    renderTree();
    renderDay();
  };

  // init
  loadData();

  // keď sa používateľ preklikne v sidebar-e na túto sekciu, načítaj dáta (bez resetu dňa)
  try{
    const link = document.querySelector('.sidebar-nav a.sidebar-link[data-section="section-core-temp"]');
    if (link){
      link.addEventListener('click', ()=>{
        // ak už máme vybraný deň, nechaj ho; len obnov dáta
        loadData();
      });
    }
  }catch(_){ }
}

/* Auto-register sekcia */
(function(){
  const container = document.getElementById('section-core-temp');
  if (container) initializeCoreTempModule();
})();
