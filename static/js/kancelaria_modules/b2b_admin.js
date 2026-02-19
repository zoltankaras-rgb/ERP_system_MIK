// static/js/kancelaria_modules/b2b_admin.js
(function (root, doc) {
  'use strict';

  // =================================================================
  // UTILITIES
  // =================================================================
  const showStatus = (root.showStatus) ? root.showStatus : (msg, isError=false)=>{
    console.log(isError?"ERR:":"OK:", msg);
    let el = doc.getElementById('status-bar');
    if(!el) {
        el = doc.createElement('div'); el.id='status-bar';
        el.style.cssText="position:fixed;bottom:20px;right:20px;padding:10px 20px;border-radius:5px;color:white;z-index:9999;font-family:sans-serif;";
        doc.body.appendChild(el);
    }
    el.textContent = msg; 
    el.style.backgroundColor = isError?'#dc2626':'#16a34a'; 
    el.style.display='block';
    setTimeout(()=>el.style.display='none', 3000);
  };

  const escapeHtml = (s)=>String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  
  const apiRequest = async (url, opts={})=>{
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: {'Content-Type': 'application/json'},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin'
    });
    if (!res.ok) { let t=''; try{ t=await res.text(); }catch(_){ } throw new Error(`HTTP ${res.status} - ${t.slice(0,100)}`); }
    const ct = (res.headers.get('content-type')||'').toLowerCase();
    return ct.includes('application/json') ? res.json() : {};
  };

  async function apiPostForm(url, formData){
    const res = await fetch(url, { method:'POST', body: formData, credentials:'same-origin' });
    const out = await res.json().catch(()=>({}));
    if (!res.ok || out.error) throw new Error(out.error || `HTTP ${res.status}`);
    return out;
  }

  async function callFirstOk(calls) {
    let lastErr;
    for (const c of calls) {
      try { return await apiRequest(c.url, c.opts || {}); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('API Error');
  }
  
  function ensureContainer(id) {
    const el = doc.getElementById(id);
    if (!el) console.error(`Missing container #${id}`);
    return el;
  }

  // =================================================================
  // STATE
  // =================================================================
  const state = {
    customers: [],
    pricelists: [],
    mapping: {},
    routeTemplates: [],
    productsAll: [],
    pendingRegCount: 0
  };

  // Pomocná globálna premenná pre editor cenníka
  let currentPlItems = new Map();

  // =================================================================
  // INIT MODULE
  // =================================================================
  function initializeB2BAdminModule() {
    const rootEl = doc.getElementById('section-b2b-admin');
    if (!rootEl) return;

    // CSS Styles
    const style = document.createElement('style');
    style.textContent = `
      .b2b-layout { display: grid; gap: 1rem; }
      .badge-notify { display: inline-flex; align-items: center; justify-content: center; background: #dc2626; color: white; border-radius: 99px; padding: 2px 8px; font-size: 0.75rem; font-weight: bold; margin-left: 5px; }
      .table-refined { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      .table-refined th { background: #f8fafc; padding: 10px; text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; }
      .table-refined td { padding: 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
      .table-refined tr:hover { background: #f1f5f9; }
      
      /* Filter Bar */
      .filter-bar { display: flex; gap: 10px; background: #fff; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 15px; align-items: flex-end; flex-wrap: wrap; }
      .filter-group { display: flex; flex-direction: column; gap: 4px; }
      .filter-group label { font-size: 0.8rem; font-weight: 600; color: #64748b; }
      .filter-input { padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.9rem; min-width: 150px; }

      /* Messenger Layout */
      .chat-wrapper { display: grid; grid-template-columns: 300px 1fr; height: 600px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: white; }
      .chat-sidebar { border-right: 1px solid #e5e7eb; background: #f8fafc; display: flex; flex-direction: column; }
      .chat-list { overflow-y: auto; flex: 1; }
      .chat-item { padding: 15px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s; }
      .chat-item:hover { background: #f1f5f9; }
      .chat-item.active { background: #e0f2fe; border-left: 4px solid #0284c7; }
      .chat-item.unread { background: #fff7ed; }
      .chat-main { display: flex; flex-direction: column; background: #fff; }
      .chat-header { padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: 600; background: #fff; }
      .chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px; background: #f9fafb; }
      .chat-input { padding: 15px; border-top: 1px solid #e5e7eb; background: #fff; display: flex; gap: 10px; }
      
      .msg-bubble { max-width: 75%; padding: 12px 16px; border-radius: 12px; font-size: 0.95rem; line-height: 1.5; position: relative; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
      .msg-in { align-self: flex-start; background: #ffffff; border: 1px solid #e5e7eb; color: #1f2937; border-bottom-left-radius: 2px; }
      .msg-out { align-self: flex-end; background: #2563eb; color: white; border-bottom-right-radius: 2px; }
      .msg-meta { font-size: 0.7rem; margin-top: 5px; opacity: 0.7; text-align: right; }

      /* Logistics */
      .logistics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .cust-check-list { max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 6px; background: #fff; }
      .cust-row { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
      .cust-row:hover { background: #f8fafc; }
      .cust-row input { margin-right: 12px; transform: scale(1.2); cursor: pointer; }
      .cust-select-container { max-height: 200px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px; background: #fff; }
      .cust-option { display: flex; align-items: center; padding: 4px; border-bottom: 1px solid #f1f5f9; }

      /* Modal */
      .b2b-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; justify-content: center; align-items: center; }
      .b2b-modal-content { background: white; padding: 25px; border-radius: 12px; width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); }
    `;
    rootEl.innerHTML = '';
    rootEl.appendChild(style);

    const container = doc.createElement('div');
    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <h3 style="margin:0;">B2B Administrácia</h3>
        <div id="global-status"></div>
      </div>
      
      <div class="b2b-tab-nav btn-grid" style="margin-bottom:1rem; display:flex; gap:5px; flex-wrap:wrap;">
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-orders-tab">Objednávky</button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-logistics-tab">🚚 Logistika & Trasy</button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-comm-tab">Komunikácia <span id="badge-msgs" class="badge-notify" style="display:none">0</span></button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-customers-tab">Zákazníci</button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-pricelists-tab">Cenníky</button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-registrations-tab">Registrácie <span id="badge-regs" class="badge-notify" style="display:none">0</span></button>
        <button class="btn btn-secondary js-tab" data-b2b-tab="b2b-settings-tab">Nastavenia</button>
      </div>

      <div id="ofc-views" style="background: #fff; min-height: 500px;">
        <div id="b2b-orders-tab" class="b2b-tab-content" style="display:block;">
           <div id="b2b-orders-container"></div>
        </div>
        <div id="b2b-logistics-tab" class="b2b-tab-content" style="display:none;">
           <div id="b2b-logistics-container"></div>
        </div>
        <div id="b2b-comm-tab" class="b2b-tab-content" style="display:none;">
           <div id="b2b-comm-container"></div>
        </div>
        <div id="b2b-customers-tab" class="b2b-tab-content" style="display:none;">
           <div id="b2b-customers-container"></div>
        </div>
        <div id="b2b-pricelists-tab" class="b2b-tab-content" style="display:none;">
           <div id="b2b-pricelists-container"></div>
        </div>
        <div id="b2b-registrations-tab" class="b2b-tab-content" style="display:none;">
          <div id="b2b-registrations-container"></div>
        </div>
        <div id="b2b-settings-tab" class="b2b-tab-content" style="display:none;">
           <div id="b2b-settings-container"></div>
        </div>
      </div>
      
      <div id="b2b-modal-wrapper" style="display:none;"></div>
    `;
    rootEl.appendChild(container);

    const tabButtons = rootEl.querySelectorAll('.js-tab');
    const tabContents = rootEl.querySelectorAll('.b2b-tab-content');

    function setActiveTab(targetId) {
      tabButtons.forEach(b => {
        const isActive = (b.dataset.b2bTab === targetId);
        b.classList.toggle('btn-primary', isActive);
        b.classList.toggle('btn-secondary', !isActive);
      });
      tabContents.forEach(c => c.style.display = (c.id === targetId ? 'block' : 'none'));

      if (targetId === 'b2b-orders-tab') loadB2BOrdersView();
      if (targetId === 'b2b-logistics-tab') loadLogisticsView();
      if (targetId === 'b2b-comm-tab') loadCommView();
      if (targetId === 'b2b-customers-tab') loadCustomersAndPricelists();
      if (targetId === 'b2b-pricelists-tab') loadPricelistsForManagement();
      if (targetId === 'b2b-registrations-tab') loadPendingRegistrations();
      if (targetId === 'b2b-settings-tab') loadB2BSettings();
    }

    tabButtons.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.b2bTab)));
    startBackgroundPolling();
    setActiveTab('b2b-orders-tab');
  }

  // Modal Helpers
  function openModal(html) {
      const wrapper = doc.getElementById('b2b-modal-wrapper');
      wrapper.innerHTML = `<div class="b2b-modal"><div class="b2b-modal-content"><div style="text-align:right;margin-bottom:10px;"><span style="cursor:pointer;font-size:1.5rem;" onclick="document.getElementById('b2b-modal-wrapper').style.display='none'">&times;</span></div>${html}</div></div>`;
      wrapper.style.display = 'block';
  }
  function closeModal() { doc.getElementById('b2b-modal-wrapper').style.display = 'none'; }

  // Background Polling
  function startBackgroundPolling() {
    const check = async () => {
        try {
            const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPendingB2BRegistrations' }]);
            const regs = (data && data.registrations) ? data.registrations.length : 0;
            const badge = doc.getElementById('badge-regs');
            if (badge) { badge.textContent = regs; badge.style.display = regs > 0 ? 'inline-flex' : 'none'; }
            
            const r = await callFirstOk([{ url: '/api/kancelaria/b2b/messages/unread' }]);
            const msgs = Number((r && r.unread) || 0);
            const badgeMsg = doc.getElementById('badge-msgs');
            if (badgeMsg) { badgeMsg.textContent = msgs; badgeMsg.style.display = msgs > 0 ? 'inline-flex' : 'none'; }
        } catch(e) {}
    };
    check();
    setInterval(check, 30000);
  }

  // =================================================================
  // 1. OBJEDNÁVKY
  // =================================================================
  async function loadB2BOrdersView() {
      const box = ensureContainer('b2b-orders-container');
      // Preload customers
      if (state.customers.length === 0) {
         try {
            const cData = await callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }]);
            state.customers = cData.customers || [];
         } catch(e) {}
      }
      
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      box.innerHTML = `
      <div class="filter-bar" style="justify-content:space-between;">
        <div style="display:flex; gap:10px; align-items:flex-end;">
            <div class="filter-group"><label>Od</label><input type="date" id="ord-from" class="filter-input" value="${today}"></div>
            <div class="filter-group"><label>Do</label><input type="date" id="ord-to" class="filter-input" value="${tomorrow}"></div>
            <div class="filter-group"><label>Zákazník</label>
                <select id="ord-cust" class="filter-input">
                    <option value="">Všetci</option>
                    ${state.customers.map(c => `<option value="${c.zakaznik_id}">${escapeHtml(c.nazov_firmy)}</option>`).join('')}
                </select>
            </div>
            <button id="ord-filter-btn" class="btn btn-primary">Hľadať</button>
        </div>
        <div><button class="btn btn-warning" onclick="window.showDailySummary()">📋 Sumár na zajtra</button></div>
      </div>
      <div id="orders-list-area"></div>
      `;
      
      const loadOrders = async () => {
          const area = doc.getElementById('orders-list-area');
          area.innerHTML = '<p>Hľadám...</p>';
          const fDate = doc.getElementById('ord-from').value;
          let tDate = doc.getElementById('ord-to').value;
          const dObj = new Date(tDate); dObj.setDate(dObj.getDate() + 1);
          const tDateSent = dObj.toISOString().slice(0,10);
          
          try {
              const res = await callFirstOk([{ url: '/api/kancelaria/b2b/getAllOrders', opts: { method: 'POST', body: { from_date: fDate, to_date: tDateSent, customer: doc.getElementById('ord-cust').value } } }]);
              const orders = res.orders || [];
              if(!orders.length) { area.innerHTML = '<p>Žiadne objednávky.</p>'; return; }
              
              let html = `<table class="table-refined"><thead><tr><th>Číslo</th><th>Zákazník</th><th>Vytvorená</th><th>Dodanie</th><th>Suma</th><th>Stav</th><th>Akcia</th></tr></thead><tbody>`;
              orders.forEach(o => {
                  const statusColor = o.stav === 'Prijatá' ? '#eab308' : (o.stav === 'Hotová' ? '#22c55e' : '#94a3b8');
                  
                  // Formátovanie dátumu dodania (Slovenský názov dňa, bez času)
                  let formatDodania = o.pozadovany_datum_dodania || '-';
                  if (formatDodania !== '-') {
                      const d = new Date(formatDodania);
                      if (!isNaN(d.getTime())) {
                          const strDate = d.toLocaleDateString('sk-SK', { 
                              weekday: 'long', 
                              year: 'numeric', 
                              month: '2-digit', 
                              day: '2-digit' 
                          });
                          // Zabezpečenie veľkého začiatočného písmena pri názve dňa
                          formatDodania = strDate.charAt(0).toUpperCase() + strDate.slice(1);
                      }
                  }

                  // Formátovanie dátumu vytvorenia
                  const formatVytvorenia = o.datum_objednavky ? new Date(o.datum_objednavky).toLocaleString('sk-SK') : '-';

                  html += `<tr>
                    <td>${o.cislo_objednavky}</td>
                    <td>${escapeHtml(o.nazov_firmy)}</td>
                    <td>${formatVytvorenia}</td>
                    <td><strong>${formatDodania}</strong></td>
                    <td>${Number(o.celkova_suma_s_dph).toFixed(2)} €</td>
                    <td><span style="background:${statusColor};color:white;padding:2px 5px;border-radius:4px;font-size:0.8em;">${o.stav}</span></td>
                    <td><button class="btn btn-secondary btn-sm" onclick="window.open('/api/kancelaria/b2b/print_order_pdf/${o.id}','_blank')">PDF</button></td>
                  </tr>`;
              });
              html += '</tbody></table>';
              area.innerHTML = html;
          } catch(e) { area.innerHTML = e.message; }
      };
      doc.getElementById('ord-filter-btn').onclick = loadOrders;
      loadOrders();
  }
  // =================================================================
  // 2. LOGISTIKA
  // =================================================================
  async function loadLogisticsView() {
      const box = ensureContainer('b2b-logistics-container');
      try {
          if (state.customers.length === 0) {
             const cData = await callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }]);
             state.customers = cData.customers || [];
          }
          const tData = await callFirstOk([{ url: '/api/kancelaria/b2b/getRouteTemplates' }]);
          state.routeTemplates = tData || [];
      } catch(e) {}

      let custHtml = '';
      state.customers.sort((a,b) => a.nazov_firmy.localeCompare(b.nazov_firmy));
      state.customers.forEach(c => {
          custHtml += `
            <label class="cust-row">
                <input type="checkbox" class="logistics-check" value="${c.id}" data-name="${escapeHtml(c.nazov_firmy)}" data-addr="${escapeHtml(c.adresa_dorucenia || c.adresa)}">
                <div><strong>${escapeHtml(c.nazov_firmy)}</strong><br><span style="font-size:0.8em;color:#666;">${escapeHtml(c.adresa_dorucenia || c.adresa)}</span></div>
            </label>`;
      });

      let tplOptions = '<option value="">-- Vyberte uloženú trasu --</option>';
      state.routeTemplates.forEach(t => tplOptions += `<option value="${t.id}">${escapeHtml(t.name)}</option>`);

      box.innerHTML = `
        <div class="logistics-grid">
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <h4 style="margin:0;">1. Výber zákazníkov</h4>
                    <select id="route-select" class="filter-input" style="width:200px;">${tplOptions}</select>
                </div>
                <div class="filter-group" style="margin-bottom:10px;">
                    <input type="text" id="log-search" class="filter-input" placeholder="Hľadať v zozname..." style="width:100%;">
                </div>
                <div class="cust-check-list" id="log-cust-list">${custHtml}</div>
                <div style="margin-top:10px; display:flex; gap:10px;">
                     <button id="btn-save-route" class="btn btn-secondary btn-sm">Uložiť výber ako šablónu</button>
                     <button id="btn-del-route" class="btn btn-danger btn-sm" style="display:none;">Zmazať šablónu</button>
                </div>
            </div>
            <div>
                <h4>2. Manuálne zastávky</h4>
                <div style="background:#f9fafb; padding:15px; border-radius:6px; border:1px solid #eee;">
                    <input type="text" id="log-man-name" class="filter-input" placeholder="Názov miesta" style="width:100%;margin-bottom:5px;">
                    <input type="text" id="log-man-addr" class="filter-input" placeholder="Adresa / Poznámka" style="width:100%;margin-bottom:5px;">
                    <button id="log-add-manual" class="btn btn-secondary btn-sm">Pridať do zoznamu</button>
                </div>
                <h4 style="margin-top:20px;">3. Náhľad nákladkového listu</h4>
                <ul id="log-print-preview" style="min-height:100px; border:1px dashed #ccc; padding:10px; list-style:none;">
                    <li style="color:#999;">Vyberte zákazníkov vľavo...</li>
                </ul>
                <div style="margin-top:20px;">
                    <label>Dátum rozvozu:</label>
                    <input type="date" id="log-date" value="${new Date().toISOString().slice(0,10)}" class="filter-input">
                    <button class="btn btn-primary" style="width:100%; margin-top:10px; padding:12px;" onclick="window.printLogisticsSheet()">🖨️ Vytlačiť list</button>
                </div>
            </div>
        </div>
      `;

      doc.getElementById('log-search').addEventListener('input', (e) => {
          const val = e.target.value.toLowerCase();
          doc.querySelectorAll('.cust-row').forEach(row => {
              row.style.display = row.innerText.toLowerCase().includes(val) ? 'flex' : 'none';
          });
      });

      const routeSelect = doc.getElementById('route-select');
      routeSelect.addEventListener('change', () => {
          const tid = routeSelect.value;
          const delBtn = doc.getElementById('btn-del-route');
          doc.querySelectorAll('.logistics-check').forEach(cb => cb.checked = false);
          if (tid) {
              delBtn.style.display = 'inline-block';
              const t = state.routeTemplates.find(x => x.id == tid);
              if (t && t.customer_ids) {
                  const ids = JSON.parse(t.customer_ids);
                  ids.forEach(id => {
                      const cb = doc.querySelector(`.logistics-check[value="${id}"]`);
                      if(cb) cb.checked = true;
                  });
              }
          } else { delBtn.style.display = 'none'; }
          updatePreview();
      });

      doc.getElementById('btn-save-route').onclick = async () => {
          const selected = Array.from(doc.querySelectorAll('.logistics-check:checked')).map(cb => parseInt(cb.value));
          if(!selected.length) return showStatus('Vyberte aspoň jedného zákazníka', true);
          const name = prompt("Zadajte názov pre túto trasu (napr. Pondelok - Smer Nitra):");
          if(!name) return;
          try {
              await callFirstOk([{ url: '/api/kancelaria/b2b/saveRouteTemplate', opts: { method: 'POST', body: { name, ids: selected } } }]);
              showStatus('Trasa uložená'); loadLogisticsView();
          } catch(e) { alert(e.message); }
      };
      
      doc.getElementById('btn-del-route').onclick = async () => {
           const tid = routeSelect.value;
           if(!tid || !confirm("Naozaj zmazať túto šablónu?")) return;
           try {
               await callFirstOk([{ url: '/api/kancelaria/b2b/deleteRouteTemplate', opts: { method: 'POST', body: { id: tid } } }]);
               showStatus('Trasa zmazaná'); loadLogisticsView();
           } catch(e) { alert(e.message); }
      };

      const manualList = [];
      const updatePreview = () => {
          const selected = [];
          doc.querySelectorAll('.logistics-check:checked').forEach(cb => {
              selected.push({ name: cb.dataset.name, addr: cb.dataset.addr, type: 'system' });
          });
          const final = [...selected, ...manualList];
          const list = doc.getElementById('log-print-preview');
          if(final.length===0) { list.innerHTML = '<li style="color:#999;">Prázdne...</li>'; return; }
          list.innerHTML = final.map((i, idx) => `
            <li style="padding:5px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
                <span>${idx+1}. <b>${i.name}</b> <span style="font-size:0.8em;color:#666;">(${i.addr})</span></span>
                ${i.type === 'manual' ? `<button onclick="window.removeManualLog(${idx - selected.length})" style="color:red;border:none;cursor:pointer;">&times;</button>` : ''}
            </li>`).join('');
      };

      doc.querySelectorAll('.logistics-check').forEach(cb => cb.addEventListener('change', updatePreview));

      doc.getElementById('log-add-manual').onclick = () => {
          const name = doc.getElementById('log-man-name').value;
          const addr = doc.getElementById('log-man-addr').value;
          if (name) {
              manualList.push({ name, addr, type: 'manual' });
              doc.getElementById('log-man-name').value = '';
              doc.getElementById('log-man-addr').value = '';
              updatePreview();
          }
      };

      window.removeManualLog = (idx) => { manualList.splice(idx, 1); updatePreview(); };
      window.printLogisticsSheet = () => {
          const date = doc.getElementById('log-date').value;
          const selected = [];
          doc.querySelectorAll('.logistics-check:checked').forEach(cb => selected.push({ name: cb.dataset.name, addr: cb.dataset.addr }));
          const all = [...selected, ...manualList];
          if (!all.length) return alert("Zoznam je prázdny.");
          const w = window.open('', '_blank');
          w.document.write(`<html><head><title>Nákladkový list</title><style>body { font-family: Arial; padding: 20px; } table { width: 100%; border-collapse: collapse; margin-top: 20px; } th, td { border: 1px solid #000; padding: 10px; text-align: left; } th { background: #eee; }</style></head><body><h1 style="text-align:center;">Nákladkový list / Rozvoz</h1><p><strong>Dátum:</strong> ${date} &nbsp;&nbsp;&nbsp; <strong>Vodič:</strong> _________________</p><table><thead><tr><th style="width:40px;">#</th><th>Odberateľ / Miesto</th><th>Adresa / Poznámka</th><th style="width:100px;">Podpis</th></tr></thead><tbody>${all.map((item, i) => `<tr><td>${i+1}</td><td><b>${item.name}</b></td><td>${item.addr}</td><td></td></tr>`).join('')}</tbody></table><script>window.print();</script></body></html>`);
          w.document.close();
      };
  }

  // =================================================================
  // 3. KOMUNIKÁCIA
  // =================================================================
  async function loadCommView() {
      const box = ensureContainer('b2b-comm-container');
      box.innerHTML = 'Načítavam...';
      try {
          const [cData, msgData] = await Promise.all([
              callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }]),
              callFirstOk([{ url: '/api/kancelaria/b2b/messages?status=all' }])
          ]);
          const customers = cData.customers || [];
          const msgs = msgData.messages || [];
          const convos = {};
          msgs.forEach(m => {
              const cid = m.customer_id;
              if(!convos[cid]) {
                  const c = customers.find(x => x.id === cid) || { nazov_firmy: m.customer_name || 'Neznámy', id: cid };
                  convos[cid] = { cust: c, msgs: [], unread: false, last: m.created_at };
              }
              convos[cid].msgs.push(m);
              if(m.status === 'new') convos[cid].unread = true;
              if(m.created_at > convos[cid].last) convos[cid].last = m.created_at;
          });
          const sorted = Object.values(convos).sort((a,b) => new Date(b.last) - new Date(a.last));

          box.innerHTML = `
            <div class="chat-wrapper">
                <div class="chat-sidebar"><div style="padding:15px; border-bottom:1px solid #e5e7eb; font-weight:bold; background:#fff;">Správy</div><div class="chat-list" id="chat-list-el"></div></div>
                <div class="chat-main"><div class="chat-header" id="chat-header-el">Vyberte konverzáciu</div><div class="chat-messages" id="chat-msg-el"></div><div class="chat-input" id="chat-input-el" style="display:none;"><textarea id="msg-text" class="filter-input" rows="1" placeholder="Napíšte správu..." style="width:100%; resize:none;"></textarea><input type="file" id="msg-file" style="display:none;"><button class="btn btn-secondary btn-sm" onclick="document.getElementById('msg-file').click()">📎</button><button id="msg-send" class="btn btn-primary">➤</button></div></div>
            </div>`;
          
          const listEl = doc.getElementById('chat-list-el');
          if(!sorted.length) { listEl.innerHTML = '<div style="padding:20px;color:#999;">Žiadne správy.</div>'; return; }

          sorted.forEach(c => {
              const item = doc.createElement('div');
              item.className = `chat-item ${c.unread ? 'unread' : ''}`;
              const lastM = c.msgs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
              item.innerHTML = `<div style="display:flex;justify-content:space-between;"><span style="font-weight:600; font-size:0.9rem;">${escapeHtml(c.cust.nazov_firmy)}</span><span style="font-size:0.7rem;color:#666;">${new Date(c.last).toLocaleDateString()}</span></div><div style="font-size:0.8rem;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.unread ? '🔴 ' : ''}${escapeHtml(lastM.body)}</div>`;
              item.onclick = () => openChat(c, item);
              listEl.appendChild(item);
          });
      } catch(e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
  }

  function openChat(convo, itemEl) {
      doc.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
      itemEl.classList.add('active');
      itemEl.classList.remove('unread');
      doc.getElementById('chat-header-el').textContent = convo.cust.nazov_firmy;
      const msgEl = doc.getElementById('chat-msg-el');
      doc.getElementById('chat-input-el').style.display = 'flex';
      msgEl.innerHTML = '';
      const msgs = convo.msgs.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      const lastId = msgs[msgs.length-1].id;

      msgs.forEach(m => {
          const isMe = m.direction === 'out';
          const att = m.attachment_filename ? `<br><a href="/api/kancelaria/b2b/messages/attachment/${m.id}" target="_blank" style="font-size:0.8rem;color:blue;">📎 ${escapeHtml(m.attachment_filename)}</a>` : '';
          if(!isMe && m.status === 'new') callFirstOk([{ url:'/api/kancelaria/b2b/messages/mark-read', opts:{ method:'POST', body:{id: m.id} } }]);
          msgEl.innerHTML += `<div class="msg-bubble ${isMe ? 'msg-out' : 'msg-in'}"><div>${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>${att}<div class="msg-meta">${new Date(m.created_at).toLocaleString()}</div></div>`;
      });
      msgEl.scrollTop = msgEl.scrollHeight;

      const sendBtn = doc.getElementById('msg-send');
      const newBtn = sendBtn.cloneNode(true);
      sendBtn.parentNode.replaceChild(newBtn, sendBtn);
      
      newBtn.onclick = async () => {
          const txt = doc.getElementById('msg-text').value;
          const file = doc.getElementById('msg-file').files[0];
          if(!txt && !file) return;
          const fd = new FormData();
          fd.append('id', lastId); fd.append('body', txt || 'Príloha'); fd.append('subject', 'Re: ' + (msgs[0].subject || 'Správa'));
          if(file) fd.append('file', file);
          try {
              await fetch('/api/kancelaria/b2b/messages/reply', { method:'POST', body:fd });
              doc.getElementById('msg-text').value = ''; doc.getElementById('msg-file').value = '';
              msgEl.innerHTML += `<div class="msg-bubble msg-out"><div>${escapeHtml(txt).replace(/\n/g,'<br>')}</div><div class="msg-meta">Teraz</div></div>`;
              msgEl.scrollTop = msgEl.scrollHeight;
          } catch(e) { alert(e.message); }
      };
  }

 // =================================================================
// 4. ZÁKAZNÍCI (S FILTROM A STRÁNKOVANÍM)
// =================================================================

async function loadCustomersAndPricelists() {
    const box = ensureContainer('b2b-customers-container');
    box.innerHTML = '<div style="text-align:center;padding:40px;color:#666;"><i class="fas fa-spinner fa-spin"></i> Načítavam databázu zákazníkov...</div>';
    
    try {
        // 1. Načítanie dát
        const data = await callFirstOk([{url:'/api/kancelaria/b2b/getCustomersAndPricelists'}]);
        state.customers = data.customers || []; 
        state.pricelists = data.pricelists || []; 
        state.mapping = data.mapping || {};
        
        // Mapa pre rýchle hľadanie názvov cenníkov
        const plMap = new Map(state.pricelists.map(p=>[p.id, p.nazov_cennika]));

        // 2. HTML Layout (Filter + Tabuľka)
        let html = `
            <div style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4 style="margin:0; color:#1e293b;">👥 Databáza B2B zákazníkov</h4>
                    </div>
                
                <div class="filter-bar" style="border:none; padding:0; margin:0; box-shadow:none; background:transparent; gap:15px;">
                    <div class="filter-group">
                        <label>Hľadať (Názov, ID, Email)</label>
                        <input type="text" id="cust-search-text" class="filter-input" placeholder="napr. MIK s.r.o..." style="width:220px;">
                    </div>
                    
                    <div class="filter-group">
                        <label>Filter podľa cenníka</label>
                        <select id="cust-filter-pricelist" class="filter-input" style="width:200px;">
                            <option value="">-- Všetky cenníky --</option>
                            ${state.pricelists.map(p => `<option value="${p.id}">${escapeHtml(p.nazov_cennika)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="filter-group">
                        <label>Typ účtu</label>
                        <select id="cust-filter-type" class="filter-input" style="width:150px;">
                            <option value="all">Všetci</option>
                            <option value="main">👑 Hlavné účty</option>
                            <option value="branch">🏢 Pobočky</option>
                        </select>
                    </div>
                    
                    <div class="filter-group" style="justify-content:flex-end;">
                         <label>&nbsp;</label>
                         <button id="cust-reset-filter" class="btn btn-secondary">Reset</button>
                    </div>
                </div>
            </div>

            <div id="cust-table-wrapper"></div>
            <div id="cust-pagination" style="display:flex; justify-content:center; gap:5px; margin-top:20px;"></div>
        `;
        box.innerHTML = html;

        // 3. Logika renderovania
        let currentPage = 1;
        const itemsPerPage = 10;

        const renderTable = () => {
            const searchText = doc.getElementById('cust-search-text').value.toLowerCase();
            const plFilter = doc.getElementById('cust-filter-pricelist').value;
            const typeFilter = doc.getElementById('cust-filter-type').value;

            // Filtrovanie
            const filtered = state.customers.filter(c => {
                // A. Text filter
                const textMatch = 
                    c.nazov_firmy.toLowerCase().includes(searchText) || 
                    (c.zakaznik_id || '').toLowerCase().includes(searchText) ||
                    (c.email || '').toLowerCase().includes(searchText);
                if (searchText && !textMatch) return false;

                // B. Pricelist filter
                if (plFilter) {
                    const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
                    // assignedIds sú stringy alebo čísla, porovnávame s plFilter (string)
                    if (!assignedIds.map(String).includes(String(plFilter))) return false;
                }

                // C. Type filter
                const isBranch = !!c.parent_id;
                if (typeFilter === 'main' && isBranch) return false;
                if (typeFilter === 'branch' && !isBranch) return false;

                return true;
            });

            // Zoradenie (A-Z)
            filtered.sort((a,b) => a.nazov_firmy.localeCompare(b.nazov_firmy));

            // Stránkovanie
            const totalPages = Math.ceil(filtered.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = 1;
            const start = (currentPage - 1) * itemsPerPage;
            const paginated = filtered.slice(start, start + itemsPerPage);

            // HTML Tabuľky
            let tableHtml = `
            <div class="stat-card" style="padding:0; overflow:hidden; border:1px solid #e2e8f0;">
                <table class="table-refined">
                    <thead>
                        <tr>
                            <th style="width:100px;">ERP ID</th>
                            <th>Firma / Pobočka</th>
                            <th>Kontakt & Adresa</th>
                            <th>Priradené cenníky</th>
                            <th style="width:260px; text-align:right;">Akcia</th>
                        </tr>
                    </thead>
                    <tbody>`;

            if (paginated.length === 0) {
                tableHtml += `<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;">Žiadni zákazníci nevyhovujú filtru.</td></tr>`;
            } else {
                paginated.forEach(c => {
                    const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
                    
                    // Názvy cenníkov
                    let plBadges = '';
                    if (assignedIds.length > 0) {
                        plBadges = assignedIds.map(id => {
                            const name = plMap.get(Number(id)) || 'ID '+id;
                            return `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:3px;">${escapeHtml(name)}</span>`;
                        }).join('');
                    } else {
                        plBadges = `<span style="color:#94a3b8; font-size:0.8rem;">Žiadne cenníky</span>`;
                    }

                    // Detekcia pobočky
                    const isBranch = !!c.parent_id;
                    const nameDisplay = isBranch 
                        ? `<div style="display:flex; flex-direction:column;">
                             <span style="font-weight:600; color:#0f172a;">${escapeHtml(c.nazov_firmy)}</span>
                             <span style="color:#2563eb; font-size:0.75rem; display:flex; align-items:center; gap:3px;">🏢 Pobočka (Rodič ID: ${c.parent_id})</span>
                           </div>`
                        : `<span style="font-weight:700; font-size:1.05rem; color:#0f172a;">${escapeHtml(c.nazov_firmy)}</span>`;

                    const rowStyle = isBranch ? 'background:#f8fafc;' : '';

                    tableHtml += `<tr style="${rowStyle}">
                        <td style="color:#64748b; font-family:monospace; font-weight:bold;">${escapeHtml(c.zakaznik_id)}</td>
                        <td>${nameDisplay}</td>
                        <td style="font-size:0.85rem;">
                            <div style="font-weight:600;">${escapeHtml(c.email || '')}</div>
                            <div style="color:#64748b;">${escapeHtml(c.telefon || '')}</div>
                            <div style="color:#64748b; font-size:0.75rem;">${escapeHtml(c.adresa_dorucenia || c.adresa || '')}</div>
                        </td>
                        <td>${plBadges}</td>
                        <td style="text-align:right;">
    <button class="btn btn-secondary btn-sm" style="background:#0ea5e9; color:white; border:none;" onclick="window.showCustomer360(${c.id})" title="Karta zákazníka (Štatistiky nákupov)">📊 Karta</button>
    <button class="btn btn-primary btn-sm" style="margin-left:5px;" onclick="window.editB2BCustomer(${c.id})" title="Upraviť údaje a cenníky">✏️ Upraviť</button>
    ${!isBranch ? `<button class="btn btn-warning btn-sm" style="margin-left:5px;" onclick="window.addB2BBranch(${c.id}, '${escapeHtml(c.nazov_firmy)}')" title="Pridať pobočku">+ Pobočka</button>` : ''}
    <button class="btn btn-danger btn-sm" style="margin-left:5px;" onclick="window.deleteB2BCustomer(${c.id})" title="Zmazať účet">🗑️</button>
</td>
                    </tr>`;
                });
            }
            tableHtml += `</tbody></table></div>`;
            
            // Pätička
            tableHtml += `<div style="text-align:right; font-size:0.8rem; color:#64748b; margin-top:8px;">Zobrazené ${paginated.length} z ${filtered.length} zákazníkov</div>`;

            doc.getElementById('cust-table-wrapper').innerHTML = tableHtml;

            // Renderovanie stránkovania
            let pagHtml = '';
            if (totalPages > 1) {
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===1?'disabled':''} onclick="window.changeCustPage(${currentPage-1})">«</button>`;
                
                let startPage = Math.max(1, currentPage - 2);
                let endPage = Math.min(totalPages, currentPage + 2);
                
                for(let i=startPage; i<=endPage; i++) {
                    pagHtml += `<button class="btn btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="window.changeCustPage(${i})" style="min-width:30px;">${i}</button>`;
                }
                
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===totalPages?'disabled':''} onclick="window.changeCustPage(${currentPage+1})">»</button>`;
            }
            doc.getElementById('cust-pagination').innerHTML = pagHtml;
        };

        // Globálna funkcia pre stránkovanie
        window.changeCustPage = (pageNum) => {
            if (pageNum < 1) return;
            currentPage = pageNum;
            renderTable();
        };

        // Listenery
        doc.getElementById('cust-search-text').addEventListener('input', () => { currentPage=1; renderTable(); });
        doc.getElementById('cust-filter-pricelist').addEventListener('change', () => { currentPage=1; renderTable(); });
        doc.getElementById('cust-filter-type').addEventListener('change', () => { currentPage=1; renderTable(); });
        
        doc.getElementById('cust-reset-filter').addEventListener('click', () => {
            doc.getElementById('cust-search-text').value = '';
            doc.getElementById('cust-filter-pricelist').value = '';
            doc.getElementById('cust-filter-type').value = 'all';
            currentPage = 1;
            renderTable();
        });

        // Prvé spustenie
        renderTable();

    } catch(e) { 
        console.error(e);
        box.innerHTML = `<p class="error">Chyba pri načítaní: ${e.message}</p>`; 
    }
}

// === Existujúce funkcie (pre istotu ich tu nechávam, ak by ste ich potrebovali v kontexte) ===

window.editB2BCustomer = function(id) {
    const cust = state.customers.find(c => c.id === id);
    if(!cust) return;
    
    const assignedIds = state.mapping[cust.zakaznik_id] || state.mapping[cust.id] || [];
    let plHtml = '';
    
    state.pricelists.forEach(p => {
        const checked = assignedIds.includes(p.id) ? 'checked' : '';
        plHtml += `<label style="display:block; margin-bottom:5px; padding:5px; background:#f9fafb; border-radius:4px;"><input type="checkbox" class="pl-check" value="${p.id}" ${checked}> ${escapeHtml(p.nazov_cennika)}</label>`;
    });
    
    openModal(`<div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
      <div>
          <h4>Fakturačné údaje</h4>
          <div class="form-group"><label>ID</label><input type="text" value="${escapeHtml(cust.zakaznik_id)}" disabled class="filter-input" style="width:100%; background:#eee;"></div>
          <div class="form-group"><label>Firma</label><input type="text" id="ced-name" value="${escapeHtml(cust.nazov_firmy)}" class="filter-input" style="width:100%;"></div>
          <div class="form-group"><label>Email</label><input type="text" id="ced-email" value="${escapeHtml(cust.email)}" class="filter-input" style="width:100%;"></div>
          <div class="form-group"><label>Telefón</label><input type="text" id="ced-phone" value="${escapeHtml(cust.telefon)}" class="filter-input" style="width:100%;"></div>
          <div class="form-group"><label>Adresa</label><textarea id="ced-addr" class="filter-input" style="width:100%;">${escapeHtml(cust.adresa)}</textarea></div>
          <div class="form-group"><label>Adresa doručenia</label><textarea id="ced-del-addr" class="filter-input" style="width:100%;" placeholder="Ak je iná ako fakturačná">${escapeHtml(cust.adresa_dorucenia || '')}</textarea></div>
      </div>
      <div>
          <h4>Priradené cenníky</h4>
          <div style="max-height:300px; overflow-y:auto; border:1px solid #ddd; padding:10px; border-radius:4px;">${plHtml}</div>
          <h4 style="margin-top:20px;">Iné</h4>
          <label><input type="checkbox" id="ced-active" ${cust.je_schvaleny ? 'checked' : ''}> Účet je aktívny</label>
      </div>
    </div>
    <div style="margin-top:20px; text-align:right;"><button class="btn btn-success" onclick="window.saveB2BCustomer(${cust.id})">Uložiť zmeny</button></div>`);
};

window.saveB2BCustomer = async function(id) {
    const payload = {
        id: id, 
        nazov_firmy: document.getElementById('ced-name').value, 
        email: document.getElementById('ced-email').value, 
        telefon: document.getElementById('ced-phone').value, 
        adresa: document.getElementById('ced-addr').value,
        adresa_dorucenia: document.getElementById('ced-del-addr').value, // Doplnené
        je_schvaleny: document.getElementById('ced-active').checked ? 1 : 0, 
        pricelist_ids: Array.from(document.querySelectorAll('.pl-check:checked')).map(cb => cb.value)
    };
    try {
        await callFirstOk([{ url: '/api/kancelaria/b2b/updateCustomer', opts: { method: 'POST', body: payload } }]);
        showStatus('Zákazník uložený'); 
        closeModal(); 
        loadCustomersAndPricelists();
    } catch(e) { alert(e.message); }
};

window.deleteB2BCustomer = async function(id) {
    const cust = state.customers.find(c => c.id === id);
    if(!cust) return;

    const assignedIds = state.mapping[cust.zakaznik_id] || state.mapping[cust.id] || [];
    if (assignedIds.length > 0) {
        alert(`Zákazník ${cust.nazov_firmy} má priradené cenníky.\nPred zmazaním mu ich musíte odobrať.`);
        return;
    }

    const confirmWord = prompt(
        `UPOZORNENIE: Chystáte sa natrvalo zmazať zákazníka:\n"${cust.nazov_firmy}"\n\nAk ste si istí, napíšte slovo ZMAZAT:`
    );

    if (confirmWord !== "ZMAZAT") {
        showStatus("Mazanie zrušené.", true);
        return;
    }

    try {
        const res = await callFirstOk([{ 
            url: '/api/kancelaria/b2b/deleteCustomer', 
            opts: { method: 'POST', body: { id: id } } 
        }]);
        
        showStatus(res.message || 'Zákazník bol zmazaný.');
        loadCustomersAndPricelists();
        
    } catch(e) { 
        alert("Chyba pri mazaní: " + e.message); 
    }
};

// === NOVÉ FUNKCIE PRE POBOČKY (Step 4) ===

window.addB2BBranch = function(parentId, parentName) {
    openModal(`
        <h3>Pridať odberné miesto pre: ${parentName}</h3>
        <div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:10px; border-radius:6px; margin-bottom:15px; font-size:0.9rem;">
            ℹ️ Pobočka bude automaticky dediť cenníky od rodiča. Prihlásenie prebieha cez hlavný účet rodiča.
        </div>
        <div class="form-group">
            <label>Názov pobočky / prevádzky (napr. Detské jasle)</label>
            <input type="text" id="br-name" class="filter-input" style="width:100%; font-size:1.1rem;">
        </div>
        <div class="form-group">
            <label>Nové Zákaznícke číslo (ERP ID) <span style="color:red">*</span></label>
            <input type="text" id="br-code" class="filter-input" style="width:100%; font-weight:bold;" placeholder="napr. 000005">
            <small style="color:#666;">Musí byť unikátne.</small>
        </div>
        <div class="form-group">
            <label>Adresa doručenia pobočky</label>
            <input type="text" id="br-addr" class="filter-input" style="width:100%;" placeholder="Ulica, Mesto...">
        </div>
        <div style="margin-top:20px; text-align:right;">
            <button class="btn btn-secondary" onclick="closeModal()" style="margin-right:10px;">Zrušiť</button>
            <button class="btn btn-success" onclick="window.saveB2BBranch(${parentId})">Vytvoriť pobočku</button>
        </div>
    `);
};

window.saveB2BBranch = async function(parentId) {
    const data = {
        parent_id: parentId,
        branch_name: document.getElementById('br-name').value,
        branch_code: document.getElementById('br-code').value,
        branch_address: document.getElementById('br-addr').value
    };
    
    if(!data.branch_name || !data.branch_code) {
        return showStatus('Vyplňte názov a zákaznícke číslo.', true);
    }
    
    try {
        await callFirstOk([{ 
            url: '/api/kancelaria/b2b/createBranch', 
            opts: { method: 'POST', body: data } 
        }]);
        
        showStatus('Pobočka úspešne vytvorená.');
        closeModal();
        loadCustomersAndPricelists(); // Refresh tabuľky
    } catch(e) {
        alert("Chyba: " + e.message);
    }
};

// =================================================================
// 5. CENNÍKY (MANAGEMENT) - FILTER, STRÁNKOVANIE A PREHĽAD
// =================================================================

async function loadPricelistsForManagement() {
    const box = ensureContainer('b2b-pricelists-container');
    box.innerHTML = '<div style="text-align:center;padding:40px;color:#666;"><i class="fas fa-spinner fa-spin"></i> Načítavam zoznamy a priradenia...</div>';
    
    try {
        // 1. Načítame cenníky AJ zákazníkov (aby sme vedeli, komu čo patrí)
        const [plData, custData] = await Promise.all([
            callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]),
            callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }])
        ]);

        state.pricelists = plData.pricelists || []; 
        state.productsAll = plData.products || [];
        state.customers = custData.customers || [];
        state.mapping = custData.mapping || {}; // Mapa: customer_id -> [pricelist_id]

        // 2. Spracovanie dát: Inverzné mapovanie (Cenník -> Zoznam firiem)
        const pricelistUsage = {}; // id_cennika -> ["Firma A", "Firma B"]
        
        // Inicializácia polí
        state.pricelists.forEach(pl => pricelistUsage[pl.id] = []);

        // Prejdenie zákazníkov a naplnenie použitia
        state.customers.forEach(c => {
            // Mapping môže byť podľa ID (int) alebo zakaznik_id (string), skúsime oboje
            const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
            assignedIds.forEach(plId => {
                const pid = parseInt(plId);
                if (pricelistUsage[pid]) {
                    pricelistUsage[pid].push(c.nazov_firmy);
                }
            });
        });

        // 3. Vykreslenie UI (Ovládací panel + Kontajner na tabuľku)
        let html = `
            <div style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4 style="margin:0; color:#1e293b;">🗂️ Správa cenníkov</h4>
                    <button id="btn-create-pl" class="btn btn-success" style="font-weight:bold;"><i class="fas fa-plus"></i> + Nový cenník</button>
                </div>
                
                <div class="filter-bar" style="border:none; padding:0; margin:0; box-shadow:none; background:transparent; gap:15px;">
                    <div class="filter-group">
                        <label>Názov cenníka</label>
                        <input type="text" id="pl-search-text" class="filter-input" placeholder="Hľadať..." style="width:200px;">
                    </div>
                    
                    <div class="filter-group">
                        <label>Stav priradenia</label>
                        <select id="pl-filter-status" class="filter-input" style="width:160px;">
                            <option value="all">Všetky</option>
                            <option value="assigned">✅ Priradené (Aktívne)</option>
                            <option value="unassigned">⚪ Nepriradené (Voľné)</option>
                        </select>
                    </div>

                    <div class="filter-group">
                        <label>Patrí zákazníkovi</label>
                        <select id="pl-filter-customer" class="filter-input" style="width:250px;">
                            <option value="">-- Ktorýkoľvek --</option>
                            ${state.customers.map(c => `<option value="${escapeHtml(c.nazov_firmy)}">${escapeHtml(c.nazov_firmy)}</option>`).join('')}
                        </select>
                    </div>
                    
                    <div class="filter-group" style="justify-content:flex-end;">
                         <label>&nbsp;</label>
                         <button id="pl-reset-filter" class="btn btn-secondary">Reset</button>
                    </div>
                </div>
            </div>

            <div id="pl-table-wrapper"></div>
            <div id="pl-pagination" style="display:flex; justify-content:center; gap:5px; margin-top:20px;"></div>
        `;
        
        box.innerHTML = html;

        // 4. Logika renderovania tabuľky
        let currentPage = 1;
        const itemsPerPage = 10;

        const renderTable = () => {
            const searchText = doc.getElementById('pl-search-text').value.toLowerCase();
            const statusFilter = doc.getElementById('pl-filter-status').value;
            const custFilter = doc.getElementById('pl-filter-customer').value;

            // Filtrovanie
            const filtered = state.pricelists.filter(pl => {
                const usage = pricelistUsage[pl.id] || [];
                const isAssigned = usage.length > 0;

                // A. Text filter
                if (searchText && !pl.nazov_cennika.toLowerCase().includes(searchText)) return false;
                
                // B. Status filter
                if (statusFilter === 'assigned' && !isAssigned) return false;
                if (statusFilter === 'unassigned' && isAssigned) return false;

                // C. Customer filter (ak je zvolený zákazník, cenník musí byť v jeho zozname)
                if (custFilter && !usage.includes(custFilter)) return false;

                return true;
            });

            // Zoradenie (A-Z)
            filtered.sort((a,b) => a.nazov_cennika.localeCompare(b.nazov_cennika));

            // Stránkovanie
            const totalPages = Math.ceil(filtered.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = 1;
            const start = (currentPage - 1) * itemsPerPage;
            const paginated = filtered.slice(start, start + itemsPerPage);

            // Generovanie HTML tabuľky
            let tableHtml = `
            <div class="stat-card" style="padding:0; overflow:hidden; border:1px solid #e2e8f0;">
                <table class="table-refined">
                    <thead>
                        <tr>
                            <th style="width:40%;">Názov cenníka</th>
                            <th style="width:30%;">Použitie / Zákazníci</th>
                            <th style="width:30%;text-align:right;">Akcia</th>
                        </tr>
                    </thead>
                    <tbody>`;

            if (paginated.length === 0) {
                tableHtml += `<tr><td colspan="3" style="text-align:center;padding:40px;color:#94a3b8;">Žiadne cenníky nevyhovujú filtru.</td></tr>`;
            } else {
                paginated.forEach(pl => {
                    const usage = pricelistUsage[pl.id] || [];
                    let statusInfo = '';
                    
                    if (usage.length > 0) {
                        const tooltip = usage.join('\n');
                        const countLabel = usage.length === 1 ? usage[0] : `${usage.length} zákazníkov`;
                        statusInfo = `<div style="display:flex; align-items:center; gap:5px;" title="${escapeHtml(tooltip)}">
                            <span style="color:#166534; background:#dcfce7; padding:2px 8px; border-radius:99px; font-size:0.75rem; font-weight:bold;">✅ Aktívny</span>
                            <span style="font-size:0.85rem; color:#475569; cursor:help; border-bottom:1px dotted #ccc;">${escapeHtml(countLabel)}</span>
                        </div>`;
                    } else {
                        statusInfo = `<span style="color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:99px; font-size:0.75rem;">⚪ Nepriradený</span>`;
                    }

                    tableHtml += `<tr>
                        <td style="font-size:1.05rem; font-weight:600; vertical-align:middle; color:#0f172a;">
                            ${escapeHtml(pl.nazov_cennika)}
                        </td>
                        <td style="vertical-align:middle;">${statusInfo}</td>
                        <td style="text-align:right;">
                            <button class="btn btn-secondary btn-sm" onclick="window.printPricelistPreview(${pl.id})" title="Tlačiť náhľad">🖨️</button>
                            <button class="btn btn-primary btn-sm" style="margin-left:5px;" onclick="window.showPricelistEditor(${pl.id})" title="Upraviť položky">✏️ Upraviť</button>
                            <button class="btn btn-danger btn-sm" style="margin-left:5px;" data-del-pl="${pl.id}" data-name="${escapeHtml(pl.nazov_cennika)}" title="Zmazať">🗑️</button>
                        </td>
                    </tr>`;
                });
            }
            tableHtml += `</tbody></table></div>`;
            
            // Pätička s info
            tableHtml += `<div style="text-align:right; font-size:0.8rem; color:#64748b; margin-top:8px;">Zobrazené ${paginated.length} z ${filtered.length} (Celkovo ${state.pricelists.length})</div>`;

            doc.getElementById('pl-table-wrapper').innerHTML = tableHtml;

            // Renderovanie tlačidiel stránkovania
            let pagHtml = '';
            if (totalPages > 1) {
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===1?'disabled':''} onclick="window.changePlPage(${currentPage-1})">« Predchádzajúca</button>`;
                
                // Zjednodušené zobrazenie čísiel stránok
                let startPage = Math.max(1, currentPage - 2);
                let endPage = Math.min(totalPages, currentPage + 2);
                
                for(let i=startPage; i<=endPage; i++) {
                    pagHtml += `<button class="btn btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="window.changePlPage(${i})" style="min-width:30px;">${i}</button>`;
                }
                
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===totalPages?'disabled':''} onclick="window.changePlPage(${currentPage+1})">Ďalšia »</button>`;
            }
            doc.getElementById('pl-pagination').innerHTML = pagHtml;

            // Re-attach delete listeners (pretože sme prekreslili HTML)
            attachDeleteListeners();
        };

        const attachDeleteListeners = () => {
            box.querySelectorAll('button[data-del-pl]').forEach(b => {
                b.onclick = async () => {
                    const plName = b.dataset.name;
                    const verification = prompt(`⚠️ POZOR: Chystáte sa vymazať cenník "${plName}".\n\nAk to naozaj chcete urobiť, napíšte veľkými písmenami slovo: ZMAZAT`);
                    
                    if (verification !== "ZMAZAT") {
                        alert("Mazanie bolo zrušené.");
                        return;
                    }

                    try {
                        await callFirstOk([{ url: '/api/kancelaria/b2b/deletePricelist', opts: { method: 'POST', body: { id: b.dataset.delPl } } }]);
                        showStatus('Cenník bol úspešne vymazaný.', false);
                        loadPricelistsForManagement(); // Reload
                    } catch(e) { showStatus(e.message || String(e), true); }
                };
            });
        };

        // Globálna funkcia pre stránkovanie
        window.changePlPage = (pageNum) => {
            if (pageNum < 1) return;
            currentPage = pageNum;
            renderTable();
        };

        // Event Listeners pre filtre
        doc.getElementById('pl-search-text').addEventListener('input', () => { currentPage=1; renderTable(); });
        doc.getElementById('pl-filter-status').addEventListener('change', () => { currentPage=1; renderTable(); });
        doc.getElementById('pl-filter-customer').addEventListener('change', () => { currentPage=1; renderTable(); });
        
        doc.getElementById('pl-reset-filter').addEventListener('click', () => {
            doc.getElementById('pl-search-text').value = '';
            doc.getElementById('pl-filter-status').value = 'all';
            doc.getElementById('pl-filter-customer').value = '';
            currentPage = 1;
            renderTable();
        });
        
        doc.getElementById('btn-create-pl').onclick = () => window.showPricelistEditor(null);

        // Prvé vykreslenie
        renderTable();

    } catch(e) { 
        console.error(e);
        box.innerHTML = `<p class="error">Chyba pri načítaní dát: ${e.message}</p>`; 
    }
}
// =================================================================
// 2. EDITOR V MODALE (VEĽKÉ OKNO - FULLSCREEN)
// =================================================================

window.showPricelistEditor = function(plId) {
    const isEdit = !!plId;
    
    // Zoznam zákazníkov (pre nový cenník)
    let customersHtml = '';
    if (!isEdit) state.customers.forEach(c => { 
        customersHtml += `<label class="cust-option"><input type="checkbox" value="${c.id}"> ${escapeHtml(c.nazov_firmy)}</label>`; 
    });

    // Zoznam cenníkov na kopírovanie
    let copyOptions = '<option value="">-- Nevyplňovať --</option>';
    state.pricelists.forEach(p => {
        if (p.id != plId) copyOptions += `<option value="${p.id}">Kopírovať z: ${escapeHtml(p.nazov_cennika)}</option>`;
    });

    // === HTML PRE MODAL (S CSS PRE VEĽKÉ OKNO) ===
    const modalHtml = `
      <style>
          /* Tieto štýly "prebijú" predvolené malé okno */
          .b2b-modal-content {
              width: 96vw !important;        /* 96% šírky obrazovky */
              max-width: 1920px !important;  /* Povoliť až do Full HD */
              height: 92vh !important;       /* 92% výšky obrazovky */
              display: flex !important;
              flex-direction: column !important;
              padding: 0 !important;         /* Reset paddingu, nastavíme si vlastný */
              border-radius: 8px !important;
              overflow: hidden !important;   /* Žiadny scroll na hlavnom okne */
          }
          
          /* Hlavný layout editora */
          .pl-editor-wrapper {
              display: flex;
              flex-direction: column;
              height: 100%;
              background: #f8fafc;
          }

          .pl-header {
              padding: 15px 20px;
              background: #fff;
              border-bottom: 1px solid #e2e8f0;
              display: flex;
              justify-content: space-between;
              align-items: center;
          }

          .pl-controls {
              padding: 15px 20px;
              background: #fff;
              border-bottom: 1px solid #e2e8f0;
              display: grid;
              grid-template-columns: 2fr 1fr;
              gap: 20px;
          }

          /* Grid pre tabuľky - roztiahne sa na zvyšok výšky */
          .pl-tables-grid {
              flex: 1;               /* Vyplní zvyšok miesta */
              display: grid;
              grid-template-columns: 1fr 1fr; /* Dva rovnaké stĺpce */
              gap: 15px;
              padding: 15px;
              overflow: hidden;      /* Aby scrollovali len tabuľky, nie celá stránka */
              min-height: 0;         /* Nutné pre flex/grid scrollovanie */
          }

          .pl-panel {
              display: flex;
              flex-direction: column;
              background: #fff;
              border: 1px solid #cbd5e1;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          }

          .pl-panel-head {
              padding: 10px 15px;
              font-weight: bold;
              border-bottom: 1px solid #e2e8f0;
          }

          .pl-scroll-area {
              flex: 1;               /* Roztiahne sa */
              overflow-y: auto;      /* Scrollovanie tu */
              background: #fff;
          }

          .pl-footer {
              padding: 15px 20px;
              background: #fff;
              border-top: 1px solid #e2e8f0;
              text-align: right;
          }
          
          /* Oprava tabuliek */
          .pl-scroll-area table { width: 100%; border-collapse: collapse; }
          .pl-scroll-area th { position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      </style>

      <div class="pl-editor-wrapper">
          <div class="pl-header">
              <h3 style="margin:0; color:#1e3a8a; display:flex; align-items:center; gap:10px;">
                  ${isEdit ? '✏️ Úprava cenníka' : '➕ Nový cenník'}
              </h3>
              <button class="btn btn-secondary btn-sm" onclick="closeModal()">❌ Zavrieť</button>
          </div>
          
          <div class="pl-controls">
              <div class="form-group">
                  <label style="font-weight:bold;">Názov cenníka</label>
                  <input type="text" id="pl-name" class="filter-input" style="width:100%; font-size:1.1rem; font-weight:bold; border: 2px solid #3b82f6;" placeholder="Napr. VIP Odberateľ 2026">
              </div>
              ${isEdit ? `
              <div class="form-group">
                  <label>Kopírovať popisy/info z iného cenníka:</label>
                  <div style="display:flex; gap:5px;">
                      <select id="pl-source-copy" class="filter-input" style="flex:1;">${copyOptions}</select>
                      <button class="btn btn-secondary btn-sm" onclick="window.importInfoFromSelected()">Načítať</button>
                  </div>
              </div>` : ''}
              
              ${!isEdit ? `<div class="form-group"><label>Priradiť ihneď zákazníkom:</label><div class="cust-select-container" id="pl-new-cust-list" style="max-height:60px;">${customersHtml}</div></div>` : ''}
          </div>

          ${isEdit ? `
          <div class="pl-tables-grid">
              <div class="pl-panel" style="border-color: #94a3b8;">
                  <div class="pl-panel-head" style="background:#f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                      <span>📦 Katalóg produktov (Zdroj)</span>
                      <input type="text" id="pl-prod-filter" class="filter-input" style="width:200px; padding:4px;" placeholder="🔍 Hľadať...">
                  </div>
                  <div id="pl-source-list" class="pl-scroll-area"></div>
              </div>

              <div class="pl-panel" style="border-color: #22c55e;">
                  <div class="pl-panel-head" style="background:#dcfce7; color:#14532d;">
                      ✅ Položky v tomto cenníku
                  </div>
                  <div id="pl-target-list" class="pl-scroll-area" style="background:#f0fdf4;"></div>
              </div>
          </div>` : '<div style="flex:1; display:flex; align-items:center; justify-content:center; color:#666;">Najprv uložte názov cenníka, potom budete môcť pridávať produkty.</div>'}
          
          <div class="pl-footer">
              <button class="btn btn-secondary" onclick="closeModal()" style="margin-right:10px;">Zrušiť</button>
              <button id="pl-save-btn" class="btn btn-success" style="padding: 10px 40px; font-size:1.1rem; font-weight:bold;">💾 Uložiť cenník</button>
          </div>
      </div>`;
    
    // Otvoríme modal
    openModal(modalHtml);

    if (isEdit) {
        const pl = state.pricelists.find(p => p.id == plId);
        if(pl) doc.getElementById('pl-name').value = pl.nazov_cennika;
        
        // Spustíme načítanie
        loadPricelistItemsForEdit(plId);
        
        doc.getElementById('pl-save-btn').onclick = async () => window.savePricelistItems(plId);
        const filterInput = doc.getElementById('pl-prod-filter');
        if(filterInput) {
            filterInput.focus();
            filterInput.addEventListener('input', (e) => renderSourceProducts(e.target.value));
        }
    } else {
        doc.getElementById('pl-save-btn').onclick = async () => {
            const name = doc.getElementById('pl-name').value.trim();
            if(!name) return showStatus('Zadajte názov', true);
            const selectedCusts = Array.from(doc.querySelectorAll('#pl-new-cust-list input:checked')).map(cb => cb.value);
            try { 
                await callFirstOk([{ url: '/api/kancelaria/b2b/createPricelist', opts: { method: 'POST', body: { name, customer_ids: selectedCusts } } }]); 
                showStatus('Cenník vytvorený'); 
                closeModal(); 
                loadPricelistsForManagement(); 
            } catch(e) { showStatus(e.message, true); }
        };
    }
};
// Funkcia na uloženie (aktualizovaná pre Modal)
window.savePricelistItems = async function(plId) {
    const newName = doc.getElementById('pl-name').value.trim();
    if(!newName) return showStatus('Názov cenníka nemôže byť prázdny!', true);

    // Aktualizujeme mapu z inputov
    const rows = doc.querySelectorAll('.pl-item-row');
    rows.forEach(row => {
        const ean = row.dataset.ean;
        const priceInput = row.querySelector('.price-edit-input');
        const infoInput = row.querySelector('.info-edit-input');
        
        if (ean && priceInput) {
            currentPlItems.set(ean, {
                price: parseFloat(priceInput.value) || 0,
                info: infoInput ? infoInput.value.trim() : ''
            });
        }
    });

    const items = []; 
    currentPlItems.forEach((data, ean) => items.push({ 
        ean: ean, 
        price: data.price,
        info: data.info 
    }));

    try { 
        await callFirstOk([{ 
            url: '/api/kancelaria/b2b/updatePricelist', 
            opts: { method: 'POST', body: { id: plId, name: newName, items } } 
        }]); 
        showStatus('Cenník uložený.'); 
        closeModal(); 
        loadPricelistsForManagement(); 
    } catch(e) { 
        showStatus(e.message, true); 
    }
};

async function loadPricelistItemsForEdit(plId) {
    currentPlItems.clear();
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id:plId} } }]);
        // Načítame cenu aj info
        (data.items || []).forEach(i => {
            currentPlItems.set(i.ean_produktu, { 
                price: Number(i.cena), 
                info: i.info || i.poznamka || '' 
            });
        });
        renderSourceProducts(''); 
        renderTargetProducts();
    } catch(e) { console.error(e); }
}

function renderSourceProducts(filter) {
    const container = doc.getElementById('pl-source-list');
    if (!container) return; 

    const f = filter.toLowerCase();
    
    // Hlavička tabuľky
    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead style="background:#f8fafc; position:sticky; top:0;">
            <tr>
                <th style="text-align:left; padding:5px;">Produkt</th>
                <th style="width:80px;">Cena (€)</th>
                <th style="width:40px;"></th>
            </tr>
        </thead>
        <tbody>`;
    
    let count = 0;
    state.productsAll.forEach(p => {
        if (currentPlItems.has(p.ean)) return; // Už je v cenníku
        if (count > 50 && !f) return; // Limit zobrazenia
        
        if (!f || p.nazov_vyrobku.toLowerCase().includes(f) || p.ean.includes(f)) {
            html += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">
                    <div style="font-weight:600;">${escapeHtml(p.nazov_vyrobku)}</div>
                    <div style="font-size:0.75em; color:#666;">EAN: ${p.ean} | DPH: ${p.dph}%</div>
                </td>
                <td style="padding:6px;">
                    <input type="number" id="price-in-${p.ean}" placeholder="0.00" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" step="0.01">
                </td>
                <td style="padding:6px; text-align:center;">
                    <button class="btn btn-primary btn-sm" onclick="window.plAdd('${p.ean}')" style="padding:2px 8px;">+</button>
                </td>
            </tr>`;
            count++;
        }
    });
    html += '</tbody></table>';
    
    if (count === 0 && f) html = '<div style="padding:20px; text-align:center; color:#999;">Nenašiel sa žiadny produkt.</div>';
    
    container.innerHTML = html;
}

window.plAdd = (ean) => {
    const input = doc.getElementById(`price-in-${ean}`);
    const price = parseFloat(input.value);
    if (isNaN(price) || price < 0) return showStatus('Zadajte platnú cenu', true);
    
    currentPlItems.set(ean, { price: price, info: '' });
    
    renderSourceProducts(doc.getElementById('pl-prod-filter').value);
    renderTargetProducts();
    input.value = ''; 
};

// =================================================================
// INTELIGENTNÁ CENOTVORBA (Vložte do b2b_admin.js)
// =================================================================

function renderTargetProducts() {
    const container = doc.getElementById('pl-target-list');
    if (!container) return;

    // Hlavička s novými stĺpcami pre Nákup a Zisk
    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead style="background:#dcfce7; position:sticky; top:0; z-index:20;">
            <tr>
                <th style="text-align:left; padding:8px;">Produkt v cenníku</th>
                <th style="width:80px; text-align:right; color:#64748b;">Nákup</th>
                <th style="width:90px;">Predajná Cena</th>
                <th style="width:100px; text-align:right;">Marža / Zisk</th>
                <th style="width:30px;"></th>
            </tr>
        </thead>
        <tbody>`;

    currentPlItems.forEach((data, ean) => {
        // Nájdeme produkt a jeho nákupnú cenu
        const p = state.productsAll.find(x => x.ean === ean) || { 
            nazov_vyrobku: 'Neznámy produkt', 
            nakupna_cena: 0 
        };
        
        const priceVal = (typeof data === 'object') ? data.price : data;
        const infoVal = (typeof data === 'object') ? (data.info || '') : '';
        const buyPrice = parseFloat(p.nakupna_cena) || 0;

        // Vypočítame počiatočné hodnoty
        const profit = priceVal - buyPrice;
        let marginPercent = 0;
        if (priceVal > 0) marginPercent = (profit / priceVal) * 100;

        // Farba podľa zisku: Červená (strata), Oranžová (nízka marža < 10%), Zelená (ok)
        const profitClass = profit < 0 ? 'color:#dc2626;' : (marginPercent < 10 ? 'color:#d97706;' : 'color:#166534;');
        const profitText = `${profit > 0 ? '+' : ''}${profit.toFixed(2)} €`;
        const marginText = `${marginPercent.toFixed(1)}%`;

        html += `
        <tr class="pl-item-row" data-ean="${ean}" data-buy="${buyPrice}" style="border-bottom:1px solid #bbf7d0; background:#fff;">
            <td style="padding:6px;">
                <div style="font-weight:600; color:#1e293b;">${escapeHtml(p.nazov_vyrobku)}</div>
                <div style="font-size:0.75em; color:#64748b;">EAN: ${ean}</div>
                <input type="text" class="info-edit-input" value="${escapeHtml(infoVal)}" placeholder="Poznámka pre klienta..." style="width:100%; margin-top:4px; border:1px solid #e2e8f0; padding:2px 5px; font-size:0.8em; color:#444; border-radius:4px;">
            </td>
            
            <td style="padding:6px; text-align:right; vertical-align:middle; font-size:0.9rem; color:#64748b;">
                ${buyPrice > 0 ? buyPrice.toFixed(4) + ' €' : '-'}
            </td>

            <td style="padding:6px; vertical-align:middle;">
                <input type="number" class="price-edit-input" value="${priceVal}" 
                       oninput="window.recalcRow('${ean}')"
                       id="input-price-${ean}"
                       style="width:100%; padding:6px; border:2px solid #cbd5e1; border-radius:6px; font-weight:bold; text-align:center; color:#0f172a;" step="0.01">
            </td>

            <td style="padding:6px; text-align:right; vertical-align:middle;">
                <div id="profit-wrap-${ean}" style="font-weight:bold; ${profitClass}">
                    <div style="font-size:0.95rem;">${marginText}</div>
                    <div style="font-size:0.75rem; opacity:0.8;">${profitText}</div>
                </div>
            </td>

            <td style="padding:6px; text-align:center; vertical-align:middle;">
                <button class="btn btn-danger btn-sm" onclick="window.plRem('${ean}')" style="padding:2px 8px; border-radius:4px;">&times;</button>
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    
    if (currentPlItems.size === 0) html = '<div style="padding:40px; text-align:center; color:#15803d; background:#f0fdf4;">Cenník je zatiaľ prázdny.<br>👈 Pridajte produkty z katalógu vľavo.</div>';
    
    container.innerHTML = html;
}

// Funkcia na okamžitý prepočet pri písaní (bez sekania tabuľky)
window.recalcRow = function(ean) {
    const row = document.querySelector(`.pl-item-row[data-ean="${ean}"]`);
    if (!row) return;

    const input = document.getElementById(`input-price-${ean}`);
    const wrap = document.getElementById(`profit-wrap-${ean}`);
    
    const sellPrice = parseFloat(input.value) || 0;
    const buyPrice = parseFloat(row.dataset.buy) || 0;

    const profit = sellPrice - buyPrice;
    
    // Výpočet Marže
    let margin = 0;
    if (sellPrice !== 0) {
        margin = (profit / sellPrice) * 100;
    }

    // Formátovanie a farby
    const color = profit < 0 ? '#dc2626' : (margin < 10 ? '#d97706' : '#166534');
    wrap.style.color = color;
    
    // Zobrazíme: % hore, € dole
    wrap.innerHTML = `
        <div style="font-size:0.95rem;">${margin.toFixed(1)}%</div>
        <div style="font-size:0.75rem; opacity:0.8;">${profit > 0 ? '+' : ''}${profit.toFixed(2)} €</div>
    `;
    
    // Uloženie do pamäte (aby sa hodnota nestratila pri scrollovaní/filtrovaní)
    if (currentPlItems.has(ean)) {
        const item = currentPlItems.get(ean);
        item.price = sellPrice;
        currentPlItems.set(ean, item);
    }
};

// === NOVÁ FUNKCIA: Import info z iného cenníka ===
window.importInfoFromSelected = async () => {
    const sourceId = doc.getElementById('pl-source-copy').value;
    if (!sourceId) return showStatus('Vyberte cenník zo zoznamu', true);
    
    if (!confirm("Týmto sa prepíšu poznámky/info pri produktoch, ktoré sa nachádzajú v oboch cenníkoch. Chcete pokračovať?")) return;

    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id: sourceId} } }]);
        const sourceItems = data.items || [];
        
        let updatedCount = 0;
        if (currentPlItems.size > 0) {
            sourceItems.forEach(srcItem => {
                if (currentPlItems.has(srcItem.ean_produktu)) {
                    const currentData = currentPlItems.get(srcItem.ean_produktu);
                    if (srcItem.info || srcItem.poznamka) {
                        currentData.info = srcItem.info || srcItem.poznamka;
                        currentPlItems.set(srcItem.ean_produktu, currentData);
                        updatedCount++;
                    }
                }
            });
            renderTargetProducts();
            showStatus(`Aktualizované info pri ${updatedCount} produktoch.`);
        } else {
            showStatus('Tento cenník zatiaľ nemá žiadne položky. Najprv pridajte produkty.', true);
        }
    } catch(e) {
        console.error(e);
        showStatus('Chyba pri importe: ' + e.message, true);
    }
};

// === TLAČOVÁ FUNKCIA (ktorá predtým chýbala) ===
window.printPricelistPreview = async function(plId) {
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id:plId} } }]);
        const pl = data.pricelist;
        const items = data.items || []; 

        if(!state.productsAll || state.productsAll.length === 0) {
             const pData = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]);
             state.productsAll = pData.products || [];
        }

        let html = `
        <html>
        <head>
            <title>Cenník: ${escapeHtml(pl.nazov_cennika)}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
                h1 { text-align: center; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; }
                th { background-color: #eee; }
                .num { text-align: right; }
                .center { text-align: center; }
            </style>
        </head>
        <body>
            <h1>Cenník: ${escapeHtml(pl.nazov_cennika)}</h1>
            <p>Dátum tlače: ${new Date().toLocaleString('sk-SK')}</p>
            <table>
                <thead>
                    <tr>
                        <th style="width:30px;">#</th>
                        <th>EAN</th>
                        <th>Názov produktu</th>
                        <th class="num">Cena bez DPH</th>
                        <th class="center">DPH %</th>
                        <th class="num">Hodnota DPH</th>
                        <th class="num">Cena s DPH</th>
                    </tr>
                </thead>
                <tbody>
        `;

        items.forEach((item, index) => {
            const productInfo = state.productsAll.find(p => p.ean === item.ean_produktu) || { dph: 20 }; 
            const dphRate = Number(productInfo.dph);
            const priceNet = Number(item.cena);
            const vatAmount = priceNet * (dphRate / 100);
            const priceGross = priceNet + vatAmount;

            html += `
                <tr>
                    <td class="center">${index + 1}.</td>
                    <td>${item.ean_produktu}</td>
                    <td>${escapeHtml(item.nazov_vyrobku)}</td>
                    <td class="num">${priceNet.toFixed(2)} €</td>
                    <td class="center">${dphRate}%</td>
                    <td class="num">${vatAmount.toFixed(2)} €</td>
                    <td class="num"><b>${priceGross.toFixed(2)} €</b></td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            <script>window.print();</script>
        </body>
        </html>
        `;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();

    } catch(e) {
        alert("Chyba pri generovaní tlače: " + e.message);
    }
};

  // =================================================================
  // 6. REGISTRÁCIE & NASTAVENIA
  // =================================================================
  async function loadPendingRegistrations() {
    const box = ensureContainer('b2b-registrations-container');
    box.innerHTML = '<p>Načítavam...</p>';
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPendingB2BRegistrations' }]);
        const regs = (data && data.registrations) ? data.registrations : [];
        if (!regs.length) { box.innerHTML = '<div class="stat-card"><p class="muted">Žiadne čakajúce registrácie.</p></div>'; return; }
        let html = `<div class="table-container"><table class="table-refined"><thead><tr><th>Firma</th><th>Kontakt</th><th>Dátum</th><th>Zákaznícke číslo</th><th>Akcia</th></tr></thead><tbody>`;
        regs.forEach(r => {
            html += `<tr data-id="${r.id}"><td><strong>${escapeHtml(r.nazov_firmy)}</strong><br><small>${escapeHtml(r.adresa)}</small></td><td>${escapeHtml(r.email)}<br>${escapeHtml(r.telefon)}</td><td>${new Date(r.datum_registracie).toLocaleDateString('sk-SK')}</td><td><input type="text" class="filter-input" name="cid" placeholder="Zadajte ID" value="${r.zakaznik_id.startsWith('PENDING')?'':r.zakaznik_id}"></td><td><button class="btn btn-success btn-sm" data-act="ok">Schváliť</button> <button class="btn btn-danger btn-sm" data-act="no">Zamietnuť</button></td></tr>`;
        });
        html += '</tbody></table></div>';
        box.innerHTML = html;
        box.querySelectorAll('button[data-act]').forEach(btn => {
            btn.onclick = async (e) => {
                const tr = e.target.closest('tr'); const id = tr.dataset.id; const action = e.target.dataset.act;
                if (action === 'ok') {
                    const cid = tr.querySelector('input[name="cid"]').value;
                    if (!cid) return showStatus('Zadajte ID', true);
                    await callFirstOk([{ url: '/api/kancelaria/approveB2BRegistration', opts: { method: 'POST', body: { id, customer_id: cid } } }]);
                    showStatus('Schválené');
                } else {
                    if (!confirm('Zamietnuť?')) return;
                    await callFirstOk([{ url: '/api/kancelaria/rejectB2BRegistration', opts: { method: 'POST', body: { id } } }]);
                    showStatus('Zamietnuté');
                }
                loadPendingRegistrations();
            };
        });
    } catch (e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
  }

  async function loadB2BSettings() {
      const box = ensureContainer('b2b-settings-container');
      box.innerHTML = '<p>Načítavam...</p>';
      try {
          const s = await callFirstOk([{ url:'/api/kancelaria/b2b/getAnnouncement' }]);
          box.innerHTML = `<h4>Oznam pre zákazníkov (B2B Portál)</h4><textarea id="b2b-ann-txt" class="filter-input" style="width:100%;" rows="5">${escapeHtml(s.announcement)}</textarea><button id="save-ann-btn" class="btn btn-primary" style="margin-top:10px;">Uložiť oznam</button>`;
          doc.getElementById('save-ann-btn').onclick = async () => { await callFirstOk([{ url:'/api/kancelaria/b2b/saveAnnouncement', opts:{ method:'POST', body:{ announcement: doc.getElementById('b2b-ann-txt').value } } }]); showStatus('Oznam uložený'); };
      } catch(e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
  }
// =================================================================
// 360° KARTA ZÁKAZNÍKA
// =================================================================

window.showCustomer360 = async function(id) {
    openModal('<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam štatistiky a nákupy zákazníka...</div>');
    
    try {
        const res = await callFirstOk([{ url: '/api/kancelaria/b2b/customer_360', opts: { method: 'POST', body: { id: id } } }]);
        const c = res.customer;
        const s = res.summary;
        const products = res.products || [];

        // Globálne si uložíme dáta pre filter
        window.currentC360Products = products;

        // Farby pre celkovú maržu
        const sumMarginColor = s.margin_pct < 10 ? '#dc2626' : (s.margin_pct >= 20 ? '#16a34a' : '#d97706');

        let html = `
        <div style="width: 100%; max-width: 1200px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:15px; margin-bottom:20px;">
                <h2 style="margin:0; color:#1e293b;">🏢 ${escapeHtml(c.nazov_firmy)} <span style="font-size:0.8em; color:#64748b;">(ID: ${c.zakaznik_id})</span></h2>
                <button class="btn btn-secondary btn-sm" onclick="closeModal()">Zavrieť</button>
            </div>

            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:25px;">
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:15px; text-align:center;">
                    <div style="font-size:0.8rem; color:#64748b; font-weight:600; text-transform:uppercase;">Počet objednávok</div>
                    <div style="font-size:1.8rem; font-weight:bold; color:#0f172a; margin-top:5px;">${s.total_orders}</div>
                </div>
                <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:15px; text-align:center;">
                    <div style="font-size:0.8rem; color:#1e40af; font-weight:600; text-transform:uppercase;">Celková tržba (bez DPH)</div>
                    <div style="font-size:1.8rem; font-weight:bold; color:#1d4ed8; margin-top:5px;">${s.total_revenue.toFixed(2)} €</div>
                </div>
                <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:15px; text-align:center;">
                    <div style="font-size:0.8rem; color:#166534; font-weight:600; text-transform:uppercase;">Celkový zisk</div>
                    <div style="font-size:1.8rem; font-weight:bold; color:#15803d; margin-top:5px;">${s.total_profit.toFixed(2)} €</div>
                </div>
                <div style="background:#fff; border:1px solid ${sumMarginColor}; border-radius:8px; padding:15px; text-align:center;">
                    <div style="font-size:0.8rem; color:${sumMarginColor}; font-weight:600; text-transform:uppercase;">Celková marža</div>
                    <div style="font-size:1.8rem; font-weight:bold; color:${sumMarginColor}; margin-top:5px;">${s.margin_pct.toFixed(1)} %</div>
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0;">Najčastejšie odoberané produkty</h4>
                <input type="text" id="c360-search" class="filter-input" placeholder="Hľadať produkt (názov/EAN)..." style="width:250px;" oninput="window.filterC360Table()">
            </div>
            
            <div style="max-height: 450px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                <table class="table-refined" style="width:100%;">
                    <thead style="position: sticky; top: 0; background: #f8fafc; z-index: 10;">
                        <tr>
                            <th>Názov produktu</th>
                            <th style="text-align:right;">Odobraté</th>
                            <th style="text-align:right;">Nákup/Výroba (€/MJ)</th>
                            <th style="text-align:right;">Priem. Predajná (€/MJ)</th>
                            <th style="text-align:right;">Tržba (€)</th>
                            <th style="text-align:right;">Zisk (€)</th>
                            <th style="text-align:right;">Marža</th>
                        </tr>
                    </thead>
                    <tbody id="c360-table-body">
                        </tbody>
                </table>
            </div>
        </div>
        `;

        // Modálne okno musíme spraviť širšie pre tento konkrétny pohľad
        openModal(html);
        const modalContent = document.querySelector('.b2b-modal-content');
        if (modalContent) {
            modalContent.style.maxWidth = '1100px';
            modalContent.style.width = '95%';
        }
        
        window.filterC360Table(); // prvotné naplnenie tabuľky

    } catch(e) {
        openModal(`<div style="padding:20px; color:red; text-align:center;"><h2>Chyba</h2>${e.message}</div>`);
    }
};

window.filterC360Table = function() {
    const searchVal = (document.getElementById('c360-search').value || '').toLowerCase();
    const tbody = document.getElementById('c360-table-body');
    if (!tbody || !window.currentC360Products) return;

    let html = '';
    let count = 0;

    window.currentC360Products.forEach(p => {
        if (searchVal && !p.name.toLowerCase().includes(searchVal) && !p.ean.includes(searchVal)) return;

        // Formátovanie farieb podľa marže (červená pod 10%, zelená nad 20%)
        let marginColor = '#475569';
        if (p.margin < 10) marginColor = '#dc2626'; // strata alebo nízka marža
        else if (p.margin > 20) marginColor = '#16a34a'; // skvelá marža

        html += `
        <tr>
            <td>
                <div style="font-weight:600; color:#1e293b;">${escapeHtml(p.name)}</div>
                <div style="font-size:0.75rem; color:#64748b;">EAN: ${p.ean}</div>
            </td>
            <td style="text-align:right; font-weight:bold;">${p.qty} ${p.unit}</td>
            <td style="text-align:right; color:#64748b;">${p.unit_cost.toFixed(2)} €</td>
            <td style="text-align:right; color:#1d4ed8;">${p.avg_price.toFixed(2)} €</td>
            <td style="text-align:right;">${p.revenue.toFixed(2)} €</td>
            <td style="text-align:right; font-weight:bold; color:${p.profit < 0 ? '#dc2626' : '#15803d'};">${p.profit > 0 ? '+' : ''}${p.profit.toFixed(2)} €</td>
            <td style="text-align:right; font-weight:bold; color:${marginColor};">${p.margin.toFixed(1)} %</td>
        </tr>`;
        count++;
    });

    if (count === 0) {
        html = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">Nenašli sa žiadne produkty vyhovujúce filtru.</td></tr>`;
    }

    tbody.innerHTML = html;
};
  // EXPORT MODULU
  (function (g) { 
      g.initializeB2BAdminModule = initializeB2BAdminModule; 
      g.loadCommView = loadCommView; 
  })(typeof window !== 'undefined' ? window : this);

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);