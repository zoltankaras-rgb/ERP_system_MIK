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
  
  const apiRequest = window.apiRequest || (async (url, opts={})=>{
    const res = await fetch(url, {
      method: opts.method||'GET',
      headers: {'Content-Type':'application/json'},
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
  });

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
          <button id="erp-btn-slicing" class="btn-secondary" style="grid-column: span 2;"><i class="fas fa-cut"></i> Krájané Produkty</button>
        </div>
      </div>
      <div id="erp-admin-content"></div>
    `;
    $('#erp-btn-catalog').onclick   = ()=> window.erpMount(viewCatalogManagement);
    $('#erp-btn-minstock').onclick  = ()=> window.erpMount(viewMinStock);
    $('#erp-btn-slicing').onclick   = ()=> window.erpMount(viewSlicingManagement);
    $('#erp-btn-newrecipe').onclick = ()=> window.erpMount(viewCreateRecipeInline);
    $('#erp-btn-editrecipe').onclick= ()=> window.erpMount(viewEditRecipeListInline);
    $('#erp-btn-catalog').click();
  }

  // =================================================================
  // === 1. SPRÁVA KATALÓGU (S KATEGÓRIAMI, SAVE&NEXT A DELETE) ======
  // =================================================================
  async function viewCatalogManagement(){
    state.catalog = await apiRequest('/api/kancelaria/getCatalogManagementData?ts=' + Date.now()) || {};
    await ensureOfficeDataIsLoaded();
    
    const products = Array.isArray(state.catalog.products) ? state.catalog.products : [];
    const itemTypes = state.catalog.item_types || ['VÝROBOK', 'TOVAR'];
    const dphRates = state.catalog.dph_rates || [20, 10, 0];
    const saleCats = state.catalog.sale_categories || [];
    const recipeCats = state.catalog.recipe_categories || [];

    const distinctCats = new Set(saleCats);
    products.forEach(p => { if(p.predajna_kategoria) distinctCats.add(p.predajna_kategoria); });
    const categoriesList = Array.from(distinctCats).sort((a,b) => String(a).localeCompare(String(b), 'sk'));

    const html = `
      <div class="stat-card" style="margin-bottom:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <h3 style="margin:0;">Centrálny katalóg produktov</h3>
            <div style="display:flex; gap:5px;">
                <button id="cat-export-csv" class="btn-secondary btn-sm"><i class="fas fa-file-export"></i> Export</button>
                <button id="cat-import-csv" class="btn-primary btn-sm"><i class="fas fa-file-import"></i> Import</button>
                <button id="cat-download-template" class="btn-info btn-sm"><i class="fas fa-download"></i> Šablóna</button>
                <input id="cat-import-file" type="file" accept=".csv,text/csv" style="display:none" />
            </div>
        </div>

        <div class="form-group" style="margin-top:10px;">
            <input type="text" id="cat-search" placeholder="Hľadať produkt (názov, EAN)..." style="width:100%; padding:10px; font-size:1.1em;">
        </div>

        <div id="cat-tabs" class="inventory-tabs" style="display:flex; gap:5px; margin-top:10px; flex-wrap:wrap;">
            <button class="btn-tab btn-primary" data-cat="ALL">Všetky</button>
            ${categoriesList.map(c => `<button class="btn-tab btn-secondary" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
            <button class="btn-tab btn-secondary" data-cat="NO_CAT">Nezaradené</button>
        </div>
      </div>

      <div id="cat-table-container" class="table-container" style="max-height:65vh;"></div>

      <div style="margin-top:20px; text-align:right;">
         <button class="btn-success" onclick="document.getElementById('catalog-add-form-wrap').style.display='block'; this.style.display='none';">
            <i class="fas fa-plus"></i> Pridať nový produkt
         </button>
      </div>

      <div id="catalog-add-form-wrap" class="stat-card" style="margin-top: 2rem; display:none; border:2px solid #16a34a;">
        <h4>Pridať novú položku</h4>
        <form id="catalog-add-form">
            <div class="form-grid">
              <div class="form-group">
                <label>Typ položky</label>
                <select id="cat-new-type" required>${itemTypes.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
              </div>
              <div class="form-group">
                <label>Sadzba DPH</label>
                <select id="cat-new-dph" required>${dphRates.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
              </div>
            </div>
            <div class="form-group"><label>Názov položky</label><input type="text" id="cat-new-name" required></div>
            <div class="form-group"><label>EAN kód</label><input type="text" id="cat-new-ean" required></div>
            <div class="form-group"><label>Predajná kategória</label><select id="cat-new-sale-cat"><option value="">-- Vyberte --</option>${saleCats.map(c=>`<option value="${c}">${c}</option>`).join('')}</select></div>
            
            <div class="form-group" style="background:#f0fdf4; padding:10px; border-radius:5px; margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer;">
                    <input type="checkbox" id="cat-new-made" style="width:20px; height:20px;">
                    JA VYRÁBAM (Výrobok)
                </label>
                <small class="text-muted">Zaškrtnutím sa typ automaticky nastaví na 'VÝROBOK'.</small>
            </div>
            <button type="submit" class="btn-success" style="width:100%;">Uložiť do katalógu</button>
        </form>
      </div>
    `;

    const onReady = () => {
        let currentCat = 'ALL';
        let currentFilteredProducts = []; 

        const tableContainer = document.getElementById('cat-table-container');
        const searchInput = document.getElementById('cat-search');
        const tabsContainer = document.getElementById('cat-tabs');

        // ADD FORM logic
        const newTypeSel = document.getElementById('cat-new-type');
        const newMadeChk = document.getElementById('cat-new-made');
        if(newMadeChk && newTypeSel) {
            newMadeChk.onchange = () => { newTypeSel.value = newMadeChk.checked ? 'VÝROBOK' : 'TOVAR'; };
            newTypeSel.onchange = () => {
                const val = newTypeSel.value.toUpperCase();
                newMadeChk.checked = (val.startsWith('VÝROBOK') || val === 'PRODUKT');
            };
        }

        function renderTable() {
            const q = searchInput.value.trim().toLowerCase();
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

            if (currentFilteredProducts.length === 0) {
                tableContainer.innerHTML = '<p class="text-muted" style="padding:20px; text-align:center;">Žiadne produkty.</p>';
                return;
            }

            let html = `<table class="tbl"><thead><tr>
                    <th style="width:120px;">EAN</th><th>Názov</th><th>Typ</th><th>Kategória</th><th style="text-align:right;">DPH</th><th style="width:140px;">Akcie</th>
                  </tr></thead><tbody>`;

            currentFilteredProducts.forEach(p => {
                html += `<tr data-ean="${escapeHtml(p.ean)}">
                        <td style="font-family:monospace;">${escapeHtml(p.ean)}</td>
                        <td><strong>${escapeHtml(p.nazov_vyrobku)}</strong></td>
                        <td>${escapeHtml(p.typ_polozky)}</td>
                        <td>${escapeHtml(p.predajna_kategoria || '-')}</td>
                        <td style="text-align:right;">${Number(p.dph).toFixed(0)}%</td>
                        <td>
                            <button class="btn-secondary btn-sm btn-edit">Upraviť</button>
                            <button class="btn-danger btn-sm btn-del">Zmazať</button>
                        </td></tr>`;
            });
            html += `</tbody></table>`;
            tableContainer.innerHTML = html;

            // EDIT BUTTONS
            tableContainer.querySelectorAll('.btn-edit').forEach(b => {
                b.onclick = (e) => {
                    const ean = e.target.closest('tr').dataset.ean;
                    const idx = currentFilteredProducts.findIndex(x => String(x.ean) === ean);
                    if (idx !== -1) {
                        openEditModal(currentFilteredProducts[idx], currentFilteredProducts, idx);
                    }
                };
            });

            // DELETE BUTTONS - VOLÁ OPRAVENÝ CONFIRMDELETE
            tableContainer.querySelectorAll('.btn-del').forEach(b => {
                b.onclick = (e) => {
                    const ean = e.target.closest('tr').dataset.ean;
                    const p = products.find(x => String(x.ean) === ean);
                    if (p) confirmDelete(p);
                };
            });
        }

        // TABS
        tabsContainer.querySelectorAll('.btn-tab').forEach(btn => {
            btn.onclick = () => {
                tabsContainer.querySelectorAll('.btn-tab').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
                btn.classList.remove('btn-secondary'); btn.classList.add('btn-primary');
                currentCat = btn.dataset.cat;
                renderTable();
            };
        });

        searchInput.oninput = () => renderTable();
        renderTable();

        // ADD SUBMIT
        document.getElementById('catalog-add-form').onsubmit = async (e) => {
            e.preventDefault();
            const body = {
                new_catalog_ean: document.getElementById('cat-new-ean').value,
                new_catalog_name: document.getElementById('cat-new-name').value,
                new_catalog_item_type: document.getElementById('cat-new-type').value,
                new_catalog_dph: document.getElementById('cat-new-dph').value,
                new_catalog_sale_category: document.getElementById('cat-new-sale-cat').value
            };
            try {
                const res = await apiRequest('/api/kancelaria/addCatalogItem', { method: 'POST', body });
                if(res.error) throw new Error(res.error);
                showStatus('Položka pridaná.', false);
                window.erpMount(viewCatalogManagement);
            } catch (err) { alert(err.message); }
        };

        // --- IMPORT CSV ---
        // (rovnaký kód ako predtým)
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

        // --- OPRAVENÝ CONFIRM DELETE (FORCE) ---
        async function confirmDelete(p) {
             if (!confirm(`Naozaj zmazať ${p.nazov_vyrobku}?`)) return;

             // 1. Skúsime zmazať normálne
             let res = await apiRequest('/api/kancelaria/deleteCatalogItem', { 
                 method: 'POST', 
                 body: { ean: p.ean } 
             });

             // 2. Ak príde chyba (napr. že sa používa v receptee)
             if (res.error) {
                 // Ak backend poslal detaily (used_in), ponúkneme FORCE DELETE
                 if (res.raw && res.raw.used_in) {
                     let msg = "POZOR: Produkt sa používa a nedá sa bežne zmazať!\n\n";
                     const u = res.raw.used_in;
                     if (u.recept) msg += "- Je v receptoch\n";
                     if (u.krajane) msg += "- Je zdrojom pre krájanie\n";
                     if (u.fk_tables) msg += "- Je v iných záznamoch (objednávky/sklad)\n";
                     
                     msg += "\nChcete VYNÚTIŤ ZMAZANIE? (Zmaže sa z receptov aj histórie!)";

                     if (confirm(msg)) {
                         // 3. Druhý pokus s force: true
                         res = await apiRequest('/api/kancelaria/deleteCatalogItem', { 
                             method: 'POST', 
                             body: { ean: p.ean, force: true } 
                         });
                         
                         if (res.error) {
                             alert("Ani vynútené zmazanie nešlo: " + res.error);
                             return;
                         }
                     } else {
                         return; // Zrušil to
                     }
                 } else {
                     // Iná chyba
                     alert("Chyba: " + res.error);
                     return;
                 }
             }

             // 3. Hotovo - aktualizujeme tabuľku
             showStatus('Položka zmazaná.', false);
             
             // Vyhodíme z poľa pre rýchlosť
             const idx = products.findIndex(x => x.ean === p.ean);
             if (idx > -1) products.splice(idx, 1);
             
             renderTable();
             hideModalCompat(); // Ak sme boli v modale, zavrieme ho
        }

        // --- MODAL EDIT ---
        function openEditModal(p, productList, currentIndex) {
            const isMade = String(p.typ_polozky||'').toUpperCase().startsWith('VÝROBOK');
            
            let rcpCatOpts = recipeCats.map(c => `<option value="${c}" ${p.kategoria_pre_recepty === c ? 'selected' : ''}>${c}</option>`).join('');
            if (p.kategoria_pre_recepty && !recipeCats.includes(p.kategoria_pre_recepty)) {
                rcpCatOpts += `<option value="${p.kategoria_pre_recepty}" selected>${p.kategoria_pre_recepty}</option>`;
            }

            const hasNext = currentIndex < productList.length - 1;

            const html = `
              <form id="cat-edit-form" style="max-width:600px">
                <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="form-group"><label>EAN</label><input id="edit-ean" type="text" required value="${escapeHtml(p.ean||'')}"></div>
                    <div class="form-group"><label>Typ položky</label>
                        <select id="edit-type" required>${itemTypes.map(t => `<option value="${t}" ${p.typ_polozky === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
                    </div>
                </div>
                
                <div class="form-group"><label>Názov položky</label><input id="edit-name" type="text" required value="${escapeHtml(p.nazov_vyrobku||'')}"></div>

                <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
                    <div class="form-group"><label>MJ</label>
                        <select id="edit-mj">
                            <option value="kg" ${p.mj === 'kg' ? 'selected' : ''}>kg</option>
                            <option value="ks" ${p.mj === 'ks' ? 'selected' : ''}>ks</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Váha balenia (g)</label>
                        <input id="edit-weight" type="number" step="1" value="${p.vaha_balenia_g || ''}" placeholder="napr. 1000">
                    </div>
                    <div class="form-group"><label>DPH %</label>
                        <select id="edit-dph" required>${dphRates.map(r => `<option value="${r}" ${Number(p.dph) === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
                    </div>
                </div>

                <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div class="form-group"><label>Predajná kategória</label>
                        <select id="edit-sale">${saleCats.map(c => `<option value="${c}" ${p.predajna_kategoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
                    </div>
                    <div class="form-group"><label>Kategória pre recepty</label>
                        <select id="edit-rcp-cat">
                            <option value="">-- Žiadna --</option>
                            ${rcpCatOpts}
                        </select>
                    </div>
                </div>

                <div class="form-group" style="background:#f0fdf4; padding:10px; border-radius:5px; margin-top:10px;">
                    <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer;">
                        <input type="checkbox" id="edit-is-made" style="width:20px; height:20px;" ${isMade ? 'checked' : ''}>
                        JA VYRÁBAM (Výrobok)
                    </label>
                </div>

                <div style="display:flex; justify-content: space-between; align-items: center; margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #eee;">
                  <div>
                    <button type="button" id="btn-delete-item" class="btn-danger" style="background-color: #ef4444; color: white;">
                        <i class="fas fa-trash"></i> Vymazať
                    </button>
                  </div>

                  <div style="display:flex; gap: 10px; align-items: center;">
                      <button type="button" class="btn-secondary" onclick="hideModalCompat()">Zrušiť</button>
                      ${hasNext ? `<button type="button" id="btn-save-next" class="btn-info" style="background-color: #0ea5e9; color: white;">💾 Uložiť a ďalší ➡</button>` : ''}
                      <button type="submit" class="btn-primary"><i class="fas fa-save"></i> Uložiť</button>
                  </div>
                </div>
              </form>
            `;

            async function saveData(shouldGoNext) {
                const editTypeSel = document.getElementById('edit-type');
                const payload = {
                    original_ean: String(p.ean||''),
                    ean: document.getElementById('edit-ean').value.trim(),
                    nazov_vyrobku: document.getElementById('edit-name').value.trim(),
                    typ_polozky: editTypeSel.value,
                    mj: document.getElementById('edit-mj').value,
                    vaha_balenia_g: document.getElementById('edit-weight').value,
                    dph: document.getElementById('edit-dph').value,
                    predajna_kategoria: document.getElementById('edit-sale').value,
                    kategoria_pre_recepty: document.getElementById('edit-rcp-cat').value
                };

                try {
                    const res = await apiRequest('/api/kancelaria/updateCatalogItem', { method: 'POST', body: payload });
                    if(res.error) throw new Error(res.error);
                    
                    Object.assign(p, payload);

                    if (shouldGoNext && hasNext) {
                        showStatus('Uložené. Prechádzam na ďalší...', false);
                        openEditModal(productList[currentIndex + 1], productList, currentIndex + 1);
                    } else {
                        showStatus('Zmeny uložené.', false);
                        hideModalCompat();
                        renderTable(); 
                    }
                } catch (err) {
                    alert("Chyba pri ukladaní: " + err.message);
                }
            }

            openModalCompat(`Upraviť: ${escapeHtml(p.nazov_vyrobku)}`, {
              html,
              onReady() {
                 const editTypeSel = document.getElementById('edit-type');
                 const editMadeChk = document.getElementById('edit-is-made');
                 
                 editMadeChk.onchange = () => { editTypeSel.value = editMadeChk.checked ? 'VÝROBOK' : 'TOVAR'; };
                 editTypeSel.onchange = () => {
                     const val = editTypeSel.value.toUpperCase();
                     editMadeChk.checked = (val.startsWith('VÝROBOK') || val === 'PRODUKT');
                 };

                 document.getElementById('cat-edit-form').onsubmit = (e) => {
                    e.preventDefault();
                    saveData(false);
                 };

                 const btnNext = document.getElementById('btn-save-next');
                 if (btnNext) btnNext.onclick = () => saveData(true);

                 // Tlačidlo Vymazať volá našu opravenú funkciu
                 const btnDelete = document.getElementById('btn-delete-item');
                 if (btnDelete) {
                     btnDelete.onclick = () => {
                         confirmDelete(p);
                     };
                 }
              }
            });
        }
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

    const productOpts = (base.productsWithoutRecipe || []).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
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
            <div class="form-group"><label>CCP body (kritické kontrolné body)</label><textarea id="pm-ccp" rows="4" placeholder="CCP1: ...&#10;CCP2: ..."></textarea></div>
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

  // ===================== EDITOR RECEPTU (FULLSCREEN + HACCP) ===================
  async function renderRecipeEditorInline(productName){
    await ensureOfficeDataIsLoaded();
    await ensureWarehouseCache(true);
    const base = getOfficeData();
    const details = await apiRequest('/api/kancelaria/getRecipeDetails', { method: 'POST', body: { productName } });

    const catOpts = (base.recipeCategories || [])
      .map(c => `<option value="${escapeHtml(c)}"${details && details.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)
      .join('');

    const html = `
      <div class="stat-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin-top:0;">Upraviť recept – ${escapeHtml(productName)}</h3>
          <div style="display:flex; gap:.5rem;">
            <button id="rcp-save" class="btn-primary"><i class="fas fa-save"></i> Uložiť zmeny</button>
            <button id="rcp-delete" class="btn-danger"><i class="fas fa-trash"></i> Vymazať recept</button>
          </div>
        </div>
        <div class="form-group">
          <label>Kategória receptu</label>
          <select id="rcp-cat"><option value="">-- Vyberte --</option>${catOpts}</select>
          <small>alebo nová:</small>
          <input id="rcp-newcat" type="text" placeholder="Nová kategória (nepovinné)">
        </div>
        <h4>Suroviny</h4>
        <div id="rcp-ingredients"></div>
        <div style="margin: .5rem 0 1rem;">
          <button type="button" id="rcp-add-row" class="btn-secondary"><i class="fas fa-plus"></i> Pridať surovinu</button>
        </div>
        <div id="rcp-cost" class="muted" style="margin:.5rem 0 1rem;">Odhad ceny dávky: —</div>
      </div>
      `;

    const onReady = ()=>{
      const host = $('#rcp-ingredients');
      const categories = base.itemTypes || ['Mäso','Koreniny','Obaly - Črevá','Pomocný materiál'];
      const parseNum = v => parseFloat(String(v).replace(',','.'));

      async function buildNameOptions(cat, selectEl, priceEl){
          try{
            const c = String(cat || '').toLowerCase().trim();
            let key = c;
            if (c.includes('mäso') || c.includes('maso')) key = 'maso';
            else if (c.includes('koren')) key = 'koreniny';
            else if (c.includes('obal')) key = 'obal';
            else if (c.includes('pomoc')) key = 'pomocny_material';

            const data = await apiRequest('/api/kancelaria/stock/allowed-names?category=' + encodeURIComponent(key));
            const items = (data && data.items) || [];
            selectEl.innerHTML = '<option value="">-- Vyberte --</option>' +
              items.map(i => `<option data-price="${i.last_price||''}" value="${escapeHtml(String(i.name))}">${escapeHtml(String(i.name))}</option>`).join('');
            
            selectEl.onchange = function(){
                const opt = selectEl.selectedOptions[0];
                const p = opt?.dataset.price;
                priceEl.textContent = p ? (parseFloat(p).toFixed(2) + ' €/kg') : '—';
                recomputeCost();
            };
          }catch(e){ console.error(e); }
      }

      function addRow(prefill){
          const row = document.createElement('div');
          row.className = 'recipe-ingredient-row';
          row.innerHTML = `
            <div class="form-grid">
              <div class="form-group"><label>Kategória</label><select class="rcp-cat-sel"><option value="">-- Vyberte --</option>${categories.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</select></div>
              <div class="form-group"><label>Surovina</label><select class="rcp-name-sel"></select><small class="muted">Cena: <span class="rcp-price">—</span></small></div>
              <div class="form-group"><label>Množstvo (kg)</label><input class="rcp-qty" type="number" step="0.001" min="0"></div>
              <div class="form-group" style="align-self:end;"><button type="button" class="btn-danger rcp-del">X</button></div>
            </div>`;
          host.appendChild(row);
          
          const selCat = row.querySelector('.rcp-cat-sel');
          const selName = row.querySelector('.rcp-name-sel');
          const priceEl = row.querySelector('.rcp-price');
          const qtyEl = row.querySelector('.rcp-qty');
          
          selCat.onchange = () => buildNameOptions(selCat.value, selName, priceEl);
          qtyEl.oninput = recomputeCost;
          row.querySelector('.rcp-del').onclick = () => { row.remove(); recomputeCost(); };

          if(prefill) {
              qtyEl.value = prefill.quantity;
              const opt = document.createElement('option');
              opt.value = prefill.name;
              opt.text = prefill.name;
              opt.dataset.price = prefill.last_price;
              selName.add(opt);
              selName.value = prefill.name;
              priceEl.textContent = prefill.last_price ? prefill.last_price + ' €/kg' : '—';
          }
      }
      
      function recomputeCost() { }

      if (details && details.ingredients && details.ingredients.length){
        details.ingredients.forEach(ing => addRow(ing));
      } else {
        addRow(null);
      }

      onClick('#rcp-add-row', function(){ addRow(null); });

      onClick('#rcp-save', async function(){
        const rows = Array.from(document.querySelectorAll('#rcp-ingredients .recipe-ingredient-row'));
        const ingredients = rows.map(r => ({
            name: r.querySelector('.rcp-name-sel').value,
            quantity: parseNum(r.querySelector('.rcp-qty').value)
        })).filter(i => i.name && i.quantity > 0);

        const resp = await apiRequest('/api/kancelaria/updateRecipe', {
            method: 'POST',
            body: { 
                productName, 
                ingredients, 
                category: document.getElementById('rcp-cat').value,
                newCategory: document.getElementById('rcp-newcat').value
            }
        });
        if(!resp.error) showStatus('Recept uložený.', false);
      });

      onClick('#rcp-delete', async function(){
        if(confirm('Naozaj zmazať?')) {
            await apiRequest('/api/kancelaria/deleteRecipe', { method:'POST', body:{ productName } });
            window.erpMount(viewEditRecipeListInline);
        }
      });
    };
    return { html, onReady };
  }

  // ===================== KRÁJANÉ PRODUKTY ==========================
  async function viewSlicingManagement(){
    const data = await apiRequest('/api/kancelaria/getSlicingManagementData');
    const sourceOptions = (data?.sourceProducts||[]).map(p=>`<option value="${escapeHtml(p.ean)}">${escapeHtml(p.name)}</option>`).join('');
    const rows = (data?.slicedProducts||[]).map(p=>{
      const linked = !!(p.zdrojovy_ean && String(p.zdrojovy_ean).trim() !== '' && String(p.zdrojovy_ean).toLowerCase() !== 'nan');
      const weightVal = (p.vaha_balenia_g!=null && p.vaha_balenia_g!=='') ? Number(p.vaha_balenia_g).toFixed(0) : '';
      const status = linked ? `prepojené: <code>${escapeHtml(p.zdrojovy_ean)}</code>` : '<b>neprepojené</b>';
      const btnLbl = linked ? 'Zmeniť zdroj' : 'Prepojiť';
      return `<tr data-target-ean="${escapeHtml(p.ean)}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.ean)}</td>
        <td style="text-align:right">
          <input class="slc-weight" type="number" min="1" step="1" placeholder="g" value="${weightVal}" style="width:100px;text-align:right;">
        </td>
        <td>${status}</td>
        <td><button class="btn-primary link-sliced" style="margin:0;width:auto;">${btnLbl}</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="5">Žiadne krájané produkty.</td></tr>';

    const html = `
      <div class="stat-card">
        <label for="slc-source"><b>1.</b> Vyberte zdrojový produkt (celok)</label>
        <select id="slc-source"><option value="">-- Vyberte --</option>${sourceOptions}</select>
      </div>
      <div class="table-container" id="slc-target" style="margin-top:16px;">
        <h4><b>2.</b> Priraďte krájaný produkt (balíček)</h4>
        <table class="tbl">
          <thead><tr><th>Názov</th><th>EAN</th><th style="text-align:right">Váha (g)</th><th>Stav</th><th>Akcia</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    const onReady = ()=>{
      const srcSel = $('#slc-source');
      $('#slc-target')?.addEventListener('click', async e=>{
        const btn = e.target.closest?.('.link-sliced'); if (!btn) return;
        const tr = btn.closest('tr');
        const sourceEan = srcSel?.value||''; if (!sourceEan){ showStatus('Najprv vyberte zdrojový produkt (celok).', true); return; }
        const targetEan = tr?.dataset?.targetEan; if (!targetEan) return;
        const w = tr?.querySelector('.slc-weight')?.value;
        const wNum = Number(w);
        if (!w || isNaN(wNum) || wNum <= 0){ showStatus('Zadajte váhu balíčka v gramoch (> 0).', true); return; }
        try{
          const resp = await apiRequest('/api/kancelaria/linkSlicedProduct', { method:'POST', body:{ sourceEan, targetEan, weight: wNum } });
          tr.querySelector('.slc-weight').value = String(resp?.savedWeight ?? wNum);
          tr.children[3].innerHTML = `prepojené: <code>${escapeHtml(sourceEan)}</code>`;
          showStatus('Prepojené.', false);
          window.erpMount(viewSlicingManagement);
        }catch(err){ showStatus('Prepojenie zlyhalo: ' + (err?.message || String(err)), true); }
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
      <div class="form-group"><input id="re-fq" placeholder="Filtrovať podľa názvu…" /></div>
      <div class="re-list">`;

    const catNames = Object.keys(categories).sort((a,b)=> String(a||'').localeCompare(String(b||''),'sk'));
    if (!catNames.length){ html += '<p>Žiadne recepty na úpravu.</p>'; } else {
      for (const cat of catNames){
        const items = categories[cat] || [];
        if (!items.length) continue;
        html += `<h4>${escapeHtml(cat || 'Nezaradené')}</h4><div class="re-cat-block">`;
        html += items.map(name => 
          `<button type="button" class="btn-secondary rcp-open" data-name="${escapeHtml(name)}" style="margin:.25rem .25rem 0 0;">${escapeHtml(name)}</button>`
        ).join('');
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
            const nm = (btn.textContent || '').toLowerCase();
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

  // ------------------ Export init do globálu -----------------------
  window.initializeErpAdminModule = initializeErpAdminModule;

})(window, document);