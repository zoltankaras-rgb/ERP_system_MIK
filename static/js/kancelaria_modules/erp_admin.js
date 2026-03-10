// =================================================================
// === SUB-MODUL KANCELÁRIA: SPRÁVA ERP (v3.3 - FIX Delete)
// =================================================================
(function (window, document) {
  'use strict';

  // Global state
  var state = { warehouse: null, warehouseLoadedAt: 0, catalog: null };

  // --- Helpers ---
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  
  function byLocale(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'sk');
  }

  function onClick(selector, handler) {
    const el = document.querySelector(selector);
    if (el) {
        el.addEventListener('click', handler);
    } else {
        // console.warn('onClick: Element not found:', selector);
    }
  }

  function showStatus(msg, isError=false){
    if (typeof window.status === 'function') return window.status(msg, isError);
    if (typeof window.showStatus === 'function') return window.showStatus(msg, isError);
    (isError?console.error:console.log)(msg);
    const sb = document.getElementById('status-bar'); if(sb) { sb.textContent=msg; sb.style.color=isError?'#b91c1c':'#166534'; }
  }
  
  function $(sel, root){ return (root||document).querySelector(sel); }
  
  const apiRequest = async (url, opts={})=>{
    const res = await fetch(url, {
        method: opts.method||'GET',
        headers: {'Content-Type':'application/json', ...(opts.headers || {})},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials:'same-origin'
    });
    if (!res.ok){
        let t=''; try{ t=await res.text(); }catch(_){}
        const errObj = tryParseJSON(t);
        const msg = (errObj && errObj.error) ? errObj.error : t.slice(0,200);
        
        // Vrátime chybu ako objekt, aby ju volajúci mohol spracovať
        return { error: msg, status: res.status, raw: errObj };
    }
    const ct=(res.headers.get('content-type')||'').toLowerCase();
    return ct.includes('application/json') ? res.json() : {};
};

  function tryParseJSON(str) {
      try { return JSON.parse(str); } catch(e) { return null; }
  }

  // --- MODAL COMPAT ---
  function openModalCompat(title, contentFactory) {
    if (typeof window.showModal === 'function') {
        return window.showModal(title, contentFactory);
    }
    alert('Chyba: Funkcia pre modálne okno (showModal) nie je dostupná. Skúste obnoviť stránku (F5).');
  }

  function hideModalCompat() {
    if (typeof window.hideModal === 'function') return window.hideModal();
    if (typeof window.closeModal === 'function') return window.closeModal();
    
    const mc = document.getElementById('modal-container');
    if (mc) {
        mc.style.display = 'none';
        mc.innerHTML = '';
    }
  }

  window.erpMount = window.erpMount || function (factory) {
    const host = $('#erp-admin-content');
    if (!host){ console.error('Chýba #erp-admin-content'); return; }
    host.innerHTML = '<div class="stat-card"><i class="fas fa-spinner fa-spin"></i> Načítavam...</div>';
    Promise.resolve(factory())
      .then(res=>{ host.innerHTML = res?.html || ''; if (typeof res?.onReady==='function'){ try{ res.onReady(); }catch(e){ console.error(e);} } })
      .catch(err=>{ host.innerHTML = '<div class="stat-card error">Chyba: '+(err?.message||String(err))+'</div>'; console.error(err); });
  };

  // --- Data Loaders ---
  window.__officeBaseData = window.__officeBaseData || null;
  async function ensureOfficeDataIsLoaded(){
    if (window.__officeBaseData) return;
    try {
        let data = await apiRequest('/api/kancelaria/baseData').catch(()=>null);
        if (!data) data = await apiRequest('/api/kancelaria/getKancelariaBaseData').catch(()=>null);
        window.__officeBaseData = data || { productsWithoutRecipe: [], recipeCategories: [], itemTypes: ['Mäso','Koreniny','Obaly','Pomocný materiál'] };
    } catch(e) { console.error(e); }
  }
  function getOfficeData(){ return window.__officeBaseData || { productsWithoutRecipe:[], recipeCategories:[], itemTypes:[] }; }

  async function ensureWarehouseCache(force=false){ return {}; } 

  // ==================== ROOT UI =======================
  function initializeErpAdminModule(){
    const sec = $('#section-erp-admin'); if(!sec) return;
    sec.innerHTML = `
      <div class="stat-card" style="margin-bottom:.75rem;">
        <h3 style="margin:0 0 .5rem 0;">Správa ERP Systému</h3>
        <div class="btn-grid" style="margin:0;">
          <button id="erp-btn-catalog" class="btn-secondary"><i class="fas fa-book"></i> Katalóg produktov</button>
          <button id="erp-btn-minstock" class="btn-secondary"><i class="fas fa-layer-group"></i> Min. Zásoby</button>
          <button id="erp-btn-newrecipe" class="btn-primary"><i class="fas fa-plus"></i> Nový Recept</button>
          <button id="erp-btn-editrecipe" class="btn-secondary"><i class="fas fa-edit"></i> Upraviť Recept</button>
          <button id="erp-btn-slicing" class="btn-secondary"><i class="fas fa-cut"></i> Krájané Produkty</button>
          <button id="erp-btn-eanmap" class="btn-secondary"><i class="fas fa-barcode"></i> Mapovanie EAN</button>
        </div>
      </div>
      <div id="erp-admin-content"></div>
    `;
    $('#erp-btn-catalog').onclick   = ()=> window.erpMount(viewCatalogManagement);
    $('#erp-btn-minstock').onclick  = ()=> window.erpMount(viewMinStock);
    $('#erp-btn-slicing').onclick   = ()=> window.erpMount(viewSlicingManagement);
    $('#erp-btn-newrecipe').onclick = ()=> window.erpMount(viewCreateRecipeInline);
    $('#erp-btn-editrecipe').onclick= ()=> window.erpMount(viewEditRecipeListInline);
    $('#erp-btn-eanmap').onclick    = ()=> window.erpMount(viewEanMappingManagement);
    
    $('#erp-btn-catalog').click();
  }
  // =================================================================
  // === 1. SPRÁVA KATALÓGU (RECEPTY + SKLADOVÁ KARTA) ===
  // =================================================================
  async function viewCatalogManagement(){
    state.catalog = await apiRequest('/api/kancelaria/getCatalogManagementData?ts=' + Date.now()) || {};
    await ensureOfficeDataIsLoaded();
    
    // Načítanie dát
    let products = Array.isArray(state.catalog.products) ? state.catalog.products : [];
    const itemTypes = state.catalog.item_types || ['VÝROBOK', 'TOVAR'];
    const dphRates = state.catalog.dph_rates || [20, 10, 0];
    const saleCats = state.catalog.sale_categories || [];
    const recipeCats = state.catalog.recipe_categories || [];

    // Kategórie pre taby
    const distinctCats = new Set(saleCats);
    products.forEach(p => { if(p.predajna_kategoria) distinctCats.add(p.predajna_kategoria); });
    const categoriesList = Array.from(distinctCats).sort((a,b) => String(a).localeCompare(String(b), 'sk'));

    // Nastavenie stránkovania
    let currentPage = 1;
    const itemsPerPage = 10;
    
    // === HTML LAYOUT ===
    const html = `
      <div class="stat-card" style="margin-bottom:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:15px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <h3 style="margin:0;">Centrálny katalóg produktov</h3>
                <span class="badge" id="cat-count-badge" style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:10px; font-size:0.8em;">0</span>
            </div>
            
            <div style="display:flex; gap:10px;">
                <button id="cat-btn-add" class="btn-success btn-sm">
                    <i class="fas fa-plus"></i> Nový produkt
                </button>
                <div style="width:1px; background:#ccc; margin:0 5px;"></div>
                <button id="cat-export-csv" class="btn-secondary btn-sm"><i class="fas fa-file-export"></i> Export</button>
                <button id="cat-import-csv" class="btn-primary btn-sm"><i class="fas fa-file-import"></i> Import</button>
                <button id="cat-download-template" class="btn-info btn-sm" title="Stiahnuť šablónu"><i class="fas fa-download"></i></button>
                <input id="cat-import-file" type="file" accept=".csv,text/csv" style="display:none" />
            </div>
        </div>

        <div class="form-group">
            <input type="text" id="cat-search" placeholder="🔍 Hľadať produkt (názov, EAN)..." style="width:100%; padding:10px; font-size:1.1em; border:1px solid #cbd5e1; border-radius:6px;">
        </div>

        <div id="cat-tabs" class="inventory-tabs" style="display:flex; gap:5px; margin-top:10px; flex-wrap:wrap;">
            <button class="btn-tab btn-primary" data-cat="ALL">Všetky</button>
            ${categoriesList.map(c => `<button class="btn-tab btn-secondary" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            <button class="btn-tab btn-secondary" data-cat="NO_CAT">Nezaradené</button>
        </div>
      </div>

      <div id="cat-table-container" class="table-container" style="min-height:300px;"></div>
      <div id="cat-pagination" style="display:flex; justify-content:center; gap:5px; margin-top:20px;"></div>
      
      <div id="stock-card-modal-container"></div>
    `;

    const onReady = () => {
        let currentCat = 'ALL';
        let currentFilteredProducts = []; 

        const tableContainer = document.getElementById('cat-table-container');
        const paginationContainer = document.getElementById('cat-pagination');
        const searchInput = document.getElementById('cat-search');
        const tabsContainer = document.getElementById('cat-tabs');
        const countBadge = document.getElementById('cat-count-badge');

        // --- RENDER TABLE with Pagination ---
        function renderTable() {
            const q = searchInput.value.trim().toLowerCase();
            
            // 1. Filter
            currentFilteredProducts = products.filter(p => {
                if (currentCat !== 'ALL') {
                    if (currentCat === 'NO_CAT') { if (p.predajna_kategoria) return false; }
                    else { if (p.predajna_kategoria !== currentCat) return false; }
                }
                if (q) {
                    const hay = (String(p.nazov_vyrobku) + ' ' + String(p.ean)).toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });

            // Update badge
            if(countBadge) countBadge.textContent = currentFilteredProducts.length;

            // 2. Sort (Name A-Z)
            currentFilteredProducts.sort((a,b) => String(a.nazov_vyrobku).localeCompare(String(b.nazov_vyrobku), 'sk'));

            // 3. Pagination Logic
            const totalPages = Math.ceil(currentFilteredProducts.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = 1;
            if (currentPage < 1) currentPage = 1;
            
            const start = (currentPage - 1) * itemsPerPage;
            const end = start + itemsPerPage;
            const pageItems = currentFilteredProducts.slice(start, end);

            // 4. Render HTML
            if (pageItems.length === 0) {
                tableContainer.innerHTML = '<p class="text-muted" style="padding:40px; text-align:center;">Žiadne produkty nezodpovedajú filtru.</p>';
                paginationContainer.innerHTML = '';
                return;
            }

            // Pridané stĺpce: Recept, Karta
            let html = `<table class="tbl">
                <thead>
                    <tr>
                        <th style="width:110px;">EAN</th>
                        <th>Názov</th>
                        <th style="width:100px;">Typ</th>
                        <th>Kategória</th>
                        <th style="width:120px; text-align:center;">Receptúra</th>
                        <th style="width:230px; text-align:right;">Akcie</th>
                    </tr>
                </thead>
                <tbody>`;

            pageItems.forEach(p => {
                // Logika pre Recept:
                // Ak má recept -> Tlačidlo "Upraviť recept"
                // Ak nemá recept a je VÝROBOK -> Tlačidlo "Vytvoriť recept"
                // Inak (Tovar) -> Nič
                
                let recipeHtml = '';
                const isVyrobok = String(p.typ_polozky).toUpperCase().startsWith('VÝROBOK') || String(p.typ_polozky).toUpperCase() === 'PRODUKT';
                
                if (p.has_recipe) {
                    recipeHtml = `<button class="btn-info btn-sm btn-recipe-edit" title="Upraviť receptúru" style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd;">
                                    <i class="fas fa-scroll"></i> Upraviť
                                  </button>`;
                } else if (isVyrobok) {
                     recipeHtml = `<button class="btn-success btn-sm btn-recipe-create" title="Vytvoriť novú receptúru" style="font-size:0.75rem; padding:2px 6px;">
                                    <i class="fas fa-plus"></i> Vytvoriť
                                  </button>`;
                } else {
                    recipeHtml = `<span class="text-muted" style="font-size:0.8em;">-</span>`;
                }

                html += `<tr data-ean="${escapeHtml(p.ean)}" data-name="${escapeHtml(p.nazov_vyrobku)}">
                        <td style="font-family:monospace; color:#64748b;">${escapeHtml(p.ean)}</td>
                        <td><strong>${escapeHtml(p.nazov_vyrobku)}</strong></td>
                        <td><span style="font-size:0.85em; background:#f1f5f9; padding:2px 6px; border-radius:4px;">${escapeHtml(p.typ_polozky)}</span></td>
                        <td>${escapeHtml(p.predajna_kategoria || '-')}</td>
                        <td style="text-align:center;">${recipeHtml}</td>
                        <td style="text-align:right;">
                            <button class="btn-secondary btn-sm btn-stock-card" title="Skladová karta a história">
                                <i class="fas fa-chart-bar"></i> 📊
                            </button>
                            <button class="btn-primary btn-sm btn-edit" title="Upraviť produkt" style="margin-left:5px;"><i class="fas fa-pencil-alt"></i></button>
                            <button class="btn-danger btn-sm btn-del" title="Zmazať" style="margin-left:5px;"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`;
            });
            html += `</tbody></table>`;
            tableContainer.innerHTML = html;

            // 5. Render Pagination Controls
            let pagHtml = '';
            if (totalPages > 1) {
                pagHtml += `<button class="btn-secondary btn-sm" onclick="document.getElementById('cat-search').dispatchEvent(new CustomEvent('page-change', {detail: ${currentPage - 1}}))" ${currentPage===1?'disabled':''}>«</button>`;
                
                let startPage = Math.max(1, currentPage - 2);
                let endPage = Math.min(totalPages, currentPage + 2);
                
                for(let i=startPage; i<=endPage; i++) {
                    pagHtml += `<button class="btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="document.getElementById('cat-search').dispatchEvent(new CustomEvent('page-change', {detail: ${i}}))">${i}</button>`;
                }
                
                pagHtml += `<button class="btn-secondary btn-sm" onclick="document.getElementById('cat-search').dispatchEvent(new CustomEvent('page-change', {detail: ${currentPage + 1}}))" ${currentPage===totalPages?'disabled':''}>»</button>`;
            }
            paginationContainer.innerHTML = pagHtml;

            // 6. Bind Events
            
            // SKLADOVÁ KARTA
            tableContainer.querySelectorAll('.btn-stock-card').forEach(b => {
                b.onclick = (e) => {
                    const tr = e.target.closest('tr');
                    openStockCard(tr.dataset.ean, tr.dataset.name);
                };
            });

            // RECEPTY
            tableContainer.querySelectorAll('.btn-recipe-edit').forEach(b => {
                b.onclick = (e) => {
                    const name = e.target.closest('tr').dataset.name;
                    // Použijeme existujúcu funkciu z erp_admin.js
                    if (typeof renderRecipeEditorInline === 'function') {
                        window.erpMount(() => renderRecipeEditorInline(name));
                    }
                };
            });

            tableContainer.querySelectorAll('.btn-recipe-create').forEach(b => {
                b.onclick = (e) => {
                    // Prepneme sa na tab "Nový recept" (ktorý existuje v initializeErpAdminModule)
                    // Alebo priamo zavoláme funkciu
                    if (typeof viewCreateRecipeInline === 'function') {
                         window.erpMount(viewCreateRecipeInline);
                         // TODO: Predvyplniť select (to by vyžadovalo úpravu viewCreateRecipeInline, zatiaľ necháme takto)
                    }
                };
            });

            // EDIT/DELETE (pôvodné)
            tableContainer.querySelectorAll('.btn-edit').forEach(b => {
                b.onclick = (e) => {
                    const ean = e.target.closest('tr').dataset.ean;
                    const p = products.find(x => String(x.ean) === ean);
                    if (p) openProductModal(p);
                };
            });
            tableContainer.querySelectorAll('.btn-del').forEach(b => {
                b.onclick = (e) => {
                    const ean = e.target.closest('tr').dataset.ean;
                    const p = products.find(x => String(x.ean) === ean);
                    if (p) confirmDelete(p);
                };
            });
        }

        // --- Event Listeners ---
        searchInput.addEventListener('page-change', (e) => { currentPage = e.detail; renderTable(); });
        searchInput.oninput = () => { currentPage = 1; renderTable(); };

        tabsContainer.querySelectorAll('.btn-tab').forEach(btn => {
            btn.onclick = () => {
                tabsContainer.querySelectorAll('.btn-tab').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
                btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
                currentCat = btn.dataset.cat;
                currentPage = 1;
                renderTable();
            };
        });

        document.getElementById('cat-btn-add').onclick = () => openProductModal(null);
        renderTable();

        // --- SKLADOVÁ KARTA (MODAL) ---
async function openStockCard(ean, name) {
    // 1. Zobrazíme modal s loaderom, ktorý má unikátne ID, aby sme ho vedeli nájsť
    const loadingHtml = `
        <div id="stock-card-dynamic-content" style="padding:40px; text-align:center;">
            <i class="fas fa-spinner fa-spin fa-2x" style="color:#3b82f6;"></i>
            <br><br>
            <span style="color:#64748b;">Načítavam históriu pre <strong>${escapeHtml(name)}</strong>...</span>
        </div>
    `;
    
    // Otvoríme modal (používame funkciu, ktorá je dostupná v erp_admin.js)
    openModalCompat(`Skladová karta: ${escapeHtml(name)}`, { html: loadingHtml });

    try {
        // 2. Voláme API
        const res = await apiRequest('/api/kancelaria/getProductCard?ean=' + ean);
        
        if (res.error) throw new Error(res.error);

        // --- Formátovacie funkcie ---
        const fmt = (n) => Number(n || 0).toFixed(2);
        const dateFmt = (d) => {
            if (!d) return '-';
            try { return new Date(d).toLocaleDateString('sk-SK'); } catch(e) { return d; }
        };

        // --- Generovanie HTML pre tabuľky ---

        // A) Výroba
        let prodHtml = '<div class="text-muted" style="padding:10px; font-style:italic;">Žiadne záznamy o výrobe.</div>';
        if (res.production && res.production.length > 0) {
            prodHtml = `<table class="tbl" style="width:100%; font-size:0.85rem;">
                <thead style="background:#f1f5f9;"><tr><th>Dátum</th><th>Šarža</th><th style="text-align:right">Množstvo</th></tr></thead>
                <tbody>${res.production.map(r => `
                    <tr>
                        <td>${dateFmt(r.date)}</td>
                        <td style="font-family:monospace;">${escapeHtml(r.batch)}</td>
                        <td style="text-align:right; font-weight:bold; color:#166534;">+${fmt(r.qty)} kg</td>
                    </tr>
                `).join('')}</tbody></table>`;
        }

        // B) B2B Predaj
        let b2bHtml = '<div class="text-muted" style="padding:10px; font-style:italic;">Žiadne B2B predaje.</div>';
        if (res.b2b && res.b2b.length > 0) {
            b2bHtml = `<table class="tbl" style="width:100%; font-size:0.85rem;">
                <thead style="background:#f1f5f9;"><tr><th>Dátum</th><th>Zákazník</th><th style="text-align:right">Množstvo</th></tr></thead>
                <tbody>${res.b2b.map(r => `
                    <tr>
                        <td>${dateFmt(r.date)}</td>
                        <td>${escapeHtml(r.customer)}</td>
                        <td style="text-align:right; color:#dc2626;">-${fmt(r.qty)} ${escapeHtml(r.mj)}</td>
                    </tr>
                `).join('')}</tbody></table>`;
        }

        // C) B2C Predaj
        let b2cHtml = '<div class="text-muted" style="padding:10px; font-style:italic;">Žiadne B2C predaje.</div>';
        if (res.b2c && res.b2c.length > 0) {
            b2cHtml = `<table class="tbl" style="width:100%; font-size:0.85rem;">
                <thead style="background:#f1f5f9;"><tr><th>Dátum</th><th>Objednávka</th><th style="text-align:right">Množstvo</th></tr></thead>
                <tbody>${res.b2c.map(r => `
                    <tr>
                        <td>${dateFmt(r.date)}</td>
                        <td style="font-family:monospace;">${escapeHtml(r.order_no)}</td>
                        <td style="text-align:right; color:#dc2626;">-${fmt(r.qty)} ${escapeHtml(r.mj)}</td>
                    </tr>
                `).join('')}</tbody></table>`;
        }

        // --- Finálne zloženie obsahu ---
        const content = `
            <div style="animation: fadeIn 0.3s;">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
                    
                    <div style="background:#eff6ff; padding:15px; border-radius:8px; border:1px solid #bfdbfe;">
                        <h4 style="margin:0 0 10px 0; color:#1e40af; border-bottom:1px solid #dbeafe; padding-bottom:5px;">
                            📦 Aktuálny stav
                        </h4>
                        <div style="font-size:2.2rem; font-weight:bold; color:#1e3a8a;">
                            ${fmt(res.product.stock)} <span style="font-size:1rem; vertical-align:middle;">${escapeHtml(res.product.mj)}</span>
                        </div>
                        <div style="font-size:0.9rem; color:#64748b; margin-top:5px; line-height:1.5;">
                            <div>EAN: <strong>${escapeHtml(res.product.ean)}</strong></div>
                            <div>Typ: ${res.product.is_made ? '<span style="color:#059669; font-weight:bold;">Vlastná výroba</span>' : '<span style="color:#d97706; font-weight:bold;">Nakupovaný tovar</span>'}</div>
                        </div>
                    </div>

                    <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                         <h4 style="margin:0; padding:10px; background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#334155;">
                            🏭 Posledná výroba
                         </h4>
                         <div style="max-height:150px; overflow-y:auto;">
                            ${prodHtml}
                         </div>
                    </div>
                </div>
                
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                    <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                        <h4 style="margin:0; padding:10px; background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#334155;">
                            🏢 Posledné B2B Predaje
                        </h4>
                        <div style="max-height:200px; overflow-y:auto;">
                            ${b2bHtml}
                        </div>
                    </div>
                    
                    <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                        <h4 style="margin:0; padding:10px; background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#334155;">
                            🛒 Posledné B2C Predaje
                        </h4>
                        <div style="max-height:200px; overflow-y:auto;">
                            ${b2cHtml}
                        </div>
                    </div>
                </div>
                
                <div style="text-align:right; margin-top:20px; padding-top:10px; border-top:1px solid #e2e8f0;">
                    <button class="btn-secondary" onclick="hideModalCompat()">Zavrieť</button>
                </div>
            </div>
        `;
        
        // 3. Aktualizácia DOM (Bezpečné nahradenie loadera)
        const loader = document.getElementById('stock-card-dynamic-content');
        if (loader) {
            // Nahradíme loader novým obsahom
            loader.outerHTML = content;
        } else {
            // Fallback, ak by sme loader nenašli (pre istotu)
            const mc = document.querySelector('.b2b-modal-content') || document.querySelector('.modal-content');
            if (mc) mc.innerHTML = content;
        }

    } catch (e) {
        console.error(e);
        // V prípade chyby nahradíme loader chybovou hláškou
        const loader = document.getElementById('stock-card-dynamic-content');
        const errorHtml = `
            <div style="padding:30px; text-align:center; color:#dc2626;">
                <i class="fas fa-exclamation-triangle fa-2x"></i><br><br>
                <strong>Chyba pri načítaní dát:</strong><br>
                ${e.message}
                <br><br>
                <button class="btn-secondary" onclick="hideModalCompat()">Zavrieť</button>
            </div>
        `;
        
        if (loader) loader.outerHTML = errorHtml;
        else alert("Chyba: " + e.message);
    }
}


        // --- MODAL: ADD / EDIT PRODUCT (Zachovaný z minula) ---
        function openProductModal(p) {
            const isEdit = !!p;
            const title = isEdit ? `Upraviť: ${p.nazov_vyrobku}` : 'Nový produkt';
            const data = p || { ean:'', nazov_vyrobku:'', typ_polozky:'TOVAR', mj:'ks', vaha_balenia_g:'', dph:20, predajna_kategoria:'', kategoria_pre_recepty:'' };
            
            const isMade = String(data.typ_polozky).toUpperCase().startsWith('VÝROBOK');

            let rcpCatOpts = recipeCats.map(c => `<option value="${c}" ${data.kategoria_pre_recepty === c ? 'selected' : ''}>${c}</option>`).join('');
            if (data.kategoria_pre_recepty && !recipeCats.includes(data.kategoria_pre_recepty)) {
                rcpCatOpts += `<option value="${data.kategoria_pre_recepty}" selected>${data.kategoria_pre_recepty}</option>`;
            }
            
            const html = `
              <form id="prod-modal-form" style="max-width:600px">
                <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="form-group">
                        <label>EAN (Unikátne)</label>
                        <input id="ed-ean" type="text" required value="${escapeHtml(data.ean)}" ${isEdit ? 'disabled' : ''} style="font-weight:bold;">
                    </div>
                    <div class="form-group">
                        <label>Typ položky</label>
                        <select id="ed-type" required>${itemTypes.map(t => `<option value="${t}" ${data.typ_polozky === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Názov položky</label>
                    <input id="ed-name" type="text" required value="${escapeHtml(data.nazov_vyrobku)}">
                </div>

                <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
                    <div class="form-group"><label>MJ</label>
                        <select id="ed-mj">
                            <option value="kg" ${data.mj === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="ks" ${data.mj === 'ks' ? 'selected' : ''}>ks</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Váha balenia (g)</label>
                        <input id="ed-weight" type="number" step="1" value="${data.vaha_balenia_g || ''}" placeholder="napr. 1000">
                    </div>
                    <div class="form-group"><label>DPH %</label>
                        <select id="ed-dph" required>${dphRates.map(r => `<option value="${r}" ${Number(data.dph) === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
                    </div>
                </div>

                <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="form-group"><label>Predajná kategória</label>
                        <select id="ed-sale">
                            <option value="">-- Vyberte --</option>
                            ${saleCats.map(c => `<option value="${c}" ${data.predajna_kategoria === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group"><label>Kategória pre recepty</label>
                        <select id="ed-rcp-cat">
                            <option value="">-- Žiadna --</option>
                            ${rcpCatOpts}
                        </select>
                    </div>
                </div>

                <div class="form-group" style="background:#f0fdf4; padding:10px; border-radius:5px; margin-top:10px;">
                    <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer;">
                        <input type="checkbox" id="ed-is-made" style="width:20px; height:20px;" ${isMade ? 'checked' : ''}>
                        JA VYRÁBAM (Výrobok)
                    </label>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; border-top:1px solid #eee; padding-top:15px;">
                    <button type="button" class="btn-secondary" onclick="hideModalCompat()">Zrušiť</button>
                    <button type="submit" class="btn-primary"><i class="fas fa-save"></i> Uložiť</button>
                </div>
              </form>
            `;

            openModalCompat(title, {
                html,
                onReady() {
                    const form = document.getElementById('prod-modal-form');
                    const madeChk = document.getElementById('ed-is-made');
                    const typeSel = document.getElementById('ed-type');

                    madeChk.onchange = () => { typeSel.value = madeChk.checked ? 'VÝROBOK' : 'TOVAR'; };
                    typeSel.onchange = () => { madeChk.checked = typeSel.value.toUpperCase().startsWith('VÝROBOK'); };

                    form.onsubmit = async (e) => {
                        e.preventDefault();
                        const payload = {
                            ean: document.getElementById('ed-ean').value.trim(),
                            nazov_vyrobku: document.getElementById('ed-name').value.trim(),
                            typ_polozky: typeSel.value,
                            mj: document.getElementById('ed-mj').value,
                            vaha_balenia_g: document.getElementById('ed-weight').value,
                            dph: document.getElementById('ed-dph').value,
                            predajna_kategoria: document.getElementById('ed-sale').value,
                            kategoria_pre_recepty: document.getElementById('ed-rcp-cat').value
                        };

                        try {
                            let res;
                            if (isEdit) {
                                payload.original_ean = data.ean;
                                res = await apiRequest('/api/kancelaria/updateCatalogItem', { method:'POST', body: payload });
                                // Update local array
                                const idx = products.findIndex(x => x.ean === data.ean);
                                if(idx > -1) products[idx] = { ...products[idx], ...payload };
                            } else {
                                // MAPPING PRE API addCatalogItem (očakáva prefix new_catalog_)
                                const createBody = {
                                    new_catalog_ean: payload.ean,
                                    new_catalog_name: payload.nazov_vyrobku,
                                    new_catalog_item_type: payload.typ_polozky,
                                    new_catalog_dph: payload.dph,
                                    new_catalog_sale_category: payload.predajna_kategoria
                                };
                                res = await apiRequest('/api/kancelaria/addCatalogItem', { method:'POST', body: createBody });
                                // Add to local array
                                products.push(payload);
                            }

                            if(res.error) throw new Error(res.error);
                            
                            showStatus('Uložené.', false);
                            hideModalCompat();
                            renderTable(); // Re-render table to show changes
                        } catch(err) {
                            alert("Chyba: " + err.message);
                        }
                    };
                }
            });
        }

        // --- DELETE LOGIC ---
        async function confirmDelete(p) {
             if (!confirm(`Naozaj zmazať ${p.nazov_vyrobku}?`)) return;
             let res = await apiRequest('/api/kancelaria/deleteCatalogItem', { method: 'POST', body: { ean: p.ean } });

             if (res.error) {
                 if (res.raw && res.raw.used_in) {
                     let msg = "POZOR: Produkt sa používa (recepty/sklad)!\n\nChcete VYNÚTIŤ ZMAZANIE?";
                     if (confirm(msg)) {
                         res = await apiRequest('/api/kancelaria/deleteCatalogItem', { method: 'POST', body: { ean: p.ean, force: true } });
                         if (res.error) { alert("Chyba: " + res.error); return; }
                     } else return;
                 } else {
                     alert("Chyba: " + res.error); return;
                 }
             }
             showStatus('Položka zmazaná.', false);
             const idx = products.findIndex(x => x.ean === p.ean);
             if (idx > -1) products.splice(idx, 1);
             renderTable();
        }

        // --- IMPORT CSV handlers ---
        document.getElementById('cat-import-csv').onclick = () => document.getElementById('cat-import-file').click();
        document.getElementById('cat-import-file').onchange = async (e) => {
             const file = e.target.files[0]; if (!file) return;
             const reader = new FileReader();
             reader.onload = async function(evt) {
                 const text = evt.target.result;
                 const delim = (text.indexOf(';') > -1) ? ';' : ',';
                 const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
                 if (lines.length < 2) { alert("CSV je prázdne."); return; }
                 const headers = lines[0].toLowerCase().split(delim).map(h => h.trim().replace(/"/g, ''));
                 const idxEan = headers.findIndex(h => h.includes('ean'));
                 const idxName = headers.findIndex(h => h.includes('nazov') || h.includes('názov'));
                 if (idxEan < 0 || idxName < 0) { alert("Chýba EAN alebo NAZOV."); return; }
                 const items = [];
                 for (let i = 1; i < lines.length; i++) {
                     const cols = lines[i].split(delim).map(c => c.trim().replace(/"/g, ''));
                     if (cols.length < 2) continue;
                     const ean = cols[idxEan]; const name = cols[idxName];
                     if (ean && name) items.push({ ean, nazov_vyrobku: name, typ_polozky: 'VÝROBOK', dph: 20, predajna_kategoria: '' });
                 }
                 if (items.length === 0) { alert("Žiadne dáta."); return; }
                 showStatus(`Odosielam ${items.length} položiek...`);
                 try {
                     const res = await apiRequest('/api/kancelaria/importCatalogBulk', { method: 'POST', body: { items: items } });
                     alert(res.message); showStatus(res.message, false);
                     window.erpMount(viewCatalogManagement);
                 } catch (err) { alert("Chyba: " + err.message); }
             };
             reader.readAsText(file, 'windows-1250'); 
        };
    };
    return { html, onReady };
  }
  // ===================== MINIMÁLNE ZÁSOBY (EDITOR) =================
  async function viewMinStock(){
    const rows = await apiRequest('/api/kancelaria/getProductsForMinStock') || [];
    const data = Array.isArray(rows) ? rows : [];

    const original = new Map(
      data.map(r => [
        String(r.ean),
        {
          kg: (r.minStockKg === '' || r.minStockKg == null ? NaN : Number(r.minStockKg)),
          ks: (r.minStockKs === '' || r.minStockKs == null ? NaN : Number(r.minStockKs))
        }
      ])
    );

    const html = `
      <div class="erp-panel">
        <div class="panel-head" style="display:flex;justify-content:space-between;gap:.5rem;align-items:center;">
          <h2>Minimálne zásoby (Katalóg výrobkov a tovaru)</h2>
          <div style="display:flex;gap:.5rem;">
            <button class="btn-secondary" id="btn-back-cat">Späť na Katalóg</button>
            <button class="btn-primary" id="btn-save-min">Uložiť minimálne zásoby</button>
          </div>
        </div>

        <div class="stat-card" style="margin-bottom:.75rem;">
          <div class="form-grid" style="grid-template-columns: 1.2fr 1fr;">
            <div class="form-group">
              <label>Filtrovať názov/EAN</label>
              <input id="ms-filter" type="text" placeholder="napr. klobása / 8580..." />
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;gap:.5rem;">
              <input type="checkbox" id="ms-only-changed" />
              <label for="ms-only-changed" style="margin:0;">Zobraziť len zmenené položky</label>
            </div>
          </div>
        </div>

        <div class="table-wrap">
          <table class="tbl" id="ms-table">
            <thead>
              <tr>
                <th style="width:140px;">EAN</th>
                <th>Názov</th>
                <th style="width:90px;">MJ</th>
                <th style="width:140px; text-align:right;">Min (kg)</th>
                <th style="width:140px; text-align:right;">Min (ks)</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(r => `
                <tr data-ean="${String(r.ean)}">
                  <td>${String(r.ean)}</td>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${escapeHtml(r.mj || '')}</td>
                  <td style="text-align:right">
                    <input class="ms-kg" type="number" step="0.001" min="0" placeholder="—"
                           value="${(r.minStockKg ?? '')}" style="width:120px;text-align:right;">
                  </td>
                  <td style="text-align:right">
                    <input class="ms-ks" type="number" step="1" min="0" placeholder="—"
                           value="${(r.minStockKs ?? '')}" style="width:120px;text-align:right;">
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const onReady = () => {
      const backBtn  = document.getElementById('btn-back-cat');
      if (backBtn) backBtn.onclick = () => window.erpMount(viewCatalogManagement);

      const tbl       = document.getElementById('ms-table');
      const inpFilter = document.getElementById('ms-filter');
      const cbChanged = document.getElementById('ms-only-changed');

      function isChanged(tr){
        const ean = String(tr?.dataset?.ean || '');
        const kg  = tr.querySelector('.ms-kg')?.value ?? '';
        const ks  = tr.querySelector('.ms-ks')?.value ?? '';
        const o   = original.get(ean) || {kg: NaN, ks: NaN};

        const kgN = kg === '' ? NaN : parseFloat(kg.replace(',','.'));
        const ksN = ks === '' ? NaN : parseFloat(ks.replace(',','.'));
        const okg = isNaN(o.kg) ? NaN : Number(o.kg);
        const oks = isNaN(o.ks) ? NaN : Number(o.ks);

        return (isNaN(kgN) !== isNaN(okg)) || (!isNaN(kgN) && kgN !== okg)
            || (isNaN(ksN) !== isNaN(oks)) || (!isNaN(ksN) && ksN !== oks);
      }

      function applyFilter(){
        const q    = (inpFilter?.value || '').toLowerCase().trim();
        const only = !!cbChanged?.checked;
        tbl?.querySelectorAll('tbody tr')?.forEach(tr => {
          const e = tr.dataset.ean || '';
          const n = tr.children[1]?.textContent || '';
          const hay = (e + ' ' + n).toLowerCase();
          const matchQ = !q || hay.includes(q);
          const matchC = !only || isChanged(tr);
          tr.style.display = (matchQ && matchC) ? '' : 'none';
        });
      }

      inpFilter?.addEventListener('input',  applyFilter);
      cbChanged?.addEventListener('change', applyFilter);

      const saveBtn = document.getElementById('btn-save-min');
      if (saveBtn){
        saveBtn.onclick = async () => {
          const payload = [];
          const safeParse = (val) => {
              if (!val) return null;
              const n = parseFloat(String(val).replace(',', '.'));
              return isNaN(n) ? null : n;
          };

          tbl?.querySelectorAll('tbody tr')?.forEach(tr => {
            const ean = tr.dataset.ean;
            const kgRaw = tr.querySelector('.ms-kg')?.value ?? '';
            const ksRaw = tr.querySelector('.ms-ks')?.value ?? '';
            const minStockKg = safeParse(kgRaw);
            const minStockKs = safeParse(ksRaw);
            if (ean) payload.push({ ean, minStockKg, minStockKs });
          });

          if (!payload.length){ showStatus('Žiadne dáta na uloženie.', true); return; }

          try {
            const res = await apiRequest('/api/kancelaria/updateMinStockLevels', { method:'POST', body: payload });
            if(res.error) throw new Error(res.error);
            payload.forEach(p => {
              original.set(String(p.ean), {
                kg: (p.minStockKg === null ? NaN : Number(p.minStockKg)),
                ks: (p.minStockKs === null ? NaN : Number(p.minStockKs))
              });
            });
            showStatus(res?.message || 'Minimálne zásoby uložené.', false);
            applyFilter();
          } catch (err) {
            showStatus('Ukladanie zlyhalo: ' + (err?.message || String(err)), true);
          }
        };
      }
    };
    return { html, onReady };
  }

  // ===================== NOVÝ RECEPT (INLINE + HACCP) ======================
  async function viewCreateRecipeInline() {
    await ensureOfficeDataIsLoaded();
    await ensureWarehouseCache(true);
    const base = getOfficeData();

    // ZMENA: Spracovanie objektov {name, ean} namiesto stringov, plus fallback na starý systém
    const productOpts = (base.productsWithoutRecipe || []).map(prod => {
  if (typeof prod === 'object' && prod !== null) {
    const label = prod.ean ? `[${prod.ean}] ${prod.name}` : prod.name;
    return `<option value="${escapeHtml(prod.name)}">${escapeHtml(label)}</option>`;
  }
  return `<option value="${escapeHtml(prod)}">${escapeHtml(prod)}</option>`;
}).join('');

    const catOpts = (base.recipeCategories || []).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    const html = `
      <div class="stat-card">
        <h3 style="margin-top:0;">Nový recept</h3>
        <form id="rcp-create-form" autocomplete="off">
          <div class="form-grid">
            <div class="form-group">
              <label>Produkt (existujúci „VÝROBOK“ bez receptu)</label>
              <select id="rcp-product" required>
                <option value="">-- Vyberte produkt --</option>
                ${productOpts}
              </select>
            </div>
            <div class="form-group">
              <label>Kategória receptu</label>
              <select id="rcp-cat"><option value="">-- Vyberte --</option>${catOpts}</select>
              <small>alebo nová:</small>
              <input id="rcp-newcat" type="text" placeholder="Nová kategória (nepovinné)">
            </div>
          </div>

          <h4 style="margin-top:1rem;">Suroviny podľa kategórií</h4>
          <div class="form-grid" style="grid-template-columns:repeat(4,minmax(280px,1fr)); gap:1rem;">
            ${['maso','koreniny','obal','pomocny_material'].map(key => `
              <div class="classSlot stat-card">
                <h5>${escapeHtml(({'maso':'Mäso','koreniny':'Koreniny','obal':'Obaly - Črevá','pomocny_material':'Pomocný materiál'})[key])}</h5>
                <input type="text" class="flt" data-key="${key}" placeholder="Hľadať..." style="width:100%;margin:0 0 .5rem 0;">
                <select class="sel" data-key="${key}" size="10" style="width:100%;min-height:220px;"></select>
                <div style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem;">
                  <input class="qty" data-key="${key}" type="number" step="0.001" min="0" placeholder="kg" style="flex:1;">
                  <button type="button" class="btn-secondary add" data-key="${key}" style="width:auto;">Pridať</button>
                </div>
                <div class="muted" style="font-size:.85rem;">Posledná cena: <span class="price" data-key="${key}">—</span></div>
              </div>`).join('')}
          </div>

          <h4 style="margin-top:1rem;">Súpis surovín</h4>
          <div class="table-container">
            <table id="rcp-table" style="width:100%;">
              <thead><tr><th>Kategória</th><th>Názov</th><th>Množstvo (kg)</th><th>Cena €/kg</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>

          <div id="rcp-cost" class="muted" style="margin:1rem 0;">Odhad ceny dávky: —</div>

          <div class="stat-card" style="margin-top:1rem;">
            <h4 style="margin:0 0 .5rem 0;">Parametre (HACCP, nutričné, CCP, postup)</h4>
            <div class="form-grid" style="grid-template-columns: repeat(4, 1fr);">
              <div class="form-group"><label>Energia (kJ/100g)</label><input id="pm-kj" type="number" step="0.01"></div>
              <div class="form-group"><label>Energia (kcal/100g)</label><input id="pm-kcal" type="number" step="0.01"></div>
              <div class="form-group"><label>Tuky (g/100g)</label><input id="pm-fat" type="number" step="0.01"></div>
              <div class="form-group"><label>z toho nasýtené (g/100g)</label><input id="pm-sfat" type="number" step="0.01"></div>
              <div class="form-group"><label>Sacharidy (g/100g)</label><input id="pm-carb" type="number" step="0.01"></div>
              <div class="form-group"><label>z toho cukry (g/100g)</label><input id="pm-sugar" type="number" step="0.01"></div>
              <div class="form-group"><label>Bielkoviny (g/100g)</label><input id="pm-prot" type="number" step="0.01"></div>
              <div class="form-group"><label>Soľ (g/100g)</label><input id="pm-salt" type="number" step="0.01"></div>
              <div class="form-group"><label>Vláknina (g/100g)</label><input id="pm-fiber" type="number" step="0.01"></div>
              <div class="form-group"><label>Trvácnosť (dni)</label><input id="pm-shelf" type="number" step="1"></div>
              <div class="form-group"><label>Skladovanie (°C / popis)</label><input id="pm-storage"></div>
              <div class="form-group"><label>Alergény (čiarkou oddelené)</label><input id="pm-allergens" placeholder="lepok, mlieko, ..."></div>
            </div>
            <div class="form-group"><label>Postup výroby</label><textarea id="pm-steps" rows="6" placeholder="Krok 1…"></textarea></div>
            <div class="form-group"><label>CCP body (kritické kontrolné body)</label><textarea id="pm-ccp" rows="4" placeholder="CCP1: ...\nCCP2: ..."></textarea></div>
          </div>

          <div style="display:flex; gap:.75rem; justify-content:flex-end; margin-top:.75rem;">
            <button type="submit" class="btn-primary"><i class="fas fa-save"></i> Uložiť recept</button>
          </div>
        </form>
      </div>
    `;

    const onReady = async () => {
      const tbody = document.querySelector('#rcp-table tbody');
      const parseNum = (v) => parseFloat(String(v).replace(',','.'));
      const catKeys = ['maso','koreniny','obal','pomocny_material'];
      const namesByKey = {};

      async function fetchList(key){
        let arr = [];
        try{
          const r = await apiRequest(`/api/kancelaria/stock/allowed-names?category=${encodeURIComponent(key)}`);
          arr = (r?.items||[]).map(i=>({ name:String(i.name), price:(i.last_price!=null?Number(i.last_price):null) }));
        }catch(_){ arr = []; }
        namesByKey[key] = arr.sort((a,b)=> byLocale(a.name,b.name));
      }
      await Promise.all(catKeys.map(fetchList));

      function fillSelect(key, filter=''){
        const sel = document.querySelector(`select.sel[data-key="${key}"]`);
        const priceSpan = document.querySelector(`.price[data-key="${key}"]`);
        if (!sel || !priceSpan) return;
        const list = (namesByKey[key] || []).filter(x => x.name.toLowerCase().includes((filter||'').toLowerCase()));
        sel.innerHTML = list.map(x => `<option data-name="${escapeHtml(x.name)}" data-price="${x.price ?? ''}">${escapeHtml(x.name)}</option>`).join('');
        priceSpan.textContent = '—';
        sel.onchange = () => {
          const p = sel.selectedOptions[0]?.dataset.price;
          priceSpan.textContent = p ? `${parseFloat(p).toFixed(2)} €/kg` : '—';
        };
      }

      catKeys.forEach((k) => {
        const sel = document.querySelector(`select.sel[data-key="${k}"]`);
        const flt = document.querySelector(`input.flt[data-key="${k}"]`);
        fillSelect(k, '');
        if (flt) flt.addEventListener('input', () => fillSelect(k, flt.value));
        if (sel) sel.addEventListener('change', () => sel.onchange && sel.onchange());
      });

      function recomputeCost() {
        if (!tbody) return;
        let sum = 0;
        tbody.querySelectorAll('tr').forEach((tr) => {
          const qty  = parseNum(tr.querySelector('.qty')?.value || 0) || 0;
          const pstr = tr.querySelector('.p')?.textContent || '0';
          const price= parseNum(pstr) || 0;
          sum += qty * price;
        });
        const costEl = document.getElementById('rcp-cost');
        if (costEl) costEl.textContent = sum ? `Odhad ceny dávky: ${sum.toFixed(2)} €` : 'Odhad ceny dávky: —';
      }
      

      function addToTable(key) {
        if (!tbody) return;
        const sel = document.querySelector(`select.sel[data-key="${key}"]`);
        const qtyEl = document.querySelector(`input.qty[data-key="${key}"]`);
        if (!sel || !qtyEl) return;
        const name  = sel.selectedOptions[0]?.dataset.name || '';
        const price = parseNum(sel.selectedOptions[0]?.dataset.price || 0);
        const qty   = parseNum(qtyEl.value);
        if (!name || !qty || qty <= 0) { showStatus('Vyberte surovinu a zadajte množstvo.', true); return; }

        const trEl = document.createElement('tr');
        trEl.innerHTML = `
          <td>${escapeHtml(({'maso':'Mäso','koreniny':'Koreniny','obal':'Obaly – Črevá','pomocny_material':'Pomocný materiál'})[key])}</td>
          <td>${escapeHtml(name)}</td>
          <td><input type="number" class="qty" step="0.001" min="0" value="${qty.toFixed(3)}" style="width:120px"></td>
          <td class="p">${price ? price.toFixed(2) : '0.00'}</td>
          <td><button type="button" class="btn-danger del" title="Odstrániť" style="margin:0;padding:4px 8px;width:auto;">X</button></td>
        `;
        trEl.querySelector('.del').onclick = () => { trEl.remove(); recomputeCost(); };
        trEl.querySelector('.qty').oninput = recomputeCost;
        tbody.appendChild(trEl);
        qtyEl.value = '';
        sel.focus();
        recomputeCost();
      }

      document.querySelectorAll('.add[data-key]').forEach(btn=>{
        btn.addEventListener('click', ()=> addToTable(btn.dataset.key));
      });

      function toNum(v){
        if (v==='' || v==null) return null;
        const n = parseFloat(String(v).replace(',','.'));
        return Number.isFinite(n)?n:null;
      }
      function readMeta(){
        return {
          energy_kj: toNum(document.getElementById('pm-kj').value),
          energy_kcal: toNum(document.getElementById('pm-kcal').value),
          fat: toNum(document.getElementById('pm-fat').value),
          sat_fat: toNum(document.getElementById('pm-sfat').value),
          carbs: toNum(document.getElementById('pm-carb').value),
          sugars: toNum(document.getElementById('pm-sugar').value),
          protein: toNum(document.getElementById('pm-prot').value),
          salt: toNum(document.getElementById('pm-salt').value),
          fiber: toNum(document.getElementById('pm-fiber').value),
          shelf_life_days: toNum(document.getElementById('pm-shelf').value),
          storage: (document.getElementById('pm-storage').value||'').trim(),
          allergens: (document.getElementById('pm-allergens').value||'').split(',').map(s=>s.trim()).filter(Boolean),
          process_steps: (document.getElementById('pm-steps').value||'').trim(),
          ccp_points: (document.getElementById('pm-ccp').value||'').trim()
        };
      }

      const form = document.getElementById('rcp-create-form');
      if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const productName = document.getElementById('rcp-product')?.value || '';
        const newCategory = document.getElementById('rcp-newcat')?.value.trim() || '';
        const existingCat = document.getElementById('rcp-cat')?.value || '';
        if (!productName){ showStatus('Vyberte produkt.', true); return; }
        if (!newCategory && !existingCat){ showStatus('Zvoľte kategóriu alebo zadajte novú.', true); return; }
        const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];
        const ingredients = rows.map(tr => ({
          name: tr.children[1].textContent,
          quantity: parseFloat(tr.querySelector('.qty').value)
        })).filter(x => x.name && x.quantity > 0);
        if (!ingredients.length){ showStatus('Recept musí obsahovať aspoň jednu surovinu.', true); return; }

        try {
            await apiRequest('/api/kancelaria/addNewRecipe', { method: 'POST', body: { productName, ingredients, category: existingCat, newCategory } });
            await apiRequest('/api/kancelaria/saveRecipeMeta', { method:'POST', body:{ product_name: productName, meta: readMeta() } });
            showStatus('Recept uložený.', false);
            window.erpMount(() => renderRecipeEditorInline(productName));
        } catch(err) { alert(err.message); }
      });
    };
    return { html, onReady };
  }

 // ===================== EDITOR RECEPTU (SÚČET MNOŽSTVA AJ CENY) ===================
  async function renderRecipeEditorInline(productName){
    // 1. Načítanie základných dát
    await ensureOfficeDataIsLoaded();
    await ensureWarehouseCache(true);
    const base = getOfficeData();
    
    // Získame detaily receptu
    const details = await apiRequest('/api/kancelaria/getRecipeDetails', { method: 'POST', body: { productName } });

    // Pripravíme možnosti pre kategóriu RECEPTU
    const catOpts = (base.recipeCategories || [])
      .map(c => `<option value="${escapeHtml(c)}"${details && details.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)
      .join('');

    // --- Prednačítanie surovín (Cache) ---
    const apiCats = ['maso', 'koreniny', 'obal', 'pomocny_material'];
    const ingredientsCache = {}; 
    const ingredientToCatMap = {}; 

    const catMapping = {
        'maso': 'Mäso',
        'koreniny': 'Koreniny',
        'obal': 'Obaly - Črevá',
        'pomocny_material': 'Pomocný materiál'
    };
    const uiCategories = Object.values(catMapping); 
    const uiToApi = Object.fromEntries(Object.entries(catMapping).map(([k,v]) => [v, k]));

    // Paralelné načítanie číselníkov
    await Promise.all(apiCats.map(async (key) => {
        try {
            const res = await apiRequest('/api/kancelaria/stock/allowed-names?category=' + key);
            const items = res?.items || [];
            ingredientsCache[key] = items;
            items.forEach(item => {
                ingredientToCatMap[item.name] = key; 
            });
        } catch(e) { console.error("Chyba load cat:", key, e); }
    }));

    // 2. HTML Šablóna
    const html = `
      <div class="stat-card recipe-editor">
        <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <h3 style="margin:0; color:#1e293b;"><i class="fas fa-scroll" style="color:#3b82f6; margin-right:8px;"></i>${escapeHtml(productName)}</h3>
            <span class="text-muted" style="font-size:0.9rem;">Úprava výrobnej receptúry</span>
          </div>
          
          <div style="display:flex; gap: 0.5rem;">
            <button id="rcp-delete" class="btn-danger btn-sm">
                <i class="fas fa-trash"></i> Vymazať recept
            </button>
            <button id="rcp-save" class="btn-success btn-sm" style="min-width: 140px;">
                <i class="fas fa-save"></i> Uložiť zmeny
            </button>
          </div>
        </div>

        <div class="form-grid" style="margin-bottom: 1.5rem; max-width: 800px;">
          <div class="form-group">
            <label style="font-weight:600; color:#475569;">Kategória produktu</label>
            <div style="display:flex; gap:0.5rem;">
                <select id="rcp-cat" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
                    <option value="">-- Vyberte existujúcu --</option>
                    ${catOpts}
                </select>
                <input id="rcp-newcat" type="text" placeholder="...alebo nová" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
            </div>
          </div>
        </div>

        <h4 style="margin:0 0 0.5rem 0; color:#334155;">Zloženie receptúry</h4>
        <div class="table-container" style="border:1px solid #e2e8f0; border-radius:8px; overflow:visible; box-shadow: 0 1px 3px rgba(0,0,0,0.05); min-height: 200px;">
            <table class="tbl" id="rcp-table" style="width:100%; border-collapse:collapse;">
                <thead style="background:#f8fafc; color:#475569; font-size:0.85rem; text-transform:uppercase; border-bottom:1px solid #e2e8f0;">
                    <tr>
                        <th style="width: 25%; padding:12px;">Typ Suroviny</th>
                        <th style="width: 30%; padding:12px;">Názov Suroviny</th>
                        <th style="width: 15%; padding:12px; text-align:right;">Cena (€/kg)</th>
                        <th style="width: 15%; padding:12px; text-align:right;">Množstvo (kg)</th>
                        <th style="width: 10%; padding:12px; text-align:right;">Spolu (€)</th>
                        <th style="width: 5%; padding:12px; text-align:center;"></th>
                    </tr>
                </thead>
                <tbody id="rcp-ingredients-body"></tbody>
                <tfoot style="background:#f1f5f9; font-weight:bold; border-top:1px solid #e2e8f0;">
                    <tr>
                        <td colspan="3" style="text-align:right; padding:12px; color:#475569;">SÚČET:</td>
                        <td id="rcp-total-qty" style="text-align:right; padding:12px; color:#1e293b;">0.000 kg</td>
                        <td id="rcp-total-cost" style="text-align:right; padding:12px; color:#059669; font-size:1.1em;">0.00 €</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>

        <div style="margin-top: 1rem; text-align:center;">
          <button type="button" id="rcp-add-row" class="btn-secondary" style="border-radius:20px; padding: 8px 24px; font-weight:500;">
            <i class="fas fa-plus-circle"></i> Pridať surovinu
          </button>
        </div>
      </div>
      
      <style>
        .recipe-editor input.rcp-input, .recipe-editor select.rcp-select {
            border: 1px solid transparent; border-radius: 4px; padding: 6px; width: 100%; background: transparent; transition: all 0.2s;
        }
        .recipe-editor input.rcp-input:hover, .recipe-editor select.rcp-select:hover { background: #f8fafc; border-color: #cbd5e1; }
        .recipe-editor input.rcp-input:focus, .recipe-editor select.rcp-select:focus { background: #fff; border-color: #3b82f6; outline: none; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1); }
        .recipe-editor .btn-icon-del { background: transparent; color: #ef4444; border: 1px solid #fee2e2; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items:center; justify-content:center; }
        .recipe-editor .btn-icon-del:hover { background: #fee2e2; color: #dc2626; }
      </style>
      `;

    // 3. Logika
    const onReady = () => {
      const tbody = $('#rcp-ingredients-body');
      const totalCostEl = $('#rcp-total-cost');
      const totalQtyEl = $('#rcp-total-qty'); // Element pre súčet kg
      
      const parseNum = v => { if(!v) return 0; return parseFloat(String(v).replace(',','.').replace(/\s/g,'')) || 0; };

      // Naplní select
      function populateNames(catKey, selectEl, selectedName = null, priceEl, subtotalEl, qtyEl) {
          const items = ingredientsCache[catKey] || [];
          selectEl.innerHTML = '<option value="">-- Vyberte --</option>' +
              items.map(i => {
                  const price = i.last_price != null ? i.last_price : '';
                  const sel = selectedName === i.name ? 'selected' : '';
                  return `<option data-price="${price}" value="${escapeHtml(String(i.name))}" ${sel}>${escapeHtml(String(i.name))}</option>`;
              }).join('');

          if (selectedName) {
              const item = items.find(i => i.name === selectedName);
              updateRowPrice(item ? item.last_price : 0, priceEl, subtotalEl, qtyEl);
          }
      }

      function updateRowPrice(priceVal, priceEl, subtotalEl, qtyEl) {
          const p = parseFloat(priceVal) || 0;
          priceEl.textContent = p > 0 ? p.toFixed(3) + ' €' : '—';
          priceEl.dataset.value = p;
          
          const q = parseNum(qtyEl.value);
          const sub = q * p;
          subtotalEl.textContent = sub > 0 ? sub.toFixed(2) + ' €' : '';
          subtotalEl.dataset.value = sub;
          recomputeTotal();
      }

      // Prepočet celkových súčtov (Cena aj KG)
      function recomputeTotal() {
        let totalCost = 0;
        let totalQty = 0;

        tbody.querySelectorAll('tr').forEach(tr => {
            const sub = parseNum(tr.querySelector('.rcp-subtotal').dataset.value);
            const qty = parseNum(tr.querySelector('.rcp-qty').value);
            
            totalCost += sub;
            totalQty += qty;
        });

        totalCostEl.textContent = totalCost.toFixed(2) + " €";
        totalQtyEl.textContent = totalQty.toFixed(3) + " kg";
      }

      function addRow(prefill) {
          const tr = document.createElement('tr');
          tr.className = 'recipe-ingredient-row';
          tr.style.borderBottom = "1px solid #f1f5f9";
          
          let detectedApiCat = 'maso'; 
          if (prefill && prefill.name && ingredientToCatMap[prefill.name]) {
              detectedApiCat = ingredientToCatMap[prefill.name];
          } 

          const detectedUiCat = catMapping[detectedApiCat];

          tr.innerHTML = `
            <td style="padding: 5px;">
                <select class="rcp-cat-sel rcp-select">
                    ${uiCategories.map(c => `<option value="${uiToApi[c]}" ${c === detectedUiCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                </select>
            </td>
            <td style="padding: 5px;">
                <select class="rcp-name-sel rcp-select"></select>
            </td>
            <td style="padding: 10px; text-align:right; vertical-align:middle; color:#64748b; font-family:monospace;">
                <span class="rcp-price" data-value="0">—</span>
            </td>
            <td style="padding: 5px;">
                <input class="rcp-qty rcp-input" type="number" step="0.001" min="0" placeholder="0.000" style="text-align:right; font-weight:500;">
            </td>
            <td style="padding: 10px; text-align:right; vertical-align:middle; font-weight:bold; color:#334155;">
                <span class="rcp-subtotal" data-value="0"></span>
            </td>
            <td style="padding: 5px; text-align:center;">
                <button type="button" class="btn-icon-del" title="Odstrániť"><i class="fas fa-times"></i></button>
            </td>
          `;
          
          tbody.appendChild(tr);
          
          const selCat = tr.querySelector('.rcp-cat-sel');
          const selName = tr.querySelector('.rcp-name-sel');
          const priceEl = tr.querySelector('.rcp-price');
          const qtyEl = tr.querySelector('.rcp-qty');
          const subtotalEl = tr.querySelector('.rcp-subtotal');
          const btnDel = tr.querySelector('.btn-icon-del');

          // Inicializácia
          if (prefill) {
              qtyEl.value = prefill.quantity;
              populateNames(detectedApiCat, selName, prefill.name, priceEl, subtotalEl, qtyEl);
              
              // Fallback ceny z histórie receptu
              if (prefill.last_price && (!priceEl.dataset.value || priceEl.dataset.value == 0)) {
                  updateRowPrice(prefill.last_price, priceEl, subtotalEl, qtyEl);
              }
          } else {
              populateNames(detectedApiCat, selName, null, priceEl, subtotalEl, qtyEl);
          }

          // Listeners
          selCat.addEventListener('change', () => {
              populateNames(selCat.value, selName, null, priceEl, subtotalEl, qtyEl);
          });

          selName.addEventListener('change', () => {
              const opt = selName.selectedOptions[0];
              const p = opt ? opt.dataset.price : 0;
              updateRowPrice(p, priceEl, subtotalEl, qtyEl);
          });

          qtyEl.addEventListener('input', () => {
              const p = parseFloat(priceEl.dataset.value) || 0;
              updateRowPrice(p, priceEl, subtotalEl, qtyEl);
          });

          btnDel.addEventListener('click', () => { tr.remove(); recomputeTotal(); });
      }

      // Naplnenie tabuľky
      if (details && details.ingredients && details.ingredients.length > 0){
        details.ingredients.forEach(ing => addRow(ing));
      } else {
        addRow(null);
      }

      onClick('#rcp-add-row', () => addRow(null));

      onClick('#rcp-save', async () => {
        const rows = Array.from(document.querySelectorAll('#rcp-table tbody tr'));
        const ingredients = rows.map(r => ({
            name: r.querySelector('.rcp-name-sel').value,
            quantity: parseNum(r.querySelector('.rcp-qty').value)
        })).filter(i => i.name && i.quantity > 0);

        if(ingredients.length === 0) {
            showStatus('Chyba: Recept musí obsahovať aspoň jednu surovinu.', true);
            return;
        }

        try {
            const resp = await apiRequest('/api/kancelaria/updateRecipe', {
                method: 'POST',
                body: { 
                    productName, 
                    ingredients, 
                    category: document.getElementById('rcp-cat').value,
                    newCategory: document.getElementById('rcp-newcat').value
                }
            });
            if(!resp.error) {
                showStatus('Recept bol úspešne uložený.', false);
                renderRecipeEditorInline(productName); 
            }
            else showStatus('Chyba: ' + resp.error, true);
        } catch(e) {
            showStatus('Chyba: ' + e.message, true);
        }
      });

      onClick('#rcp-delete', async () => {
        if(confirm(`Naozaj chcete vymazať celý recept pre "${productName}"?`)) {
            await apiRequest('/api/kancelaria/deleteRecipe', { method:'POST', body:{ productName } });
            showStatus('Recept vymazaný.', false);
            if(window.erpMount) window.erpMount(viewEditRecipeListInline);
        }
      });
    };
    return { html, onReady };
  }
  // ===================== ZOZNAM RECEPTOV NA ÚPRAVU ==========================
  async function viewEditRecipeListInline(){
    const data = await apiRequest('/api/kancelaria/getAllRecipesForEditing');
    const categories = data && typeof data === 'object' ? data : {};
    let html = `<div class="stat-card">
      <h3 style="margin-top:0;">Upraviť recept</h3>
      <div class="form-group"><input id="re-fq" placeholder="Filtrovať podľa názvu alebo EAN…" /></div>
      <div class="re-list">`;

    const catNames = Object.keys(categories).sort((a,b)=> String(a||'').localeCompare(String(b||''),'sk'));
    if (!catNames.length){ html += '<p>Žiadne recepty na úpravu.</p>'; } else {
      for (const cat of catNames){
        const items = categories[cat] || [];
        if (!items.length) continue;
        html += `<h4>${escapeHtml(cat || 'Nezaradené')}</h4><div class="re-cat-block">`;
        
        // ZMENA: iterujeme cez objekty {name, ean}, nie iba stringy
        html += items.map(rcp => {
          const name = rcp.name || rcp; // Fallback, ak by backend z nejakého dôvodu poslal starý formát
          const ean = rcp.ean ? `[${rcp.ean}] ` : '';
          const label = ean + name;
          
          return `<button type="button" class="btn-secondary rcp-open" data-name="${escapeHtml(name)}" data-label="${escapeHtml(label)}" style="margin:.25rem .25rem 0 0;">${escapeHtml(label)}</button>`;
        }).join('');
        
        html += '</div>';
      }
    }
    html += `</div></div>`;

    const onReady = ()=>{
      const filterInput = document.getElementById('re-fq');
      function applyFilter(){
        const f = (filterInput.value || '').toLowerCase();
        document.querySelectorAll('.re-cat-block').forEach(block => {
          let anyVisible = false;
          block.querySelectorAll('.rcp-open').forEach(btn => {
            // Hľadáme buď podľa name, alebo podľa celého labelu (kde je aj EAN)
            const nm = (btn.dataset.label || btn.textContent || '').toLowerCase();
            const show = !f || nm.includes(f);
            btn.style.display = show ? '' : 'none';
            if (show) anyVisible = true;
          });
          block.style.display = anyVisible ? '' : 'none';
        });
      }
      if (filterInput) filterInput.addEventListener('input', applyFilter);
      
      document.querySelectorAll('.rcp-open').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name || btn.textContent;
          if (name && typeof window.erpMount === 'function') window.erpMount(() => renderRecipeEditorInline(name));
        });
      });
    };
    return { html, onReady };
  }
// ===================== SPRÁVA KRÁJANIA (SLICING) - KOMPLETNÁ ==========================
  async function viewSlicingManagement(){
    // 1. Načítanie existujúcich väzieb
    let pairs = [];
    try {
        const resp = await apiRequest('/api/kancelaria/getSlicingPairs');
        pairs = Array.isArray(resp) ? resp : (resp.items || []);
    } catch(e) { 
        console.warn("Slicing API error:", e); 
    }

    const html = `
      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0;">Krájané produkty (Väzby)</h3>
            <button id="btn-add-slice" class="btn-primary btn-sm"><i class="fas fa-plus"></i> Nová väzba</button>
        </div>
        <p class="text-muted" style="margin-top:5px;">
            Definícia vzťahu: <strong>Zdrojový výrobok (blok)</strong> ➔ <strong>Cieľový výrobok (krájaný)</strong>.
            <br><small>Slúži na automatický odpísanie bloku zo skladu pri výrobe krájaného tovaru.</small>
        </p>

        <div class="table-container" style="max-height: 60vh;">
            <table class="tbl" id="slice-table">
                <thead>
                    <tr>
                        <th>Zdroj (Blok)</th>
                        <th>Cieľ (Krájaný)</th>
                        <th style="text-align:right;">Výťažnosť</th>
                        <th style="width:100px;">Akcia</th>
                    </tr>
                </thead>
                <tbody>
                    ${pairs.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:20px;" class="text-muted">Žiadne definované väzby.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
      </div>
    `;

    const onReady = () => {
        const tbody = document.querySelector('#slice-table tbody');
        
        // Render tabuľky
        if (pairs.length > 0) {
            tbody.innerHTML = pairs.map(item => `
                <tr>
                    <td>${escapeHtml(item.source_name)} <span class="text-muted">(${item.source_ean})</span></td>
                    <td>${escapeHtml(item.target_name)} <span class="text-muted">(${item.target_ean})</span></td>
                    <td style="text-align:right;">${item.yield ? item.yield + '%' : '100%'}</td>
                    <td>
                        <button class="btn-danger btn-sm btn-del-slice" data-id="${item.id}">Zmazať</button>
                    </td>
                </tr>
            `).join('');
        }

        // Handler pre Zmazať
        tbody.querySelectorAll('.btn-del-slice').forEach(btn => {
            btn.onclick = async () => {
                if(!confirm('Naozaj zmazať túto väzbu?')) return;
                try {
                    await apiRequest('/api/kancelaria/deleteSlicingPair', { method: 'POST', body: { id: btn.dataset.id } });
                    showStatus('Väzba zmazaná.', false);
                    window.erpMount(viewSlicingManagement); // Refresh
                } catch(e) { showStatus('Chyba: ' + e.message, true); }
            };
        });

        // Handler pre Nová väzba (Otvorí Modal)
        const btnAdd = document.getElementById('btn-add-slice');
        if (btnAdd) {
            btnAdd.onclick = async () => {
                // Najprv načítame zoznam produktov pre výber (Dropdown)
                showStatus('Načítavam produkty...', false);
                let products = [];
                try {
                    const catData = await apiRequest('/api/kancelaria/getCatalogManagementData');
                    products = catData.products || [];
                } catch(e) {
                    showStatus('Nepodarilo sa načítať katalóg: ' + e.message, true);
                    return;
                }

                // Zoradíme abecedne
                products.sort((a,b) => (a.nazov_vyrobku||'').localeCompare(b.nazov_vyrobku||''));

                // Vytvoríme <option> pre select
                const optionsHtml = products.map(p => 
                    `<option value="${p.ean}">${escapeHtml(p.nazov_vyrobku)} (${p.ean})</option>`
                ).join('');

                const modalHtml = `
                    <div class="form-group">
                        <label>Zdrojový produkt (Blok)</label>
                        <select id="slice-source" style="width:100%; padding:8px;" class="select-search">
                            <option value="">-- Vyberte blok --</option>
                            ${optionsHtml}
                        </select>
                        <small class="text-muted">Produkt, z ktorého sa krája (skladová zásoba sa zníži).</small>
                    </div>
                    <div class="form-group" style="margin-top:15px;">
                        <label>Cieľový produkt (Krájaný)</label>
                        <select id="slice-target" style="width:100%; padding:8px;" class="select-search">
                            <option value="">-- Vyberte krájaný výrobok --</option>
                            ${optionsHtml}
                        </select>
                        <small class="text-muted">Produkt, ktorý vznikne (skladová zásoba sa zvýši).</small>
                    </div>
                    <div class="form-group" style="margin-top:15px;">
                        <label>Váha balenia cieľového produktu (g)</label>
                        <input id="slice-weight" type="number" step="1" value="1000" style="width:100%; padding:8px;">
                        <small class="text-muted">Zadajte 1000 pre kg, alebo napr. 100 pre 100g balíčky.</small>
                    </div>
                    <div style="margin-top:20px; text-align:right;">
                        <button id="slice-save-btn" class="btn-primary">Vytvoriť väzbu</button>
                    </div>
                `;

                openModalCompat('Nová väzba krájania', {
                    html: modalHtml,
                    onReady: () => {
                        const btnSave = document.getElementById('slice-save-btn');
                        btnSave.onclick = async () => {
                            const sourceEan = document.getElementById('slice-source').value;
                            const targetEan = document.getElementById('slice-target').value;
                            const weight = document.getElementById('slice-weight').value;

                            if (!sourceEan || !targetEan) {
                                alert("Vyberte zdrojový aj cieľový produkt.");
                                return;
                            }
                            if (sourceEan === targetEan) {
                                alert("Zdroj a cieľ nemôžu byť ten istý produkt.");
                                return;
                            }

                            try {
                                await apiRequest('/api/kancelaria/linkSlicedProduct', {
                                    method: 'POST',
                                    body: { sourceEan, targetEan, weight }
                                });
                                showStatus('Väzba vytvorená.', false);
                                hideModalCompat();
                                window.erpMount(viewSlicingManagement); // Refresh tabuľky
                            } catch (e) {
                                alert('Chyba: ' + e.message);
                            }
                        };
                    }
                });
            };
        }
    };

    return { html, onReady };
  }

async function viewEanMappingManagement(){
    let pairs = [];
    try {
        const resp = await apiRequest('/api/kancelaria/getEanMapping');
        pairs = Array.isArray(resp) ? resp : [];
    } catch(e) { console.warn("API error:", e); }

    const html = `
      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <h3 style="margin:0;">Mapovanie EAN (Pre B2B Váhový terminál)</h3>
            <div style="display:flex; gap:10px;">
                <button id="btn-import-ean-csv" class="btn-success btn-sm"><i class="fas fa-file-import"></i> Import CSV (COOP Cenník)</button>
                <input id="file-import-ean-csv" type="file" accept=".csv,text/csv" style="display:none;" />
                <button id="btn-add-ean-map" class="btn-primary btn-sm"><i class="fas fa-plus"></i> Nové mapovanie</button>
            </div>
        </div>
        <p class="text-muted" style="margin-top:5px;">
            Prekóduje interný EAN na zákaznícky objednávkový kód v exportovanom CSV súbore do výroby. <b>Dĺžka kódov a pôvodný rozostup v CSV súbore zostane zachovaný. PDF zostáva nezmenené.</b>
        </p>

        <div class="table-container" style="max-height: 60vh;">
            <table class="tbl" id="ean-map-table">
                <thead>
                    <tr>
                        <th>Názov produktu</th>
                        <th>Interný EAN (MIK)</th>
                        <th>Objednávkový EAN (CSV Výstup)</th>
                        <th style="width:100px;">Akcia</th>
                    </tr>
                </thead>
                <tbody>
                    ${pairs.length === 0 ? '<tr><td colspan="4" style="text-align:center; padding:20px;" class="text-muted">Žiadne definované mapovania.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
      </div>
    `;

    const onReady = () => {
        const tbody = document.querySelector('#ean-map-table tbody');
        if (pairs.length > 0) {
            tbody.innerHTML = pairs.map(item => `
                <tr>
                    <td>${escapeHtml(item.nazov_vyrobku || 'Neznámy produkt (mimo DB)')}</td>
                    <td style="font-family:monospace; color:#64748b;">${escapeHtml(item.interny_ean)}</td>
                    <td style="font-family:monospace; font-weight:bold; color:#1e3a8a;">${escapeHtml(item.objednavkovy_kod)}</td>
                    <td>
                        <button class="btn-danger btn-sm btn-del-ean-map" data-id="${item.id}">Zmazať</button>
                    </td>
                </tr>
            `).join('');
        }

        // Mazanie mapovania
        tbody.querySelectorAll('.btn-del-ean-map').forEach(btn => {
            btn.onclick = async () => {
                if(!confirm('Naozaj zmazať toto mapovanie?')) return;
                try {
                    await apiRequest('/api/kancelaria/deleteEanMapping', { method: 'POST', body: { id: btn.dataset.id } });
                    window.erpMount(viewEanMappingManagement);
                } catch(e) { alert('Chyba: ' + e.message); }
            };
        });

        // Spracovanie Importu CSV v prehliadači
        const btnImport = document.getElementById('btn-import-ean-csv');
        const fileImport = document.getElementById('file-import-ean-csv');
        if(btnImport && fileImport) {
            btnImport.onclick = () => fileImport.click();
            fileImport.onchange = async (e) => {
                const file = e.target.files[0]; 
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = async function(evt) {
                    const text = evt.target.result;
                    const delim = text.includes(';') ? ';' : ',';
                    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
                    
                    if (lines.length < 2) { alert("Súbor je prázdny alebo chybný."); return; }
                    
                    const headers = lines[0].toLowerCase().split(delim).map(h => h.trim().replace(/"/g, ''));
                    let idxExt = headers.findIndex(h => h.includes('nové') || h.includes('nove') || h.includes('plu'));
                    let idxInt = headers.findIndex(h => h.includes('mik') || h.includes('kody'));
                    
                    if (idxExt < 0 || idxInt < 0) { idxExt = 0; idxInt = 1; }
                    
                    const items = [];
                    for (let i = 1; i < lines.length; i++) {
                        const cols = lines[i].split(delim).map(c => c.trim().replace(/"/g, ''));
                        if (cols.length <= Math.max(idxExt, idxInt)) continue;
                        
                        let extEan = cols[idxExt];
                        let intEan = cols[idxInt];
                        
                        if (extEan && intEan && !extEan.toUpperCase().includes('EAN') && !intEan.toUpperCase().includes('KODY')) {
                            // Konverzia formátu Excel čísel (232348.0 -> 232348)
                            if(extEan.endsWith('.0')) extEan = extEan.slice(0, -2);
                            if(intEan.endsWith('.0')) intEan = intEan.slice(0, -2);
                            
                            // ===== DOPLNENIE 0 PRE INTERNÝ EAN NA 13 ZNAKOV =====
                            intEan = String(intEan).padStart(13, '0');
                            
                            items.push({ interny_ean: intEan, objednavkovy_kod: extEan });
                        }
                    }
                    
                    if (items.length === 0) { alert("Nenašli sa žiadne platné riadky na import."); return; }
                    
                    showStatus(`Spracovávam ${items.length} riadkov...`);
                    try {
                        const res = await apiRequest('/api/kancelaria/importEanMappingBulk', { method: 'POST', body: { items: items } });
                        if(res.error) throw new Error(res.error);
                        alert(res.message);
                        window.erpMount(viewEanMappingManagement);
                    } catch (err) { alert("Chyba: " + err.message); }
                };
                reader.readAsText(file, 'windows-1250');
                fileImport.value = '';
            };
        }

        // Manuálne pridanie jedného kódu
        const btnAdd = document.getElementById('btn-add-ean-map');
        if (btnAdd) {
            btnAdd.onclick = async () => {
                showStatus('Načítavam produkty...', false);
                let products = [];
                try {
                    const catData = await apiRequest('/api/kancelaria/getCatalogManagementData');
                    products = catData.products || [];
                } catch(e) { alert('Chyba: ' + e.message); return; }

                products.sort((a,b) => (a.nazov_vyrobku||'').localeCompare(b.nazov_vyrobku||''));
                const optionsHtml = products.map(p => `<option value="${p.ean}">${escapeHtml(p.nazov_vyrobku)} (${p.ean})</option>`).join('');

                openModalCompat('Nové EAN mapovanie', {
                    html: `
                    <div class="form-group"><label>Zdrojový produkt (Interný EAN)</label>
                        <select id="map-internal-ean" style="width:100%; padding:8px;" class="select-search">
                            <option value="">-- Vyberte produkt --</option>${optionsHtml}
                        </select></div>
                    <div class="form-group" style="margin-top:15px;"><label>Objednávkový EAN zákazníka</label>
                        <input id="map-external-ean" type="text" style="width:100%; padding:8px;"></div>
                    <div style="margin-top:20px; text-align:right;"><button id="map-save-btn" class="btn-primary">Uložiť</button></div>`,
                    onReady: () => {
                        document.getElementById('map-save-btn').onclick = async () => {
                            let interny_ean = document.getElementById('map-internal-ean').value;
                            const objednavkovy_kod = document.getElementById('map-external-ean').value.trim();
                            if (!interny_ean || !objednavkovy_kod) return;
                            
                            // Ak sa to pridá manuálne, tiež to poistíme
                            interny_ean = String(interny_ean).padStart(13, '0');
                            
                            await apiRequest('/api/kancelaria/saveEanMapping', { method: 'POST', body: { interny_ean, objednavkovy_kod }});
                            hideModalCompat();
                            window.erpMount(viewEanMappingManagement);
                        };
                    }
                });
            };
        }
    };
    return { html, onReady };
  }

  // ------------------ Export init do globálu -----------------------
  window.initializeErpAdminModule = initializeErpAdminModule;

})(window, document);