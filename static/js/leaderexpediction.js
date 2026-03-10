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

  root.showModal = (title, factory) => {
      if (typeof factory !== 'function') return;
      const res = factory();
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
      if($id('kpi-b2c')) $id('kpi-b2c').textContent    = (r.kpi && r.kpi.b2c_count!=null)    ? r.kpi.b2c_count    : '—';
      if($id('kpi-b2b')) $id('kpi-b2b').textContent    = (r.kpi && r.kpi.b2b_count!=null)    ? r.kpi.b2b_count    : '—';
      if($id('kpi-items')) $id('kpi-items').textContent = (r.kpi && r.kpi.items_total!=null) ? r.kpi.items_total : '—';
      if($id('kpi-sum')) $id('kpi-sum').textContent    = (r.kpi && r.kpi.sum_total!=null)    ? `${fmt2(r.kpi.sum_total)} €` : '—';

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
      await apiRequest('/api/kancelaria/b2c/sms/ready',   { method:'POST', body:{ order_id:id, order_no:no, final_price:price } }).catch(()=>{});
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
  
window.showManualRouteEditor = async function(id) {
    let template = { id: null, name: '', stops: [] };
    if (id) {
        const found = window.leaderLogisticsState.routeTemplates.find(t => t.id === id);
        if (found) template = found;
    }

    window.openLeaderModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam zoznam zákazníkov a adresár pre trasy...</div>');

    try {
        const sData = await apiRequest('/api/leader/b2b/getStores');
        window.leaderLogisticsState.stores = sData.stores || [];
    } catch(e) { window.leaderLogisticsState.stores = []; }

    try {
        const cData = await apiRequest('/api/leader/b2b/getCustomersAndPricelists');
        window.leaderLogisticsState.customers = cData.customers || [];
    } catch(e) { window.leaderLogisticsState.customers = []; }

    let availableStoresHtml = '';
    
    // Zákazníci z B2B systému
    if (window.leaderLogisticsState.customers && window.leaderLogisticsState.customers.length > 0) {
        window.leaderLogisticsState.customers.forEach(c => {
            const custName = c.nazov_firmy || c.name || 'Neznámy zákazník';
            const addr = c.adresa_dorucenia || c.adresa || '';
            const searchStr = (custName + ' ' + addr + ' ' + (c.zakaznik_id || '')).toLowerCase();
            
            availableStoresHtml += `
                <div class="tpl-store-item" data-search="${escapeHtml(searchStr)}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0; background:#fff; margin-bottom:2px; border-radius:4px;">
                    <div>
                        <strong style="color:#1e3a8a; font-size:0.95rem;">${escapeHtml(custName)}</strong> 
                        <span style="font-size:0.7rem; background:#bfdbfe; color:#1e3a8a; padding:2px 5px; border-radius:4px; margin-left:5px;">B2B</span><br>
                        <small style="color:#64748b;">${escapeHtml(addr)}</small>
                    </div>
                    <button class="btn btn-sm btn-outline-success" style="font-weight:bold; min-width:85px; border:1px solid #22c55e; background:transparent; color:#166534;" data-id="b2b_${c.id}" data-name="${escapeHtml(custName)}" data-note="${escapeHtml(addr)}" onclick="window.addStoreFromPanel(this)">+ Pridať</button>
                </div>
            `;
        });
    }

    // Manuálne prevádzky z adresára
    if (window.leaderLogisticsState.stores && window.leaderLogisticsState.stores.length > 0) {
        window.leaderLogisticsState.stores.forEach(s => {
            const searchStr = (s.name + ' ' + (s.note || '')).toLowerCase();
            availableStoresHtml += `
                <div class="tpl-store-item" data-search="${escapeHtml(searchStr)}" style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #e2e8f0; background:#f8fafc; margin-bottom:2px; border-radius:4px;">
                    <div>
                        <strong style="color:#0f172a; font-size:0.95rem;">${escapeHtml(s.name)}</strong> 
                        <span style="font-size:0.7rem; background:#e2e8f0; color:#334155; padding:2px 5px; border-radius:4px; margin-left:5px;">Manuálna</span><br>
                        <small style="color:#64748b;">${escapeHtml(s.note || 'Bez adresy')}</small>
                    </div>
                    <button class="btn btn-sm btn-outline-success" style="font-weight:bold; min-width:85px; border:1px solid #22c55e; background:transparent; color:#166534;" data-id="man_${s.id}" data-name="${escapeHtml(s.name)}" data-note="${escapeHtml(s.note || '')}" onclick="window.addStoreFromPanel(this)">+ Pridať</button>
                </div>
            `;
        });
    }

    let html = `
        <style>
            #leader-modal-wrapper .b2b-modal-content { max-width: 1400px !important; width: 95% !important; height: 90vh !important; display: flex !important; flex-direction: column !important; }
        </style>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; flex-shrink: 0;">
            <h3 style="margin:0; color:#1e3a8a;">${id ? '✏️ Úprava rozvozovej trasy' : '➕ Vytvorenie novej rozvozovej trasy'}</h3>
        </div>
        
        <div style="display:flex; gap:20px; align-items:flex-start; flex: 1; min-height: 0;">
            
            <div style="flex: 1; background:#f1f5f9; padding:20px; border-radius:8px; border:1px solid #cbd5e1; display:flex; flex-direction:column; height: 100%;">
                <div class="form-group" style="margin-bottom:15px; flex-shrink: 0;">
                    <label style="font-weight:bold; color:#0f172a; font-size:1.1rem; margin-bottom:5px; display:block;">Názov rozvozovej trasy</label>
                    <input type="text" id="tpl-name" class="form-control" style="width:100%; font-size:1.2rem; font-weight:bold; border:2px solid #3b82f6; border-radius:6px; padding:10px;" value="${escapeHtml(template.name)}" placeholder="Zadajte názov trasy...">
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
                    <input type="text" oninput="window.filterAvailableStores(this.value)" class="form-control" style="width:100%; font-size:1rem; padding:10px; border:1px solid #94a3b8; border-radius:6px;" placeholder="Hľadať zákazníkov, mestá...">
                </div>

                <div style="display:flex; gap:10px; margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #e2e8f0; flex-shrink: 0;">
                    <input type="text" id="tpl-custom-stop" class="form-control" style="flex:1; padding:8px; border-radius:4px; border:1px solid #cbd5e1;" placeholder="Pridať vlastný názov (napr. Sklad)">
                    <button class="btn btn-primary" onclick="window.addCustomStorePanel()">Pridať ➕</button>
                </div>
                
                <div id="tpl-available-stores" style="flex:1; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; padding:5px;">
                    ${availableStoresHtml}
                </div>
            </div>
        </div>
    `;
    window.openLeaderModal(html);

    if (template.stops && template.stops.length > 0) {
        template.stops.forEach(s => window.renderStopRow(s.name, s.note, s.store_id || ''));
    }
};
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

  // ================= AMBULANTNÝ PREDAJ - FUNKCIE =================

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

      // 3. Notifikácia (CSV na sklad)
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
   
  async function cancelCutJob(id) {
    if (!confirm("Naozaj chcete zrušiť túto úlohu? Surovina sa vráti na sklad.")) return;
    try {
        await apiRequest('/api/leader/cut_jobs/cancel', { method: 'POST', body: { id: id } });
        showStatus("Úloha bola zrušená.", false);
        loadCutJobs();
    } catch (e) {
        showStatus(e.message || String(e), true);
    }
  }
  root.cancelCutJob = cancelCutJob;

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
        
        let selectedEan = '';
        let selectedName = '';
        
        select.addEventListener('change', () => {
            selectedEan = select.value;
            selectedName = select.options[select.selectedIndex].text;
        });

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

        document.addEventListener('click', (e) => {
            if (e.target !== customerInput) suggestionsBox.style.display = 'none';
        });

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
                loadCutJobs();
            } catch (e) {
                showStatus(e.message, true);
            }
        };
    });
  }

  // ======================= ŠTÍTKY PÔVODU MÄSA (TLAČ) =======================
  var __mol_inited = false;
  const MOL_HISTORY_KEY = 'mol_history_v1';

  const MOL_ROW_GAP = '5mm';    
  const MOL_COL_GAP = '6mm';    
  const MOL_SAFE_PAGE_H = '275mm'; 

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
    if (!s) return ''; 
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

        if (date || batch || origin || ref){
          entries.push({ date, batch, origin, ref, _tr: tr });
        }
      });
    }

    const cfg = { type, company, approval, dateLabel, rowsPerPage, dateFormat, fontSize, cutText };
    return { cfg, entries };
  }

  function mol_validate(entries){
    let ok = true;
    (entries||[]).forEach(it=>{
      const tr = it._tr;
      const bad = !(safeStr(it.batch) && safeStr(it.origin));
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

      .mol-entry {
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: var(--mol-col-gap, 6mm);
        margin-bottom: var(--mol-row-gap, 5mm);

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

    mol_hist_upsert(cfg, entries);
    mol_hist_render();
    mol_printCore(cfg, entries, {});
  }

  function initMeatOriginLabels(){
    if (__mol_inited) return;
    const tb = $('#mol-items tbody');
    if (!tb) return;
    __mol_inited = true;

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

    let t = null;
    const schedulePreview = ()=>{ clearTimeout(t); t = setTimeout(()=> mol_preview(), 250); };
    ['mol-type','mol-company','mol-approval','mol-cuttext','mol-date-label','mol-rows-per-page','mol-date-format','mol-font-size'].forEach(id=>{
      const el = $('#'+id);
      el && el.addEventListener('change', schedulePreview);
    });
    tb.addEventListener('input', schedulePreview);

    mol_hist_render();
  }

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

  // =================================================================
  // 🚛 LOGISTIKA & TRASY (Zrkadlenie z Kancelárie pre Vedúceho)
  // =================================================================

  window.leaderLogisticsState = { customers: [], stores: [], routeTemplates: [] };

  window.openLeaderModal = function(html) {
      let wrapper = document.getElementById('leader-modal-wrapper');
      if (!wrapper) {
          wrapper = document.createElement('div');
          wrapper.id = 'leader-modal-wrapper';
          document.body.appendChild(wrapper);
      }
      wrapper.innerHTML = `<div class="b2b-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;justify-content:center;align-items:center;">
          <div class="b2b-modal-content" style="background:white;padding:25px;border-radius:12px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);">
              <div style="text-align:right;margin-bottom:10px;"><span style="cursor:pointer;font-size:1.5rem;" onclick="window.closeLeaderModal()">&times;</span></div>
              ${html}
          </div>
      </div>`;
      wrapper.style.display = 'block';
  };

  window.closeLeaderModal = function() {
      const w = document.getElementById('leader-modal-wrapper');
      if(w) w.style.display = 'none';
  };

  root.loadLogistics = async function() {
      $$('.content-section').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
      $$('.sidebar-link').forEach(l => l.classList.remove('active'));
      
      const sec = $('#leader-logistics');
      if (sec) { 
          sec.classList.add('active'); 
          sec.style.display = 'block'; 
      }
      
      const btn = document.querySelector('.sidebar-link i.fa-truck')?.closest('a');
      if(btn) btn.classList.add('active');

      const box = $('#leader-logistics-container');
      if (!box) return;

      const today = todayISO();
      
      box.innerHTML = `
          <div style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:20px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div style="display:flex; align-items:center; gap:15px;">
                      <h4 style="margin:0; color:#1e293b;">🚛 Plánovanie rozvozu</h4>
                      <button class="btn btn-secondary btn-sm" onclick="window.manageManualRoutes()">📝 Manuálne šablóny</button>
                      <button class="btn btn-primary btn-sm" onclick="window.manageStores()">🏢 Adresár prevádzok</button>
                  </div>
                  <div style="display:flex; gap:10px; align-items:center;">
                      <label style="font-weight:bold;">Deň rozvozu (Dodania):</label>
                      <input type="date" id="logistics-date" class="form-control" style="width:auto; display:inline-block;" value="${today}">
                      <button id="logistics-load-btn" class="btn btn-success"><i class="fas fa-sync"></i> Načítať trasy</button>
                  </div>
              </div>
          </div>
          <div id="logistics-content">
              <p style="color:#666;">Kliknite na "Načítať trasy" pre zobrazenie zoznamu.</p>
          </div>
      `;

      document.getElementById('logistics-load-btn').onclick = async () => {
          const date = document.getElementById('logistics-date').value;
          const content = document.getElementById('logistics-content');
          content.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Sťahujem dáta...</div>';

          try {
              const res = await apiRequest(`/api/leader/logistics/routes-data?date=${date}`);
              const trasy = res.trasy || [];
              
              let vehicles = [];
              try {
                  const vRes = await apiRequest('/api/fleet/active-vehicles');
                  vehicles = vRes.vehicles || [];
              } catch(ve) { console.error("Autá sa nenačítali"); }

              if (trasy.length === 0) {
                  content.innerHTML = '<div style="padding:20px;text-align:center;font-weight:bold;color:#dc2626;">Na tento deň nie sú naplánované žiadne objednávky pre rozvoz.</div>';
                  return;
              }

              const allRoutes = res.all_routes || [];
              const routeOptions = allRoutes.map(r => `<option value="${r.id}">${escapeHtml(r.nazov)}</option>`).join('');

              let html = '';
              trasy.forEach(t => {
                  html += `
                  <div style="margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius:8px; overflow:hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                      <div style="background:#f1f5f9; padding:15px; display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #0284c7;">
                          <h3 style="margin:0; color:#0f172a;">🚛 ${escapeHtml(t.nazov)}</h3>
                          <div style="display:flex; gap:10px;">
                              <button class="btn btn-warning btn-sm" style="color:#000; font-weight:bold;" onclick='window.printChecklist(${JSON.stringify(t).replace(/'/g, "&apos;")}, "${date}")'>📝 Nakládkový list (Itinerár)</button>
                              <button class="btn btn-dark btn-sm" onclick='window.printSummary(${JSON.stringify(t).replace(/'/g, "&apos;")}, "${date}")'>📦 Súhrn do auta</button>
                          </div>
                      </div>
                      <div style="padding:15px; background:#fff; display:flex; gap:20px; flex-wrap:wrap;">
                          
                          <div style="flex:1; min-width:400px;">
                              <div style="background:#e0f2fe; padding:10px; margin-bottom:15px; border-radius:6px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; border:1px solid #bae6fd;">
                                  <span style="font-weight:bold; color:#0369a1;"><i class="fas fa-random"></i> Presunúť označených do trasy:</span>
                                  <select id="bulk-route-sel-${t.trasa_id}" class="form-control form-control-sm" style="width:auto; flex:1; max-width:250px;">
                                      <option value="">-- Vyber trasu --</option>
                                      ${routeOptions}
                                      <option value="unassigned">Zrušiť trasu (Nezaradené)</option>
                                  </select>
                                  <button class="btn btn-primary btn-sm" onclick="window.bulkAssignRoute('${t.trasa_id}')"><i class="fas fa-check"></i> Vykonať presun</button>
                              </div>

                              <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                                  <thead>
                                      <tr style="border-bottom:1px solid #e2e8f0; background:#f8fafc; text-align:left;">
                                          <th style="width:30px; text-align:center; padding:8px;"><input type="checkbox" onclick="window.toggleAllLogistics(this, '${t.trasa_id}')" style="transform:scale(1.2); cursor:pointer;"></th>
                                          <th style="width:60px; text-align:center; padding:8px;">Poradie</th>
                                          <th style="padding:8px;">Odberateľ a Adresa</th>
                                          <th style="padding:8px;">Objednávky</th>
                                          <th style="text-align:center; padding:8px;">Uložiť</th>
                                      </tr>
                                  </thead>
                                  <tbody>
                                      ${t.zastavky.map((z) => `
                                          <tr style="border-bottom:1px solid #f1f5f9; ${z.zakaznik_id === '0' ? 'opacity:0.6; background:#fef2f2;' : ''}">
                                              <td style="text-align:center; padding:8px;">
                                                  ${z.zakaznik_id !== '0' ? `<input type="checkbox" class="route-cb-${t.trasa_id}" value="${z.zakaznik_id}" style="transform:scale(1.2); cursor:pointer;">` : `<i class="fas fa-ban text-danger" title="Tento zákazník nemá ID a nedá sa presunúť."></i>`}
                                              </td>
                                              <td style="text-align:center; padding:8px;">
                                                  <input type="number" value="${z.poradie}" style="width:60px; text-align:center; font-weight:bold; border:1px solid #ccc; padding:4px; border-radius:4px;" id="poradie_${z.zakaznik_id}">
                                              </td>
                                              <td style="padding:8px;">
                                                  <strong style="font-size:1rem; color:#0f172a;">${escapeHtml(z.odberatel)}</strong><br>
                                                  <small style="color:#64748b;">${escapeHtml(z.adresa)}</small>
                                              </td>
                                              <td style="padding:8px;">
                                                  <span style="background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:bold;">${z.pocet_objednavok} obj.</span><br>
                                                  <small style="color:#94a3b8;">${z.cisla_objednavok.join(', ')}</small>
                                              </td>
                                              <td style="text-align:center; padding:8px;">
                                                  <button class="btn btn-secondary btn-sm" onclick="window.saveRouteOrder(${z.zakaznik_id})">💾</button>
                                              </td>
                                          </tr>
                                      `).join('')}
                                  </tbody>
                              </table>
                              
                              <div style="margin-top: 15px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; display:flex; gap:10px; align-items:center;">
                                  <label style="font-weight:bold; color:#166534; margin:0;"><i class="fas fa-car"></i> Založiť knihu jázd:</label>
                                  <select id="veh_${t.trasa_id}" class="form-control" style="flex:1; display:inline-block; width:auto;">
                                      <option value="">-- Vyberte auto z Fleet modulu --</option>
                                      ${vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})</option>`).join('')}
                                  </select>
                                  <button class="btn btn-success btn-sm" onclick="window.assignVehicleToFleet('${escapeHtml(t.nazov)}', '${t.trasa_id}')">Založiť jazdu</button>
                              </div>
                          </div>
                          
                          <div style="width:350px; background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0;">
                              <h5 style="border-bottom:1px solid #cbd5e1; padding-bottom:8px; margin-top:0; color:#475569;">Čo naložiť do auta (Kontrolný list)</h5>
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
  };

  window.assignVehicleToFleet = async function(routeName, routeId) {
      const date = document.getElementById('logistics-date').value;
      const vehicleId = document.getElementById(`veh_${routeId}`).value;
      if(!vehicleId) return showStatus("Najprv vyberte auto z rolovacieho zoznamu.", true);
      try {
          const res = await apiRequest('/api/leader/logistics/assign-vehicle', { method: 'POST', body: { date: date, route_name: routeName, vehicle_id: vehicleId } });
          showStatus(res.message, false);
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.saveRouteOrder = async function(custId) {
      const poradie = document.getElementById(`poradie_${custId}`).value;
      try {
          await apiRequest('/api/leader/b2b/updateCustomerRouteOrder', { method: 'POST', body: { zakaznik_id: custId, poradie: poradie } });
          showStatus('Poradie uložené.', false);
          document.getElementById('logistics-load-btn').click();
      } catch(e) { showStatus('Chyba: ' + e.message, true); }
  };

  window.manageStores = async function() {
      window.openLeaderModal('<div style="padding:30px; text-align:center;">Načítavam adresár...</div>');
      try {
          const data = await apiRequest('/api/leader/b2b/getStores');
          window.leaderLogisticsState.stores = data.stores || [];

          let listHtml = `<table class="tbl" style="width:100%; border-collapse:collapse; text-align:left;"><thead><tr style="border-bottom:2px solid #ccc;"><th style="padding:10px;">Názov prevádzky</th><th>Poznámka / Adresa</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if (window.leaderLogisticsState.stores.length === 0) {
              listHtml += `<tr><td colspan="3" style="text-align:center; padding:20px;">Zatiaľ nemáte žiadne manuálne prevádzky.</td></tr>`;
          } else {
              window.leaderLogisticsState.stores.forEach(s => {
                  listHtml += `<tr style="border-bottom:1px solid #eee;">
                      <td style="padding:10px;"><strong>${escapeHtml(s.name)}</strong></td>
                      <td style="color:#666;">${escapeHtml(s.note || '-')}</td>
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
              <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                ${listHtml}
              </div>
          `;
          window.openLeaderModal(html);
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.showStoreEditor = async function(id) {
      let store = { id: null, name: '', note: '' };
      if (id && window.leaderLogisticsState.stores) {
          const found = window.leaderLogisticsState.stores.find(s => s.id === id);
          if (found) store = found;
      }
      let html = `
          <h3 style="margin-top:0;">${id ? '✏️ Úprava prevádzky' : '➕ Vytvorenie prevádzky'}</h3>
          <div style="margin-bottom:15px;">
              <label style="font-weight:bold;">Názov prevádzky *</label>
              <input type="text" id="store-name" class="form-control" style="width:100%;" value="${escapeHtml(store.name)}">
          </div>
          <div style="margin-bottom:15px;">
              <label>Poznámka / Adresa</label>
              <input type="text" id="store-note" class="form-control" style="width:100%;" value="${escapeHtml(store.note)}">
          </div>
          <div style="text-align:right;">
              <button class="btn btn-secondary" onclick="window.manageStores()" style="margin-right:10px;">Späť</button>
              <button class="btn btn-success" onclick="window.saveStore(${id || 'null'})">💾 Uložiť</button>
          </div>
      `;
      window.openLeaderModal(html);
  };

  window.saveStore = async function(id) {
      const name = document.getElementById('store-name').value.trim();
      const note = document.getElementById('store-note').value.trim();
      if (!name) return showStatus("Názov prevádzky je povinný!", true);
      try {
          await apiRequest('/api/leader/b2b/saveStore', { method: 'POST', body: { id: id, name: name, note: note, b2b_customer_id: null } });
          window.manageStores(); 
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.deleteStore = async function(id, name) {
      if (!confirm(`Vymazať prevádzku "${name}"?`)) return;
      try {
          await apiRequest('/api/leader/b2b/deleteStore', { method: 'POST', body: { id: id } });
          window.manageStores();
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  // Pomocné funkcie pre Editor (Vyhľadávanie a pridávanie)
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

  window.renderStopRow = function(name, note, storeId) {
      const container = document.getElementById('tpl-stops-container');
      const row = document.createElement('div');
      row.className = 'tpl-stop-row';
      row.dataset.storeId = storeId || '';
      row.dataset.name = name || '';
      row.style.cssText = "display:flex; align-items:center; gap:10px; background:#fff; padding:10px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:5px;";

      row.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:2px;">
              <button type="button" class="btn btn-sm btn-light" style="padding: 2px 6px;" onclick="if(this.closest('.tpl-stop-row').previousElementSibling) this.closest('.tpl-stop-row').parentNode.insertBefore(this.closest('.tpl-stop-row'), this.closest('.tpl-stop-row').previousElementSibling)" title="Hore">⬆️</button>
              <button type="button" class="btn btn-sm btn-light" style="padding: 2px 6px;" onclick="if(this.closest('.tpl-stop-row').nextElementSibling) this.closest('.tpl-stop-row').parentNode.insertBefore(this.closest('.tpl-stop-row').nextElementSibling, this.closest('.tpl-stop-row'))" title="Dole">⬇️</button>
          </div>
          <div style="flex:1;">
              <div style="font-weight:bold; color:#1e293b; font-size:1.05rem;">${escapeHtml(name)}</div>
              <input type="text" class="form-control stop-note-input" value="${escapeHtml(note || '')}" placeholder="Poznámka alebo adresa pre šoféra" style="width:100%; border:1px solid #cbd5e1; border-radius:4px; padding:6px; font-size:0.85rem; margin-top:4px; background:#f8fafc;">
          </div>
          <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('.tpl-stop-row').remove()" title="Odstrániť zo šablóny">✖</button>
      `;
      container.appendChild(row);
      container.scrollTop = container.scrollHeight;
  };

  window.addStoreFromPanel = function(btn) {
      window.renderStopRow(btn.dataset.name, btn.dataset.note, btn.dataset.id);
      
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

  window.addCustomStorePanel = function() {
      const input = document.getElementById('tpl-custom-stop');
      const val = input.value.trim();
      if (!val) return;
      window.renderStopRow(val, '', '');
      input.value = '';
  };

  window.manageManualRoutes = async function() {
      window.openLeaderModal('<div style="padding:30px; text-align:center;">Načítavam šablóny...</div>');
      try {
          const data = await apiRequest('/api/leader/b2b/getRouteTemplates');
          window.leaderLogisticsState.routeTemplates = data.templates || [];

          let listHtml = `<table class="tbl" style="width:100%; border-collapse:collapse; text-align:left;"><thead><tr style="border-bottom:2px solid #ccc;"><th style="padding:10px;">Názov šablóny</th><th>Zastávky</th><th style="text-align:right;">Akcia</th></tr></thead><tbody>`;
          if (window.leaderLogisticsState.routeTemplates.length === 0) {
              listHtml += `<tr><td colspan="3" style="text-align:center; padding:20px;">Žiadne manuálne šablóny.</td></tr>`;
          } else {
              window.leaderLogisticsState.routeTemplates.forEach(t => {
                  const stopsCount = Array.isArray(t.stops) ? t.stops.length : 0;
                  listHtml += `<tr style="border-bottom:1px solid #eee;">
                      <td style="padding:10px;"><strong>${escapeHtml(t.name)}</strong></td>
                      <td><span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:12px; font-weight:bold; font-size:0.85rem;">${stopsCount} prevádzok</span></td>
                      <td style="text-align:right;">
                          <button class="btn btn-success btn-sm" onclick="window.showPrintManualRoute(${t.id})">🖨️ Tlačiť</button>
                          <button class="btn btn-primary btn-sm" onclick="window.showManualRouteEditor(${t.id})" style="margin-left:5px;">✏️ Upraviť</button>
                          <button class="btn btn-danger btn-sm" onclick="window.deleteManualRouteTemplate(${t.id}, '${escapeHtml(t.name)}')" style="margin-left:5px;">🗑️</button>
                      </td>
                  </tr>`;
              });
          }
          listHtml += `</tbody></table>`;

          let html = `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                  <h3 style="margin:0;">📝 Manuálne šablóny trás</h3>
                  <button class="btn btn-success" onclick="window.showManualRouteEditor(null)">+ Nová šablóna</button>
              </div>
              <div style="background:#f8fafc; padding:12px; border-radius:6px; margin-bottom:15px; font-size:0.9rem; color:#475569; border:1px solid #e2e8f0;">
                  ℹ️ Tu si môžete vytvoriť pevné rozvozové zoznamy pre zákazníkov. Pred tlačou jednoducho odkliknete tých, ktorí dnes tovar neberú.
              </div>
              <div style="max-height: 50vh; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                ${listHtml}
              </div>
          `;
          window.openLeaderModal(html);
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };


  window.saveManualRouteTemplate = async function(id) {
      const name = document.getElementById('tpl-name').value.trim();
      if (!name) return showStatus("Názov šablóny nesmie byť prázdny!", true);

      const stops = [];
      document.querySelectorAll('.tpl-stop-row').forEach(row => {
          const noteInput = row.querySelector('.stop-note-input');
          stops.push({ 
              store_id: row.dataset.storeId || '', 
              name: row.dataset.name || '', 
              note: noteInput ? noteInput.value.trim() : '' 
          });
      });

      if (stops.length === 0) return showStatus("Šablóna musí obsahovať aspoň jednu prevádzku.", true);

      try {
          await apiRequest('/api/leader/b2b/saveRouteTemplate', { method: 'POST', body: { id: id, name: name, stops: stops } });
          window.manageManualRoutes(); 
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.deleteManualRouteTemplate = async function(id, name) {
      if (!confirm(`Vymazať šablónu:\n"${name}"?`)) return;
      try {
          await apiRequest('/api/leader/b2b/deleteRouteTemplate', { method: 'POST', body: { id: id } });
          window.manageManualRoutes(); 
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

  window.showPrintManualRoute = async function(id) {
      const template = window.leaderLogisticsState.routeTemplates.find(t => t.id === id);
      if (!template) return;

      let vehicles = [];
      try {
          const vRes = await apiRequest('/api/fleet/active-vehicles');
          vehicles = vRes.vehicles || [];
      } catch(ve) {}

      let stopsHtml = '';
      template.stops.forEach((s, idx) => {
          stopsHtml += `
              <label style="display:flex; align-items:flex-start; padding:12px; border-bottom:1px solid #ccc; cursor:pointer; background:${idx % 2 === 0 ? '#fff' : '#f8fafc'};" class="print-row-label">
                  <div style="padding-top:3px;">
                      <input type="checkbox" class="print-stop-cb" value="${idx}" checked style="transform:scale(1.3); margin:0 15px 0 5px;">
                  </div>
                  <div style="width: 40px; font-weight:bold; color:#666;">${idx + 1}.</div>
                  <div style="flex:1;">
                      <div style="font-weight:bold; font-size:1.05rem;">${escapeHtml(s.name)}</div>
                      ${s.note ? `<div style="font-size:0.85rem; color:#666; margin-top:4px;">📝 ${escapeHtml(s.note)}</div>` : ''}
                  </div>
                  <div style="width: 80px; text-align:right; font-weight:bold; font-size:0.85rem; color:#10b981;" class="status-badge">Zahrnuté</div>
              </label>
          `;
      });

      const today = todayISO();

      let html = `
          <h3 style="margin-top:0;">🖨️ Príprava tlače: <span style="color:#0ea5e9;">${escapeHtml(template.name)}</span></h3>
          
          <div style="margin-bottom: 15px; padding: 15px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
              <h4 style="margin:0 0 10px 0;"><i class="fas fa-car"></i> Založiť knihu jázd (Fleet)</h4>
              <div style="display:flex; gap:10px; align-items:center;">
                  <input type="date" id="manual-route-date" class="form-control" value="${today}" style="width:auto;">
                  <select id="manual-veh-select" class="form-control" style="flex:1;">
                      <option value="">-- Vyberte auto z Fleet modulu --</option>
                      ${vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.name)} (${escapeHtml(v.license_plate)})</option>`).join('')}
                  </select>
                  <button class="btn btn-success btn-sm" onclick="window.assignManualVehicle('${escapeHtml(template.name)}')">Založiť jazdu</button>
              </div>
          </div>
          
          <div style="background:#eff6ff; padding:10px; margin-bottom:15px; font-size:0.95rem; border-left:4px solid #3b82f6;">
              Odškrtnite prevádzky, do ktorých sa dnes <b>nevezme tovar</b>.
          </div>
          
          <div style="border:1px solid #ccc; max-height:40vh; overflow-y:auto; margin-bottom:20px;">
              ${stopsHtml}
          </div>

          <div style="text-align:right;">
              <button class="btn btn-secondary" onclick="window.manageManualRoutes()" style="margin-right:10px;">← Späť na zoznam</button>
              <button class="btn btn-primary" onclick="window.executePrintManualRoute(${id})">🖨️ Vytlačiť</button>
          </div>
      `;
      
      window.openLeaderModal(html);

      setTimeout(() => {
          document.querySelectorAll('.print-stop-cb').forEach(cb => {
              cb.addEventListener('change', function() {
                  const label = this.closest('.print-row-label');
                  const badge = label.querySelector('.status-badge');
                  if (this.checked) {
                      badge.textContent = 'Zahrnuté'; badge.style.color = '#10b981'; label.style.opacity = '1';
                  } else {
                      badge.textContent = 'Vynechané'; badge.style.color = '#ef4444'; label.style.opacity = '0.5';
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
          const res = await apiRequest('/api/leader/logistics/assign-vehicle', { method: 'POST', body: { date: dateVal, route_name: routeName, vehicle_id: vehicleId } });
          showStatus(res.message, false);
      } catch(e) { showStatus("Chyba: " + e.message, true); }
  };

 window.executePrintManualRoute = async function(id) {
    const template = window.leaderLogisticsState.routeTemplates.find(t => t.id === id);
    if (!template) return;

    const activeStops = [];
    document.querySelectorAll('.print-stop-cb:checked').forEach(cb => {
        const idx = parseInt(cb.value);
        if (template.stops[idx]) activeStops.push(template.stops[idx]);
    });

    if (activeStops.length === 0) return showStatus("Musíte nechať zaškrtnutú aspoň jednu prevádzku na tlač.", true);

    // Vytvoríme HTML priamo tu vo frontende, aby sme nemuseli ťahať starý vzhľad zo servera
    const dateInput = document.getElementById('manual-route-date');
    const dateFormatted = dateInput && dateInput.value ? dateInput.value.split('-').reverse().join('.') : new Date().toLocaleDateString('sk-SK');
    
    let htmlStr = `<html><head><title>Nakládkový list - ${escapeHtml(template.name)}</title><style>
        body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; } 
        h1, h3 { text-align: center; margin-bottom: 5px; margin-top: 0; } 
        .info-box { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 15px; margin-bottom: 15px; font-size: 13px; border-radius: 4px; line-height: 1.4; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; } 
        th, td { border: 1px solid #000; padding: 8px; text-align: left; vertical-align: top; } 
        th { background-color: #f1f5f9; } 
        .box { display: inline-block; width: 20px; height: 20px; border: 2px solid #000; } 
        .center { text-align: center; }
        @media print { body { margin: 0; padding: 10mm; } .info-box { background: #fff !important; border: 1px dashed #000; } }
        </style></head><body>
        <h1>Nakládkový list / Itinerár (Manuálna trasa)</h1>
        <h3>TRASA: ${escapeHtml(template.name)} | DÁTUM: ${dateFormatted} | ŠOFÉR: __________________</h3>
        
        <div class="info-box">
            <strong>💡 UPOZORNENIE PRE EXPEDÍCIU A ROZVOZ:</strong><br>
            • Do stĺpca <b>"Počet E2"</b> dôsledne zaznačte množstvo dodaných prepraviek pre každého odberateľa.<br>
            • Ak v objednávke niečo chýba, do stĺpca <b>"Poznámky"</b> presne špecifikujte <b>čo chýba a v akom množstve</b> (napr.: <i>"Chýba 2kg Hovädzie zadné"</i> alebo <i>"Nedodané 3ks klobásy"</i>).
        </div>

        <table>
            <thead>
                <tr>
                    <th class="center" style="width: 40px;">Por.</th>
                    <th style="width: 25%;">Odberateľ a Adresa</th>
                    <th class="center" style="width: 80px;">Počet E2</th>
                    <th class="center" style="width: 70px;">Pripravil</th>
                    <th class="center" style="width: 70px;">Naložil</th>
                    <th style="width: 40%;">Poznámky (Chýbajúci tovar a iné)</th>
                </tr>
            </thead>
            <tbody>`;
            
    activeStops.forEach((z, idx) => {
        htmlStr += `<tr>
            <td class="center" style="font-size:16px;"><strong>${idx + 1}.</strong></td>
            <td><strong>${escapeHtml(z.name)}</strong><br><span style="font-size:12px; color: #555;">${escapeHtml(z.note || '')}</span></td>
            <td class="center" style="color: #999;">____ ks</td>
            <td class="center"><div class="box"></div></td>
            <td class="center"><div class="box"></div></td>
            <td></td>
        </tr>`;
    });
    
    htmlStr += `</tbody></table>
    <div style="margin-top: 30px; display: flex; justify-content: space-between; font-weight: bold;">
        <div>Podpis pripravil: _______________________</div>
        <div>Podpis šoféra: _______________________</div>
    </div>
    <script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;

    const printWindow = window.open('', '_blank', 'width=900,height=800');
    printWindow.document.write(htmlStr);
    printWindow.document.close();
    window.closeLeaderModal();
};
 window.printChecklist = function(routeObj, dateStr) {
      const dateFormatted = dateStr.split('-').reverse().join('.');
      let html = `<html><head><title>Nakládkový list - ${routeObj.nazov}</title><style>
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; } 
          h1, h3 { text-align: center; margin-bottom: 5px; margin-top: 0; } 
          .info-box { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 15px; margin-bottom: 15px; font-size: 13px; border-radius: 4px; line-height: 1.4; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; } 
          th, td { border: 1px solid #000; padding: 8px; text-align: left; vertical-align: top; } 
          th { background-color: #f1f5f9; } 
          .box { display: inline-block; width: 20px; height: 20px; border: 2px solid #000; } 
          .center { text-align: center; }
          @media print { body { margin: 0; padding: 10mm; } .info-box { background: #fff !important; border: 1px dashed #000; } }
          </style></head><body>
          <h1>Nakládkový list / Itinerár</h1>
          <h3>TRASA: ${escapeHtml(routeObj.nazov)} | DÁTUM: ${dateFormatted} | ŠOFÉR: __________________</h3>
          
          <div class="info-box">
              <strong>💡 UPOZORNENIE PRE EXPEDÍCIU A ROZVOZ:</strong><br>
              • Do stĺpca <b>"Počet E2"</b> dôsledne zaznačte množstvo dodaných prepraviek pre každého odberateľa.<br>
              • Ak v objednávke niečo chýba, do stĺpca <b>"Poznámky"</b> presne špecifikujte <b>čo chýba a v akom množstve</b> (napr.: <i>"Chýba 2kg Hovädzie zadné"</i> alebo <i>"Nedodané 3ks klobásy"</i>).
          </div>

          <table>
              <thead>
                  <tr>
                      <th class="center" style="width: 40px;">Por.</th>
                      <th style="width: 25%;">Odberateľ a Adresa</th>
                      <th style="width: 15%;">Objednávky</th>
                      <th class="center" style="width: 80px;">Počet E2</th>
                      <th class="center" style="width: 70px;">Pripravil</th>
                      <th class="center" style="width: 70px;">Naložil</th>
                      <th style="width: 30%;">Poznámky (Chýbajúci tovar a iné)</th>
                  </tr>
              </thead>
              <tbody>`;
              
      routeObj.zastavky.forEach((z, idx) => {
          html += `<tr>
              <td class="center" style="font-size:16px;"><strong>${idx + 1}.</strong></td>
              <td><strong>${escapeHtml(z.odberatel)}</strong><br><span style="font-size:12px; color: #555;">${escapeHtml(z.adresa)}</span></td>
              <td style="font-size:12px;"><strong>${z.pocet_objednavok} obj.</strong><br>${z.cisla_objednavok.join('<br>')}</td>
              <td class="center" style="color: #999;">____ ks</td>
              <td class="center"><div class="box"></div></td>
              <td class="center"><div class="box"></div></td>
              <td></td>
          </tr>`;
      });
      
      html += `</tbody></table>
      <div style="margin-top: 30px; display: flex; justify-content: space-between; font-weight: bold;">
          <div>Podpis pripravil: _______________________</div>
          <div>Podpis šoféra: _______________________</div>
      </div>
      <script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;
      
      const win = window.open('', '_blank'); 
      win.document.write(html); 
      win.document.close();
  };

  window.printSummary = function(routeObj, dateStr) {
      const dateFormatted = dateStr.split('-').reverse().join('.');
      let html = `<html><head><title>Súhrn - ${routeObj.nazov}</title><style>body { font-family: Arial; padding: 20px; font-size: 14px; } h1, h3 { text-align: center; } .cat { background: #e2e8f0; padding: 8px; margin-top: 20px; font-weight: bold; border: 1px solid #000; border-bottom: none; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #000; padding: 8px; } .num { text-align: right; font-weight: bold; } @media print { body { margin: 0; } }</style></head><body><h1>Slepý list (Súhrn na naloženie)</h1><h3>TRASA: ${escapeHtml(routeObj.nazov)} | DÁTUM: ${dateFormatted}</h3>`;
      routeObj.sumar.forEach(s => {
          html += `<div class="cat">${escapeHtml(s.kategoria)}</div><table><tbody>`;
          s.polozky.forEach(p => {
              const val = parseFloat(p.mnozstvo);
              const displayVal = Number.isInteger(val) ? val : val.toFixed(2);
              html += `<tr><td>${escapeHtml(p.produkt)}</td><td class="num" style="width:120px;">${displayVal} ${p.mj}</td></tr>`;
          });
          html += `</tbody></table>`;
      });
      html += `<script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;
      const win = window.open('', '_blank'); win.document.write(html); win.document.close();
  };
// Globálne funkcie pre označovanie a hromadný presun v Logistike
  window.toggleAllLogistics = function(source, trasaId) {
      const cbs = document.querySelectorAll('.route-cb-' + trasaId);
      cbs.forEach(cb => cb.checked = source.checked);
  };

  window.bulkAssignRoute = async function(trasaId) {
      const cbs = document.querySelectorAll('.route-cb-' + trasaId + ':checked');
      if(cbs.length === 0) return showStatus('Zaškrtnite aspoň jedného zákazníka na presun.', true);
      
      const targetRoute = document.getElementById('bulk-route-sel-' + trasaId).value;
      if(!targetRoute) return showStatus('Zvoľte cieľovú trasu z rolovacieho menu.', true);
      
      const customerIds = Array.from(cbs).map(cb => cb.value);
      
      const btn = event.currentTarget;
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pracujem...';
      btn.disabled = true;
      
      try {
          const res = await apiRequest('/api/leader/logistics/bulk-assign-route', {
              method: 'POST',
              body: { customer_ids: customerIds, trasa_id: targetRoute }
          });
          showStatus(res.message || 'Zákazníci boli presunutí.', false);
          
          // Ihneď aktualizuje stránku a ukáže zmeny!
          document.getElementById('logistics-load-btn').click(); 
      } catch(e) {
          showStatus('Chyba pri presune: ' + e.message, true);
          btn.innerHTML = originalText;
          btn.disabled = false;
      }
  };
// ================= MANUÁLNE OBJEDNÁVKY (NEREGISTROVANÍ AJ REGISTROVANÍ) =================
  function initManualOrdersUI() {
      const custSearch = $('#manual-customer-search');
      const custResults = $('#manual-customer-results');
      const prodSearch = $('#man-product-search');
      const prodResults = $('#man-product-results');
      const submitBtn = $('#man-order-submit');
      const saveCustBtn = $('#man-cust-save');
      const plContainer = $('#manual-pricelist-container');
      const plSelect = $('#manual-pricelist-select');
      const plTbody = $('#manual-pricelist-tbody');
      
      if(!custSearch || !prodSearch) return;

      $('#man-order-date').value = todayISO();
      
      loadManualOrderHistory(); // Hneď načítame históriu

      const loadFullPricelist = async (plId) => {
          plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Načítavam položky cenníka...</td></tr>';
          try {
              const items = await apiRequest(`/api/leader/manual_order/pricelist_items?pricelist_id=${plId}`);
              if(!items.length) {
                  plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Tento cenník je prázdny.</td></tr>';
                  return;
              }
              
              plTbody.innerHTML = items.map(p => `
                  <tr>
                      <td>
                          <strong>${escapeHtml(p.name)}</strong><br>
                          <small class="muted">${escapeHtml(p.ean)}</small>
                      </td>
                      <td style="font-weight:bold; color:#16a34a;">${Number(p.price).toFixed(2)} €</td>
                      <td>
                          <div style="display:flex; align-items:center; gap:5px;">
                              <input type="number" class="form-control pl-qty-input" step="0.01" min="0" placeholder="Množstvo" id="pl-qty-${p.ean}" style="padding:4px; width:80px;">
                              <span class="muted">${escapeHtml(p.mj)}</span>
                          </div>
                      </td>
                      <td style="text-align:right;">
                          <button class="btn btn-sm btn-primary" onclick='addFromPricelistGrid(${JSON.stringify(p).replace(/'/g, "&apos;")})'>Pridať</button>
                      </td>
                  </tr>
              `).join('');
              
              // Enter spúšťa tlačidlo Pridať
              $$('.pl-qty-input').forEach(inp => {
                  inp.addEventListener('keypress', function(e) {
                      if (e.key === 'Enter') {
                          e.preventDefault();
                          this.closest('tr').querySelector('button').click();
                          
                          // Skočenie na ďalší input v poradí
                          const nextRow = this.closest('tr').nextElementSibling;
                          if (nextRow) {
                              const nextInp = nextRow.querySelector('.pl-qty-input');
                              if(nextInp) nextInp.focus();
                          }
                      }
                  });
              });
              
          } catch(e) {
              plTbody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:red;">Chyba pri načítaní cenníka.</td></tr>';
          }
      };

      let custTimer;
      custSearch.addEventListener('input', () => {
          clearTimeout(custTimer);
          const q = custSearch.value.trim();
          if(q.length < 2) { custResults.style.display = 'none'; return; }
          
          custTimer = setTimeout(async () => {
              custResults.style.display = 'block';
              custResults.innerHTML = '<div style="padding:10px;color:#666;">Hľadám...</div>';
              try {
                  const data = await apiRequest(`/api/leader/manual_customers/search_all?q=${encodeURIComponent(q)}`);
                  if(!data.length) { custResults.innerHTML = '<div style="padding:10px;color:#999;">Zákazník nenájdený.</div>'; return; }
                  
                  custResults.innerHTML = data.map(c => {
                      const isReg = c.is_registered === '1';
                      const badge = isReg ? '<span style="background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:5px;">E-SHOP</span>' : '<span style="background:#f1f5f9; color:#475569; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:5px;">MANUÁLNY</span>';
                      
                      return `
                      <div class="product-search-item" data-json='${escapeHtml(JSON.stringify(c))}'>
                          <div>
                              <strong>${escapeHtml(c.nazov_firmy)}</strong><br>
                              <small style="color:#64748b;">${escapeHtml(c.adresa || '')}</small>
                          </div>
                          <div style="text-align:right;">
                              ${badge}<br>
                              <span style="font-weight:bold; color:#0369a1;">${escapeHtml(c.interne_cislo)}</span>
                          </div>
                      </div>
                      `;
                  }).join('');
                  
                  custResults.querySelectorAll('.product-search-item').forEach(el => {
                      el.onclick = async () => {
                          const c = JSON.parse(el.getAttribute('data-json'));
                          $('#man-cust-id').value = c.interne_cislo;
                          $('#man-cust-name').value = c.nazov_firmy;
                          $('#man-cust-addr').value = c.adresa || '';
                          $('#man-cust-contact').value = c.kontakt || '';
                          $('#man-cust-is-registered').value = c.is_registered;
                          custSearch.value = '';
                          custResults.style.display = 'none';
                          
                          saveCustBtn.style.display = (c.is_registered === '1') ? 'none' : 'inline-block';
                          
                          if(c.is_registered === '1') {
                              plContainer.style.display = 'block';
                              plSelect.innerHTML = '<option>Načítavam cenníky...</option>';
                              try {
                                  const pls = await apiRequest(`/api/leader/b2b/get_pricelists?customer_id=${encodeURIComponent(c.interne_cislo)}`);
                                  if(pls && pls.length > 0) {
                                      plSelect.innerHTML = pls.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
                                      await loadFullPricelist(pls[0].id);
                                      plSelect.onchange = (e) => loadFullPricelist(e.target.value);
                                  } else {
                                      plSelect.innerHTML = '<option>Zákazník nemá priradený cenník</option>';
                                      plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Žiadne položky na zobrazenie.</td></tr>';
                                  }
                              } catch(e) {
                                  plSelect.innerHTML = '<option>Chyba pri načítaní cenníkov</option>';
                              }
                          } else {
                              plContainer.style.display = 'none';
                              plTbody.innerHTML = '';
                          }
                      };
                  });
              } catch(e) { custResults.innerHTML = '<div style="padding:10px;color:red;">Chyba API.</div>'; }
          }, 300);
      });

      saveCustBtn.onclick = async () => {
          if($('#man-cust-is-registered').value === '1') return;
          const payload = {
              interne_cislo: $('#man-cust-id').value.trim(),
              nazov_firmy: $('#man-cust-name').value.trim(),
              adresa: $('#man-cust-addr').value.trim(),
              kontakt: $('#man-cust-contact').value.trim()
          };
          if(!payload.interne_cislo || !payload.nazov_firmy) return showStatus("Interné číslo a názov sú povinné.", true);
          try {
              await apiRequest('/api/leader/manual_customers/save', {method: 'POST', body: payload});
              showStatus("Neregistrovaný zákazník uložený do adresára.", false);
          } catch(e) { showStatus("Chyba uloženia: " + e.message, true); }
      };

      let prodTimer;
      prodSearch.addEventListener('input', () => {
          clearTimeout(prodTimer);
          const q = prodSearch.value.trim();
          if(q.length < 2) { prodResults.style.display = 'none'; return; }
          
          prodTimer = setTimeout(async () => {
              prodResults.style.display = 'block';
              prodResults.innerHTML = '<div style="padding:10px;color:#666;">Hľadám produkt...</div>';
              try {
                  const data = await apiRequest(`/api/leader/products_standard/search?q=${encodeURIComponent(q)}`);
                  if(!data.length) { prodResults.innerHTML = '<div style="padding:10px;color:#999;">Produkt nenájdený.</div>'; return; }
                  
                  prodResults.innerHTML = data.map(p => `
                      <div class="product-search-item" data-json='${escapeHtml(JSON.stringify(p))}'>
                          <div>
                              <strong>${escapeHtml(p.name)}</strong><br>
                              <span class="meta">EAN: ${escapeHtml(p.ean)} | DPH: ${p.dph}%</span>
                          </div>
                          <div style="text-align:right;">
                              <span style="color:#2563eb; font-weight:bold;">${escapeHtml(p.mj)}</span>
                          </div>
                      </div>
                  `).join('');
                  
                  prodResults.querySelectorAll('.product-search-item').forEach(el => {
                      el.onclick = () => {
                          const p = JSON.parse(el.getAttribute('data-json'));
                          addManualOrderRow(p, 0); // Vloží s množstvom 0
                          prodSearch.value = '';
                          prodResults.style.display = 'none';
                      };
                  });
              } catch(e) { prodResults.innerHTML = '<div style="padding:10px;color:red;">Chyba API.</div>'; }
          }, 300);
      });

      document.addEventListener('click', (e) => {
          if (!custSearch.contains(e.target) && !custResults.contains(e.target)) custResults.style.display = 'none';
          if (!prodSearch.contains(e.target) && !prodResults.contains(e.target)) prodResults.style.display = 'none';
      });

      submitBtn.onclick = async () => {
          const payload = {
              customer: {
                  interne_cislo: $('#man-cust-id').value.trim(),
                  nazov_firmy: $('#man-cust-name').value.trim(),
                  adresa: $('#man-cust-addr').value.trim(),
                  kontakt: $('#man-cust-contact').value.trim(),
                  is_registered: $('#man-cust-is-registered').value
              },
              delivery_date: $('#man-order-date').value,
              note: $('#man-order-note').value.trim(),
              items: []
          };

          if(!payload.customer.interne_cislo || !payload.customer.nazov_firmy) {
              return showStatus("Vyplňte údaje zákazníka (Číslo a Názov).", true);
          }

          const trs = $$('#man-order-items tbody tr:not(#man-empty-row)');
          trs.forEach(tr => {
              const qty = toNum(tr.querySelector('.mo-qty').value);
              const price = toNum(tr.querySelector('.mo-price').value);
              if(qty > 0) {
                  payload.items.push({
                      ean: tr.dataset.ean,
                      name: tr.dataset.name,
                      unit: tr.querySelector('.mo-unit').value,
                      dph: tr.dataset.dph,
                      quantity: qty,
                      price: price
                  });
              }
          });

          if(!payload.items.length) return showStatus("Objednávka musí obsahovať položky s množstvom > 0.", true);

          submitBtn.disabled = true;
          submitBtn.textContent = "Spracúvam...";

          try {
              const res = await apiRequest('/api/leader/manual_order/submit', {method: 'POST', body: payload});
              showStatus(res.message, false);
              
              const pdfUrl = `/api/kancelaria/b2b/print_order_pdf/${res.order_id}`;
              window.open(pdfUrl, '_blank');
              
              $('#man-order-items tbody').innerHTML = '<tr id="man-empty-row"><td colspan="6" style="text-align:center;" class="muted">Zatiaľ neboli pridané žiadne položky.</td></tr>';
              $('#man-cust-id').value = '';
              $('#man-cust-name').value = '';
              $('#man-cust-addr').value = '';
              $('#man-cust-contact').value = '';
              $('#man-cust-is-registered').value = '0';
              $('#man-order-note').value = '';
              plContainer.style.display = 'none';
              
              loadManualOrderHistory(); // Refresh history
              if(typeof loadB2B === 'function') loadB2B();

          } catch(e) {
              showStatus("Chyba odoslania: " + e.message, true);
          } finally {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> Vytvoriť a odoslať objednávku';
          }
      };
  }

  // Globálna funkcia volaná priamo z tlačidla v rozbalenom cenníku
  window.addFromPricelistGrid = function(p) {
      const input = document.getElementById(`pl-qty-${p.ean}`);
      const qty = toNum(input.value);
      if (qty <= 0) {
          showStatus("Zadajte množstvo väčšie ako 0.", true);
          input.focus();
          return;
      }
      
      const tbody = $('#man-order-items tbody');
      const existingRow = tbody.querySelector(`tr[data-ean="${p.ean}"]`);
      
      if (existingRow) {
          // Ak už položka v košíku je, spočítame množstvo
          const qtyInput = existingRow.querySelector('.mo-qty');
          qtyInput.value = (toNum(qtyInput.value) + qty).toFixed(2);
          
          existingRow.style.backgroundColor = '#dcfce7';
          setTimeout(() => existingRow.style.backgroundColor = '', 600);
      } else {
          // Vytvorí nový riadok s predvyplneným množstvom
          addManualOrderRow(p, qty);
      }
      
      input.value = ''; // Vyčistiť input pre ďalšie zadávanie
      showStatus(`Pridané: ${p.name} (${qty} ${p.mj})`, false);
  };

  // Upravené prijímanie argumentu initialQty
  function addManualOrderRow(p, initialQty = 0) {
      const tbody = $('#man-order-items tbody');
      const empty = $('#man-empty-row');
      if(empty) empty.remove();

      const tr = doc.createElement('tr');
      tr.dataset.ean = p.ean;
      tr.dataset.name = p.name;
      tr.dataset.dph = p.dph;
      
      const qtyStr = initialQty > 0 ? initialQty.toFixed(2) : "0.00";
      const priceStr = p.price !== undefined ? p.price.toFixed(2) : "0.00";

      tr.innerHTML = `
          <td>${escapeHtml(p.ean)}</td>
          <td><strong>${escapeHtml(p.name)}</strong><br><small style="color:#666">DPH: ${p.dph}%</small></td>
          <td><input type="number" class="form-control mo-qty" step="0.01" value="${qtyStr}" style="padding:6px;width:100%"></td>
          <td>
            <select class="form-control mo-unit" style="padding:6px;width:100%">
                <option value="kg" ${p.mj==='kg'?'selected':''}>kg</option>
                <option value="ks" ${p.mj==='ks'?'selected':''}>ks</option>
            </select>
          </td>
          <td><input type="number" class="form-control mo-price" step="0.01" value="${priceStr}" style="padding:6px;width:100%"></td>
          <td style="text-align:right;"><button class="btn btn-sm btn-danger mo-del">✖</button></td>
      `;

      tbody.insertBefore(tr, tbody.firstChild);
      tr.querySelector('.mo-del').onclick = () => {
          tr.remove();
          if(!tbody.children.length) tbody.innerHTML = '<tr id="man-empty-row"><td colspan="6" style="text-align:center;" class="muted">Zatiaľ neboli pridané žiadne položky.</td></tr>';
      };
      
      if(initialQty === 0) tr.querySelector('.mo-qty').select();
  }

  // Funkcia na načítanie histórie manuálnych objednávok
  window.loadManualOrderHistory = async function() {
      const tbody = $('#man-history-tbody');
      const q = $('#man-history-search')?.value || '';
      if(!tbody) return;
      
      tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Načítavam...</td></tr>';
      try {
          const rows = await apiRequest(`/api/leader/manual_order/history?q=${encodeURIComponent(q)}&limit=30`);
          if(!rows.length) {
              tbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Žiadne manuálne objednávky.</td></tr>';
              return;
          }
          
          const skDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('sk-SK') : '';
          
          tbody.innerHTML = rows.map(r => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                  <td>${skDate(r.pozadovany_datum_dodania)}</td>
                  <td>
                      <strong style="color:#0f172a;">${escapeHtml(r.nazov_firmy)}</strong><br>
                      <small style="color:#64748b;">${escapeHtml(r.cislo_objednavky)}</small>
                  </td>
                  <td style="font-weight:bold; color:#16a34a;">${fmt2(r.celkova_suma_s_dph)} €</td>
                  <td style="text-align:right;">
                      <button class="btn btn-sm btn-light" style="border:1px solid #cbd5e1;" onclick="window.open('/api/kancelaria/b2b/print_order_pdf/${r.id}', '_blank')"><i class="fas fa-print"></i> PDF</button>
                  </td>
              </tr>
          `).join('');
      } catch (e) {
          tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:red;">Chyba: ${e.message}</td></tr>`;
      }
  };

  
  function boot(){
    $$('.sidebar-link').forEach(a=>{
      a.onclick = ()=>{
        if (a.getAttribute('onclick')) return; 
        
        $$('.sidebar-link').forEach(x=> x.classList.remove('active')); a.classList.add('active');
        const secId = a.getAttribute('data-section'); $$('.content-section').forEach(s=> s.classList.remove('active'));
        const target = secId ? $('#'+secId) : null; if (target) target.classList.add('active');
        
        if (secId === 'leader-dashboard')  loadDashboard();
        if (secId === 'leader-b2c')        loadB2C();
        if (secId === 'leader-b2b')        loadB2B();
        if (secId === 'leader-b2b-comm') {
            if (typeof window.loadCommView === 'function') window.loadCommView();
        }
        if (secId === 'leader-meat-origin-labels') { initMeatOriginLabels(); mol_preview(); }
        if (secId === 'leader-cut')        loadCutJobs();
        if (secId === 'leader-lowstock')   loadLeaderLowStockDetail();
        if (secId === 'leader-plan')       loadLeaderProductionCalendar();
        if (secId === 'leader-logistics')  root.loadLogistics();
      };
    });

    $('#ldr-date') && ($('#ldr-date').value = todayISO());
    $('#b2c-date') && ($('#b2c-date').value = todayISO());
    $('#b2b-date') && ($('#b2b-date').value = todayISO());
    $('#cut-date') && ($('#cut-date').value = todayISO());
    $('#nb2b-date') && ($('#nb2b-date').value = todayISO());

    $('#ldr-refresh') && ($('#ldr-refresh').onclick = loadDashboard);
    $('#plan-commit') && ($('#plan-commit').onclick = commitPlan);
    $('#b2c-refresh') && ($('#b2c-refresh').onclick = loadB2C);
    $('#b2b-refresh') && ($('#b2b-refresh').onclick = loadB2B);
    $('#leader-lowstock-refresh') && ($('#leader-lowstock-refresh').onclick = loadLeaderLowStockDetail);
    
    attachProductSearch();
    attachSupplierAutocomplete();
    $('#nb2b-add')  && ($('#nb2b-add').onclick  = ()=> addManualRow($('#nb2b-items tbody')));
    $('#nb2b-save') && ($('#nb2b-save').onclick = saveManualB2B);
    
    $('#cut-refresh') && ($('#cut-refresh').onclick = loadCutJobs);
    $('#cut-new')     && ($('#cut-new').onclick     = openNewCutModal);

    initManualOrdersUI(); // <--- PRIDANÉ INICIALIZOVANIE TU

    loadDashboard();
  }

  boot();
})(window, document);

// =========================================================
// INICIALIZÁCIA A OPRAVA NAVIGÁCIE
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Nastavenie aktuálneho dátumu
    const breakdownDateInput = document.getElementById('breakdown-date');
    if (breakdownDateInput) {
        breakdownDateInput.value = new Date().toISOString().split('T')[0];
    }

    // 2. Tvrdá oprava navigácie - prepisuje zlyhané eventy
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('data-section');
            if (!targetId) return;

            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            document.querySelectorAll('.content-section').forEach(s => {
                s.classList.remove('active');
                s.style.setProperty('display', 'none', 'important');
            });

            this.classList.add('active');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
                targetSection.style.setProperty('display', 'block', 'important');
            }
        });
    });
});

// 3. Globálny listener pre rozbaľovanie odberateľov (Accordion)
document.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('accordion-button')) {
        const targetId = e.target.getAttribute('data-bs-target');
        if (targetId) {
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
                targetEl.classList.toggle('show');
                e.target.classList.toggle('collapsed');
            }
        }
    }
});


// =========================================================
// FUNKCIE PRE EXPEDIČNÝ ROZPIS PODĽA KATEGÓRIE
// =========================================================
var currentBreakdownData = {}; 

async function loadExpeditionBreakdown() {
    const dateInput = document.getElementById('breakdown-date');
    const categorySelect = document.getElementById('breakdown-category');
    
    const selectedDate = dateInput ? dateInput.value : '';
    const selectedCategory = categorySelect ? categorySelect.value : 'all';
    const categoryName = categorySelect.options[categorySelect.selectedIndex].text;

    if (!selectedDate) {
        alert("Chyba: Prosím, zvoľte dátum dodania.");
        return;
    }

    const container = document.getElementById('breakdown-container');
    const printBtn = document.getElementById('btn-print-breakdown');
    
    container.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-info" role="status"></div><p class="mt-2">Načítavam dáta z objednávok...</p></div>';
    printBtn.style.display = 'none';

    try {
        const response = await fetch(`/api/leader/plan/rozpis?date=${selectedDate}&category=${encodeURIComponent(selectedCategory)}`);
        const data = await response.json();

        if (data.error) {
            container.innerHTML = `<div class="alert alert-danger mb-0">${data.error}</div>`;
            return;
        }

        const items = data.items || [];
        if (items.length === 0) {
            container.innerHTML = `<div class="alert alert-secondary mb-0">Na tento deň (${selectedDate}) pre kategóriu "${categoryName}" nie je nič objednané.</div>`;
            currentBreakdownData = {};
            return;
        }

        const grouped = items.reduce((acc, curr) => {
            if (!acc[curr.odberatel]) {
                acc[curr.odberatel] = [];
            }
            acc[curr.odberatel].push(curr);
            return acc;
        }, {});

        currentBreakdownData = { date: selectedDate, categoryName: categoryName, grouped: grouped };

        let html = '<div class="accordion" id="breakdownAccordion">';
        let i = 0;
        for (const [odberatel, produkty] of Object.entries(grouped)) {
            html += `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="headingBreakdown${i}">
                        <button class="accordion-button ${i === 0 ? '' : 'collapsed'} fw-bold" type="button" data-bs-toggle="collapse" data-bs-target="#collapseBreakdown${i}">
                            ${odberatel}
                        </button>
                    </h2>
                    <div id="collapseBreakdown${i}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}" data-bs-parent="#breakdownAccordion">
                        <div class="accordion-body p-0">
                            <ul class="list-group list-group-flush">
                                ${produkty.map(p => `
                                    <li class="list-group-item d-flex justify-content-between align-items-center" style="padding: 8px 15px;">
                                        <span>${p.produkt}</span>
                                        <span class="badge bg-primary rounded-pill px-3 text-dark border border-primary">${parseFloat(p.mnozstvo).toFixed(2)} ${p.mj}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
            i++;
        }
        html += '</div>';
        
        container.innerHTML = html;
        printBtn.style.display = 'inline-block';

    } catch (err) {
        console.error("Chyba API fetch:", err);
        container.innerHTML = `<div class="alert alert-danger mb-0">Kritická chyba pripojenia na server pri sťahovaní rozpisu.</div>`;
    }
}


function printExpeditionBreakdown() {
    if (!currentBreakdownData.grouped || Object.keys(currentBreakdownData.grouped).length === 0) return;

    const dateParts = currentBreakdownData.date.split('-');
    const dateStr = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;
    const catName = currentBreakdownData.categoryName;
    
    let printContent = `
        <!DOCTYPE html>
        <html lang="sk">
        <head>
            <meta charset="UTF-8">
            <title>Expedičný rozpis - ${dateStr}</title>
            <style>
                body { font-family: 'Arial', sans-serif; font-size: 14px; margin: 25px; color: #000; }
                h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 25px; text-transform: uppercase; font-size: 18px; }
                .date-info { font-size: 14px; font-weight: normal; display: block; margin-top: 5px; text-transform: none; }
                .customer-block { margin-bottom: 15px; page-break-inside: avoid; border: 1px solid #000; padding: 0; }
                .customer-name { font-size: 14px; font-weight: bold; background-color: #e9ecef; padding: 6px 10px; border-bottom: 1px solid #000; }
                table { width: 100%; border-collapse: collapse; }
                td { padding: 6px 10px; border-bottom: 1px solid #ccc; }
                tr:last-child td { border-bottom: none; }
                .qty { text-align: right; font-weight: bold; white-space: nowrap; width: 120px; }
                @media print {
                    body { margin: 0; }
                }
            </style>
        </head>
        <body>
            <h2>Expedičný rozpis <span class="date-info">Dátum dodania: <b>${dateStr}</b> | Kategória: <b>${catName}</b></span></h2>
    `;

    for (const [odberatel, produkty] of Object.entries(currentBreakdownData.grouped)) {
        printContent += `<div class="customer-block">`;
        printContent += `<div class="customer-name">${odberatel}</div>`;
        printContent += `<table>`;
        produkty.forEach(p => {
            const val = parseFloat(p.mnozstvo);
            const displayVal = Number.isInteger(val) ? val : val.toFixed(2);
            printContent += `<tr>
                <td>${p.produkt}</td>
                <td class="qty">${displayVal} ${p.mj}</td>
            </tr>`;
        });
        printContent += `</table></div>`;
    }

    printContent += `
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    printWindow.document.open();
    printWindow.document.write(printContent);
    printWindow.document.close();
}