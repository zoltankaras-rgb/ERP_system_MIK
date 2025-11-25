// static/js/kancelaria_modules/b2c_admin.js
// =================================================================
// === KANCELÁRIA: B2C ADMIN – Objednávky / Zákazníci PRO / Cenník / Odmeny
// =================================================================
(function (root, doc) {
  'use strict';

  // --- SAFE DOM HELPERS ---
  const $  = (sel, el = doc) => (el || doc).querySelector(sel);
  const $$ = (sel, el = doc) => Array.from((el || doc).querySelectorAll(sel));
  if (!root.$)  root.$  = $;
  if (!root.$$) root.$$ = $$;

  // ---------- Pomocné utily ----------
  const apiRequest = (root.apiRequest) ? root.apiRequest : async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const bust = (u) => u + (u.includes('?') ? '&' : '?') + '__ts=' + Date.now();
    const finalUrl = method === 'GET' ? bust(url) : url;

    const res = await fetch(finalUrl, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: (opts.body != null) ? JSON.stringify(opts.body) : undefined
    });

    if (res.status === 204) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(typeof data === 'string' ? data : (data?.error || `HTTP ${res.status}`));
    return data;
  };

  const apiRequestQuietly = async (url, opts={}) => {
    try { return await apiRequest(url, opts); } catch { return null; }
  };
  const showStatus = (root.showStatus) ? root.showStatus : (msg, isError=false)=>{
    (isError?console.error:console.log)(msg);
    const sb = doc.getElementById('status-bar');
    if (sb){ sb.textContent = msg; sb.style.color = isError ? '#b91c1c' : '#166534'; }
  };
  const escapeHtml = (s)=>String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const todayISO = ()=> new Date().toISOString().slice(0,10);

  // Polyfill CSS.escape
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    window.CSS = window.CSS || {};
    CSS.escape = function (value) {
      return String(value).replace(/[^a-zA-Z0-9_\-]/g, s => '\\' + s);
    };
  }

  // ---------- Jednoduchý MODAL ----------
  const Modal = (() => {
    let inited = false, overlay = null, dialog = null, body = null, titleEl = null, closeBtn = null, escHandler = null;
    function ensureStyles(){
      if (doc.getElementById('b2c-modal-style')) return;
      const st = doc.createElement('style');
      st.id = 'b2c-modal-style';
      st.textContent = `
        .b2c-modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;z-index:9999}
        .b2c-modal-dialog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
          max-width:900px;width:min(96vw,900px);background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);
          overflow:hidden;font-family:Inter,system-ui,Arial,sans-serif}
        .b2c-modal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb}
        .b2c-modal-title{font-weight:600;margin:0}
        .b2c-modal-body{padding:16px;max-height:75vh;overflow:auto}
        .b2c-modal-close{appearance:none;border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px}
        .muted{color:#6b7280}
        .gain{color:#16a34a}
        .loss{color:#dc2626}
        .btn-grid{display:grid;gap:.25rem}
        .form-control{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:6px;margin-top:4px;}
      `;
      doc.head.appendChild(st);
    }
    function ensure(){
      if (inited) return;
      ensureStyles();
      const overlayEl = doc.createElement('div'); overlayEl.className = 'b2c-modal-overlay'; overlayEl.id = 'b2c-modal';
      const dialogEl  = doc.createElement('div'); dialogEl.className = 'b2c-modal-dialog';
      const header = doc.createElement('div'); header.className = 'b2c-modal-header';
      const title  = doc.createElement('h3'); title.className = 'b2c-modal-title';
      const close  = doc.createElement('button'); close.className = 'b2c-modal-close'; close.innerHTML = '×';
      header.appendChild(title); header.appendChild(close);
      const bodyEl = doc.createElement('div'); bodyEl.className = 'b2c-modal-body';
      dialogEl.appendChild(header); dialogEl.appendChild(bodyEl); overlayEl.appendChild(dialogEl); doc.body.appendChild(overlayEl);
      overlay = overlayEl; dialog = dialogEl; body = bodyEl; titleEl = title; closeBtn = close;
      closeBtn.onclick = hide; overlay.addEventListener('click', (e)=>{ if (e.target === overlay) hide(); });
      escHandler = (e)=>{ if (e.key === 'Escape') hide(); };
      inited = true;
    }
    function show(title, html, onReady){
      ensure(); titleEl.textContent = title || ''; body.innerHTML = html || '';
      overlay.style.display = 'block'; doc.body.style.overflow = 'hidden'; doc.addEventListener('keydown', escHandler);
      if (typeof onReady === 'function') onReady(body, overlay);
    }
    function hide(){ if (!inited) return; overlay.style.display = 'none'; body.innerHTML = ''; doc.body.style.overflow = ''; doc.removeEventListener('keydown', escHandler); }
    return { show, hide, getBody: ()=> body };
  })();
  root.closeModal = Modal.hide;

  // =================================================================
  //                    SHELL – Taby
  // =================================================================
  function initializeB2CAdminModule() {
    const container = doc.getElementById('section-b2c-admin');
    if (!container) return;

    container.innerHTML = `
      <h3>B2C Administrácia</h3>
      <div class="btn-grid" style="margin-bottom:.5rem;">
        <button class="btn btn-primary  js-tab" data-b2c-tab="b2c-orders-tab">Prehľad objednávok</button>
        <button class="btn btn-secondary js-tab" data-b2c-tab="b2c-customers-tab">Zákazníci (PRO)</button>
        <button class="btn btn-secondary js-tab" data-b2c-tab="b2c-pricelist-tab">Správa cenníka</button>
        <button class="btn btn-secondary js-tab" data-b2c-tab="b2c-rewards-tab">Správa odmien</button>
      </div>
      <div id="b2c-views" class="stat-card" style="padding:1rem;">
        <div id="b2c-orders-tab"    class="b2c-tab-content" style="display:block;"></div>
        <div id="b2c-customers-tab" class="b2c-tab-content" style="display:none;"></div>
        <div id="b2c-pricelist-tab" class="b2c-tab-content" style="display:none;"><div id="b2c-admin-pricelist"></div></div>
        <div id="b2c-rewards-tab"   class="b2c-tab-content" style="display:none;"></div>
      </div>
    `;
    const tabBtns = container.querySelectorAll('.js-tab');
    const tabViews= container.querySelectorAll('.b2c-tab-content');
    function setActiveTab(id){
      tabBtns.forEach(b=>{
        const active = (b.dataset.b2cTab === id);
        b.classList.toggle('btn-primary', active);
        b.classList.toggle('btn-secondary', !active);
      });
      tabViews.forEach(v=> v.style.display = (v.id === id) ? 'block' : 'none');
      switch (id) {
        case 'b2c-orders-tab':    loadB2COrders(); break;
        case 'b2c-customers-tab': renderCustomersPro(); break;
        case 'b2c-pricelist-tab': loadB2CPricelistAdmin(); break;
        case 'b2c-rewards-tab':   loadB2CRewardsAdmin(); break;
      }
    }
    tabBtns.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.b2cTab)));
    setActiveTab('b2c-orders-tab');
  }

  // =================================================================
  //                    ORDERS (Aktívne / Archív + Filter)
  // =================================================================
  async function loadB2COrders() {
    const el = doc.getElementById('b2c-orders-tab');
    if (!el) return;

    // 1. Layout: Filtre + Tabuľka
    el.innerHTML = `
      <div class="stat-card" style="padding: 1rem; margin-bottom: 1rem; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
          <div style="display:flex; gap:1rem; margin-bottom:1rem; border-bottom:1px solid #e2e8f0; padding-bottom:0.75rem;">
              <button class="btn btn-primary js-ord-type active" data-type="active">Aktívne (Na vybavenie)</button>
              <button class="btn btn-secondary js-ord-type" data-type="archive">Archív (História)</button>
          </div>
          
          <div style="display:flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap;">
              <div class="form-group" style="margin:0;">
                  <label style="font-size:0.85rem; color:#64748b;">Dátum od:</label>
                  <input type="date" id="flt-date-from" class="form-control" style="padding:6px;">
              </div>
              <div class="form-group" style="margin:0;">
                  <label style="font-size:0.85rem; color:#64748b;">Dátum do:</label>
                  <input type="date" id="flt-date-to" class="form-control" style="padding:6px;">
              </div>
              <div class="form-group" style="margin:0; flex-grow:1; min-width: 200px;">
                  <label style="font-size:0.85rem; color:#64748b;">Hľadať (číslo, zákazník):</label>
                  <input type="text" id="flt-query" class="form-control" placeholder="Meno, číslo objednávky..." style="padding:6px;">
              </div>
              <button id="btn-filter-orders" class="btn btn-info"><i class="fas fa-search"></i> Filtrovať</button>
          </div>
      </div>
      <div id="b2c-orders-list"></div>
    `;

    let currentType = 'active';

    // 2. Event Listenery
    el.querySelectorAll('.js-ord-type').forEach(btn => {
        btn.onclick = () => {
            el.querySelectorAll('.js-ord-type').forEach(b => {
                b.classList.remove('btn-primary', 'active');
                b.classList.add('btn-secondary');
            });
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary', 'active');
            currentType = btn.dataset.type;
            fetchOrders();
        };
    });

    el.querySelector('#btn-filter-orders').onclick = fetchOrders;

    // 3. Načítanie dát
    async function fetchOrders() {
        const listEl = document.getElementById('b2c-orders-list');
        listEl.innerHTML = '<p class="muted">Načítavam objednávky...</p>';

        const dFrom = document.getElementById('flt-date-from').value;
        const dTo = document.getElementById('flt-date-to').value;
        const q = document.getElementById('flt-query').value;

        const url = `/api/kancelaria/b2c/get_orders?type=${currentType}&date_from=${dFrom}&date_to=${dTo}&q=${encodeURIComponent(q)}`;
        
        try {
            const rows = await apiRequest(url);
            renderTable(rows);
        } catch (e) {
            listEl.innerHTML = `<p class="error">Chyba pri načítaní: ${escapeHtml(e.message)}</p>`;
        }
    }

    // 4. Vykreslenie tabuľky
    function renderTable(rows) {
        const listEl = document.getElementById('b2c-orders-list');
        if (!Array.isArray(rows) || rows.length === 0) {
            listEl.innerHTML = '<p class="muted">Žiadne objednávky nezodpovedajú výberu.</p>';
            return;
        }

        const statusColor = {
            'Prijatá': '#3b82f6', 'Pripravená': '#f59e0b', 
            'Hotová': '#16a34a', 'Zrušená': '#ef4444'
        };

        let html = `<div class="table-container"><table>
          <thead><tr>
            <th>Číslo obj.</th><th>Zákazník</th><th>Dodanie</th>
            <th>Suma (predb./finálna)</th><th>Stav</th><th>Akcie</th>
          </tr></thead><tbody>`;

        rows.forEach(o => {
            const dObj = o.datum_objednavky ? new Date(o.datum_objednavky).toLocaleDateString('sk-SK') : '';
            const dDel = o.pozadovany_datum_dodania ? new Date(o.pozadovany_datum_dodania).toLocaleDateString('sk-SK') : '';

            // Sumy
            let pred = Number(o.predpokladana_suma_s_dph || 0);
            // Dopočet predb. sumy, ak chýba (rovnako ako predtým)
            if ((!pred || pred <= 0) && o.polozky_json) {
                try {
                    const items = typeof o.polozky_json === 'string' ? JSON.parse(o.polozky_json) : o.polozky_json;
                    let gross = 0;
                    if (Array.isArray(items)){
                        items.forEach(it => {
                            const q = Number(it.quantity || it.mnozstvo || 0);
                            const p = Number(it.price_s_dph || 0);
                            if(q>0 && p>0) gross += q*p;
                        });
                        if(gross>0) pred = Number(gross.toFixed(2));
                    }
                } catch(_){}
            }

            let fin = null;
            if (o.finalna_suma_s_dph != null) {
                fin = Number(o.finalna_suma_s_dph);
                if (!isFinite(fin)) fin = null;
            }

            const priceHtml = (fin != null && fin > 0)
                ? `<span class="muted">${pred.toFixed(2)}</span> / <strong class="gain">${fin.toFixed(2)} €</strong>`
                : `<strong>${pred.toFixed(2)} €</strong>`;

            const stStyle = `font-weight:600;color:${statusColor[o.stav] || '#6b7280'}`;
            const customerName = o.zakaznik_meno || o.nazov_firmy || '';
            const orderJson = encodeURIComponent(JSON.stringify(o));

            // Akcie
            let actions = `
              <button class="btn btn-sm btn-secondary" style="margin-right:4px" title="Detail"
                      onclick="window.__B2C_showDetailJSON && __B2C_showDetailJSON('${orderJson}')">
                <i class="fas fa-search"></i>
              </button>
              <a href="/api/kancelaria/b2c/order-pdf?order_id=${o.id}" target="_blank" class="btn btn-sm btn-secondary" style="margin-right:4px" title="PDF">
                <i class="fas fa-file-pdf"></i>
              </a>
              <a href="/api/kancelaria/b2c/order-csv?order_id=${o.id}" target="_blank" class="btn btn-sm btn-info" style="margin-right:4px" title="CSV (Expedícia)">
                <i class="fas fa-file-csv"></i>
              </a>
            `;

            if (currentType === 'active') {
                if (o.stav === 'Prijatá') {
                    actions += `<button class="btn btn-sm btn-primary" style="margin-right:4px"
                        onclick="window.__B2C_finalize && __B2C_finalize(${o.id}, '${escapeHtml(o.cislo_objednavky||'')}')">
                        Pripraviť</button>`;
                }
                if (o.stav === 'Pripravená') {
                    actions += `<button class="btn btn-sm btn-success" style="margin-right:4px"
                        onclick="window.__B2C_complete && __B2C_complete(${o.id})">
                        Hotová</button>`;
                }
                if (o.stav !== 'Hotová' && o.stav !== 'Zrušená') {
                    actions += `<button class="btn btn-sm btn-danger"
                        onclick="window.__B2C_cancel && __B2C_cancel(${o.id})">
                        <i class="fas fa-times"></i></button>`;
                }
            }

            html += `<tr data-id="${o.id}">
                <td>${escapeHtml(o.cislo_objednavky || String(o.id))}<br><small class="muted">${escapeHtml(dObj)}</small></td>
                <td>${escapeHtml(customerName)}</td>
                <td>${escapeHtml(dDel)}</td>
                <td>${priceHtml}</td>
                <td><span style="${stStyle}">${escapeHtml(o.stav||'')}</span></td>
                <td><div style="display:flex;align-items:center">${actions}</div></td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        listEl.innerHTML = html;
    }

    // Helper pre detail (volaný z tlačidla)
    root.__B2C_showDetailJSON = function(encodedJson) {
        try {
            const order = JSON.parse(decodeURIComponent(encodedJson));
            showB2COrderDetailModal(order);
        } catch(e) { console.error(e); }
    };

    // Spustiť prvý load
    fetchOrders();
  }

  function showB2COrderDetailModal(order){
    let items = [];
    try {
      // Backend posiela 'polozky_json'
      const raw = order.polozky_json ?? order.polozky ?? order.items ?? '[]';
      if (typeof raw === 'string') items = JSON.parse(raw);
      else if (Array.isArray(raw)) items = raw;
    } catch(_) { items = []; }
    if (!Array.isArray(items)) items = [];

    let itemsHtml = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;border-bottom:1px solid #ddd">Produkt</th>
            <th style="text-align:left;border-bottom:1px solid #ddd">Množstvo</th>
            <th style="text-align:left;border-bottom:1px solid #ddd">Jednotka</th>
            <th style="text-align:left;border-bottom:1px solid #ddd">Poznámka</th>
          </tr>
        </thead><tbody>`;
    items.forEach(it=>{
      const name = it.name || it.nazov || it.nazov_vyrobku || '—';
      itemsHtml += `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(String(it.quantity ?? it.mnozstvo ?? ''))}</td>
        <td>${escapeHtml(it.unit || it.mj || '')}</td>
        <td>${escapeHtml(it.poznamka_k_polozke || it.item_note || '')}</td>
      </tr>`;
    });
    itemsHtml += `</tbody></table>`;
    const orderIdOrNo = order.cislo_objednavky || order.id;
    itemsHtml += `
      <div style="text-align:right;margin-top:1rem">
        <button class="btn btn-info" onclick="window.open('/api/kancelaria/b2c/order-pdf?order_id=${encodeURIComponent(orderIdOrNo)}','_blank')">
          🖨️ PDF objednávky
        </button>
      </div>`;
    Modal.show(`Detail objednávky #${escapeHtml(orderIdOrNo)}`, itemsHtml);
  }

  // =================================================================
  //                    AKCIE S OBJEDNÁVKOU
  // =================================================================
  
  // ---------- Kontakt resolve (telefón / email) ----------
  async function resolveContact(orderId, orderNo){
    try{
      const r = await apiRequest('/api/kancelaria/b2c/sms/wherePhone', {
        method:'POST', body: { order_id: orderId || undefined, order_no: orderNo || undefined }
      });
      const email = (r?.order_lookup?.row?.email) || (r?.customer_lookup?.row?.email) || null;
      return {
        msisdn: r && r.resolved_msisdn ? r.resolved_msisdn : null,
        email: email || null,
        order_no: (r?.order_lookup?.row?.order_no) || orderNo || null
      };
    }catch(_){ return { msisdn:null, email:null, order_no: orderNo || null }; }
  }

  // ---------- „PRIPRAVENÁ“ (READY) ----------
  async function finalizeB2COrder(orderId, orderNumber){
    const raw = prompt(`Zadajte finálnu cenu s DPH pre objednávku #${orderNumber || orderId}:`);
    if (raw === null) return;

    const price = String(raw).replace(',', '.').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(price)) {
      showStatus('Neplatná suma – použite formát 12.34', true);
      return;
    }

    const btn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : null;
    const lock = on => {
      if (!btn) return;
      btn.disabled = !!on;
      btn.dataset.origText ??= btn.textContent;
      btn.textContent = on ? 'Ukladám…' : (btn.dataset.origText || 'Pripraviť');
    };
    lock(true);

    try {
      await apiRequest('/api/kancelaria/b2c/finalize_order', {
        method: 'POST',
        body: { order_id: orderId, final_price: price }
      });
      showStatus('Objednávka je v stave „Pripravená“ (mail + SMS odoslané).', false);
      if (typeof loadB2COrders === 'function') loadB2COrders();
    } catch (e) {
      console.error(e);
      showStatus(e?.message || 'Uloženie finálnej ceny zlyhalo.', true);
    } finally {
      lock(false);
    }
  }
  root.__B2C_finalize = finalizeB2COrder;

  // ---------- „HOTOVÁ“ (COMPLETED) ----------
  async function completeB2COrder(orderId){
    if (!confirm('Potvrdiť úhradu a pripísať vernostné body? (1 bod = 1 € s DPH)')) return;

    const btn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : null;
    const lock = on => {
      if (!btn) return;
      btn.disabled = !!on;
      btn.dataset.origText ??= btn.textContent;
      btn.textContent = on ? 'Uzatváram…' : (btn.dataset.origText || 'Hotová');
    };
    lock(true);

    try {
      const res = await apiRequest('/api/kancelaria/b2c/credit_points', {
        method: 'POST',
        body: { order_id: orderId }
      });
      showStatus(res?.message || 'Objednávka uzavretá a body pripísané.', false);
      if (typeof loadB2COrders === 'function') loadB2COrders();
    } catch (e) {
      console.error(e);
      showStatus(e?.message || 'Uzatvorenie zlyhalo.', true);
    } finally {
      lock(false);
    }
  }
  root.__B2C_complete = completeB2COrder;

  // ---------- ZRUŠIŤ ----------
  async function cancelB2COrder(orderId){
    const reason = prompt('Dôvod zrušenia (zobrazí sa zákazníkovi):');
    if (reason === null || !reason.trim()){ showStatus('Zrušenie prerušené – dôvod chýba.', true); return; }
    try{
      await apiRequest('/api/kancelaria/b2c/cancel_order', { method:'POST', body:{ order_id: orderId, reason: reason.trim() } });
      showStatus('Objednávka zrušená.', false);
      loadB2COrders();
    }catch(e){
      showStatus(e.message||String(e), true);
    }
  }
  root.__B2C_cancel = cancelB2COrder;


  // =================================================================
  //                    ZÁKAZNÍCI – PRO VERZIA
  // =================================================================
  function renderCustomersPro(){
    const el = doc.getElementById('b2c-customers-tab');
    const tpl = `
      <div class="stat-card" style="padding:.75rem;margin-bottom:.75rem;">
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center">
          <strong>Filtre:</strong>
          <input id="flt-q" placeholder="Hľadať meno/e-mail/ID" style="min-width:220px">
          <label><input type="checkbox" id="flt-month-bday"> narodeniny tento mesiac</label>
          <label><input type="checkbox" id="flt-has-orders"> má aspoň 1 objednávku</label>
          <label><input type="checkbox" id="flt-mkt-email"> súhlas e-mail</label>
          <label><input type="checkbox" id="flt-mkt-sms"> súhlas SMS</label>
          <label><input type="checkbox" id="flt-mkt-news"> súhlas newsletter</label>
          <label>Min. body <input id="flt-min-points" type="number" min="0" style="width:90px"></label>
          <button class="btn btn-secondary" id="flt-clear">Vyčistiť</button>
          <span style="margin-left:auto"></span>
          <button class="btn btn-info" id="btn-export">Export CSV</button>
        </div>
      </div>
      <div class="stat-card" style="padding:.25rem .75rem;margin-bottom:.5rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
        <strong>Hromadné akcie (na označených):</strong>
        <button class="btn btn-secondary btn-sm" id="bulk-points-plus">+ body</button>
        <button class="btn btn-secondary btn-sm" id="bulk-points-minus">- body</button>
        <label><input type="checkbox" id="bulk-notify"> poslať e-mail</label>
        <select id="bulk-template" title="Predloha e-mailu">
          <option value="">— vlastný text / bez predlohy —</option>
          <option value="10orders">Za 10. objednávku</option>
          <option value="campaign">Kampaň</option>
          <option value="goodwill">Poďakovanie</option>
        </select>
        <input id="bulk-msg" placeholder="Vlastná správa (voliteľné)" style="min-width:280px">
        <button class="btn btn-secondary btn-sm" id="bulk-set-mkt">Nastaviť súhlasy</button>
      </div>
      <div class="table-container"><table id="cust-table">
        <thead>
          <tr>
            <th style="width:36px"><input type="checkbox" id="sel-all"></th>
            <th data-sort="zakaznik_id">ID</th>
            <th data-sort="nazov_firmy">Meno</th>
            <th data-sort="email">E-mail</th>
            <th data-sort="telefon">Telefón</th>
            <th>Adresy</th>
            <th data-sort="orders_count">Objednávky</th>
            <th data-sort="vernostne_body">Body</th>
            <th>Marketing</th>
            <th>Narodeniny</th>
            <th>Bonus (mesiac)</th>
            <th>Akcie</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table></div>
      <div id="cust-pager" style="display:flex;gap:.5rem;align-items:center;justify-content:flex-end;margin-top:.5rem">
        <button class="btn btn-secondary btn-sm" id="pg-prev">‹</button>
        <span id="pg-info" class="muted"></span>
        <button class="btn btn-secondary btn-sm" id="pg-next">›</button>
      </div>
    `;
    el.innerHTML = tpl;

    const state = {
      q: '', monthBday: false, hasOrders: false,
      mEmail:false, mSms:false, mNews:false,
      minPoints: 0, page: 1, pageSize: 50,
      sortBy: 'id', sortDir: 'desc',
      rows: [], total: 0, selected: new Set()
    };

    const tb  = el.querySelector('#cust-table tbody');
    const hdr = el.querySelector('#cust-table thead');

    async function reload(){
      const body = {
        q: state.q,
        month_bday: state.monthBday ? 1 : 0,
        has_orders: state.hasOrders ? 1 : 0,
        marketing_email: state.mEmail ? 1 : 0,
        marketing_sms: state.mSms ? 1 : 0,
        marketing_newsletter: state.mNews ? 1 : 0,
        min_points: Number(state.minPoints||0),
        page: state.page, page_size: state.pageSize,
        sort_by: state.sortBy, sort_dir: state.sortDir
      };
      const res = await apiRequest('/api/kancelaria/b2c/customers/query', { method:'POST', body });
      state.rows  = Array.isArray(res.rows) ? res.rows : [];
      state.total = Number(res.total||state.rows.length||0);
      draw();
    }

    function draw(){
      hdr.querySelectorAll('th[data-sort]').forEach(th=>{
        const key = th.getAttribute('data-sort');
        th.style.cursor = 'pointer';
        th.onclick = ()=>{
          if (state.sortBy === key) state.sortDir = (state.sortDir === 'asc' ? 'desc' : 'asc');
          else { state.sortBy = key; state.sortDir = 'asc'; }
          reload();
        };
      });

      tb.innerHTML = state.rows.map(r=>{
        const checked = state.selected.has(r.id) ? 'checked' : '';
        const mkt = [
          r.marketing_email ? 'E-mail' : null,
          r.marketing_sms ? 'SMS' : null,
          r.marketing_newsletter ? 'Newsletter' : null
        ].filter(Boolean).join(', ') || '<span class="muted">—</span>';
        const bday = (r.dob_month ? `mesiac: ${String(r.dob_month).padStart(2,'0')}` : '<span class="muted">neuvedené</span>') +
                     (r.dob_year_known ? ' • rok: ✓' : '');
        const bonus = Number(r.birthday_points_this_month||0) > 0
          ? `<span class="gain">+${Number(r.birthday_points_this_month)} b.</span>`
          : '<span class="muted">—</span>';
        const ordersInfo = `${Number(r.orders_count||0)}${r.last_order_date ? `<br><small>${new Date(r.last_order_date).toLocaleDateString('sk-SK')}</small>` : ''}`
          + (r.final_paid_sum ? `<br><small>spolu finálne: ${Number(r.final_paid_sum).toFixed(2)} €</small>` : '');
        return `<tr data-id="${r.id}" data-email="${escapeHtml(r.email||'')}">
          <td><input type="checkbox" class="sel-row" ${checked}></td>
          <td>${escapeHtml(r.zakaznik_id||'')}</td>
          <td>${escapeHtml(r.nazov_firmy||'')}</td>
          <td>${escapeHtml(r.email||'')}</td>
          <td>${escapeHtml(r.telefon||'')}</td>
          <td><b>F:</b> ${escapeHtml(r.adresa||'—')}<br><b>D:</b> ${escapeHtml(r.adresa_dorucenia||'—')}</td>
          <td>${ordersInfo}</td>
          <td>${Number(r.vernostne_body||0)}</td>
          <td>${mkt}</td>
          <td>${bday}</td>
          <td>${bonus}</td>
          <td>
            <div class="btn-grid" style="grid-template-columns:auto auto;gap:.25rem;">
              <button class="btn btn-secondary btn-sm" onclick="window.__B2C_openCustomer('${r.id}')">Profil</button>
              <button class="btn btn-info btn-sm" onclick="window.__B2C_showCustOrders('${r.id}')">Objednávky</button>
            </div>
          </td>
        </tr>`;
      }).join('');

      el.querySelector('#sel-all').onchange = (ev)=>{
        const on = ev.target.checked;
        state.rows.forEach(r=>{ if (on) state.selected.add(r.id); else state.selected.delete(r.id); });
        tb.querySelectorAll('.sel-row').forEach(cb=> cb.checked = on);
      };
      tb.querySelectorAll('.sel-row').forEach((cb,i)=>{
        cb.onchange = ()=> {
          const id = state.rows[i].id;
          if (cb.checked) state.selected.add(id); else state.selected.delete(id);
        };
      });

      const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
      el.querySelector('#pg-info').textContent = `Strana ${state.page}/${totalPages} • Záznamov: ${state.total}`;
      el.querySelector('#pg-prev').onclick = ()=>{ if (state.page>1){ state.page--; reload(); } };
      el.querySelector('#pg-next').onclick = ()=>{ if (state.page<totalPages){ state.page++; reload(); } };
    }

    el.querySelector('#flt-q').oninput       = (e)=>{ state.q = e.target.value||''; state.page=1; reload(); };
    el.querySelector('#flt-month-bday').onchange = (e)=>{ state.monthBday = !!e.target.checked; state.page=1; reload(); };
    el.querySelector('#flt-has-orders').onchange = (e)=>{ state.hasOrders = !!e.target.checked; state.page=1; reload(); };
    el.querySelector('#flt-mkt-email').onchange  = (e)=>{ state.mEmail = !!e.target.checked; state.page=1; reload(); };
    el.querySelector('#flt-mkt-sms').onchange    = (e)=>{ state.mSms   = !!e.target.checked; state.page=1; reload(); };
    el.querySelector('#flt-mkt-news').onchange   = (e)=>{ state.mNews  = !!e.target.checked; state.page=1; reload(); };
    el.querySelector('#flt-min-points').oninput  = (e)=>{ state.minPoints = Number(e.target.value||0); state.page=1; reload(); };
    el.querySelector('#flt-clear').onclick = ()=>{
      el.querySelector('#flt-q').value=''; state.q='';
      ['flt-month-bday','flt-has-orders','flt-mkt-email','flt-mkt-sms','flt-mkt-news'].forEach(id=> el.querySelector('#'+id).checked=false);
      el.querySelector('#flt-min-points').value=''; state.monthBday=state.hasOrders=state.mEmail=state.mSms=state.mNews=false; state.minPoints=0;
      state.page=1; reload();
    };

    el.querySelector('#btn-export').onclick = ()=>{
      const headers = ['ID','Meno','Email','Telefon','Adresa_F','Adresa_D','Objednavky','Finálky_spolu','Body','MKT_email','MKT_sms','MKT_news','DOB_mes','DOB_rok_je','Bonus_mes'];
      const rows = state.rows.map(r=>[
        r.zakaznik_id||'', r.nazov_firmy||'', r.email||'', r.telefon||'',
        (r.adresa||'').replace(/\s+/g,' '), (r.adresa_dorucenia||'').replace(/\s+/g,' '),
        Number(r.orders_count||0), Number(r.final_paid_sum||0).toFixed(2),
        Number(r.vernostne_body||0),
        r.marketing_email?1:0, r.marketing_sms?1:0, r.marketing_newsletter?1:0,
        r.dob_month||'', r.dob_year_known?1:0, Number(r.birthday_points_this_month||0)
      ]);
      const csv = [headers.join(';')].concat(rows.map(a=> a.map(v=> String(v).replace(/;/g, ',')).join(';'))).join('\n');
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob);
      const a = doc.createElement('a'); a.href = url; a.download = `b2c_zakaznici_${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);
    };

    el.querySelector('#bulk-points-plus').onclick = ()=> bulkAdjustPoints(+1);
    el.querySelector('#bulk-points-minus').onclick= ()=> bulkAdjustPoints(-1);

    async function bulkAdjustPoints(sign){
      const ids = Array.from(state.selected); if (!ids.length){ showStatus('Vyber aspoň jedného zákazníka.', true); return; }
      const v = prompt(sign>0 ? 'Koľko bodov pridať každému?' : 'Koľko bodov odobrať každému?'); if (v===null) return;
      const delta = sign * Math.abs(parseInt(v||'0',10) || 0); if (!delta){ showStatus('Zadaj nenulový počet.', true); return; }

      const notify = el.querySelector('#bulk-notify').checked;
      const template = el.querySelector('#bulk-template').value || null;
      const custom_message = (el.querySelector('#bulk-msg').value || '').trim() || null;

      try{
        for (const id of ids){
          await apiRequest('/api/kancelaria/b2c/customer/adjust_points', {
            method:'POST',
            body:{ customer_id:id, delta: delta, reason:'bulk-adjust', notify, template, custom_message }
          });
        }
        showStatus('Body upravené.', false);
        reload();
      }catch(e){ showStatus(e.message||String(e), true); }
    }

    el.querySelector('#bulk-set-mkt').onclick = async ()=>{
      const ids = Array.from(state.selected); if (!ids.length){ showStatus('Vyber aspoň jedného zákazníka.', true); return; }
      const mEmail = el.querySelector('#bulk-mkt-email')?.checked || false;
      const mSms   = el.querySelector('#bulk-mkt-sms')?.checked   || false;
      const mNews  = el.querySelector('#bulk-mkt-news')?.checked  || false;
      try{
        for (const id of ids){
          await apiRequest('/api/kancelaria/b2c/customer/update_profile', { method:'POST', body:{ customer_id:id, marketing:{ email:mEmail, sms:mSms, newsletter:mNews } } });
        }
        showStatus('Súhlasy aktualizované.', false);
        reload();
      }catch(e){ showStatus(e.message||String(e), true); }
    };

    root.__B2C_openCustomer = async function(id){
      try{
        const [orders, rewards] = await Promise.all([
          apiRequest(`/api/kancelaria/b2c/customer/orders?customer_id=${encodeURIComponent(id)}`),
          apiRequest(`/api/kancelaria/b2c/customer/rewards?customer_id=${encodeURIComponent(id)}`)
        ]);

        const row = state.rows.find(r=> String(r.id) === String(id));
        const marketing = { email: !!row.marketing_email, sms: !!row.marketing_sms, newsletter: !!row.marketing_newsletter };

        const rwHtml = (Array.isArray(rewards) && rewards.length) ? `
          <table><thead><tr><th>Dátum</th><th>Odmena</th><th>Body</th><th>Objednávka</th></tr></thead>
          <tbody>${rewards.map(rw=>{
            const dt = rw.datum_vytvorenia ? new Date(rw.datum_vytvorenia).toLocaleDateString('sk-SK') : '';
            const ord = rw.objednavka_id ? `#${rw.objednavka_id}` : '';
            return `<tr><td>${dt}</td><td>${escapeHtml(rw.nazov_odmeny||'')}</td><td>${Number(rw.pouzite_body||0)}</td><td>${ord}</td></tr>`;
          }).join('')}</tbody></table>` : '<p class="muted">Zatiaľ žiadne uplatnené odmeny.</p>';

        const html = `
          <div class="form-grid" style="grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <div class="form-group"><label>Zákaznícke ID</label><input value="${escapeHtml(row.zakaznik_id||'')}" disabled></div>
              <div class="form-group"><label>Meno</label><input id="cust-name" value="${escapeHtml(row.nazov_firmy||'')}"></div>
              <div class="form-group"><label>E-mail</label><input id="cust-email" value="${escapeHtml(row.email||'')}" disabled></div>
              <div class="form-group"><label>Telefón</label><input id="cust-phone" value="${escapeHtml(row.telefon||'')}"></input></div>
              <div class="form-group"><label>Fakturačná adresa</label><textarea id="cust-addr" rows="2">${escapeHtml(row.adresa||'')}</textarea></div>
              <div class="form-group"><label>Doručovacia adresa</label><textarea id="cust-addr2" rows="2">${escapeHtml(row.adresa_dorucenia||'')}</textarea></div>
            </div>
            <div>
              <fieldset class="form-group"><legend>Marketingové súhlasy</legend>
                <label><input type="checkbox" id="mk-email" ${marketing.email?'checked':''}> E-mail</label><br>
                <label><input type="checkbox" id="mk-sms"   ${marketing.sms?'checked':''}> SMS</label><br>
                <label><input type="checkbox" id="mk-news"  ${marketing.newsletter?'checked':''}> Newsletter</label><br>
              </fieldset>
              <fieldset class="form-group"><legend>Narodeniny</legend>
                <label>Mesiac: <input type="number" id="dob-mm" min="1" max="12" value="${row.dob_month||''}" placeholder="1-12" style="width:80px"></label>
                <label style="margin-left:12px">Rok: <input type="number" id="dob-yy" min="1900" max="2100" value="${row.dob_year_known? (new Date().getFullYear()) : ''}" placeholder="voliteľné" style="width:110px"></label><br>
                <label><input type="checkbox" id="dob-opt" ${row.birthday_bonus_opt_in?'checked':''}> Narodeninový bonus zapnutý</label>
              </fieldset>
              <fieldset class="form-group"><legend>Vernostné body</legend>
                <div style="display:flex;gap:8px;align-items:center">
                  <b>Aktuálne:</b> <span id="cust-points">${Number(row.vernostne_body||0)}</span>
                </div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                  <label>Úprava:</label>
                  <input id="adj-val" type="number" step="1" style="width:90px">
                  <input id="adj-reason" placeholder="Dôvod" style="flex:1">
                  <button class="btn btn-secondary btn-sm" id="adj-plus">+ Pripísať</button>
                  <button class="btn btn-secondary btn-sm" id="adj-minus">- Odobrať</button>
                </div>
              </fieldset>
            </div>
          </div>

          <h4 style="margin-top:1rem">História objednávok</h4>
          <div class="table-container" style="max-height:220px;overflow:auto">
            <table><thead><tr>
              <th>Číslo</th><th>Dátum</th><th>Dodanie</th><th>Predbežná</th><th>Finálna</th><th>Stav</th>
            </tr></thead><tbody id="cust-orders-tb"></tbody></table>
          </div>

          <h4 style="margin-top:1rem">Uplatnené odmeny</h4>
          <div class="table-container" style="max-height:200px;overflow:auto">${rwHtml}</div>

          <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
            <button class="btn btn-secondary" onclick="closeModal()">Zavrieť</button>
            <button class="btn btn-primary" id="cust-save">Uložiť profil</button>
          </div>
        `;
        Modal.show(`Profil zákazníka – ${escapeHtml(row.nazov_firmy||'')}`, html, (body)=>{
          const tb = body.querySelector('#cust-orders-tb');
          tb.innerHTML = (Array.isArray(orders) ? orders : []).map(o=>`
            <tr>
              <td>${escapeHtml(o.cislo_objednavky||String(o.id))}</td>
              <td>${o.datum_objednavky ? new Date(o.datum_objednavky).toLocaleDateString('sk-SK') : ''}</td>
              <td>${o.pozadovany_datum_dodania ? new Date(o.pozadovany_datum_dodania).toLocaleDateString('sk-SK') : ''}</td>
              <td>${o.predpokladana_suma_s_dph!=null ? Number(o.predpokladana_suma_s_dph).toFixed(2) : ''}</td>
              <td>${o.finalna_suma_s_dph!=null ? Number(o.finalna_suma_s_dph).toFixed(2) : ''}</td>
              <td>${escapeHtml(o.stav||'')}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" class="muted">Žiadne objednávky.</td></tr>';

          body.querySelector('#cust-save').onclick = async ()=>{
            const marketing = {
              email: body.querySelector('#mk-email').checked,
              sms:   body.querySelector('#mk-sms').checked,
              newsletter: body.querySelector('#mk-news').checked
            };
            const dob_mm = parseInt(body.querySelector('#dob-mm').value||'0', 10) || null;
            const dob_yy_raw = body.querySelector('#dob-yy').value.trim();
            const dob_yy = dob_yy_raw ? parseInt(dob_yy_raw,10) : null;
            const dob = {
              md: dob_mm ? `${String(dob_mm).padStart(2,'0')}-01` : null,
              iso_ymd: dob_yy ? `${dob_yy}-${String(dob_mm||1).padStart(2,'0')}-01` : null
            };
            const payload = {
              customer_id: row.id,
              name: body.querySelector('#cust-name').value || undefined,
              phone: body.querySelector('#cust-phone').value || undefined,
              address: body.querySelector('#cust-addr').value || undefined,
              delivery_address: body.querySelector('#cust-addr2').value || undefined,
              birthday_bonus_opt_in: body.querySelector('#dob-opt').checked,
              marketing, dob
            };
            try{
              await apiRequest('/api/kancelaria/b2c/customer/update_profile', { method:'POST', body: payload });
              showStatus('Profil uložený.', false);
              Modal.hide(); renderCustomersPro();
            }catch(e){ showStatus(e.message||String(e), true); }
          };

          const doAdjust = async (sign)=>{
            const v = body.querySelector('#adj-val').value; const delta = sign * Math.abs(parseInt(v||'0',10)||0);
            if (!delta){ showStatus('Zadaj nenulovú hodnotu úpravy bodov.', true); return; }
            const reason = body.querySelector('#adj-reason').value || '';
            try{
              await apiRequest('/api/kancelaria/b2c/customer/adjust_points', { method:'POST', body:{ customer_id: row.id, delta, reason } });
              await apiRequestQuietly('/api/kancelaria/b2c/sms/points', { method:'POST', body:{ user_email: row.email || undefined, points_delta: delta } });
              showStatus('Body upravené.', false);
              Modal.hide(); renderCustomersPro();
            }catch(e){ showStatus(e.message||String(e), true); }
          };
          body.querySelector('#adj-plus').onclick  = ()=> doAdjust(+1);
          body.querySelector('#adj-minus').onclick = ()=> doAdjust(-1);
        });

      }catch(e){ showStatus(e.message||String(e), true); }
    };

    root.__B2C_showCustOrders = async function(id){
      try{
        const rows = await apiRequest(`/api/kancelaria/b2c/customer/orders?customer_id=${encodeURIComponent(id)}`);
        const tbl = `
          <div class="table-container" style="max-height:65vh;overflow:auto">
            <table><thead><tr>
              <th>Číslo</th><th>Dátum</th><th>Dodanie</th><th>Predbežná</th><th>Finálna</th><th>Stav</th>
            </tr></thead><tbody>
            ${ (rows||[]).map(o=>`
              <tr>
                <td>${escapeHtml(o.cislo_objednavky||String(o.id))}</td>
                <td>${o.datum_objednavky ? new Date(o.datum_objednavky).toLocaleDateString('sk-SK') : ''}</td>
                <td>${o.pozadovany_datum_dodania ? new Date(o.pozadovany_datum_dodania).toLocaleDateString('sk-SK') : ''}</td>
                <td>${o.predpokladana_suma_s_dph!=null ? Number(o.predpokladana_suma_s_dph).toFixed(2) : ''}</td>
                <td>${o.finalna_suma_s_dph!=null ? Number(o.finalna_suma_s_dph).toFixed(2) : ''}</td>
                <td>${escapeHtml(o.stav||'')}</td>
              </tr>`).join('') || '<tr><td colspan="6" class="muted">Žiadne objednávky.</td></tr>'}
            </tbody></table>
          </div>`;
        Modal.show('Objednávky zákazníka', tbl);
      }catch(e){ showStatus(e.message||String(e), true); }
    };

    reload();
  }

  // =================================================================
  //                    CENNÍK (loader + FULL editor) – JEDINÝ BLOK
  // =================================================================
  function getOrCreatePricelistRoot(){
    let rootEl = doc.getElementById('b2c-admin-pricelist');
    if (!rootEl){
      const sec = doc.getElementById('b2c-pricelist-tab') || doc.body;
      rootEl = doc.createElement('div'); rootEl.id = 'b2c-admin-pricelist'; sec.appendChild(rootEl);
    }
    return rootEl;
  }

  root.loadB2CPricelistAdmin = function(){
    const rootEl = getOrCreatePricelistRoot();
    rootEl.innerHTML = `<div class="b2c-admin-wrap"><p style="padding:8px;">Načítavam cenník…</p></div>`;
    apiRequest('/api/kancelaria/b2c/get_pricelist_admin')
      .then(data => {
        root.renderB2CPricelistAdmin(data || { all_products:[], pricelist:[] });
      })
      .catch(err => rootEl.innerHTML = `<p class="error" style="color:#ef4444;padding:8px;">${escapeHtml(err.message||'Chyba načítania')}</p>`);
  };

  // >>> FULL editor cenníka (Vylepšený – 2 panely) <<<
  root.renderB2CPricelistAdmin = function renderB2CPricelistAdmin(data){
    const rootEl = getOrCreatePricelistRoot();
    const all = Array.isArray(data?.all_products) ? data.all_products : [];
    const pl  = Array.isArray(data?.pricelist)    ? data.pricelist    : [];

    // Indexovanie
    const byEAN = {}; all.forEach(p => { if(p.ean) byEAN[p.ean] = p; });
    const plByEAN = {}; pl.forEach(x => { if(x.ean_produktu) plByEAN[x.ean_produktu] = x; });
    
    // Udržiavanie state o tom, čo je v DB (pre insert vs update)
    const originalEANs = new Set(pl.map(x => String(x.ean_produktu || '').trim()).filter(Boolean));

    // Layout
    rootEl.innerHTML = `
      <style>
        .mini-btn{border:0;background:#e5e7eb;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:0.85rem;}
        .mini-btn.primary{background:#2563eb;color:#fff}
        .mini-btn.danger{background:#dc2626;color:#fff}
        .mini-btn.secondary{background:#64748b;color:#fff}
        .mini-btn.success{background:#16a34a;color:#fff}
        .mini-input{width:80px;padding:4px;border:1px solid #e5e7eb;border-radius:4px}
        .table-container table{width:100%;border-collapse:collapse}
        .table-container th,.table-container td{padding:8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:middle;}
        #b2c-admin-pricelist tr.flash{ outline:2px solid #22c55e; transition: outline .2s; }
        .cat-group summary { list-style: none; outline: none; }
        .cat-group summary::-webkit-details-marker { display: none; }
        .cat-group summary::after { content: '+'; float: right; font-weight: bold; }
        .cat-group[open] summary::after { content: '-'; }
        .badge { background: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 99px; font-size: 0.75rem; margin-left: 8px; }
      </style>
      
      <div class="form-grid" style="grid-template-columns: 1.2fr 1fr; gap: 20px; height: 80vh;">
        
        <div style="display:flex; flex-direction:column; height:100%; border-right: 1px solid #e2e8f0; padding-right: 10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <h4 style="margin:0;">B2C Cenník (${pl.length} položiek)</h4>
                <div>
                    <button class="mini-btn" id="pl-reload"><i class="fas fa-sync"></i></button>
                    <button class="mini-btn" id="pl-export"><i class="fas fa-file-export"></i> CSV</button>
                </div>
            </div>
            <div id="pl-table-wrapper" class="table-container" style="flex-grow:1; overflow:auto;"></div>
        </div>

        <div style="display:flex; flex-direction:column; height:100%; padding-left: 10px;">
            <h4 style="margin:0 0 10px 0;">Pridať z katalógu</h4>
            <input id="pl-cat-search" class="form-control" placeholder="Hľadať produkt alebo EAN..." style="margin-bottom:10px;">
            <div id="pl-catalog-wrapper" style="flex-grow:1; overflow:auto; padding:10px; background:#f8fafc; border-radius:8px;"></div>
        </div>
      </div>
    `;

    // 2. Render Ľavý panel (Tabuľka Cenníka)
    function renderPricelist() {
        const wrapper = rootEl.querySelector('#pl-table-wrapper');
        if (!pl.length) { wrapper.innerHTML = '<p class="muted p-2">Cenník je prázdny.</p>'; return; }

        let html = `<table class="tbl"><thead>
            <tr>
                <th>Produkt</th>
                <th>Cena (bez DPH)</th>
                <th>Akcia</th>
                <th>Akciová</th>
                <th></th>
            </tr>
        </thead><tbody>`;

        pl.forEach(item => {
            const prod = byEAN[item.ean_produktu] || {};
            const name = prod.nazov_vyrobku || item.ean_produktu;
            const price = item.cena_bez_dph || 0;
            const isPromo = !!item.je_v_akcii;
            const promoPrice = item.akciova_cena_bez_dph || 0;

            html += `<tr data-ean="${item.ean_produktu}">
                <td>
                    <div style="font-weight:500; font-size:0.9rem;">${escapeHtml(name)}</div>
                    <small class="muted" style="font-size:0.75rem;">${item.ean_produktu}</small>
                </td>
                <td>
                    <input type="number" class="mini-input pl-price" step="0.01" value="${price}">
                </td>
                <td style="text-align:center;">
                    <input type="checkbox" class="pl-is-promo" ${isPromo?'checked':''}>
                </td>
                <td>
                    <input type="number" class="mini-input pl-promo-price" step="0.01" value="${promoPrice}" style="width:70px; ${isPromo?'':'display:none'}">
                </td>
                <td style="white-space:nowrap;">
                    <button class="mini-btn secondary pl-info" title="Info & Foto"><i class="fas fa-info-circle"></i></button>
                    <button class="mini-btn success pl-save" title="Uložiť"><i class="fas fa-save"></i></button>
                    <button class="mini-btn danger pl-del" title="Odobrať"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        wrapper.innerHTML = html;

        // Eventy pre tabuľku
        wrapper.querySelectorAll('.pl-is-promo').forEach(cb => cb.onchange = (e) => {
            e.target.closest('tr').querySelector('.pl-promo-price').style.display = e.target.checked ? 'inline-block' : 'none';
        });
        
        // SAVE
        wrapper.querySelectorAll('.pl-save').forEach(btn => btn.onclick = (e) => saveRow(e.target.closest('tr')));
        
        // DELETE
        wrapper.querySelectorAll('.pl-del').forEach(btn => btn.onclick = (e) => deleteRow(e.target.closest('tr')));

        // INFO MODAL
        wrapper.querySelectorAll('.pl-info').forEach(btn => btn.onclick = (e) => {
            const tr = e.target.closest('tr');
            const ean = tr.dataset.ean;
            const prodName = byEAN[ean]?.nazov_vyrobku || ean;
            openProductMetaModal(ean, prodName);
        });
    }

    // 3. Render Pravý panel (Katalóg podľa kategórií)
    function renderCatalog(filter = '') {
        const wrapper = rootEl.querySelector('#pl-catalog-wrapper');
        const q = filter.toLowerCase();

        // Zoskupenie podľa kategórie
        const groups = {};
        all.forEach(p => {
            if (plByEAN[p.ean]) return; // Už je v cenníku
            const match = !q || (p.nazov_vyrobku||'').toLowerCase().includes(q) || (p.ean||'').includes(q);
            if (!match) return;

            const cat = p.predajna_kategoria || p.kategoria_pre_recepty || 'Nezaradené';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(p);
        });

        if (Object.keys(groups).length === 0) {
            wrapper.innerHTML = '<p class="muted">Žiadne produkty na pridanie.</p>';
            return;
        }

        let html = '';
        // Sort categories alphabetically, put 'Nezaradené' last
        const sortedCats = Object.keys(groups).sort((a,b) => {
            if(a === 'Nezaradené') return 1;
            if(b === 'Nezaradené') return -1;
            return a.localeCompare(b);
        });

        sortedCats.forEach(cat => {
            const count = groups[cat].length;
            html += `<details ${filter ? 'open' : ''} class="cat-group" style="margin-bottom:8px; border:1px solid #e2e8f0; border-radius:6px; background:#fff;">
                <summary style="padding:10px; font-weight:600; cursor:pointer; background:#f1f5f9; border-radius:6px;">
                    ${escapeHtml(cat)} <span class="badge">${count}</span>
                </summary>
                <div style="padding:0 10px 10px 10px;">`;
            
            groups[cat].forEach(p => {
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;">
                    <div style="flex-grow:1; padding-right:8px;">
                        <div style="font-weight:500; font-size:0.9rem;">${escapeHtml(p.nazov_vyrobku)}</div>
                        <small class="muted" style="font-size:0.75rem;">${p.ean} • DPH ${Number(p.dph)}%</small>
                    </div>
                    <button class="mini-btn primary cat-add" data-ean="${p.ean}">Pridať</button>
                </div>`;
            });
            html += `</div></details>`;
        });
        wrapper.innerHTML = html;

        wrapper.querySelectorAll('.cat-add').forEach(btn => btn.onclick = () => {
            addToPricelist(btn.dataset.ean);
        });
    }

    // LOGIKA: Pridanie do cenníka
    function addToPricelist(ean) {
        if (plByEAN[ean]) return;
        
        // Pridáme lokálne do poľa
        const newItem = { ean_produktu: ean, cena_bez_dph: 0, je_v_akcii: 0, akciova_cena_bez_dph: 0 };
        pl.unshift(newItem); // Pridať na začiatok
        plByEAN[ean] = newItem;
        
        // Prekreslíme
        renderPricelist();
        renderCatalog(rootEl.querySelector('#pl-cat-search').value);
        
        // Scroll na nový riadok a focus
        setTimeout(() => {
            const tr = rootEl.querySelector(`tr[data-ean="${ean}"]`);
            if(tr) {
                tr.scrollIntoView({behavior: "smooth", block: "center"});
                tr.classList.add('flash');
                const inp = tr.querySelector('.pl-price');
                if(inp) { inp.focus(); inp.select(); }
                setTimeout(()=> tr.classList.remove('flash'), 1000);
            }
        }, 100);
    }

    // LOGIKA: Uloženie riadku
    async function saveRow(tr) {
        const ean = tr.dataset.ean;
        const priceVal = parseFloat(tr.querySelector('.pl-price').value) || 0;
        const isPromo = tr.querySelector('.pl-is-promo').checked ? 1 : 0;
        const promoPriceVal = parseFloat(tr.querySelector('.pl-promo-price').value) || 0;

        if (priceVal <= 0) { showStatus('Cena musí byť > 0', true); return; }

        // PAYLOAD
        const payload = {
            ean: ean,
            price: Number(priceVal.toFixed(2)),
            is_akcia: isPromo,
            sale_price: isPromo ? Number(promoPriceVal.toFixed(2)) : null
        };

        try {
            // 1. Ak je EAN nový (nie je v originalEANs), treba ho pridať cez add_to_pricelist
            if (!originalEANs.has(ean)) {
                await apiRequest('/api/kancelaria/b2c/add_to_pricelist', { 
                    method: 'POST', 
                    body: { items: [{ ean: ean, price: payload.price }] } 
                });
                originalEANs.add(ean);
            }

            // 2. Update detailov (cena, akcia)
            await apiRequest('/api/kancelaria/b2c/update_pricelist', { 
                method: 'POST', 
                body: { items: [payload] } 
            });

            // Lokálny update dát
            const item = plByEAN[ean];
            if(item) {
                item.cena_bez_dph = payload.price;
                item.je_v_akcii = payload.is_akcia;
                item.akciova_cena_bez_dph = payload.sale_price;
            }

            showStatus('Uložené', false);
            tr.style.backgroundColor = '#dcfce7'; // Light green success flash
            setTimeout(()=>tr.style.backgroundColor='', 1000);
        } catch(e) {
            showStatus('Chyba ukladania: '+e.message, true);
        }
    }

    // LOGIKA: Zmazanie
    async function deleteRow(tr) {
        const ean = tr.dataset.ean;
        if(!confirm(`Naozaj odstrániť položku ${ean} z cenníka?`)) return;
        
        try {
            // Backend API na zmazanie (cez update_pricelist s remove=true, ak to podporuje, inak treba impl. delete)
            // Predpokladáme, že update_pricelist podporuje {remove: true} podľa tvojho pôvodného kódu
            await apiRequest('/api/kancelaria/b2c/update_pricelist', {
                method:'POST',
                body:{ items:[{ ean: ean, ean_produktu: ean, remove: true }] }
            });

            // Lokálny remove
            const idx = pl.findIndex(x => (x.ean_produktu || x.ean) === ean);
            if (idx !== -1) pl.splice(idx, 1);
            delete plByEAN[ean];
            if(originalEANs.has(ean)) originalEANs.delete(ean);

            renderPricelist();
            renderCatalog(rootEl.querySelector('#pl-cat-search').value);
            showStatus('Položka odstránená.', false);
        } catch(e) {
            showStatus('Chyba mazania: '+e.message, true);
        }
    }

    function exportCSV(){
      const headers = ['EAN','Produkt','Cena_bez_DPH','Je_v_akcii','Akciova_cena_bez_DPH','DPH'];
      const rows = pl.map(x=>{
        const e = x.ean_produktu || x.ean;
        const p = byEAN[e] || {};
        const name = (p.nazov_vyrobku || p.nazov_produktu || '').replace(/\s+/g,' ');
        return [e, name, (x.cena_bez_dph||0), (x.je_v_akcii?1:0), (x.akciova_cena_bez_dph||0), (p.dph||0)];
      });
      const csv = [headers.join(';')].concat(rows.map(a=> a.join(';'))).join('\n');
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob);
      const a = doc.createElement('a'); a.href = url; a.download = `b2c_cennik_${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);
    }

    // Bind global buttons
    rootEl.querySelector('#pl-reload').onclick = () => root.loadB2CPricelistAdmin();
    rootEl.querySelector('#pl-export').onclick = exportCSV;
    rootEl.querySelector('#pl-cat-search').addEventListener('input', (e) => renderCatalog(e.target.value));

    // Initial Render
    renderPricelist();
    renderCatalog();
  };
// --- INFO MODAL (Foto + Popis) - S NAČÍTANÍM ---
async function openProductMetaModal(ean, name) {
    // 1. Najprv načítame aktuálne dáta zo servera
    let currentMeta = {};
    try {
        currentMeta = await apiRequest(`/api/kancelaria/b2c/get_product_meta?ean=${ean}`);
    } catch (e) { console.warn('Nepodarilo sa načítať meta dáta'); }

    const html = `
        <div class="form-grid" style="gap:15px;">
            <div class="form-group">
                <label style="display:block; margin-bottom:5px; font-weight:600;">Popis produktu / Zloženie / Alergény:</label>
                <textarea id="meta-desc" class="form-control" rows="8" placeholder="Zadajte popis produktu, zloženie a alergény...">${escapeHtml(currentMeta.popis || '')}</textarea>
            </div>
            <div class="form-group">
                <label style="display:block; margin-bottom:5px; font-weight:600;">Fotografia produktu:</label>
                <input type="file" id="meta-file" accept="image/*" class="form-control">
                <div id="meta-img-preview" style="margin-top:10px; border:1px solid #eee; min-height:100px; display:flex; align-items:center; justify-content:center; background:#f9fafb; border-radius:6px;">
                    ${currentMeta.obrazok 
                        ? `<img src="${currentMeta.obrazok}" style="max-width:100%; max-height:250px; border-radius:4px;">` 
                        : '<span class="muted">Žiadny obrázok</span>'}
                </div>
                <input type="hidden" id="meta-img-url" value="${escapeHtml(currentMeta.obrazok || '')}">
            </div>
        </div>
        <div style="text-align:right; margin-top:20px;">
            <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
            <button id="meta-save-btn" class="btn btn-primary">Uložiť informácie</button>
        </div>
    `;

    Modal.show(`Info: ${escapeHtml(name)} <small class="muted">(${ean})</small>`, html, async (body) => {
        const descEl = body.querySelector('#meta-desc');
        const fileEl = body.querySelector('#meta-file');
        const previewEl = body.querySelector('#meta-img-preview');
        const urlEl = body.querySelector('#meta-img-url');

        // Upload obrázka
        fileEl.onchange = async () => {
            if (!fileEl.files[0]) return;
            const fd = new FormData();
            fd.append('file', fileEl.files[0]);
            previewEl.innerHTML = '<span class="muted">Nahrávam...</span>';
            try {
                const res = await fetch('/api/kancelaria/b2c/upload_image', { method:'POST', body: fd }).then(r=>r.json());
                if (res.url) {
                    urlEl.value = res.url;
                    previewEl.innerHTML = `<img src="${res.url}" style="max-width:100%; max-height:250px; border-radius:4px;">`;
                } else {
                    previewEl.innerHTML = '<span class="loss">Chyba nahrávania</span>';
                }
            } catch(e) { 
                alert('Upload zlyhal'); 
                previewEl.innerHTML = '<span class="loss">Chyba spojenia</span>';
            }
        };

        // Uloženie
        body.querySelector('#meta-save-btn').onclick = async () => {
            const desc = descEl.value;
            const img = urlEl.value;
            try {
                await apiRequest('/api/kancelaria/b2c/save_product_meta', {
                    method: 'POST',
                    body: { ean, description: desc, image_url: img }
                });
                showStatus('Info uložené', false);
                Modal.hide();
            } catch(e) { showStatus('Chyba: '+e.message, true); }
        };
    });
}
  // =================================================================
  //                    ODMENY – základné UI
  // =================================================================
  async function loadB2CRewardsAdmin(){
    const el = doc.getElementById('b2c-rewards-tab');
    el.innerHTML = '<p>Načítavam odmeny…</p>';
    try{
      let rewards = await apiRequest('/api/kancelaria/b2c/get_rewards');
      rewards = Array.isArray(rewards) ? rewards : [];
      const today = todayISO();

      el.innerHTML = `
        <div class="form-grid" style="gap: 20px;">
          <div>
            <h4>Vytvoriť novú odmenu</h4>
            <form id="b2c-new-reward" style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0;">
              <div class="form-group"><label>Názov odmeny</label><input id="b2c-reward-name" class="form-control" required></div>
              <div class="form-group"><label>Počet bodov</label><input id="b2c-reward-points" type="number" min="1" class="form-control" required></div>
              <div class="form-grid" style="grid-template-columns:1fr 1fr; gap:10px;">
                  <div class="form-group"><label>Platnosť od</label><input id="b2c-reward-from" type="date" class="form-control" value="${today}"></div>
                  <div class="form-group"><label>Platnosť do</label><input id="b2c-reward-to" type="date" class="form-control"></div>
              </div>
              <button type="submit" class="btn btn-success" style="width:100%; margin-top:10px;">Vytvoriť odmenu</button>
            </form>
          </div>
          <div>
            <h4>Zoznam odmien</h4>
            <div class="table-container">
              <table id="b2c-rewards-table">
                <thead>
                  <tr>
                    <th>Názov</th><th>Body</th><th>Platnosť od</th><th>Platnosť do</th><th>Stav</th><th>Akcie</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      const tb = el.querySelector('#b2c-rewards-table tbody');
      rewards.forEach(r=>{
        const vf = (r.valid_from && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_from)) ? r.valid_from : '';
        const vt = (r.valid_to   && /^\d{4}-\d{2}-\d{2}$/.test(r.valid_to))   ? r.valid_to   : '';
        const expired  = !!(vt && vt < today);
        const upcoming = !!(vf && vf > today);
        let statusLabel = expired
          ? '<span class="loss">Expirovaná</span>'
          : (upcoming && !r.je_aktivna ? '<span class="loss">Ešte nezačala</span>' : (r.je_aktivna ? '<span class="gain">Aktívna</span>' : '<span class="loss">Neaktívna</span>'));

        const tr = document.createElement('tr');
        tr.dataset.id  = r.id;
        tr.dataset.raw = encodeURIComponent(JSON.stringify(r));
        tr.innerHTML = `
          <td>${escapeHtml(r.nazov_odmeny||'')}</td>
          <td>${Number(r.potrebne_body||0)}</td>
          <td>${escapeHtml(vf)}</td>
          <td>${escapeHtml(vt)}</td>
          <td>${statusLabel}</td>
          <td>
            <div class="btn-grid" style="grid-template-columns:auto auto;gap:.25rem;">
              <button class="btn btn-secondary btn-sm" onclick="window.__B2C_openRewardEdit('${tr.dataset.raw}')">Upraviť</button>
              <button class="btn btn-warning  btn-sm" onclick="window.__B2C_toggleReward('${tr.dataset.raw}')">${r.je_aktivna ? 'Deaktivovať' : 'Aktivovať'}</button>
            </div>
          </td>
        `;
        tb.appendChild(tr);
      });

      el.querySelector('#b2c-new-reward').onsubmit = async (ev)=>{
        ev.preventDefault();
        const name = (el.querySelector('#b2c-reward-name').value||'').trim();
        const points = el.querySelector('#b2c-reward-points').value;
        const valid_from = el.querySelector('#b2c-reward-from').value || null;
        const valid_to   = el.querySelector('#b2c-reward-to').value   || null;
        if (!name || !points){ showStatus('Vyplň názov aj body.', true); return; }
        try{
          await apiRequest('/api/kancelaria/b2c/add_reward', { method:'POST', body:{ name, points, valid_from, valid_to } });
          showStatus('Odmena vytvorená.', false);
          loadB2CRewardsAdmin();
        }catch(e){ showStatus(e.message||String(e), true); }
      };

    }catch(e){
      el.innerHTML = `<p class="error">Chyba pri načítaní odmien: ${escapeHtml(e.message||String(e))}</p>`;
    }
  }

  root.__B2C_toggleReward = async function(encoded){
    const r = JSON.parse(decodeURIComponent(encoded||'%7B%7D'));
    const today = todayISO();
    const vf = r.valid_from || '';
    const vt = r.valid_to || '';
    const expired = !!(vt && vt < today);
    const upcoming = !!(vf && vf > today);

    if (!r.je_aktivna && (expired || upcoming)){
      showStatus(expired ? 'Odmenu nemožno aktivovať – platnosť už skončila. Upravte dátumy.' :
                            'Odmenu nemožno aktivovať – platnosť ešte nezačala. Upravte dátumy.', true);
      root.__B2C_openRewardEdit(encoded);
    } else {
      try{
        await apiRequest('/api/kancelaria/b2c/toggle_reward_status', { method:'POST', body:{ id: r.id, status: r.je_aktivna } });
        loadB2CRewardsAdmin();
      }catch(e){ showStatus(e.message||String(e), true); }
    }
  };

  root.__B2C_openRewardEdit = function(encoded){
    const r = JSON.parse(decodeURIComponent(encoded||'%7B%7D'));
    const iso = (s)=> (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : '';
    const vf0 = iso(r.valid_from), vt0 = iso(r.valid_to);
    const html = `
      <div class="form-grid" style="min-width:340px">
        <div class="form-group"><label>Názov odmeny</label><input id="rw-name" class="form-control" value="${escapeHtml(r.nazov_odmeny||'')}" autocomplete="off"></div>
        <div class="form-group"><label>Počet bodov</label><input id="rw-points" type="number" min="1" step="1" class="form-control" value="${Number(r.potrebne_body||0)}"></div>
        <div class="form-group"><label>Platnosť od</label><input id="rw-from" type="date" class="form-control" value="${escapeHtml(vf0)}"></div>
        <div class="form-group"><label>Platnosť do</label><input id="rw-to" type="date" class="form-control" value="${escapeHtml(vt0)}"></div>
        <div class="form-group" style="grid-column:1 / -1; display:flex; gap:.5rem; align-items:center;">
          <button class="btn btn-secondary btn-sm" type="button" onclick="document.querySelector('#b2c-modal .b2c-modal-body #rw-from').value=''">Vymazať „Platnosť od“</button>
          <button class="btn btn-secondary btn-sm" type="button" onclick="document.querySelector('#b2c-modal .b2c-modal-body #rw-to').value=''">Vymazať „Platnosť do“</button>
          <span class="muted" style="margin-left:auto;font-size:.9rem;">Prázdne dátumy sa uložia ako „bez obmedzenia“.</span>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-secondary" type="button" onclick="closeModal()">Zrušiť</button>
        <button class="btn btn-primary"   type="button" id="rw-save">Uložiť</button>
      </div>
    `;
    Modal.show(`Upraviť odmenu #${r.id}`, html, (body)=>{
      const saveBtn = body.querySelector('#rw-save');
      saveBtn.onclick = async ()=>{
        const name  = (body.querySelector('#rw-name')?.value || '').trim();
        const pts   = Number(body.querySelector('#rw-points')?.value || 0);
        const vf    = body.querySelector('#rw-from')?.value || null;
        const vt    = body.querySelector('#rw-to')?.value   || null;
        if (!name || !(pts > 0)) { showStatus('Vyplň názov a počet bodov (> 0).', true); return; }
        if (vf && !/^\d{4}-\d{2}-\d{2}$/.test(vf)) { showStatus('Neplatný formát dátumu „Platnosť od“ – použite YYYY-MM-DD.', true); return; }
        if (vt && !/^\d{4}-\d{2}-\d{2}$/.test(vt)) { showStatus('Neplatný formát dátumu „Platnosť do“ – použite YYYY-MM-DD.', true); return; }
        if (vf && vt && vf > vt) { showStatus('„Platnosť od“ nemôže byť po „Platnosť do“.', true); return; }

        try{
          await apiRequest('/api/kancelaria/b2c/update_reward', { method:'POST', body:{ id: r.id, name, points: pts, valid_from: vf, valid_to: vt } });
          showStatus('Odmena uložená.', false);
          Modal.hide(); loadB2CRewardsAdmin();
        }catch(e){ showStatus(e.message||String(e), true); }
      };
    });
  };

  root.initializeB2CAdminModule = initializeB2CAdminModule;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initializeB2CAdminModule);
  else initializeB2CAdminModule();

})(window, document);