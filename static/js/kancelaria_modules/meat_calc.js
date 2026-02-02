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
    /* Fallback pre tab obsah */
    #section-meat-calc .b2b-tab-content { display:none; }
    #section-meat-calc .b2b-tab-content.active { display:block; }
    #section-meat-calc .btn { border-radius:9999px; }
    
    /* Vylepšenia pre rýchlu tabuľku */
    .meat-input-compact { padding: 4px 8px; font-weight: bold; text-align: right; }
    .meat-row-highlight { background-color: #f0f8ff; }
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
      <button class="b2b-tab-button" data-meat-tab="templates">Šablóny</button> <!-- NOVÝ TAB -->
      <button class="b2b-tab-button" data-meat-tab="new">Evidencia (nový záznam)</button>
      <button class="b2b-tab-button" data-meat-tab="history">História</button>
      <button class="b2b-tab-button" data-meat-tab="estimate">Odhad Rozrábky</button>
      <button class="b2b-tab-button" data-meat-tab="reports">Reporty</button>
    </div>

    <!-- SETTINGS (Pôvodné) -->
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

    <!-- TEMPLATES TAB (NOVÝ) -->
    <div id="templates-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <h4>Správa šablón (Receptov)</h4>
        <div style="display:flex; gap:.5rem; margin:.5rem 0;">
            <button class="btn btn-success" id="meat-add-template"><i class="fas fa-plus"></i> Nová šablóna</button>
            <button class="btn btn-secondary" id="meat-refresh-templates"><i class="fas fa-rotate"></i> Obnoviť</button>
        </div>
        <div id="meat-templates-table"></div>
      </div>
    </div>

    <!-- NEW BREAKDOWN (VYLEPŠENÝ FORMULÁR) -->
    <div id="new-tab" class="b2b-tab-content" style="margin-top:1rem;">
      <div class="analysis-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <h4>Nový záznam rozrábky</h4>
            <!-- VYLEPŠENIE: Načítanie šablóny -->
            <div style="display:flex; gap:0.5rem; align-items:center; background:#eef; padding:5px 10px; border-radius:8px;">
                <label style="margin:0; font-weight:bold;">Šablóna:</label>
                <select id="meat-template-select" style="padding:4px; border-radius:4px; border:1px solid #ccc; width:200px;">
                    <option value="">-- Vyber --</option>
                </select>
                <button class="btn btn-primary btn-xs" id="meat-load-template-btn">Načítať</button>
            </div>
        </div>

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
              </div>
              <datalist id="meat-suppliers-datalist"></datalist>
            </div>
            <div class="form-group">
              <label>Šarža / Dodávka</label>
              <input name="supplier_batch_code" placeholder="napr. LOT-...">
            </div>
            <div class="form-group">
              <label>Počet kusov</label>
              <input type="number" name="units_count" step="1">
            </div>
            <div class="form-group">
              <label>Počet ľudí</label>
              <input type="number" name="workers_count" step="1" min="1">
            </div>
            <div class="form-group">
              <label>Čas (min)</label>
              <input type="number" name="duration_minutes" step="1" min="0">
            </div>
            <div class="form-group">
              <label>Vstupná váha (kg)</label>
              <input type="number" name="input_weight_kg" step="0.001" required style="background:#fffde7; font-weight:bold;">
            </div>
            <div class="form-group">
              <label>Nákup celkom (€)</label>
              <input type="number" name="purchase_total_cost_eur" step="0.01">
            </div>
            <div class="form-group">
              <label>alebo Cena (€/kg)</label>
              <input type="number" name="purchase_unit_price_eur_kg" step="0.0001">
            </div>
            <div class="form-group">
              <label>Tolerancia (%)</label>
              <input type="number" name="tolerance_pct" step="0.001" value="2.000">
            </div>
            <div class="form-group" style="grid-column:1/-1;">
              <label>Poznámka</label>
              <input name="note">
            </div>
          </div>
        </form>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <!-- VYLEPŠENIE: Rýchle pridanie -->
        <div style="background:#f8f9fa; padding:10px; border-radius:8px; margin-bottom:10px; display:flex; gap:10px; align-items:flex-end; border:1px solid #ddd;">
            <div style="flex:1;">
                <label style="font-size:0.8rem; font-weight:bold;">RÝCHLE PRIDANIE PRODUKTU (Napíš názov a Enter)</label>
                <input list="meat-products-datalist" id="meat-quick-add-product" class="form-control" placeholder="Napr. Krkovička..." autocomplete="off">
                <datalist id="meat-products-datalist"></datalist>
            </div>
            <button class="btn btn-success" id="meat-quick-add-btn"><i class="fas fa-plus"></i> Pridať</button>
        </div>

        <div id="meat-outputs-table"></div>
      </div>

      <div class="analysis-card" style="margin-top:1rem;">
        <h4>Dodatočné náklady</h4>
        <div id="meat-extras-table"></div>
        <div style="display:flex; gap:.5rem; margin-top:.5rem;">
          <button class="btn btn-secondary" id="meat-add-extra"><i class="fas fa-plus"></i> Pridať náklad</button>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; margin-top:1rem; align-items:center;">
        <div id="meat-live-stats" style="font-weight:bold; color:#555;"></div>
        <button class="btn btn-success btn-lg" id="meat-save-breakdown"><i class="fas fa-save"></i> Uložiť záznam</button>
      </div>

      <div id="meat-results" style="margin-top:1rem;"></div>
    </div>

    <!-- HISTORY (Pôvodné) -->
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

    <!-- ESTIMATE (Pôvodné) -->
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

    <!-- REPORTS (Pôvodné) -->
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

  // Prepínanie tabov - OPRAVENÁ VERZIA
  const tabButtons  = document.querySelectorAll('#section-meat-calc .b2b-tab-button');
  const tabContents = document.querySelectorAll('#section-meat-calc .b2b-tab-content');

  tabButtons.forEach(button => {
    button.onclick = () => {
      // 1. Deaktivuj všetky taby
      tabButtons.forEach(b => b.classList.remove('active'));
      button.classList.add('active');

      tabContents.forEach(c => {
        c.classList.remove('active');
        c.style.display = 'none';
      });

      // 2. Aktivuj vybraný tab
      const tabName = button.dataset.meatTab;
      const paneId = `${tabName}-tab`;
      const pane = document.getElementById(paneId);
      
      if (pane) {
        pane.classList.add('active');
        pane.style.display = 'block';
      }

      // 3. LOGIKA REFRESHU: Ak prepneme na konkrétny tab, načítame dáta nanovo
      if (tabName === 'new') {
        // Obnovíme select šablón v novej evidencii
        if (typeof loadTemplatesDropdown === 'function') loadTemplatesDropdown();
      } 
      else if (tabName === 'templates') {
        // Obnovíme zoznam šablón v správe šablón
        if (typeof loadTemplatesTable === 'function') loadTemplatesTable();
      }
      else if (tabName === 'settings') {
        // Pre istotu obnovíme číselníky
        loadMaterialsTable();
        loadProductsTable();
        loadSuppliersTable();
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
  initTemplatesTab(); // INIT ŠABLÓN
  initHistory();
  initEstimate();
  initReports();
  fillSuppliersDatalist();
}

// =================================================================
// DODÁVATELIA
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
  wrapper.style.flex = '1';

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
    tbl.innerHTML = '<p class="error">Nepodarilo sa načítať suroviny.</p>';
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
        if (res?.error) { showStatus(res.error, true); return; }
        $('modal-container').style.display = 'none';
        loadMaterialsTable();
        fillMaterialsSelects();
      };
    }};
  });
}

async function deleteMaterial(id){
  if (!confirm('Naozaj chceš zmazať túto surovinu?')) return;
  const res = await apiM('/api/kancelaria/meat/material/delete',{method:'POST', body:{id}});
  if (res?.error){ showStatus(res.error,true); return; }
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
    tbl.innerHTML = '<p class="error">Nepodarilo sa načítať produkty.</p>';
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
        if (res?.error) { showStatus(res.error, true); return; }
        $('modal-container').style.display = 'none';
        loadProductsTable();
      };
    }};
  });
}

async function deleteProduct(id){
  if (!confirm('Naozaj chceš zmazať tento produkt?')) return;
  const res = await apiM('/api/kancelaria/meat/product/delete',{method:'POST', body:{id}});
  if (res?.error){ showStatus(res.error,true); return; }
  loadProductsTable();
}

// =================================================================
// NASTAVENIA: DODÁVATELIA (Zostáva zachované)
// =================================================================

async function loadSuppliersTable(){
  const tbl = $('meat-suppliers-table');
  if (!tbl) return;
  const rows = await apiM('/api/kancelaria/meat/suppliers');
  if (!Array.isArray(rows)) { tbl.innerHTML = '<p class="error">Chyba načítania.</p>'; return; }
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
          <div class="form-group"><label>Kód</label><input name="code" value="${row ? esc(row.code || '') : ''}" required></div>
          <div class="form-group"><label>Názov dodávateľa</label><input name="name" value="${esc(namePrefill)}" required></div>
          <!-- (Ostatné polia skrátené pre prehľadnosť, ale v realite tu môžu byť) -->
        </div>
        <button type="submit" class="btn btn-success" style="margin-top:1rem;">Uložiť</button>
      </form>
    `;
    return { html, onReady: ()=>{
      const f = $('meat-supplier-form');
      f.onsubmit = async e=>{
        e.preventDefault();
        const body = Object.fromEntries(new FormData(f).entries());
        const res = await apiM('/api/kancelaria/meat/supplier/save',{method:'POST', body});
        if (res?.error){ showStatus(res.error,true); return; }
        $('modal-container').style.display = 'none';
        await loadSuppliersTable();
        await fillSuppliersDatalist();
        if (targetInput){ targetInput.value = body.name; }
        showStatus(res.message || 'Uložené.', false);
      };
    }};
  });
}

async function deleteSupplier(id){
  if (!confirm('Naozaj zmazať dodávateľa?')) return;
  const res = await apiM('/api/kancelaria/meat/supplier/delete',{method:'POST', body:{id}});
  if (res?.error){ showStatus(res.error,true); return; }
  loadSuppliersTable();
  fillSuppliersDatalist();
}

// =================================================================
// SPOLOČNÉ: Suroviny Select
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
    s.innerHTML = `<option value="">— Vyber —</option>` +
      (Array.isArray(mats) ? mats.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('') : '');
  });
}

// =================================================================
// EVIDENCIA: NOVÝ ZÁZNAM ROZRÁBKY (LOGIKA)
// =================================================================

async function initNewBreakdown(){
  await fillMaterialsSelects();
  
  // Načítame produkty pre datalist (cache)
  const prods = await apiM('/api/kancelaria/meat/products');
  MEAT_PRODUCTS_CACHE = Array.isArray(prods) ? prods : [];
  fillProductsDatalist();

  // Načítanie šablón do selectu
  loadTemplatesDropdown();

  // Vyrenderovanie prázdnej tabuľky
  renderOutputsTable([]);

  const exWrap = $('meat-extras-table');
  exWrap.innerHTML = buildExtrasTable([]);
  $('meat-add-extra').onclick = ()=> addExtraRow();

  $('meat-save-breakdown').onclick = saveBreakdown;
  $('meat-load-template-btn').onclick = loadSelectedTemplate;
  $('meat-quick-add-btn').onclick = quickAddProductRow;

  // Enter v search poli
  const qInput = $('meat-quick-add-product');
  if(qInput){
      qInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            quickAddProductRow();
        }
    });
  }
}

async function fillProductsDatalist(){
    const dl = document.getElementById('meat-products-datalist');
    if(dl) {
        dl.innerHTML = MEAT_PRODUCTS_CACHE.map(p => 
            `<option value="${esc(p.name)} [${esc(p.code)}]"></option>`
        ).join('');
    }
}

// --- Šablóny v New Breakdown ---
async function loadTemplatesDropdown(){
    const rows = await apiM('/api/kancelaria/meat/calc/templates?t=' + Date.now());
    console.log("Odpoveď zo servera:", rows); // Ak je tu [], tak Python nič nenašiel
    
    const sel = document.getElementById('meat-template-select');
    if(!sel) return;

    if (rows.__error) {
        alert("API Chyba: " + rows.__error);
        return;
    }

    sel.innerHTML = '<option value="">-- Vyber šablónu --</option>' + 
        (Array.isArray(rows) ? rows.map(t => `<option value="${t.id}" data-material="${t.material_id}">${esc(t.name)}</option>`).join('') : '');
}

async function loadSelectedTemplate(){
    const sel = $('meat-template-select');
    const tmplId = sel.value;
    if(!tmplId) { showStatus('Vyber šablónu.', true); return; }

    const selectedOpt = sel.options[sel.selectedIndex];
    const matId = selectedOpt.getAttribute('data-material');
    if($('meat-new-material')) $('meat-new-material').value = matId;

    const data = await apiM(`/api/kancelaria/meat/calc/template/details?id=${tmplId}`);
    if(data.error) { showStatus(data.error, true); return; }

    // Vyčisti tabuľku a naplň novými
    const tbody = document.querySelector('#meat-outputs tbody');
    if(tbody) tbody.innerHTML = '';
    
    data.items.forEach(item => {
        addOutputRowUI({
            product_id: item.product_id,
            product_name: item.product_name,
            product_code: item.code,
            price: item.current_price,
            weight: ''
        });
    });
    
    // Focus na prvú váhu
    const firstInput = tbody.querySelector('input.meat-out-weight');
    if(firstInput) firstInput.focus();
    
    updateLiveStats();
}

// --- Rýchle pridanie (Quick Add) ---
function quickAddProductRow(){
    const input = $('meat-quick-add-product');
    const val = input.value.trim();
    if(!val) return;

    let prod = null;
    const codeMatch = val.match(/\[(.*?)\]/);
    if(codeMatch) prod = MEAT_PRODUCTS_CACHE.find(p => p.code === codeMatch[1]);
    
    if(!prod) prod = MEAT_PRODUCTS_CACHE.find(p => p.name.toLowerCase() === val.toLowerCase());
    if(!prod) prod = MEAT_PRODUCTS_CACHE.find(p => val.toLowerCase().includes(p.name.toLowerCase()));

    if(prod){
        addOutputRowUI({
            product_id: prod.id,
            product_name: prod.name,
            product_code: prod.code,
            price: prod.selling_price_eur_kg,
            weight: ''
        });
        input.value = '';
        input.focus();
        updateLiveStats();
    } else {
        showStatus('Produkt sa nenašiel.', true);
    }
}

// --- Renderovanie Tabuľky (Nový štýl) ---
function renderOutputsTable(rows){
    const el = $('meat-outputs-table');
    el.innerHTML = `
      <div class="table-container">
        <table id="meat-outputs" class="table-compact" style="width:100%">
          <thead>
            <tr>
              <th style="width:40%">Produkt</th>
              <th style="width:25%">Váha (kg)</th>
              <th style="width:25%">Cena (€/kg)</th>
              <th style="width:10%"></th>
            </tr>
          </thead>
          <tbody></tbody>
          <tfoot>
             <tr style="font-weight:bold; background:#eee;">
                <td>SPOLU:</td>
                <td id="meat-sum-weight">0.000</td>
                <td colspan="2"></td>
             </tr>
          </tfoot>
        </table>
      </div>`;
    
    rows.forEach(r => addOutputRowUI(r));
}

function addOutputRowUI(data){
    const tbody = document.querySelector('#meat-outputs tbody');
    if(!tbody) return;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="hidden" class="meat-out-id" value="${data.product_id}">
        <span style="font-weight:600;">${esc(data.product_name)}</span> 
        <small class="text-muted">(${esc(data.product_code)})</small>
      </td>
      <td>
        <input type="number" class="form-control meat-input-compact meat-out-weight" step="0.001" placeholder="0.000" value="${data.weight||''}">
      </td>
      <td>
        <input type="number" class="form-control meat-input-compact meat-out-price" step="0.001" value="${Number(data.price||0).toFixed(3)}">
      </td>
      <td>
        <button class="btn btn-danger btn-xs" tabindex="-1" onclick="this.closest('tr').remove(); updateLiveStats();">&times;</button>
      </td>
    `;
    tbody.appendChild(tr);

    const wInput = tr.querySelector('.meat-out-weight');
    wInput.addEventListener('input', updateLiveStats);
    wInput.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter') {
            e.preventDefault();
            const nextRow = tr.nextElementSibling;
            if(nextRow) {
                nextRow.querySelector('.meat-out-weight').focus();
            } else {
                $('meat-quick-add-product').focus();
            }
        }
    });
}

function updateLiveStats(){
    const weights = document.querySelectorAll('.meat-out-weight');
    let sum = 0;
    weights.forEach(i => sum += Number(i.value || 0));
    
    const display = $('meat-sum-weight');
    if(display) display.textContent = sum.toFixed(3);
    
    const inputW = Number(document.querySelector('input[name="input_weight_kg"]')?.value || 0);
    const diff = inputW - sum;
    const stats = $('meat-live-stats');
    if(stats && inputW > 0){
        const pct = (diff / inputW) * 100;
        let color = Math.abs(pct) < 2.0 ? 'green' : 'red';
        stats.innerHTML = `Rozdiel: <span style="color:${color}">${diff.toFixed(3)} kg (${pct.toFixed(2)}%)</span>`;
    }
}

// Event na vstupnú váhu
const inWeight = document.querySelector('input[name="input_weight_kg"]');
if(inWeight) inWeight.addEventListener('input', updateLiveStats);


// --- Extras (Ponechané pôvodné) ---
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

// --- SAVE BREAKDOWN ---
async function saveBreakdown(){
  const f = $('meat-new-form');
  if (!f) return;

  const header = Object.fromEntries(new FormData(f).entries());

  // Zbieranie riadkov z novej tabuľky
  const outputs = [];
  document.querySelectorAll('#meat-outputs tbody tr').forEach(tr => {
      const pid = tr.querySelector('.meat-out-id')?.value;
      const w = tr.querySelector('.meat-out-weight')?.value;
      // const price = tr.querySelector('.meat-out-price')?.value; // Ak by sme chceli ukladať cenu
      
      if(pid && w && Number(w) > 0){
          outputs.push({ product_id: pid, weight_kg: w });
      }
  });

  const extras = Array.from(document.querySelectorAll('#meat-extras tbody tr')).map(tr=>({
    name      : tr.querySelector('.meat-extra-name')?.value,
    amount_eur: tr.querySelector('.meat-extra-amount')?.value
  })).filter(x=>x.name && x.amount_eur);

  const payload = { header, outputs, extras };
  const res = await apiM('/api/kancelaria/meat/breakdown/save', { method:'POST', body:payload });

  if (res?.error){ showStatus(res.error, true); return; }
  if (!res?.breakdown_id){ showStatus('Záznam sa nepodarilo uložiť.', true); return; }

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
// 2. SPRÁVA ŠABLÓN (NOVÉ)
// =================================================================

async function initTemplatesTab(){
    loadTemplatesTable();
    $('meat-add-template').onclick = () => openTemplateModal();
    $('meat-refresh-templates').onclick = loadTemplatesTable;
}

async function loadTemplatesTable(){
    // Pridaný timestamp t=... pre zabránenie cacheovaniu v prehliadači
    const rows = await apiM('/api/kancelaria/meat/calc/templates?t=' + Date.now());
    console.log("Načítané šablóny:", rows); // Debug log

    const div = $('meat-templates-table');
    if(!div) return;
    
    if(!Array.isArray(rows) || rows.length === 0) {
        div.innerHTML = '<p class="text-muted">Zatiaľ žiadne šablóny.</p>';
        return;
    }

    let html = `
    <div class="table-container">
      <table>
        <thead><tr><th>Názov šablóny</th><th>Surovina</th><th>Akcia</th></tr></thead>
        <tbody>
          ${rows.map(t => `
            <tr>
                <td><strong>${esc(t.name)}</strong></td>
                <td>${esc(t.material_name)}</td>
                <td>
                    <button class="btn btn-warning btn-xs" onclick="openTemplateModal(${t.id})"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="deleteTemplate(${t.id})"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
    div.innerHTML = html;
}

window.openTemplateModal = async function(id=null){
    let tmpl = null;
    let items = [];
    if(id){
        const detail = await apiM('/api/kancelaria/meat/calc/template/details?id='+id);
        if(!detail.error){ tmpl = detail.template; items = detail.items || []; }
    }

    const materialsOpts = MEAT_MATERIALS_CACHE.map(m => 
        `<option value="${m.id}" ${tmpl && tmpl.material_id == m.id ? 'selected' : ''}>${esc(m.name)}</option>`
    ).join('');

    const modalHtml = `
      <div class="form-group">
        <label>Názov šablóny</label>
        <input id="tmpl-name" class="form-control" value="${esc(tmpl?.name||'')}" placeholder="Napr. Bravčová polovička">
      </div>
      <div class="form-group">
        <label>Vstupná surovina</label>
        <select id="tmpl-material" class="form-control">${materialsOpts}</select>
      </div>
      <hr>
      <div class="form-group">
        <label>Položky v šablóne:</label>
        <div style="display:flex; gap:5px;">
            <input id="tmpl-add-search" class="form-control" list="meat-products-datalist" placeholder="Pridať produkt...">
            <button type="button" class="btn btn-secondary" onclick="addTemplateItemRowUI()">Pridať</button>
        </div>
        <div class="table-container" style="max-height:300px; overflow-y:auto; margin-top:10px; border:1px solid #eee;">
            <table class="table table-sm" id="tmpl-items-table"><tbody></tbody></table>
        </div>
      </div>
      <div style="text-align:right; margin-top:1rem;">
         <button class="btn btn-success" type="button" onclick="submitTemplate(${id ? id : 'null'})">Uložiť šablónu</button>
      </div>
    `;

    if(typeof showModal === 'function'){
        showModal(id ? 'Upraviť šablónu' : 'Nová šablóna', () => {
            return {
                html: modalHtml,
                onReady: () => {
                    items.forEach(i => addTemplateItemRowUI(i.product_id, i.product_name));
                    document.getElementById('tmpl-add-search').addEventListener("keypress", function(e) {
                        if(e.key === "Enter") { e.preventDefault(); addTemplateItemRowUI(); }
                    });
                }
            };
        });
    } else { alert("Chýba funkcia showModal!"); }
}

window.addTemplateItemRowUI = function(pid=null, pname=null){
    if(!pid){
        const val = document.getElementById('tmpl-add-search').value.trim();
        if(!val) return;
        let prod = MEAT_PRODUCTS_CACHE.find(p => p.name.toLowerCase() === val.toLowerCase());
        if(!prod) prod = MEAT_PRODUCTS_CACHE.find(p => val.includes(p.name));
        
        if(prod) { pid = prod.id; pname = prod.name; }
        else { alert('Nenašiel sa produkt'); return; }
        
        document.getElementById('tmpl-add-search').value = '';
        document.getElementById('tmpl-add-search').focus();
    }
    const tbody = document.querySelector('#tmpl-items-table tbody');
    if(tbody.querySelector(`tr[data-pid="${pid}"]`)) return;

    const tr = document.createElement('tr');
    tr.dataset.pid = pid;
    tr.innerHTML = `<td>${esc(pname)}</td><td style="text-align:right;"><button class="btn btn-danger btn-xs" onclick="this.closest('tr').remove()">&times;</button></td>`;
    tbody.appendChild(tr);
};

window.submitTemplate = async function(id){
    console.log("submitTemplate called with id:", id); // DEBUG log
    
    // Explicitné použitie document.getElementById pre istotu
    const nameInput = document.getElementById('tmpl-name');
    const materialInput = document.getElementById('tmpl-material');
    
    if(!nameInput || !materialInput) {
        alert("Chyba formulára: nenájdené vstupné polia.");
        return;
    }

    const name = nameInput.value;
    const material_id = materialInput.value;
    const product_ids = Array.from(document.querySelectorAll('#tmpl-items-table tr')).map(tr => tr.dataset.pid);

    if(!name || !product_ids.length){ alert("Vyplň názov a pridaj produkty."); return; }

    try {
        const res = await apiM('/api/kancelaria/meat/calc/template/save', {
            method: 'POST', body: { id: id === 'null' ? null : id, name, material_id, product_ids }
        });

        console.log("API Response:", res);

        // Oprava: kontrola error aj __error (ak server zlyhá)
        if(res.error || res.__error) {
            alert("Chyba pri ukladaní: " + (res.error || res.__error));
        } else {
            // Zavretie modalu (ak existuje)
            if(document.getElementById('modal-container')) {
                document.getElementById('modal-container').style.display = 'none';
            }
            
            // Obnovenie tabuliek s vynútením reloadu (cache busting)
            await loadTemplatesTable();
            await loadTemplatesDropdown();
            
            alert("Šablóna bola úspešne uložená.");
        }
    } catch (e) {
        console.error(e);
        alert("Kritická chyba: " + e.message);
    }
};

window.deleteTemplate = async function(id){
    if(!confirm("Zmazať šablónu?")) return;
    await apiM('/api/kancelaria/meat/calc/template/delete', { method:'POST', body: {id} });
    loadTemplatesTable();
    loadTemplatesDropdown();
};

// =================================================================
// HISTÓRIA ROZRÁBOK (Pôvodné + úprava Edit)
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
    div.innerHTML = '<p class="error">Nepodarilo sa načítať históriu.</p>';
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

    // Použijeme NOVÚ render funkciu
    renderOutputsTable(data.outputs.map(o => ({
        product_id: o.product_id,
        product_name: o.product_name,
        product_code: o.code || '', 
        weight: o.weight_kg,
        price: o.selling_price_eur_kg
    })));
    
    $('meat-extras-table').innerHTML  = buildExtrasTable(data.extras || []);

    if (Array.isArray(data.results) && data.results.length){
      renderResults(data);
    } else {
      $('meat-results').innerHTML = '';
    }
    updateLiveStats();
  }, 50);
}

async function meatDeleteBreakdown(id){
  if (!confirm('Naozaj chceš zmazať tento záznam rozrábky? Operácia je nevratná.')) return;
  const res = await apiM('/api/kancelaria/meat/breakdown/delete',{method:'POST', body:{id}});
  if (res?.error){ showStatus(res.error, true); return; }
  showStatus('Rozrábka zmazaná.', false);
  loadHistory();
}

// =================================================================
// REPORTY – súhrn ziskov za obdobie (Pôvodné)
// =================================================================

function initReports(){
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

  if (!Array.isArray(list)){ box.innerHTML = '<p class="error">Chyba načítania.</p>'; return; }
  if (!list.length){ box.innerHTML = '<p>Žiadne dáta.</p>'; return; }

  const summaryRows = [];
  let totalInputKg = 0, totalOutputKg = 0, totalProfit = 0;

  for (const row of list){
    const detail = await apiM('/api/kancelaria/meat/breakdown?id='+row.id);
    if (!detail || !Array.isArray(detail.results)){ continue; }
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
  const material_id = $('meat-rep-material')?.value || '';
  const df          = $('meat-rep-from')?.value || '';
  const dt          = $('meat-rep-to')?.value || '';
  const sup         = $('meat-rep-sup')?.value || '';

  const params = new URLSearchParams();
  if (material_id) params.set('material_id', material_id);
  if (df)          params.set('date_from', df);
  if (dt)          params.set('date_to', dt);
  if (sup)         params.set('supplier', sup);

  const url = '/report/meat/summary' + (params.toString() ? '?' + params.toString() : '');
  window.open(url, '_blank');
}

// =================================================================
// ODHAD ROZRÁBKY (Pôvodné)
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

  if (res?.error){ box.innerHTML = `<p class="error">${esc(res.error)}</p>`; return; }
  if (!res || !Array.isArray(res.rows)) { box.innerHTML = '<p class="error">Chyba.</p>'; return; }

  if (!Array.isArray(MEAT_PRODUCTS_CACHE) || !MEAT_PRODUCTS_CACHE.length) {
    const prods = await apiM('/api/kancelaria/meat/products');
    MEAT_PRODUCTS_CACHE = Array.isArray(prods) ? prods : [];
  }

  const rows = res.rows || [];
  const totalOutputKg = rows.reduce((a,r)=> a + Number(r.weight_kg || 0), 0);
  const totalProfit   = rows.reduce((a,r)=> a + Number(r.profit_eur || 0), 0);
  const plannedInKg   = Number(res.planned_weight_kg || planned_weight_kg || 0);
  const profitPerKgIn = plannedInKg   > 0 ? totalProfit / plannedInKg   : null;
  const sumKg = Number(res.sum_estimated_weight_kg || totalOutputKg);

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
        <span class="kpi-badge">Vstup: <strong>${plannedInKg.toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Efektívny výstup: <strong>${Number(res.effective_output_weight_kg||0).toFixed(3)} kg</strong></span>
        <span class="kpi-badge">Odhad zisk: <strong>${totalProfit.toFixed(2)} €</strong></span>
        <span class="kpi-badge">Zisk / kg vstupu: <strong>${profitPerKgIn != null ? profitPerKgIn.toFixed(4) : '–'} €/kg</strong></span>
      </div>
    </div>
  `;
  box.innerHTML = html;
}
async function deleteTemplate(id) {
    if (!confirm('Naozaj chcete zmazať túto šablónu?')) return;

    try {
        // TU MUSÍ BYŤ NOVÁ ADRESA S /calc/
        const response = await apiM('/api/kancelaria/meat/calc/template/delete', {
            id: id  // Posielame ID
        });

        if (response.error) {
            alert('Chyba: ' + response.error);
        } else {
            // alert('Zmazané.'); // Voliteľné
            loadTemplates(); // Obnovíme tabuľku, aby zmizol riadok
        }
    } catch (e) {
        console.error(e);
        alert('Nepodarilo sa spojiť so serverom.');
    }
}
// =================================================================
// AUTO-REGISTER
// =================================================================

(function(){
  const root = document.getElementById('section-meat-calc');
  if (root) initializeMeatCalcModule();
})();