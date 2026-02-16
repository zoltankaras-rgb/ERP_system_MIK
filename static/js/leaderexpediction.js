(function (root, doc) {
  'use strict';

  // ========================= HELPERS ===========================
  const $  = (sel, el = doc) => (el || doc).querySelector(sel);
  const $$ = (sel, el = doc) => Array.from((el || doc).querySelectorAll(sel));
  if (!root.$)  root.$  = $;
  if (!root.$$ ) root.$$ = $$;

  const escapeHtml = (s)=> String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const todayISO  = () => new Date().toISOString().slice(0,10);
  const safeStr   = v => String(v ?? '').trim();
  const toNum     = (v,d=0)=>{ const n = Number(String(v??'').replace(/[^\d.,-]/g,'').replace(',','.')); return Number.isFinite(n) ? n : d; };
  const fmt2      = n => (Number(n||0)).toFixed(2);

  const apiRequest = (root.apiRequest) ? root.apiRequest : async (url, options={})=>{
    const opts = Object.assign({credentials:'same-origin', headers:{}}, options);
    if (opts.body && typeof opts.body==='object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    const ct  = (res.headers.get('content-type')||'').toLowerCase();
    const data= ct.includes('application/json')? await res.json(): await res.text();
    if (!res.ok) throw new Error((data && data.error) || res.statusText || ('HTTP '+res.status));
    return data;
  };

  const showStatus = (root.showStatus) ? root.showStatus : (msg,isErr=false)=>{
    (isErr?console.error:console.log)(msg);
    let el = $('#status-bar'); if(!el){ el = doc.createElement('div'); el.id='status-bar';
      el.style.cssText='position:fixed;left:16px;bottom:16px;padding:12px 18px;border-radius:8px;color:#fff;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-family:sans-serif;font-size:14px;';
      doc.body.appendChild(el);
    }
    el.textContent = msg; el.style.background = isErr?'#ef4444':'#10b981';
    el.style.display = 'block';
    clearTimeout(el._t); el._t=setTimeout(()=> el.style.display='none', 3500);
  };

  // ====================== CACHE NÁZVOV PODĽA EAN ========================
  const __nameByEAN = Object.create(null);
  async function ensureNamesForEans(eanList){
    const missing = (eanList || []).map(e => String(e || '').trim()).filter(e => e && __nameByEAN[e] == null);
    if (!missing.length) return __nameByEAN;
    try {
      const map = await apiRequest('/api/leader/catalog/names?eans=' + encodeURIComponent(missing.join(',')));
      Object.keys(map || {}).forEach(e => { __nameByEAN[String(e)] = String(map[e] || ''); });
    } catch (_) { }
    return __nameByEAN;
  }

  // ========================= MODALY ==============================
  function modalPrompt({title,label,placeholder='',type='text',okText='OK',cancelText='Zrušiť',pattern=null}) {
    return new Promise((resolve)=>{
      const wrapId='ldr-mini-modal'; let wrap=document.getElementById(wrapId);
      if(!wrap){
        wrap=document.createElement('div'); wrap.id=wrapId;
        wrap.innerHTML=`<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000"><div style="max-width:520px;width:clamp(300px,92vw,520px);background:#fff;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden"><div style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #eee;background:#f8fafc;font-weight:600" id="mm-title"></div><div style="padding:14px" id="mm-body"></div><div style="display:flex;gap:.5rem;justify-content:flex-end;padding:12px;border-top:1px solid #eee"><button class="btn btn-secondary" id="mm-cancel">${cancelText}</button><button class="btn btn-primary" id="mm-ok">${okText}</button></div></div></div>`;
        document.body.appendChild(wrap);
      }
      const t=wrap.querySelector('#mm-title'), b=wrap.querySelector('#mm-body'), ok=wrap.querySelector('#mm-ok'), cc=wrap.querySelector('#mm-cancel');
      t.textContent=title||'Potvrdenie';
      b.innerHTML = type==='textarea' ? `<label class="muted" style="display:block;margin-bottom:6px">${escapeHtml(label||'')}</label><textarea id="mm-input" rows="4" placeholder="${escapeHtml(placeholder)}" style="width:100%;padding:.5rem;border:1px solid #e5e7eb;border-radius:8px"></textarea>` : `<label class="muted" style="display:block;margin-bottom:6px">${escapeHtml(label||'')}</label><input id="mm-input" type="${type}" placeholder="${escapeHtml(placeholder)}" style="width:100%;padding:.5rem;border:1px solid #e5e7eb;border-radius:8px">`;
      wrap.style.display='block'; const ip=b.querySelector('#mm-input'); setTimeout(()=>ip.focus(),10);
      function done(v){ wrap.style.display='none'; resolve(v); }
      cc.onclick=()=>done(null); ok.onclick=()=>{ const v=(ip.value||'').trim(); if (pattern && !pattern.test(v)) { ip.focus(); return; } done(v); };
      ip.addEventListener('keydown',(e)=>{ if(e.key==='Enter' && type!=='textarea'){ ok.click(); }});
    });
  }
  function modalConfirm({title,message,okText='Áno',cancelText='Nie'}){
    return new Promise((resolve)=>{
      const id='ldr-confirm-modal'; let w=document.getElementById(id);
      if(!w){
        w=document.createElement('div'); w.id=id;
        w.innerHTML=`<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000"><div style="max-width:480px;width:clamp(300px,92vw,480px);background:#fff;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden"><div style="display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #eee;background:#f8fafc;font-weight:600" id="cf-title"></div><div style="padding:14px" id="cf-msg"></div><div style="display:flex;gap:.5rem;justify-content:flex-end;padding:12px;border-top:1px solid #eee"><button class="btn btn-secondary" id="cf-no">${cancelText}</button><button class="btn btn-primary" id="cf-yes">${okText}</button></div></div></div>`;
        document.body.appendChild(w);
      }
      w.querySelector('#cf-title').textContent = title || 'Potvrdenie'; w.querySelector('#cf-msg').innerHTML = message || ''; w.style.display='block';
      const yes=w.querySelector('#cf-yes'), no=w.querySelector('#cf-no');
      function done(v){ w.style.display='none'; resolve(v); }
      no.onclick=()=>done(false); yes.onclick=()=>done(true);
    });
  }

function modal(title, inner, onReady){
    let wrap = $('#ldr-modal');
    if (!wrap){
      wrap = doc.createElement('div'); wrap.id='ldr-modal';
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(2px);';
      wrap.innerHTML = `<div class="b2c-modal-card" style="position:relative;background:#fff;border-radius:12px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);width:clamp(320px,90vw,600px);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;"></div>`;
      doc.body.appendChild(wrap);
    }
    const card = wrap.querySelector('.b2c-modal-card');
    card.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;font-size:1.125rem;font-weight:600;color:#111;">${escapeHtml(title)}</h3>
        <button type="button" style="background:transparent;border:none;font-size:1.5rem;cursor:pointer;color:#6b7280;" onclick="closeModal()">&times;</button>
      </div>
      <div class="b2c-modal-body" style="padding:20px;overflow-y:auto;">${inner}</div>
    `;
    wrap.style.display = 'flex';
    root.closeModal = ()=> { wrap.style.display='none'; };
    if (typeof onReady === 'function') onReady(card.querySelector('.b2c-modal-body'));
  }

  // --- TOTO JE ČASŤ, KTORÁ VÁM CHÝBALA PRE KALENDÁR ---
  // Adaptér: keď calendar_planner.js zavolá showModal, presmerujeme to na našu funkciu modal
  root.showModal = (title, factory) => {
      if (typeof factory !== 'function') return;
      const res = factory(); // Získame { html, onReady } z buildera
      modal(title, res.html, res.onReady);
  };
  // ========================= SHARED B2B STATE =====================
  var __pickedCustomer = null; var __pickedPricelist = null; var __pricelistMapByEAN = Object.create(null);

  // ============================== DASHBOARD ================================
  async function loadDashboard(){
    const $id = (s)=>document.getElementById(s);
    const d = ($id('ldr-date') && $id('ldr-date').value) || todayISO();
    const skDate = (iso)=> new Date((iso||todayISO()) + 'T00:00:00').toLocaleDateString('sk-SK');
    const E = (html)=> escapeHtml(html||'');

    try{
      const r = await apiRequest(`/api/leader/dashboard?date=${encodeURIComponent(d)}`);
      if($id('kpi-b2c')) $id('kpi-b2c').textContent   = (r.kpi && r.kpi.b2c_count!=null)   ? r.kpi.b2c_count   : '—';
      if($id('kpi-b2b')) $id('kpi-b2b').textContent   = (r.kpi && r.kpi.b2b_count!=null)   ? r.kpi.b2b_count   : '—';
      if($id('kpi-items')) $id('kpi-items').textContent = (r.kpi && r.kpi.items_total!=null) ? r.kpi.items_total : '—';
      if($id('kpi-sum')) $id('kpi-sum').textContent   = (r.kpi && r.kpi.sum_total!=null)   ? `${fmt2(r.kpi.sum_total)} €` : '—';

      const planHost = $id('plan-preview');
      if (planHost) {
          if (Array.isArray(r.production_plan_preview) && r.production_plan_preview.length){
            planHost.innerHTML = r.production_plan_preview.map(p=>`
              <div style="padding:8px;border-bottom:1px solid #eee;display:flex;gap:8px;align-items:center;${p.is_tomorrow?'background:#fff7ed;border-left:3px solid #f59e0b;':''}">
                <div style="width:120px"><b>${skDate(p.date)}</b></div>
                <div class="muted">${E(p.note||'')}</div>
                ${p.is_tomorrow ? '<span style="margin-left:auto;color:#f59e0b;font-weight:600">Zajtra</span>' : ''}
              </div>`).join('');
          } else { planHost.innerHTML = '<div class="muted">Žiadne dáta.</div>'; }
      }

      // Ostatné dashboard widgety
      const nextHost = document.getElementById('leader-next7');
      if(nextHost && r.next7_orders) {
          const rows = r.next7_orders.map(x=>{
              const dt = x.date;
              const wd = new Date(dt+'T00:00:00').toLocaleDateString('sk-SK',{ weekday:'short' });
              return `<tr><td>${skDate(dt)}</td><td>${wd}</td><td class="num">${x.b2c}</td><td class="num">${x.b2b}</td><td class="num"><strong>${x.total}</strong></td></tr>`;
          }).join('');
          nextHost.innerHTML = `<div class="card" style="margin-top:16px"><div class="card-header"><strong>Objednávky na najbližších 7 dní</strong></div><div class="card-body"><div class="table-container"><table class="tbl"><thead><tr><th>Dátum</th><th>Deň</th><th>B2C</th><th>B2B</th><th>Spolu</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
      }

    }catch(e){ showStatus(e.message||String(e), true); }
  }

  async function commitPlan(){
    const d = $('#ldr-date').value || todayISO();
    try{ await apiRequest(`/api/leader/production/plan?start=${encodeURIComponent(d)}&days=7&commit=1`); showStatus('Plán výroby zapísaný.', false); }
    catch(e){ showStatus(e.message||String(e), true); }
  }

  async function loadLeaderLowStockDetail() {
    const host = document.getElementById('leader-lowstock-detail');
    if (!host) return;
    host.innerHTML = '<div class="muted" style="padding:1rem;">Načítavam návrh nákupu...</div>';
    try {
      const suggestions = await apiRequest('/api/kancelaria/get_goods_purchase_suggestion');
      if (!suggestions || !suggestions.length) { host.innerHTML = '<div class="card" style="margin-top:12px"><div class="card-body"><div class="muted">Aktuálne nie je potrebné doobjednať žiadny tovar.</div></div></div>'; return; }
      const byCat = {};
      suggestions.forEach(item => {
        const salesCat = item.predajna_kategoria || item.sales_category || item.kategoria_pre_recepty || '';
        const itemType = item.typ_polozky || item.item_type || '';
        let header = (itemType && salesCat) ? `${itemType} – ${salesCat}` : (salesCat || itemType || 'Bez kategórie');
        if (!byCat[header]) byCat[header] = [];
        byCat[header].push(item);
      });
      let html = '<p>Prehľad všetkých výrobkov a tovaru, ktoré sú pod minimálnou zásobou na centrálnom sklade (z návrhu nákupu).</p>';
      Object.keys(byCat).sort().forEach(header => {
        const items = byCat[header];
        html += `<h4 style="margin-top:1rem;">${escapeHtml(header)}</h4><div class="table-container" style="max-height:none;"><table><thead><tr><th>Názov Tovaru</th><th>Aktuálny Sklad</th><th>Min. Sklad</th><th>Rezervované</th><th>Návrh na Nákup</th><th>Poznámka</th></tr></thead><tbody>`;
        items.forEach(item => {
          const stock = Number(item.stock || 0); const min = Number(item.min_stock || 0); const res = Number(item.reserved || 0); const sug = Number(item.suggestion || 0); const unit = item.unit || 'kg';
          const isBelowMin = stock - res < min;
          html += `<tr ${isBelowMin ? 'style="background:#fff7ed;"' : ''}><td><strong>${escapeHtml(item.name)}</strong></td><td>${stock.toFixed(2)} ${unit}</td><td>${min.toFixed(2)} ${unit}</td><td>${res.toFixed(2)} ${unit}</td><td class="loss">${sug.toFixed(2)} ${unit}</td><td>${isBelowMin ? '<span class="chip">Pod minimom</span> ' : ''}${item.is_promo ? '<span class="btn btn-danger" style="padding:.125rem .4rem; font-size:.8rem;">PREBIEHA AKCIA!</span>' : ''}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      });
      host.innerHTML = html;
    } catch (e) { host.innerHTML = `<div class="error" style="padding:1rem;">Chyba: ${escapeHtml(e.message || '')}</div>`; }
  }

  async function loadLeaderProductionCalendar() {
    const rootEl = document.getElementById('planner-inline-root');
    if (!rootEl) return;
    rootEl.innerHTML = '';
    try {
      if (typeof root.renderProductionPlanInline === 'function') { await root.renderProductionPlanInline(); } 
      else { rootEl.innerHTML = '<div class="muted" style="padding:1rem;">Kalendár výroby (planning.js) nie je dostupný.</div>'; }
    } catch (e) { rootEl.innerHTML = `<div class="error" style="padding:1rem;">Chyba pri načítaní kalendára: ${escapeHtml(e.message || String(e))}</div>`; }
  }

  // ============================== B2C =======================================
  function robustItemsParse(raw){ if (!raw) return []; if (Array.isArray(raw)) return raw; if (typeof raw === 'string'){ try { return JSON.parse(raw); } catch(_){ try { return JSON.parse(raw.replace(/'/g,'"')); } catch(_){ return []; } } } return []; }
  function ldr_showB2CDetail(order){
    let items = robustItemsParse(order.polozky ?? order.polozky_json ?? order.items ?? '[]');
    const rows = items.map(it=>{
      const name = it.name||it.nazov||it.nazov_vyrobku||'—'; const qty = (it.quantity ?? it.mnozstvo ?? ''); const mj = (it.unit || it.mj || ''); const note = (it.poznamka_k_polozke || it.item_note || '');
      return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(String(qty))}</td><td>${escapeHtml(mj)}</td><td>${escapeHtml(note)}</td></tr>`;
    }).join('');
    const html = `<div class="table-container"><table class="tbl"><thead><tr><th>Produkt</th><th>Množstvo</th><th>MJ</th><th>Poznámka</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Žiadne položky</td></tr>'}</tbody></table></div><div style="text-align:right;margin-top:10px"><button class="btn btn-secondary" onclick="window.open('/api/kancelaria/b2c/order-pdf?order_id=${encodeURIComponent(order.cislo_objednavky||order.id)}','_blank')"><i class="fas fa-print"></i> PDF objednávky</button></div>`;
    modal('Detail objednávky #' + escapeHtml(order.cislo_objednavky||order.id), html);
  }
  async function ldr_markReady(order){
    const id = order.id; const no = order.cislo_objednavky || id;
    const priceStr = await modalPrompt({ title:`Finálna cena – #${no}`, label:'Zadajte finálnu cenu s DPH (napr. 12.34)', placeholder:'12.34', type:'text', pattern:/^\d+(?:[.,]\d{1,2})?$/ });
    if (priceStr===null) return;
    const price = String(priceStr).replace(',','.').trim();
    try{
      await apiRequest('/api/kancelaria/b2c/markReady', { method:'POST', body:{ order_id:id, final_price: price } });
      await apiRequest('/api/kancelaria/b2c/sms/ready',   { method:'POST', body:{ order_id:id, order_no:no, final_price:price } }).catch(()=>{});
      await apiRequest('/api/kancelaria/b2c/email/ready', { method:'POST', body:{ order_id:id, order_no:no, final_price:price } }).catch(()=>{});
      showStatus('Objednávka je v stave „Pripravená“.', false); loadB2C();
    }catch(e){ showStatus(e.message||String(e), true); }
  }
  async function ldr_closeOrder(order) {
    const id = order.id; const no = order.cislo_objednavky || id;
    const ok = await modalConfirm({ title: 'Uzavrieť objednávku', message: `Označiť #${escapeHtml(no)} ako HOTOVÁ a pripísať body?` });
    if (!ok) return;
    const btn = (typeof event !== 'undefined' && event?.currentTarget) ? event.currentTarget : null;
    const lock = (on) => { if (!btn) return; btn.disabled = !!on; btn.dataset.origText ??= btn.textContent; btn.textContent = on ? 'Spracúvam…' : (btn.dataset.origText || 'Hotová'); };
    lock(true);
    try {
      let finalPrice = Number(order.finalna_suma_s_dph || order.celkova_suma_s_dph || 0);
      if (!finalPrice || finalPrice <= 0) {
        const priceStr = await modalPrompt({ title: `Finálna cena – objednávka #${escapeHtml(no)}`, message: 'Zadajte finálnu cenu s DPH (napr. 12.34):', placeholder: '12.34', type: 'text', pattern: /^\d+(?:[.,]\d{1,2})?$/ });
        if (priceStr === null) { lock(false); return; }
        const price = String(priceStr).replace(',', '.').trim();
        await apiRequest('/api/kancelaria/b2c/finalize_order', { method: 'POST', body: { order_id: id, final_price: price } });
      }
      await apiRequest('/api/kancelaria/b2c/credit_points', { method: 'POST', body: { order_id: id } });
      showStatus('Objednávka uzavretá a body pripísané.', false); loadB2C();
    } catch (e2) { showStatus(e2?.message || String(e2), true); } finally { lock(false); }
  }
  async function ldr_cancelOrder(order){
    const id = order.id; const no = order.cislo_objednavky || id;
    const reason = await modalPrompt({ title:`Zrušiť objednávku #${no}`, label:'Dôvod zrušenia (zobrazí sa zákazníkovi):', type:'textarea', placeholder:'Dôvod…' });
    if (reason===null || !reason.trim()){ showStatus('Zrušenie prerušené – dôvod chýba.', true); return; }
    try{ await apiRequest('/api/leader/b2c/cancel_order', { method:'POST', body:{ order_id:id, reason: reason.trim() } }); showStatus('Objednávka zrušená.', false); loadB2C(); }
    catch(e){ showStatus(e.message||String(e), true); }
  }
  async function loadB2C(){
    const tb = $('#tbl-b2c tbody'); 
    if(!tb) return;
    const d  = $('#b2c-date').value || todayISO();
    tb.innerHTML = '<tr><td colspan="6" class="muted">Načítavam…</td></tr>';
    try{
      const rows = await apiRequest(`/api/leader/b2c/orders?date=${encodeURIComponent(d)}`);
      if (!rows.length){ tb.innerHTML = '<tr><td colspan="6" class="muted">Žiadne objednávky.</td></tr>'; return; }
      tb.innerHTML = rows.map(o=>{
        const id = o.id; const no = o.cislo_objednavky || id; const ddel = o.pozadovany_datum_dodania || '';
        const pred = toNum(o.predpokladana_suma_s_dph ?? o.predpokladana_suma ?? o.pred ?? 0, 0);
        const fin  = (o.finalna_suma_s_dph ?? o.finalna_suma ?? null); const finNum = (fin!=null ? toNum(fin,0) : null);
        const price = (finNum!=null && finNum>0) ? `${fmt2(pred)} € / <strong style="color:#16a34a">${fmt2(finNum)} €</strong>` : `${fmt2(pred)} € / <span class="muted">—</span>`;
        const who = (o.zakaznik_meno || o.nazov_firmy || '');
        let act = `<button class="btn btn-sm" data-b2c-detail="${id}">Detail</button> `;
        if (o.stav==='Prijatá')    act += `<button class="btn btn-sm" data-b2c-ready="${id}">Pripraviť</button> `;
        if (o.stav==='Pripravená') act += `<button class="btn btn-sm" data-b2c-done ="${id}">Hotová</button> `;
        if (o.stav!=='Hotová' && o.stav!=='Zrušená') act += `<button class="btn btn-sm" data-b2c-cancel="${id}">Zrušiť</button>`;
        return `<tr data-id="${escapeHtml(String(id))}"><td>${escapeHtml(no)}</td><td>${escapeHtml(who)}</td><td>${escapeHtml(ddel||'')}</td><td>${price}</td><td>${escapeHtml(o.stav||'')}</td><td>${act}</td></tr>`;
      }).join('');
      $$('[data-b2c-detail]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2c-detail'); const row = rows.find(x=> String(x.id)===String(id)); if (row) ldr_showB2CDetail(row); });
      $$('[data-b2c-ready]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2c-ready'); const row = rows.find(x=> String(x.id)===String(id)); if (row) ldr_markReady(row); });
      $$('[data-b2c-done]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2c-done'); const row = rows.find(x=> String(x.id)===String(id)); if (row) ldr_closeOrder(row); });
      $$('[data-b2c-cancel]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2c-cancel'); const row = rows.find(x=> String(x.id)===String(id)); if (row) ldr_cancelOrder(row); });
    }catch(e){ tb.innerHTML = `<tr><td colspan="6" class="muted">Chyba: ${escapeHtml(e.message||'')}</td></tr>`; }
  }

  // ============================== B2B =======================================
  function getB2bFilter(){ const v = safeStr($('#b2b-filter')?.value || ''); const group = !!$('#b2b-group')?.checked; return { q:v.toLowerCase(), group }; }
  async function openB2bPdfSmart(id){
    const u = `/api/leader/b2b/order-pdf?order_id=${encodeURIComponent(id)}`;
    try{ const r = await fetch(u, {method:'HEAD'}); if (r.ok || r.status===302) { window.open(u,'_blank'); return; } window.open(u,'_blank'); }
    catch(_){ window.open(u,'_blank'); }
  }
  function priceCell(row){
    const pred = toNum(row.predpokladana_suma_s_dph ?? row.predpokladana_suma ?? row.pred ?? 0,0);
    const fin  = (row.finalna_suma_s_dph ?? row.finalna_suma ?? null); const finNum = (fin!=null ? toNum(fin,0) : null);
    return (finNum!=null && finNum>0) ? `${fmt2(pred)} € / <strong style="color:#16a34a">${fmt2(finNum)} €</strong>` : `${fmt2(pred)} € / <span class="muted">—</span>`;
  }
  async function loadB2B(){
    const fmtSK = (iso)=> new Date((iso||todayISO())+'T00:00:00').toLocaleDateString('sk-SK',{day:'2-digit',month:'2-digit'});
    const mondayOf = (iso)=> { const d = new Date((iso||todayISO())+'T00:00:00'); const dow = (d.getDay()+6)%7; d.setDate(d.getDate() - dow); return d; };
    const addDays = (d,i)=> { const x = new Date(d); x.setDate(x.getDate()+i); return x.toISOString().slice(0,10); };
    const d = $('#b2b-date').value || todayISO(); const tb = $('#tbl-b2b tbody'); const weekMode = !!$('#b2b-week')?.checked; const rangeTag = $('#b2b-range-tag');
    tb.innerHTML='<tr><td colspan="6" class="muted">Načítavam…</td></tr>';
    try{
      let rows = [];
      if (!weekMode){ rows = await apiRequest(`/api/leader/b2b/orders?date=${encodeURIComponent(d)}`); if (rangeTag) rangeTag.textContent = ''; } 
      else { const mon = mondayOf(d); const days = [0,1,2,3,4].map(i => addDays(mon, i)); const resp = await Promise.all(days.map(iso => apiRequest(`/api/leader/b2b/orders?date=${encodeURIComponent(iso)}`))); rows = resp.flat(); if (rangeTag) rangeTag.textContent = `Rozsah: ${fmtSK(days[0])} – ${fmtSK(days[4])}`; }
      const {q, group} = getB2bFilter ? getB2bFilter() : {q:'',group:false};
      let list = rows.filter(r=>{ const who = (r.odberatel || r.zakaznik_meno || r.nazov_firmy || '').toLowerCase(); return !q || who.includes(q); });
      if (!list.length){ tb.innerHTML='<tr><td colspan="6" class="muted">Žiadne objednávky.</td></tr>'; return; }
      if (!group){
        tb.innerHTML = list.map(r=>{
          const id = r.cislo_objednavky || r.id; const who = safeStr(r.odberatel || ''); const ddel = r.pozadovany_datum_dodania || '';
          return `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(who)}</td><td>${escapeHtml(ddel||'')}</td><td>${priceCell(r)}</td><td>${escapeHtml(r.stav||'')}</td><td><button class="btn btn-sm" data-b2b-pdf="${escapeHtml(id)}">PDF</button> <button class="btn btn-sm" data-b2b-edit="${escapeHtml(id)}">Upraviť</button></td></tr>`;
        }).join('');
      } else {
        const groups = {}; list.forEach(r=>{ const key = r.pozadovany_datum_dodania || '(bez dátumu)'; (groups[key] = groups[key] || []).push(r); });
        const keys = Object.keys(groups).sort((a,b)=>{ if (a==='(bez dátumu)') return 1; if (b==='(bez dátumu)') return -1; return a.localeCompare(b); });
        tb.innerHTML = keys.map(k=>{
          const rowsHtml = groups[k].map(r=>{ const id = r.cislo_objednavky || r.id; const who = safeStr(r.odberatel || ''); return `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(who)}</td><td>${priceCell(r)}</td><td>${escapeHtml(r.stav||'')}</td><td><button class="btn btn-sm" data-b2b-pdf="${escapeHtml(id)}">PDF</button> <button class="btn btn-sm" data-b2b-edit="${escapeHtml(id)}">Upraviť</button></td></tr>`; }).join('');
          return `<tr class="muted"><td colspan="6"><strong>Dodanie:</strong> ${escapeHtml(k!=='(bez dátumu)'?`${fmtSK(k)} (${k})`:k)}</td></tr>${rowsHtml}`;
        }).join('');
      }
      $$('[data-b2b-pdf]').forEach(b=> b.onclick = ()=> openB2bPdfSmart(b.getAttribute('data-b2b-pdf')) );
      $$('[data-b2b-edit]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2b-edit'); const row = rows.find(x=> String(x.cislo_objednavky||x.id) === id); if (row) openB2BEditModal(row); });
      if (!$('#b2b-filter')) injectB2bFilterUI();
    }catch(e){ tb.innerHTML = `<tr><td colspan="6" class="muted">Chyba: ${escapeHtml(e.message||'')}</td></tr>`; }
  }
  function injectB2bFilterUI(){
    const wrap = $('#leader-b2b .card .card-body'); if (!wrap) return;
    const holder = doc.createElement('div'); holder.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.5rem';
    holder.innerHTML = `<input id="b2b-filter" placeholder="Hľadať odberateľa" style="padding:.5rem;border:1px solid #e5e7eb;border-radius:8px;min-width:220px"> <label style="display:inline-flex;align-items:center;gap:.35rem"><input type="checkbox" id="b2b-group"> Zoskupiť</label> <label style="display:inline-flex;align-items:center;gap:.35rem"><input type="checkbox" id="b2b-week"> Týždeň</label> <span id="b2b-range-tag" class="muted" style="margin-left:auto"></span>`;
    wrap.appendChild(holder);
    const reload = ()=> loadB2B(); $('#b2b-filter').addEventListener('input', reload); $('#b2b-group').addEventListener('change', reload); $('#b2b-week').addEventListener('change', reload);
  }

  // =========================== Manuálna B2B ================================
  async function searchSuppliers(q){ q = safeStr(q); if (q.length < 2) return []; try{ const all = await apiRequest('/api/leader/b2b/getCustomersAndPricelists'); const rows = (all && all.customers) ? all.customers : (Array.isArray(all)? all : []); return rows.filter(x=> ((x.name||'') + ' ' + (x.email||'')).toLowerCase().includes(q.toLowerCase())).map(x=>({ id:x.id, name:x.name, code:x.email||'' })); }catch(_){ return []; } }
  async function fetchPricelists(customerId){ const r = await apiRequest(`/api/leader/b2b/get_pricelists?customer_id=${encodeURIComponent(customerId)}`); return Array.isArray(r) ? r : (r?.pricelists || r?.rows || []); }
  async function renderPricelistPreview(pricelist, mount){
    const items = Array.isArray(pricelist?.items) ? pricelist.items : []; await ensureNamesForEans(items.map(it => it && it.ean).filter(Boolean));
    const box = mount.querySelector('#nb2b-pl-preview') || (()=>{ const d = doc.createElement('div'); d.id = 'nb2b-pl-preview'; d.style.marginTop = '.5rem'; mount.appendChild(d); return d; })();
    if (!items.length){ box.innerHTML = '<div class="muted">Cenník je prázdny.</div>'; return; }
    box.innerHTML = `<div style="display:flex;gap:.5rem;align-items:center;margin:.5rem 0 .25rem"><input id="nb2b-pl-search" placeholder="Filtrovať..." style="flex:1;padding:.4rem;border:1px solid #e5e7eb;border-radius:8px"><span class="muted">${items.length} pol.</span></div><div class="table-container" style="max-height:260px;overflow:auto;border:1px solid #eee;border-radius:8px"><table class="tbl" style="width:100%"><thead><tr><th>EAN</th><th>Produkt</th><th>Cena</th><th style="width:160px">Ks</th><th>MJ</th><th></th></tr></thead><tbody></tbody></table></div>`;
    const tbody = box.querySelector('tbody'), search = box.querySelector('#nb2b-pl-search');
    const getItemName = (it)=> __nameByEAN[String(it.ean||'')] || it.name || it.nazov || it.product_name || '';
    function redraw(){
      const q = (search.value || '').toLowerCase();
      const rows = items.filter(it=>{ const e = String(it.ean || ''); const nm = getItemName(it).toLowerCase(); return !q || e.includes(q) || nm.includes(q); }).slice(0, 500);
      tbody.innerHTML = rows.map(it=>{
        const e = String(it.ean || ''); const nm = getItemName(it); const pr = Number(it.price || it.cena_bez_dph || 0);
        return `<tr data-ean="${escapeHtml(e)}" data-price="${pr}" data-name="${escapeHtml(nm)}"><td>${escapeHtml(e)}</td><td>${escapeHtml(nm)}</td><td>${fmt2(pr)} €</td><td><input type="number" class="plpv-qty" min="0.001" step="0.001" value="1" style="width:100%"></td><td><select class="plpv-mj"><option>ks</option><option>kg</option></select></td><td><button class="btn btn-sm" data-add>Pridať</button></td></tr>`;
      }).join('');
      $$('[data-add]', tbody).forEach(btn=>{
        btn.onclick = ()=>{
          const tr = btn.closest('tr');
          const nb = $('#nb2b-items tbody') || (()=>{ const t = $('#nb2b-items'); const b = doc.createElement('tbody'); t.appendChild(b); return b; })();
          const row = doc.createElement('tr');
          row.innerHTML = `<td><input class="nb2b-ean" value="${escapeHtml(tr.dataset.ean)}"></td><td><input class="nb2b-name" value="${escapeHtml(tr.dataset.name)}"></td><td><input class="nb2b-qty" type="number" step="0.001" min="0" value="${fmt2(toNum(tr.querySelector('.plpv-qty').value,1))}"></td><td><input class="nb2b-mj" value="${escapeHtml(tr.querySelector('.plpv-mj').value||'ks')}" style="width:60px"></td><td><input class="nb2b-price" type="number" step="0.01" min="0" value="${fmt2(Number(tr.dataset.price))}"></td><td><button class="btn btn-sm" data-del>×</button></td>`;
          nb.appendChild(row); row.querySelector('[data-del]').onclick = ()=> row.remove();
          if (tr.dataset.ean) __pricelistMapByEAN[tr.dataset.ean] = Number(tr.dataset.price); showStatus('Položka pridaná.', false);
        };
      });
    }
    search.oninput = redraw; redraw();
  }
  
  function addManualRow(tb){
    const tr = doc.createElement('tr');
    tr.innerHTML = `<td><input class="nb2b-ean" placeholder="EAN"></td><td><input class="nb2b-name" placeholder="Názov"></td><td><input class="nb2b-qty" type="number" step="0.001" min="0"></td><td><input class="nb2b-mj" value="kg" style="width:60px"></td><td><input class="nb2b-price" type="number" step="0.01" min="0"></td><td><button class="btn btn-sm" data-del>×</button></td>`;
    tb.appendChild(tr); tr.querySelector('[data-del]').onclick = ()=> tr.remove();
    tr.querySelector('.nb2b-ean').addEventListener('change', ()=>{ const e = safeStr(tr.querySelector('.nb2b-ean').value); if (e && __pricelistMapByEAN && __pricelistMapByEAN[e]!=null) tr.querySelector('.nb2b-price').value = fmt2(__pricelistMapByEAN[e]); });
  }

  // ================= AMBULANTNÝ PREDAJ - FUNKCIE (NOVÉ) =================

  function addProductRow(product) {
      const tb = $('#nb2b-items tbody');
      if(!tb) return;
      
      const tr = document.createElement('tr');
      const mj = product.mj || 'kg';
      const price = product.price || 0;

      tr.innerHTML = `
          <td><input class="nb2b-ean" value="${escapeHtml(product.ean || '')}"></td>
          <td><input class="nb2b-name" value="${escapeHtml(product.name || '')}"></td>
          <td><input class="nb2b-qty" type="number" step="0.001" min="0" value="1"></td>
          <td><input class="nb2b-mj" value="${escapeHtml(mj)}" style="width:60px"></td>
          <td><input class="nb2b-price" type="number" step="0.01" min="0" value="${price.toFixed(2)}"></td>
          <td><button class="btn btn-sm" data-del style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;">×</button></td>
      `;
      
      tb.insertBefore(tr, tb.firstChild);
      tr.querySelector('[data-del]').onclick = () => tr.remove();
      const qtyInput = tr.querySelector('.nb2b-qty');
      qtyInput.select(); 
      showStatus(`Pridané: ${product.name}`, false);
  }

  function attachProductSearch() {
      const input = $('#nb2b-product-search');
      const results = $('#nb2b-search-results');
      const ambulantCheck = $('#nb2b-ambulant');
      const customerInput = $('#nb2b-name');
      
      if (!input || !results) return;

      if(ambulantCheck && customerInput) {
          ambulantCheck.addEventListener('change', () => {
              if (ambulantCheck.checked) {
                  customerInput.value = ''; 
                  customerInput.placeholder = 'Zadajte meno zákazníka (napr. Jožko Mrkvička)';
                  customerInput.focus();
                  __pickedCustomer = { id: 255, name: 'Ambulant', code: 'AMB' };
                  const plBox = $('#nb2b-pl-box');
                  if(plBox) plBox.style.display = 'none';
              } else {
                  customerInput.value = '';
                  customerInput.placeholder = 'Vyhľadať firmu...';
                  __pickedCustomer = null;
              }
          });
      }

      let debounce = null;
      input.addEventListener('input', () => {
          const q = input.value.trim();
          if (q.length < 2) { 
              results.style.display = 'none'; 
              return; 
          }
          
          clearTimeout(debounce);
          debounce = setTimeout(async () => {
              results.style.display = 'block';
              results.innerHTML = '<div style="padding:10px; color:#666;">Hľadám...</div>';
              
              try {
                  const items = await apiRequest(`/api/leader/b2b/search_products?q=${encodeURIComponent(q)}`);
                  if (!items || !items.length) {
                      results.innerHTML = '<div style="padding:10px; color:#999;">Žiadny produkt sa nenašiel.</div>';
                      return;
                  }
                  
                  results.innerHTML = items.map(p => `
                      <div class="product-search-item" 
                           style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;"
                           onmouseover="this.style.background='#f3f4f6'" 
                           onmouseout="this.style.background='white'"
                           data-json='${escapeHtml(JSON.stringify(p))}'>
                          <div>
                              <div style="font-weight:600; color:#333;">${escapeHtml(p.name)}</div>
                              <div style="font-size:0.85em; color:#888;">EAN: ${escapeHtml(p.ean)}</div>
                          </div>
                          <div style="text-align:right;">
                              <div style="font-weight:bold; color:#16a34a;">${Number(p.price).toFixed(2)} €</div>
                              <div style="font-size:0.8em; color:#666;">/ ${p.mj}</div>
                          </div>
                      </div>
                  `).join('');

                  results.querySelectorAll('.product-search-item').forEach(div => {
                      div.onclick = () => {
                          const pData = JSON.parse(div.getAttribute('data-json'));
                          addProductRow(pData);
                          input.value = ''; 
                          results.style.display = 'none';
                       };
                  });

              } catch(e) { 
                  console.error(e); 
                  results.innerHTML = '<div style="padding:10px; color:red;">Chyba pripojenia.</div>';
              }
          }, 300);
      });

      document.addEventListener('click', (e) => {
          if (e.target !== input && !results.contains(e.target)) {
              results.style.display = 'none';
          }
      });
  }

  async function saveManualB2B(){
    // 1. Zber dát
    const odberatel = safeStr($('#nb2b-name').value);
    const datum_dodania= $('#nb2b-date').value || todayISO();
    const poznamka = safeStr($('#nb2b-note').value);
    const tb = $('#nb2b-items tbody'); 
    const items=[];
    
    $$('.nb2b-ean', tb).forEach((e,i)=>{
      const ean = safeStr(e.value);
      const name = safeStr($$('.nb2b-name', tb)[i].value);
      const qty = toNum($$('.nb2b-qty', tb)[i].value,0);
      const mj = safeStr($$('.nb2b-mj', tb)[i].value||'ks');
      const price= toNum($$('.nb2b-price', tb)[i].value,0);
      
      if (ean && name && qty>0) {
          items.push({ ean, name, quantity:qty, unit:mj, cena_bez_dph:price });
      }
    });

    if (!odberatel && !__pickedCustomer){ showStatus('Zadajte meno odberateľa.', true); return; }
    if (!items.length){ showStatus('Pridaj aspoň 1 položku', true); return; }

    try{
      const body = { odberatel, datum_dodania, poznamka, items }; 
      if (__pickedCustomer?.id) {
          body.customer_id = __pickedCustomer.id;
      }

      // 2. Uloženie
      const res = await apiRequest('/api/leader/b2b/orders', { method:'POST', body });
      if (!res?.order_id){ showStatus('Server nevrátil ID.', true); return; }

      // 3. Notifikácia (CSV na sklad) - VOLÁME VŽDY
      // Backend sa postará o to, že zákazníkovi 255 sa mail nepošle
      await apiRequest(`/api/leader/b2b/notify_order`, { method:'POST', body:{ order_id: res.order_id } }).catch(()=>{});
      
      showStatus('Objednávka uložená a CSV odoslané.', false); 

      // 4. Reset
      $$('[data-section="leader-b2b"]')[0]?.click(); 
      loadB2B();
    } catch(e){ showStatus(e.message||String(e), true); }
  }

  function openB2BEditModal(row){
    let items = (()=>{ const raw = row.polozky_json || row.polozky || row.items || '[]'; try { return typeof raw==='string'? JSON.parse(raw) : (Array.isArray(raw)? raw : []); }catch(_){ return []; } })();
    const no = row.cislo_objednavky || row.id;
    const html = `<div><div class="muted" style="margin-bottom:.5rem">Úprava #${escapeHtml(no)} • Dodanie: ${escapeHtml(row.pozadovany_datum_dodania||'')}</div><table id="b2b-edit-tbl" class="tbl" style="width:100%"><thead><tr><th>EAN</th><th>Názov</th><th>Množstvo</th><th>MJ</th><th>Cena</th><th></th></tr></thead><tbody>${items.map(it=>`<tr><td><input class="e-ean" value="${escapeHtml(it.ean||it.ean_produktu||'')}"></td><td><input class="e-name" value="${escapeHtml(it.name||it.nazov||it.nazov_vyrobku||'')}"></td><td><input class="e-qty" type="number" step="0.001" min="0" value="${escapeHtml(String(it.quantity||it.mnozstvo||0))}"></td><td><input class="e-mj" value="${escapeHtml(it.unit||it.mj||'ks')}"></td><td><input class="e-price" type="number" step="0.01" min="0" value="${escapeHtml(String(it.cena_bez_dph||0))}"></td><td><button class="btn btn-sm" data-del>×</button></td></tr>`).join('')}</tbody></table><button class="btn btn-secondary" id="b2b-edit-add" style="margin-top:.5rem">+ položka</button><div style="text-align:right;margin-top:10px"><button class="btn btn-secondary" id="b2b-edit-cancel">Zrušiť</button> <button class="btn btn-primary" id="b2b-edit-save">Uložiť</button></div></div>`;
    modal(`Upraviť B2B #${escapeHtml(no)}`, html, (body)=>{
      const tb = body.querySelector('#b2b-edit-tbl tbody');
      body.querySelector('#b2b-edit-add').onclick = ()=> { const tr = doc.createElement('tr'); tr.innerHTML = `<td><input class="e-ean"></td><td><input class="e-name"></td><td><input class="e-qty" type="number" step="0.001" min="0"></td><td><input class="e-mj" value="ks"></td><td><input class="e-price" type="number" step="0.01" min="0"></td><td><button class="btn btn-sm" data-del>×</button></td>`; tb.appendChild(tr); tr.querySelector('[data-del]').onclick=()=>tr.remove(); };
      tb.querySelectorAll('[data-del]').forEach(b=> b.onclick = ()=> b.closest('tr').remove());
      body.querySelector('#b2b-edit-cancel').onclick = ()=> closeModal();
      body.querySelector('#b2b-edit-save').onclick = async ()=>{
        const rows = Array.from(tb.querySelectorAll('tr')).map(tr=>{ return { ean: safeStr(tr.querySelector('.e-ean').value), name: safeStr(tr.querySelector('.e-name').value), quantity: toNum(tr.querySelector('.e-qty').value,0), unit: safeStr(tr.querySelector('.e-mj').value||'ks'), cena_bez_dph: toNum(tr.querySelector('.e-price').value,0) }; }).filter(x=> x.ean && x.name && x.quantity>0);
        if (!rows.length){ showStatus('Pridaj aspoň jednu položku.', true); return; }
        try{ await apiRequest('/api/leader/b2b/update_order', { method:'POST', body:{ order_id: row.id, items: rows } }); await apiRequest('/api/leader/b2b/notify_order', { method:'POST', body:{ order_id: row.id } }).catch(()=>{}); showStatus('Objednávka upravená.', false); closeModal(); loadB2B(); }catch(e){ showStatus(e.message||String(e), true); }
      };
    });
  }

  // ============================== KRÁJAČKY (CUT JOBS) ======================
  
  // 1. ZRUŠENIE ÚLOHY (Globálne dostupná funkcia)
  async function cancelCutJob(id) {
    if (!confirm("Naozaj chcete zrušiť túto úlohu? Surovina sa vráti na sklad.")) return;
    try {
        await apiRequest('/api/leader/cut_jobs/cancel', { method: 'POST', body: { id: id } });
        showStatus("Úloha bola zrušená.", false);
        loadCutJobs(); // Obnoviť tabuľku
    } catch (e) {
        showStatus(e.message || String(e), true);
    }
  }
  // Export funkcie, aby bola dostupná pre onclick v HTML
  root.cancelCutJob = cancelCutJob;

  // 2. NAČÍTANIE ZOZNAMU ÚLOH
  async function loadCutJobs(){
    const d = $('#cut-date').value || todayISO();
    const tb = $('#tbl-cut tbody'); 
    if(!tb) return;
    
    tb.innerHTML='<tr><td colspan="9" class="muted">Načítavam…</td></tr>';
    
    try{
      const rows = await apiRequest(`/api/leader/cut_jobs?date=${encodeURIComponent(d)}`);
      
      if (rows.length === 0) {
          tb.innerHTML = '<tr><td colspan="9" class="muted" style="text-align:center; padding:20px;">Žiadne aktívne úlohy.</td></tr>';
          return;
      }

      tb.innerHTML = rows.map(r => `
        <tr>
            <td><span style="font-family:monospace; background:#f3f4f6; padding:2px 5px; border-radius:4px;">${r.id}</span></td>
            <td><strong>${escapeHtml(r.order_id || '—')}</strong></td>
            <td>${escapeHtml(r.ean)}</td>
            <td>${escapeHtml(r.nazov_vyrobku)}</td>
            <td style="font-weight:bold; color:#2563eb;">${r.mnozstvo} ${r.mj}</td>
            <td>${r.due_date ? new Date(r.due_date).toLocaleDateString('sk-SK') : ''}</td>
            <td><span class="badge-orange">${escapeHtml(r.stav)}</span></td>
            <td>
                ${r.stav === 'Prebieha krájanie' 
                    ? `<button class="btn btn-sm btn-danger" onclick="cancelCutJob('${r.id}')" style="background-color:#dc2626; border-color:#dc2626; color:white;">Zrušiť</button>` 
                    : ''}
            </td>
        </tr>
      `).join('');
    } catch(e){ 
        tb.innerHTML = `<tr><td colspan="9" class="muted">Chyba: ${escapeHtml(e.message||'')}</td></tr>`; 
    }
  }

  // 3. NOVÁ ÚLOHA (MODAL)
  async function openNewCutModal() {
    let products = [];
    try {
        products = await apiRequest('/api/leader/get_slicable_products');
    } catch (e) {
        showStatus("Chyba pri načítaní produktov: " + e.message, true);
        return;
    }

    let optionsHtml = '<option value="">-- Vyberte výrobok --</option>';
    products.forEach(p => {
        optionsHtml += `<option value="${escapeHtml(p.ean)}">${escapeHtml(p.name)}</option>`;
    });

    const html = `
      <style>
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 0.9rem; color: #374151; }
        .form-control { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
        .form-control:focus { outline: none; border-color: #2563eb; ring: 2px solid #2563eb; }
        .row { display: flex; gap: 12px; }
        .col { flex: 1; }
        /* Autocomplete zoznam */
        #customer-suggestions {
            position: absolute; background: white; border: 1px solid #ddd; 
            width: 100%; max-height: 200px; overflow-y: auto; z-index: 100;
            border-radius: 0 0 6px 6px; display: none; box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .suggestion-item { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f3f4f6; }
        .suggestion-item:hover { background-color: #f3f4f6; }
        .suggestion-type { font-size: 0.75rem; color: #6b7280; float: right; }
      </style>

      <div class="form-group">
        <label>Výrobok na krájanie</label>
        <select id="cut-product-select" class="form-control" style="font-weight:600;">${optionsHtml}</select>
      </div>

      <div class="row">
        <div class="col" style="flex: 2;">
            <label>Množstvo</label>
            <input id="cut-qty" type="number" step="0.01" class="form-control" placeholder="0.00">
        </div>
        <div class="col" style="flex: 1;">
            <label>Jednotka</label>
            <select id="cut-mj" class="form-control">
                <option value="kg">kg</option>
                <option value="ks">ks</option>
            </select>
        </div>
      </div>

      <div class="form-group" style="position: relative;">
        <label>Zákazník / Odberateľ (Voliteľné)</label>
        <input id="cut-customer" type="text" class="form-control" placeholder="Začnite písať (B2B, B2C) alebo zadajte vlastné..." autocomplete="off">
        <div id="customer-suggestions"></div>
      </div>

      <div class="form-group">
        <label>Termín dodania</label>
        <input id="cut-due" type="date" class="form-control" value="${todayISO()}">
      </div>

      <div style="margin-top: 24px; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" onclick="closeModal()">Zrušiť</button>
        <button id="cut-save" class="btn btn-primary">Uložiť úlohu</button>
      </div>
    `;

    modal('Nová požiadavka na krájanie', html, (body) => {
        const select = body.querySelector('#cut-product-select');
        const qtyInput = body.querySelector('#cut-qty');
        const customerInput = body.querySelector('#cut-customer');
        const suggestionsBox = body.querySelector('#customer-suggestions');
        
        // --- Logika pre Select ---
        let selectedEan = '';
        let selectedName = '';
        
        select.addEventListener('change', () => {
            selectedEan = select.value;
            selectedName = select.options[select.selectedIndex].text;
        });

        // --- Logika pre Autocomplete Zákazníka ---
        let debounceTimer;
        customerInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const q = e.target.value;
            if (q.length < 2) { suggestionsBox.style.display = 'none'; return; }

            debounceTimer = setTimeout(async () => {
                try {
                    const res = await apiRequest(`/api/leader/search_customers?q=${encodeURIComponent(q)}`);
                    if (res && res.length > 0) {
                        suggestionsBox.innerHTML = res.map(c => 
                            `<div class="suggestion-item" data-val="${escapeHtml(c.name)}">
                                ${escapeHtml(c.name)} <span class="suggestion-type">${c.type}</span>
                             </div>`
                        ).join('');
                        suggestionsBox.style.display = 'block';
                        
                        // Click handler na itemy
                        body.querySelectorAll('.suggestion-item').forEach(item => {
                            item.onclick = () => {
                                customerInput.value = item.getAttribute('data-val');
                                suggestionsBox.style.display = 'none';
                            };
                        });
                    } else {
                        suggestionsBox.style.display = 'none';
                    }
                } catch(err) { console.error(err); }
            }, 300);
        });

        // Skryť našepkávač pri kliknutí mimo
        document.addEventListener('click', (e) => {
            if (e.target !== customerInput) suggestionsBox.style.display = 'none';
        });

        // --- Uloženie ---
        body.querySelector('#cut-save').onclick = async () => {
            const payload = {
                ean: selectedEan,
                name: selectedName, 
                quantity: toNum(qtyInput.value),
                unit: body.querySelector('#cut-mj').value,
                order_id: safeStr(customerInput.value),
                due_date: body.querySelector('#cut-due').value
            };

            if (!payload.ean) { showStatus('Vyberte výrobok.', true); return; }
            if (payload.quantity <= 0) { showStatus('Zadajte množstvo.', true); return; }

            try {
                await apiRequest('/api/leader/cut_jobs', { method:'POST', body: payload });
                showStatus('Úloha odoslaná do Expedície.', false);
                closeModal();
                loadCutJobs(); // Obnovíme zoznam
            } catch (e) {
                showStatus(e.message, true);
            }
        };
    });
  }
// ======================= ŠTÍTKY PÔVODU MÄSA (TLAČ) =======================
var __mol_inited = false;
const MOL_HISTORY_KEY = 'mol_history_v1';

// Layout pre A4 (tlač): 2 stĺpce x N riadkov na stranu
const MOL_ROW_GAP = '5mm';    // medzera medzi riadkami (na strihanie)
const MOL_COL_GAP = '6mm';    // medzera medzi ľavým/pravým štítkom
const MOL_SAFE_PAGE_H = '275mm'; // približná využiteľná výška po okrajoch (nech máme rezervu proti orezaniu)

function mol_titleForType(type){
  const t = String(type||'').toLowerCase();
  if (t === 'poultry') return 'Informácie o pôvode mäsa hydinové';
  if (t === 'pork')    return 'Informácie o pôvode mäsa ošípaných';
  return 'Informácie o pôvode mäsa hovädzie';
}

function mol_defaultDateLabel(type){
  const t = String(type||'').toLowerCase();
  return (t === 'poultry') ? 'Dátum :' : 'Dátum spot:';
}

function mol_isBeef(type){
  return String(type||'').toLowerCase() === 'beef';
}

function mol_defaultCutText(){
  // Default: aby na štítku bolo "Delené: v Slovenskej republike SK 4053 ES"
  // Na štítku sa tlačí ako "Delené:" + hodnota
  return 'v Slovenskej republike SK 4053 ES';
}

function mol_applyBeefVisibility(type){
  const t = String(type || $('#mol-type')?.value || 'beef').toLowerCase();
  const isBeef = (t === 'beef');

  const scope = $('#leader-meat-origin-labels') || doc;
  scope.querySelectorAll('.mol-beef-only').forEach(el => {
    el.style.display = isBeef ? '' : 'none';
  });

  if (isBeef){
    const cut = $('#mol-cuttext');
    if (cut && !safeStr(cut.value)) cut.value = mol_defaultCutText();
  }
}

function mol_fmtDate(iso, mode){
  const s = safeStr(iso);
  if (!s) return ''; // DÁTUM JE VOLITEĽNÝ
  if (String(mode||'').toLowerCase() === 'iso') return s;
  try{
    const d = new Date(s + 'T00:00:00');
    if (!Number.isFinite(d.getTime())) return s;
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = String(d.getFullYear());
    return `${dd}.${mm}.${yy}`;
  }catch(_){ return s; }
}

function mol_addRow(tb, preset){
  if (!tb) return;
  const tr = doc.createElement('tr');
  const p = preset || {};
  tr.innerHTML = `
    <td><input class="mol-date" type="date" value="${escapeHtml(p.date || '')}" style="min-width:140px"></td>
    <td><input class="mol-batch" placeholder="napr. 05 01" value="${escapeHtml(p.batch || '')}"></td>
    <td class="mol-beef-only"><input class="mol-ref" placeholder="ak prázdne, použije sa kód dávky" value="${escapeHtml(p.ref || '')}"></td>
    <td><input class="mol-origin" placeholder="napr. EU – SK" value="${escapeHtml(p.origin || '')}"></td>
    <td><button class="btn btn-sm" data-mol-del>×</button></td>
  `;
  tb.appendChild(tr);
  tr.querySelector('[data-mol-del]').onclick = ()=> tr.remove();

  mol_applyBeefVisibility();
}

function mol_collect(){
  const type = safeStr($('#mol-type')?.value || 'beef');
  const company = safeStr($('#mol-company')?.value || '');
  const approval = safeStr($('#mol-approval')?.value || '');
  const dateLabel = safeStr($('#mol-date-label')?.value || mol_defaultDateLabel(type));
  const rowsPerPage = Math.max(1, Math.min(12, Math.floor(toNum($('#mol-rows-per-page')?.value, 6)) || 6));
  const dateFormat = safeStr($('#mol-date-format')?.value || 'sk');
  const fontSize = Math.max(8, Math.min(16, Math.floor(toNum($('#mol-font-size')?.value, 11)) || 11));

  const cutText = safeStr($('#mol-cuttext')?.value || '');

  const tb = $('#mol-items tbody');
  const entries = [];
  if (tb){
    const trs = Array.from(tb.querySelectorAll('tr'));
    trs.forEach(tr=>{
      const date = safeStr(tr.querySelector('.mol-date')?.value || '');
      const batch = safeStr(tr.querySelector('.mol-batch')?.value || '');
      const origin = safeStr(tr.querySelector('.mol-origin')?.value || '');
      const ref = safeStr(tr.querySelector('.mol-ref')?.value || '');

      // berieme riadok len ak je niečo vyplnené (aby prázdne riadky neblokovali tlač)
      if (date || batch || origin || ref){
        entries.push({ date, batch, origin, ref, _tr: tr });
      }
    });
  }

  const cfg = { type, company, approval, dateLabel, rowsPerPage, dateFormat, fontSize, cutText };
  return { cfg, entries };
}

/**
 * Validácia:
 * - POVINNÉ: kód dávky + pôvod
 * - VOLITEĽNÉ: dátum
 */
function mol_validate(entries){
  let ok = true;
  (entries||[]).forEach(it=>{
    const tr = it._tr;
    const bad = !(safeStr(it.batch) && safeStr(it.origin)); // dátum NEvyžadujeme
    if (tr){
      tr.style.background = bad ? '#fff7ed' : '';
    }
    if (bad) ok = false;
  });
  return ok;
}

function mol_labelHtml(data, cfg){
  const company = escapeHtml(cfg.company || '');
  const approval = escapeHtml(cfg.approval || '');
  const title = escapeHtml(mol_titleForType(cfg.type));
  const origin = escapeHtml(data.origin || '');
  const batch  = escapeHtml(data.batch || '');
  const dlabel = escapeHtml(cfg.dateLabel || 'Dátum:');
  const date   = escapeHtml(mol_fmtDate(data.date, cfg.dateFormat));

  const isBeef = mol_isBeef(cfg.type);
  const refVal = escapeHtml(safeStr(data.ref) || safeStr(data.batch) || '');
  const cutVal = escapeHtml(cfg.cutText || '');

  return `
    <table class="mol-label" cellspacing="0" cellpadding="0">
      <tr><td colspan="4" class="mol-company">${company}</td></tr>
      <tr><td colspan="4" class="mol-approval">${approval}</td></tr>
      <tr><td colspan="4" class="mol-title">${title}</td></tr>
      ${isBeef ? `<tr><td class="mol-lbl">Referenčné číslo:</td><td colspan="3" class="mol-val" style="font-size:0.75em; letter-spacing:-0.5px; white-space:nowrap;">${refVal}</td></tr>` : ''}
      ${isBeef ? `<tr><td class="mol-lbl">Delené:</td><td colspan="3" class="mol-val">${cutVal}</td></tr>` : ''}
      <tr><td class="mol-lbl">CHOVANÉ v:</td><td colspan="3" class="mol-val">${origin}</td></tr>
      <tr><td class="mol-lbl">ZABITÉ v:</td><td colspan="3" class="mol-val">${origin}</td></tr>
      <tr><td class="mol-lbl">POVOD:</td><td colspan="3" class="mol-val">${origin}</td></tr>
      <tr>
        <td class="mol-lbl">Kód dávky:</td><td class="mol-val">${batch}</td>
        <td class="mol-lbl">${dlabel}</td><td class="mol-val">${date}</td>
      </tr>
    </table>
  `;
}

/**
 * NOVÉ správanie:
 * - Každý zadaný riadok (dávka+pôvod+...) = 1 A4 strana
 * - Na stranu sa automaticky namnoží toľko štítkov, aby sa vyplnil A4 formát (2 stĺpce x rowsPerPage riadkov)
 */
function mol_buildMarkup(cfg, entries){
  const rowsPerPage = cfg.rowsPerPage || 6;

  const pagesHtml = (entries || []).map((it, idx)=>{
    const label = mol_labelHtml(it, cfg);
    let rows = '';
    for (let r=0; r<rowsPerPage; r++){
      rows += `<div class="mol-entry">${label}${label}</div>`;
    }
    return `<div class="mol-page" data-page="${idx+1}">${rows}</div>`;
  }).join('');

  return `<div class="mol-root" style="
      --mol-font:${cfg.fontSize || 11}px;
      --mol-rows:${rowsPerPage};
      --mol-row-gap:${MOL_ROW_GAP};
      --mol-col-gap:${MOL_COL_GAP};
      --mol-page-h:${MOL_SAFE_PAGE_H};
    ">${pagesHtml}</div>`;
}

function mol_preview(){
  const { cfg, entries } = mol_collect();
  const wrap = $('#mol-preview-wrap');
  if (!wrap) return;

  if (!entries.length){
    wrap.innerHTML = '<div class="muted" style="margin-top:6px">Zatiaľ nie sú zadané žiadne riadky.</div>';
    return;
  }

  mol_validate(entries);

  const html = mol_buildMarkup(cfg, entries);
  const perPageLabels = (cfg.rowsPerPage || 6) * 2;

  wrap.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <div class="card-header">
        <strong>Náhľad</strong>
        <span class="muted">(${entries.length} strán / ${perPageLabels} štítkov na stranu)</span>
        <span class="muted" style="margin-left:10px;">Dátum je voliteľný.</span>
      </div>
      <div class="card-body" style="overflow:auto;">
        <div class="mol-preview">${html}</div>
      </div>
    </div>
  `;
}

function mol_openPrintWindow(markup){
  const css = `
    @page { size: A4; margin: 10mm; }
    html, body { height: 100%; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }

    .mol-root { font-size: var(--mol-font, 11px); }

    .mol-page { page-break-after: always; }
    .mol-page:last-child { page-break-after: auto; }

    /* rovnomerné rozloženie na A4 + medzery na strihanie */
    .mol-entry {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: var(--mol-col-gap, 6mm);
      margin-bottom: var(--mol-row-gap, 5mm);

      /* výška jedného "riadku štítkov" aby sa pekne vyplnila strana */
      height: calc((var(--mol-page-h, 275mm) - (var(--mol-rows, 6) - 1) * var(--mol-row-gap, 5mm)) / var(--mol-rows, 6));
    }
    .mol-page .mol-entry:last-child { margin-bottom: 0; }

    .mol-label {
      width: 100%;
      height: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #000;
    }
    .mol-label td {
      border: 1px solid #000;
      padding: 2mm 2.2mm;
      vertical-align: middle;
    }

    .mol-company, .mol-approval, .mol-title { text-align: center; font-weight: 700; }
    .mol-company { font-size: 1.05em; }
    .mol-title { font-size: 1.05em; }
    .mol-lbl { font-weight: 700; white-space: nowrap; }
    .mol-val { overflow: hidden; text-overflow: ellipsis; }
  `;

  const w = window.open('', '_blank');
  if (!w){
    showStatus('Prehliadač zablokoval tlačové okno (pop-up). Povoľte pop-up pre túto stránku.', true);
    return null;
  }
  w.document.open();
  w.document.write(`<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Štítky pôvodu mäsa</title><style>${css}</style></head><body>${markup}</body></html>`);
  w.document.close();
  w.focus();
  return w;
}

function mol_printCore(cfg, entries, opts){
  const options = opts || {};
  if (!entries.length){
    showStatus('Zadajte aspoň 1 riadok (kód dávky, pôvod). Dátum je voliteľný.', true);
    return;
  }

  // validácia pre tlač bez UI (história): vyžadujeme len batch + origin
  const allOk = entries.every(it => safeStr(it.batch) && safeStr(it.origin));
  if (!allOk){
    showStatus('Niektoré riadky sú neúplné (chýba kód dávky alebo pôvod). Dátum môže byť prázdny.', true);
    return;
  }

  const markup = mol_buildMarkup(cfg, entries);
  const w = mol_openPrintWindow(markup);
  if (!w) return;

  setTimeout(()=>{ try{ w.print(); }catch(_){} }, 250);

  if (options.afterPrint) {
    try{ options.afterPrint(); }catch(_){ }
  }
}

// ------------------ HISTÓRIA (localStorage) ------------------
function mol_hist_load(){
  try{
    const raw = localStorage.getItem(MOL_HISTORY_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  }catch(_){ return []; }
}
function mol_hist_store(list){
  try{ localStorage.setItem(MOL_HISTORY_KEY, JSON.stringify(Array.isArray(list) ? list : [])); }catch(_){ }
}
function mol_hist_makeId(){
  return 'mol_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}
function mol_hist_keyOf(item){
  const cfg = item.cfg || {};
  const row = item.row || {};
  return [cfg.type, row.date, row.batch, row.origin, row.ref, cfg.cutText].map(x=> safeStr(x)).join('|');
}
function mol_hist_upsert(cfg, entries){
  const nowIso = new Date().toISOString();
  const cur = mol_hist_load();

  const idxByKey = new Map();
  cur.forEach((it, i)=>{ idxByKey.set(mol_hist_keyOf(it), i); });

  (entries||[]).forEach(e=>{
    const row = { date: safeStr(e.date), batch: safeStr(e.batch), origin: safeStr(e.origin), ref: safeStr(e.ref) };
    const item = {
      id: mol_hist_makeId(),
      ts: nowIso,
      cfg: {
        type: safeStr(cfg.type),
        company: safeStr(cfg.company),
        approval: safeStr(cfg.approval),
        dateLabel: safeStr(cfg.dateLabel),
        rowsPerPage: Math.max(1, Math.min(12, Math.floor(toNum(cfg.rowsPerPage, 6)) || 6)),
        dateFormat: safeStr(cfg.dateFormat),
        fontSize: Math.max(8, Math.min(16, Math.floor(toNum(cfg.fontSize, 11)) || 11)),
        cutText: safeStr(cfg.cutText)
      },
      row
    };

    const key = mol_hist_keyOf(item);
    if (idxByKey.has(key)){
      const i = idxByKey.get(key);
      cur[i].ts = nowIso;
      cur[i].cfg = item.cfg;
      cur[i].row = item.row;
    } else {
      cur.unshift(item);
    }
  });

  mol_hist_store(cur.slice(0, 200));
}
function mol_hist_delete(id){
  const cur = mol_hist_load();
  mol_hist_store(cur.filter(it => String(it.id) !== String(id)));
}
function mol_hist_clear(){ mol_hist_store([]); }

function mol_hist_typeLabel(type){
  const t = String(type||'').toLowerCase();
  if (t === 'poultry') return 'Hydina';
  if (t === 'pork') return 'Ošípané';
  return 'Hovädzie';
}
function mol_hist_fmtTs(iso){
  const s = safeStr(iso);
  if (!s) return '';
  try{ return new Date(s).toLocaleString('sk-SK'); }catch(_){ return s; }
}

function mol_hist_render(){
  const host = $('#mol-history-list');
  if (!host) return;

  const filter = safeStr($('#mol-history-filter')?.value || '').toLowerCase();
  let items = mol_hist_load();
  items.sort((a,b)=> String(b.ts||'').localeCompare(String(a.ts||'')));

  if (filter){
    items = items.filter(it=>{
      const r = it.row || {};
      const c = it.cfg || {};
      const hay = [r.date, r.batch, r.origin, r.ref, c.type, c.cutText].map(x=> String(x||'').toLowerCase()).join(' | ');
      return hay.includes(filter);
    });
  }

  if (!items.length){
    host.innerHTML = '<div class="muted" style="padding:8px 0">História je prázdna.</div>';
    return;
  }

  host.innerHTML = `
    <div class="table-container">
      <table class="tbl" id="mol-history-table">
        <thead>
          <tr>
            <th style="width:120px">Dátum</th>
            <th style="width:140px">Kód dávky</th>
            <th style="width:180px" class="mol-beef-only">Referenčné</th>
            <th>Pôvod</th>
            <th style="width:110px">Typ</th>
            <th style="width:170px">Uložené</th>
            <th style="width:220px"></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it=>{
            const r = it.row || {};
            const c = it.cfg || {};
            return `
              <tr>
                <td>${escapeHtml(r.date || '')}</td>
                <td><span style="font-family:monospace">${escapeHtml(r.batch || '')}</span></td>
                <td class="mol-beef-only"><span style="font-family:monospace">${escapeHtml(r.ref || r.batch || '')}</span></td>
                <td>${escapeHtml(r.origin || '')}</td>
                <td>${escapeHtml(mol_hist_typeLabel(c.type))}</td>
                <td>${escapeHtml(mol_hist_fmtTs(it.ts))}</td>
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn btn-sm btn-secondary" data-mol-hload="${escapeHtml(it.id)}">Vložiť</button>
                  <button class="btn btn-sm btn-secondary" data-mol-hprint="${escapeHtml(it.id)}">Tlačiť (A4)</button>
                  <button class="btn btn-sm" data-mol-hdel="${escapeHtml(it.id)}">×</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="muted" style="margin-top:6px">
      Poznámka: História je uložená v tomto prehliadači (localStorage). Dátum je voliteľný.
    </div>
  `;

  host.querySelectorAll('[data-mol-hdel]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-mol-hdel');
      mol_hist_delete(id);
      mol_hist_render();
    };
  });

  // NOVÉ: "Tlačiť (A4)" vždy vytlačí plnú A4 stranu (namnožené)
  host.querySelectorAll('[data-mol-hprint]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-mol-hprint');
      const it = mol_hist_load().find(x=> String(x.id) === String(id));
      if (!it) return;

      const cfg = Object.assign({}, it.cfg || {});
      cfg.rowsPerPage = Math.max(1, Math.min(12, Math.floor(toNum(cfg.rowsPerPage, 6)) || 6));

      const entries = [Object.assign({}, it.row || {})];
      mol_applyBeefVisibility(cfg.type);
      mol_printCore(cfg, entries, { afterPrint: null });
    };
  });

  host.querySelectorAll('[data-mol-hload]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute('data-mol-hload');
      const it = mol_hist_load().find(x=> String(x.id) === String(id));
      if (!it) return;

      const cfg = it.cfg || {};
      const row = it.row || {};

      const typeSel = $('#mol-type');
      if (typeSel && cfg.type){ typeSel.value = cfg.type; }
      mol_applyBeefVisibility(cfg.type);

      const companyEl = $('#mol-company');
      if (companyEl) companyEl.value = cfg.company || companyEl.value;

      const approvalEl = $('#mol-approval');
      if (approvalEl) approvalEl.value = cfg.approval || approvalEl.value;

      const dateLblSel = $('#mol-date-label');
      if (dateLblSel && cfg.dateLabel){
        if (Array.from(dateLblSel.options||[]).some(o=> String(o.value) === String(cfg.dateLabel))){
          dateLblSel.value = cfg.dateLabel;
        }
      }

      const rppEl = $('#mol-rows-per-page');
      if (rppEl && cfg.rowsPerPage) rppEl.value = String(cfg.rowsPerPage);

      const dfEl = $('#mol-date-format');
      if (dfEl && cfg.dateFormat){
        if (Array.from(dfEl.options||[]).some(o=> String(o.value) === String(cfg.dateFormat))){
          dfEl.value = cfg.dateFormat;
        }
      }

      const fsEl = $('#mol-font-size');
      if (fsEl && cfg.fontSize) fsEl.value = String(cfg.fontSize);

      const cutEl = $('#mol-cuttext');
      if (cutEl && mol_isBeef(cfg.type)) cutEl.value = cfg.cutText || mol_defaultCutText();

      const tb = $('#mol-items tbody');
      mol_addRow(tb, { date: row.date, batch: row.batch, origin: row.origin, ref: row.ref });

      mol_preview();
    };
  });

  mol_applyBeefVisibility();
}

function mol_saveHistory(){
  const { cfg, entries } = mol_collect();
  if (!entries.length){
    showStatus('Zadajte aspoň 1 riadok (kód dávky, pôvod). Dátum je voliteľný.', true);
    return;
  }
  const ok = mol_validate(entries);
  if (!ok){
    showStatus('Niektoré riadky sú neúplné (chýba kód dávky alebo pôvod). Dátum môže byť prázdny.', true);
    return;
  }
  mol_hist_upsert(cfg, entries);
  mol_hist_render();
  showStatus('Uložené do histórie dávok.', false);
}

function mol_print(){
  const { cfg, entries } = mol_collect();
  if (!entries.length){
    showStatus('Zadajte aspoň 1 riadok (kód dávky, pôvod). Dátum je voliteľný.', true);
    return;
  }
  const ok = mol_validate(entries);
  if (!ok){
    showStatus('Niektoré riadky sú neúplné (chýba kód dávky alebo pôvod). Dátum môže byť prázdny.', true);
    return;
  }

  // uložiť do histórie
  mol_hist_upsert(cfg, entries);
  mol_hist_render();

  // Tlač: každá dávka = 1 strana (A4 vyplnená namnoženými štítkami)
  mol_printCore(cfg, entries, {});
}

function initMeatOriginLabels(){
  if (__mol_inited) return;
  const tb = $('#mol-items tbody');
  if (!tb) return;
  __mol_inited = true;

  // necháme 6 prázdnych riadkov – používateľ vyplní len potrebné (ostatné sa ignorujú)
  for (let i=0; i<6; i++) mol_addRow(tb);

  const typeSel = $('#mol-type');
  const dateLblSel = $('#mol-date-label');

  function applyTypeDefaults(){
    const t = safeStr(typeSel?.value || 'beef');
    const desired = mol_defaultDateLabel(t);
    if (dateLblSel && Array.from(dateLblSel.options||[]).some(o=> String(o.value) === desired)) {
      dateLblSel.value = desired;
    }
    mol_applyBeefVisibility(t);
  }
  applyTypeDefaults();

  $('#mol-add') && ($('#mol-add').onclick = ()=> mol_addRow(tb));
  $('#mol-preview') && ($('#mol-preview').onclick = mol_preview);
  $('#mol-print') && ($('#mol-print').onclick = mol_print);
  $('#mol-save-history') && ($('#mol-save-history').onclick = mol_saveHistory);

  typeSel && typeSel.addEventListener('change', ()=>{ applyTypeDefaults(); });

  const hFilter = $('#mol-history-filter');
  hFilter && hFilter.addEventListener('input', ()=> mol_hist_render());
  $('#mol-history-clear') && ($('#mol-history-clear').onclick = ()=>{ if (confirm('Naozaj chcete vyčistiť celú históriu dávok?')){ mol_hist_clear(); mol_hist_render(); } });

  // auto preview debounce
  let t = null;
  const schedulePreview = ()=>{ clearTimeout(t); t = setTimeout(()=> mol_preview(), 250); };
  ['mol-type','mol-company','mol-approval','mol-cuttext','mol-date-label','mol-rows-per-page','mol-date-format','mol-font-size'].forEach(id=>{
    const el = $('#'+id);
    el && el.addEventListener('change', schedulePreview);
  });
  tb.addEventListener('input', schedulePreview);

  mol_hist_render();
}
// =================================================================
// LOGISTIKA & TRASY (Mirror z B2B Admin)
// =================================================================

// Hlavná funkcia na načítanie zoznamu trás
async function loadLogistics() {
    // Použijeme kontajner špecifický pre leadera, ak neexistuje, vytvoríme ho
    let box = document.getElementById('leader-logistics-container');
    if (!box) {
        // Ak voláte túto funkciu, predpokladá sa, že existuje nejaký hlavný div, kam to vložiť.
        // Ak nie, nájdeme hlavný content a vložíme to tam.
        const mainContent = document.getElementById('leader-view-content') || document.querySelector('.container-fluid') || document.body;
        box = document.createElement('div');
        box.id = 'leader-logistics-container';
        box.className = 'tab-content-view'; // Pre CSS štýlovanie
        mainContent.appendChild(box);
    }

    // Vyčistíme a zobrazíme loader
    // Skryjeme ostatné viewy (ak máte funkciu hideAllViews, použite ju, inak manuálne skryjeme iné kontajnery)
    document.querySelectorAll('.tab-content-view').forEach(el => el.style.display = 'none');
    box.style.display = 'block';
    
    box.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Načítavam trasy...</p></div>';

    try {
        // Voláme API na získanie trás (používame rovnaké API ako admin)
        const data = await callFirstOk([{ url: '/api/kancelaria/b2b/getRoutes' }]);
        state.routes = data.routes || [];

        let html = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h3><i class="fas fa-truck"></i> Logistika & Trasy</h3>
                <button class="btn btn-success" onclick="window.editRoute(null)"><i class="fas fa-plus"></i> Nová trasa</button>
            </div>
            
            <div class="stat-card">
                <table class="table table-hover align-middle">
                    <thead class="table-light">
                        <tr>
                            <th>Názov trasy</th>
                            <th>Poznámka / Šofér</th>
                            <th class="text-center">Stav</th>
                            <th class="text-end">Akcia</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (state.routes.length === 0) {
            html += `<tr><td colspan="4" class="text-center text-muted p-3">Zatiaľ nie sú definované žiadne trasy.</td></tr>`;
        } else {
            state.routes.forEach(r => {
                const badge = r.aktivna 
                    ? '<span class="badge bg-success">Aktívna</span>' 
                    : '<span class="badge bg-secondary">Neaktívna</span>';
                
                html += `
                    <tr>
                        <td><strong>${escapeHtml(r.nazov_trasy)}</strong></td>
                        <td>${escapeHtml(r.poznamka || '')}</td>
                        <td class="text-center">${badge}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-outline-primary" onclick="window.editRoute(${r.id})">Upraviť</button>
                            <button class="btn btn-sm btn-outline-danger ms-1" onclick="window.deleteRoute(${r.id})">Zmazať</button>
                        </td>
                    </tr>
                `;
            });
        }

        html += `</tbody></table></div>`;
        box.innerHTML = html;

    } catch (e) {
        box.innerHTML = `<div class="alert alert-danger">Chyba pri načítaní trás: ${e.message}</div>`;
    }
}

// Otvorenie modálneho okna pre úpravu/vytvorenie trasy
window.editRoute = function(id) {
    const route = id ? state.routes.find(r => r.id === id) : { nazov_trasy: '', poznamka: '', aktivna: 1 };
    if (!route) return;

    const modalHtml = `
        <div class="form-group mb-3">
            <label class="form-label fw-bold">Názov trasy</label>
            <input type="text" id="route-name" class="form-control" value="${escapeHtml(route.nazov_trasy)}" placeholder="Napr. Trasa Žilina - Utorok">
        </div>
        <div class="form-group mb-3">
            <label class="form-label">Poznámka / Šofér</label>
            <input type="text" id="route-note" class="form-control" value="${escapeHtml(route.poznamka || '')}" placeholder="Meno šoféra alebo dni rozvozu">
        </div>
        <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="route-active" ${route.aktivna ? 'checked' : ''}>
            <label class="form-check-label" for="route-active">Trasa je aktívna (zobrazovať v ponuke)</label>
        </div>
        <div class="text-end mt-4">
            <button class="btn btn-secondary me-2" onclick="closeModal()">Zrušiť</button>
            <button class="btn btn-success" onclick="window.saveRoute(${id || 'null'})">Uložiť trasu</button>
        </div>
    `;

    openModal(modalHtml, id ? 'Upraviť trasu' : 'Nová trasa');
};

// Uloženie trasy
window.saveRoute = async function(id) {
    const name = document.getElementById('route-name').value.trim();
    const note = document.getElementById('route-note').value.trim();
    const active = document.getElementById('route-active').checked ? 1 : 0;

    if (!name) return alert("Zadajte názov trasy.");

    try {
        await callFirstOk([{
            url: '/api/kancelaria/b2b/updateRoute', // Predpokladám, že tento endpoint existuje v b2b_handler
            opts: {
                method: 'POST',
                body: {
                    id: id,
                    nazov_trasy: name,
                    poznamka: note,
                    aktivna: active
                }
            }
        }]);

        showStatus("Trasa bola uložená.");
        closeModal();
        loadLogistics(); // Obnovíme zoznam
    } catch (e) {
        alert("Chyba pri ukladaní: " + e.message);
    }
};

// Vymazanie trasy
window.deleteRoute = async function(id) {
    if (!confirm("Naozaj chcete vymazať túto trasu? Zákazníci priradení k tejto trase stratia priradenie.")) return;

    try {
        await callFirstOk([{
            url: '/api/kancelaria/b2b/deleteRoute', // Predpokladám endpoint
            opts: { method: 'POST', body: { id: id } }
        }]);
        showStatus("Trasa vymazaná.");
        loadLogistics();
    } catch (e) {
        alert("Chyba: " + e.message);
    }
};
  // ============================== BOOT =====================================
  function attachSupplierAutocomplete(){
    const input = $('#nb2b-name'); if (!input) return;
    let popup = $('#nb2b-suggest');
    if (!popup){ popup = doc.createElement('div'); popup.id='nb2b-suggest'; popup.style.cssText='position:absolute;z-index:1000;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.15);display:none;max-height:240px;overflow:auto'; doc.body.appendChild(popup); }
    function position(){ const r = input.getBoundingClientRect(); popup.style.left=(window.scrollX+r.left)+'px'; popup.style.top=(window.scrollY+r.bottom+4)+'px'; popup.style.minWidth=r.width+'px'; }
    input.addEventListener('input', async ()=>{
      const q = input.value.trim(); if (q.length < 2){ popup.style.display='none'; return; }
      position(); popup.innerHTML = '<div style="padding:.5rem" class="muted">Hľadám…</div>'; popup.style.display='block';
      const list = await searchSuppliers(q);
      if (!list.length){ popup.innerHTML = '<div style="padding:.5rem" class="muted">Žiadne výsledky</div>'; return; }
      popup.innerHTML = list.map(x=>`<div data-id="${escapeHtml(String(x.id))}" data-json='${escapeHtml(JSON.stringify(x))}' style="padding:.4rem .6rem;cursor:pointer">${escapeHtml(x.name)} <span class="muted">(${escapeHtml(x.code||'')})</span></div>`).join('');
      Array.from(popup.children).forEach(div=>{
        div.onclick = async ()=>{
          const data = JSON.parse(div.getAttribute('data-json')); __pickedCustomer = data; input.value = data.name; popup.style.display='none';
          const box = $('#nb2b-pl-box') || (()=>{ const d = doc.createElement('div'); d.id='nb2b-pl-box'; d.className='muted'; d.style.margin='8px 0'; const body = $('#manual-b2b-form .card-body') || $('#leader-manual-b2b .card .card-body') || doc.body; body.insertBefore(d, body.firstChild); return d; })();
          const pls = await fetchPricelists(data.id);
          if (!pls.length){ box.innerHTML = '<div class="muted">Pre odberateľa nie sú evidované cenníky.</div>'; __pickedPricelist=null; __pricelistMapByEAN=Object.create(null); return; }
          box.innerHTML = `<label>Vyber cenník:</label> <select id="nb2b-pl" style="min-width:260px">${pls.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name||('Cenník '+String(p.id||'')))}</option>`).join('')}</select><div id="nb2b-pl-note" class="muted" style="margin-top:.25rem">Ceny položiek sa doplnia pri pridávaní EAN z vybraného cenníka.</div><div id="nb2b-pl-preview" style="margin-top:.5rem"></div>`;
          __pickedPricelist = pls[0]||null; __pricelistMapByEAN = Object.create(null);
          if (__pickedPricelist && Array.isArray(__pickedPricelist.items)){ __pickedPricelist.items.forEach(it=>{ if (it && it.ean != null) __pricelistMapByEAN[String(it.ean)] = toNum(it.price||it.cena_bez_dph||0,0); }); }
          renderPricelistPreview(__pickedPricelist, box);
          $('#nb2b-pl').onchange = (e)=>{
            const pick = pls.find(x=> String(x.id) === e.target.value); __pickedPricelist = pick || null; __pricelistMapByEAN = Object.create(null);
            if (__pickedPricelist && Array.isArray(__pickedPricelist.items)){ __pickedPricelist.items.forEach(it=>{ if (it && it.ean != null) __pricelistMapByEAN[String(it.ean)] = toNum(it.price||it.cena_bez_dph||0,0); }); }
            renderPricelistPreview(__pickedPricelist, box);
          };
        };
      });
    });
    window.addEventListener('resize', ()=>{ if(popup.style.display==='block') position(); }); document.addEventListener('click', (e)=>{ if (!popup.contains(e.target) && e.target!==input) popup.style.display='none'; });
  }

 function boot(){
    $$('.sidebar-link').forEach(a=>{
      a.onclick = ()=>{
        $$('.sidebar-link').forEach(x=> x.classList.remove('active')); a.classList.add('active');
        const secId = a.getAttribute('data-section'); $$('.content-section').forEach(s=> s.classList.remove('active'));
        const target = secId ? $('#'+secId) : null; if (target) target.classList.add('active');
        
        if (secId === 'leader-dashboard')  loadDashboard();
        if (secId === 'leader-b2c')        loadB2C();
        if (secId === 'leader-b2b')        loadB2B();
        // Nová podmienka pre B2B komunikáciu
       // static/js/leaderexpediction.js v rámci funkcie boot()

if (secId === 'leader-b2b-comm') {
    // Iba načítame dáta chatu. NESPÚŠŤAME initializeB2BAdminModule!
    if (typeof window.loadCommView === 'function') {
        window.loadCommView(); 
    } else {
        console.error("Funkcia loadCommView nie je dostupná.");
    }
}
        if (secId === 'leader-meat-origin-labels') { initMeatOriginLabels(); mol_preview(); }
        if (secId === 'leader-cut')        loadCutJobs();
        if (secId === 'leader-lowstock')   loadLeaderLowStockDetail();
        if (secId === 'leader-plan')       loadLeaderProductionCalendar();
      };
    });

    // Inicializácia dátumov
    $('#ldr-date') && ($('#ldr-date').value = todayISO());
    $('#b2c-date') && ($('#b2c-date').value = todayISO());
    $('#b2b-date') && ($('#b2b-date').value = todayISO());
    $('#cut-date') && ($('#cut-date').value = todayISO());
    $('#nb2b-date') && ($('#nb2b-date').value = todayISO());

    // Handlery tlačidiel
    $('#ldr-refresh') && ($('#ldr-refresh').onclick = loadDashboard);
    $('#plan-commit') && ($('#plan-commit').onclick = commitPlan);
    $('#b2c-refresh') && ($('#b2c-refresh').onclick = loadB2C);
    $('#b2b-refresh') && ($('#b2b-refresh').onclick = loadB2B);
    $('#leader-lowstock-refresh') && ($('#leader-lowstock-refresh').onclick = loadLeaderLowStockDetail);
    
    // Ostatné inicializácie
    attachProductSearch();
    attachSupplierAutocomplete();
    
    $('#nb2b-add')  && ($('#nb2b-add').onclick  = ()=> addManualRow($('#nb2b-items tbody')));
    $('#nb2b-save') && ($('#nb2b-save').onclick = saveManualB2B);
    
    $('#cut-refresh') && ($('#cut-refresh').onclick = loadCutJobs);
    $('#cut-new')     && ($('#cut-new').onclick     = openNewCutModal);

    // Predvolené načítanie dashboardu
    loadDashboard();
  

  // Init dates
  $('#ldr-date') && ($('#ldr-date').value = todayISO());
  $('#b2c-date') && ($('#b2c-date').value = todayISO());
  $('#b2b-date') && ($('#b2b-date').value = todayISO());
  $('#cut-date') && ($('#cut-date').value = todayISO());
  $('#nb2b-date') && ($('#nb2b-date').value = todayISO());

  // Handlers
  $('#ldr-refresh') && ($('#ldr-refresh').onclick = loadDashboard);
  $('#plan-commit') && ($('#plan-commit').onclick = commitPlan);
  $('#b2c-refresh') && ($('#b2c-refresh').onclick = loadB2C);
  $('#b2b-refresh') && ($('#b2b-refresh').onclick = loadB2B);
  $('#leader-lowstock-refresh') && ($('#leader-lowstock-refresh').onclick = loadLeaderLowStockDetail);
  
  // --- NOVÉ FUNKCIE ---
  attachProductSearch();

  attachSupplierAutocomplete();
  $('#nb2b-add')  && ($('#nb2b-add').onclick  = ()=> addManualRow($('#nb2b-items tbody')));
  $('#nb2b-save') && ($('#nb2b-save').onclick = saveManualB2B);
  
  // CUT JOBS LISTENERS
  $('#cut-refresh') && ($('#cut-refresh').onclick = loadCutJobs);
  $('#cut-new')     && ($('#cut-new').onclick     = openNewCutModal);

  loadDashboard();
}

boot();
})(window, document);
