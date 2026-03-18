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
    routes: [], // NOVÉ: Dynamické trasy pre logistiku
    routeTemplates: [], // Ponechané pre istotu, ak by si to niekedy potreboval
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
 // Pomocná funkcia na vyvolanie systémovej Windows/Mac notifikácie
  function showSystemNotification(title, body) {
      if (!("Notification" in window)) return; // Ak to prehliadač náhodou nepodporuje
      
      if (Notification.permission === "granted") {
          // Zobrazenie samotnej notifikácie
          new Notification(title, { body: body });
      } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then(permission => {
              if (permission === "granted") {
                  new Notification(title, { body: body });
              }
          });
      }
  }

  // Vylepšené Background Polling s pamäťou stavu pre notifikácie
  function startBackgroundPolling() {
      // Ihneď pri spustení skúsime požiadať o povolenie na notifikácie
      if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
          Notification.requestPermission();
      }

      // Premenné na zapamätanie si posledného známeho počtu (-1 znamená prvý štart)
      let lastRegsCount = -1;
      let lastMsgsCount = -1;

      const check = async () => {
          try {
              // 1. Kontrola čakajúcich registrácií
              const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPendingB2BRegistrations' }]);
              const regs = (data && data.registrations) ? data.registrations.length : 0;
              const badge = doc.getElementById('badge-regs');
              if (badge) { badge.textContent = regs; badge.style.display = regs > 0 ? 'inline-flex' : 'none'; }
              
              // Ak sme už bežali a číslo sa ZVÝŠILO, vyhodíme notifikáciu
              if (lastRegsCount !== -1 && regs > lastRegsCount) {
                  showSystemNotification("B2B Portál: Nová registrácia", "Máte novú žiadosť o registráciu na schválenie.");
              }
              lastRegsCount = regs;
              
              // 2. Kontrola neprečítaných správ
              const r = await callFirstOk([{ url: '/api/kancelaria/b2b/messages/unread' }]);
              const msgs = Number((r && r.unread) || 0);
              const badgeMsg = doc.getElementById('badge-msgs');
              if (badgeMsg) { badgeMsg.textContent = msgs; badgeMsg.style.display = msgs > 0 ? 'inline-flex' : 'none'; }
              
              // Ak sme už bežali a číslo správ sa ZVÝŠILO, vyhodíme notifikáciu
              if (lastMsgsCount !== -1 && msgs > lastMsgsCount) {
                  showSystemNotification("B2B Portál: Nová správa", "Prišla nová neprečítaná správa od zákazníka.");
              }
              lastMsgsCount = msgs;

          } catch(e) {
              console.error("Chyba background pollingu:", e);
          }
      };
      
      check();
      setInterval(check, 30000); // Kontrola každých 30 sekúnd
  }
 // =================================================================
  // 1. OBJEDNÁVKY + DENNÝ SUMÁR
  // =================================================================
  async function loadB2BOrdersView() {
      const box = ensureContainer('b2b-orders-container');
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
        <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
            <div class="filter-group">
                <label>Filtrovať podľa</label>
                <select id="ord-date-type" class="filter-input" style="font-weight:bold; color:#0f172a;">
                    <option value="created">Dátumu prijatia</option>
                    <option value="delivery" selected>Dátumu dodania (Expedícia)</option>
                </select>
            </div>
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
          
          const typeVal = doc.getElementById('ord-date-type').value;
          const fDate = doc.getElementById('ord-from').value;
          let tDate = doc.getElementById('ord-to').value;
          
          const dObj = new Date(tDate); dObj.setDate(dObj.getDate() + 1);
          const tDateSent = dObj.toISOString().slice(0,10);
          
          try {
              const res = await callFirstOk([{ 
                  url: '/api/kancelaria/b2b/getAllOrders', 
                  opts: { 
                      method: 'POST', 
                      body: { 
                          from_date: fDate, 
                          to_date: tDateSent, 
                          customer: doc.getElementById('ord-cust').value,
                          date_type: typeVal
                      } 
                  } 
              }]);
              
              const orders = res.orders || [];
              if(!orders.length) { area.innerHTML = '<p>Žiadne objednávky.</p>'; return; }
              
              let html = `<table class="table-refined"><thead><tr><th>Číslo</th><th>Zákazník</th><th>Vytvorená</th><th>Dodanie</th><th>Suma</th><th>Stav</th><th>Akcia</th></tr></thead><tbody>`;
              orders.forEach(o => {
                  const statusColor = o.stav === 'Prijatá' ? '#eab308' : (o.stav === 'Hotová' ? '#22c55e' : '#94a3b8');
                  
                  let formatDodania = o.pozadovany_datum_dodania || '-';
                  if (formatDodania !== '-') {
                      const d = new Date(formatDodania);
                      if (!isNaN(d.getTime())) {
                          const strDate = d.toLocaleDateString('sk-SK', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
                          formatDodania = strDate.charAt(0).toUpperCase() + strDate.slice(1);
                      }
                  }

                  let formatVytvorenia = '-';
                  if (o.datum_objednavky) {
                      let d = new Date(o.datum_objednavky);
                      if (!isNaN(d.getTime())) {
                          // Eliminácia nežiaduceho posunu: ak backend pošle GMT, 
                          // prehliadač nesmie pridať lokálny hodinový offset.
                          if (typeof o.datum_objednavky === 'string' && o.datum_objednavky.includes('GMT')) {
                              d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
                          }
                          formatVytvorenia = d.toLocaleString('sk-SK');
                      }
                  }

                  // OPRAVA TU: Formátovanie názvu firmy s číslom prevádzky (odstránenie prípadnej duplicity)
                  let zobrazenyNazov = escapeHtml(o.nazov_firmy);
                  if (o.cislo_prevadzky) {
                      let cistyNazov = o.nazov_firmy.replace(new RegExp('^' + o.cislo_prevadzky + '\\s*-?\\s*'), '');
                      zobrazenyNazov = `<strong>[${escapeHtml(o.cislo_prevadzky)}]</strong> ${escapeHtml(cistyNazov)}`;
                  }

                  html += `<tr>
                    <td>${o.cislo_objednavky}</td>
                    <td>${zobrazenyNazov}</td>
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
      doc.getElementById('ord-date-type').onchange = loadOrders; 
      
      loadOrders();
  }

  window.showDailySummary = function() {
      const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const filterTo = document.getElementById('ord-to');
      const selectedDate = filterTo && filterTo.value ? filterTo.value : tomorrow;
      
      const html = `
          <div style="padding: 5px;">
              <h3 style="margin-top:0; color:#1e293b; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">
                  📋 Sumár produktov na expedíciu
              </h3>
              <div style="display:flex; gap:10px; margin-bottom:15px; align-items:center;">
                  <label><strong>Deň dodania:</strong></label>
                  <input type="date" id="summary-date" class="filter-input" value="${selectedDate}">
                  <button class="btn btn-primary" onclick="window.fetchDailySummary()">Načítať dátum</button>
                  <button class="btn btn-secondary" onclick="window.printDailySummary()" style="margin-left:auto;">🖨️ Tlačiť list</button>
              </div>
              <div id="summary-results" style="max-height: 60vh; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px;">
                  <div style="padding: 20px; text-align: center; color: #64748b;">Kliknite na "Načítať" pre zobrazenie sumáru.</div>
              </div>
          </div>
      `;
      openModal(html);
      window.fetchDailySummary();
  };

  window.fetchDailySummary = async function() {
      const dateVal = document.getElementById('summary-date').value;
      const resContainer = document.getElementById('summary-results');
      resContainer.innerHTML = '<div style="padding:30px; text-align:center; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><br>Pripravujem sumár...</div>';
      try {
          const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getDailySummary', opts: { method: 'POST', body: { date: dateVal } } }]);
          const items = data.items || [];
          if (!items.length) {
              resContainer.innerHTML = `<div style="padding:20px; text-align:center; color:#dc2626; font-weight:bold;">Na deň ${dateVal.split('-').reverse().join('.')} nie sú objednané žiadne produkty.</div>`;
              return;
          }
          let table = `<table class="table-refined" style="width:100%;"><thead style="position:sticky; top:0; background:#f8fafc; box-shadow:0 1px 2px rgba(0,0,0,0.1);"><tr><th style="width:60%;">Názov produktu</th><th style="text-align:right; width:20%;">Množstvo</th><th style="width:20%;">Jednotka</th></tr></thead><tbody>`;
          items.forEach(it => {
              table += `<tr><td><div style="font-weight:600; color:#0f172a;">${escapeHtml(it.name)}</div><div style="font-size:0.75rem; color:#64748b;">EAN: ${escapeHtml(it.ean)}</div></td><td style="text-align:right; font-size:1.1rem; font-weight:bold; color:#1d4ed8;">${it.qty}</td><td style="color:#475569;">${escapeHtml(it.unit)}</td></tr>`;
          });
          table += `</tbody></table>`;
          resContainer.innerHTML = table;
      } catch (e) {
          resContainer.innerHTML = `<div style="padding:20px; color:#dc2626; font-weight:bold;">Chyba: ${escapeHtml(e.message)}</div>`;
      }
  };

  window.printDailySummary = function() {
      const dateVal = document.getElementById('summary-date').value;
      const content = document.getElementById('summary-results').innerHTML;
      const formattedDate = dateVal.split('-').reverse().join('.');
      const win = window.open('', '_blank');
      win.document.write(`<html><head><title>Sumár expedície B2B - ${formattedDate}</title><style>body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; } h2 { text-align: center; margin-bottom: 5px; } p.subtitle { text-align: center; color: #555; margin-top: 0; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #000; padding: 8px 12px; text-align: left; } th { background-color: #f4f4f4; } td[style*="text-align:right"] { text-align: right; font-weight: bold; }</style></head><body><h2>Sumár produktov na B2B expedíciu</h2><p class="subtitle"><strong>Dátum dodania:</strong> ${formattedDate} | <strong>Vytlačené:</strong> ${new Date().toLocaleString('sk-SK')}</p>${content}<script>window.print();</script></body></html>`);
      win.document.close();
  };
// Globálna premenná pre ukladanie výskytu EAN kódov
let globalEanUsageMap = new Map();

// Funkcia na vybudovanie mapy (zavolajte ju pri štarte úpravy cenníka)
// Funkcia na vybudovanie mapy (využíva výhradne existujúce endpointy)
async function buildEanUsageMap(currentPricelistId = null) {
    globalEanUsageMap.clear();
    try {
        // 1. Zabezpečenie zoznamu cenníkov
        if (!state.pricelists || state.pricelists.length === 0) {
            const plData = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]);
            state.pricelists = plData.pricelists || [];
        }
        
        // 2. Postupné stiahnutie položiek pre každý cenník
        for (const pl of state.pricelists) {
            if (currentPricelistId && pl.id == currentPricelistId) continue; 
            
            try {
                const detailData = await callFirstOk([{ 
                    url: '/api/kancelaria/b2b/getPricelistDetails', 
                    opts: { method:'POST', body:{id: pl.id} } 
                }]);

                const items = detailData.items || [];
                items.forEach(item => {
                    const ean = item.ean_produktu;
                    if (!ean) return;
                    if (!globalEanUsageMap.has(ean)) {
                        globalEanUsageMap.set(ean, []);
                    }
                    if (!globalEanUsageMap.get(ean).includes(pl.nazov_cennika)) {
                        globalEanUsageMap.get(ean).push(pl.nazov_cennika);
                    }
                });
            } catch (errDetail) {
                console.error(`Chyba pri sťahovaní cenníka ID ${pl.id}:`, errDetail);
            }
        }
    } catch (e) {
        console.error("Zlyhalo načítanie EAN mapy:", e);
    }
}
// =================================================================
  // 2. LOGISTIKA & TRASY (S PREPOJENÍM NA FLEET)
  // =================================================================
  async function loadLogisticsView() {
    const box = ensureContainer('b2b-logistics-container');
    const today = new Date().toISOString().slice(0, 10);
    
    box.innerHTML = `
        <div style="display:flex; align-items:center; gap:15px;">
                <h4 style="margin:0; color:#1e293b;">🚛 Plánovanie rozvozu</h4>
                <button class="btn btn-secondary btn-sm" onclick="window.manageManualRoutes()">📝 Manuálne šablóny</button>
                <button class="btn btn-primary btn-sm" onclick="window.manageStores()">🏢 Adresár prevádzok</button>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                    <label style="font-weight:bold;">Deň rozvozu (Dodania):</label>
                    <input type="date" id="logistics-date" class="filter-input" value="${today}">
                    <button id="logistics-load-btn" class="btn btn-primary"><i class="fas fa-sync"></i> Načítať trasy</button>
                </div>
            </div>
        </div>
        <div id="logistics-content">
            <p class="muted">Kliknite na "Načítať trasy" pre zobrazenie zoznamu.</p>
        </div>
    `;

    document.getElementById('logistics-load-btn').onclick = async () => {
        const date = document.getElementById('logistics-date').value;
        const content = document.getElementById('logistics-content');
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Sťahujem dáta...</div>';

        try {
            // 1. Stiahneme trasy (pôvodný link)
            const res = await callFirstOk([{ url: `/api/logistics/v2/routes-data?date=${date}` }]);
            const trasy = res.trasy || [];
            
            // 2. NEZÁVISLÉ STIAHNUTIE ÁUT (Toto obíde všetky predchádzajúce problémy)
            let vehicles = [];
            try {
                const vRes = await callFirstOk([{ url: '/api/fleet/active-vehicles' }]);
                vehicles = vRes.vehicles || [];
            } catch(ve) {
                console.error("Nepodarilo sa načítať autá:", ve);
            }

            if (trasy.length === 0) {
                content.innerHTML = '<div style="padding:20px;text-align:center;font-weight:bold;color:#dc2626;">Na tento deň nie sú naplánované žiadne objednávky pre rozvoz.</div>';
                return;
            }

            let html = '';
            trasy.forEach(t => {
                html += `
                <div class="card" style="margin-bottom: 25px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                    <div class="card-header" style="background:#f1f5f9; display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #0284c7;">
                        <h3 style="margin:0; color:#0f172a;">🚛 ${escapeHtml(t.nazov)}</h3>
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-warning btn-sm" style="color:#000; font-weight:bold;" onclick='window.printChecklist(${JSON.stringify(t).replace(/'/g, "&apos;")}, "${date}")'>📝 Nakládkový list</button>
                            <button class="btn btn-secondary btn-sm" style="background:#1e293b; color:#fff; border:none;" onclick='window.printSummary(${JSON.stringify(t).replace(/'/g, "&apos;")}, "${date}")'>📦 Súhrn do auta</button>
                        </div>
                    </div>
                    <div class="card-body" style="display:flex; gap:20px; flex-wrap:wrap;">
                        
                        <div style="flex:1; min-width:400px;">
                            <h5 style="border-bottom:1px solid #e2e8f0; padding-bottom:8px; margin-top:0; color:#475569;">Poradie zastávok (Vykládka)</h5>
                            <table class="table-refined" style="font-size:0.85rem;">
                                <thead>
                                    <tr>
                                        <th style="width:60px; text-align:center;">Poradie</th>
                                        <th>Odberateľ a Adresa</th>
                                        <th>Objednávky</th>
                                        <th style="text-align:center;">Uložiť</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${t.zastavky.map((z) => `
                                        <tr>
                                            <td style="text-align:center;">
                                                <input type="number" value="${z.poradie}" class="filter-input" style="width:60px; text-align:center; font-weight:bold;" id="poradie_${z.zakaznik_id}">
                                            </td>
                                            <td>
                                                <strong style="font-size:1rem; color:#0f172a;">${escapeHtml(z.odberatel)}</strong><br>
                                                <small style="color:#64748b;">${escapeHtml(z.adresa)}</small>
                                            </td>
                                            <td>
                                                <span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:bold;">${z.pocet_objednavok} obj.</span><br>
                                                <small style="color:#94a3b8;">${z.cisla_objednavok.join(', ')}</small>
                                            </td>
                                            <td style="text-align:center;">
                                                <button class="btn btn-primary btn-sm" onclick="window.saveRouteOrder(${z.zakaznik_id})">💾</button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            
                            <div style="margin-top: 15px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; display:flex; gap:10px; align-items:center;">
                                <label style="font-weight:bold; color:#166534; margin:0;"><i class="fas fa-car"></i> Založiť knihu jázd:</label>
                                <select id="veh_${t.trasa_id}" class="filter-input" style="flex:1;">
                                    <option value="">-- Vyberte auto z Fleet modulu --</option>
                                    ${vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})</option>`).join('')}
                                </select>
                                <button class="btn btn-success btn-sm" onclick="window.assignVehicleToFleet('${escapeHtml(t.nazov)}', '${t.trasa_id}')">Založiť jazdu šoférovi</button>
                            </div>
                        </div>
                        
                        <div style="width:350px; background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0;">
                            <h5 style="border-bottom:1px solid #cbd5e1; padding-bottom:8px; margin-top:0; color:#475569;">Čo naložiť do auta</h5>
                            ${t.sumar.map(s => `
                                <div style="margin-bottom:12px;">
                                    <strong style="color:#0369a1; display:block; border-bottom:1px dashed #cbd5e1; padding-bottom:3px;">${escapeHtml(s.kategoria)}</strong>
                                    <ul style="margin:5px 0 0 0; padding-left:0; list-style:none; font-size:0.85rem;">
                                        ${s.polozky.map(p => `
                                            <li style="display:flex; justify-content:space-between; padding:3px 0;">
                                                <span>${escapeHtml(p.produkt)}</span>
                                                <b style="color:#1e293b;">${p.mnozstvo} ${p.mj}</b>
                                            </li>
                                        `).join('')}
                                    </ul>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                `;
            });
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = `<div class="alert alert-danger" style="padding:20px; font-weight:bold;">Kritická chyba: ${e.message}</div>`;
        }
    };
    
    document.getElementById('logistics-load-btn').click();
  }

  // Funkcia na prepojenie s FLEET Modulom
  window.assignVehicleToFleet = async function(routeName, routeId) {
      const date = document.getElementById('logistics-date').value;
      const vehicleId = document.getElementById(`veh_${routeId}`).value;

      if(!vehicleId) return showStatus("Najprv vyberte auto z rolovacieho zoznamu.", true);

      try {
          const res = await callFirstOk([{
              url: '/api/leader/logistics/assign-vehicle',
              opts: { method: 'POST', body: { date: date, route_name: routeName, vehicle_id: vehicleId } }
          }]);
          showStatus(res.message);
      } catch(e) {
          alert("Chyba: " + e.message);
      }
  };
  // Tlač - Nakládkový List (Checklist)
  window.printChecklist = function(routeObj, dateStr) {
      const dateFormatted = dateStr.split('-').reverse().join('.');
      let html = `
      <html><head><title>Nakládkový list - ${routeObj.nazov}</title>
      <style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; }
          h1 { text-align: center; margin-bottom: 5px; text-transform: uppercase; }
          h3 { text-align: center; margin-top: 0; color: #555; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #000; padding: 12px 10px; text-align: left; vertical-align: middle; }
          th { background-color: #f1f5f9; font-size: 13px; }
          .checkbox-col { width: 70px; text-align: center; }
          .box { display: inline-block; width: 20px; height: 20px; border: 2px solid #000; }
          @media print { body { margin: 0; padding: 10px; } }
      </style>
      </head><body>
          <h1>Kontrolný a Nakládkový list </h1>
          <h3>TRASA: ${escapeHtml(routeObj.nazov)} | DÁTUM: ${dateFormatted} | ŠOFÉR: __________________</h3>
          <table>
              <thead>
                  <tr>
                      <th style="width:40px; text-align:center;">Por.</th>
                      <th>Odberateľ a Adresa dodania</th>
                      <th>Detail objednávok</th>
                      <th style="width: 80px; text-align: center;">Počet E2</th>
                      <th class="checkbox-col">Prichystal (Sklad)</th>
                      <th class="checkbox-col">Naložil (Šofér)</th>
                      <th style="width: 220px;">Poznámka / Chýba (Doložiť)</th>
                  </tr>
              </thead>
              <tbody>
      `;
      routeObj.zastavky.forEach((z, idx) => {
          html += `
              <tr>
                  <td style="text-align:center; font-size:16px;"><strong>${idx + 1}.</strong></td>
                  <td><strong style="font-size:16px;">${escapeHtml(z.odberatel)}</strong><br><span style="color:#555; font-size:12px;">${escapeHtml(z.adresa)}</span></td>
                  <td style="font-size:12px;">
                      <strong>${z.pocet_objednavok} obj.</strong><br>
                      ${z.cisla_objednavok.join('<br>')}
                  </td>
                  <td style="text-align:center; font-size:16px; color:#aaa;"><strong>_____ ks</strong></td>
                  <td class="checkbox-col"><div class="box"></div></td>
                  <td class="checkbox-col"><div class="box"></div></td>
                  <td></td>
              </tr>
          `;
      });
      html += `</tbody></table>
      <div style="margin-top: 30px; display: flex; justify-content: space-between; font-weight:bold;">
          <div>Podpis pripravil (Expedícia): _______________________</div>
          <div>Podpis prebral/naložil (Šofér): _______________________</div>
      </div>
      <script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
  };

  // Tlač - Slepý list (Sumár)
  window.printSummary = function(routeObj, dateStr) {
      const dateFormatted = dateStr.split('-').reverse().join('.');
      let html = `
      <html><head><title>Slepý list - ${routeObj.nazov}</title>
      <style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; }
          h1 { text-align: center; margin-bottom: 5px; text-transform: uppercase; }
          h3 { text-align: center; margin-top: 0; color: #555; }
          .category-title { background: #e2e8f0; padding: 8px 12px; margin-top: 20px; font-weight: bold; border: 1px solid #000; border-bottom: none; font-size:16px;}
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #000; padding: 8px 12px; text-align: left; }
          td.num { text-align: right; font-weight: bold; width: 120px; font-size:16px;}
          @media print { body { margin: 0; padding: 10px; } }
      </style>
      </head><body>
          <h1>Slepý list (Súhrn na naloženie)</h1>
          <h3>TRASA: ${escapeHtml(routeObj.nazov)} | DÁTUM: ${dateFormatted}</h3>
      `;
      routeObj.sumar.forEach(s => {
          html += `<div class="category-title">${escapeHtml(s.kategoria)}</div>`;
          html += `<table><tbody>`;
          s.polozky.forEach(p => {
              const val = parseFloat(p.mnozstvo);
              const displayVal = Number.isInteger(val) ? val : val.toFixed(2);
              html += `<tr>
                  <td>${escapeHtml(p.produkt)}</td>
                  <td class="num">${displayVal} ${p.mj}</td>
              </tr>`;
          });
          html += `</tbody></table>`;
      });
      html += `<script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
  };

  // Uloženie poradia zastávky
  window.saveRouteOrder = async function(custId) {
      const poradie = document.getElementById(`poradie_${custId}`).value;
      try {
          await callFirstOk([{ 
              url: '/api/kancelaria/b2b/updateCustomerRouteOrder', 
              opts: { method: 'POST', body: { zakaznik_id: custId, poradie: poradie } } 
          }]);
          showStatus('Poradie bolo úspešne uložené.');
          document.getElementById('logistics-load-btn').click();
      } catch(e) {
          alert('Chyba: ' + e.message);
      }
  };

// =================================================================
  // 2.A MANUÁLNE ŠABLÓNY TRÁS (Rozvozové listy mimo ERP)
  // =================================================================

  window.manageManualRoutes = async function() {
      openModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam šablóny...</div>');
      try {
          const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getRouteTemplates' }]);
          state.routeTemplates = data.templates || [];

          let listHtml = `<table class="table-refined"><thead><tr><th>Názov šablóny</th><th>Počet zastávok</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if (state.routeTemplates.length === 0) {
              listHtml += `<tr><td colspan="3" style="text-align:center; color:#666; padding:20px;">Zatiaľ nemáte žiadne manuálne šablóny.</td></tr>`;
          } else {
              state.routeTemplates.forEach(t => {
                  const stopsCount = Array.isArray(t.stops) ? t.stops.length : 0;
                  listHtml += `<tr>
                      <td><strong style="color:#0f172a; font-size:1.05rem;">${escapeHtml(t.name)}</strong></td>
                      <td><span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:12px; font-weight:bold; font-size:0.85rem;">${stopsCount} prevádzok</span></td>
                      <td style="text-align:right;">
                          <button class="btn btn-success btn-sm" onclick="window.showPrintManualRoute(${t.id})" title="Pripraviť na tlač">🖨️ Tlačiť</button>
                          <button class="btn btn-primary btn-sm" onclick="window.showManualRouteEditor(${t.id})" style="margin-left:5px;">✏️ Upraviť</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteManualRouteTemplate(${t.id}, '${escapeHtml(t.name)}')" style="margin-left:5px;">🗑️</button>
                      </td>
                  </tr>`;
              });
          }
          listHtml += `</tbody></table>`;

          let html = `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                  <h3 style="margin:0; color:#1e293b;">📝 Manuálne šablóny trás</h3>
                  <button class="btn btn-success" onclick="window.showManualRouteEditor(null)">+ Nová šablóna</button>
              </div>
              <div style="background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; color:#475569; border:1px solid #e2e8f0;">
                  ℹ️ Tu si môžete vytvoriť pevné rozvozové zoznamy pre zákazníkov, ktorí nechodia cez B2B e-shop (napríklad COOP Jednota, školy). Pred samotnou tlačou si jednoducho odkliknete prevádzky, ktoré daný deň tovar neberú.
              </div>
              <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                ${listHtml}
              </div>
              <div style="text-align:right; margin-top:20px;">
                  <button class="btn btn-secondary" onclick="closeModal()">Zavrieť</button>
              </div>
          `;
          openModal(html);
      } catch(e) {
          openModal(`<div style="padding:20px; color:red; font-weight:bold;">Chyba: ${escapeHtml(e.message)}</div>`);
      }
  };

  // =================================================================
  // 1. ADRESÁR PREVÁDZOK
  // =================================================================
  window.manageStores = async function() {
      openModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam adresár...</div>');
      try {
          const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getStores' }]);
          state.stores = data.stores || [];

          let listHtml = `<table class="table-refined"><thead><tr><th>Názov prevádzky</th><th>Poznámka / Adresa</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if (state.stores.length === 0) {
              listHtml += `<tr><td colspan="3" style="text-align:center; color:#666; padding:20px;">Zatiaľ nemáte žiadne manuálne prevádzky. Vytvorte prvú.</td></tr>`;
          } else {
              state.stores.forEach(s => {
                  listHtml += `<tr>
                      <td><strong style="color:#0f172a;">${escapeHtml(s.name)}</strong></td>
                      <td><span style="color:#64748b;">${escapeHtml(s.note || '-')}</span></td>
                      <td style="text-align:right;">
                          <button class="btn btn-primary btn-sm" onclick="window.showStoreEditor(${s.id})">✏️ Upraviť</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteStore(${s.id}, '${escapeHtml(s.name)}')" style="margin-left:5px;">🗑️</button>
                      </td>
                  </tr>`;
              });
          }
          listHtml += `</tbody></table>`;

          let html = `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                  <h3 style="margin:0; color:#1e293b;">🏢 Adresár manuálnych prevádzok</h3>
                  <button class="btn btn-success" onclick="window.showStoreEditor(null)">+ Nová prevádzka</button>
              </div>
              <div style="background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; color:#475569; border:1px solid #e2e8f0;">
                  ℹ️ Tu si definujete špecifické miesta vykládky, ktoré nemajú účet v B2B e-shope (napríklad školy, jednoty, atď.). Odtiaľto ich budete môcť vkladať do trás.
              </div>
              <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                ${listHtml}
              </div>
              <div style="text-align:right; margin-top:20px;">
                  <button class="btn btn-secondary" onclick="closeModal()">Zavrieť</button>
              </div>
          `;
          openModal(html);
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.showStoreEditor = async function(id) {
      let store = { id: null, name: '', note: '' };
      if (id && state.stores) {
          const found = state.stores.find(s => s.id === id);
          if (found) store = found;
      }

      let html = `
          <h3 style="margin-top:0; color:#1e3a8a;">${id ? '✏️ Úprava prevádzky' : '➕ Vytvorenie prevádzky'}</h3>
          <div class="form-group">
              <label style="font-weight:bold;">Názov prevádzky <span style="color:red">*</span></label>
              <input type="text" id="store-name" class="filter-input" style="width:100%; font-size:1.1rem; font-weight:bold;" value="${escapeHtml(store.name)}" placeholder="Napr. COOP Jednota Vlčany">
          </div>
          <div class="form-group">
              <label>Poznámka pre šoféra / Adresa (Zobrazí sa na papieri)</label>
              <input type="text" id="store-note" class="filter-input" style="width:100%;" value="${escapeHtml(store.note)}" placeholder="Napr. Zvoniť pri rampe vzadu">
          </div>
          <div style="margin-top:20px; text-align:right;">
              <button class="btn btn-secondary" onclick="window.manageStores()" style="margin-right:10px;">Späť</button>
              <button class="btn btn-success" onclick="window.saveStore(${id || 'null'})">💾 Uložiť</button>
          </div>
      `;
      openModal(html);
  };

  window.saveStore = async function(id) {
      const name = document.getElementById('store-name').value.trim();
      const note = document.getElementById('store-note').value.trim();
      if (!name) return showStatus("Názov prevádzky je povinný!", true);

      try {
          await callFirstOk([{
              url: '/api/kancelaria/b2b/saveStore',
              opts: { method: 'POST', body: { id: id, name: name, note: note, b2b_customer_id: null } }
          }]);
          showStatus("Prevádzka bola uložená.");
          window.manageStores();
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.deleteStore = async function(id, name) {
      if (!confirm(`Naozaj chcete vymazať prevádzku "${name}" z adresára?`)) return;
      try {
          await callFirstOk([{ url: '/api/kancelaria/b2b/deleteStore', opts: { method: 'POST', body: { id: id } } }]);
          showStatus("Prevádzka bola vymazaná.");
          window.manageStores();
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  // =================================================================
  // 2. MANUÁLNE ŠABLÓNY TRÁS (Zoznam, Úprava, Mazanie)
  // =================================================================
  window.manageManualRoutes = async function() {
      openModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam šablóny...</div>');
      try {
          const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getRouteTemplates' }]);
          state.routeTemplates = data.templates || [];

          let listHtml = `<table class="table-refined"><thead><tr><th>Názov šablóny</th><th>Počet zastávok</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if (state.routeTemplates.length === 0) {
              listHtml += `<tr><td colspan="3" style="text-align:center; color:#666; padding:20px;">Zatiaľ nemáte žiadne manuálne šablóny.</td></tr>`;
          } else {
              state.routeTemplates.forEach(t => {
                  const stopsCount = Array.isArray(t.stops) ? t.stops.length : 0;
                  listHtml += `<tr>
                      <td><strong style="color:#0f172a; font-size:1.05rem;">${escapeHtml(t.name)}</strong></td>
                      <td><span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:12px; font-weight:bold; font-size:0.85rem;">${stopsCount} prevádzok</span></td>
                      <td style="text-align:right;">
                          <button class="btn btn-success btn-sm" onclick="window.showPrintManualRoute(${t.id})" title="Pripraviť na tlač">🖨️ Tlačiť</button>
                          <button class="btn btn-primary btn-sm" onclick="window.showManualRouteEditor(${t.id})" style="margin-left:5px;">✏️ Upraviť</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteManualRouteTemplate(${t.id}, '${escapeHtml(t.name)}')" style="margin-left:5px;">🗑️</button>
                      </td>
                  </tr>`;
              });
          }
          listHtml += `</tbody></table>`;

          let html = `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                  <h3 style="margin:0; color:#1e293b;">📝 Manuálne šablóny trás</h3>
                  <button class="btn btn-success" onclick="window.showManualRouteEditor(null)">+ Nová šablóna</button>
              </div>
              <div style="background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; color:#475569; border:1px solid #e2e8f0;">
                  ℹ️ Tu si môžete vytvoriť pevné rozvozové zoznamy pre zákazníkov, ktorí nechodia cez B2B e-shop (napríklad COOP Jednota, školy). Pred samotnou tlačou si jednoducho odkliknete prevádzky, ktoré daný deň tovar neberú.
              </div>
              <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                ${listHtml}
              </div>
              <div style="text-align:right; margin-top:20px;">
                  <button class="btn btn-secondary" onclick="closeModal()">Zavrieť</button>
              </div>
          `;
          openModal(html);
      } catch(e) {
          openModal(`<div style="padding:20px; color:red; font-weight:bold;">Chyba: ${escapeHtml(e.message)}</div>`);
      }
  };

  // Pomocná funkcia pre Live vyhľadávanie v pravom paneli (bez serverového volania)
  window.filterAvailableStores = function(query) {
      const q = (query || '').toLowerCase();
      const items = document.querySelectorAll('.tpl-store-item');
      items.forEach(item => {
          const text = item.getAttribute('data-search');
          if (text.includes(q)) {
              item.style.display = 'flex';
          } else {
              item.style.display = 'none';
          }
      });
  };

  // Vykreslenie zastávky v ľavom paneli (s tlačidlami na zmenu poradia)
  window.renderStopRow = function(name, note, storeId) {
      const container = document.getElementById('tpl-stops-container');
      const row = document.createElement('div');
      row.className = 'tpl-stop-row';
      row.dataset.storeId = storeId || '';
      row.dataset.name = name || '';
      row.style.cssText = "display:flex; align-items:center; gap:10px; background:#fff; padding:10px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:5px;";

      row.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:2px;">
              <button type="button" class="btn btn-sm btn-light p-1" onclick="if(this.closest('.tpl-stop-row').previousElementSibling) this.closest('.tpl-stop-row').parentNode.insertBefore(this.closest('.tpl-stop-row'), this.closest('.tpl-stop-row').previousElementSibling)" title="Hore">⬆️</button>
              <button type="button" class="btn btn-sm btn-light p-1" onclick="if(this.closest('.tpl-stop-row').nextElementSibling) this.closest('.tpl-stop-row').parentNode.insertBefore(this.closest('.tpl-stop-row').nextElementSibling, this.closest('.tpl-stop-row'))" title="Dole">⬇️</button>
          </div>
          <div style="flex:1;">
              <div style="font-weight:bold; color:#1e293b; font-size:1.05rem;">${escapeHtml(name)}</div>
              <input type="text" class="stop-note-input" value="${escapeHtml(note || '')}" placeholder="Poznámka alebo adresa pre šoféra" style="width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:4px; font-size:0.85rem; margin-top:4px; background:#f8fafc;">
          </div>
          <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('.tpl-stop-row').remove()" title="Odstrániť zo šablóny">✖</button>
      `;
      container.appendChild(row);
      container.scrollTop = container.scrollHeight;
  };

  // Reakcia po kliknutí na "Pridať" v pravom zozname
  window.addStoreFromPanel = function(btn) {
      window.renderStopRow(btn.dataset.name, btn.dataset.note, btn.dataset.id);
      
      // Vizuálna odozva po kliknutí
      const origText = btn.innerHTML;
      btn.innerHTML = '✔️ Pridané';
      btn.style.backgroundColor = '#dcfce7';
      btn.style.borderColor = '#22c55e';
      setTimeout(() => {
          btn.innerHTML = origText;
          btn.style.backgroundColor = '';
          btn.style.borderColor = '';
      }, 700);
  };

  // Manuálne vloženie vlastnej prevádzky (mimo systému)
  window.addCustomStorePanel = function() {
      const input = document.getElementById('tpl-custom-stop');
      const val = input.value.trim();
      if (!val) return;
      window.renderStopRow(val, '', '');
      input.value = '';
  };

  window.showManualRouteEditor = async function(id) {
      let template = { id: null, name: '', stops: [] };
      if (id) {
          const found = state.routeTemplates.find(t => t.id === id);
          if (found) template = found;
      }

      openModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam zoznam zákazníkov a adresár pre trasy...</div>');

      try {
          const sData = await callFirstOk([{ url: '/api/kancelaria/b2b/getStores' }]);
          state.stores = sData.stores || [];
      } catch(e) { state.stores = []; }

      try {
          const cData = await callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }]);
          state.customers = cData.customers || [];
      } catch(e) { state.customers = []; }

      let availableStoresHtml = '';
      
      // Generovanie B2B COOP zákazníkov do pravého panela
      if (state.customers && state.customers.length > 0) {
          state.customers.forEach(c => {
              const addr = c.adresa_dorucenia || c.adresa || '';
              const searchStr = (c.nazov_firmy + ' ' + addr + ' ' + (c.zakaznik_id || '')).toLowerCase();
              availableStoresHtml += `
                  <div class="tpl-store-item" data-search="${escapeHtml(searchStr)}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0; background:#fff; margin-bottom:2px; border-radius:4px;">
                      <div>
                          <strong style="color:#1e3a8a; font-size:0.95rem;">${escapeHtml(c.nazov_firmy)}</strong> 
                          <span style="font-size:0.7rem; background:#bfdbfe; color:#1e3a8a; padding:2px 5px; border-radius:4px; margin-left:5px;">COOP/B2B</span><br>
                          <small style="color:#64748b;">${escapeHtml(addr)}</small>
                      </div>
                      <button class="btn btn-sm btn-outline-success" style="font-weight:bold; min-width:85px;" data-id="b2b_${c.id}" data-name="${escapeHtml(c.nazov_firmy)}" data-note="${escapeHtml(addr)}" onclick="window.addStoreFromPanel(this)"><i class="fas fa-plus"></i> Pridať</button>
                  </div>
              `;
          });
      }

      // Generovanie manuálnych prevádzok do pravého panela
      if (state.stores && state.stores.length > 0) {
          state.stores.forEach(s => {
              const searchStr = (s.name + ' ' + (s.note || '')).toLowerCase();
              availableStoresHtml += `
                  <div class="tpl-store-item" data-search="${escapeHtml(searchStr)}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0; background:#f8fafc; margin-bottom:2px; border-radius:4px;">
                      <div>
                          <strong style="color:#0f172a; font-size:0.95rem;">${escapeHtml(s.name)}</strong> 
                          <span style="font-size:0.7rem; background:#e2e8f0; color:#334155; padding:2px 5px; border-radius:4px; margin-left:5px;">Manuálna</span><br>
                          <small style="color:#64748b;">${escapeHtml(s.note || 'Bez adresy')}</small>
                      </div>
                      <button class="btn btn-sm btn-outline-success" style="font-weight:bold; min-width:85px;" data-id="man_${s.id}" data-name="${escapeHtml(s.name)}" data-note="${escapeHtml(s.note || '')}" onclick="window.addStoreFromPanel(this)"><i class="fas fa-plus"></i> Pridať</button>
                  </div>
              `;
          });
      }

      let html = `
          <style>
              /* Dynamické zväčšenie modálneho okna len pre tento editor (prebije pôvodných 800px) */
              .b2b-modal-content { max-width: 1400px !important; width: 95% !important; height: 90vh !important; display: flex !important; flex-direction: column !important; }
          </style>
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; flex-shrink: 0;">
              <h3 style="margin:0; color:#1e3a8a;">${id ? '✏️ Úprava rozvozovej trasy' : '➕ Vytvorenie novej rozvozovej trasy'}</h3>
          </div>
          
          <div style="display:flex; gap:20px; align-items:flex-start; flex: 1; min-height: 0;">
              
              <div style="flex: 1; background:#f1f5f9; padding:20px; border-radius:8px; border:1px solid #cbd5e1; display:flex; flex-direction:column; height: 100%;">
                  <div class="form-group" style="margin-bottom:15px; flex-shrink: 0;">
                      <label style="font-weight:bold; color:#0f172a; font-size:1.1rem; margin-bottom:5px; display:block;">Názov rozvozovej trasy</label>
                      <input type="text" id="tpl-name" class="filter-input" style="width:100%; font-size:1.2rem; font-weight:bold; border:2px solid #3b82f6; border-radius:6px; padding:10px;" value="${escapeHtml(template.name)}" placeholder="Zadajte názov trasy...">
                  </div>
                  
                  <h4 style="color:#334155; margin-bottom:10px; font-size:1rem; border-bottom:1px solid #cbd5e1; padding-bottom:5px; flex-shrink: 0;">Zoznam zastávok (Vľavo/Vpravo presúva poradie):</h4>
                  <div id="tpl-stops-container" style="flex:1; overflow-y:auto; border:1px solid #94a3b8; border-radius:6px; padding:10px; background:#e2e8f0; display:flex; flex-direction:column; gap:5px;">
                  </div>
                  
                  <div style="margin-top:15px; display:flex; gap:10px; flex-shrink: 0;">
                      <button class="btn btn-secondary" style="padding:12px; min-width:120px;" onclick="window.manageManualRoutes()">Zrušiť</button>
                      <button class="btn btn-success" style="flex:1; padding:12px; font-weight:bold; font-size:1.1rem;" onclick="window.saveManualRouteTemplate(${id || 'null'})"><i class="fas fa-save"></i> Uložiť trasu</button>
                  </div>
              </div>

              <div style="flex: 1; background:#fff; padding:20px; border-radius:8px; border:1px solid #cbd5e1; display:flex; flex-direction:column; height: 100%;">
                  <h4 style="color:#0f172a; margin-top:0; margin-bottom:15px; font-size:1.1rem; flex-shrink: 0;">🔍 Pridať zastávky do trasy</h4>
                  
                  <div style="margin-bottom:15px; flex-shrink: 0;">
                      <input type="text" oninput="window.filterAvailableStores(this.value)" class="filter-input" style="width:100%; font-size:1rem; padding:10px; border:1px solid #94a3b8; border-radius:6px;" placeholder="Hľadať COOP predajne, mestá, ID...">
                  </div>

                  <div style="display:flex; gap:10px; margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #e2e8f0; flex-shrink: 0;">
                      <input type="text" id="tpl-custom-stop" class="filter-input" style="flex:1; padding:8px; border-radius:4px; border:1px solid #cbd5e1;" placeholder="Pridať vlastný názov (napr. Sklad)">
                      <button class="btn btn-primary" onclick="window.addCustomStorePanel()">Pridať ➕</button>
                  </div>
                  
                  <div id="tpl-available-stores" style="flex:1; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:5px;">
                      ${availableStoresHtml}
                  </div>
              </div>
          </div>
      `;
      openModal(html);
     

      // Vyrenderujeme už uložené zastávky, ak trasu iba editujeme
      if (template.stops && template.stops.length > 0) {
          template.stops.forEach(s => window.renderStopRow(s.name, s.note, s.store_id || ''));
      }
  };

  window.saveManualRouteTemplate = async function(id) {
      const nameInput = document.getElementById('tpl-name');
      if (!nameInput) return;
      
      const name = nameInput.value.trim();
      if (!name) return showStatus("Názov šablóny nesmie byť prázdny!", true);

      const stops = [];
      document.querySelectorAll('.tpl-stop-row').forEach(row => {
          const noteInput = row.querySelector('.stop-note-input');
          const rowName = row.dataset.name || 'Neznáma prevádzka';
          stops.push({ 
              store_id: row.dataset.storeId || '', 
              name: rowName, 
              note: noteInput ? noteInput.value.trim() : '' 
          });
      });

      if (stops.length === 0) return showStatus("Šablóna musí obsahovať aspoň jednu prevádzku / zákazníka.", true);

      try {
          await callFirstOk([{ 
              url: '/api/kancelaria/b2b/saveRouteTemplate', 
              opts: { method: 'POST', body: { id: id, name: name, stops: stops } } 
          }]);
          showStatus("Šablóna bola úspešne uložená.");
          window.manageManualRoutes(); 
      } catch(e) { showStatus("Chyba pri ukladaní: " + e.message, true); }
  };

  window.deleteManualRouteTemplate = async function(id, name) {
      if (!confirm(`Naozaj chcete natrvalo vymazať šablónu:\n"${name}"?`)) return;
      try {
          await callFirstOk([{ 
              url: '/api/kancelaria/b2b/deleteRouteTemplate', 
              opts: { method: 'POST', body: { id: id } } 
          }]);
          showStatus("Šablóna bola zmazaná.");
          window.manageManualRoutes(); 
      } catch(e) { showStatus("Chyba pri mazaní: " + e.message, true); }
  };

  // =================================================================
  // 3. TLAČ MANUÁLNYCH TRÁS + FLEET MODUL
  // =================================================================
  window.showPrintManualRoute = async function(id) {
      const template = state.routeTemplates.find(t => t.id === id);
      if (!template) return;

      let vehicles = [];
      try {
          const vRes = await callFirstOk([{ url: '/api/fleet/active-vehicles' }]);
          vehicles = vRes.vehicles || [];
      } catch(ve) {
          console.error("Nepodarilo sa načítať autá:", ve);
      }

      let stopsHtml = '';
      template.stops.forEach((s, idx) => {
          stopsHtml += `
              <label style="display:flex; align-items:flex-start; padding:12px 15px; border-bottom:1px solid #e2e8f0; cursor:pointer; background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}; transition: opacity 0.2s, background 0.2s;" class="print-row-label">
                  <div style="padding-top:3px;">
                      <input type="checkbox" class="print-stop-cb" value="${idx}" checked style="transform:scale(1.3); margin:0 15px 0 5px; cursor:pointer;">
                  </div>
                  <div style="width: 40px; font-weight:bold; color:#64748b; font-size:1.05rem; padding-top:1px;">
                      ${idx + 1}.
                  </div>
                  <div style="flex:1;">
                      <div style="font-weight:bold; color:#0f172a; font-size:1.05rem;">${escapeHtml(s.name)}</div>
                      ${s.note ? `<div style="font-size:0.85rem; color:#64748b; margin-top:4px;">📝 ${escapeHtml(s.note)}</div>` : ''}
                  </div>
                  <div style="width: 80px; text-align:right; font-weight:bold; font-size:0.85rem; padding-top:4px; color:#10b981;" class="status-badge">
                      Zahrnuté
                  </div>
              </label>
          `;
      });

      const today = new Date().toISOString().slice(0, 10);

      let html = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0; color:#1e293b;">🖨️ Príprava tlače: <span style="color:#0ea5e9;">${escapeHtml(template.name)}</span></h3>
          </div>
          
          <div style="margin-bottom: 20px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
              <h4 style="margin:0 0 10px 0; color:#166534;"><i class="fas fa-car"></i> Založiť knihu jázd (Fleet modul)</h4>
              <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                  <label style="font-weight:bold; color:#166534; font-size:0.9rem;">Dátum rozvozu:</label>
                  <input type="date" id="manual-route-date" class="filter-input" value="${today}" style="width:140px;">
                  
                  <select id="manual-veh-select" class="filter-input" style="flex:1; min-width:200px;">
                      <option value="">-- Vyberte auto z Fleet modulu --</option>
                      ${vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})</option>`).join('')}
                  </select>
                  
                  <button class="btn btn-success btn-sm" onclick="window.assignManualVehicle('${escapeHtml(template.name)}')">Založiť jazdu</button>
              </div>
          </div>
          
          <div style="background:#eff6ff; border-left:4px solid #3b82f6; color:#1e3a8a; padding:12px 15px; margin-bottom:20px; font-size:0.95rem; border-radius:0 6px 6px 0;">
              Odškrtnite prevádzky, do ktorých sa dnes <b>nevezme tovar</b>. Na papieri sa následne zoznam automaticky prečísluje.
          </div>
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding:0 5px;">
              <span style="font-weight:bold; color:#475569;">Zoznam prevádzok v šablóne:</span>
              <div>
                  <button class="btn btn-secondary btn-sm" onclick="document.querySelectorAll('.print-stop-cb').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change')); })">Označiť všetko</button>
                  <button class="btn btn-secondary btn-sm" onclick="document.querySelectorAll('.print-stop-cb').forEach(cb => { cb.checked = false; cb.dispatchEvent(new Event('change')); })" style="margin-left:5px;">Zrušiť všetko</button>
              </div>
          </div>

          <div style="border:1px solid #cbd5e1; border-radius:8px; max-height:40vh; overflow-y:auto; margin-bottom:20px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">
              ${stopsHtml}
          </div>

          <div style="text-align:right; display:flex; justify-content:flex-end; gap:15px; border-top:1px solid #e2e8f0; padding-top:20px;">
              <button class="btn btn-secondary" onclick="window.manageManualRoutes()">← Späť na zoznam</button>
              <button class="btn btn-primary" style="padding:10px 30px; font-size:1.1rem; font-weight:bold; box-shadow: 0 4px 6px rgba(14, 165, 233, 0.3);" onclick="window.executePrintManualRoute(${id})">
                  🖨️ Pokračovať na tlač
              </button>
          </div>
      `;
      
      openModal(html);

      setTimeout(() => {
          document.querySelectorAll('.print-stop-cb').forEach(cb => {
              cb.addEventListener('change', function() {
                  const label = this.closest('.print-row-label');
                  const badge = label.querySelector('.status-badge');
                  if (this.checked) {
                      badge.textContent = 'Zahrnuté';
                      badge.style.color = '#10b981';
                      label.style.opacity = '1';
                  } else {
                      badge.textContent = 'Vynechané';
                      badge.style.color = '#ef4444';
                      label.style.opacity = '0.5';
                  }
              });
          });
      }, 100);
  };

  window.assignManualVehicle = async function(routeName) {
      const dateVal = document.getElementById('manual-route-date').value;
      const vehicleId = document.getElementById('manual-veh-select').value;

      if(!vehicleId) return showStatus("Najprv vyberte auto z rolovacieho zoznamu.", true);

      try {
          const res = await callFirstOk([{
              url: '/api/leader/logistics/assign-vehicle',
              opts: { method: 'POST', body: { date: dateVal, route_name: routeName, vehicle_id: vehicleId } }
          }]);
          showStatus(res.message);
      } catch(e) {
          alert("Chyba: " + e.message);
      }
  };

  window.executePrintManualRoute = async function(id) {
      const template = state.routeTemplates.find(t => t.id === id);
      if (!template) return;

      const activeStops = [];
      document.querySelectorAll('.print-stop-cb:checked').forEach(cb => {
          const idx = parseInt(cb.value);
          if (template.stops[idx]) {
              activeStops.push(template.stops[idx]);
          }
      });

      if (activeStops.length === 0) return showStatus("Musíte nechať zaškrtnutú aspoň jednu prevádzku na tlač.", true);

      try {
          const response = await fetch('/api/kancelaria/b2b/printManualRoute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  name: template.name,
                  stops: activeStops
              })
          });

          if (!response.ok) throw new Error("Backend nevrátil správnu odpoveď.");
          
          const htmlStr = await response.text();
          const printWindow = window.open('', '_blank', 'width=900,height=800');
          printWindow.document.write(htmlStr);
          printWindow.document.close();
          
          closeModal();
      } catch(e) {
          showStatus("Chyba pri príprave tlače: " + e.message, true);
      }
  };

  window.executePrintManualRoute = async function(id) {
      const template = state.routeTemplates.find(t => t.id === id);
      if (!template) return;

      // Pozbierame len tie objekty, ktoré nechal užívateľ zaškrtnuté
      const activeStops = [];
      document.querySelectorAll('.print-stop-cb:checked').forEach(cb => {
          const idx = parseInt(cb.value);
          if (template.stops[idx]) {
              activeStops.push(template.stops[idx]);
          }
      });

      if (activeStops.length === 0) return showStatus("Musíte nechať zaškrtnutú aspoň jednu prevádzku na tlač.", true);

      try {
          // Pošleme to na nový Python endpoint, ktorý vyrobí HTML s tabuľkou
          const response = await fetch('/api/kancelaria/b2b/printManualRoute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  name: template.name,
                  stops: activeStops
              })
          });

          if (!response.ok) throw new Error("Backend nevrátil správnu odpoveď.");
          
          const htmlStr = await response.text();
          
          // Otvorí sa nové okno a vpíše sa do neho výsledné HTML s tabuľkou
          const printWindow = window.open('', '_blank', 'width=900,height=800');
          printWindow.document.write(htmlStr);
          printWindow.document.close();
          
          // Akonáhle sa otvorí okno tlače, modal s výberom zavrieme
          closeModal();
      } catch(e) {
          showStatus("Chyba pri príprave tlače: " + e.message, true);
      }
  };
  // =================================================================
  // 3. KOMUNIKÁCIA
  // =================================================================
  async function loadCommView() {
      const box = ensureContainer('b2b-comm-container');
      box.innerHTML = '<div style="padding:40px;text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
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
        const data = await callFirstOk([{url:'/api/kancelaria/b2b/getCustomersAndPricelists'}]);
        state.customers = data.customers || []; 
        state.pricelists = data.pricelists || []; 
        state.routes = data.routes || []; // Dynamické trasy
        state.mapping = data.mapping || {};
        
        const plMap = new Map(state.pricelists.map(p=>[p.id, p.nazov_cennika]));

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

        let currentPage = 1;
        const itemsPerPage = 10;

        const renderTable = () => {
            const searchText = doc.getElementById('cust-search-text').value.toLowerCase();
            const plFilter = doc.getElementById('cust-filter-pricelist').value;
            const typeFilter = doc.getElementById('cust-filter-type').value;

            const filtered = state.customers.filter(c => {
                const textMatch = 
                    c.nazov_firmy.toLowerCase().includes(searchText) || 
                    (c.zakaznik_id || '').toLowerCase().includes(searchText) ||
                    (c.email || '').toLowerCase().includes(searchText);
                if (searchText && !textMatch) return false;

                if (plFilter) {
                    const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
                    if (!assignedIds.map(String).includes(String(plFilter))) return false;
                }

                const isBranch = !!c.parent_id;
                if (typeFilter === 'main' && isBranch) return false;
                if (typeFilter === 'branch' && !isBranch) return false;

                return true;
            });

            filtered.sort((a,b) => a.nazov_firmy.localeCompare(b.nazov_firmy));

            const totalPages = Math.ceil(filtered.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = 1;
            const start = (currentPage - 1) * itemsPerPage;
            const paginated = filtered.slice(start, start + itemsPerPage);

            let tableHtml = `
            <div class="stat-card" style="padding:0; overflow:hidden; border:1px solid #e2e8f0;">
                <table class="table-refined">
                    <thead>
                        <tr>
                            <th style="width:100px;">ERP ID</th>
                            <th>Firma / Pobočka</th>
                            <th>Kontakt & Adresa</th>
                            <th>Trasa / Cenníky</th>
                            <th style="width:260px; text-align:right;">Akcia</th>
                        </tr>
                    </thead>
                    <tbody>`;

            if (paginated.length === 0) {
                tableHtml += `<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;">Žiadni zákazníci nevyhovujú filtru.</td></tr>`;
            } else {
                paginated.forEach(c => {
                    const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
                    
                    let plBadges = '';
                    if (assignedIds.length > 0) {
                        plBadges = assignedIds.map(id => {
                            const name = plMap.get(Number(id)) || 'ID '+id;
                            return `<span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:3px;">${escapeHtml(name)}</span>`;
                        }).join('');
                    } else {
                        plBadges = `<span style="color:#94a3b8; font-size:0.8rem;">Žiadne cenníky</span>`;
                    }

                    const routeName = c.trasa_id ? (state.routes.find(r => r.id == c.trasa_id)?.nazov || 'Neznáma trasa') : 'Bez trasy';
                    const routeBadge = `<div style="margin-bottom:5px;"><span style="background:#f1f5f9; color:#0f172a; padding:2px 6px; border-radius:4px; font-size:0.75rem; border:1px solid #cbd5e1;">🚛 ${escapeHtml(routeName)} (Poradie: ${c.trasa_poradie || '-'})</span></div>`;

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
                        <td>${routeBadge}${plBadges}</td>
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
            tableHtml += `<div style="text-align:right; font-size:0.8rem; color:#64748b; margin-top:8px;">Zobrazené ${paginated.length} z ${filtered.length} zákazníkov</div>`;

            doc.getElementById('cust-table-wrapper').innerHTML = tableHtml;

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

        window.changeCustPage = (pageNum) => { if (pageNum >= 1) { currentPage = pageNum; renderTable(); } };
        doc.getElementById('cust-search-text').addEventListener('input', () => { currentPage=1; renderTable(); });
        doc.getElementById('cust-filter-pricelist').addEventListener('change', () => { currentPage=1; renderTable(); });
        doc.getElementById('cust-filter-type').addEventListener('change', () => { currentPage=1; renderTable(); });
        
        doc.getElementById('cust-reset-filter').addEventListener('click', () => {
            doc.getElementById('cust-search-text').value = '';
            doc.getElementById('cust-filter-pricelist').value = '';
            doc.getElementById('cust-filter-type').value = 'all';
            currentPage = 1; renderTable();
        });

        renderTable();

    } catch(e) { 
        console.error(e);
        box.innerHTML = `<p class="error">Chyba pri načítaní: ${e.message}</p>`; 
    }
}

window.editB2BCustomer = function(id) {
    const cust = state.customers.find(c => c.id === id);
    if(!cust) return;
    
    const assignedIds = state.mapping[cust.zakaznik_id] || state.mapping[cust.id] || [];
    let plHtml = '';
    
    state.pricelists.forEach(p => {
        const checked = assignedIds.includes(p.id) ? 'checked' : '';
        plHtml += `<label style="display:block; margin-bottom:5px; padding:5px; background:#f9fafb; border-radius:4px;"><input type="checkbox" class="pl-check" value="${p.id}" ${checked}> ${escapeHtml(p.nazov_cennika)}</label>`;
    });

    let routesHtml = '<option value="">-- Bez trasy --</option>';
    state.routes.forEach(r => {
        const sel = (r.id == cust.trasa_id) ? 'selected' : '';
        routesHtml += `<option value="${r.id}" ${sel}>${escapeHtml(r.nazov)}</option>`;
    });
    const poradieVal = cust.trasa_poradie || 999;
    
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
          <div style="max-height:150px; overflow-y:auto; border:1px solid #ddd; padding:10px; border-radius:4px;">${plHtml}</div>
          
          <h4 style="margin-top:20px;">Logistika a Trasa</h4>
          <div class="form-group">
            <label>Priradená trasa (rozvoz)</label>
            <select id="ced-trasa" class="filter-input" style="width:100%;">${routesHtml}</select>
          </div>
          <div class="form-group">
            <label>Predvolené poradie vykládky</label>
            <input type="number" id="ced-poradie" value="${poradieVal}" class="filter-input" style="width:100%;">
          </div>

          <h4 style="margin-top:20px;">Iné</h4>
          <label><input type="checkbox" id="ced-active" ${cust.je_schvaleny ? 'checked' : ''}> Účet je aktívny</label>
      </div>
    </div>
    <div style="margin-top:20px; text-align:right;"><button class="btn btn-success" onclick="window.saveB2BCustomer(${cust.id})">Uložiť zmeny</button></div>`);
};

window.saveB2BCustomer = async function(id) {
    const trasaEl = document.getElementById('ced-trasa');
    const poradieEl = document.getElementById('ced-poradie');
    
    const trasaVal = trasaEl && trasaEl.value ? parseInt(trasaEl.value) : null;
    const poradieVal = poradieEl && poradieEl.value ? parseInt(poradieEl.value) : 999;

    const payload = {
        id: id, 
        nazov_firmy: document.getElementById('ced-name').value, 
        email: document.getElementById('ced-email').value, 
        telefon: document.getElementById('ced-phone').value, 
        adresa: document.getElementById('ced-addr').value,
        adresa_dorucenia: document.getElementById('ced-del-addr').value,
        je_schvaleny: document.getElementById('ced-active').checked ? 1 : 0, 
        trasa_id: trasaVal,
        trasa_poradie: poradieVal,
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
    const confirmWord = prompt(`UPOZORNENIE: Chystáte sa natrvalo zmazať zákazníka:\n"${cust.nazov_firmy}"\n\nAk ste si istí, napíšte slovo ZMAZAT:`);
    if (confirmWord !== "ZMAZAT") { showStatus("Mazanie zrušené.", true); return; }

    try {
        const res = await callFirstOk([{ url: '/api/kancelaria/b2b/deleteCustomer', opts: { method: 'POST', body: { id: id } } }]);
        showStatus(res.message || 'Zákazník bol zmazaný.');
        loadCustomersAndPricelists();
    } catch(e) { alert("Chyba pri mazaní: " + e.message); }
};

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
    if(!data.branch_name || !data.branch_code) return showStatus('Vyplňte názov a zákaznícke číslo.', true);
    
    try {
        await callFirstOk([{ url: '/api/kancelaria/b2b/createBranch', opts: { method: 'POST', body: data } }]);
        showStatus('Pobočka úspešne vytvorená.');
        closeModal();
        loadCustomersAndPricelists(); 
    } catch(e) { alert("Chyba: " + e.message); }
};

window.showCustomer360 = async function(id) {
    openModal('<div style="padding:40px; text-align:center; color:#666;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam štatistiky a nákupy zákazníka...</div>');
    try {
        // Prvotné načítanie za všetky obdobia (time_filter: 'all')
        const res = await callFirstOk([{ url: '/api/kancelaria/b2b/customer_360', opts: { method: 'POST', body: { id: id, time_filter: 'all' } } }]);
        const c = res.customer;
        const s = res.summary;
        const products = res.products || [];
        window.currentC360Products = products;
        const sumMarginColor = s.margin_pct < 10 ? '#dc2626' : (s.margin_pct >= 20 ? '#16a34a' : '#d97706');

        let html = `
        <div style="width: 100%; max-width: 1200px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:15px; margin-bottom:20px;">
                <h2 style="margin:0; color:#1e293b;">🏢 ${escapeHtml(c.nazov_firmy)} <span style="font-size:0.8em; color:#64748b;">(ID: ${c.zakaznik_id})</span></h2>
                <div style="display:flex; gap:15px; align-items:center;">
                    <select id="c360-time-filter" class="filter-input" onchange="window.updateCustomer360Data(${id})" style="font-weight:bold; color:#0369a1; background:#e0f2fe; border-color:#bae6fd;">
                        <option value="all" selected>Za celý čas</option>
                        <option value="year">Tento rok</option>
                        <option value="month">Tento mesiac</option>
                        <option value="week">Tento týždeň</option>
                        <option value="day">Dnes</option>
                    </select>
                    <button class="btn btn-secondary btn-sm" onclick="closeModal()">Zavrieť</button>
                </div>
            </div>
            
            <div id="c360-stats-container" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:15px; margin-bottom:25px;">
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
                    <tbody id="c360-table-body"></tbody>
                </table>
            </div>
        </div>
        `;
        openModal(html);
        const modalContent = document.querySelector('.b2b-modal-content');
        if (modalContent) { modalContent.style.maxWidth = '1100px'; modalContent.style.width = '95%'; }
        window.filterC360Table();
    } catch(e) { openModal(`<div style="padding:20px; color:red; text-align:center;"><h2>Chyba</h2>${e.message}</div>`); }
};

// Funkcia na prekreslenie iba štatistík a dát podľa filtračného Selectu
window.updateCustomer360Data = async function(id) {
    const timeFilter = document.getElementById('c360-time-filter').value;
    const tbody = document.getElementById('c360-table-body');
    const statsContainer = document.getElementById('c360-stats-container');
    
    // Zobrazenie načítavania
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Prepočítavam...</td></tr>';
    statsContainer.style.opacity = '0.5';

    try {
        const res = await callFirstOk([{ 
            url: '/api/kancelaria/b2b/customer_360', 
            opts: { method: 'POST', body: { id: id, time_filter: timeFilter } } 
        }]);
        
        const s = res.summary;
        window.currentC360Products = res.products || [];
        
        const sumMarginColor = s.margin_pct < 10 ? '#dc2626' : (s.margin_pct >= 20 ? '#16a34a' : '#d97706');
        
        // Dynamické nahradenie boxov štatistiky
        statsContainer.innerHTML = `
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
        `;
        statsContainer.style.opacity = '1';

        // Vygenerovanie tabuľky pre nové dáta
        window.filterC360Table();

    } catch(e) { 
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#dc2626; font-weight:bold;">Chyba: ${escapeHtml(e.message)}</td></tr>`;
        statsContainer.style.opacity = '1';
    }
};

window.filterC360Table = function() {
    const searchVal = (document.getElementById('c360-search').value || '').toLowerCase();
    const tbody = document.getElementById('c360-table-body');
    if (!tbody || !window.currentC360Products) return;

    let html = ''; let count = 0;
    window.currentC360Products.forEach(p => {
        if (searchVal && !p.name.toLowerCase().includes(searchVal) && !p.ean.includes(searchVal)) return;
        let marginColor = '#475569';
        if (p.margin < 10) marginColor = '#dc2626'; else if (p.margin > 20) marginColor = '#16a34a';
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
    
    // Zobrazenie špecifickej chybovej hlášky ak nie sú dáta vo zvolenom období
    if (count === 0) {
        html = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">Vo zvolenom období sa nenašli žiadne položky.</td></tr>`;
    }
    tbody.innerHTML = html;
};
// =================================================================
// 5. CENNÍKY (MANAGEMENT)
// =================================================================

async function loadPricelistsForManagement() {
    const box = ensureContainer('b2b-pricelists-container');
    box.innerHTML = '<div style="text-align:center;padding:40px;color:#666;"><i class="fas fa-spinner fa-spin"></i> Načítavam zoznamy a priradenia...</div>';
    try {
        const [plData, custData] = await Promise.all([
            callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]),
            callFirstOk([{ url: '/api/kancelaria/b2b/getCustomersAndPricelists' }])
        ]);

        state.pricelists = plData.pricelists || []; 
        state.productsAll = plData.products || [];
        state.customers = custData.customers || [];
        state.mapping = custData.mapping || {}; 

        const pricelistUsage = {}; 
        state.pricelists.forEach(pl => pricelistUsage[pl.id] = []);

        state.customers.forEach(c => {
            const assignedIds = state.mapping[c.zakaznik_id] || state.mapping[c.id] || [];
            assignedIds.forEach(plId => {
                const pid = parseInt(plId);
                if (pricelistUsage[pid]) pricelistUsage[pid].push(c.nazov_firmy);
            });
        });

        let html = `
            <div style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4 style="margin:0; color:#1e293b;">🗂️ Správa cenníkov</h4>
                    <button id="btn-create-pl" class="btn btn-success" style="font-weight:bold;"><i class="fas fa-plus"></i> + Nový cenník</button>
                </div>
                <div class="filter-bar" style="border:none; padding:0; margin:0; box-shadow:none; background:transparent; gap:15px;">
                    <div class="filter-group"><label>Názov cenníka</label><input type="text" id="pl-search-text" class="filter-input" placeholder="Hľadať..." style="width:200px;"></div>
                    <div class="filter-group"><label>Stav priradenia</label>
                        <select id="pl-filter-status" class="filter-input" style="width:160px;">
                            <option value="all">Všetky</option><option value="assigned">✅ Priradené</option><option value="unassigned">⚪ Nepriradené</option>
                        </select>
                    </div>
                    <div class="filter-group"><label>Patrí zákazníkovi</label>
                        <select id="pl-filter-customer" class="filter-input" style="width:250px;">
                            <option value="">-- Ktorýkoľvek --</option>
                            ${state.customers.map(c => `<option value="${escapeHtml(c.nazov_firmy)}">${escapeHtml(c.nazov_firmy)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="filter-group" style="justify-content:flex-end;"><label>&nbsp;</label><button id="pl-reset-filter" class="btn btn-secondary">Reset</button></div>
                </div>
            </div>
            <div id="pl-table-wrapper"></div>
            <div id="pl-pagination" style="display:flex; justify-content:center; gap:5px; margin-top:20px;"></div>
        `;
        box.innerHTML = html;

        let currentPage = 1;
        const itemsPerPage = 10;

        const renderTable = () => {
            const searchText = doc.getElementById('pl-search-text').value.toLowerCase();
            const statusFilter = doc.getElementById('pl-filter-status').value;
            const custFilter = doc.getElementById('pl-filter-customer').value;

            const filtered = state.pricelists.filter(pl => {
                const usage = pricelistUsage[pl.id] || [];
                const isAssigned = usage.length > 0;
                if (searchText && !pl.nazov_cennika.toLowerCase().includes(searchText)) return false;
                if (statusFilter === 'assigned' && !isAssigned) return false;
                if (statusFilter === 'unassigned' && isAssigned) return false;
                if (custFilter && !usage.includes(custFilter)) return false;
                return true;
            });

            filtered.sort((a,b) => a.nazov_cennika.localeCompare(b.nazov_cennika));
            const totalPages = Math.ceil(filtered.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = 1;
            const start = (currentPage - 1) * itemsPerPage;
            const paginated = filtered.slice(start, start + itemsPerPage);

            let tableHtml = `
            <div class="stat-card" style="padding:0; overflow:hidden; border:1px solid #e2e8f0;">
                <table class="table-refined">
                    <thead><tr><th style="width:40%;">Názov cenníka</th><th style="width:30%;">Použitie / Zákazníci</th><th style="width:30%;text-align:right;">Akcia</th></tr></thead>
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
                            <span style="font-size:0.85rem; color:#475569; cursor:help; border-bottom:1px dotted #ccc;">${escapeHtml(countLabel)}</span></div>`;
                    } else {
                        statusInfo = `<span style="color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:99px; font-size:0.75rem;">⚪ Nepriradený</span>`;
                    }

                    tableHtml += `<tr>
                        <td style="font-size:1.05rem; font-weight:600; vertical-align:middle; color:#0f172a;">${escapeHtml(pl.nazov_cennika)}</td>
                        <td style="vertical-align:middle;">${statusInfo}</td>
                        <td style="text-align:right;">
                            <button class="btn btn-secondary btn-sm" onclick="window.printPricelistPreview(${pl.id})" title="Tlačiť náhľad">🖨️</button>
                            <button class="btn btn-primary btn-sm" style="margin-left:5px;" onclick="window.showPricelistEditor(${pl.id})" title="Upraviť položky">✏️ Upraviť</button>
                            <button class="btn btn-danger btn-sm" style="margin-left:5px;" data-del-pl="${pl.id}" data-name="${escapeHtml(pl.nazov_cennika)}" title="Zmazať">🗑️</button>
                        </td>
                    </tr>`;
                });
            }
            tableHtml += `</tbody></table></div><div style="text-align:right; font-size:0.8rem; color:#64748b; margin-top:8px;">Zobrazené ${paginated.length} z ${filtered.length} (Celkovo ${state.pricelists.length})</div>`;
            doc.getElementById('pl-table-wrapper').innerHTML = tableHtml;

            let pagHtml = '';
            if (totalPages > 1) {
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===1?'disabled':''} onclick="window.changePlPage(${currentPage-1})">«</button>`;
                let startPage = Math.max(1, currentPage - 2);
                let endPage = Math.min(totalPages, currentPage + 2);
                for(let i=startPage; i<=endPage; i++) {
                    pagHtml += `<button class="btn btn-sm ${i===currentPage?'btn-primary':'btn-secondary'}" onclick="window.changePlPage(${i})" style="min-width:30px;">${i}</button>`;
                }
                pagHtml += `<button class="btn btn-secondary btn-sm" ${currentPage===totalPages?'disabled':''} onclick="window.changePlPage(${currentPage+1})">»</button>`;
            }
            doc.getElementById('pl-pagination').innerHTML = pagHtml;

            box.querySelectorAll('button[data-del-pl]').forEach(b => {
                b.onclick = async () => {
                    const plName = b.dataset.name;
                    if (prompt(`⚠️ POZOR: Chystáte sa vymazať cenník "${plName}".\n\nAk to naozaj chcete urobiť, napíšte veľkými písmenami slovo: ZMAZAT`) !== "ZMAZAT") return;
                    try {
                        await callFirstOk([{ url: '/api/kancelaria/b2b/deletePricelist', opts: { method: 'POST', body: { id: b.dataset.delPl } } }]);
                        showStatus('Cenník bol úspešne vymazaný.', false);
                        loadPricelistsForManagement(); 
                    } catch(e) { showStatus(e.message || String(e), true); }
                };
            });
        };

        window.changePlPage = (pageNum) => { if (pageNum >= 1) { currentPage = pageNum; renderTable(); } };
        doc.getElementById('pl-search-text').addEventListener('input', () => { currentPage=1; renderTable(); });
        doc.getElementById('pl-filter-status').addEventListener('change', () => { currentPage=1; renderTable(); });
        doc.getElementById('pl-filter-customer').addEventListener('change', () => { currentPage=1; renderTable(); });
        doc.getElementById('pl-reset-filter').addEventListener('click', () => {
            doc.getElementById('pl-search-text').value = ''; doc.getElementById('pl-filter-status').value = 'all';
            doc.getElementById('pl-filter-customer').value = ''; currentPage = 1; renderTable();
        });
        doc.getElementById('btn-create-pl').onclick = () => window.showPricelistEditor(null);
        renderTable();
    } catch(e) { box.innerHTML = `<p class="error">Chyba pri načítaní dát: ${e.message}</p>`; }
}

window.showPricelistEditor = async function(plId) { // PRIDANÉ async
    const isEdit = !!plId;
    let customersHtml = '';
    if (!isEdit) state.customers.forEach(c => { customersHtml += `<label class="cust-option"><input type="checkbox" value="${c.id}"> ${escapeHtml(c.nazov_firmy)}</label>`; });
    let copyOptions = '<option value="">-- Nevyplňovať --</option>';
    state.pricelists.forEach(p => { if (p.id != plId) copyOptions += `<option value="${p.id}">Kopírovať z: ${escapeHtml(p.nazov_cennika)}</option>`; });

    // NOVÉ: Vybudovanie mapy EAN kódov pred otvorením modálu
    await buildEanUsageMap(isEdit ? plId : null);

    const modalHtml = `
      <style>
          .b2b-modal-content { width: 96vw !important; max-width: 1920px !important; height: 92vh !important; display: flex !important; flex-direction: column !important; padding: 0 !important; border-radius: 8px !important; overflow: hidden !important; }
          .pl-editor-wrapper { display: flex; flex-direction: column; height: 100%; background: #f8fafc; }
          .pl-header { padding: 15px 20px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
          .pl-controls { padding: 15px 20px; background: #fff; border-bottom: 1px solid #e2e8f0; display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
          .pl-tables-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding: 15px; overflow: hidden; min-height: 0; }
          .pl-panel { display: flex; flex-direction: column; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
          .pl-panel-head { padding: 10px 15px; font-weight: bold; border-bottom: 1px solid #e2e8f0; }
          .pl-scroll-area { flex: 1; overflow-y: auto; background: #fff; }
          .pl-footer { padding: 15px 20px; background: #fff; border-top: 1px solid #e2e8f0; text-align: right; }
          .pl-scroll-area table { width: 100%; border-collapse: collapse; }
          .pl-scroll-area th { position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      </style>
      <div class="pl-editor-wrapper">
          <div class="pl-header">
              <h3 style="margin:0; color:#1e3a8a; display:flex; align-items:center; gap:10px;">${isEdit ? '✏️ Úprava cenníka' : '➕ Nový cenník'}</h3>
              <div>
                  <button class="btn btn-success btn-sm" onclick="window.quickAddProductToSystem()" style="margin-right:15px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">➕ Vytvoriť nový produkt do databázy</button>
                  <button class="btn btn-secondary btn-sm" onclick="closeModal()">❌ Zavrieť</button>
              </div>
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
                      <span>📦 Katalóg produktov (Zdroj)</span><input type="text" id="pl-prod-filter" class="filter-input" style="width:200px; padding:4px;" placeholder="🔍 Hľadať...">
                  </div>
                  <div id="pl-source-list" class="pl-scroll-area"></div>
              </div>
              <div class="pl-panel" style="border-color: #22c55e;">
                  <div class="pl-panel-head" style="background:#dcfce7; color:#14532d;">✅ Položky v tomto cenníku</div>
                  <div id="pl-target-list" class="pl-scroll-area" style="background:#f0fdf4;"></div>
              </div>
          </div>` : '<div style="flex:1; display:flex; align-items:center; justify-content:center; color:#666;">Najprv uložte názov cenníka, potom budete môcť pridávať produkty.</div>'}
          <div class="pl-footer">
              <button class="btn btn-secondary" onclick="closeModal()" style="margin-right:10px;">Zrušiť</button>
              <button id="pl-save-btn" class="btn btn-success" style="padding: 10px 40px; font-size:1.1rem; font-weight:bold;">💾 Uložiť cenník</button>
          </div>
      </div>`;
    
    openModal(modalHtml);

    if (isEdit) {
        const pl = state.pricelists.find(p => p.id == plId);
        if(pl) doc.getElementById('pl-name').value = pl.nazov_cennika;
        loadPricelistItemsForEdit(plId);
        doc.getElementById('pl-save-btn').onclick = async () => window.savePricelistItems(plId);
        const filterInput = doc.getElementById('pl-prod-filter');
        if(filterInput) { filterInput.focus(); filterInput.addEventListener('input', (e) => renderSourceProducts(e.target.value)); }
    } else {
        doc.getElementById('pl-save-btn').onclick = async () => {
            const name = doc.getElementById('pl-name').value.trim();
            if(!name) return showStatus('Zadajte názov', true);
            const selectedCusts = Array.from(doc.querySelectorAll('#pl-new-cust-list input:checked')).map(cb => cb.value);
            try { 
                await callFirstOk([{ url: '/api/kancelaria/b2b/createPricelist', opts: { method: 'POST', body: { name, customer_ids: selectedCusts } } }]); 
                showStatus('Cenník vytvorený'); closeModal(); loadPricelistsForManagement(); 
            } catch(e) { showStatus(e.message, true); }
        };
    }
};
window.savePricelistItems = async function(plId) {
    const newName = doc.getElementById('pl-name').value.trim();
    if(!newName) return showStatus('Názov cenníka nemôže byť prázdny!', true);
    const rows = doc.querySelectorAll('.pl-item-row');
    rows.forEach(row => {
        const ean = row.dataset.ean;
        const priceInput = row.querySelector('.price-edit-input');
        const infoInput = row.querySelector('.info-edit-input');
        if (ean && priceInput) {
            currentPlItems.set(ean, { price: parseFloat(priceInput.value) || 0, info: infoInput ? infoInput.value.trim() : '' });
        }
    });
    const items = []; 
    currentPlItems.forEach((data, ean) => items.push({ ean: ean, price: data.price, info: data.info }));
    try { 
        await callFirstOk([{ url: '/api/kancelaria/b2b/updatePricelist', opts: { method: 'POST', body: { id: plId, name: newName, items } } }]); 
        showStatus('Cenník uložený.'); closeModal(); loadPricelistsForManagement(); 
    } catch(e) { showStatus(e.message, true); }
};

async function loadPricelistItemsForEdit(plId) {
    currentPlItems.clear();
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id:plId} } }]);
        (data.items || []).forEach(i => { currentPlItems.set(i.ean_produktu, { price: Number(i.cena), info: i.info || i.poznamka || '' }); });
        renderSourceProducts(''); renderTargetProducts();
    } catch(e) { console.error(e); }
}

function renderSourceProducts(filter) {
    const container = doc.getElementById('pl-source-list');
    if (!container) return; 
    const f = filter.toLowerCase();
    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;"><thead style="background:#f8fafc; position:sticky; top:0;"><tr><th style="text-align:left; padding:5px;">Produkt</th><th style="width:80px;">Cena (€)</th><th style="width:40px;"></th></tr></thead><tbody>`;
    let count = 0;
    state.productsAll.forEach(p => {
        if (currentPlItems.has(p.ean)) return;
        if (count > 50 && !f) return;
        if (!f || p.nazov_vyrobku.toLowerCase().includes(f) || p.ean.includes(f)) {
            
            // NOVÉ: Zistenie použitia EAN a vygenerovanie ikonky
            let eanWarningIcon = '';
            if (p.ean && globalEanUsageMap.has(p.ean)) {
                const usedIn = globalEanUsageMap.get(p.ean).join(', ');
                eanWarningIcon = `<i class="fas fa-exclamation-triangle" style="color:#d97706; margin-left:8px; cursor:help; font-size:1.1em;" title="Tento EAN (${p.ean}) sa už nachádza v cenníkoch:\n${escapeHtml(usedIn)}"></i>`;
            }

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:6px;">
                    <div style="font-weight:600;">${escapeHtml(p.nazov_vyrobku)} ${eanWarningIcon}</div>
                    <div style="font-size:0.75em; color:#666;">EAN: ${p.ean} | DPH: ${p.dph}%</div>
                </td>
                <td style="padding:6px;"><input type="number" id="price-in-${p.ean}" placeholder="0.00" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;" step="0.01"></td>
                <td style="padding:6px; text-align:center;"><button class="btn btn-primary btn-sm" onclick="window.plAdd('${p.ean}')" style="padding:2px 8px;">+</button></td>
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

window.plRem = function(ean) {
    if (currentPlItems.has(ean)) {
        currentPlItems.delete(ean);
        const filterInput = document.getElementById('pl-prod-filter');
        renderSourceProducts(filterInput ? filterInput.value : '');
        renderTargetProducts();
    }
};

function renderTargetProducts() {
    const container = doc.getElementById('pl-target-list');
    if (!container) return;
    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;"><thead style="background:#dcfce7; position:sticky; top:0; z-index:20;"><tr><th style="text-align:left; padding:8px;">Produkt v cenníku</th><th style="width:80px; text-align:right; color:#64748b;">Nákup</th><th style="width:90px;">Predajná Cena</th><th style="width:100px; text-align:right;">Marža / Zisk</th><th style="width:30px;"></th></tr></thead><tbody>`;
    currentPlItems.forEach((data, ean) => {
        const p = state.productsAll.find(x => x.ean === ean) || { nazov_vyrobku: 'Neznámy produkt', nakupna_cena: 0 };
        const priceVal = (typeof data === 'object') ? data.price : data;
        const infoVal = (typeof data === 'object') ? (data.info || '') : '';
        const buyPrice = parseFloat(p.nakupna_cena) || 0;
        const profit = priceVal - buyPrice;
        let marginPercent = 0;
        if (priceVal > 0) marginPercent = (profit / priceVal) * 100;
        const profitClass = profit < 0 ? 'color:#dc2626;' : (marginPercent < 10 ? 'color:#d97706;' : 'color:#166534;');
        const profitText = `${profit > 0 ? '+' : ''}${profit.toFixed(2)} €`;
        const marginText = `${marginPercent.toFixed(1)}%`;

        html += `<tr class="pl-item-row" data-ean="${ean}" data-buy="${buyPrice}" style="border-bottom:1px solid #bbf7d0; background:#fff;"><td style="padding:6px;"><div style="font-weight:600; color:#1e293b;">${escapeHtml(p.nazov_vyrobku)}</div><div style="font-size:0.75em; color:#64748b;">EAN: ${ean}</div><input type="text" class="info-edit-input" value="${escapeHtml(infoVal)}" placeholder="Poznámka pre klienta..." style="width:100%; margin-top:4px; border:1px solid #e2e8f0; padding:2px 5px; font-size:0.8em; color:#444; border-radius:4px;"></td><td style="padding:6px; text-align:right; vertical-align:middle; font-size:0.9rem; color:#64748b;">${buyPrice > 0 ? buyPrice.toFixed(4) + ' €' : '-'}</td><td style="padding:6px; vertical-align:middle;"><input type="number" class="price-edit-input" value="${priceVal}" oninput="window.recalcRow('${ean}')" id="input-price-${ean}" style="width:100%; padding:6px; border:2px solid #cbd5e1; border-radius:6px; font-weight:bold; text-align:center; color:#0f172a;" step="0.01"></td><td style="padding:6px; text-align:right; vertical-align:middle;"><div id="profit-wrap-${ean}" style="font-weight:bold; ${profitClass}"><div style="font-size:0.95rem;">${marginText}</div><div style="font-size:0.75rem; opacity:0.8;">${profitText}</div></div></td><td style="padding:6px; text-align:center; vertical-align:middle;"><button class="btn btn-danger btn-sm" onclick="window.plRem('${ean}')" style="padding:2px 8px; border-radius:4px;">&times;</button></td></tr>`;
    });
    html += '</tbody></table>';
    if (currentPlItems.size === 0) html = '<div style="padding:40px; text-align:center; color:#15803d; background:#f0fdf4;">Cenník je zatiaľ prázdny.<br>👈 Pridajte produkty z katalógu vľavo.</div>';
    container.innerHTML = html;
}

window.recalcRow = function(ean) {
    const row = document.querySelector(`.pl-item-row[data-ean="${ean}"]`);
    if (!row) return;
    const input = document.getElementById(`input-price-${ean}`);
    const wrap = document.getElementById(`profit-wrap-${ean}`);
    const sellPrice = parseFloat(input.value) || 0;
    const buyPrice = parseFloat(row.dataset.buy) || 0;
    const profit = sellPrice - buyPrice;
    let margin = 0;
    if (sellPrice !== 0) margin = (profit / sellPrice) * 100;
    wrap.style.color = profit < 0 ? '#dc2626' : (margin < 10 ? '#d97706' : '#166534');
    wrap.innerHTML = `<div style="font-size:0.95rem;">${margin.toFixed(1)}%</div><div style="font-size:0.75rem; opacity:0.8;">${profit > 0 ? '+' : ''}${profit.toFixed(2)} €</div>`;
    if (currentPlItems.has(ean)) { const item = currentPlItems.get(ean); item.price = sellPrice; currentPlItems.set(ean, item); }
};

window.importInfoFromSelected = async () => {
    const sourceId = doc.getElementById('pl-source-copy').value;
    if (!sourceId) return showStatus('Vyberte cenník zo zoznamu', true);
    if (!confirm("Týmto sa prepíšu poznámky/info pri produktoch, ktoré sa nachádzajú v oboch cenníkoch. Chcete pokračovať?")) return;
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id: sourceId} } }]);
        let updatedCount = 0;
        if (currentPlItems.size > 0) {
            (data.items || []).forEach(srcItem => {
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
        } else { showStatus('Tento cenník zatiaľ nemá žiadne položky.', true); }
    } catch(e) { console.error(e); showStatus('Chyba pri importe: ' + e.message, true); }
};

window.printPricelistPreview = async function(plId) {
    try {
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistDetails', opts: { method:'POST', body:{id:plId} } }]);
        const pl = data.pricelist;
        const items = data.items || []; 
        if(!state.productsAll || state.productsAll.length === 0) {
             const pData = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]);
             state.productsAll = pData.products || [];
        }
        let html = `<html><head><title>Cenník: ${escapeHtml(pl.nazov_cennika)}</title><style>body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; } h1 { text-align: center; margin-bottom: 20px; } table { width: 100%; border-collapse: collapse; margin-bottom: 20px; } th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; } th { background-color: #eee; } .num { text-align: right; } .center { text-align: center; }</style></head><body><h1>Cenník: ${escapeHtml(pl.nazov_cennika)}</h1><p>Dátum tlače: ${new Date().toLocaleString('sk-SK')}</p><table><thead><tr><th style="width:30px;">#</th><th>EAN</th><th>Názov produktu</th><th class="num">Cena bez DPH</th><th class="center">DPH %</th><th class="num">Hodnota DPH</th><th class="num">Cena s DPH</th></tr></thead><tbody>`;
        items.forEach((item, index) => {
            const productInfo = state.productsAll.find(p => p.ean === item.ean_produktu) || { dph: 20 }; 
            const dphRate = Number(productInfo.dph);
            const priceNet = Number(item.cena);
            const vatAmount = priceNet * (dphRate / 100);
            const priceGross = priceNet + vatAmount;
            html += `<tr><td class="center">${index + 1}.</td><td>${item.ean_produktu}</td><td>${escapeHtml(item.nazov_vyrobku)}</td><td class="num">${priceNet.toFixed(2)} €</td><td class="center">${dphRate}%</td><td class="num">${vatAmount.toFixed(2)} €</td><td class="num"><b>${priceGross.toFixed(2)} €</b></td></tr>`;
        });
        html += `</tbody></table><script>window.print();</script></body></html>`;
        const win = window.open('', '_blank'); win.document.write(html); win.document.close();
    } catch(e) { alert("Chyba pri generovaní tlače: " + e.message); }
};
// Funkcia na rýchle pridanie produktu do systému bez zatvorenia cenníka
window.quickAddProductToSystem = function() {
    let existing = document.getElementById('qa-modal-wrapper');
    if (existing) existing.remove();

    // 1. Získanie unikátnych kategórií z aktuálnych produktov v systéme
    const categoriesSet = new Set();
    if (state.productsAll && state.productsAll.length > 0) {
        state.productsAll.forEach(p => {
            // Rôzne moduly môžu kategóriu volať inak, poistíme to
            const cat = p.predajna_kategoria || p.kategoria_pre_recepty || p.sales_category || p.kategoria;
            if (cat && cat.trim() !== '') {
                categoriesSet.add(cat.trim());
            }
        });
    }
    
    // 2. Vytvorenie rolovacieho menu utriedeného podľa abecedy
    const categoriesArray = Array.from(categoriesSet).sort();
    let catOptionsHtml = '<option value="">-- Vyberte kategóriu --</option>';
    categoriesArray.forEach(c => {
        catOptionsHtml += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });

    const modalWrapper = document.createElement('div');
    modalWrapper.id = 'qa-modal-wrapper';
    modalWrapper.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:10600; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px);';
    
    modalWrapper.innerHTML = `
        <div style="background:#fff; width:90%; max-width:500px; border-radius:12px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); overflow:hidden; border:1px solid #e2e8f0;">
            <div style="background:#f8fafc; padding:15px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; color:#1e293b;">➕ Rýchle pridanie produktu</h3>
                <button type="button" onclick="document.getElementById('qa-modal-wrapper').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#64748b;">&times;</button>
            </div>
            <div style="padding:20px;">
                <p class="text-muted" style="font-size:0.85rem; margin-top:0;">Produkt sa uloží do databázy a ihneď sa objaví v ľavom zozname cenníka. Vaša rozpracovaná práca v cenníku ostane nedotknutá.</p>
                
                <div class="form-group" style="margin-bottom: 15px;">
                    <label style="font-weight:bold;">Názov produktu <span style="color:red">*</span></label>
                    <input type="text" id="qa-nazov" class="filter-input" style="width: 100%; font-weight:bold;" required>
                </div>
                
                <div style="display:flex; gap:10px; margin-bottom: 15px;">
                    <div class="form-group" style="flex:1;">
                        <label style="font-weight:bold;">EAN kód</label>
                        <input type="text" id="qa-ean" class="filter-input" style="width: 100%;">
                    </div>
                    <div class="form-group" style="width: 80px;">
                        <label style="font-weight:bold;">MJ</label>
                        <select id="qa-mj" class="filter-input" style="width: 100%;">
                            <option value="kg">kg</option>
                            <option value="ks">ks</option>
                            <option value="g">g</option>
                        </select>
                    </div>
                </div>

                <div class="form-group" style="margin-bottom: 25px;">
                    <label style="font-weight:bold;">Predajná kategória <span style="color:red">*</span></label>
                    <select id="qa-kat" class="filter-input" style="width: 100%;" required>
                        ${catOptionsHtml}
                    </select>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('qa-modal-wrapper').remove()">Zrušiť</button>
                    <button type="button" class="btn btn-primary" onclick="window.submitQuickAddProduct()">💾 Uložiť do DB</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalWrapper);
};

window.submitQuickAddProduct = async function() {
    const nazov = document.getElementById('qa-nazov').value.trim();
    const ean = document.getElementById('qa-ean').value.trim();
    const mj = document.getElementById('qa-mj').value;
    const kat = document.getElementById('qa-kat').value; // Hodnota zo Selectu

    if (!nazov) return showStatus('Názov produktu je povinný!', true);
    if (!kat) return showStatus('Musíte vybrať predajnú kategóriu!', true);

    const btn = document.querySelector('#qa-modal-wrapper .btn-primary');
    if(btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ukladám...';

    try {
        const payload = { 
            action: 'create', 
            nazov_vyrobku: nazov, 
            ean: ean, 
            mj: mj, 
            predajna_kategoria: kat,
            typ_polozky: 'VÝROBOK'
        };

        const res = await fetch('/api/kancelaria/erp/produkty', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const out = await res.json();
        if (out.error) throw new Error(out.error);

        showStatus('Produkt bol úspešne vytvorený.');
        
        document.getElementById('qa-modal-wrapper').remove();

        const plData = await callFirstOk([{ url: '/api/kancelaria/b2b/getPricelistsAndProducts' }]);
        state.productsAll = plData.products || [];
        
        const filterInput = document.getElementById('pl-prod-filter');
        renderSourceProducts(filterInput ? filterInput.value : '');

    } catch (e) {
        showStatus('Chyba pri ukladaní do ERP: ' + e.message, true);
        if(btn) btn.innerHTML = '💾 Uložiť do DB';
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
      box.innerHTML = '<p>Načítavam nastavenia...</p>';
      try {
          const s = await callFirstOk([{ url:'/api/kancelaria/b2b/getAnnouncement' }]);
          const rData = await callFirstOk([{ url:'/api/kancelaria/b2b/getRoutes' }]);
          const routes = rData.routes || [];

          let routesHtml = `<table class="table-refined" style="margin-top:10px;"><thead><tr><th>ID</th><th>Názov trasy</th><th>Poznámka</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if(routes.length === 0) {
              routesHtml += `<tr><td colspan="4" style="text-align:center; color:#999; padding:20px;">Zatiaľ nie sú vytvorené žiadne trasy.</td></tr>`;
          } else {
              routes.forEach(r => {
                  routesHtml += `<tr>
                      <td>${r.id}</td>
                      <td><strong>${escapeHtml(r.nazov)}</strong></td>
                      <td><span style="color:#64748b; font-size:0.85em;">${escapeHtml(r.poznamka || '-')}</span></td>
                      <td style="text-align:right;"><button class="btn btn-danger btn-sm" onclick="window.deleteRoute(${r.id})">🗑️ Zmazať</button></td>
                  </tr>`;
              });
          }
          routesHtml += `</tbody></table>`;

          box.innerHTML = `
              <div class="logistics-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start;">
                  <div class="card" style="border:1px solid #e2e8f0; padding:20px; border-radius:8px;">
                      <div class="form-group">
    <label>Oznam pre zákazníkov (B2B Portál)</label>
    <div id="b2b-announcement-editor" style="height: 150px; background: white;"></div>
</div>
                      <p style="font-size:0.85em; color:#64748b;">Text, ktorý sa zobrazí všetkým prihláseným odberateľom na ich nástenke.</p>
                      <div id="b2b-announcement-editor" style="height: 150px; background: white; font-family: sans-serif;">${s.announcement || ''}</div>
                      <button id="save-ann-btn" class="btn btn-primary" style="margin-top:10px; width:100%;">Uložiť oznam</button>
                  </div>
                  
                  <div class="card" style="border:1px solid #e2e8f0; padding:20px; border-radius:8px;">
                      <h4 style="margin-top:0; color:#0369a1;">🚛 Správa trás (Logistika)</h4>
                      <p style="font-size:0.85em; color:#64748b;">Pridajte si trasy (autá/smery). Následne ich budete môcť priradiť zákazníkom v karte Úpravy.</p>
                      <div style="display:flex; gap:10px; margin-bottom:15px; align-items:stretch;">
                          <div style="flex:2;"><input type="text" id="new-route-name" class="filter-input" placeholder="Názov trasy (napr. Trasa BA)" style="width:100%;"></div>
                          <div style="flex:2;"><input type="text" id="new-route-note" class="filter-input" placeholder="Poznámka (ŠPZ / Šofér)" style="width:100%;"></div>
                          <button id="add-route-btn" class="btn btn-success" style="white-space:nowrap;"><i class="fas fa-plus"></i> Pridať trasu</button>
                      </div>
                      <div style="max-height: 400px; overflow-y: auto; border:1px solid #cbd5e1; border-radius:6px;">
                          ${routesHtml}
                      </div>
                  </div>
              </div>
          `;

          // --- NOVÉ: Inicializácia Quill editora ---
          const toolbarOptions = [
            [{ 'size': ['small', false, 'large', 'huge'] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'align': [] }],
            ['clean']
          ];
          
          const quill = new Quill('#b2b-announcement-editor', {
            theme: 'snow',
            modules: { toolbar: toolbarOptions }
          });

          // --- NOVÉ: Ukladanie oznamu s podporou HTML ---
          doc.getElementById('save-ann-btn').onclick = async () => { 
              // Vytiahnutie naformátovaného textu
              const htmlContent = quill.root.innerHTML;
              // Ak je editor prázdny, odstránime <p><br></p> balast
              const announcementText = htmlContent === '<p><br></p>' ? '' : htmlContent;

              try {
                  await callFirstOk([{ 
                      url:'/api/kancelaria/b2b/saveAnnouncement', 
                      opts:{ method:'POST', body:{ announcement: announcementText } } 
                  }]); 
                  showStatus('Oznam uložený'); 
              } catch(e) {
                  showStatus('Chyba: ' + e.message, true);
              }
          };

          // Pridanie trasy
          doc.getElementById('add-route-btn').onclick = async () => {
              const name = doc.getElementById('new-route-name').value;
              const note = doc.getElementById('new-route-note').value;
              if(!name) return showStatus('Názov trasy je povinný!', true);
              try {
                  await callFirstOk([{ url:'/api/kancelaria/b2b/createRoute', opts:{ method:'POST', body:{ nazov: name, poznamka: note } } }]);
                  showStatus('Trasa pridaná');
                  loadB2BSettings(); // Refreshne celú záložku
              } catch(e) {
                  showStatus(e.message, true);
              }
          };

      } catch(e) { box.innerHTML = `<p class="error">${e.message}</p>`; }
  }

  // Funkcia na zmazanie trasy
  window.deleteRoute = async function(id) {
      if(!confirm("Naozaj chcete zmazať túto trasu?\n(Zákazníci priradení na túto trasu ostanú bez trasy a vyhodí ich do 'Zatiaľ nepriradená trasa'.)")) return;
      try {
          await callFirstOk([{ url:'/api/kancelaria/b2b/deleteRoute', opts:{ method:'POST', body:{ id: id } } }]);
          showStatus('Trasa bola zmazaná');
          loadB2BSettings(); // Refreshne celú záložku
      } catch(e) {
          showStatus(e.message, true);
      }
  };
  // =================================================================
  // EXPORT MODULU
  // =================================================================
  (function (g) { 
      g.initializeB2BAdminModule = initializeB2BAdminModule; 
      g.loadCommView = loadCommView; 
  })(typeof window !== 'undefined' ? window : this);

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);