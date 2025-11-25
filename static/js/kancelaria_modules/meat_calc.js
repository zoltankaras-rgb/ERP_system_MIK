// =================================================================
// === KANCELÁRIA: KALKULÁTOR ROZRÁBKY MÄSA ========================
// =================================================================

async function apiM(url, opts = {}) {
  try {
    const res = await apiRequest(url, opts);
    return res;
  } catch (e) {
    console.error('API error:', url, e);
    return { __error: e?.message || 'API error' };
  }
}

function ensureMeatTabsStyles(){
  if (document.getElementById('meat-inline-styles')) return;
  const s = document.createElement('style');
  s.id = 'meat-inline-styles';
  s.textContent = `
    /* Týka sa len tohto modulu */
    #section-meat-calc .b2b-tab-nav{ display:flex; gap:.5rem; flex-wrap:wrap; }
    #section-meat-calc .b2b-tab-button{
      appearance:none; border:0; cursor:pointer;
      padding:.55rem .9rem; border-radius:9999px;
      background: var(--light); color: var(--dark);
      font-family: var(--font); font-weight:600; letter-spacing:.2px;
      box-shadow: 0 1px 2px rgba(0,0,0,.06) inset;
      transition: transform .12s ease, box-shadow .15s ease,
                  background-color .15s ease, color .15s ease;
    }
    #section-meat-calc .b2b-tab-button:hover{ filter: brightness(0.98); }
    #section-meat-calc .b2b-tab-button:active{ transform: translateY(1px); }
    #section-meat-calc .b2b-tab-button.active{
      color:#fff;
      background: linear-gradient(180deg, rgba(255,255,255,.12), rgba(0,0,0,.06)), var(--primary-color);
      box-shadow: var(--shadow);
    }
    /* Fallback pre tab obsah (ak by globálne CSS neriešilo) */
    #section-meat-calc .b2b-tab-content { display:none; }
    #section-meat-calc .b2b-tab-content.active { display:block; }
    /* Aj ostatné tlačidlá v module nech sú pekne zaoblené */
    #section-meat-calc .btn { border-radius:9999px; }
  `;
  document.head.appendChild(s);
}

const $   = (id)=>document.getElementById(id);
const esc = (s)=> (window.escapeHtml ? window.escapeHtml(s) : String(s||''));

// Cache
let MEAT_PRODUCTS_CACHE  = [];
let MEAT_MATERIALS_CACHE = [];
let MEAT_SUPPLIERS_CACHE = [];

// =================================================================
// INIT MODULU
// =================================================================

function initializeMeatCalcModule(){
  ensureMeatTabsStyles();
  const wrap = document.getElementById('section-meat-calc');
  if (!wrap) return;

  wrap.innerHTML = `
    <h3>Kalkulátor Rozrábky Mäsa</h3>

    <!-- NAV -->
    <div class="b2b-tab-nav" id="meat-main-nav">
      <button class="b2b-tab-button active" data-meat-tab="settings">Nastavenia</button>
      <button class="b2b-tab-button" data-meat-tab="new">Evidencia (nový záznam)</button>
      <button class="b2b-tab-button" data-meat-tab="history">História</button>
      <button class="b2b-tab-button" data-meat-tab="estimate">Odhad Rozrábky</button>
      <button class="b2b-tab-button" data-meat-tab="reports">Reporty</button>
    </div>

    <!-- SETTINGS -->
    <div id="settings-tab" class="b2b-tab-content active" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>Číselník Surovín</h4>
        <div style="display:flex; gap:.5rem; margin:.5rem 0;">
          <button class="btn btn-success" id="meat-add-material"><i class="fas fa-plus"></i> Pridať surovinu</button>
          <button class="btn btn-secondary" id="meat-refresh-materials"><i class="fas fa-rotate"></i> Obnoviť</button>
        </div>
        <div id="meat-materials-table"></div>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <h4>Číselník Produktov (s predajnou cenou)</h4>
        <div style="display:flex; gap:.5rem; margin:.5rem 0;">
          <button class="btn btn-success" id="meat-add-product"><i class="fas fa-plus"></i> Pridať produkt</button>
          <button class="btn btn-secondary" id="meat-refresh-products"><i class="fas fa-rotate"></i> Obnoviť</button>
        </div>
        <div id="meat-products-table"></div>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <h4>Číselník Dodávateľov</h4>
        <div style="display:flex; gap:.5rem; margin:.5rem 0;">
          <button class="btn btn-success" id="meat-add-supplier"><i class="fas fa-plus"></i> Pridať dodávateľa</button>
          <button class="btn btn-secondary" id="meat-refresh-suppliers"><i class="fas fa-rotate"></i> Obnoviť</button>
        </div>
        <div id="meat-suppliers-table"></div>
      </div>
    </div>

    <!-- NEW BREAKDOWN -->
    <div id="new-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>Nový záznam rozrábky</h4>
        <form id="meat-new-form">
          <input type="hidden" name="id" id="meat-breakdown-id">
          <input type="hidden" name="supplier_id" id="meat-supplier-id">
          <div class="form-grid" style="grid-template-columns: repeat(4, minmax(180px, 1fr)); gap:.75rem;">
            <div class="form-group">
              <label>Dátum</label>
              <input type="date" name="breakdown_date" required>
            </div>
            <div class="form-group">
              <label>Surovina</label>
              <select name="material_id" id="meat-new-material" required></select>
            </div>
            <div class="form-group">
              <label>Dodávateľ (voliteľné)</label>
              <div style="display:flex; gap:.25rem; align-items:center;">
                <input name="supplier" id="meat-supplier-input" placeholder="Dodávateľ" list="meat-suppliers-datalist" style="flex:1;">
                <!-- plusko sa pridá cez enhanceSupplierField() -->
              </div>
              <datalist id="meat-suppliers-datalist"></datalist>
            </div>
            <div class="form-group">
              <label>Dodávateľská šarža / číslo dodávky</label>
              <input name="supplier_batch_code" placeholder="napr. LOT-2025-11-21-01">
            </div>
            <div class="form-group">
              <label>Počet kusov (voliteľné)</label>
              <input type="number" name="units_count" step="1">
            </div>
            <div class="form-group">
              <label>Počet ľudí na rozrábke</label>
              <input type="number" name="workers_count" step="1" min="1">
            </div>
            <div class="form-group">
              <label>Čas rozrábky (minúty)</label>
              <input type="number" name="duration_minutes" step="1" min="0">
            </div>
            <div class="form-group">
              <label>Vstupná váha (kg)</label>
              <input type="number" name="input_weight_kg" step="0.001" required>
            </div>
            <div class="form-group">
              <label>Celková nákupná cena (€)</label>
              <input type="number" name="purchase_total_cost_eur" step="0.01">
            </div>
            <div class="form-group">
              <label>alebo Jedn. cena (€/kg)</label>
              <input type="number" name="purchase_unit_price_eur_kg" step="0.0001">
            </div>
            <div class="form-group">
              <label>Tolerancia straty (%)</label>
              <input type="number" name="tolerance_pct" step="0.001" value="5.000">
            </div>
            <div class="form-group" style="grid-column:1/-1;">
              <label>Poznámka</label>
              <input name="note">
            </div>
          </div>
        </form>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <h4>Výstupy (diely)</h4>
        <div id="meat-outputs-table"></div>
        <div style="display:flex; gap:.5rem; margin-top:.5rem;">
          <button class="btn btn-success" id="meat-add-output"><i class="fas fa-plus"></i> Pridať položku</button>
        </div>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <h4>Dodatočné náklady</h4>
        <div id="meat-extras-table"></div>
        <div style="display:flex; gap:.5rem; margin-top:.5rem;">
          <button class="btn btn-secondary" id="meat-add-extra"><i class="fas fa-plus"></i> Pridať náklad</button>
        </div>
      </div>

      <div style="display:flex; gap:.75rem; margin-top:1rem;">
        <button class="btn btn-success" id="meat-save-breakdown"><i class="fas fa-save"></i> Uložiť záznam</button>
      </div>

      <div id="meat-results" style="margin-top:1rem;"></div>
    </div>

    <!-- HISTORY -->
    <div id="history-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>História rozrábok</h4>
        <div class="form-grid" style="grid-template-columns: repeat(5, minmax(160px, 1fr)); gap:.5rem;">
          <div class="form-group"><label>Surovina</label><select id="meat-hist-material"></select></div>
          <div class="form-group"><label>Dátum od</label><input type="date" id="meat-hist-from"></div>
          <div class="form-group"><label>Dátum do</label><input type="date" id="meat-hist-to"></div>
          <div class="form-group"><label>Dodávateľ</label><input id="meat-hist-sup"></div>
          <div class="form-group" style="align-self:end;">
            <button class="btn btn-secondary" id="meat-hist-load"><i class="fas fa-search"></i> Hľadať</button>
          </div>
        </div>
        <div id="meat-hist-table" style="margin-top:.5rem;"></div>
      </div>
    </div>

    <!-- ESTIMATE -->
    <div id="estimate-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>Odhad Rozrábky (štatistický)</h4>
        <div class="form-grid" style="grid-template-columns: repeat(6, minmax(160px, 1fr)); gap:.75rem;">
          <div class="form-group"><label>Surovina</label><select id="meat-est-material"></select></div>
          <div class="form-group"><label>Plánovaná váha (kg)</label><input type="number" id="meat-est-weight" step="0.001" value="1000.000"></div>
          <div class="form-group"><label>Očakávaná nákupná cena (€/kg)</label><input type="number" id="meat-est-price" step="0.0001" value="2.6000"></div>
          <div class="form-group"><label>Dodávateľ filter (voliteľné)</label><input id="meat-est-sup"></div>
          <div class="form-group"><label>Dátum od</label><input type="date" id="meat-est-from"></div>
          <div class="form-group"><label>Dátum do</label><input type="date" id="meat-est-to"></div>
        </div>

        <div class="analysis-card" style="margin-top:.75rem;">
          <h5>Odhad – dodatočné náklady</h5>
          <div id="meat-est-extras"></div>
          <div style="display:flex; gap:.5rem; margin-top:.5rem;">
            <button class="btn btn-secondary" id="meat-est-add-extra"><i class="fas fa-plus"></i> Pridať náklad</button>
          </div>
        </div>

        <div style="display:flex; gap:.75rem; margin-top:.75rem;">
          <button class="btn btn-primary" id="meat-est-run"><i class="fas fa-calculator"></i> Prepočítať odhad</button>
        </div>

        <div id="meat-est-results" style="margin-top:1rem;"></div>
      </div>
    </div>

    <!-- REPORTS -->
    <div id="reports-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>Reporty – súhrn ziskov a výťažnosti</h4>
        <div class="form-grid" style="grid-template-columns: repeat(5, minmax(160px, 1fr)); gap:.5rem;">
          <div class="form-group"><label>Surovina</label><select id="meat-rep-material"></select></div>
          <div class="form-group"><label>Dátum od</label><input type="date" id="meat-rep-from"></div>
          <div class="form-group"><label>Dátum do</label><input type="date" id="meat-rep-to"></div>
          <div class="form-group"><label>Dodávateľ</label><input id="meat-rep-sup"></div>
          <div class="form-group" style="align-self:end;">
            <button class="btn btn-primary" id="meat-rep-run"><i class="fas fa-chart-bar"></i> Súhrnný report</button>
          </div>
        </div>
        <div style="display:flex; gap:.5rem; margin-top:.5rem;">
          <button class="btn btn-secondary" id="meat-rep-print"><i class="fas fa-print"></i> Tlač reportu</button>
        </div>
        <div id="meat-report-results" style="margin-top:.75rem;"></div>
      </div>
    </div>
  `;

  // Prepínanie tabov
  const tabButtons  = document.querySelectorAll('#section-meat-calc .b2b-tab-button');
  const tabContents = document.querySelectorAll('#section-meat-calc .b2b-tab-content');

  tabButtons.forEach(button=>{
    button.onclick = ()=>{
      tabButtons.forEach(b=>b.classList.remove('active'));
      button.classList.add('active');

      tabContents.forEach(c=>{
        c.classList.remove('active');
        c.style.display='none';
      });
      const paneId = `${button.dataset.meatTab}-tab`;
      const pane   = document.getElementById(paneId);
      if (pane){
        pane.classList.add('active');
        pane.style.display='block';
      }
    };
  });

  // Úvodný stav
  tabContents.forEach(c=> c.style.display='none');
  const first = document.getElementById('settings-tab');
  if (first) first.style.display='block';

  // init obsahu
  loadMaterialsTable();
  loadProductsTable();
  loadSuppliersTable();
  initNewBreakdown();
  initHistory();
  initEstimate();
  initReports();
  fillSuppliersDatalist();
}

// =================================================================
// DODÁVATELIA: datalist + plusko pri poli
// =================================================================

function enhanceSupplierField(){
  const input = $('meat-supplier-input');
  if (!input) return;
  if (input.dataset.enhanced === '1') return;
  input.dataset.enhanced = '1';

  const parent = input.parentElement;
  if (!parent) return;

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.gap = '.25rem';
  wrapper.style.alignItems = 'center';

  parent.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-outline-secondary btn-xs';
  btn.innerHTML = '<i class="fas fa-plus"></i>';
  btn.title = 'Nový / úprava dodávateľa';

  btn.onclick = ()=>{
    const name = input.value || '';
    const existing = MEAT_SUPPLIERS_CACHE.find(s=>s.name === name);
    if (existing){
      openSupplierModal(existing.id, '', input);
    } else {
      openSupplierModal(null, name, input);
    }
  };

  wrapper.appendChild(btn);
}

async function fillSuppliersDatalist(){
  const inputNew  = document.querySelector('#meat-new-form input[name="supplier"]');
  const inputHist = $('meat-hist-sup');
  const inputEst  = $('meat-est-sup');
  const inputRep  = $('meat-rep-sup');

  const rows = await apiM('/api/kancelaria/meat/suppliers');
  const items = Array.isArray(rows) ? rows : [];
  MEAT_SUPPLIERS_CACHE = items;

  let dl = document.getElementById('meat-suppliers-datalist');
  if (!dl){
    dl = document.createElement('datalist');
    dl.id = 'meat-suppliers-datalist';
    document.body.appendChild(dl);
  }
  dl.innerHTML = items.map(s=>`<option value="${esc(s.name)}"></option>`).join('');

  [inputNew, inputHist, inputEst, inputRep].forEach(inp=>{
    if (inp) inp.setAttribute('list','meat-suppliers-datalist');
  });

  // skryté supplier_id podľa mena
  const hiddenId = $('meat-supplier-id');
  function syncSupplierId(){
    if (!inputNew || !hiddenId) return;
    const name = (inputNew.value || '').trim();
    const match = MEAT_SUPPLIERS_CACHE.find(s=>s.name === name);
    hiddenId.value = match ? match.id : '';
  }
  if (inputNew){
    inputNew.addEventListener('change', syncSupplierId);
    inputNew.addEventListener('blur', syncSupplierId);
  }

  enhanceSupplierField();
}

// =================================================================
// NASTAVENIA: SUROVINY
// =================================================================

async function loadMaterialsTable(){
  const tbl = $('meat-materials-table');
  const rows = await apiM('/api/kancelaria/meat/materials');

  if (!Array.isArray(rows)) {
    console.warn('materials endpoint nevrátil pole:', rows);
    tbl.innerHTML = '<p class="error">Nepodarilo sa načítať suroviny (skontroluj route /api/kancelaria/meat/materials).</p>';
    return;
  }

  MEAT_MATERIALS_CACHE = rows;

  let html = '<div class="table-container"><table><thead><tr><th>Kód</th><th>Názov</th><th>Akcie</th></tr></thead><tbody>';
  rows.forEach(r=>{
    html += `
      <tr data-id="${r.id}">
        <td>${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td>
          <button class="btn btn-warning btn-xs" onclick="openMaterialModal(${r.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger  btn-xs" onclick="deleteMaterial(${r.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;

  const addBtn  = $('meat-add-material');
  const refBtn  = $('meat-refresh-materials');
  if (addBtn) addBtn.onclick = ()=> openMaterialModal(null);
  if (refBtn) refBtn.onclick = loadMaterialsTable;
}

function openMaterialModal(id=null){
  const row = id ? (MEAT_MATERIALS_CACHE||[]).find(m=>String(m.id)===String(id)) : null;

  showModal(id ? 'Upraviť surovinu' : 'Pridať surovinu', ()=>{
    const html = `
      <form id="meat-material-form">
        <input type="hidden" name="id" value="${id||''}">
        <div class="form-grid" style="grid-template-columns:repeat(2,minmax(180px,1fr));gap:.75rem;">
          <div class="form-group"><label>Kód</label><input name="code" value="${row?.code||''}" required></div>
          <div class="form-group"><label>Názov</label><input name="name" value="${row?.name||''}" required></div>
        </div>
        <button class="btn btn-success" style="margin-top:.75rem;">Uložiť</button>
      </form>
    `;
    return { html, onReady: ()=>{
      const f = $('meat-material-form');
      f.onsubmit = async e=>{
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f).entries());
        const res = await apiM('/api/kancelaria/meat/material/save',{method:'POST', body});
        if (res?.error) {
          showStatus(res.error, true);
          return;
        }
        $('modal-container').style.display = 'none';
        loadMaterialsTable();
        fillMaterialsSelects();
      };
    }};
  });
}

async function deleteMaterial(id){
  if (!confirm('Naozaj chceš zmazať túto surovinu? Historické rozrábky ostanú, ale surovina zmizne z číselníka.')) return;
  const res = await apiM('/api/kancelaria/meat/material/delete',{method:'POST', body:{id}});
  if (res?.error){
    showStatus(res.error,true);
    return;
  }
  loadMaterialsTable();
  fillMaterialsSelects();
}

// =================================================================
// NASTAVENIA: PRODUKTY
// =================================================================

async function loadProductsTable(){
  const tbl = $('meat-products-table');
  const rows = await apiM('/api/kancelaria/meat/products');

  if (!Array.isArray(rows)) {
    console.warn('products endpoint nevrátil pole:', rows);
    tbl.innerHTML = '<p class="error">Nepodarilo sa načítať produkty (skontroluj route /api/kancelaria/meat/products).</p>';
    return;
  }

  MEAT_PRODUCTS_CACHE = rows;

  let html = '<div class="table-container"><table><thead><tr><th>Kód</th><th>Produkt</th><th>Predajná cena (€/kg)</th><th>Akcie</th></tr></thead><tbody>';
  rows.forEach(r=>{
    html += `
      <tr data-id="${r.id}">
        <td>${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td>${Number(r.selling_price_eur_kg).toFixed(3)}</td>
        <td>
          <button class="btn btn-warning btn-xs" onclick="openProductModal(${r.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger  btn-xs" onclick="deleteProduct(${r.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;

  const addBtn  = $('meat-add-product');
  const refBtn  = $('meat-refresh-products');
  if (addBtn) addBtn.onclick = ()=> openProductModal(null);
  if (refBtn) refBtn.onclick = loadProductsTable;
}

function openProductModal(id=null){
  const row = id ? (MEAT_PRODUCTS_CACHE||[]).find(p=>String(p.id)===String(id)) : null;

  showModal(id ? 'Upraviť produkt' : 'Pridať produkt', ()=>{
    const html = `
      <form id="meat-product-form">
        <input type="hidden" name="id" value="${id||''}">
        <div class="form-grid" style="grid-template-columns:repeat(3,minmax(160px,1fr));gap:.75rem;">
          <div class="form-group"><label>Kód</label><input name="code" value="${row?.code||''}" required></div>
          <div class="form-group"><label>Názov</label><input name="name" value="${row?.name||''}" required></div>
          <div class="form-group"><label>Predajná cena (€/kg)</label><input type="number" name="selling_price_eur_kg" step="0.001" value="${row?.selling_price_eur_kg||''}" required></div>
        </div>
        <button class="btn btn-success" style="margin-top:.75rem;">Uložiť</button>
      </form>
    `;
    return { html, onReady: ()=>{
      const f = $('meat-product-form');
      f.onsubmit = async e=>{
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f).entries());
        const res = await apiM('/api/kancelaria/meat/product/save',{method:'POST', body});
        if (res?.error) {
          showStatus(res.error, true);
          return;
        }
        $('modal-container').style.display = 'none';
        loadProductsTable();
      };
    }};
  });
}

async function deleteProduct(id){
  if (!confirm('Naozaj chceš zmazať tento produkt? Historické rozrábky ostanú, ale produkt zmizne z číselníka.')) return;
  const res = await apiM('/api/kancelaria/meat/product/delete',{method:'POST', body:{id}});
  if (res?.error){
    showStatus(res.error,true);
    return;
  }
  loadProductsTable();
}

// =================================================================
// NASTAVENIA: DODÁVATELIA
// =================================================================

async function loadSuppliersTable(){
  const tbl = $('meat-suppliers-table');
  if (!tbl) return;

  const rows = await apiM('/api/kancelaria/meat/suppliers');

  if (!Array.isArray(rows)) {
    console.warn('suppliers endpoint nevrátil pole:', rows);
    tbl.innerHTML = '<p class="error">Nepodarilo sa načítať dodávateľov (skontroluj route /api/kancelaria/meat/suppliers).</p>';
    return;
  }

  MEAT_SUPPLIERS_CACHE = rows;

  let html = '<div class="table-container"><table><thead><tr><th>Kód</th><th>Názov</th><th>Akcie</th></tr></thead><tbody>';
  rows.forEach(r=>{
    html += `
      <tr data-id="${r.id}">
        <td>${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td>
          <button class="btn btn-warning btn-xs" onclick="openSupplierModal(${r.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-danger  btn-xs" onclick="deleteSupplier(${r.id})"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
  });
  html += '</tbody></table></div>';
  tbl.innerHTML = html;

  const addBtn = $('meat-add-supplier');
  const refBtn = $('meat-refresh-suppliers');
  if (addBtn) addBtn.onclick = ()=> openSupplierModal(null);
  if (refBtn) refBtn.onclick = loadSuppliersTable;
}

function openSupplierModal(id=null, initialName='', targetInput=null){
  const row = id ? (MEAT_SUPPLIERS_CACHE||[]).find(s=>String(s.id)===String(id)) : null;
  const namePrefill = row ? row.name : (initialName || '');

  showModal(id ? 'Upraviť dodávateľa' : 'Pridať dodávateľa', ()=>{
    const html = `
      <form id="meat-supplier-form">
        <input type="hidden" name="id" value="${row?.id || ''}">
        <div class="form-grid" style="grid-template-columns:repeat(2,minmax(180px,1fr));gap:.75rem;">
          <div class="form-group">
            <label>Kód</label>
            <input name="code" value="${row ? esc(row.code || '') : ''}" required>
          </div>
          <div class="form-group">
            <label>Názov dodávateľa</label>
            <input name="name" value="${esc(namePrefill)}" required>
          </div>
          <div class="form-group">
            <label>IČO</label>
            <input name="ico" value="${row ? esc(row.ico || '') : ''}">
          </div>
          <div class="form-group">
            <label>DIČ</label>
            <input name="dic" value="${row ? esc(row.dic || '') : ''}">
          </div>
          <div class="form-group">
            <label>IČ DPH</label>
            <input name="ic_dph" value="${row ? esc(row.ic_dph || '') : ''}">
          </div>
          <div class="form-group">
            <label>Kontaktná osoba</label>
            <input name="contact_name" value="${row ? esc(row.contact_name || '') : ''}">
          </div>
          <div class="form-group">
            <label>Telefón</label>
            <input name="phone" value="${row ? esc(row.phone || '') : ''}">
          </div>
          <div class="form-group">
            <label>E‑mail</label>
            <input name="email" value="${row ? esc(row.email || '') : ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Ulica a číslo</label>
          <input name="address_street" value="${row ? esc(row.address_street || '') : ''}">
        </div>
        <div class="form-grid" style="grid-template-columns:repeat(3,minmax(140px,1fr));gap:.75rem;">
          <div class="form-group">
            <label>Mesto</label>
            <input name="address_city" value="${row ? esc(row.address_city || '') : ''}">
          </div>
          <div class="form-group">
            <label>PSČ</label>
            <input name="address_zip" value="${row ? esc(row.address_zip || '') : ''}">
          </div>
          <div class="form-group">
            <label>Štát</label>
            <input name="address_country" value="${row ? esc(row.address_country || '') : ''}">
          </div>
        </div>
        <div class="form-group" style="margin-top:.5rem;">
          <label>
            <input type="checkbox" name="is_active" ${!row || row.is_active ? 'checked' : ''}>
            Aktívny dodávateľ
          </label>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:.5rem; margin-top:1rem;">
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Uložiť</button>
        </div>
      </form>
    `;
    return { html, onReady: ()=>{
      const f = $('meat-supplier-form');
      f.onsubmit = async e=>{
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f).entries());
        if (!body.name || !body.code){
          showStatus('Vyplň kód aj názov dodávateľa.', true);
          return;
        }
        body.is_active = body.is_active ? 1 : 0;

        const res = await apiM('/api/kancelaria/meat/supplier/save',{method:'POST', body});
        if (res?.error){
          showStatus(res.error,true);
          return;
        }
        $('modal-container').style.display = 'none';
        await loadSuppliersTable();
        await fillSuppliersDatalist();
        if (targetInput){
          targetInput.value = body.name;
        }
        showStatus(res.message || 'Dodávateľ uložený.', false);
      };
    }};
  });
}

async function deleteSupplier(id){
  if (!confirm('Naozaj chceš zmazať tohto dodávateľa? Historické rozrábky ostanú, ale dodávateľ zmizne z číselníka.')) return;
  const res = await apiM('/api/kancelaria/meat/supplier/delete',{method:'POST', body:{id}});
  if (res?.error){
    showStatus(res.error,true);
    return;
  }
  loadSuppliersTable();
  fillSuppliersDatalist();
}

// =================================================================
// SPOLOČNÉ: naplnenie selectov so surovinami
// =================================================================

async function fillMaterialsSelects(){
  const mats = await apiM('/api/kancelaria/meat/materials');
  const selNew = $('meat-new-material');
  const selHist= $('meat-hist-material');
  const selEst = $('meat-est-material');
  const selRep = $('meat-rep-material');

  if (Array.isArray(mats)) {
    MEAT_MATERIALS_CACHE = mats;
  }

  [selNew, selHist, selEst, selRep].forEach(s=>{
    if (!s) return;
    if (!Array.isArray(mats)) {
      console.warn('materials endpoint nevrátil pole:', mats);
      s.innerHTML = `<option value="">— (chyba API) —</option>`;
      return;
    }
    s.innerHTML = `<option value="">— Vyber —</option>` +
      mats.map(m=>`<option value="${m.id}">${esc(m.name)} (${esc(m.code)})</option>`).join('');
  });
}

// =================================================================
// EVIDENCIA: NOVÝ ZÁZNAM ROZRÁBKY
// =================================================================

async function initNewBreakdown(){
  await fillMaterialsSelects();

  const prods = await apiM('/api/kancelaria/meat/products');
  MEAT_PRODUCTS_CACHE = Array.isArray(prods) ? prods : [];
  if (!Array.isArray(prods)) {
    console.warn('products endpoint nevrátil pole:', prods);
  }

  const outWrap = $('meat-outputs-table');
  outWrap.innerHTML = buildOutputsTable([]);
  $('meat-add-output').onclick = ()=> addOutputRow();

  const exWrap = $('meat-extras-table');
  exWrap.innerHTML = buildExtrasTable([]);
  $('meat-add-extra').onclick = ()=> addExtraRow();

  $('meat-save-breakdown').onclick = saveBreakdown;
}

function buildOutputsTable(rows){
  return `
    <div class="table-container">
      <table id="meat-outputs">
        <thead>
          <tr><th>Produkt</th><th>Váha (kg)</th><th>Akcia</th></tr>
        </thead>
        <tbody>
          ${rows.map((r, idx)=>buildOutputRow(r, idx)).join('')}
        </tbody>
      </table>
    </div>`;
}

function buildOutputRow(r={}, idx=Date.now()){
  const opts = (MEAT_PRODUCTS_CACHE||[]).map(p=>`
      <option value="${p.id}" ${String(p.id)===String(r.product_id)?'selected':''}>
        ${esc(p.name)} (${esc(p.code)})
      </option>
  `).join('');
  return `
    <tr data-row="${idx}">
      <td><select class="meat-out-product">${opts}</select></td>
      <td><input type="number" class="meat-out-weight" step="0.001" value="${r.weight_kg||''}"></td>
      <td><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
    </tr>`;
}

function addOutputRow(){
  const tbody = $('meat-outputs')?.querySelector('tbody');
  if (!tbody) return;
  tbody.insertAdjacentHTML('beforeend', buildOutputRow({}));
}

function buildExtrasTable(rows){
  return `
    <div class="table-container">
      <table id="meat-extras">
        <thead><tr><th>Názov nákladu</th><th>Suma (€)</th><th>Akcia</th></tr></thead>
        <tbody>
          ${rows.map((r, idx)=>buildExtraRow(r, idx)).join('')}
        </tbody>
      </table>
    </div>`;
}

function buildExtraRow(r={}, idx=Date.now()){
  return `
    <tr data-row="${idx}">
      <td><input class="meat-extra-name" value="${esc(r.name||'')}"></td>
      <td><input type="number" class="meat-extra-amount" step="0.01" value="${r.amount_eur||''}"></td>
      <td><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
    </tr>`;
}

function addExtraRow(){
  const tbody = $('meat-extras')?.querySelector('tbody');
  if (!tbody) return;
  tbody.insertAdjacentHTML('beforeend', buildExtraRow({}));
}

async function saveBreakdown(){
  const f = $('meat-new-form');
  if (!f) return;

  const header = Object.fromEntries(new FormData(f).entries());

  const outputs = Array.from(document.querySelectorAll('#meat-outputs tbody tr')).map(tr=>({
    product_id: tr.querySelector('.meat-out-product')?.value,
    weight_kg : tr.querySelector('.meat-out-weight')?.value
  })).filter(x=>x.product_id && x.weight_kg);

  const extras = Array.from(document.querySelectorAll('#meat-extras tbody tr')).map(tr=>({
    name      : tr.querySelector('.meat-extra-name')?.value,
    amount_eur: tr.querySelector('.meat-extra-amount')?.value
  })).filter(x=>x.name && x.amount_eur);

  const payload = { header, outputs, extras };
  const res = await apiM('/api/kancelaria/meat/breakdown/save', { method:'POST', body:payload });

  if (res?.error){
    showStatus(res.error, true);
    return;
  }
  if (!res?.breakdown_id){
    showStatus('Záznam sa nepodarilo uložiť (chýba breakdown_id).', true);
    return;
  }

  showStatus(res.message || 'Záznam uložený a prepočítaný.', false);

  const data = await apiM('/api/kancelaria/meat/breakdown?id='+res.breakdown_id);
  if (data?.header) {
    renderResults(data);
  } else {
    showStatus('Nepodarilo sa načítať výsledok.', true);
  }
}

function renderResults(data){
  const el = $('meat-results');
  if (!el) return;

  const b       = data.header;
  const results = data.results || [];

  const totalOutputKg = results.reduce((a,r)=> a + Number(r.weight_kg || 0), 0);
  const totalProfit   = results.reduce((a,r)=> a + Number(r.profit_eur || 0), 0);
  const inputKg       = Number(b.input_weight_kg || 0);

  const profitPerKgOut = totalOutputKg > 0 ? totalProfit / totalOutputKg : null;
  const profitPerKgIn  = inputKg       > 0 ? totalProfit / inputKg       : null;

  let html = `
    <div class="analysis-card">
      <h4>Výsledky – rozrábka #${b.id} (${esc(b.breakdown_date)})</h4>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Váha (kg)</th>
              <th>Výťažnosť (%)</th>
              <th>Náklad €/kg</th>
              <th>Predaj €/kg</th>
              <th>Marža €/kg</th>
              <th>Zisk (€)</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r=>`
              <tr>
                <td>${esc(r.product_name)}</td>
                <td>${Number(r.weight_kg).toFixed(3)}</td>
                <td>${Number(r.yield_pct).toFixed(4)}</td>
                <td>${Number(r.cost_per_kg_eur).toFixed(4)}</td>
                <td>${Number(r.selling_price_eur_kg_snap).toFixed(3)}</td>
                <td>${Number(r.margin_eur_per_kg).toFixed(4)}</td>
                <td>${Number(r.profit_eur).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Spolu</th>
              <th>${totalOutputKg.toFixed(3)}</th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
              <th>${totalProfit.toFixed(2)}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.75rem;">
        <span class="kpi-badge">Vstupná váha: <strong>${inputKg.toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Súčet výstupov: <strong>${totalOutputKg.toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Celkový zisk: <strong>${totalProfit.toFixed(2)} €</strong></span>
        <span class="kpi-badge">Zisk / kg vstupu: <strong>${profitPerKgIn != null ? profitPerKgIn.toFixed(4) : '–'} €/kg</strong></span>
        <span class="kpi-badge">Zisk / kg výstupu: <strong>${profitPerKgOut != null ? profitPerKgOut.toFixed(4) : '–'} €/kg</strong></span>
      </div>

      <div style="display:flex; gap:.5rem; margin-top:.75rem;">
        <a class="btn btn-secondary" href="/report/meat/breakdown?id=${b.id}" target="_blank">
          <i class="fas fa-print"></i> Tlač
        </a>
        <a class="btn btn-secondary" href="/api/kancelaria/meat/breakdown/export?id=${b.id}">
          <i class="fas fa-file-excel"></i> Export XLSX
        </a>
      </div>
    </div>
  `;
  el.innerHTML = html;
}

// =================================================================
// HISTÓRIA ROZRÁBOK
// =================================================================

function initHistory(){
  fillMaterialsSelects();
  const btn = $('meat-hist-load');
  if (btn) btn.onclick = loadHistory;
}

async function loadHistory(){
  const params = new URLSearchParams();
  const mid = $('meat-hist-material')?.value; if (mid) params.set('material_id', mid);
  const df  = $('meat-hist-from')?.value;     if (df)  params.set('date_from', df);
  const dt  = $('meat-hist-to')?.value;       if (dt)  params.set('date_to', dt);
  const sup = $('meat-hist-sup')?.value;      if (sup) params.set('supplier', sup);

  const rows = await apiM('/api/kancelaria/meat/breakdowns?'+params.toString());
  const div  = $('meat-hist-table');

  if (!div) return;

  if (!Array.isArray(rows)) {
    console.warn('breakdowns endpoint nevrátil pole:', rows);
    div.innerHTML = '<p class="error">Nepodarilo sa načítať históriu (skontroluj route /api/kancelaria/meat/breakdowns).</p>';
    return;
  }
  if (!rows.length){
    div.innerHTML = '<p>Žiadne dáta pre zadaný filter.</p>';
    return;
  }

  let html = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Dátum</th>
            <th>Surovina</th>
            <th>Dodávateľ</th>
            <th>Vstup (kg)</th>
            <th>€ celkom</th>
            <th>Akcie</th>
          </tr>
        </thead>
        <tbody>
  `;
  rows.forEach(r=>{
    html += `
      <tr>
        <td>${esc(r.breakdown_date)}</td>
        <td>${esc(r.material_name)}</td>
        <td>${esc(r.supplier||'')}</td>
        <td>${Number(r.input_weight_kg).toFixed(3)}</td>
        <td>${Number(r.purchase_total_cost_eur||0).toFixed(2)}</td>
        <td style="white-space:nowrap; display:flex; gap:.25rem;">
          <a class="btn btn-secondary btn-xs" href="/report/meat/breakdown?id=${r.id}" target="_blank" title="Tlačový report">
            <i class="fas fa-file"></i>
          </a>
          <a class="btn btn-outline-secondary btn-xs" href="/api/kancelaria/meat/breakdown/export?id=${r.id}" title="Export do Excelu">
            <i class="fas fa-file-excel"></i>
          </a>
          <button class="btn btn-warning btn-xs" onclick="meatEditBreakdown(${r.id})" title="Upraviť">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-danger btn-xs" onclick="meatDeleteBreakdown(${r.id})" title="Zmazať">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  });
  html += '</tbody></table></div>';
  div.innerHTML = html;
}

async function meatEditBreakdown(id){
  const data = await apiM('/api/kancelaria/meat/breakdown?id='+id);
  if (!data || !data.header){
    showStatus('Nepodarilo sa načítať záznam rozrábky.', true);
    return;
  }

  const btn = document.querySelector('#section-meat-calc .b2b-tab-button[data-meat-tab="new"]');
  if (btn) btn.click();

  setTimeout(()=>{
    const f = $('meat-new-form');
    if (!f) return;
    const h = data.header;

    const hid = $('meat-breakdown-id');
    if (hid) hid.value = h.id || '';

    if (f.breakdown_date)              f.breakdown_date.value = h.breakdown_date || '';
    if (f.material_id)                 f.material_id.value = String(h.material_id || '');
    const supInput = $('meat-supplier-input');
    if (supInput)                      supInput.value = h.supplier || '';
    const supId = $('meat-supplier-id');
    if (supId)                         supId.value = h.supplier_id || '';
    if (f.supplier_batch_code)         f.supplier_batch_code.value = h.supplier_batch_code || '';
    if (f.units_count)                 f.units_count.value = h.units_count || '';
    if (f.workers_count)               f.workers_count.value = h.workers_count || '';
    if (f.duration_minutes)            f.duration_minutes.value = h.duration_minutes || '';
    if (f.input_weight_kg)            f.input_weight_kg.value = h.input_weight_kg || '';
    if (f.purchase_total_cost_eur)    f.purchase_total_cost_eur.value = h.purchase_total_cost_eur || '';
    if (f.purchase_unit_price_eur_kg) f.purchase_unit_price_eur_kg.value = h.purchase_unit_price_eur_kg || '';
    if (f.tolerance_pct)              f.tolerance_pct.value = h.tolerance_pct || '';
    if (f.note)                       f.note.value = h.note || '';

    $('meat-outputs-table').innerHTML = buildOutputsTable(data.outputs || []);
    $('meat-extras-table').innerHTML  = buildExtrasTable(data.extras || []);

    $('meat-add-output').onclick = ()=> addOutputRow();
    $('meat-add-extra').onclick  = ()=> addExtraRow();

    if (Array.isArray(data.results) && data.results.length){
      renderResults(data);
    } else {
      $('meat-results').innerHTML = '';
    }
  }, 50);
}

async function meatDeleteBreakdown(id){
  if (!confirm('Naozaj chceš zmazať tento záznam rozrábky? Operácia je nevratná.')) return;
  const res = await apiM('/api/kancelaria/meat/breakdown/delete',{method:'POST', body:{id}});
  if (res?.error){
    showStatus(res.error, true);
    return;
  }
  showStatus('Rozrábka zmazaná.', false);
  loadHistory();
}

// =================================================================
// REPORTY – súhrn ziskov za obdobie
// =================================================================

function initReports(){
  // materiály pre selecty
  fillMaterialsSelects();

  const runBtn = $('meat-rep-run');
  if (runBtn) runBtn.onclick = runSummaryReport;

  const supInput = $('meat-rep-sup');
  if (supInput) supInput.setAttribute('list','meat-suppliers-datalist');

  const printBtn = $('meat-rep-print');
  if (printBtn) printBtn.onclick = printSummaryReport;
}


async function runSummaryReport(){
  const box = $('meat-report-results');
  if (!box) return;
  box.innerHTML = '<p>Prebieha načítavanie...</p>';

  const params = new URLSearchParams();
  const mid = $('meat-rep-material')?.value;
  const df  = $('meat-rep-from')?.value;
  const dt  = $('meat-rep-to')?.value;
  const sup = $('meat-rep-sup')?.value;

  if (mid) params.set('material_id', mid);
  if (df)  params.set('date_from', df);
  if (dt)  params.set('date_to', dt);
  if (sup) params.set('supplier', sup);

  const list = await apiM('/api/kancelaria/meat/breakdowns?'+params.toString());

  if (!Array.isArray(list)){
    box.innerHTML = '<p class="error">Nepodarilo sa načítať zoznam rozrábiek pre report.</p>';
    return;
  }
  if (!list.length){
    box.innerHTML = '<p>Žiadne dáta pre zadaný filter.</p>';
    return;
  }

  const summaryRows = [];
  let totalInputKg = 0, totalOutputKg = 0, totalProfit = 0;

  for (const row of list){
    const detail = await apiM('/api/kancelaria/meat/breakdown?id='+row.id);
    if (!detail || !Array.isArray(detail.results)){
      continue;
    }
    const res = detail.results;

    const outKg   = res.reduce((a,r)=> a + Number(r.weight_kg || 0), 0);
    const profit  = res.reduce((a,r)=> a + Number(r.profit_eur || 0), 0);
    const inputKg = Number(detail.header?.input_weight_kg || row.input_weight_kg || 0);
    const cost    = Number(detail.header?.purchase_total_cost_eur || row.purchase_total_cost_eur || 0);

    const profitPerKgOut = outKg > 0 ? profit / outKg : null;

    totalInputKg  += inputKg;
    totalOutputKg += outKg;
    totalProfit   += profit;

    summaryRows.push({
      id: row.id,
      date: row.breakdown_date,
      material: row.material_name,
      supplier: row.supplier || '',
      inputKg,
      outputKg: outKg,
      totalCost: cost,
      totalProfit: profit,
      profitPerKgOut
    });
  }

  if (!summaryRows.length){
    box.innerHTML = '<p class="error">Nepodarilo sa načítať detailné údaje pre report.</p>';
    return;
  }

  const overallProfitPerKgOut = totalOutputKg > 0 ? totalProfit / totalOutputKg : null;
  const overallProfitPerKgIn  = totalInputKg  > 0 ? totalProfit / totalInputKg  : null;

  let html = `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Dátum</th>
            <th>Surovina</th>
            <th>Dodávateľ</th>
            <th>Vstup (kg)</th>
            <th>Výstup (kg)</th>
            <th>Nákup spolu (€)</th>
            <th>Zisk spolu (€)</th>
            <th>Zisk / kg výstupu (€)</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows.map(r=>`
            <tr>
              <td>${esc(r.date)}</td>
              <td>${esc(r.material)}</td>
              <td>${esc(r.supplier)}</td>
              <td>${r.inputKg.toFixed(3)}</td>
              <td>${r.outputKg.toFixed(3)}</td>
              <td>${r.totalCost.toFixed(2)}</td>
              <td>${r.totalProfit.toFixed(2)}</td>
              <td>${r.profitPerKgOut != null ? r.profitPerKgOut.toFixed(4) : ''}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th>Spolu</th>
            <th></th>
            <th></th>
            <th>${totalInputKg.toFixed(3)}</th>
            <th>${totalOutputKg.toFixed(3)}</th>
            <th></th>
            <th>${totalProfit.toFixed(2)}</th>
            <th>${overallProfitPerKgOut != null ? overallProfitPerKgOut.toFixed(4) : ''}</th>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.5rem;">
      <span class="kpi-badge">Vstupná váha spolu: <strong>${totalInputKg.toFixed(3)} kg</strong></span>
      <span class="kpi-badge">Výstupná váha spolu: <strong>${totalOutputKg.toFixed(3)} kg</strong></span>
      <span class="kpi-badge">Celkový zisk: <strong>${totalProfit.toFixed(2)} €</strong></span>
      <span class="kpi-badge">Zisk / kg vstupu: <strong>${overallProfitPerKgIn != null ? overallProfitPerKgIn.toFixed(4) : '–'} €/kg</strong></span>
      <span class="kpi-badge">Zisk / kg výstupu: <strong>${overallProfitPerKgOut != null ? overallProfitPerKgOut.toFixed(4) : '–'} €/kg</strong></span>
    </div>
  `;

  box.innerHTML = html;
}
function printSummaryReport(){
  // zober aktuálne filtre z karty "Reporty"
  const material_id = $('meat-rep-material')?.value || '';
  const df          = $('meat-rep-from')?.value || '';
  const dt          = $('meat-rep-to')?.value || '';
  const sup         = $('meat-rep-sup')?.value || '';

  const params = new URLSearchParams();
  if (material_id) params.set('material_id', material_id);
  if (df)          params.set('date_from', df);
  if (dt)          params.set('date_to', dt);
  if (sup)         params.set('supplier', sup);

  // nová tlačová URL – otvorí sa v novom okne/karte
  const url = '/report/meat/summary' + (params.toString() ? '?' + params.toString() : '');
  window.open(url, '_blank');
}

// =================================================================
// ODHAD ROZRÁBKY
// =================================================================

function initEstimate(){
  fillMaterialsSelects();
  $('meat-est-extras').innerHTML = buildEstExtrasTable([]);
  const addBtn = $('meat-est-add-extra');
  if (addBtn) addBtn.onclick = ()=> addEstExtraRow();
  const runBtn = $('meat-est-run');
  if (runBtn) runBtn.onclick = runEstimate;
}

function buildEstExtrasTable(rows){
  return `
    <div class="table-container">
      <table id="meat-est-extras-table">
        <thead><tr><th>Názov nákladu</th><th>Suma (€)</th><th>Akcia</th></tr></thead>
        <tbody>
          ${rows.map((r,idx)=> buildEstExtraRow(r,idx)).join('')}
        </tbody>
      </table>
    </div>`;
}

function buildEstExtraRow(r={}, idx=Date.now()){
  return `
    <tr data-row="${idx}">
      <td><input class="meat-est-extra-name" value="${esc(r.name||'')}"></td>
      <td><input type="number" class="meat-est-extra-amount" step="0.01" value="${r.amount_eur||''}"></td>
      <td><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()"><i class="fas fa-trash"></i></button></td>
    </tr>`;
}

function addEstExtraRow(){
  const tbody = $('meat-est-extras-table')?.querySelector('tbody');
  if (!tbody) return;
  tbody.insertAdjacentHTML('beforeend', buildEstExtraRow({}));
}

async function runEstimate(){
  const box = $('meat-est-results');
  if (!box) return;

  const material_id = $('meat-est-material')?.value;
  const planned_weight_kg = Number($('meat-est-weight')?.value || 0);
  const expected_purchase_unit_price = Number($('meat-est-price')?.value || 0);
  const supplier  = $('meat-est-sup')?.value || null;
  const date_from = $('meat-est-from')?.value || null;
  const date_to   = $('meat-est-to')?.value || null;

  const extras = Array.from(document.querySelectorAll('#meat-est-extras-table tbody tr')).map(tr=>({
    name      : tr.querySelector('.meat-est-extra-name')?.value,
    amount_eur: tr.querySelector('.meat-est-extra-amount')?.value
  })).filter(x=>x.name && x.amount_eur);

  const payload = {
    material_id: Number(material_id),
    planned_weight_kg,
    expected_purchase_unit_price,
    supplier,
    date_from,
    date_to,
    extras
  };

  const res = await apiM('/api/kancelaria/meat/estimate',{method:'POST', body:payload});

  if (res?.error){
    box.innerHTML = `<p class="error">${esc(res.error)}</p>`;
    return;
  }
  if (!res || !Array.isArray(res.rows)) {
    box.innerHTML = '<p class="error">Chybná odpoveď od API.</p>';
    return;
  }

  // cache produktov – ak ešte neboli načítané
  if (!Array.isArray(MEAT_PRODUCTS_CACHE) || !MEAT_PRODUCTS_CACHE.length) {
    const prods = await apiM('/api/kancelaria/meat/products');
    MEAT_PRODUCTS_CACHE = Array.isArray(prods) ? prods : [];
  }

  const rows = res.rows || [];

  // ====== SUMÁR ODHADU ==================================================
  const totalOutputKg = rows.reduce((a,r)=> a + Number(r.weight_kg || 0), 0);
  const totalProfit   = rows.reduce((a,r)=> a + Number(r.profit_eur || 0), 0);
  const totalCost     = rows.reduce((a,r)=> a + Number(r.weight_kg || 0) * Number(r.cost_per_kg_eur || 0), 0);
  const totalRevenue  = rows.reduce((a,r)=> a + Number(r.weight_kg || 0) * Number(r.selling_price_eur_kg || 0), 0);

  const plannedInKg   = Number(res.planned_weight_kg || planned_weight_kg || 0);
  const profitPerKgIn = plannedInKg   > 0 ? totalProfit / plannedInKg   : null;
  const profitPerKgOut= totalOutputKg > 0 ? totalProfit / totalOutputKg : null;
  const marginPct     = totalRevenue  > 0 ? (totalProfit / totalRevenue) * 100.0 : null;
  const avgCostPerKgIn= (plannedInKg > 0 && totalCost > 0) ? (totalCost / plannedInKg) : null;

  const sumKg = Number(res.sum_estimated_weight_kg || totalOutputKg);

  // ====== RENDER TABUĽKY + SUMÁRU =======================================
  let html = `
    <div class="analysis-card">
      <h4>Odhad výsledkov</h4>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Produkt</th>
              <th>Váha (kg)</th>
              <th>Výťažnosť (%)</th>
              <th>Náklad €/kg</th>
              <th>Predaj €/kg</th>
              <th>Marža €/kg</th>
              <th>Zisk (€)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r=>{
              const p = (MEAT_PRODUCTS_CACHE||[]).find(x=>String(x.id)===String(r.product_id));
              return `
                <tr>
                  <td>${esc(p ? p.name : '#'+r.product_id)}</td>
                  <td>${Number(r.weight_kg).toFixed(3)}</td>
                  <td>${Number(r.yield_pct).toFixed(4)}</td>
                  <td>${Number(r.cost_per_kg_eur).toFixed(4)}</td>
                  <td>${Number(r.selling_price_eur_kg).toFixed(3)}</td>
                  <td>${Number(r.margin_eur_per_kg).toFixed(4)}</td>
                  <td>${Number(r.profit_eur).toFixed(2)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <th>Spolu</th>
              <th>${totalOutputKg.toFixed(3)}</th>
              <th></th>
              <th></th>
              <th></th>
              <th></th>
              <th>${totalProfit.toFixed(2)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin:.5rem 0;">
        <span class="kpi-badge">Plánovaná nákupná váha: <strong>${plannedInKg.toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Priem. tolerancia straty: <strong>${Number(res.avg_tolerance_pct||0).toFixed(2)} %</strong></span>
        <span class="kpi-badge">Efektívna výstupná váha: <strong>${Number(res.effective_output_weight_kg||0).toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Súčet odhadovaných váh: <strong>${sumKg.toFixed(3)} kg</strong></span>

        <span class="kpi-badge">Odhadovaný zisk spolu: <strong>${totalProfit.toFixed(2)} €</strong></span>
        <span class="kpi-badge">Priemerná marža: <strong>${marginPct != null ? marginPct.toFixed(2) : '–'} %</strong></span>
        <span class="kpi-badge">Nákupná cena / kg vstupu: <strong>${avgCostPerKgIn != null ? avgCostPerKgIn.toFixed(4) : '–'} €/kg</strong></span>
        <span class="kpi-badge">Zisk / kg vstupu: <strong>${profitPerKgIn != null ? profitPerKgIn.toFixed(4) : '–'} €/kg</strong></span>
        <span class="kpi-badge">Zisk / kg výstupu: <strong>${profitPerKgOut != null ? profitPerKgOut.toFixed(4) : '–'} €/kg</strong></span>
      </div>
    </div>
  `;

  box.innerHTML = html;
}

// =================================================================
// AUTO-REGISTER
// =================================================================

(function(){
  const root = document.getElementById('section-meat-calc');
  if (root) initializeMeatCalcModule();
})();
