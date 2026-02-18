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
                  html += `<tr>
                    <td>${o.cislo_objednavky}</td>
                    <td>${escapeHtml(o.nazov_firmy)}</td>
                    <td>${new Date(o.datum_objednavky).toLocaleString()}</td>
                    <td><strong>${o.pozadovany_datum_dodania || '-'}</strong></td>
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

  window.showDailySummary = async function() {
      const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const date = prompt("Zadajte dátum dodania (RRRR-MM-DD):", tomorrow);
      if(!date) return;
      try {
          const res = await callFirstOk([{ url: '/api/kancelaria/b2b/getDailySummary', opts: { method: 'POST', body: { date: date } } }]);
          const items = res.items || [];
          let html = `<h4>Sumarizácia tovaru na deň: ${date}</h4><table class="table-refined"><thead><tr><th>EAN</th><th>Názov</th><th>Množstvo</th></tr></thead><tbody>`;
          items.forEach(i => html += `<tr><td>${i.ean}</td><td>${escapeHtml(i.name)}</td><td style="font-weight:bold;">${i.qty} ${i.unit}</td></tr>`);
          html += `</tbody></table><div style="margin-top:15px;text-align:right;"><button class="btn btn-primary" onclick="window.print()">Tlačiť</button></div>`;
          openModal(html);
      } catch(e) { alert(e.message); }
  };

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

 // -----------------------------------------------------------------
// 4. ZÁKAZNÍCI & CENNÍKY (Upravené pre správu pobočiek)
// -----------------------------------------------------------------

async function loadCustomersAndPricelists() {
    const box = ensureContainer('b2b-customers-container');
    box.innerHTML = '<p>Načítavam...</p>';
    try {
        const data = await callFirstOk([{url:'/api/kancelaria/b2b/getCustomersAndPricelists'}]);
        state.customers = data.customers || []; 
        state.pricelists = data.pricelists || []; 
        state.mapping = data.mapping || {};
        
        const plMap = new Map(state.pricelists.map(p=>[p.id, p.nazov_cennika]));
        
        let html = `<div class="table-container"><table class="table-refined"><thead><tr><th>ID</th><th>Firma</th><th>Kontakt</th><th>Priradené cenníky</th><th>Akcia</th></tr></thead><tbody>`;
        
        state.customers.sort((a,b) => a.nazov_firmy.localeCompare(b.nazov_firmy));

        state.customers.forEach(c => {
            const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
            const assignedNames = assignedIds.map(id => plMap.get(Number(id)) || 'ID '+id).join(', ');
            
            // === NOVÉ: Detekcia pobočky ===
            const isBranch = c.parent_id ? true : false;
            const branchLabel = isBranch ? '<span style="color:#2563eb; font-size:0.8em; font-weight:bold; margin-left:5px;">(Pobočka)</span>' : '';
            // Jemné odsadenie pre pobočky
            const rowStyle = isBranch ? 'background-color: #f8fafc;' : '';
            const nameStyle = isBranch ? 'padding-left: 20px; border-left: 3px solid #cbd5e1;' : '';

            html += `<tr style="${rowStyle}">
                <td>${escapeHtml(c.zakaznik_id)}</td>
                <td style="${nameStyle}">
                    <strong>${escapeHtml(c.nazov_firmy)}</strong> ${branchLabel}
                    ${isBranch ? `<div style="font-size:0.75rem;color:#64748b;">Patrí pod ID: ${c.parent_id}</div>` : ''}
                </td>
                <td>${escapeHtml(c.email)}<br>${escapeHtml(c.telefon)}</td>
                <td>${assignedNames || '<span class="muted">Žiadne</span>'}</td>
                <td>
                    <button class="btn btn-primary btn-sm" onclick="window.editB2BCustomer(${c.id})">Upraviť</button>
                    
                    ${!isBranch ? `<button class="btn btn-warning btn-sm" style="margin-left:5px;" onclick="window.addB2BBranch(${c.id}, '${escapeHtml(c.nazov_firmy)}')">+ Pobočka</button>` : ''}
                    
                    <button class="btn btn-danger btn-sm" style="margin-left:5px;" onclick="window.deleteB2BCustomer(${c.id})">Zmazať</button>
                </td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        box.innerHTML = html;
    } catch(e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
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
// 5. CENNÍKY (MANAGEMENT)
// =================================================================

async function loadPricelistsForManagement() {
    const box = ensureContainer('b2b-pricelists-container');
    box.innerHTML = '<p>Načítavam cenníky...</p>';
    try {
        // Načítame dáta
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]);
        state.pricelists = data.pricelists || []; 
        state.productsAll = data.products || [];
        
        const cData = await callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }]);
        state.customers = cData.customers || [];
        
        let html = `
            <div style="display:flex; justify-content:flex-end; margin-bottom:15px;">
                 <button id="btn-create-pl" class="btn btn-success"><i class="fas fa-plus"></i> + Nový cenník</button>
            </div>
            <div class="stat-card">
                <table class="table-refined">
                    <thead>
                        <tr>
                            <th>Názov cenníka</th>
                            <th style="width:320px;text-align:right;">Akcia</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if(!state.pricelists.length) {
            html += `<tr><td colspan="2" style="text-align:center;padding:20px;">Zatiaľ žiadne cenníky.</td></tr>`;
        } else {
            state.pricelists.forEach(pl => {
                html += `<tr>
                    <td style="font-size:1.1rem; font-weight:500; vertical-align:middle;">${escapeHtml(pl.nazov_cennika)}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-secondary btn-sm" onclick="window.printPricelistPreview(${pl.id})">🖨️ Tlač/Náhľad</button>
                        <button class="btn btn-primary btn-sm" style="margin-left:5px;" onclick="window.showPricelistEditor(${pl.id})">✏️ Upraviť</button>
                        <button class="btn btn-danger btn-sm" style="margin-left:5px;" data-del-pl="${pl.id}" data-name="${escapeHtml(pl.nazov_cennika)}">🗑️</button>
                    </td>
                </tr>`;
            });
        }
        html += `</tbody></table></div>`; 
        box.innerHTML = html;
    
        // Tlačidlo Nový cenník
        doc.getElementById('btn-create-pl').onclick = () => window.showPricelistEditor(null);

        // LOGIKA MAZANIA S HESLOM "ZMAZAT"
        box.querySelectorAll('button[data-del-pl]').forEach(b => {
            b.onclick = async () => {
                const plName = b.dataset.name;
                const verification = prompt(`⚠️ POZOR: Chystáte sa vymazať cenník "${plName}".\n\nTáto akcia je nevratná.\nAk to naozaj chcete urobiť, napíšte veľkými písmenami slovo: ZMAZAT`);
                
                if (verification !== "ZMAZAT") {
                    alert("Mazanie bolo zrušené (nesprávne heslo).");
                    return;
                }

                try {
                    await callFirstOk([{ url: '/api/kancelaria/b2b/deletePricelist', opts: { method: 'POST', body: { id: b.dataset.delPl } } }]);
                    showStatus('Cenník bol úspešne vymazaný.', false);
                    loadPricelistsForManagement();
                } catch(e) { showStatus(e.message || String(e), true); }
            };
        });
    } catch(e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
}

// EDITOR V MODALE (Popup okno)
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

    // HTML pre Modal - ROZLOŽENIE GRID
    const modalHtml = `
      <div style="display:flex; flex-direction:column; height:85vh;">
          <h3 style="margin-top:0; color:#1e3a8a; border-bottom:1px solid #eee; padding-bottom:10px;">
              ${isEdit ? '✏️ Úprava cenníka' : '➕ Vytvorenie nového cenníka'}
          </h3>
          
          <div style="margin-bottom:15px; display:grid; grid-template-columns: 2fr 1fr; gap:15px;">
              <div class="form-group">
                  <label>Názov cenníka</label>
                  <input type="text" id="pl-name" class="filter-input" style="width:100%; font-size:1.1rem; font-weight:bold; border: 2px solid #3b82f6;" placeholder="Napr. Veľkoobchod 2026">
              </div>
              ${isEdit ? `
              <div class="form-group">
                  <label>Kopírovať popisy z iného cenníka</label>
                  <div style="display:flex; gap:5px;">
                      <select id="pl-source-copy" class="filter-input" style="flex:1;">${copyOptions}</select>
                      <button class="btn btn-secondary btn-sm" onclick="window.importInfoFromSelected()">Načítať</button>
                  </div>
              </div>` : ''}
          </div>

          ${!isEdit ? `<div class="form-group" style="margin-bottom:15px;"><label>Priradiť ihneď zákazníkom:</label><div class="cust-select-container" id="pl-new-cust-list" style="max-height:100px;">${customersHtml}</div></div>` : ''}
          
          ${isEdit ? `
          <div style="flex:1; display:grid; grid-template-columns: 1fr 1fr; gap:20px; overflow:hidden;">
              <div style="display:flex; flex-direction:column; border:1px solid #e2e8f0; border-radius:6px; background:#fff;">
                  <div style="background:#f1f5f9; padding:10px; font-weight:bold; border-bottom:1px solid #e2e8f0;">
                      📦 Katalóg produktov (Zdroj)
                  </div>
                  <div style="padding:5px;">
                      <input type="text" id="pl-prod-filter" class="filter-input" style="width:100%;" placeholder="🔍 Hľadať produkt...">
                  </div>
                  <div id="pl-source-list" class="cust-select-container" style="flex:1; overflow-y:auto; border:none;"></div>
              </div>

              <div style="display:flex; flex-direction:column; border:1px solid #86efac; border-radius:6px; background:#fff;">
                  <div style="background:#dcfce7; padding:10px; font-weight:bold; color:#14532d; border-bottom:1px solid #86efac;">
                      ✅ Položky v tomto cenníku
                  </div>
                  <div id="pl-target-list" class="cust-select-container" style="flex:1; overflow-y:auto; border:none; background:#f0fdf4;"></div>
              </div>
          </div>` : ''}
          
          <div style="margin-top:15px; padding-top:10px; border-top:1px solid #eee; text-align:right;">
              <button class="btn btn-secondary" onclick="closeModal()" style="margin-right:10px;">Zrušiť</button>
              <button id="pl-save-btn" class="btn btn-success" style="padding: 10px 30px; font-size:1.1rem;">💾 Uložiť cenník</button>
          </div>
      </div>`;
    
    // Otvoríme modal
    openModal(modalHtml);

    if (isEdit) {
        const pl = state.pricelists.find(p => p.id == plId);
        if(pl) doc.getElementById('pl-name').value = pl.nazov_cennika;
        
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

function renderTargetProducts() {
    const container = doc.getElementById('pl-target-list');
    if (!container) return;

    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
        <thead style="background:#dcfce7; position:sticky; top:0;">
            <tr>
                <th style="text-align:left; padding:5px;">Produkt v cenníku</th>
                <th style="width:80px;">Cena (€)</th>
                <th style="width:30px;"></th>
            </tr>
        </thead>
        <tbody>`;

    currentPlItems.forEach((data, ean) => {
        const p = state.productsAll.find(x => x.ean === ean) || { nazov_vyrobku: 'Neznámy produkt (vymazaný?)' };
        const priceVal = (typeof data === 'object') ? data.price : data;
        const infoVal = (typeof data === 'object') ? (data.info || '') : '';

        html += `
        <tr class="pl-item-row" data-ean="${ean}" style="border-bottom:1px solid #bbf7d0; background:#fff;">
            <td style="padding:6px;">
                <div style="font-weight:600;">${escapeHtml(p.nazov_vyrobku)}</div>
                <div style="font-size:0.75em; color:#666;">${ean}</div>
                <input type="text" class="info-edit-input" value="${escapeHtml(infoVal)}" placeholder="Poznámka / Info pre klienta..." style="width:100%; margin-top:4px; border:1px solid #ddd; padding:2px; font-size:0.8em; color:#444;">
            </td>
            <td style="padding:6px; vertical-align:top;">
                <input type="number" class="price-edit-input" value="${priceVal}" style="width:100%; padding:4px; border:1px solid #aaa; border-radius:4px; font-weight:bold;" step="0.01">
            </td>
            <td style="padding:6px; text-align:center; vertical-align:top;">
                <button class="btn btn-danger btn-sm" onclick="window.plRem('${ean}')" style="padding:2px 6px;">&times;</button>
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    
    if (currentPlItems.size === 0) html = '<div style="padding:20px; text-align:center; color:#15803d;">Cenník je zatiaľ prázdny.<br>Pridajte produkty zľava.</div>';
    
    container.innerHTML = html;
}

window.plRem = (ean) => { 
    currentPlItems.delete(ean); 
    const filterEl = doc.getElementById('pl-prod-filter');
    renderSourceProducts(filterEl ? filterEl.value : ''); 
    renderTargetProducts(); 
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

  // EXPORT MODULU
  (function (g) { 
      g.initializeB2BAdminModule = initializeB2BAdminModule; 
      g.loadCommView = loadCommView; 
  })(typeof window !== 'undefined' ? window : this);

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);