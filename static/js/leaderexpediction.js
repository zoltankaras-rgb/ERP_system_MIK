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
      if($id('kpi-zostava')) $id('kpi-zostava').textContent = (r.kpi && r.kpi.zostava_chystat != null) ? r.kpi.zostava_chystat + ' obj.' : '0 obj.';
      if($id('kpi-tempo')) $id('kpi-tempo').textContent = (r.kpi && r.kpi.tempo_minuty > 0) ? r.kpi.tempo_minuty + ' min/obj' : '—';
      if($id('kpi-odhad')) $id('kpi-odhad').textContent = (r.kpi && r.kpi.odhad_konca) ? r.kpi.odhad_konca : '—';
     

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
    
    // ZMENA: Pridáme hlavičku s tlačidlom pre mínusové stavy
    host.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
          <h3 style="margin:0; color:#1e293b;">Chýbajúci tovar (Návrh nákupu)</h3>
          <button class="btn btn-danger btn-sm" onclick="window.printNegativeStockLeader()">
              <i class="fa-solid fa-print"></i> Tlačiť mínusové stavy
          </button>
      </div>
      <div id="leader-lowstock-content"><div class="muted" style="padding:1rem;">Načítavam návrh nákupu...</div></div>
    `;
    
    const contentHost = document.getElementById('leader-lowstock-content');

    try {
      const suggestions = await apiRequest('/api/kancelaria/get_goods_purchase_suggestion');
      if (!suggestions || !suggestions.length) { 
          contentHost.innerHTML = '<div class="card" style="margin-top:12px"><div class="card-body"><div class="muted">Aktuálne nie je potrebné doobjednať žiadny tovar.</div></div></div>'; 
          return; 
      }
      
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
      contentHost.innerHTML = html;
    } catch (e) { 
        contentHost.innerHTML = `<div class="error" style="padding:1rem;">Chyba: ${escapeHtml(e.message || '')}</div>`; 
    }
  }

  // ZMENA: Samotná funkcia na stiahnutie a vytlačenie mínusových stavov
  window.printNegativeStockLeader = async function() {
      try {
          showStatus("Sťahujem mínusové stavy...", false);
          const res = await apiRequest('/api/leader/stock/negatives');
          if (res.error) throw new Error(res.error);
          
          const groupedData = res.negatives || {};
          let negatives = [];
          
          Object.keys(groupedData).forEach(cat => {
              (groupedData[cat] || []).forEach(p => {
                  negatives.push({
                      cat: cat,
                      name: p.name,
                      ean: p.ean,
                      qty: p.qty,
                      unit: p.unit
                  });
              });
          });

          if (negatives.length === 0) {
              alert("Žiadne položky so záporným stavom na centrálnom sklade.");
              return;
          }

          // Zoradenie podľa kategórie a abecedy
          negatives.sort((a,b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

          const dateStr = new Date().toLocaleString('sk-SK');
          let html = `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Mínusové stavy - Report</title>
                <style>
                    body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
                    h1 { font-size: 18px; margin-bottom: 5px; }
                    .meta { color: #666; margin-bottom: 20px; font-size: 11px; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
                    th { background: #f3f4f6; font-weight: bold; }
                    .num { text-align: right; font-weight: bold; color: #dc2626; }
                    .cat-row td { background: #e5e7eb; font-weight: bold; padding-top: 10px; }
                </style>
            </head>
            <body>
                <h1>Report Mínusových Skladových zásob</h1>
                <div class="meta">Vygenerované z panelu Vedúceho expedície: ${dateStr}</div>
                
                <table>
                    <thead>
                        <tr>
                            <th>EAN</th>
                            <th>Názov Produktu</th>
                            <th style="text-align:right">Stav</th>
                            <th>MJ</th>
                        </tr>
                    </thead>
                    <tbody>
          `;

          let lastCat = null;
          negatives.forEach(item => {
              if (item.cat !== lastCat) {
                  html += `<tr class="cat-row"><td colspan="4">${escapeHtml(item.cat)}</td></tr>`;
                  lastCat = item.cat;
              }
              html += `
                <tr>
                    <td>${escapeHtml(item.ean)}</td>
                    <td>${escapeHtml(item.name)}</td>
                    <td class="num">${Number(item.qty).toFixed(2)}</td>
                    <td>${escapeHtml(item.unit)}</td>
                </tr>
              `;
          });

          html += `
                    </tbody>
                </table>
                <script>window.onload=function(){ window.print(); setTimeout(function(){window.close();},500); }</script>
            </body>
            </html>
          `;

          const win = window.open('', '_blank');
          win.document.write(html);
          win.document.close();
      } catch(e) {
          showStatus("Chyba: " + e.message, true);
      }
  };

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
  async function openB2bPdfSmart(id, type = null){
    const typeParam = type ? `&type=${type}` : '';
    const u = `/api/leader/b2b/order-pdf?order_id=${encodeURIComponent(id)}${typeParam}`;
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
          
          let buttons = `<button class="btn btn-sm" data-b2b-pdf="${escapeHtml(id)}">Zadanie (PDF)</button> <button class="btn btn-sm" data-b2b-edit="${escapeHtml(id)}">Upraviť</button>`;
          if (r.stav === 'Hotová') {
              buttons += `<br><button class="btn btn-sm btn-success" style="margin-top: 4px;" data-b2b-finished-pdf="${escapeHtml(id)}">Vypracovaná (PDF)</button>`;
          }

          return `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(who)}</td><td>${escapeHtml(ddel||'')}</td><td>${priceCell(r)}</td><td>${escapeHtml(r.stav||'')}</td><td>${buttons}</td></tr>`;
        }).join('');
      } else {
        const groups = {}; list.forEach(r=>{ const key = r.pozadovany_datum_dodania || '(bez dátumu)'; (groups[key] = groups[key] || []).push(r); });
        const keys = Object.keys(groups).sort((a,b)=>{ if (a==='(bez dátumu)') return 1; if (b==='(bez dátumu)') return -1; return a.localeCompare(b); });
        tb.innerHTML = keys.map(k=>{
          const rowsHtml = groups[k].map(r=>{ 
            const id = r.cislo_objednavky || r.id; const who = safeStr(r.odberatel || ''); 
            
            let buttons = `<button class="btn btn-sm" data-b2b-pdf="${escapeHtml(id)}">Zadanie (PDF)</button> <button class="btn btn-sm" data-b2b-edit="${escapeHtml(id)}">Upraviť</button>`;
            if (r.stav === 'Hotová') {
                buttons += `<br>
                <div style="display:flex; gap:4px; margin-top:4px;">
                    <button class="btn btn-sm btn-success" data-b2b-finished-pdf="${escapeHtml(id)}">Vypracovaná (PDF)</button>
                    <button class="btn btn-sm btn-primary" data-b2b-create-dl="${escapeHtml(r.id)}" title="Vystaví dodací list a odpíše zo skladu"><i class="fa-solid fa-truck-fast"></i> Vystaviť DL</button>
                </div>`;
            }

            return `<tr><td>${escapeHtml(id)}</td><td>${escapeHtml(who)}</td><td>${priceCell(r)}</td><td>${escapeHtml(r.stav||'')}</td><td>${buttons}</td></tr>`; 
          }).join('');
          return `<tr class="muted"><td colspan="6"><strong>Dodanie:</strong> ${escapeHtml(k!=='(bez dátumu)'?`${fmtSK(k)} (${k})`:k)}</td></tr>${rowsHtml}`;
        }).join('');
      }
      
      $$('[data-b2b-pdf]').forEach(b=> b.onclick = ()=> openB2bPdfSmart(b.getAttribute('data-b2b-pdf')) );
      // NOVÉ: Kliknutie pre vypracovanú (terminálovú) objednávku
      $$('[data-b2b-finished-pdf]').forEach(b=> b.onclick = ()=> openB2bPdfSmart(b.getAttribute('data-b2b-finished-pdf'), 'finished') );
      $$('[data-b2b-edit]').forEach(b=> b.onclick = ()=>{ const id = b.getAttribute('data-b2b-edit'); const row = rows.find(x=> String(x.cislo_objednavky||x.id) === id); if (row) openB2BEditModal(row); });
      $$('[data-b2b-create-dl]').forEach(b => b.onclick = async () => {
          const orderId = b.getAttribute('data-b2b-create-dl');
          if (!confirm("Naozaj vystaviť Dodací list? Táto akcia fyzicky odpíše tovar zo skladu a zapíše ho do Skladového denníka.")) return;
          
          try {
              showStatus("Vystavujem Dodací list...", false);
              const res = await apiRequest('/api/billing/create_dl_from_order', 'POST', { order_id: orderId });
              showStatus(res.message, false);
              b.style.display = 'none'; // Skryjeme tlačidlo po vystavení
          } catch(e) {
              showStatus(e.message, true);
          }
      });
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

// ======================= ŠTÍTKY PÔVODU MÄSA (TLAČ) - FIX PRE A4 =======================
  var __mol_inited = false;
  const MOL_HISTORY_KEY = 'mol_history_v1';

  // PRÍSNE ROZMERY PRE A4 (12 štítkov na stranu: 2x6)
  const MOL_LABEL_WIDTH = '92mm';
  const MOL_LABEL_HEIGHT = '42mm';
  const MOL_ROW_GAP = '4mm';    // Vertikálna medzera
  const MOL_COL_GAP = '6mm';    // Horizontálna medzera
  const MOL_PAGE_MARGIN = '10mm'; // Okraje A4 strany

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
      
      const slaughter = $('#mol-slaughtertext');
      if (slaughter && !safeStr(slaughter.value)) slaughter.value = mol_defaultCutText();
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
    const dateFormat = safeStr($('#mol-date-format')?.value || 'sk');
    const fontSize = Math.max(8, Math.min(14, Math.floor(toNum($('#mol-font-size')?.value, 10)) || 10)); // Zmenšený default pre 42mm výšku

    const cutText = safeStr($('#mol-cuttext')?.value || '');
    const slaughterText = safeStr($('#mol-slaughtertext')?.value || '');

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

    // rowsPerPage je ignorované, nútime 6 riadkov na A4
    const cfg = { type, company, approval, dateLabel, rowsPerPage: 6, dateFormat, fontSize, cutText, slaughterText };
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
    const slaughterVal = escapeHtml(cfg.slaughterText || '');

    // Optimalizované pre výšku 42mm
    return `
      <table class="mol-label" cellspacing="0" cellpadding="0">
        <tr><td colspan="4" class="mol-company mol-val">${company}</td></tr>
        <tr><td colspan="4" class="mol-approval mol-val">${approval}</td></tr>
        <tr><td colspan="4" class="mol-title mol-val">${title}</td></tr>
        ${isBeef ? `<tr><td class="mol-lbl">Ref. číslo:</td><td colspan="3" class="mol-val" style="font-size:0.9em;">${refVal}</td></tr>` : ''}
        ${isBeef ? `<tr><td class="mol-lbl">Zabité:</td><td colspan="3" class="mol-val">${slaughterVal}</td></tr>` : ''}
        ${isBeef ? `<tr><td class="mol-lbl">Delené:</td><td colspan="3" class="mol-val">${cutVal}</td></tr>` : ''}
        <tr><td class="mol-lbl">CHOVANÉ v:</td><td colspan="3" class="mol-val">${origin}</td></tr>
        ${!isBeef ? `<tr><td class="mol-lbl">ZABITÉ v:</td><td colspan="3" class="mol-val">${origin}</td></tr>` : ''}
        <tr><td class="mol-lbl">PÔVOD:</td><td colspan="3" class="mol-val">${origin}</td></tr>
        <tr>
          <td class="mol-lbl">Kód dávky:</td><td class="mol-val">${batch}</td>
          <td class="mol-lbl">${dlabel}</td><td class="mol-val">${date}</td>
        </tr>
      </table>
    `;
  }

  function mol_buildMarkup(cfg, entries){
    const pagesHtml = (entries || []).map((it, idx)=>{
      const label = mol_labelHtml(it, cfg);
      let gridItems = '';
      // Nútime 12 štítkov (2x6) na každú A4 stranu pre konzistentný layout
      for (let r=0; r<12; r++){
        gridItems += `<div class="mol-grid-item">${label}</div>`;
      }
      return `<div class="mol-a4-page" data-page="${idx+1}"><div class="mol-label-grid">${gridItems}</div></div>`;
    }).join('');

    return `<div class="mol-root" style="--mol-font:${cfg.fontSize || 10}px;">${pagesHtml}</div>`;
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
    // V náhľade zmenšíme root, aby sa zmestil na obrazovku, ale zachováme grid logiku
    const scaledHtml = html.replace('mol-root"', 'mol-root mol-preview-scaled"');

    wrap.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <div class="card-header">
          <strong>Náhľad tlače (A4)</strong>
          <span class="muted">(${entries.length} strán / 12 štítkov (92x42mm) na stranu)</span>
        </div>
        <div class="card-body" style="overflow:auto; background:#f1f5f9; padding: 20px;">
          <div class="mol-preview-container">${scaledHtml}</div>
        </div>
      </div>
    `;
  }

  function mol_openPrintWindow(markup){
    const css = `
      @page { size: A4; margin: 0; } /* CSS okraje 0, používame padding na strane */
      html, body { margin: 0; padding: 0; height: 100%; font-family: Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

      .mol-root { font-size: var(--mol-font, 10px); }

      .mol-a4-page {
        width: 210mm;
        height: 297mm;
        padding: ${MOL_PAGE_MARGIN};
        box-sizing: border-box;
        page-break-after: always;
        overflow: hidden;
      }
      .mol-a4-page:last-child { page-break-after: auto; }

      .mol-label-grid {
        display: grid;
        grid-template-columns: ${MOL_LABEL_WIDTH} ${MOL_LABEL_WIDTH};
        grid-template-rows: repeat(6, ${MOL_LABEL_HEIGHT});
        column-gap: ${MOL_COL_GAP};
        row-gap: ${MOL_ROW_GAP};
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      .mol-grid-item {
        width: ${MOL_LABEL_WIDTH};
        height: ${MOL_LABEL_HEIGHT};
        overflow: hidden;
      }

      .mol-label {
        width: 100%;
        height: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        border: 1px solid #000;
        box-sizing: border-box;
      }
      .mol-label td {
        border: 1px solid #000;
        padding: 1.5px 3px; /* Minimalizovaný padding pre 42mm výšku */
        vertical-align: middle;
        line-height: 1.1;
      }

      .mol-company, .mol-approval, .mol-title { text-align: center; font-weight: 700; }
      .mol-company { font-size: 1.1em; }
      .mol-lbl { font-weight: 700; white-space: nowrap; font-size: 0.9em; }
      .mol-val { overflow: hidden; text-overflow: ellipsis; }
    `;

    const w = window.open('', '_blank');
    if (!w){
      showStatus('Prehliadač zablokoval tlačové okno (pop-up). Povoľte pop-up pre túto stránku.', true);
      return null;
    }
    w.document.open();
    w.document.write(`<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tlač štítkov pôvodu mäsa</title><style>${css}</style></head><body>${markup}</body></html>`);
    w.document.close();
    w.focus();
    return w;
  }

  // Ostatné funkcie (mol_hist_load, mol_hist_store, atď.) zostávajú rovnaké, len sa uistite, že collect/hist_load načítava nové polia
  // Pre stručnosť tu uvádzam len upravené core funkcie tlače.

  function mol_printCore(cfg, entries, opts){
    const options = opts || {};
    if (!entries.length){
      showStatus('Zadajte aspoň 1 riadok.', true);
      return;
    }

    const allOk = entries.every(it => safeStr(it.batch) && safeStr(it.origin));
    if (!allOk){
      showStatus('Niektoré riadky sú neúplné (chýba kód dávky alebo pôvod).', true);
      return;
    }

    const markup = mol_buildMarkup(cfg, entries);
    const w = mol_openPrintWindow(markup);
    if (!w) return;

    setTimeout(()=>{ try{ w.print(); }catch(_){} }, 500); // Dlhší timeout pre istotu na pomalších PC

    if (options.afterPrint) {
      try{ options.afterPrint(); }catch(_){ }
    }
  }

  // --- ZÁKLADNÉ FUNKCIE HISTÓRIE (Uistite sa, že sú kompletné vo vašom js) ---
  function mol_hist_load(){ try{ const raw = localStorage.getItem(MOL_HISTORY_KEY); const data = raw ? JSON.parse(raw) : []; return Array.isArray(data) ? data : []; }catch(_){ return []; } }
  function mol_hist_store(list){ try{ localStorage.setItem(MOL_HISTORY_KEY, JSON.stringify(Array.isArray(list) ? list : [])); }catch(_){ } }
  function mol_hist_makeId(){ return 'mol_' + Date.now() + '_' + Math.random().toString(16).slice(2); }
  function mol_hist_keyOf(item){ const cfg = item.cfg || {}; const row = item.row || {}; return [cfg.type, row.date, row.batch, row.origin, row.ref, cfg.cutText, cfg.slaughterText].map(x=> safeStr(x)).join('|'); }
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
          type: safeStr(cfg.type), company: safeStr(cfg.company), approval: safeStr(cfg.approval), dateLabel: safeStr(cfg.dateLabel),
          dateFormat: safeStr(cfg.dateFormat), fontSize: cfg.fontSize, cutText: safeStr(cfg.cutText), slaughterText: safeStr(cfg.slaughterText)
        },
        row
      };
      const key = mol_hist_keyOf(item);
      if (idxByKey.has(key)){ const i = idxByKey.get(key); cur[i].ts = nowIso; cur[i].cfg = item.cfg; cur[i].row = item.row; } else { cur.unshift(item); }
    });
    mol_hist_store(cur.slice(0, 200));
  }
  function mol_hist_delete(id){ const cur = mol_hist_load(); mol_hist_store(cur.filter(it => String(it.id) !== String(id))); }
  function mol_hist_clear(){ mol_hist_store([]); }
  function mol_hist_typeLabel(type){ const t = String(type||'').toLowerCase(); if (t === 'poultry') return 'Hydina'; if (t === 'pork') return 'Ošípané'; return 'Hovädzie'; }
  function mol_hist_fmtTs(iso){ const s = safeStr(iso); if (!s) return ''; try{ return new Date(s).toLocaleString('sk-SK'); }catch(_){ return s; } }

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
        const hay = [r.date, r.batch, r.origin, r.ref, c.type, c.cutText, c.slaughterText].map(x=> String(x||'').toLowerCase()).join(' | ');
        return hay.includes(filter);
      });
    }

    if (!items.length){ host.innerHTML = '<div class="muted" style="padding:8px 0">História je prázdna.</div>'; return; }

    host.innerHTML = `
      <div class="table-container">
        <table class="tbl" id="mol-history-table">
          <thead><tr><th>Dátum</th><th>Kód dávky</th><th class="mol-beef-only">Referenčné</th><th>Pôvod</th><th>Typ</th><th>Uložené</th><th></th></tr></thead>
          <tbody>
            ${items.map(it=>{
              const r = it.row || {}; const c = it.cfg || {};
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
    `;

    host.querySelectorAll('[data-mol-hdel]').forEach(btn=>{ btn.onclick = ()=>{ mol_hist_delete(btn.getAttribute('data-mol-hdel')); mol_hist_render(); }; });
    host.querySelectorAll('[data-mol-hprint]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.getAttribute('data-mol-hprint');
        const it = mol_hist_load().find(x=> String(x.id) === String(id));
        if (!it) return;
        const cfg = Object.assign({}, it.cfg || {});
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
        const cfg = it.cfg || {}; const row = it.row || {};
        const typeSel = $('#mol-type'); if (typeSel && cfg.type){ typeSel.value = cfg.type; }
        mol_applyBeefVisibility(cfg.type);
        const companyEl = $('#mol-company'); if (companyEl) companyEl.value = cfg.company || companyEl.value;
        const approvalEl = $('#mol-approval'); if (approvalEl) approvalEl.value = cfg.approval || approvalEl.value;
        const dateLblSel = $('#mol-date-label'); if (dateLblSel && cfg.dateLabel){ dateLblSel.value = cfg.dateLabel; }
        const fsEl = $('#mol-font-size'); if (fsEl && cfg.fontSize) fsEl.value = String(cfg.fontSize);
        const cutEl = $('#mol-cuttext'); if (cutEl && mol_isBeef(cfg.type)) cutEl.value = cfg.cutText || mol_defaultCutText();
        const slaughterEl = $('#mol-slaughtertext'); if (slaughterEl && mol_isBeef(cfg.type)) slaughterEl.value = cfg.slaughterText || mol_defaultCutText();
        const tb = $('#mol-items tbody'); mol_addRow(tb, { date: row.date, batch: row.batch, origin: row.origin, ref: row.ref });
        mol_preview();
      };
    });
    mol_applyBeefVisibility();
  }

  function mol_saveHistory(){
    const { cfg, entries } = mol_collect();
    if (!entries.length || !mol_validate(entries)){ showStatus('Zadajte úplné riadky.', true); return; }
    mol_hist_upsert(cfg, entries);
    mol_hist_render();
    showStatus('Uložené do histórie.', false);
  }

  function mol_print(){
    const { cfg, entries } = mol_collect();
    if (!entries.length || !mol_validate(entries)){ showStatus('Zadajte úplné riadky.', true); return; }
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
    function applyTypeDefaults(){ const t = safeStr(typeSel?.value || 'beef'); dateLblSel.value = mol_defaultDateLabel(t); mol_applyBeefVisibility(t); }
    applyTypeDefaults();
    $('#mol-add') && ($('#mol-add').onclick = ()=> mol_addRow(tb));
    $('#mol-preview') && ($('#mol-preview').onclick = mol_preview);
    $('#mol-print') && ($('#mol-print').onclick = mol_print);
    $('#mol-save-history') && ($('#mol-save-history').onclick = mol_saveHistory);
    typeSel && typeSel.addEventListener('change', applyTypeDefaults);
    const hFilter = $('#mol-history-filter');
    hFilter && hFilter.addEventListener('input', mol_hist_render);
    $('#mol-history-clear') && ($('#mol-history-clear').onclick = ()=>{ if (confirm('Vyčistiť históriu?')){ mol_hist_clear(); mol_hist_render(); } });
    let t = null;
    const schedulePreview = ()=>{ clearTimeout(t); t = setTimeout(()=> mol_preview(), 250); };
    ['mol-type','mol-company','mol-approval','mol-cuttext','mol-slaughtertext','mol-date-label','mol-date-format','mol-font-size'].forEach(id=>{ const el = $('#'+id); el && el.addEventListener('change', schedulePreview); });
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
  // 🚛 LOGISTIKA & TRASY (Kanban Drag & Drop)
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
      if (sec) { sec.classList.add('active'); sec.style.display = 'block'; }
      
      const btn = document.querySelector('.sidebar-link i.fa-truck')?.closest('a');
      if(btn) btn.classList.add('active');

      const box = $('#leader-logistics-container');
      if (!box) return;

      const today = todayISO();
      
      // Vložíme CSS pre Kanban
      if (!document.getElementById('kanban-styles')) {
          const style = document.createElement('style');
          style.id = 'kanban-styles';
          style.innerHTML = `
              .kanban-board { display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; align-items: flex-start; height: 75vh; }
              .k-column { background: #f1f5f9; border-radius: 8px; min-width: 320px; width: 320px; max-height: 100%; display: flex; flex-direction: column; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
              .k-col-unassigned { background: #fff1f2; border-color: #fecaca; }
              .k-header { padding: 12px; border-bottom: 1px solid rgba(0,0,0,0.1); font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
              .k-dropzone { padding: 10px; flex: 1; overflow-y: auto; min-height: 150px; }
              .k-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 10px; cursor: grab; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.1s; }
              .k-card:active { cursor: grabbing; transform: scale(0.98); }
              .k-card-title { font-weight: bold; color: #0f172a; margin-bottom: 4px; font-size: 0.95rem; }
              .k-card-subtitle { font-size: 0.8rem; color: #64748b; margin-bottom: 8px; line-height: 1.2; }
              .k-badge { background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.75rem; }
              .k-drop-indicator { height: 4px; background: #3b82f6; border-radius: 2px; margin: 5px 0; }
              .k-fleet-controls { padding: 10px; background: #fff; border-top: 1px solid #e2e8f0; font-size: 0.85rem; }
          `;
          document.head.appendChild(style);
      }

      box.innerHTML = `
          <div style="background:#f8fafc; padding:15px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div style="display:flex; align-items:center; gap:15px;">
                  <h3 style="margin:0; color:#1e293b;"><i class="fas fa-truck-loading"></i> Dispečing</h3>
                  <div id="new-col-container" style="display:none; align-items:center; gap:5px;">
                      <select id="new-col-select" class="form-control" style="width:200px; padding:4px; font-size:0.85rem;"></select>
                      <button class="btn btn-secondary btn-sm" onclick="window.addKanbanColumn()"><i class="fas fa-plus"></i> Pridať stĺpec</button>
                  </div>
              </div>
              <div style="display:flex; gap:10px; align-items:center;">
                  <label style="font-weight:bold; margin:0;">Dátum:</label>
                  <input type="date" id="logistics-date" class="form-control" style="width:auto; padding:6px;" value="${today}">
                  <button id="logistics-load-btn" class="btn btn-primary"><i class="fas fa-sync"></i> Načítať</button>
                  <button class="btn btn-secondary" onclick="window.manageManualRoutes()">📝 Trasy</button>
                  <button class="btn btn-dark" onclick="window.printDailySummary()"><i class="fas fa-print"></i> Slepý list dňa</button>
              </div>
          </div>
          <div id="kanban-container">
              <p class="muted">Kliknite na "Načítať" pre zobrazenie nástenky.</p>
          </div>
      `;

      document.getElementById('logistics-load-btn').onclick = async () => {
          const date = document.getElementById('logistics-date').value;
          const container = document.getElementById('kanban-container');
          container.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Pripravujem Kanban nástenku...</div>';

          try {
              const res = await apiRequest(`/api/leader/logistics/routes-data?date=${date}`);
              const trasy = res.trasy || [];
              const allRoutes = res.all_routes || [];
              
              let vehicles = [];
              try { const vRes = await apiRequest('/api/fleet/active-vehicles'); vehicles = vRes.vehicles || []; } catch(e){}

              // Naplnenie roletky pre manuálne pridanie stĺpca
              const newColContainer = document.getElementById('new-col-container');
              const newColSelect = document.getElementById('new-col-select');
              if (allRoutes.length > 0) {
                  newColContainer.style.display = 'flex';
                  newColSelect.innerHTML = '<option value="">-- Pridať novú trasu --</option>' + 
                      allRoutes.map(r => `<option value="${r.id}" data-name="${escapeHtml(r.nazov)}">${escapeHtml(r.nazov)}</option>`).join('');
              }

              if (trasy.length === 0) {
                  container.innerHTML = '<div class="alert alert-warning" style="text-align:center;font-weight:bold;">Na tento deň nie sú objednávky.</div>';
                  return;
              }

              // Uložíme si globálne vozidlá pre prípad dynamicky pridaného stĺpca
              window.kanbanVehiclesHtml = `<option value="">-- Priradiť auto --</option>` + vehicles.map(v => `<option value="${v.id}">${escapeHtml(v.license_plate)} (${escapeHtml(v.name)})</option>`).join('');

              let unassignedHtml = '';
              let routesHtml = '';

              trasy.forEach(t => {
                  const isUnassigned = t.trasa_id === 'unassigned';
                  
                  let cardsHtml = '';
                  t.zastavky.forEach(z => {
                      cardsHtml += `
                          <div class="k-card" draggable="true" data-cid="${escapeHtml(z.zakaznik_id)}">
                              <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                  <div class="k-card-title">${escapeHtml(z.odberatel)}</div>
                                  ${!isUnassigned ? `<button class="btn btn-sm" style="padding:0 5px; color:#ef4444; border:none; background:transparent;" title="Vyhodiť späť do nepriradených" onclick="window.unassignCard('${escapeHtml(z.zakaznik_id)}')"><i class="fas fa-times"></i></button>` : ''}
                              </div>
                              <div class="k-card-subtitle">${escapeHtml(z.adresa)}</div>
                              <div>
                                  <span class="k-badge">${z.pocet_objednavok} obj.</span>
                                  <span style="font-size:0.75rem; color:#94a3b8; margin-left:5px;">${z.cisla_objednavok.join(', ')}</span>
                              </div>
                          </div>
                      `;
                  });

                  // Skryť stĺpec, ak nie je unassigned a je prázdny (zobrazíme X tlačidlo)
                  const isEmpty = t.zastavky.length === 0;
                  const closeColBtn = (!isUnassigned && isEmpty) ? `<button class="btn btn-sm" style="color:#94a3b8; background:transparent; border:none;" onclick="this.closest('.k-column').remove()" title="Skryť prázdny stĺpec"><i class="fas fa-times"></i></button>` : '';

                  const colHtml = `
                      <div class="k-column ${isUnassigned ? 'k-col-unassigned' : ''}" data-route-id="${t.trasa_id}">
                          <div class="k-header" style="${isUnassigned ? 'color:#b91c1c;' : 'color:#0369a1;'}">
                              <span style="display:flex; align-items:center; gap:5px;">
                                  ${escapeHtml(t.nazov)} 
                                  ${!isUnassigned ? `<button class="btn btn-sm" style="padding:0; color:#94a3b8; background:transparent; border:none;" title="Premenovať trasu" onclick="window.renameRoute('${t.trasa_id}', '${escapeHtml(t.nazov)}')"><i class="fas fa-edit"></i></button>` : ''}
                                  <span class="k-count" style="opacity:0.7;font-size:0.8rem;">(${t.zastavky.length})</span>
                              </span>
                              <div>
                                  ${!isUnassigned && !isEmpty ? `<button class="btn btn-warning btn-sm" style="padding:2px 8px; font-size:0.75rem; color:#000;" onclick='window.printChecklist(${JSON.stringify(t).replace(/'/g, "&apos;")}, "${date}")'><i class="fas fa-print"></i></button>` : closeColBtn}
                              </div>
                          </div>
                          <div class="k-dropzone">
                              ${cardsHtml}
                          </div>
                          ${!isUnassigned ? `
                          <div class="k-fleet-controls">
                              <div style="display:flex; gap:5px; margin-bottom:5px;">
                                  <select id="veh_${t.trasa_id}" class="form-control" style="padding:4px; font-size:0.8rem; flex:1;">
                                      ${window.kanbanVehiclesHtml}
                                  </select>
                                  <button class="btn btn-success btn-sm" style="padding:4px 8px;" onclick="window.assignVehicleToFleet('${escapeHtml(t.nazov)}', '${t.trasa_id}')"><i class="fas fa-check"></i></button>
                              </div>
                          </div>` : ''}
                      </div>
                  `;

                  if (isUnassigned) unassignedHtml += colHtml;
                  else routesHtml += colHtml;
              });

              container.innerHTML = `<div class="kanban-board" id="kanban-board">${unassignedHtml}${routesHtml}</div>`;

              initKanbanDragAndDrop();

          } catch (e) {
              container.innerHTML = `<div class="alert alert-danger" style="font-weight:bold;">Chyba: ${e.message}</div>`;
          }
      };
      
      document.getElementById('logistics-load-btn').click();
  };

  // ================= DRAG & DROP LOGIKA =================
  function initKanbanDragAndDrop() {
      const board = document.getElementById('kanban-board');
      if(!board) return;

      let draggedCard = null;

      board.addEventListener('dragstart', e => {
          if(e.target.classList.contains('k-card')) {
              draggedCard = e.target;
              e.dataTransfer.effectAllowed = 'move';
              setTimeout(() => draggedCard.style.opacity = '0.4', 0);
          }
      });

      board.addEventListener('dragend', e => {
          if(draggedCard) {
              draggedCard.style.opacity = '1';
              draggedCard = null;
          }
          document.querySelectorAll('.k-drop-indicator').forEach(el => el.remove());
      });

      function getDragAfterElement(container, y) {
          const draggableElements = [...container.querySelectorAll('.k-card:not([style*="opacity: 0.4"])')];
          return draggableElements.reduce((closest, child) => {
              const box = child.getBoundingClientRect();
              const offset = y - box.top - box.height / 2;
              if (offset < 0 && offset > closest.offset) {
                  return { offset: offset, element: child };
              } else {
                  return closest;
              }
          }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      board.addEventListener('dragover', e => {
          e.preventDefault(); 
          const dropzone = e.target.closest('.k-dropzone');
          if(!dropzone || !draggedCard) return;

          document.querySelectorAll('.k-drop-indicator').forEach(el => el.remove());
          const indicator = document.createElement('div');
          indicator.className = 'k-drop-indicator';

          const afterElement = getDragAfterElement(dropzone, e.clientY);
          if (afterElement == null) {
              dropzone.appendChild(indicator);
          } else {
              dropzone.insertBefore(indicator, afterElement);
          }
      });

      board.addEventListener('drop', async e => {
          e.preventDefault();
          const dropzone = e.target.closest('.k-dropzone');
          if(!dropzone || !draggedCard) return;

          const indicator = dropzone.querySelector('.k-drop-indicator');
          if(indicator) {
              dropzone.insertBefore(draggedCard, indicator);
              indicator.remove();
          } else {
              dropzone.appendChild(draggedCard);
          }

          const column = dropzone.closest('.k-column');
          const routeId = column.dataset.routeId;
          const cards = Array.from(dropzone.querySelectorAll('.k-card'));
          const customerIds = cards.map(c => c.dataset.cid);

          const countBadge = column.querySelector('.k-count');
          if(countBadge) countBadge.textContent = `(${cards.length})`;

          document.querySelectorAll('.k-column').forEach(col => {
              const b = col.querySelector('.k-count');
              if(b) b.textContent = `(${col.querySelectorAll('.k-card').length})`;
              
              // Zobraz/Skry Remove stĺpec button podľa toho, či je prázdny a nie je "unassigned"
              const isUnassigned = col.classList.contains('k-col-unassigned');
              const isEmpty = col.querySelectorAll('.k-card').length === 0;
              const headerDiv = col.querySelector('.k-header > div');
              
              if(!isUnassigned && isEmpty && headerDiv && !headerDiv.querySelector('.fa-times')) {
                  headerDiv.innerHTML = `<button class="btn btn-sm" style="color:#94a3b8; background:transparent; border:none;" onclick="this.closest('.k-column').remove()" title="Skryť prázdny stĺpec"><i class="fas fa-times"></i></button>`;
              }
          });

          // Pridanie/Odstránenie krížika priamo z kartičky podľa stĺpca
          const isUnassigned = column.classList.contains('k-col-unassigned');
          const headerSection = draggedCard.querySelector('div[style*="justify-content:space-between"]');
          if (isUnassigned) {
              // Ak ide do nepriradených, zmažeme červený krížik
              const btn = headerSection.querySelector('button');
              if (btn) btn.remove();
          } else {
              // Ak ide do trasy a nemá krížik, pridáme ho
              const btn = headerSection.querySelector('button');
              if (!btn) {
                  const cid = draggedCard.dataset.cid;
                  headerSection.insertAdjacentHTML('beforeend', `<button class="btn btn-sm" style="padding:0 5px; color:#ef4444; border:none; background:transparent;" title="Vyhodiť späť do nepriradených" onclick="window.unassignCard('${escapeHtml(cid)}')"><i class="fas fa-times"></i></button>`);
              }
          }

          try {
              showStatus('Ukladám zmenu...', false);
              await apiRequest('/api/leader/logistics/kanban-save', {
                  method: 'POST',
                  body: { route_id: routeId, customer_ids: customerIds }
              });
              showStatus('Poradie a trasa úspešne uložené', false);
          } catch(err) {
              showStatus('Chyba pri ukladaní: ' + err.message, true);
          }
      });
  }

  // ================= KANBAN POMOCNÉ FUNKCIE =================
  window.unassignCard = async function(customerId) {
      if(!confirm("Odstrániť tohto zákazníka z trasy (vrátiť do nepriradených)?")) return;
      
      showStatus('Odoberám z trasy...', false);
      try {
          await apiRequest('/api/leader/logistics/kanban-save', {
              method: 'POST',
              body: { route_id: 'unassigned', customer_ids: [customerId] }
          });
          showStatus('Zákazník bol vrátený medzi nepriradené.', false);
          document.getElementById('logistics-load-btn').click(); // Prekreslí Kanban
      } catch(err) {
          showStatus('Chyba: ' + err.message, true);
      }
  };

  // =========================================================
  // KANBAN - Pridanie prázdneho stĺpca
  // =========================================================
  window.addKanbanColumn = function() {
      const select = document.getElementById('new-col-select');
      const routeId = select.value;
      if (!routeId) return;
      
      const routeName = select.options[select.selectedIndex].dataset.name;
      const board = document.getElementById('kanban-board');
      
      // Skontrolujeme, či stĺpec už náhodou neexistuje
      if (board.querySelector(`.k-column[data-route-id="${routeId}"]`)) {
          showStatus('Tento stĺpec už je na nástenke zobrazený.', true);
          select.value = '';
          return;
      }
      
      const colHtml = `
          <div class="k-column" data-route-id="${routeId}">
              <div class="k-header" style="color:#0369a1;">
                  <span style="display:flex; align-items:center; gap:5px;">
                      ${window.escapeHtml(routeName)}
                      <button class="btn btn-sm" style="padding:0; color:#94a3b8; background:transparent; border:none;" title="Premenovať trasu" onclick="window.renameRoute('${routeId}', '${window.escapeHtml(routeName)}')"><i class="fas fa-edit"></i></button>
                      <span class="k-count" style="opacity:0.7;font-size:0.8rem;">(0)</span>
                  </span>
                  <div>
                      <button class="btn btn-sm" style="color:#94a3b8; background:transparent; border:none;" onclick="this.closest('.k-column').remove()" title="Skryť prázdny stĺpec"><i class="fas fa-times"></i></button>
                  </div>
              </div>
              <div class="k-dropzone"></div>
              <div class="k-fleet-controls">
                  <div style="display:flex; gap:5px; margin-bottom:5px;">
                      <select id="veh_${routeId}" class="form-control" style="padding:4px; font-size:0.8rem; flex:1;">
                          ${window.kanbanVehiclesHtml || '<option value="">-- Priradiť auto --</option>'}
                      </select>
                      <button class="btn btn-success btn-sm" style="padding:4px 8px;" onclick="window.assignVehicleToFleet('${window.escapeHtml(routeName)}', '${routeId}')"><i class="fas fa-check"></i></button>
                  </div>
              </div>
          </div>
      `;
      
      // Vložíme nový stĺpec nakoniec dosky
      board.insertAdjacentHTML('beforeend', colHtml);
      select.value = '';
      
      if (typeof initKanbanDragAndDrop === 'function') {
          initKanbanDragAndDrop();
      }
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
window.printDailySummary = async function() {
      const date = document.getElementById('logistics-date').value;
      if (!date) return showStatus("Zvoľte dátum na vytlačenie slepého listu.", true);
      
      try {
          showStatus("Generujem celkový súhrn na prípravu...", false);
          const res = await apiRequest(`/api/leader/logistics/daily-summary?date=${date}`);
          
          if (!res.kategorie || res.kategorie.length === 0) {
              return showStatus("Na tento deň nie sú prijaté žiadne objednávky.", true);
          }

          const dateFormatted = date.split('-').reverse().join('.');
          let html = `<html><head><title>Celkový Slepý List - ${dateFormatted}</title>
          <style>
              body { font-family: Arial, sans-serif; padding: 20px; font-size: 14px; } 
              h1, h3 { text-align: center; margin:0 0 10px 0; } 
              .info-box { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 15px; margin-bottom: 15px; font-size: 14px; border-radius: 4px; text-align:center;}
              .cat { background: #e2e8f0; padding: 8px; margin-top: 20px; font-weight: bold; border: 1px solid #000; border-bottom: none; text-transform: uppercase; font-size: 16px;} 
              table { width: 100%; border-collapse: collapse; margin-bottom: 20px;} 
              th, td { border: 1px solid #000; padding: 8px; } 
              .num { text-align: right; font-weight: bold; width: 150px; font-size:16px;} 
              @media print { body { margin: 0; padding: 10mm; } }
          </style></head><body>
          <h1>CELKOVÝ SLEPÝ LIST PRE EXPEDÍCIU / VÝROBU</h1>
          <div class="info-box"><strong>DÁTUM DODANIA: ${dateFormatted}</strong><br>Tento list obsahuje súhrn položiek zo všetkých prijatých objednávok dokopy bez ohľadu na trasu.</div>`;
          
          res.kategorie.forEach(kat => {
              html += `<div class="cat">${escapeHtml(kat.kategoria)}</div><table><tbody>`;
              kat.polozky.forEach(p => {
                  const val = parseFloat(p.qty);
                  const displayVal = Number.isInteger(val) ? val : val.toFixed(2);
                  html += `<tr><td>${escapeHtml(p.name)}</td><td class="num">${displayVal} ${p.unit}</td></tr>`;
              });
              html += `</tbody></table>`;
          });
          
          html += `<script>window.onload=function(){window.print(); setTimeout(function(){window.close();},500);}</script></body></html>`;
          
          const win = window.open('', '_blank'); 
          win.document.write(html); 
          win.document.close();
          
      } catch (e) {
          showStatus("Chyba pri generovaní listu: " + e.message, true);
      }
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
      
      const selectVal = document.getElementById('bulk-route-sel-' + trasaId).value;
      const newVal = document.getElementById('bulk-route-new-' + trasaId).value.trim();
      
      // Ak je zadaný text v poli "Nová trasa", použije sa ten. Inak sa použije ID z rolovacieho menu.
      const targetRoute = newVal ? newVal : selectVal;
      
      if(!targetRoute) return showStatus('Zvoľte cieľovú trasu z menu alebo napíšte novú.', true);
      
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
          
          document.getElementById('logistics-load-btn').click(); 
      } catch(e) {
          showStatus('Chyba pri presune: ' + e.message, true);
          btn.innerHTML = originalText;
          btn.disabled = false;
      }
  };
function initManualOrdersUI() {
      const custSearch = $('#manual-customer-search');
      const custResults = $('#manual-customer-results');
      const submitBtn = $('#man-order-submit');
      const saveCustBtn = $('#man-cust-save');
      const plContainer = $('#manual-pricelist-container');
      const plSelect = $('#manual-pricelist-select');
      const plTbody = $('#manual-pricelist-tbody');
      
      // OPRAVA: Vyhodená kontrola na starý prodSearch. Ak tu nie je zákaznícky search, nepokračujeme.
      if(!custSearch) return;

     
      
      if(typeof loadManualOrderHistory === 'function') loadManualOrderHistory();

      let activePricelistItems = {};

      // ================= AUTO-SAVE KONCEPTU =================
      function saveManualB2BDraft() {
          const section = $('#leader-manual-b2b');
          if (!section || !section.classList.contains('active')) return;

          const customer = {
              interne_cislo: $('#man-cust-id').value,
              nazov_firmy: $('#man-cust-name').value,
              adresa: $('#man-cust-addr').value,
              kontakt: $('#man-cust-contact').value,
              is_registered: $('#man-cust-is-registered').value
          };

          const order = {
              date: '',
              note: $('#man-order-note').value
          };

          const items = [];
          $$('#man-order-items tbody tr:not(#man-empty-row)').forEach(tr => {
              const qtyInput = tr.querySelector('.mo-qty');
              const priceInput = tr.querySelector('.mo-price');
              const unitSelect = tr.querySelector('.mo-unit');
              
              if (qtyInput && priceInput) {
                  items.push({
                      ean: tr.dataset.ean,
                      name: tr.dataset.name,
                      dph: tr.dataset.dph,
                      quantity: qtyInput.value,
                      unit: unitSelect ? unitSelect.value : 'kg',
                      price: priceInput.value
                  });
              }
          });

          if (customer.interne_cislo || customer.nazov_firmy || items.length > 0 || order.note) {
              const draft = { customer, order, items, timestamp: new Date().getTime() };
              localStorage.setItem('manualB2BDraft', JSON.stringify(draft));
              
              const titleEl = document.querySelector('#leader-manual-b2b h3');
              if (titleEl && !titleEl.innerHTML.includes('fa-cloud-arrow-up')) {
                   const orig = titleEl.innerHTML;
                   titleEl.innerHTML = orig + ' <i class="fas fa-cloud-arrow-up" style="font-size:0.6em; color:#10b981; margin-left:10px; transition: opacity 1s;" id="draft-indicator" title="Koncept sa automaticky ukladá"></i>';
              }
              const ind = document.getElementById('draft-indicator');
              if(ind) {
                  ind.style.opacity = '1';
                  setTimeout(() => { if(ind) ind.style.opacity = '0.3'; }, 1000);
              }
          } else {
              localStorage.removeItem('manualB2BDraft');
              const ind = document.getElementById('draft-indicator');
              if(ind) ind.remove();
          }
      }

      function restoreManualB2BDraft() {
          const draftStr = localStorage.getItem('manualB2BDraft');
          if (!draftStr) return;

          try {
              const draft = JSON.parse(draftStr);
              const itemName = draft.customer.nazov_firmy ? `pre <b>${escapeHtml(draft.customer.nazov_firmy)}</b>` : 'bez zákazníka';
              
              modalConfirm({
                  title: 'Našiel sa rozpísaný koncept',
                  message: `Máte rozpísanú manuálnu objednávku ${itemName} s <b>${draft.items.length}</b> položkami.<br><br>Chcete ju obnoviť a pokračovať?`,
                  okText: 'Áno, obnoviť',
                  cancelText: 'Zahodiť'
              }).then(res => {
                  if (res) {
                      $('#man-cust-id').value = draft.customer.interne_cislo || '';
                      $('#man-cust-name').value = draft.customer.nazov_firmy || '';
                      $('#man-cust-addr').value = draft.customer.adresa || '';
                      $('#man-cust-contact').value = draft.customer.kontakt || '';
                      $('#man-cust-is-registered').value = draft.customer.is_registered || '0';

                      
                      $('#man-order-note').value = draft.order.note || '';

                      const tbody = $('#man-order-items tbody');
                      tbody.innerHTML = '';
                      
                      if (draft.items.length === 0) {
                          tbody.innerHTML = '<tr id="man-empty-row"><td colspan="6" style="text-align:center; padding: 20px;" class="muted">Zatiaľ neboli pridané žiadne položky.</td></tr>';
                      } else {
                          [...draft.items].reverse().forEach(it => {
                              const p = {
                                  ean: it.ean,
                                  name: it.name,
                                  dph: it.dph,
                                  mj: it.unit,
                                  price: parseFloat(it.price) || 0
                              };
                              addManualOrderRow(p, parseFloat(it.quantity) || 0);
                          });
                      }
                      showStatus('Koncept bol úspešne obnovený.', false);
                  } else {
                      localStorage.removeItem('manualB2BDraft');
                  }
              });
          } catch (e) {
              localStorage.removeItem('manualB2BDraft');
          }
      }

      setInterval(saveManualB2BDraft, 3000);
      setTimeout(restoreManualB2BDraft, 500);

      // ================= VYHĽADÁVANIE ZÁKAZNÍKA A CENNÍKY =================
      const loadFullPricelist = async (plId) => {
          if(!plTbody) return;
          plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Načítavam položky cenníka...</td></tr>';
          activePricelistItems = {}; 
          
          try {
              const items = await apiRequest(`/api/leader/manual_order/pricelist_items?pricelist_id=${plId}`);
              if(!items.length) {
                  plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Tento cenník je prázdny.</td></tr>';
                  return;
              }
              
              plTbody.innerHTML = items.map(p => {
                  if(p.ean) activePricelistItems[String(p.ean)] = toNum(p.price, 0);
                  
                  return `
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
              `}).join('');
              
              $$('.pl-qty-input').forEach(inp => {
                  inp.addEventListener('keypress', function(e) {
                      if (e.key === 'Enter') {
                          e.preventDefault();
                          this.closest('tr').querySelector('button').click();
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
// --- KLÁVESNICOVÁ NAVIGÁCIA PRE ODBERATEĽOV ---
      let currentCustFocus = -1;

      function highlightCustItem(items) {
          if (!items) return;
          for (let i = 0; i < items.length; i++) {
              items[i].style.backgroundColor = ""; // Reset farby
          }
          if (currentCustFocus >= items.length) currentCustFocus = 0;
          if (currentCustFocus < 0) currentCustFocus = (items.length - 1);
          items[currentCustFocus].style.backgroundColor = "#e0f2fe"; // Zvýraznenie svetlomodrou
      }

      custSearch.addEventListener('keydown', (e) => {
          let items = custResults.querySelectorAll('.product-search-item');
          if (e.key === "ArrowDown") {
              currentCustFocus++;
              highlightCustItem(items);
          } else if (e.key === "ArrowUp") {
              currentCustFocus--;
              highlightCustItem(items);
          } else if (e.key === "Enter") {
              e.preventDefault();
              if (currentCustFocus > -1 && items.length > 0) {
                  items[currentCustFocus].click();
              } else if (items.length > 0) {
                  items[0].click(); // Ak nebolo šípkami vybraté nič, vezme prvé
              }
              // Po potvrdení automaticky presunúť kurzor na hľadanie produktov
              setTimeout(() => {
                  const fastEan = $('#fast-ean');
                  if (fastEan) { fastEan.focus(); fastEan.select(); }
              }, 100);
          }
      });

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
                          
                          if(saveCustBtn) saveCustBtn.style.display = (c.is_registered === '1') ? 'none' : 'inline-block';
                          activePricelistItems = {}; 
                          
                          if(c.is_registered === '1' && plContainer && plSelect) {
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
                                      if(plTbody) plTbody.innerHTML = '<tr><td colspan="4" class="text-center muted">Žiadne položky na zobrazenie.</td></tr>';
                                  }
                              } catch(e) {
                                  plSelect.innerHTML = '<option>Chyba pri načítaní cenníkov</option>';
                              }
                          } else {
                              if(plContainer) plContainer.style.display = 'none';
                              if(plTbody) plTbody.innerHTML = '';
                          }
                      };
                  });
              } catch(e) { custResults.innerHTML = '<div style="padding:10px;color:red;">Chyba API.</div>'; }
          }, 300);
      });

      if(saveCustBtn) {
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
      }

      // ==============================================================
      // RÝCHLE NAHADZOVANIE - ENTER FLOW (Skener + Klávesnica)
      // ==============================================================
      const fastEan = $('#fast-ean');
      const fastQty = $('#fast-qty');
      const fastMj  = $('#fast-mj');
      const fastPrice = $('#fast-price');
      const fastAddBtn = $('#fast-add-btn');
      const fastResults = $('#fast-search-results');

      let fastSelectedProduct = null;

      if (fastEan) {
          let fastTimer;
          fastEan.addEventListener('input', () => {
              clearTimeout(fastTimer);
              const q = fastEan.value.trim();
              if (q.length < 2) { fastResults.style.display = 'none'; return; }
              fastTimer = setTimeout(() => doFastSearch(q), 300);
          });

          let currentFastFocus = -1;

          function highlightFastItem(items) {
              if (!items) return;
              for (let i = 0; i < items.length; i++) items[i].style.backgroundColor = "";
              if (currentFastFocus >= items.length) currentFastFocus = 0;
              if (currentFastFocus < 0) currentFastFocus = (items.length - 1);
              items[currentFastFocus].style.backgroundColor = "#e0f2fe";
          }

          fastEan.addEventListener('keydown', async (e) => {
              let items = fastResults.querySelectorAll('.product-search-item');
              if (e.key === "ArrowDown") {
                  currentFastFocus++;
                  highlightFastItem(items);
              } else if (e.key === "ArrowUp") {
                  currentFastFocus--;
                  highlightFastItem(items);
              } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (fastResults.style.display === 'block' && items.length > 0) {
                      if (currentFastFocus > -1) {
                          items[currentFastFocus].click();
                      } else {
                          items[0].click();
                      }
                  } else {
                      const q = fastEan.value.trim();
                      if (q) {
                          const res = await doFastSearch(q, true);
                          if (res && res.length > 0) selectFastProduct(res[0]);
                      }
                  }
              }
          });

          fastQty.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                  e.preventDefault();
                  fastPrice.focus();
                  fastPrice.select();
              }
          });

          fastPrice.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                  e.preventDefault();
                  fastAddBtn.click();
              }
          });

          fastAddBtn.addEventListener('click', (e) => {
              e.preventDefault();
              if (!fastSelectedProduct) {
                  showStatus("Najprv vyberte produkt stlačením Enter v poli EAN.", true);
                  fastEan.focus();
                  return;
              }
              const qty = toNum(fastQty.value, 0);
              if (qty <= 0) {
                  showStatus("Množstvo/Váha musí byť väčšie ako 0.", true);
                  fastQty.focus();
                  return;
              }
              
              const pToAdd = {
                  ...fastSelectedProduct,
                  mj: fastMj.value,
                  price: toNum(fastPrice.value, 0)
              };
              
              addManualOrderRow(pToAdd, qty); 
              
              fastSelectedProduct = null;
              fastEan.value = '';
              fastQty.value = '';
              fastPrice.value = '';
              fastEan.focus();
          });

          async function doFastSearch(q, autoSelectExact = false) {
              fastResults.style.display = 'block';
              fastResults.innerHTML = '<div style="padding:15px;color:#666;font-size:1.2rem;">Hľadám produkt...</div>';
              try {
                  const custId = $('#man-cust-id').value.trim();
                  const data = await apiRequest(`/api/leader/products_standard/search?q=${encodeURIComponent(q)}&customer_id=${encodeURIComponent(custId)}`);
                  
                  if (!data.length) { 
                      fastResults.innerHTML = '<div style="padding:15px;color:#ef4444;font-weight:bold;">Produkt nenájdený!</div>'; 
                      return []; 
                  }

                  data.forEach(p => {
                      let currentPrice = p.price || 0.00;
                      if(activePricelistItems[String(p.ean)] !== undefined) {
                          currentPrice = activePricelistItems[String(p.ean)];
                          p._priceSource = 'cenník';
                      } else if (p.has_history_price) {
                          currentPrice = p.price;
                          p._priceSource = 'história';
                      }
                      p.price = currentPrice;
                  });

                  if (autoSelectExact && (data.length === 1 || data[0].ean === q)) {
                      fastResults.style.display = 'none';
                      return [data[0]];
                  }

                  fastResults.innerHTML = data.map((p, index) => {
                      let badge = '';
                      if (p._priceSource === 'cenník') badge = `<span style="background:#fef08a; color:#166534; padding:4px 8px; border-radius:4px; font-size:0.8rem; font-weight:bold;">CENNÍK</span>`;
                      else if (p._priceSource === 'história') badge = `<span style="background:#e0e7ff; color:#1d4ed8; padding:4px 8px; border-radius:4px; font-size:0.8rem; font-weight:bold;">NAPOSLEDY</span>`;

                      return `
                      <div class="product-search-item" data-idx="${index}" style="padding: 15px; border-bottom: 1px solid #e2e8f0; cursor: pointer; display:flex; justify-content:space-between;">
                          <div>
                              <strong style="font-size: 1.2rem; color:#0f172a;">${escapeHtml(p.name)}</strong><br>
                              <span class="meta" style="font-size:1rem;">EAN: ${escapeHtml(p.ean)} | DPH: ${p.dph}%</span>
                          </div>
                          <div style="text-align:right;">
                              ${badge}<br>
                              <strong style="color:#16a34a; font-size: 1.3rem;">${p.price.toFixed(2)} €</strong> <span style="color:#64748b;">/ ${escapeHtml(p.mj)}</span>
                          </div>
                      </div>`;
                  }).join('');

                  fastResults.querySelectorAll('.product-search-item').forEach(el => {
                      el.onclick = () => {
                          const idx = el.getAttribute('data-idx');
                          selectFastProduct(data[idx]);
                          fastResults.style.display = 'none';
                      };
                  });
                  
                  return data;
              } catch(e) {
                  fastResults.innerHTML = `<div style="padding:15px;color:red;"><b>Chyba pripojenia.</b></div>`;
                  return [];
              }
          }

          function selectFastProduct(p) {
              fastSelectedProduct = p;
              fastEan.value = `${p.name} (${p.ean})`;
              fastMj.value = p.mj;
              fastPrice.value = p.price.toFixed(2);
              
              fastQty.focus();
              fastQty.select();
          }
      }

      document.addEventListener('click', (e) => {
          if (fastEan && fastResults && !fastEan.contains(e.target) && !fastResults.contains(e.target)) fastResults.style.display = 'none';
          if (custSearch && custResults && !custSearch.contains(e.target) && !custResults.contains(e.target)) custResults.style.display = 'none';
      });

      // --- NOVÁ LOGIKA ODOSLANIA (VLOŽ SEM) ---
      
      async function executeFinalSubmit(deliveryDate) {
          const payload = {
              customer: {
                  interne_cislo: $('#man-cust-id').value.trim(),
                  nazov_firmy: $('#man-cust-name').value.trim(),
                  adresa: $('#man-cust-addr').value.trim(),
                  kontakt: $('#man-cust-contact').value.trim(),
                  is_registered: $('#man-cust-is-registered').value
              },
              delivery_date: deliveryDate,
              note: $('#man-order-note').value.trim(),
              items: []
          };

          const trs = $$('#man-order-items tbody tr:not(#man-empty-row)');
          trs.forEach(tr => {
              const qty = toNum(tr.querySelector('.mo-qty').value);
              const price = toNum(tr.querySelector('.mo-price').value);
              if(qty > 0) {
                  payload.items.push({
                      ean: tr.dataset.ean, name: tr.dataset.name, unit: tr.querySelector('.mo-unit').value,
                      dph: tr.dataset.dph, quantity: qty, price: price
                  });
              }
          });

          submitBtn.disabled = true;
          submitBtn.textContent = "Spracúvam...";

          try {
              const res = await apiRequest('/api/leader/manual_order/submit', {method: 'POST', body: payload});
              showStatus(res.message, false);
              
              localStorage.removeItem('manualB2BDraft');
              const ind = document.getElementById('draft-indicator');
              if(ind) ind.remove();
              
              const pdfUrl = `/api/kancelaria/b2b/print_order_pdf/${res.order_id}`;
              window.open(pdfUrl, '_blank');
              
              $('#man-order-items tbody').innerHTML = '<tr id="man-empty-row"><td colspan="6" style="text-align:center; padding: 20px;" class="muted">Zatiaľ neboli pridané žiadne položky.</td></tr>';
              $('#man-cust-id').value = ''; $('#man-cust-name').value = ''; $('#man-cust-addr').value = '';
              $('#man-cust-contact').value = ''; $('#man-cust-is-registered').value = '0'; $('#man-order-note').value = '';
              if(plContainer) plContainer.style.display = 'none';
              
              if(typeof loadManualOrderHistory === 'function') loadManualOrderHistory();
              if(typeof loadB2B === 'function') loadB2B();

          } catch(e) {
              showStatus("Chyba odoslania: " + e.message, true);
          } finally {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> Vytvoriť objednávku';
          }
      }

      if (submitBtn) {
          submitBtn.onclick = () => {
              const custId = $('#man-cust-id').value.trim();
              const trs = $$('#man-order-items tbody tr:not(#man-empty-row)');
              if (!custId) return showStatus("Najskôr vyhľadajte a vyberte odberateľa.", true);
              if (!trs.length) return showStatus("Objednávka musí obsahovať aspoň jednu položku.", true);

              const todayStr = new Date().toISOString().split('T')[0];
              const html = `
                  <div style="text-align:center; padding: 15px;">
                      <h4 style="margin-bottom:15px; color:#0369a1;">Kedy má byť objednávka dodaná?</h4>
                      <input type="date" id="modal-delivery-date" class="form-control" value="${todayStr}" style="font-size:1.5rem; padding:15px; width:100%; text-align:center; margin-bottom:15px; border:2px solid #38bdf8; border-radius:8px;">
                      <p class="muted" style="margin-bottom:15px;">Dátum môžete upraviť šípkami a potvrdiť stlačením <b>Enter</b> (alebo <b>Alt+End</b>)</p>
                      <button id="modal-confirm-date-btn" class="btn btn-success btn-lg" style="width:100%; padding:15px; font-size:1.2rem;"><i class="fas fa-check-double"></i> Záväzne dokončiť</button>
                  </div>
              `;
              
              modal('Potvrdenie termínu dodania', html, (body) => {
                  const dateInput = body.querySelector('#modal-delivery-date');
                  const confirmBtn = body.querySelector('#modal-confirm-date-btn');
                  setTimeout(() => { dateInput.focus(); }, 100);

                  dateInput.addEventListener('keydown', (e) => {
                      if (e.key === 'Enter' || (e.altKey && e.key === 'End')) {
                          e.preventDefault();
                          confirmBtn.click();
                      }
                  });

                  confirmBtn.onclick = () => {
                      const finalDate = dateInput.value;
                      if (!finalDate) return showStatus("Dátum nesmie byť prázdny.", true);
                      closeModal();
                      executeFinalSubmit(finalDate);
                  };
              });
          };
      }

      document.addEventListener('keydown', (e) => {
          if (e.altKey && e.key === 'End') {
              const b2bSection = document.getElementById('leader-manual-b2b');
              if (b2bSection && b2bSection.classList.contains('active')) {
                  e.preventDefault();
                  const confirmDateBtn = document.getElementById('modal-confirm-date-btn');
                  if (confirmDateBtn) {
                      confirmDateBtn.click();
                  } else {
                      if (submitBtn) submitBtn.click();
                  }
              }
          }
      });
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

      const tr = document.createElement('tr');
      tr.dataset.ean = p.ean;
      tr.dataset.name = p.name;
      tr.dataset.dph = p.dph;
      
      const qtyStr = initialQty > 0 ? initialQty.toFixed(2) : "0.00";
      const priceStr = p.price !== undefined ? p.price.toFixed(2) : "0.00";

      // Zväčšené polia a krajší dizajn
      tr.innerHTML = `
          <td style="vertical-align:middle; font-size:1.1rem; color:#475569;">${escapeHtml(p.ean)}</td>
          <td style="vertical-align:middle; font-size:1.1rem;"><strong>${escapeHtml(p.name)}</strong><br><small style="color:#94a3b8">DPH: ${p.dph}%</small></td>
          <td><input type="number" class="form-control mo-qty" step="0.01" value="${qtyStr}" style="padding:10px; font-size:1.2rem; font-weight:bold; width:100%; text-align:center;"></td>
          <td>
            <select class="form-control mo-unit" style="padding:10px; font-size:1.1rem; width:100%">
                <option value="kg" ${p.mj==='kg'?'selected':''}>kg</option>
                <option value="ks" ${p.mj==='ks'?'selected':''}>ks</option>
            </select>
          </td>
          <td><input type="number" class="form-control mo-price" step="0.01" value="${priceStr}" style="padding:10px; font-size:1.2rem; font-weight:bold; color:#16a34a; width:100%; text-align:center;"></td>
          <td style="text-align:right; vertical-align:middle;"><button class="btn btn-danger mo-del" style="padding:10px 15px; font-size:1.1rem;"><i class="fas fa-trash"></i></button></td>
      `;

      tbody.insertBefore(tr, tbody.firstChild);
      
      const qtyInput = tr.querySelector('.mo-qty');
      const priceInput = tr.querySelector('.mo-price');
      
      // Podpora Enteru aj priamo v tabuľke (pre opravy rukou)
      qtyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); priceInput.focus(); priceInput.select(); }
      });
      priceInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
              e.preventDefault();
              const mainEan = document.getElementById('fast-ean');
              if (mainEan) { mainEan.focus(); mainEan.select(); }
          }
      });

      tr.querySelector('.mo-del').onclick = () => {
          tr.remove();
          if(!tbody.children.length) tbody.innerHTML = '<tr id="man-empty-row"><td colspan="6" style="text-align:center; padding: 20px;" class="muted">Zatiaľ neboli pridané žiadne položky.</td></tr>';
      };
      
      // Ak bola funkcia zavolaná bez počiatočnej váhy, automaticky vyzve na jej zadanie
      if(initialQty === 0) {
          qtyInput.select();
          qtyInput.focus();
      }
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

  // =========================================================
  // KANBAN - RÝCHLE AKCIE (Pridanie stĺpca, premenovanie, zmazanie)
  // Vložené vo vnútri hlavného modulu kvôli prístupu k apiRequest a showStatus
  // =========================================================
  window.addKanbanColumn = function() {
      const select = doc.getElementById('new-col-select');
      const routeId = select.value;
      if (!routeId) return;
      
      const routeName = select.options[select.selectedIndex].dataset.name;
      const board = doc.getElementById('kanban-board');
      
      if (board.querySelector(`.k-column[data-route-id="${routeId}"]`)) {
          showStatus('Tento stĺpec už je na nástenke zobrazený.', true);
          select.value = '';
          return;
      }
      
      const colHtml = `
          <div class="k-column" data-route-id="${routeId}">
              <div class="k-header" style="color:#0369a1;">
                  <span style="display:flex; align-items:center; gap:5px;">
                      ${escapeHtml(routeName)}
                      <button class="btn btn-sm" style="padding:0; color:#94a3b8; background:transparent; border:none;" title="Premenovať trasu" onclick="window.renameRoute('${routeId}', '${escapeHtml(routeName)}')"><i class="fas fa-edit"></i></button>
                      <span class="k-count" style="opacity:0.7;font-size:0.8rem;">(0)</span>
                  </span>
                  <div>
                      <button class="btn btn-sm" style="color:#94a3b8; background:transparent; border:none;" onclick="this.closest('.k-column').remove()" title="Skryť prázdny stĺpec"><i class="fas fa-times"></i></button>
                  </div>
              </div>
              <div class="k-dropzone"></div>
              <div class="k-fleet-controls">
                  <div style="display:flex; gap:5px; margin-bottom:5px;">
                      <select id="veh_${routeId}" class="form-control" style="padding:4px; font-size:0.8rem; flex:1;">
                          ${window.kanbanVehiclesHtml || '<option value="">-- Priradiť auto --</option>'}
                      </select>
                      <button class="btn btn-success btn-sm" style="padding:4px 8px;" onclick="window.assignVehicleToFleet('${escapeHtml(routeName)}', '${routeId}')"><i class="fas fa-check"></i></button>
                  </div>
              </div>
          </div>
      `;
      
      board.insertAdjacentHTML('beforeend', colHtml);
      select.value = '';
      
      // Znovunačítanie drag and drop po pridaní stĺpca
      if (typeof initKanbanDragAndDrop === 'function') {
          initKanbanDragAndDrop();
      }
  };

  window.renameRoute = async function(routeId, oldName) {
      const newName = prompt('Zadajte nový názov trasy:', oldName);
      if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
      
      try {
          showStatus('Upravujem názov trasy...', false);
          await apiRequest('/api/leader/logistics/update-route-name', {
              method: 'POST',
              body: { id: routeId, nazov: newName.trim() }
          });
          showStatus('Názov trasy bol upravený.', false);
          doc.getElementById('logistics-load-btn').click(); 
      } catch(e) {
          showStatus('Chyba: ' + e.message, true);
      }
  };

  window.unassignCard = async function(customerId) {
      if(!confirm("Odstrániť tohto zákazníka z trasy (vrátiť do nepriradených)?")) return;
      
      showStatus('Odoberám z trasy...', false);
      try {
          await apiRequest('/api/leader/logistics/kanban-save', {
              method: 'POST',
              body: { route_id: 'unassigned', customer_ids: [customerId] }
          });
          showStatus('Zákazník bol vrátený medzi nepriradené.', false);
          doc.getElementById('logistics-load-btn').click(); 
      } catch(err) {
          showStatus('Chyba: ' + err.message, true);
      }
  };
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

window.loadExpeditionBreakdown = async function() {
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
document.addEventListener('DOMContentLoaded', () => {
    const btnBlindBatch = document.getElementById('btnGenerateBlindBatch');
    if (btnBlindBatch) {
        btnBlindBatch.addEventListener('click', generateBlindBatchList);
    }
});

async function generateBlindBatchList() {
    const currentHour = new Date().getHours();
    if (currentHour >= 12) {
        alert("KRITICKÁ CHYBA: Po 12:00 nie je možné generovať predikciu. Čakajte na tvrdú uzávierku.");
        return;
    }

    // 1. Načítanie dátumu z dashboardu
    const dateInput = document.getElementById('ldr-date').value;
    let targetDateParam = '';
    
    if (dateInput) {
        targetDateParam = `&date=${dateInput}`;
    } else {
        alert("CHYBA: Najskôr zvoľte dátum v dashboarde.");
        return;
    }

    try {
        document.body.style.cursor = 'wait';
        
        // 2. Pripojenie parametra dátumu do dopytu
        const response = await fetch(`/api/leader/production/predictive_batch?client_filter=%COOP%${targetDateParam}`);
        const data = await response.json();

        if (data.error) {
            alert("Systémová chyba: " + data.error);
            return;
        }

        const itemsToPick = data.predictions.filter(item => item.blind_pick_delta > 0);

        if (itemsToPick.length === 0) {
            alert("Nedostatok historických dát alebo ranné objednávky už pokryli cieľ. Slepý zber nie je možný.");
            return;
        }

        printBlindBatchList(itemsToPick, data.target_date);

    } catch (error) {
        alert("Zlyhanie komunikácie so serverom.");
        console.error(error);
    } finally {
        document.body.style.cursor = 'default';
    }
}

function printBlindBatchList(items, targetDate) {
    // Generovanie zjednodušeného tlačového okna
    let printWindow = window.open('', '_blank', 'width=800,height=900');
    
    let html = `
    <html>
    <head>
        <title>Slepý zberný list - Expedícia</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { text-align: center; border-bottom: 2px solid black; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid black; padding: 12px; text-align: left; font-size: 16px; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .checkbox-col { width: 80px; text-align: center; }
            .weight-col { font-weight: bold; font-size: 18px; text-align: right; }
        </style>
    </head>
    <body>
        <h1>HROMADNÝ SLEPÝ ZBER (COOP)</h1>
        <p><strong>Cieľový dátum závozu:</strong> ${targetDate}</p>
        <p><strong>Čas generovania:</strong> ${new Date().toLocaleTimeString()}</p>
        <p><em>Pokyn: Stiahnite uvedenú tonáž z hlavného skladu, navážte do prepraviek a uložte do Staging zóny.</em></p>
        
        <table>
            <thead>
                <tr>
                    <th>Názov výrobku</th>
                    <th>Kategória</th>
                    <th>Cieľová hmotnosť k vychystaniu</th>
                    <th class="checkbox-col">Hotovo</th>
                </tr>
            </thead>
            <tbody>
    `;

    items.forEach(item => {
        html += `
            <tr>
                <td>${item.name}</td>
                <td>${item.kategoria}</td>
                <td class="weight-col">${item.blind_pick_delta} ${item.mj}</td>
                <td class="checkbox-col"></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    </body>
    </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    
    // Automatické spustenie tlače
    setTimeout(() => {
        printWindow.print();
    }, 500);
}

window.printExpeditionBreakdown = function() {
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
// ========================= TV TABUĽA OZNAMY A NAŠEPKÁVAČ ===========================
  let tvCustomersList = [];

  async function loadTvBoardSettings() {
      try {
          const res = await apiRequest('/api/leader/tv_board/customers');
          if (res.error) throw new Error(res.error);
          
          const globEl = $('#tv-global-note');
          if(globEl) globEl.value = res.global_note || '';
          
          tvCustomersList = res.customers || [];
          renderActiveTvNotes();
          
          const noteEl = $('#tv-customer-note');
          if(noteEl) noteEl.value = '';
          
          const nameEl = $('#tv-selected-customer-name');
          if(nameEl) nameEl.textContent = 'Najskôr vyhľadajte zákazníka';
          
          const idEl = $('#tv-selected-customer-id');
          if(idEl) idEl.value = '';
          
          const btnSaveCust = $('#btn-save-customer-note');
          if(btnSaveCust) btnSaveCust.disabled = true;
          
          const searchEl = $('#tv-customer-search');
          if(searchEl) searchEl.value = '';
      } catch (err) {
          console.error("TV Tabuľa chyba:", err);
      }
  }

  function renderActiveTvNotes() {
      const list = $('#tv-active-notes-list');
      if (!list) return;
      list.innerHTML = '';
      
      const active = tvCustomersList.filter(c => c.stala_poznamka_expedicia && c.stala_poznamka_expedicia.trim() !== '');
      
      if (active.length === 0) {
          list.innerHTML = '<div style="padding: 12px; color: #9ca3af; font-size: 0.9rem;">Zatiaľ nikto nemá aktívnu stálu požiadavku.</div>';
          return;
      }
      
      active.forEach(c => {
          const div = document.createElement('div');
          div.className = 'product-search-item';
          div.style.flexDirection = 'column';
          div.innerHTML = `
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                  <strong>${escapeHtml(c.nazov_firmy)}</strong> <span class="meta">${escapeHtml(c.zakaznik_id)}</span>
              </div>
              <small style="color:#d32f2f; font-weight:600;">${escapeHtml(c.stala_poznamka_expedicia)}</small>
          `;
          div.onclick = () => selectTvCustomer(c);
          list.appendChild(div);
      });
  }

  function initTvBoardUI() {
      const tvSearchInput = $('#tv-customer-search');
      const tvSearchResults = $('#tv-customer-results');
      
      if (tvSearchInput && tvSearchResults) {
          tvSearchInput.addEventListener('input', (e) => {
              const term = e.target.value.toLowerCase().trim();
              tvSearchResults.innerHTML = '';
              
              if (term.length < 2) {
                  tvSearchResults.style.display = 'none';
                  return;
              }
              
              const filtered = tvCustomersList.filter(c => 
                  (c.nazov_firmy && c.nazov_firmy.toLowerCase().includes(term)) || 
                  (c.zakaznik_id && String(c.zakaznik_id).toLowerCase().includes(term))
              ).slice(0, 15);

              if (filtered.length > 0) {
                  tvSearchResults.style.display = 'block';
                  filtered.forEach(c => {
                      const div = document.createElement('div');
                      div.className = 'product-search-item';
                      const hasNote = c.stala_poznamka_expedicia ? '<span style="color:#ef4444;font-weight:bold;margin-right:5px;">⚠️</span>' : '';
                      
                      div.innerHTML = `<div>${hasNote}${escapeHtml(c.nazov_firmy)}</div> <div class="meta">${escapeHtml(c.zakaznik_id)}</div>`;
                      div.onclick = () => {
                          selectTvCustomer(c);
                          tvSearchResults.style.display = 'none';
                          tvSearchInput.value = ''; 
                      };
                      tvSearchResults.appendChild(div);
                  });
              } else {
                  tvSearchResults.style.display = 'none';
              }
          });

          document.addEventListener('click', (e) => {
              if (!tvSearchInput.contains(e.target) && !tvSearchResults.contains(e.target)) {
                  tvSearchResults.style.display = 'none';
              }
          });
      }

      const btnSaveGlobal = $('#btn-save-global-note');
      if (btnSaveGlobal) {
          btnSaveGlobal.addEventListener('click', async () => {
              const note = $('#tv-global-note').value;
              try {
                  await apiRequest('/api/leader/tv_board/global_note', {
                      method: 'POST',
                      body: { note: note }
                  });
                  showStatus('Hlavný odkaz bol úspešne odoslaný na TV tabuľu.', false);
              } catch (e) { showStatus('Chyba pri ukladaní oznamu.', true); }
          });
      }

      const btnSaveCust = $('#btn-save-customer-note');
      if (btnSaveCust) {
          btnSaveCust.addEventListener('click', async () => {
              const z_id = $('#tv-selected-customer-id').value;
              const note = $('#tv-customer-note').value;
              try {
                  await apiRequest('/api/leader/tv_board/customer_note', {
                      method: 'POST',
                      body: { zakaznik_id: z_id, note: note } 
                  });
                  
                  const c = tvCustomersList.find(x => x.zakaznik_id === z_id);
                  if (c) c.stala_poznamka_expedicia = note;
                  renderActiveTvNotes();
                  
                  showStatus('Stála požiadavka zákazníka bola uložená.', false);
              } catch (e) { showStatus('Chyba pri ukladaní.', true); }
          });
      }
  }

  function selectTvCustomer(c) {
      $('#tv-selected-customer-name').textContent = c.nazov_firmy + ' (' + c.zakaznik_id + ')';
      $('#tv-selected-customer-id').value = c.zakaznik_id;
      $('#tv-customer-note').value = c.stala_poznamka_expedicia || '';
      $('#btn-save-customer-note').disabled = false;
  }
  // =================================================================
  // SKLADOVÉ KARTY (Centrálny katalóg produktov pre vedúcu)
  // =================================================================
  window._cachedProducts = null;
  window._cachedCategories = [];

  window.loadLeaderProducts = async function() {
      const tbody = document.getElementById('stock-cards-tbody');
      const searchQ = (document.getElementById('stock-cards-search')?.value || '').toLowerCase().trim();
      const catF = document.getElementById('stock-cards-cat-filter')?.value || '';

      if (!window._cachedProducts) {
          tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:40px;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam katalóg...</td></tr>';
          try {
              window._cachedProducts = await apiRequest('/api/leader/catalog/products');
              
              // Naplnenie filtra kategórií
              const cats = [...new Set(window._cachedProducts.map(p => p.predajna_kategoria).filter(Boolean))].sort();
              const catSelect = document.getElementById('stock-cards-cat-filter');
              if (catSelect) {
                  catSelect.innerHTML = '<option value="">Všetky kategórie</option>' + 
                      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
                  catSelect.value = catF;
              }
          } catch(e) {
              tbody.innerHTML = `<tr><td colspan="7" class="error text-center" style="color:red; padding:20px;">Chyba: ${e.message}</td></tr>`;
              return;
          }
      }

      let filtered = window._cachedProducts.filter(p => {
          const matchesSearch = !searchQ || (p.nazov_vyrobku?.toLowerCase().includes(searchQ) || p.ean?.includes(searchQ));
          const matchesCat = !catF || p.predajna_kategoria === catF;
          return matchesSearch && matchesCat;
      });

      if (filtered.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="muted text-center" style="padding:20px;">Nenašli sa žiadne produkty.</td></tr>';
          return;
      }

      tbody.innerHTML = filtered.slice(0, 150).map(p => `
          <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="font-family:monospace; font-weight:bold; color:#0369a1;">${escapeHtml(p.ean)}</td>
              <td style="font-weight:600; color:#0f172a;">${escapeHtml(p.nazov_vyrobku)}</td>
              <td><span style="background:#e2e8f0; padding:2px 6px; border-radius:4px; font-size:0.85rem; color:#475569;">${escapeHtml(p.predajna_kategoria || 'Nezaradené')}</span></td>
              <td style="text-align:right; font-weight:bold; color:${p.stock <= 0 ? '#ef4444' : '#10b981'};">${Number(p.stock || 0).toFixed(2)}</td>
              <td>${escapeHtml(p.mj)}</td>
              <td>${p.dph}%</td>
              <td style="text-align:right; white-space:nowrap;">
                  <div style="display:flex; gap:5px; justify-content:flex-end;">
                      <button class="btn btn-sm btn-light" onclick="window.showProductStockCard('${p.ean}')" title="Skladová karta">
                          <i class="fa-solid fa-boxes-stacked" style="color: #0369a1;"></i>
                      </button>
                      <button class="btn btn-sm btn-light" onclick="window.showProductHistory('${p.ean}')" title="História pohybov">
                          <i class="fas fa-history"></i>
                      </button>
                      <button class="btn btn-sm btn-primary" onclick='window.showProductEditor(${JSON.stringify(p).replace(/'/g, "&apos;")})' title="Upraviť">
                          <i class="fas fa-edit"></i>
                      </button>
                      <button class="btn btn-sm btn-danger" onclick="window.deleteLeaderProduct('${p.ean}', '${escapeHtml(p.nazov_vyrobku)}')" title="Odstrániť">
                          <i class="fas fa-trash"></i>
                      </button>
                  </div>
              </td>
          </tr>
      `).join('');
  };

window.openSalesExplorer = async function(ean, productName) {
    // 1. Zobrazíme načítavanie cez overenú funkciu modálneho okna
    window.openLeaderModal('<div style="padding:40px; text-align:center;"><i class="fas fa-spinner fa-spin fa-3x" style="color:#0369a1; margin-bottom:15px;"></i><br><h3 style="color:#1e293b;">Prehľadávam históriu predajov...</h3></div>');
    
    try {
        // Získame dáta z databázy
        const allSales = await apiRequest(`/api/leader/catalog/products/sales_explorer?ean=${ean}`);
        const customers = [...new Set(allSales.map(s => s.customer))].sort();

        // Uložíme ich do globálnej premennej pre rýchle filtrovanie
        window._currentSalesData = allSales;

        // 2. Vytvoríme hlavnú štruktúru okna s filtrom
        const html = `
            <div style="padding-bottom:10px; border-bottom:2px solid #e2e8f0; margin-bottom:15px;">
                <h3 style="margin:0; color:#1e293b;"><i class="fas fa-search-dollar"></i> Prieskumník predajov: ${escapeHtml(productName)}</h3>
            </div>
            
            <div style="background:#f8fafc; padding:15px; border-radius:10px; margin-bottom:15px; border:1px solid #e2e8f0;">
                <div style="display:flex; gap:15px; align-items:flex-end; flex-wrap:wrap;">
                    <div style="flex:1; min-width:250px;">
                        <label class="muted small" style="font-weight:bold; display:block; margin-bottom:5px;">Filter podľa Odberateľa:</label>
                        <select id="se-customer-select" class="form-control" onchange="window._se_render_table()">
                            <option value="">-- Všetci odberatelia (Kompletná história) --</option>
                            ${customers.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                        </select>
                    </div>
                    <div style="color:#64748b; font-size:0.95rem; padding-bottom:8px;" id="se-count-display">
                        Nájdených záznamov: <b>${allSales.length}</b>
                    </div>
                </div>
            </div>
            
            <div id="se-table-container"></div>
            
            <div style="margin-top:20px; border-top:1px solid #e2e8f0; padding-top:15px; display:flex; justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="window.showProductStockCard('${ean}')" style="padding:10px 20px;">
                    <i class="fas fa-arrow-left"></i> Späť na Skladovú kartu
                </button>
            </div>
        `;

        // Zobrazíme rozhranie
        window.openLeaderModal(html);
        
        // 3. Spustíme vykreslenie tabuľky
        setTimeout(() => {
            window._se_render_table();
        }, 50);

    } catch (e) {
        window.openLeaderModal(`<div class="error" style="padding:30px; text-align:center; color:#dc2626;"><i class="fas fa-exclamation-triangle fa-3x"></i><br><br>Chyba pri načítaní: ${e.message}</div>`);
    }
};

// Pomocná funkcia, ktorá sa volá pri zmene Odberateľa (prepíše iba tabuľku, nie celé okno)
window._se_render_table = function() {
    const container = document.getElementById('se-table-container');
    if (!container) return;
    
    const selectedValue = document.getElementById('se-customer-select').value;
    const allSales = window._currentSalesData || [];
    
    // Vyfiltrujeme dáta
    const filteredSales = selectedValue ? allSales.filter(s => s.customer === selectedValue) : allSales;
    
    // Aktualizujeme počet nájdených
    document.getElementById('se-count-display').innerHTML = `Nájdených záznamov: <b style="color:#0369a1;">${filteredSales.length}</b>`;

    let html = `
    <div class="table-container" style="max-height:450px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:8px;">
        <table class="tbl" style="width:100%; margin:0;">
            <thead style="position:sticky; top:0; background:#f1f5f9; z-index:2; box-shadow:0 1px 0 #cbd5e1;">
                <tr>
                    <th style="width:140px;">Dátum dodania</th>
                    <th>Odberateľ</th>
                    <th style="text-align:right;">Dodané množstvo</th>
                    <th style="text-align:right;">Jednotková Cena</th>
                    <th style="text-align:center; width:80px;">Doklad</th>
                </tr>
            </thead>
            <tbody>`;

    if (filteredSales.length === 0) {
        html += '<tr><td colspan="5" class="text-center muted" style="padding:30px;">Žiadne predaje pre tento filter.</td></tr>';
    } else {
        filteredSales.forEach(s => {
            // Generovanie správnej cesty k PDF na základe typu objednávky
            const pdfUrl = s.type === 'B2B' 
                ? `/api/leader/b2b/order-pdf?order_id=${s.order_id}&type=finished` 
                : `/api/kancelaria/b2c/order-pdf?order_id=${s.order_id}`;

            html += `
                <tr style="border-bottom:1px solid #f1f5f9; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                    <td style="font-size:0.85rem; color:#64748b;">${s.date}</td>
                    <td style="font-weight:600; color:#1e293b;">${escapeHtml(s.customer)}</td>
                    <td style="text-align:right; font-weight:800; color:#0369a1; font-size:1.05rem;">${s.qty.toFixed(2)} ${s.unit}</td>
                    <td style="text-align:right; color:#16a34a; font-weight:600;">${s.price.toFixed(2)} €</td>
                    <td style="text-align:center;">
                        <button class="btn btn-sm" style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;" onclick="window.open('${pdfUrl}', '_blank')" title="Otvoriť PDF dodacieho listu">
                            <i class="fas fa-file-pdf"></i> PDF
                        </button>
                    </td>
                </tr>`;
        });
    }
    
    html += `</tbody></table></div>`;
    container.innerHTML = html;
};
 window.showProductEditor = async function(p) {
      // Ak nemáme kategórie v pamäti, skúsime ich načítať z nového endpointu
      if (!window._cachedCategories || window._cachedCategories.length === 0) {
          try {
              window._cachedCategories = await apiRequest('/api/leader/catalog/categories');
          } catch (e) {
              console.error("Nepodarilo sa načítať kategórie:", e);
              window._cachedCategories = []; // Fallback na prázdny zoznam
          }
      }

      const isEdit = !!p;
      const ean = p ? p.ean : '';
      const nazov = p ? p.nazov_vyrobku : '';
      const kat = p ? p.predajna_kategoria : '';
      const mj = p ? p.mj : 'kg';
      const dph = p ? p.dph : '23';

      const html = `
          <div style="padding-bottom:10px; border-bottom:2px solid #e2e8f0; margin-bottom:15px;">
              <h3 style="margin:0; color:#1e293b;">${isEdit ? '✏️ Úprava produktu' : '➕ Nový produkt'}</h3>
          </div>
          <input type="hidden" id="pe-old-ean" value="${escapeHtml(ean)}">
          
          <div class="form-group" style="margin-bottom:15px;">
              <label style="font-weight:bold; color:#0f172a;">EAN (Čiarový kód) *</label>
              <input type="text" id="pe-ean" class="form-control" style="width:100%; font-family:monospace; font-size:1.1rem;" value="${escapeHtml(ean)}" placeholder="Napr. 280001">
          </div>
          
          <div class="form-group" style="margin-bottom:15px;">
              <label style="font-weight:bold; color:#0f172a;">Názov produktu *</label>
              <input type="text" id="pe-nazov" class="form-control" style="width:100%; font-size:1.1rem;" value="${escapeHtml(nazov)}" placeholder="Presný názov výrobku...">
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:15px; margin-bottom:25px; background:#f8fafc; padding:15px; border-radius:6px; border:1px solid #e2e8f0;">
              <div class="form-group">
                  <label style="font-weight:bold;">Predajná Kategória</label>
                  <select id="pe-kat" class="form-control" style="width:100%;">
                      <option value="">-- Nezaradené --</option>
                      ${window._cachedCategories.map(c => `<option value="${escapeHtml(c)}" ${kat === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                  </select>
              </div>
              <div class="form-group">
                  <label style="font-weight:bold;">MJ</label>
                  <select id="pe-mj" class="form-control" style="width:100%;">
                      <option value="kg" ${mj === 'kg' ? 'selected' : ''}>kg</option>
                      <option value="ks" ${mj === 'ks' ? 'selected' : ''}>ks</option>
                  </select>
              </div>
              <div class="form-group">
                  <label style="font-weight:bold;">DPH (%)</label>
                  <select id="pe-dph" class="form-control" style="width:100%;">
                      <option value="23" ${dph == 23 ? 'selected' : ''}>23%</option>
                      <option value="19" ${dph == 19 ? 'selected' : ''}>19%</option>
                      <option value="10" ${dph == 10 ? 'selected' : ''}>10%</option>
                      <option value="5" ${dph == 5 ? 'selected' : ''}>5%</option>
                      <option value="0" ${dph == 0 ? 'selected' : ''}>0%</option>
                  </select>
              </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button class="btn btn-secondary" onclick="window.closeLeaderModal()" style="padding:10px 20px;">Zrušiť</button>
              <button class="btn btn-success" onclick="window.saveLeaderProduct()" style="padding:10px 20px; font-weight:bold;"><i class="fas fa-save"></i> Uložiť produkt</button>
          </div>
      `;
      window.openLeaderModal(html);
  };

  window.saveLeaderProduct = async function() {
      const payload = {
          old_ean: document.getElementById('pe-old-ean').value,
          ean: document.getElementById('pe-ean').value.trim(),
          nazov_vyrobku: document.getElementById('pe-nazov').value.trim(),
          predajna_kategoria: document.getElementById('pe-kat').value.trim(),
          mj: document.getElementById('pe-mj').value,
          dph: document.getElementById('pe-dph').value
      };

      if (!payload.ean || !payload.nazov_vyrobku) {
          return showStatus('EAN a Názov sú povinné!', true);
      }

      try {
          showStatus('Ukladám...', false);
          const res = await apiRequest('/api/leader/catalog/products/save', {
              method: 'POST',
              body: payload
          });
          showStatus(res.message, false);
          window.closeLeaderModal();
          
          window._cachedProducts = null;
          window.loadLeaderProducts();
      } catch(e) {
          showStatus('Chyba: ' + e.message, true);
      }
  };
  // Odstránenie produktu
  window.deleteLeaderProduct = async function(ean, name) {
      if (!confirm(`Naozaj chcete odstrániť produkt "${name}" (EAN: ${ean}) z centrálneho katalógu?`)) return;
      
      try {
          showStatus('Odstraňujem...', false);
          await apiRequest(`/api/leader/catalog/products/delete?ean=${ean}`, { method: 'DELETE' });
          showStatus('Produkt bol odstránený.', false);
          window._cachedProducts = null;
          window.loadLeaderProducts();
      } catch(e) {
          showStatus('Chyba: ' + e.message, true);
      }
  };

  // Zobrazenie skladovej karty (ÚPLNÁ KOPIA ERP_ADMIN.JS)
  window.showProductStockCard = async function(ean) {
      window.openLeaderModal('<div style="padding:30px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam skladovú kartu...</div>');
      try {
          const response = await apiRequest(`/api/leader/catalog/products/stock_card?ean=${ean}`);
          
          if (response.error) throw new Error(response.error);

          const prod = response.product;
          const b2b = response.b2b || [];
          const b2c = response.b2c || [];
          const prodHist = response.production || [];

          // Formátovanie dátumu do pekného tvaru
          const formatDate = (iso) => {
              if (!iso) return '';
              const d = new Date(iso);
              return isNaN(d.getTime()) ? iso : d.toLocaleString('sk-SK');
          };

          // Generovanie riadkov pre tabuľky
          let b2bHtml = b2b.map(o => `<tr><td style="font-size:0.85rem;">${formatDate(o.date)}</td><td>${escapeHtml(o.customer)}</td><td style="text-align:right;font-weight:bold;color:#0369a1;">${o.qty} ${o.mj}</td></tr>`).join('') || '<tr><td colspan="3" class="muted text-center" style="padding:15px;">Žiadne nedávne B2B predaje.</td></tr>';
          
          let b2cHtml = b2c.map(o => `<tr><td style="font-size:0.85rem;">${formatDate(o.date)}</td><td><span style="font-family:monospace; background:#f1f5f9; padding:2px 5px; border-radius:4px;">${escapeHtml(o.order_no)}</span></td><td style="text-align:right;font-weight:bold;color:#d97706;">${o.qty} ${o.mj}</td></tr>`).join('') || '<tr><td colspan="3" class="muted text-center" style="padding:15px;">Žiadne nedávne B2C predaje.</td></tr>';
          
          let prodHtml = prodHist.map(p => `<tr><td style="font-size:0.85rem;">${formatDate(p.date)}</td><td><span style="font-family:monospace;">${escapeHtml(p.batch)}</span></td><td style="text-align:right;font-weight:bold;color:#16a34a;">+${p.qty} kg</td></tr>`).join('') || '<tr><td colspan="3" class="muted text-center" style="padding:15px;">Žiadne nedávne výroby.</td></tr>';

          // Vytvorenie HTML modálneho okna vo vizuále Kancelárie
          const html = `
              <div style="padding-bottom:15px; border-bottom:2px solid #e2e8f0; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                      <h3 style="margin:0; color:#1e293b; font-size:1.5rem;">📦 Skladová karta: ${escapeHtml(prod.name)}</h3>
                      <div style="color:#64748b; font-family:monospace; font-weight:bold; margin-top:5px; background:#f1f5f9; display:inline-block; padding:3px 8px; border-radius:5px;">EAN: ${escapeHtml(prod.ean)}</div>
                  </div>
                  <div style="background:#f0f9ff; border:1px solid #bae6fd; padding:10px 20px; border-radius:8px; text-align:center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      <div style="font-size:0.8rem; font-weight:bold; color:#0369a1; text-transform:uppercase;">Stav na sklade</div>
                      <div style="font-size:2rem; font-weight:900; color:#0c4a6e; line-height:1;">${prod.stock.toFixed(2)} <span style="font-size:1rem;">${escapeHtml(prod.mj)}</span></div>
                  </div>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
                  
                  ${prod.is_made ? `
                  <div style="grid-column: span 2; background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                      <div style="background:#f0fdf4; padding:12px 15px; border-bottom:1px solid #bbf7d0; color:#166534; font-weight:bold;">
                          <i class="fas fa-industry"></i> Posledné záznamy z výroby
                      </div>
                      <div class="table-container" style="max-height:220px; overflow-y:auto; margin:0;">
                          <table class="tbl" style="margin:0; width:100%; border:none;">
                              <thead style="position:sticky; top:0; background:#fff; box-shadow: 0 1px 0 #eee;"><tr><th>Dátum ukončenia</th><th>Šarža (Dávka)</th><th style="text-align:right;">Vyrobené množstvo</th></tr></thead>
                              <tbody>${prodHtml}</tbody>
                          </table>
                      </div>
                  </div>` : ''}
                  
                  <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                      <div style="background:#f0f9ff; padding:12px 15px; border-bottom:1px solid #bae6fd; color:#0369a1; font-weight:bold;">
                          <i class="fas fa-building"></i> Posledné B2B predaje
                      </div>
                      <div class="table-container" style="max-height:250px; overflow-y:auto; margin:0;">
                          <table class="tbl" style="margin:0; width:100%; border:none;">
                              <thead style="position:sticky; top:0; background:#fff; box-shadow: 0 1px 0 #eee;"><tr><th>Dátum</th><th>Odberateľ</th><th style="text-align:right;">Množstvo</th></tr></thead>
                              <tbody>${b2bHtml}</tbody>
                          </table>
                      </div>
                  </div>

                  <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
                      <div style="background:#fffbeb; padding:12px 15px; border-bottom:1px solid #fde68a; color:#b45309; font-weight:bold;">
                          <i class="fas fa-shopping-basket"></i> Posledné B2C predaje
                      </div>
                      <div class="table-container" style="max-height:250px; overflow-y:auto; margin:0;">
                          <table class="tbl" style="margin:0; width:100%; border:none;">
                              <thead style="position:sticky; top:0; background:#fff; box-shadow: 0 1px 0 #eee;"><tr><th>Dátum</th><th>Objednávka</th><th style="text-align:right;">Množstvo</th></tr></thead>
                              <tbody>${b2cHtml}</tbody>
                          </table>
                      </div>
                  </div>
              </div>

             <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #e2e8f0; padding-top:15px;">
                  <button class="btn btn-secondary" onclick="window.closeLeaderModal()" style="padding:10px 20px;">Zatvoriť skladovú kartu</button>
                  <button class="btn btn-primary" onclick="window.openSalesExplorer('${ean}', '${escapeHtml(prod.name)}')" style="padding:10px 25px; font-weight:600;">
                      <i class="fas fa-search-dollar"></i> Prieskumník predajov z databázy
                  </button>
              </div>
          `;
          window.openLeaderModal(html);
      } catch(e) {
          window.openLeaderModal(`<div class="error" style="padding:30px; text-align:center; color:#dc2626;">
              <i class="fas fa-exclamation-circle fa-3x" style="margin-bottom:15px;"></i><br><br>
              <strong style="font-size:1.2rem;">Chyba pri načítaní dát</strong><br>
              <span class="muted">${e.message}</span>
          </div>`); 
      }
  };

  // Zobrazenie histórie (simulácia erp_admin.js)
  window.showProductHistory = async function(ean) {
      window.openLeaderModal('<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam históriu pohybov...</div>');
      try {
          const logs = await apiRequest(`/api/leader/catalog/products/history?ean=${ean}`);
          let rowsHtml = logs.map(l => `
              <tr>
                  <td style="font-size:0.85rem;">${new Date(l.timestamp).toLocaleString('sk-SK')}</td>
                  <td style="font-weight:600;">${escapeHtml(l.action)}</td>
                  <td class="${l.change < 0 ? 'loss' : 'profit'}">${l.change > 0 ? '+' : ''}${l.change.toFixed(2)}</td>
                  <td>${escapeHtml(l.user || 'Systém')}</td>
                  <td class="muted" style="font-size:0.8rem;">${escapeHtml(l.note || '')}</td>
              </tr>
          `).join('');

          const html = `
              <h3 style="border-bottom:2px solid #eee; padding-bottom:10px;">🕒 História pohybu a zmien (EAN: ${ean})</h3>
              <div class="table-container" style="max-height:400px; overflow-y:auto; margin-bottom:15px;">
                  <table class="tbl" style="width:100%;">
                      <thead>
                          <tr><th>Dátum</th><th>Akcia</th><th>Zmena</th><th>Používateľ</th><th>Poznámka</th></tr>
                      </thead>
                      <tbody>${rowsHtml || '<tr><td colspan="5" class="text-center muted">Žiadne záznamy.</td></tr>'}</tbody>
                  </table>
              </div>
              <div style="text-align:right;"><button class="btn btn-secondary" onclick="window.closeLeaderModal()">Zatvoriť</button></div>
          `;
          window.openLeaderModal(html);
      } catch(e) { window.openLeaderModal(`<div class="error">Chyba: ${e.message}</div>`); }
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
        if (secId === 'leader-tv-board')   loadTvBoardSettings();
        
        // TUTO JE PRIDANÁ NAŠA FAKTURÁCIA
        if (secId === 'section-billing') {
            if (typeof window.initializeLeaderBillingModule === 'function') {
                window.initializeLeaderBillingModule();
            } else {
                showStatus('Fakturačný modul sa nenačítal. Skúste obnoviť stránku.', true);
            }
        }
        if (secId === 'leader-stock-cards') { window.loadLeaderProducts(); }
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

  initManualOrdersUI();
    initTvBoardUI();
    loadDashboard();
  }

  boot();
})(window, document);