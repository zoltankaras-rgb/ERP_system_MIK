// static/js/kancelaria_modules/orders.js
(() => {
  // ---------- Helpers ----------
  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.substring(2), v);
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }

  const api = {
    async get(u){
      const r = await fetch(u,{credentials:'same-origin'});
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async post(u,b){
      const r = await fetch(u,{
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(b), credentials:'same-origin'
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async put(u,b){
      const r = await fetch(u,{
        method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(b), credentials:'same-origin'
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async delete(u){
      const r = await fetch(u,{ method:"DELETE", credentials:'same-origin' });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }
  };

  const fmt   = (x) => (x==null||x==='') ? '' : (''+x);
  const today = ()=> new Date().toISOString().slice(0,10);
  const num   = (x) => (x === null || x === undefined || x === '' || isNaN(Number(x))) ? 0 : Number(x);
  const money = (x) => num(x).toFixed(2);

  // Formát dátumu: 03.12.2025 14:30
  const formatDate = (isoStr) => {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      
      return `${day}.${month}.${year} ${hours}:${minutes}`;
  };

  const pickEAN = (o) => {
    if (!o || typeof o !== 'object') return '';
    const candidates = ['ean', 'EAN', 'ean_code', 'ean_kod', 'ean13', 'barcode', 'kod_ean', 'kod'];
    for (const k of candidates) {
      const v = o[k];
      if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };

  // Helper na dvojité potvrdenie zmazania s RELOADOM
  async function deleteOrderWithConfirm(id) {
      if (!confirm("Naozaj chcete zmazať túto objednávku?")) return;
      if (!confirm("Určite? Táto akcia je nevratná.")) return;
      try {
          await api.delete(`/api/objednavky/${id}`);
          // Po zmazaní obnovíme celú stránku, aby zmizla zo všetkých zoznamov
          window.location.reload();
      } catch (e) {
          alert("Chyba pri mazaní: " + e.message);
      }
  }

  // ---------- UI state ----------
  let cart = [];
  let currentSupplier = { id:null, nazov:null };
  let ORDERS_CACHE = [];
  let SUP_CHOICES = null;

  async function ensureSupplierChoices(){
    if (SUP_CHOICES) return SUP_CHOICES;
    try {
      const r1 = await api.get('/api/objednavky/suppliers?only_vyroba=1');
      SUP_CHOICES = Array.isArray(r1?.suppliers) && r1.suppliers.length ? r1.suppliers : null;
    } catch(_){}
    if (!SUP_CHOICES){
      try{
        const r2 = await api.get('/api/objednavky/suppliers');
        SUP_CHOICES = r2?.suppliers || [];
      }catch(_){ SUP_CHOICES = []; }
    }
    return SUP_CHOICES;
  }

 // ----------------- 1. POD MINIMOM (S BALENÍM A SKRÝVANÍM OBJEDNANÝCH) -----------------
  async function viewUnderMin(container){
    container.innerHTML = '<h2>Sklad → Objednávky</h2><div class="text-muted">Načítavam položky pod minimom…</div>';

    let data;
    try { 
        // Volanie API
        data = await api.get('/api/sklad/under-min'); 
    }
    catch (e) { 
        container.innerHTML = `<div class="text-danger">Chyba: ${e.message}</div>`; 
        return; 
    }

    const itemsRaw = Array.isArray(data?.items) ? data.items : [];
    await ensureSupplierChoices();

    // Spracovanie dát
    const items = itemsRaw.map(raw => {
      const r = {...raw};
      r.nazov = r.nazov ?? r.name ?? '';
      
      // Detekcia BM (bežné metre pre obaly)
      const cat = (r.category || '').toLowerCase();
      if (cat.includes('obal') || cat.includes('črev') || cat.includes('crev')) {
          r.jednotka = 'bm';
      } else {
          r.jednotka = r.jednotka ?? r.unit ?? r.mj ?? 'kg';
      }

      r.qty      = (r.qty ?? r.mnozstvo ?? r.quantity ?? 0);
      r.min_qty  = (r.min_qty ?? r.min_mnozstvo ?? r.min_stav_kg ?? r.min_zasoba ?? 0);
      
      // Backend teraz posiela 'to_buy' už znížené o tovar na ceste (on_way).
      // Ak backend túto logiku nemá (neprebehol update orders_handler.py), r.to_buy môže byť null.
      if (r.to_buy == null) {
          r.to_buy = Math.max(num(r.min_qty) - num(r.qty), 0);
      }

      r.dodavatel_id   = r.dodavatel_id ?? r.supplier_id ?? null;
      r.dodavatel_nazov= r.dodavatel_nazov || r.supplier_name || (r.dodavatel_id ? `Dodávateľ #${r.dodavatel_id}` : 'Bez dodávateľa');
      
      // Balenie info (text napr. "0.5 kg")
      r.pack_info = raw.pack_info || '';

      return r;
    })
    // TOTO FILTROVANIE SKRYJE POLOŽKY, KTORÉ UŽ SÚ OBJEDNANÉ (ak to_buy <= 0)
    .filter(r => num(r.to_buy) > 0); 

    // Vykreslenie hlavičky stránky
    container.innerHTML = '';
    container.appendChild(el('h2',{},'Sklad → Objednávky'));

    const barTop = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:center;'},
      el('button',{class:'btn btn-secondary', onclick:()=>renderList(container)},'← Späť na zoznam'),
      el('button',{class:'btn btn-primary',   onclick:()=>renderNewOrder(container)},'Nová objednávka')
    );
    container.appendChild(barTop);

    if (!items.length){
      container.appendChild(el('div',{class:'stat-card',style:'margin-top:8px'},'Žiadne položky pod minimom (všetko je na sklade alebo už objednané).'));
      return;
    }

    // Zoskupenie podľa dodávateľov
    const groupsMap = new Map();
    const keyOf = (r) => {
      const id   = r.dodavatel_id ?? null;
      const name = (r.dodavatel_nazov || '').trim() || (id ? `Dodávateľ #${id}` : 'Bez dodávateľa');
      return `${id || ''}|${name}`;
    };

    for (const r of items){
      const k = keyOf(r);
      if (!groupsMap.has(k)){
        const [idStr, name] = k.split('|');
        groupsMap.set(k, { id: idStr? Number(idStr) : null, nazov: name, rows: [] });
      }
      groupsMap.get(k).rows.push(r);
    }

    const groups = Array.from(groupsMap.values()).sort((a,b)=> (a.nazov||'').localeCompare(b.nazov||'','sk'));

    // Vykreslenie kariet dodávateľov
    for (const g of groups){
      const card = el('div',{class:'stat-card',style:'margin:10px 0;'});
      
      // Hlavička skupiny (Dodávateľ)
      const titleRow = el('div',{style:'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;'});
      titleRow.appendChild(el('h3',{style:'margin:0;'}, g.nazov || 'Bez dodávateľa'));

      let supSel = null;
      if (!g.id){
        supSel = el('select',{style:'min-width:260px'});
        supSel.appendChild(el('option',{value:''},'— vyber dodávateľa —'));
        (SUP_CHOICES||[]).forEach(s => supSel.appendChild(el('option',{value:String(s.id??''), 'data-name': s.nazov||s.name||''}, s.nazov||s.name||'')));
        titleRow.appendChild(supSel);
      }

      const chkAll = el('input',{type:'checkbox'});
      const selectAllWrap = el('label', {style:'margin-left:auto;display:flex;gap:6px;align-items:center;'}, chkAll, document.createTextNode('Vybrať všetko'));
      titleRow.appendChild(selectAllWrap);

      const btnCreate = el('button',{class:'btn btn-success'}, `Vytvoriť návrh pre „${g.nazov}”`);
      titleRow.appendChild(btnCreate);
      card.appendChild(titleRow);

      const tbl = el('table',{class:'table',style:'width:100%; border-collapse:collapse;'});
      
      // --- HLAVIČKA TABUĽKY (11 stĺpcov) ---
      // Pridaný 5. stĺpec "Balenie"
      tbl.appendChild(el('thead',{}, el('tr',{},
        el('th',{},''),
        el('th',{},'#'),
        el('th',{},'EAN'),
        el('th',{},'Názov'),
        el('th',{},'Balenie'), // <--- TOTO SA MUSÍ ZOBRAZIŤ
        el('th',{},'Jedn.'),
        el('th',{},'Na sklade'),
        el('th',{},'Min'),
        el('th',{},'Navrhnúť'),
        el('th',{},'Cena'),
        el('th',{},'Posl.')
      )));
      const tb = el('tbody',{}); tbl.appendChild(tb);
      const rowRefs = [];

      // Riadky tabuľky
      g.rows.forEach((r,i)=>{
        const toBuy = num(r.to_buy);
        const cb   = el('input',{type:'checkbox', checked: toBuy > 0});
        const qty  = el('input',{type:'number', step:'0.001', value: toBuy.toFixed(3), style:'width:110px'});
        const initPrice = (r.last_price ?? r.price ?? r.default_price ?? '');
        const price = el('input',{type:'number', step:'0.0001', value: initPrice, style:'width:110px'});

        const btnLP = el('button',{class:'btn btn-secondary', onclick: async ()=>{
          try{
            let url;
            if (r.id!=null) url = `/api/objednavky/last-price?sklad_id=${r.id}`;
            else            url = `/api/objednavky/last-price?nazov=${encodeURIComponent(r.nazov)}`;
            const dodName = g.nazov || (supSel && supSel.options[supSel.selectedIndex]?.getAttribute('data-name')) || '';
            if (dodName) url += `&dodavatel_nazov=${encodeURIComponent(dodName)}`;
            const lp = await api.get(url);
            if (lp && lp.cena!=null) price.value = lp.cena;
          }catch(_){}
        }}, 'Posl. cena');

        // Badge pre Balenie
        const packBadge = r.pack_info 
            ? el('span', {
                style: 'background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.85em; white-space:nowrap; display:inline-block;'
              }, r.pack_info) 
            : document.createTextNode('');

        // Vykreslenie buniek (11 stĺpcov)
        tb.appendChild(el('tr',{},
          el('td',{}, cb),
          el('td',{}, String(i+1)),
          el('td',{style:'font-family: monospace; font-size: 0.9em; color:#555;'}, pickEAN(r)),
          el('td',{style:'font-weight:500'}, r.nazov),
          el('td',{}, packBadge), // <--- 5. BUNKA (Balenie)
          el('td',{}, r.jednotka || 'kg'),
          el('td',{}, fmt(r.qty)),
          el('td',{}, fmt(r.min_qty)),
          el('td',{}, qty),
          el('td',{}, price),
          el('td',{}, btnLP)
        ));
        rowRefs.push({ r, cb, qty, price });
      });

      chkAll.addEventListener('change', ()=> { rowRefs.forEach(ref => { ref.cb.checked = chkAll.checked; }); });

      // Akcia pre vytvorenie objednávky
      btnCreate.addEventListener('click', async ()=>{
        let supId = g.id, supName = g.nazov;
        if (!supId && supSel){
          const opt = supSel.options[supSel.selectedIndex];
          supId   = opt && opt.value ? Number(opt.value) : null;
          supName = (opt && opt.getAttribute('data-name')) || supName;
        }
        if (!supId && !supName){ alert('Vyber dodávateľa pre túto skupinu.'); return; }

        const polozky = [];
        for (const ref of rowRefs){
          if (!ref.cb.checked) continue;
          const q = parseFloat(ref.qty.value||0);
          if (!(q > 0)) continue;
          polozky.push({
            sklad_id: ref.r.id ?? null,
            nazov: ref.r.nazov,
            jednotka: ref.r.jednotka || 'kg',
            mnozstvo: q,
            cena_predpoklad: (ref.price.value==='' ? null : parseFloat(ref.price.value||0))
          });
        }
        if (!polozky.length){ alert('Vyber aspoň jednu položku.'); return; }

        try{
          const body = { dodavatel_id: supId ?? null, dodavatel_nazov: supName || null, datum_objednania: today(), polozky };
          const res = await api.post('/api/objednavky', body);
          alert(`Návrh objednávky vytvorený${res.cislo ? `: ${res.cislo}` : ''}.`);
          
          // Obnoviť zoznam (položky by mali zmiznúť, ak ich backend započíta ako "on_way")
          viewUnderMin(container);
        }catch(e){ alert(`Chyba: ${e.message}`); }
      });

      card.appendChild(tbl);
      container.appendChild(card);
    }
  }
  // ----------------- 2. ZOZNAM OBJEDNÁVOK (S MAZANÍM A DÁTUMOM) -----------------
  async function renderList(container){
    container.innerHTML = '<h2>Objednávky</h2><div class="text-muted">Načítavam…</div>';
    let data, sup;
    try {
      [data, sup] = await Promise.all([
        api.get('/api/objednavky'),
        api.get('/api/objednavky/suppliers').catch(()=>({suppliers:[]}))]);
    } catch (e) { container.innerHTML = `<div class="text-danger">Chyba: ${e.message}</div>`; return; }
    const suppliers = (sup?.suppliers||[]).map(s => ({ id: s.id ?? null, nazov: s.nazov || '' }));
    ORDERS_CACHE = Array.isArray(data?.orders) ? data.orders : [];

    container.innerHTML = '';
    container.appendChild(el('h2',{},'Sklad → Objednávky'));

    const btnUnderMin = el('button',{class:'btn btn-secondary', onclick:()=>viewUnderMin(container)},'Pod minimom (podľa dodávateľov)');
    const btnNew      = el('button',{class:'btn btn-primary',   onclick:()=>renderNewOrder(container)},'Nová objednávka');
    const btnHistory  = el('button',{class:'btn btn-secondary', onclick:()=>renderSupplierHistory(container)},'História podľa dodávateľov');

    const barTop = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:end;'});
    barTop.appendChild(btnUnderMin);
    barTop.appendChild(btnNew);
    barTop.appendChild(btnHistory);
    container.appendChild(barTop);

    const statusSel = el('select', {style:'min-width:160px'});
    statusSel.appendChild(el('option',{value:'objednane'},'Neprijaté (objednané)'));
    statusSel.appendChild(el('option',{value:'prijate'},'Prijaté'));
    statusSel.appendChild(el('option',{value:''},'Všetky stavy'));

    const supSel = el('select', {style:'min-width:220px'});
    supSel.appendChild(el('option',{value:''},'Všetci dodávatelia'));
    suppliers.forEach(s => supSel.appendChild(el('option',{value:s.nazov, 'data-id': s.id??''}, s.nazov)));

    const dateFrom = el('input',{type:'date'});
    const dateTo   = el('input',{type:'date'});
    const search   = el('input',{type:'search', placeholder:'Hľadať číslo/dodávateľa…', style:'min-width:220px'});

    const btnReset = el('button',{class:'btn btn-secondary', onclick:()=>{
      statusSel.value = 'objednane'; supSel.value = ''; dateFrom.value = ''; dateTo.value = ''; search.value = '';
      renderTable();
    }}, 'Reset filtrov');

    const filters = el('div',{class:'stat-card', style:'padding:8px;display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:8px;align-items:end;'},
      el('div',{}, el('label',{},'Stav'), statusSel),
      el('div',{}, el('label',{},'Dodávateľ'), supSel),
      el('div',{}, el('label',{},'Dátum od'), dateFrom),
      el('div',{}, el('label',{},'Dátum do'), dateTo),
      el('div',{}, el('label',{},'Hľadať'), search),
      el('div',{}, btnReset)
    );
    container.appendChild(filters);

    const tbl = el('table',{class:'table',style:'width:100%; border-collapse:collapse; margin-top:10px'});
    tbl.appendChild(el('thead',{}, el('tr',{},
      el('th',{},'#'),
      el('th',{},'Číslo'),
      el('th',{},'Dodávateľ'),
      el('th',{},'Dátum (Vytvorené)'),
      el('th',{},'Stav'),
      el('th',{},'Suma (predp.)'),
      el('th',{},'Akcie')
    )));
    const tb = el('tbody',{}); tbl.appendChild(tb);
    container.appendChild(tbl);

    statusSel.value = 'objednane';

    const passes = (o)=>{
      if (statusSel.value && String(o.stav) !== statusSel.value) return false;
      if (supSel.value) {
        const name = (o.dodavatel_nazov||'').trim();
        if (name !== supSel.value) return false;
      }
      if (dateFrom.value && (!o.datum_objednania || o.datum_objednania < dateFrom.value)) return false;
      if (dateTo.value   && (!o.datum_objednania || o.datum_objednania > dateTo.value)) return false;
      const q = search.value.trim().toLowerCase();
      if (q) {
        const hay = ((o.cislo||'')+' '+(o.dodavatel_nazov||'')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };

    function renderTable(){
      tb.innerHTML = '';
      const orders = (ORDERS_CACHE||[]).filter(passes);
      if (!orders.length){
        tb.appendChild(el('tr',{}, el('td',{colspan:'7'}, 'Žiadne objednávky pre zvolené filtre.')));
        return;
      }
      orders.forEach((o,i)=>{
        const btnOpen  = el('button',{class:'btn btn-secondary', onclick:()=>renderDetail(container,o.id)},'Otvoriť');
        const btnPrint = el('button',{class:'btn btn-secondary', onclick:()=>window.open(`/kancelaria/objednavky/print/${o.id}`,'_blank')},'Tlačiť');
        const btnRecv  = o.stav==='objednane' ? el('button',{class:'btn btn-success', onclick:()=>renderReceive(container,o.id)},'Prijať') : el('span', {class:'text-muted'}, '✓');
        
        // TLAČIDLO ZMAZAŤ
        const btnDel = el('button',{class:'btn btn-danger', title:'Zmazať', onclick:()=>deleteOrderWithConfirm(o.id)}, el('i',{class:'fas fa-trash'}));

        // DÁTUM
        const dateDisplay = formatDate(o.real_created || o.created_at || o.datum_objednania);

        tb.appendChild(el('tr',{},
          el('td',{}, String(i+1)),
          el('td',{}, o.cislo),
          el('td',{}, o.dodavatel_nazov || ''),
          el('td',{}, dateDisplay),
          el('td',{}, o.stav),
          el('td',{}, money(o.suma_predpoklad)),
          el('td',{}, el('div',{style:'display:flex;gap:4px;'}, btnOpen, btnPrint, btnRecv, btnDel))
        ));
      });
    }

    [statusSel, supSel, dateFrom, dateTo, search].forEach(ctrl=> ctrl.addEventListener('change', renderTable));
    search.addEventListener('input', ()=> { clearTimeout(search._t); search._t=setTimeout(renderTable, 200); });
    renderTable();
  }

  // ----------------- 3. HISTÓRIA (S ZMAZANÍM) -----------------
  async function renderSupplierHistory(container){
    container.innerHTML = '<h2>História objednávok podľa dodávateľov</h2><div class="text-muted">Načítavam…</div>';
    let data, sup;
    try {
      [data, sup] = await Promise.all([
        api.get('/api/objednavky'),
        api.get('/api/objednavky/suppliers').catch(()=>({suppliers:[]}))]);
    } catch (e) { container.innerHTML = `<div class="text-danger">Chyba: ${e.message}</div>`; return; }
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    const suppliers = (sup?.suppliers||[]).map(s => ({ id: s.id ?? null, nazov: s.nazov || '' }));
    const supplierNames = [...new Set(orders.map(o => (o.dodavatel_nazov||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'sk'));

    container.innerHTML = '';
    container.appendChild(el('div',{}, 
      el('button',{class:'btn btn-secondary', onclick:()=>renderList(container)},'← Späť na zoznam')
    ));
    container.appendChild(el('h2',{},'História objednávok podľa dodávateľov'));

    const selSup = el('select',{style:'min-width:260px'});
    selSup.appendChild(el('option',{value:''},'— Vyber dodávateľa —'));
    (supplierNames.length? supplierNames : suppliers.map(s=>s.nazov)).forEach(n=> selSup.appendChild(el('option',{value:n}, n)));

    const statusSel = el('select',{style:'min-width:160px'});
    statusSel.appendChild(el('option',{value:''},'Všetky stavy'));
    statusSel.appendChild(el('option',{value:'objednane'},'Neprijaté (objednané)'));
    statusSel.appendChild(el('option',{value:'prijate'},'Prijaté'));

    const dateFrom = el('input',{type:'date'});
    const dateTo   = el('input',{type:'date'});

    const bar = el('div',{class:'stat-card', style:'padding:8px;display:grid;grid-template-columns:repeat(5,minmax(160px,1fr));gap:8px;align-items:end;'},
      el('div',{}, el('label',{},'Dodávateľ'), selSup),
      el('div',{}, el('label',{},'Stav'), statusSel),
      el('div',{}, el('label',{},'Dátum od'), dateFrom),
      el('div',{}, el('label',{},'Dátum do'), dateTo),
      el('div',{}, el('button',{class:'btn btn-secondary', onclick:()=>{ selSup.value=''; statusSel.value=''; dateFrom.value=''; dateTo.value=''; render(); }},'Reset'))
    );
    container.appendChild(bar);

    const sumBox = el('div',{class:'stat-card', style:'margin:8px 0; display:flex; gap:12px; flex-wrap:wrap;'});
    const tblWrap = el('div',{class:'table-container'});
    container.appendChild(sumBox);
    container.appendChild(tblWrap);

    function render(){
      const supName = selSup.value || '';
      let rows = orders.slice();
      if (supName) rows = rows.filter(o => (o.dodavatel_nazov||'').trim() === supName);
      if (statusSel.value) rows = rows.filter(o => o.stav === statusSel.value);
      if (dateFrom.value) rows = rows.filter(o => o.datum_objednania && o.datum_objednania >= dateFrom.value);
      if (dateTo.value)   rows = rows.filter(o => o.datum_objednania && o.datum_objednania <= dateTo.value);

      const count = rows.length;
      const sumPred = rows.reduce((s,o)=> s + num(o.suma_predpoklad), 0);
      sumBox.innerHTML = `
        <div class="dash-card" style="min-width:200px;"><div class="dash-card-label">Počet objednávok</div><div class="dash-card-value">${count}</div></div>
        <div class="dash-card" style="min-width:200px;"><div class="dash-card-label">Suma (predpoklad)</div><div class="dash-card-value">${sumPred.toFixed(2)} €</div></div>
      `;

      const t = el('table',{class:'table', style:'width:100%; border-collapse:collapse; margin-top:6px'});
      t.appendChild(el('thead',{}, el('tr',{}, 
        el('th',{},'#'),
        el('th',{},'Číslo'),
        el('th',{},'Dodávateľ'),
        el('th',{},'Dátum'),
        el('th',{},'Stav'),
        el('th',{},'Suma (predp.)'),
        el('th',{},'Akcie')
      )));
      const tb = el('tbody',{}); t.appendChild(tb);
      if (!rows.length){
        tb.appendChild(el('tr',{}, el('td',{colspan:'7'}, 'Žiadne záznamy.')));
      } else {
        rows.sort((a,b)=> String(a.datum_objednania||'').localeCompare(String(b.datum_objednania||'')));
        rows.forEach((o,i)=>{
          const btnOpen  = el('button',{class:'btn btn-secondary', onclick:()=>renderDetail(container,o.id)},'Otvoriť');
          const btnPrint = el('button',{class:'btn btn-secondary', onclick:()=>window.open(`/kancelaria/objednavky/print/${o.id}`,'_blank')},'Tlačiť');
          
          // TLAČIDLO ZMAZAŤ
          const btnDel = el('button',{class:'btn btn-danger', title:'Zmazať', onclick:()=>deleteOrderWithConfirm(o.id)}, el('i',{class:'fas fa-trash'}));

          // DÁTUM
          const dateDisplay = formatDate(o.real_created || o.created_at || o.datum_objednania);

          tb.appendChild(el('tr',{},
            el('td',{}, String(i+1)),
            el('td',{}, o.cislo),
            el('td',{}, o.dodavatel_nazov || ''),
            el('td',{}, dateDisplay),
            el('td',{}, o.stav),
            el('td',{}, money(o.suma_predpoklad)),
            el('td',{}, el('div',{style:'display:flex;gap:4px;'}, btnOpen, btnPrint, btnDel))
          ));
        });
      }
      tblWrap.innerHTML = '';
      tblWrap.appendChild(t);
    }

    [selSup, statusSel, dateFrom, dateTo].forEach(c=> c.addEventListener('change', render));
    render();
  }

  // ----------------- 4. NOVÁ OBJEDNÁVKA (S BALENÍM) -----------------
  async function renderNewOrder(container){
    container.innerHTML = '';
    container.appendChild(el('h2',{}, 'Nová objednávka'));

    let suppliers = [];
    try{
      const r1 = await api.get('/api/objednavky/suppliers?only_vyroba=1');
      suppliers = r1.suppliers || [];
      if (!suppliers.length){
        const r2 = await api.get('/api/objednavky/suppliers');
        suppliers = r2.suppliers || [];
      }
    }catch(e){}

    const sel = el('select', {style:'min-width:320px; margin-right:8px'});
    if (!suppliers.length) sel.appendChild(el('option', {value:''}, '— žiadny dodávateľ —'));
    suppliers.forEach(s => sel.appendChild(el('option', {value: s.nazov, 'data-id': s.id??''}, s.nazov)));
    const inpDate = el('input', {type:'date', value: today(), style:'margin-left:10px'});

    const header = el('div', {style:'margin:8px 0'},
      el('label',{},'Dodávateľ: '), sel,
      el('label',{style:'margin-left:12px'},'Dátum: '), inpDate
    );
    container.appendChild(header);

    if (suppliers.length) currentSupplier = { id: suppliers[0].id ?? null, nazov: suppliers[0].nazov };
    else currentSupplier = { id:null, nazov:null };

    sel.addEventListener('change', ()=>{
      const idAttr = sel.options[sel.selectedIndex]?.getAttribute('data-id');
      currentSupplier = { id: idAttr ? Number(idAttr) : null, nazov: sel.value || null };
      loadItems();
    });

    const search = el('input', {type:'search', placeholder:'Hľadať…', style:'min-width:260px; margin-bottom:8px'});
    const itemsWrap = el('div');
    container.appendChild(search);
    container.appendChild(itemsWrap);

    let searchTimer = null;
    search.addEventListener('input', ()=>{
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadItems, 250);
    });

    async function loadItems(){
      itemsWrap.innerHTML = '<div class="text-muted">Načítavam položky…</div>';
      const params = new URLSearchParams();
      if (currentSupplier.id)    params.set('dodavatel_id', currentSupplier.id);
      else if (currentSupplier.nazov) params.set('dodavatel_nazov', currentSupplier.nazov);
      if (search.value.trim())   params.set('q', search.value.trim());

      try{
        const res = await api.get(`/api/objednavky/items?${params.toString()}`);
        const items = res.items||[];

        if (!items.length){
          itemsWrap.innerHTML = '<div class="text-muted">Žiadne položky pre zadané filtre.</div>';
          return;
        }

        const tbl = el('table', {class:'table', style:'width:100%; border-collapse:collapse; margin-top:4px'});
        tbl.appendChild(el('thead',{}, el('tr',{},
          el('th',{},'#'),
          el('th',{},'EAN'),
          el('th',{},'Názov'),
          el('th',{},'Balenie'), // STĹPEC
          el('th',{},'Jedn.'),
          el('th',{},'Cena (posl./def.)'),
          el('th',{},'Množstvo'),
          el('th',{},'')
        )));
        const tb = el('tbody',{}); tbl.appendChild(tb);

        items.forEach((r,i)=>{
          const qty = el('input',{type:'number', step:'0.001', value:'1.000', style:'width:110px'});
          const initialPrice = (r.last_price ?? r.default_price) ?? '';
          const price = el('input',{type:'number', step:'0.0001', value: initialPrice, style:'width:110px'});

          const btnAdd = el('button',{class:'btn btn-secondary', onclick: async ()=>{
            try{
              let url;
              if (r.id!=null) url = `/api/objednavky/last-price?sklad_id=${r.id}`;
              else            url = `/api/objednavky/last-price?nazov=${encodeURIComponent(r.nazov)}`;
              if (currentSupplier.nazov) url += `&dodavatel_nazov=${encodeURIComponent(currentSupplier.nazov)}`;
              const lp = await api.get(url);
              if (lp && lp.cena!=null) price.value = lp.cena;
            }catch(e){}

            const qtyInStock = num(r.qty ?? r.sklad_qty ?? r.mnozstvo_skladu ?? r.quantity ?? 0);
            const minQty     = num(r.min_qty ?? r.min_mnozstvo ?? r.min_stav_kg ?? r.min_zasoba ?? 0);
            const sugg       = Math.max(minQty - qtyInStock, 0);

            cart.push({
              sklad_id: r.id ?? null,
              nazov: r.nazov,
              jednotka: r.jednotka || 'kg',
              mnozstvo: parseFloat(qty.value || 0),
              cena_predpoklad: price.value==='' ? null : parseFloat(price.value || 0),
              sklad_qty: qtyInStock,
              min_qty: minQty,
              navrh_nakupu: sugg
            });
            redrawCart();
          }}, 'Pridať');

          // Balenie
          const packBadge = r.pack_info 
            ? el('span', {class:'badge', style:'background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.85em;'}, r.pack_info) 
            : document.createTextNode('');

          tb.appendChild(el('tr',{},
            el('td',{}, String(i+1)),
            el('td',{style:'font-family: monospace;'}, pickEAN(r)),
            el('td',{}, r.nazov),
            el('td',{}, packBadge),
            el('td',{}, r.jednotka || 'kg'),
            el('td',{}, price),
            el('td',{}, qty),
            el('td',{}, btnAdd)
          ));
        });

        itemsWrap.innerHTML = '';
        itemsWrap.appendChild(tbl);
      }catch(e){
        itemsWrap.innerHTML = `<div class="text-danger">Chyba: ${e.message}</div>`;
      }
    }
    await loadItems();

    const cartTitle = el('h3', {style:'margin-top:10px'}, 'Položky objednávky');
    const cartTbl = el('table', {class:'table', style:'width:100%; border-collapse:collapse; margin-top:6px'});
    cartTbl.appendChild(el('thead',{}, el('tr',{},
      el('th',{},'#'),
      el('th',{},'Názov'),
      el('th',{},'Jedn.'),
      el('th',{},'Min (kg)'),
      el('th',{},'Sklad (kg)'),
      el('th',{},'Návrh nákupu'),
      el('th',{},'Množstvo'),
      el('th',{},'Cena/1 (predp.)'),
      el('th',{},'')
    )));
    const cartBody = el('tbody',{}); cartTbl.appendChild(cartBody);

    function redrawCart(){
      const show3 = (v) => (v === null || v === undefined) ? '' : num(v).toFixed(3);
      cartBody.innerHTML = '';
      cart.forEach((r,i)=>{
        const q = el('input',{type:'number', step:'0.001', value:r.mnozstvo||0, style:'width:110px'});
        const c = el('input',{type:'number', step:'0.0001', value:r.cena_predpoklad ?? '', style:'width:110px'});
        const u = el('input',{type:'text',   value:r.jednotka||'kg', style:'width:80px'});
        const d = el('button',{class:'btn btn-secondary', onclick:()=>{ cart.splice(i,1); redrawCart(); }},'Odobrať');
        q.addEventListener('change', ()=> r.mnozstvo        = parseFloat(q.value||0));
        c.addEventListener('change', ()=> r.cena_predpoklad = c.value===''? null : parseFloat(c.value||0));
        u.addEventListener('change', ()=> r.jednotka        = u.value||'kg');
        cartBody.appendChild(el('tr',{},
          el('td',{}, String(i+1)),
          el('td',{}, r.nazov),
          el('td',{}, u),
          el('td',{}, show3(r.min_qty)),
          el('td',{}, show3(r.sklad_qty)),
          el('td',{}, show3(r.navrh_nakupu)),
          el('td',{}, q),
          el('td',{}, c),
          el('td',{}, d)
        ));
      });
    }
    redrawCart();

    const btnSave = el('button',{class:'btn btn-primary', style:'margin-top:10px', onclick: async ()=>{
      const chosen = sel.value;
      if (!chosen){ alert('Vyber dodávateľa'); return; }
      if (cart.length===0){ alert('Košík je prázdny'); return; }
      const dod_id_attr = sel.options[sel.selectedIndex]?.getAttribute('data-id') || null;
      const body = {
        dodavatel_id: dod_id_attr ? Number(dod_id_attr) : null,
        dodavatel_nazov: chosen,
        datum_objednania: inpDate.value || today(),
        polozky: cart.map(r => ({
          sklad_id: r.sklad_id,
          nazov: r.nazov,
          jednotka: r.jednotka,
          mnozstvo: r.mnozstvo,
          cena_predpoklad: r.cena_predpoklad
        }))
      };
      try{
        const res = await api.post('/api/objednavky', body);
        alert(`Objednávka vytvorená: ${res.cislo}`);
        cart = [];
        renderList(container);
      }catch(e){
        alert(`Chyba pri ukladaní: ${e.message}`);
      }
    }}, 'Uložiť (Objednať)');

    container.appendChild(cartTitle);
    container.appendChild(cartTbl);
    container.appendChild(btnSave);
  }

  async function renderDetail(container, id){
    const d = await api.get(`/api/objednavky/${id}`);
    const o = d.order, p = d.items||[];
    container.innerHTML = '';
    container.appendChild(el('div',{},
      el('button',{class:'btn btn-secondary', onclick:()=>renderList(container)}, 'Späť'),
      ' ',
      el('button',{class:'btn btn-secondary', onclick:()=>window.open(`/kancelaria/objednavky/print/${o.id}`,'_blank')}, 'Tlačiť')
    ));
    container.appendChild(el('h2',{}, `Objednávka ${o.cislo} (${o.stav})`));
    const tbl = el('table',{class:'table', style:'width:100%; border-collapse:collapse; margin-top:6px'});
    tbl.appendChild(el('thead',{}, el('tr',{},
      el('th',{},'#'),
      el('th',{},'Názov'),
      el('th',{},'Jedn.'),
      el('th',{},'Množstvo (obj.)'),
      el('th',{}, o.stav==='prijate'?'Cena/1 (skutočná)':'Cena/1 (predp.)')
    )));
    const tb = el('tbody',{}); tbl.appendChild(tb);
    p.forEach((r,i)=> tb.appendChild(el('tr',{},
      el('td',{}, String(i+1)),
      el('td',{}, r.nazov_suroviny),
      el('td',{}, r.jednotka||'kg'),
      el('td',{}, fmt(r.mnozstvo_ordered)),
      el('td',{}, fmt(o.stav==='prijate'?r.cena_skutocna:r.cena_predpoklad))
    )));
    container.appendChild(tbl);
    if (o.stav==='objednane') {
      container.appendChild(el('button',{class:'btn btn-success', style:'margin-top:10px', onclick:()=>renderReceive(container,id)},'Prijať dodávku'));
    }
  }

  async function renderReceive(container, id){
    const d = await api.get(`/api/objednavky/${id}`);
    const o = d.order, p = d.items||[];
    container.innerHTML = '';
    container.appendChild(el('h2',{}, `Príjem tovaru – ${o.cislo}`));
    const inpDate = el('input',{type:'date', value: today()});
    const tbl = el('table',{class:'table', style:'width:100%; border-collapse:collapse; margin-top:6px'});
    tbl.appendChild(el('thead',{}, el('tr',{},
      el('th',{},'#'),
      el('th',{},'Názov'),
      el('th',{},'Jedn.'),
      el('th',{},'Dodané'),
      el('th',{},'Cena/1 (skutočná)')
    )));
    const tb = el('tbody',{}); tbl.appendChild(tb);
    const payload = [];
    p.forEach((r,i)=>{
      const q = el('input',{type:'number', step:'0.001', value:r.mnozstvo_ordered||0, style:'width:110px'});
      const c = el('input',{type:'number', step:'0.0001', value:r.cena_predpoklad??'', style:'width:110px'});
      payload.push({polozka_id:r.id, mnozstvo_dodane: parseFloat(q.value||0), cena_skutocna: c.value===''? null : parseFloat(c.value||0)});
      q.addEventListener('change', ()=> payload[i].mnozstvo_dodane = parseFloat(q.value||0));
      c.addEventListener('change', ()=> payload[i].cena_skutocna   = c.value===''? null : parseFloat(c.value||0));
      tb.appendChild(el('tr',{},
        el('td',{}, String(i+1)),
        el('td',{}, r.nazov_suroviny),
        el('td',{}, r.jednotka||'kg'),
        el('td',{}, q),
        el('td',{}, c)
      ));
    });
    const btn = el('button',{class:'btn btn-primary', style:'margin-top:10px', onclick: async ()=>{
      await api.put(`/api/objednavky/${id}/receive`, {datum_dodania: inpDate.value||today(), polozky: payload});
      alert('Prijaté a naskladnené.');
      renderDetail(container, id);
    }}, 'Uložiť príjem');
    container.appendChild(el('div',{}, el('label',{},'Dátum dodania: '), inpDate));
    container.appendChild(tbl);
    container.appendChild(btn);
  }

  // ---------- Napojenie na sekciu v menu ----------
  function wireOrdersSection() {
    const link = document.querySelector('.sidebar-link[data-section="section-orders"]');
    if (!link) return;
    link.addEventListener('click', () => {
      setTimeout(() => {
        const sec = document.getElementById('section-orders');
        if (sec) renderList(sec); // default: zoznam objednávok (len "objednane")
      }, 0);
    });
    const sec = document.getElementById('section-orders');
    if (sec && (sec.classList.contains('active') || sec.style.display === 'block')) {
      renderList(sec);
    }
  }

  document.addEventListener('DOMContentLoaded', wireOrdersSection);

  // pre manuálne volanie z konzoly
  window.skladObjednavky = {
    renderList,
    renderNewOrder,
    viewUnderMin,
    renderDetail,
    renderReceive,
    renderSupplierHistory
  };
})();