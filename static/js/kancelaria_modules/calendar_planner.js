// ======================================================================
// ENTERPRISE PLÁNOVACÍ KALENDÁR – FRONTEND MODUL (OPRAVENÝ)
// ======================================================================

;(function () {
  'use strict';

  // --- ALIAS NA API REQUEST ---
  const apiRequest = (typeof window !== 'undefined' && typeof window.apiRequest === 'function')
    ? window.apiRequest.bind(window)
    : async function (url, options = {}) {
        const opts = {
          method: options.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
        };
        if (options.body) opts.body = JSON.stringify(options.body);
        const res = await fetch(url, opts);
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? await res.json() : await res.text();
        if (!res.ok) throw new Error((isJson ? data?.error : String(data)) || 'HTTP ' + res.status);
        return data;
      };

  const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeToFixedLocal = (v) => (v == null || isNaN(v)) ? '0' : Number(v).toFixed(3);
  const formatDateKey = (y, m, d) => {
      return y + '-' + String(m + 1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
  };

  function ensurePlannerStyles() {
    if (document.getElementById('planner-styles-v3')) return;
    const css = `
      /* Layout a karty */
      .planner-toolbar { display:flex; gap:.5rem; align-items:center; margin-bottom:1rem; flex-wrap:wrap; }
      .planner-toolbar .spacer { flex:1; }
      .planner-layout { display:grid; grid-template-columns: 2fr 1.2fr; gap:1.5rem; align-items:flex-start; }
      @media (max-width: 1100px) { .planner-layout { grid-template-columns: 1fr; } }
      .planner-card { border:1px solid #e5e7eb; border-radius:10px; padding:16px; background:#fff; box-shadow:0 2px 4px rgba(0,0,0,0.03); }
      
      /* Kalendár Grid */
      .planner-cal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; }
      .planner-cal-month-label { font-weight:700; font-size:1.1rem; color: #1f2937; }
      .planner-cal-nav-btn { border:1px solid #d1d5db; background:#fff; border-radius:6px; width: 32px; height: 32px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s; }
      .planner-cal-nav-btn:hover { background:#f3f4f6; border-color:#9ca3af; }
      .planner-cal-weekdays, .planner-cal-grid { display:grid; grid-template-columns:repeat(7, 1fr); gap:6px; }
      .planner-cal-weekday { text-align:center; font-size:.75rem; font-weight:600; color:#6b7280; text-transform: uppercase; padding-bottom: 4px; }
      .planner-cal-cell { min-height:85px; background:#f9fafb; border: 1px solid #f3f4f6; border-radius:8px; padding:6px; font-size:.75rem; position:relative; cursor:pointer; transition: all 0.15s; display:flex; flex-direction:column; gap:2px; }
      .planner-cal-cell:hover:not(.empty) { background:#fff; border-color: #3b82f6; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); transform: translateY(-1px); z-index: 2; }
      .planner-cal-cell.selected { background:#eff6ff; border: 2px solid #2563eb; }
      .planner-cal-cell.empty { background:transparent; border:none; cursor:default; }
      .planner-cal-date { font-weight:700; font-size:.85rem; color:#374151; margin-bottom: 2px; }
      .planner-cal-summary { background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: 500; font-size: 0.7rem; display: inline-block; }
      .planner-cal-prio { position:absolute; top:4px; right:6px; color:#ef4444; font-size: 1rem; line-height: 1; }

      /* Pravý panel */
      .planner-side h4 { margin:0 0 .5rem 0; font-size:1.1rem; color: #111827; }
      .planner-side small { display: block; color:#6b7280; margin-bottom: 1rem; line-height: 1.4; }
      .planner-form-group { margin-bottom: 1rem; }
      .planner-form-group label { display: block; font-size: 0.85rem; font-weight: 500; color: #374151; margin-bottom: 0.25rem; }
      
      /* Custom Product Picker Input */
      .product-picker-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; transition: border-color 0.2s; }
      .product-picker-trigger:hover { border-color: #9ca3af; }
      .product-picker-text { font-weight: 500; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .product-picker-placeholder { color: #9ca3af; font-weight: 400; }
      
      /* Zoznam pre deň */
      .planner-day-list { list-style:none; padding:0; margin:0; max-height:350px; overflow-y:auto; border-top: 1px solid #e5e7eb; }
      .planner-day-list li { display:flex; justify-content:space-between; align-items:center; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
      .planner-day-list li:last-child { border-bottom: none; }
      .planner-item-info strong { display: block; color: #1f2937; font-size: 0.9rem; margin-bottom: 2px; }
      .planner-item-meta { font-size: 0.8rem; color: #6b7280; display: flex; gap: 8px; align-items: center; }
      .planner-item-badge { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
      .btn-icon-danger { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; color: #ef4444; background: #fee2e2; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; }
      .btn-icon-danger:hover { background: #fecaca; color: #b91c1c; }

      /* --- PRODUCT PICKER MODAL STYLES --- */
      .erp-picker-container { display: flex; flex-direction: column; height: 60vh; max-height: 500px; }
      .erp-picker-search { padding: 10px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; position: sticky; top: 0; }
      .erp-picker-search input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.95rem; }
      .erp-picker-list { flex: 1; overflow-y: auto; padding: 0; margin: 0; list-style: none; }
      .erp-picker-category { background: #f3f4f6; padding: 6px 12px; font-size: 0.75rem; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; position: sticky; top: 0; }
      .erp-picker-item { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.1s; }
      .erp-picker-item:hover { background: #eff6ff; }
      .erp-picker-item.selected { background: #dbeafe; border-left: 3px solid #2563eb; }
      .erp-picker-item-main { font-weight: 600; color: #1f2937; font-size: 0.9rem; }
      .erp-picker-item-sub { font-size: 0.8rem; color: #6b7280; margin-top: 1px; }
      .erp-picker-item-stats { text-align: right; font-size: 0.8rem; }
      .stat-pill { display: inline-block; padding: 1px 5px; border-radius: 4px; font-weight: 500; margin-left: 4px; }
      .stat-pill.stock { background: #e5e7eb; color: #374151; }
      .stat-pill.sugg { background: #dcfce7; color: #166534; }
    `;
    const s = document.createElement('style');
    s.id = 'planner-styles-v3';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Globálny stav pre plánovač
  let PLANNER_CAL_STATE = null;
  let PRODUCTS_CACHE = []; 

  // =================================================================
  // 2. INLINE PLÁNOVAČ VÝROBY (KANCELÁRIA)
  // =================================================================
  async function renderProductionPlanInline() {
    ensurePlannerStyles();
    const root = document.getElementById('planner-inline-root');
    if (!root) return;

    // --- HTML štruktúra ---
    root.innerHTML = `
      <div class="planner-toolbar">
        <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
           <i class="fas fa-calendar-alt" style="color:#2563eb;"></i> Kalendár výroby
        </h3>
        <div class="spacer"></div>
        <button id="planner-refresh" class="btn-secondary" title="Obnoviť dáta z objednávok a skladu">
          <i class="fas fa-sync-alt"></i> Obnoviť návrhy
        </button>
      </div>

      <div class="planner-layout">
        <div class="planner-card">
          <div id="planner-calendar"></div>
        </div>

        <div class="planner-card planner-side">
          <div>
            <h4 id="planner-selected-date-label">Vyberte deň...</h4>
            <small>Kliknite na deň v kalendári pre zobrazenie alebo pridanie plánu.</small>
          </div>

          <div style="background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:12px; margin-bottom:1rem;">
            
            <div class="planner-form-group">
              <label>Výrobok na výrobu:</label>
              <div id="planner-product-trigger" class="product-picker-trigger">
                <span class="product-picker-placeholder">Kliknite pre výber výrobku...</span>
                <i class="fas fa-chevron-down" style="color:#9ca3af; font-size:0.8rem;"></i>
              </div>
              <input type="hidden" id="planner-product-name">
            </div>

            <div style="display:flex; gap:10px; align-items:flex-end;">
              <div class="planner-form-group" style="flex:1; margin-bottom:0;">
                <label>Množstvo (kg):</label>
                <input id="planner-qty-input" type="number" min="0" step="1" class="form-control" style="width:100%; text-align:right; font-weight:600;">
              </div>
              
              <div style="margin-bottom:6px;">
                 <label class="btn-secondary btn-sm" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                    <input type="checkbox" id="planner-priority-input">
                    <span style="font-weight:600; color:#ea580c;">★ Priorita</span>
                 </label>
              </div>
            </div>
            
            <button id="planner-add-to-day" class="btn-primary w-full" style="margin-top:12px;">
              <i class="fas fa-plus"></i> Pridať do plánu
            </button>
          </div>

          <div style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
            <h5 style="margin:0 0 5px 0; font-size:0.9rem; color:#6b7280; text-transform:uppercase;">Naplánované položky</h5>
            <ul id="planner-day-list" class="planner-day-list"></ul>
          </div>
        </div>
      </div>

      <div class="planner-footer-actions">
        <button id="planner-create-tasks" class="btn-success" style="padding:10px 20px; font-size:1rem;">
          <i class="fas fa-save"></i> Uložiť zmeny a vytvoriť úlohy
        </button>
        <div id="planner-summary" class="planner-summary-bar" style="margin-left:auto;"></div>
      </div>
    `;

    // --- Referencie na elementy ---
    const elCalendar = root.querySelector('#planner-calendar');
    const elProdTrigger = root.querySelector('#planner-product-trigger');
    const elProdName = root.querySelector('#planner-product-name'); 
    const elQty = root.querySelector('#planner-qty-input');
    const elPrio = root.querySelector('#planner-priority-input');
    const elAdd = root.querySelector('#planner-add-to-day');
    const elDayList = root.querySelector('#planner-day-list');
    const elSelDate = root.querySelector('#planner-selected-date-label');
    const elCreate = root.querySelector('#planner-create-tasks');
    const elRefresh = root.querySelector('#planner-refresh');
    const elSummary = root.querySelector('#planner-summary');

    const monthNames = ['Január','Február','Marec','Apríl','Máj','Jún','Júl','August','September','Október','November','December'];
    const weekdays   = ['Po','Ut','St','Št','Pi','So','Ne'];

    // --------- Inicializácia stavu ----------
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const STATE = {
      currentMonth: new Date(today.getFullYear(), today.getMonth(), 1),
      selectedDate: formatDateKey(today.getFullYear(), today.getMonth(), today.getDate()),
      calendar: {} 
    };
    PLANNER_CAL_STATE = STATE;
    let calendarLoadedFromDb = false;

    // -------------------------------------------------------------
    // DEFINÍCIE FUNKCIÍ (Musia byť definované PRED použitím)
    // -------------------------------------------------------------

    function rebuildSummary() {
        let totalDays = Object.keys(STATE.calendar).length;
        let totalKg = 0;
        Object.values(STATE.calendar).forEach(items => {
             items.forEach(i => totalKg += i.qty);
        });
        if(elSummary) {
            elSummary.innerHTML = `
               <span style="background:#f1f5f9; padding:4px 8px; border-radius:4px; margin-right:10px;"><b>${totalDays}</b> dní s plánom</span>
               <span style="background:#dcfce7; padding:4px 8px; border-radius:4px; color:#166534;">Spolu: <b>${safeToFixedLocal(totalKg)} kg</b></span>
            `;
        }
    }

    function renderCalendar() {
        const year = STATE.currentMonth.getFullYear();
        const month = STATE.currentMonth.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; 

        let html = `
            <div class="planner-cal-header">
                <div class="planner-cal-nav-btn" id="cal-prev">‹</div>
                <div class="planner-cal-month-label">${monthNames[month]} ${year}</div>
                <div class="planner-cal-nav-btn" id="cal-next">›</div>
            </div>
            <div class="planner-cal-weekdays">
                ${weekdays.map(d => `<div class="planner-cal-weekday">${d}</div>`).join('')}
            </div>
            <div class="planner-cal-grid">
        `;

        for(let i=0; i<startDayIndex; i++) html += `<div class="planner-cal-cell empty"></div>`;

        for(let d=1; d<=daysInMonth; d++) {
            const dateKey = formatDateKey(year, month, d);
            const items = STATE.calendar[dateKey] || [];
            const totalKg = items.reduce((sum, i) => sum + i.qty, 0);
            const hasPrio = items.some(i => i.priority);
            const isSelected = (STATE.selectedDate === dateKey);

            html += `
                <div class="planner-cal-cell ${isSelected ? 'selected' : ''}" data-date="${dateKey}">
                    <div class="planner-cal-date">${d}</div>
                    ${items.length ? `
                        <div class="planner-cal-summary">
                            ${items.length} pol.<br>
                            ${safeToFixedLocal(totalKg)} kg
                        </div>
                    ` : ''}
                    ${hasPrio ? '<div class="planner-cal-prio">★</div>' : ''}
                </div>
            `;
        }
        html += `</div>`;
        elCalendar.innerHTML = html;

        elCalendar.querySelector('#cal-prev').onclick = () => {
            STATE.currentMonth.setMonth(STATE.currentMonth.getMonth() - 1);
            renderCalendar();
        };
        elCalendar.querySelector('#cal-next').onclick = () => {
            STATE.currentMonth.setMonth(STATE.currentMonth.getMonth() + 1);
            renderCalendar();
        };
        elCalendar.querySelectorAll('.planner-cal-cell[data-date]').forEach(cell => {
            cell.onclick = () => {
                STATE.selectedDate = cell.dataset.date;
                renderCalendar(); 
                renderSelectedDay();
            };
        });
    }

    function renderSelectedDay() {
        const dateKey = STATE.selectedDate;
        if(!dateKey) return;
        
        const parts = dateKey.split('-');
        if(parts.length < 3) return;
        elSelDate.innerHTML = `<span style="color:#2563eb;">${parts[2]}.${parts[1]}.${parts[0]}</span>`;

        const items = STATE.calendar[dateKey] || [];
        elDayList.innerHTML = '';
        
        if (items.length === 0) {
            elDayList.innerHTML = '<li style="color:#9ca3af; text-align:center; padding:20px;">Žiadny plán na tento deň.</li>';
        } else {
            items.forEach((it, idx) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <div class="planner-item-info">
                        <strong>${escapeHtml(it.productName)} ${it.priority ? '<span style="color:#ea580c;">★</span>' : ''}</strong>
                        <div class="planner-item-meta">
                            <span class="planner-item-badge">Výroba</span>
                            <span>${safeToFixedLocal(it.qty)} kg</span>
                        </div>
                    </div>
                    <button class="btn-icon-danger remove-item" title="Odstrániť">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                `;
                li.querySelector('.remove-item').onclick = () => {
                    items.splice(idx, 1);
                    if(items.length === 0) delete STATE.calendar[dateKey];
                    renderCalendar(); 
                    renderSelectedDay();
                    rebuildSummary();
                    // Auto-save pri zmazani
                    savePlan(true); 
                };
                elDayList.appendChild(li);
            });
        }
    }

    async function savePlan(silent = false) {
        let payload = [];
        Object.entries(STATE.calendar).forEach(entry => {
            const d = entry[0];
            const items = entry[1];
            items.forEach(it => {
                payload.push({
                    nazov_vyrobku: it.productName,
                    mnozstvo_kg: it.qty,
                    priorita: it.priority ? 1 : 0,
                    datum_vyroby: d
                });
            });
        });
        
        try {
            await apiRequest('/api/kancelaria/createTasksFromPlan', { method:'POST', body: payload });
            if(!silent) {
                if(window.showStatus) window.showStatus('Plán bol úspešne uložený.', false);
                else alert('Plán uložený.');
            }
        } catch(e) {
            if(window.showStatus) window.showStatus('Chyba pri ukladaní: ' + e.message, true);
            else alert('Chyba: ' + e.message);
        }
    }

    async function loadData() {
      try {
        const [planData, dbCalendar] = await Promise.all([
          apiRequest('/api/kancelaria/getProductionPlan'), 
          (!calendarLoadedFromDb ? apiRequest('/api/kancelaria/getProductionCalendar') : Promise.resolve(null)) 
        ]);

        PRODUCTS_CACHE = [];
        if (planData && typeof planData === 'object') {
          Object.keys(planData).forEach(cat => {
            (planData[cat] || []).forEach(p => {
              PRODUCTS_CACHE.push({
                name: p.nazov_vyrobku,
                category: cat,
                suggested: Number(p.navrhovana_vyroba || 0),
                stock: Number(p.aktualny_sklad || 0)
              });
            });
          });
        }
        PRODUCTS_CACHE.sort((a, b) => (b.suggested - a.suggested) || a.name.localeCompare(b.name));

        if (!calendarLoadedFromDb && dbCalendar) {
            STATE.calendar = {};
            Object.entries(dbCalendar).forEach(entry => {
                const dateKey = entry[0];
                const items = entry[1];
                STATE.calendar[dateKey] = items.map(it => ({
                    productName: it.nazov_vyrobku || it.productName,
                    qty: Number(it.mnozstvo_kg || it.qty || 0),
                    priority: !!it.priorita
                })).filter(i => i.qty > 0);
            });
            calendarLoadedFromDb = true;
        }

        rebuildSummary();
        renderCalendar();
        renderSelectedDay();

      } catch(e) {
        if(window.showStatus) window.showStatus('Chyba načítania dát: ' + e.message, true);
        else console.error(e);
      }
    }

    // -------------------------------------------------------------
    // EVENT LISTENERS
    // -------------------------------------------------------------

    elProdTrigger.onclick = () => {
        openProductPickerModal((selectedProduct) => {
            elProdName.value = selectedProduct.name;
            elProdTrigger.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:flex-start; overflow:hidden;">
                    <span class="product-picker-text">${escapeHtml(selectedProduct.name)}</span>
                    <span style="font-size:0.75rem; color:#6b7280;">Sklad: ${safeToFixedLocal(selectedProduct.stock)} kg | Návrh: ${safeToFixedLocal(selectedProduct.suggested)} kg</span>
                </div>
                <i class="fas fa-check" style="color:#10b981;"></i>
            `;
            elProdTrigger.style.borderColor = '#3b82f6';
            elProdTrigger.style.background = '#eff6ff';
            elQty.value = selectedProduct.suggested > 0 ? selectedProduct.suggested : '';
            elQty.focus();
        });
    };

    elAdd.onclick = () => {
        const name = elProdName.value;
        const qty = parseFloat(elQty.value);
        
        if (!name) { 
            if(window.showStatus) window.showStatus('Vyberte výrobok zo zoznamu.', true);
            else alert('Vyberte výrobok'); 
            return; 
        }
        if (!qty || qty <= 0) { 
            if(window.showStatus) window.showStatus('Zadajte platné množstvo (kg).', true);
            else alert('Zadajte množstvo');
            return; 
        }

        if (!STATE.calendar[STATE.selectedDate]) STATE.calendar[STATE.selectedDate] = [];
        
        const existing = STATE.calendar[STATE.selectedDate].find(i => i.productName === name);
        if (existing) {
            existing.qty += qty;
            if(elPrio.checked) existing.priority = true;
        } else {
            STATE.calendar[STATE.selectedDate].push({
                productName: name,
                qty: qty,
                priority: elPrio.checked
            });
        }
        
        // Reset formulára
        elQty.value = '';
        elPrio.checked = false;
        elProdName.value = '';
        elProdTrigger.innerHTML = '<span class="product-picker-placeholder">Kliknite pre výber výrobku...</span><i class="fas fa-chevron-down"></i>';
        elProdTrigger.style.borderColor = '#d1d5db';
        elProdTrigger.style.background = '#fff';

        renderCalendar();
        renderSelectedDay();
        rebuildSummary();
        savePlan(true); // Autosave
    };

    elCreate.onclick = () => savePlan(false);
    elRefresh.onclick = loadData;

    // Prvé načítanie
    loadData();
  }

  // =================================================================
  // 3. INTELIGENTNÝ PRODUCT PICKER MODAL
  // =================================================================
  function openProductPickerModal(onSelectCallback) {
    if (!window.showModal) return;

    const html = `
      <div class="erp-picker-container">
        <div class="erp-picker-search">
            <input type="text" id="picker-search-input" placeholder="Hľadať výrobok (názov)..." autocomplete="off">
        </div>
        <ul id="picker-list" class="erp-picker-list"></ul>
      </div>
    `;

    window.showModal('Výber výrobku na výrobu', () => {
      return {
        html: html,
        onReady: () => {
          const input = document.getElementById('picker-search-input');
          const list = document.getElementById('picker-list');
          
          const renderList = (filterText = '') => {
            const ft = filterText.toLowerCase();
            list.innerHTML = '';
            
            const filtered = PRODUCTS_CACHE.filter(p => p.name.toLowerCase().includes(ft));
            const grouped = {};
            filtered.forEach(p => {
                const c = p.category || 'Nezaradené';
                if (!grouped[c]) grouped[c] = [];
                grouped[c].push(p);
            });

            Object.keys(grouped).sort().forEach(cat => {
                const catLi = document.createElement('li');
                catLi.className = 'erp-picker-category';
                catLi.textContent = cat;
                list.appendChild(catLi);

                grouped[cat].forEach(p => {
                    const li = document.createElement('li');
                    li.className = 'erp-picker-item';
                    const hasSugg = p.suggested > 0;
                    
                    li.innerHTML = `
                        <div>
                            <div class="erp-picker-item-main">${escapeHtml(p.name)}</div>
                            <div class="erp-picker-item-sub">Skladom: ${safeToFixedLocal(p.stock)} kg</div>
                        </div>
                        <div class="erp-picker-item-stats">
                            ${hasSugg ? `<span class="stat-pill sugg">Návrh: ${safeToFixedLocal(p.suggested)} kg</span>` : ''}
                        </div>
                    `;
                    
                    li.onclick = () => {
                        onSelectCallback(p);
                        const modal = document.getElementById('modal-container');
                        if (modal) modal.style.display = 'none';
                    };
                    list.appendChild(li);
                });
            });
            
            if (filtered.length === 0) {
                list.innerHTML = '<li style="padding:20px; text-align:center; color:#9ca3af;">Žiadne výrobky sa nenašli.</li>';
            }
          };

          renderList();
          input.focus();
          input.oninput = (e) => renderList(e.target.value);
        }
      };
    });
  }

  // Export
  window.renderProductionPlanInline = renderProductionPlanInline;

})();