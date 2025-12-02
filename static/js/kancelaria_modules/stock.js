// /static/js/kancelaria_modules/stock.js
// =====================================
// Modul SKLAD pre kancelaria.html – inline pohľady (bez modálov)
// - Suroviny (výrobný sklad) – 1 stĺpec „Sklad (kg)” + plná editácia karty
// - Celkový prehľad (predajná kategória) – centrál
// - Výrobný príjem (viac riadkov; Mäso = Zdroj, ostatné = Dodávateľ)
// - ➕ Pridať položku do výroby (EAN, názov, počiatočná cena a množstvo,
//     minimálna zásoba v KG + balenie)
// - ➕ Nový dodávateľ (CRUD)
// =====================================
;(function (window, document) {
  'use strict';

  // ------------- helpers -------------
  async function apiRequest(url, method = "GET", body = null) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = isJson ? (data?.error || JSON.stringify(data)) : String(data);
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return data;
  }
  const qs  = (sel, root=document) => root.querySelector(sel);
  const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const el  = (html) => { const t=document.createElement("template"); t.innerHTML=html.trim(); return t.content.firstElementChild; };
  const fmt   = (n, d=2) => Number.isFinite(+n) ? (+n).toFixed(d) : "0.00";
  const txt   = (v) => (v ?? "").toString();
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  // univerzálny parser na desatinné čísla – zvládne "22,55", "22.55", medzery atď.
  function parseAmount(v, decimals) {
    if (v == null) return null;
    let s = String(v).trim();
    if (!s) return null;
    s = s.replace(/\s+/g, '').replace(',', '.');
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    if (typeof decimals === 'number' && decimals >= 0) {
      const factor = Math.pow(10, decimals);
      return Math.round(n * factor) / factor;
    }
    return n;
  }

  function mountInSectionStock(node){
    const host = document.getElementById("section-stock");
    if (!host) return;
    host.innerHTML = "";
    host.appendChild(node);
    document.querySelectorAll(".content-section").forEach(n => n.style.display = "none");
    host.style.display = "block";
  }

  function confirmTwice(msg1, msg2){
    if (!confirm(msg1)) return false;
    return confirm(msg2);
  }

  // --- Autocomplete (names) ---
  function ensureAutocompleteStyles(){
    if (document.getElementById('ac-styles')) return;
    const style = el(`<style id="ac-styles">
      .ac-panel{position:absolute;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:.5rem;box-shadow:0 10px 30px rgba(0,0,0,.12);max-height:260px;overflow:auto;min-width:240px;}
      .ac-item{padding:.5rem .75rem;cursor:pointer;white-space:nowrap;}
      .ac-item.active,.ac-item:hover{background:#f3f4f6;}
    </style>`);
    document.head.appendChild(style);
  }
  function attachAutocomplete(input, items, onPick){
    ensureAutocompleteStyles();
    let panel = null, results = [], index = -1;
    function close(){ if (panel){ panel.remove(); panel = null; index = -1; } }
    function position(){
      if (!panel) return;
      const r = input.getBoundingClientRect();
      panel.style.left = (window.scrollX + r.left) + "px";
      panel.style.top  = (window.scrollY + r.bottom + 4) + "px";
      panel.style.width= r.width + "px";
    }
    function open(){
      if (panel) panel.remove();
      panel = el(`<div class="ac-panel" role="listbox"></div>`);
      document.body.appendChild(panel);
      position();
      panel.addEventListener('click', (ev)=>{
        const it = ev.target.closest('.ac-item');
        if (it){ const i = +it.dataset.i; pick(results[i]); }
      });
    }
    function render(){
      if (!panel) open();
      const q = (input.value || '').trim().toLowerCase();
      results = (items || []).filter(n => n.toLowerCase().includes(q)).slice(0, 200);
      panel.innerHTML = results.map((n,i)=>`<div class="ac-item" data-i="${i}">${n}</div>`).join("");
      index = -1;
    }
    function highlight(){
      if (!panel) return;
      Array.from(panel.children).forEach((ch,i)=> ch.classList.toggle('active', i===index));
      if (index >= 0){
        const it = panel.children[index];
        const top = it.offsetTop, h = panel.clientHeight, st = panel.scrollTop;
        if (top < st) panel.scrollTop = top;
        else if (top > st + h - it.offsetHeight) panel.scrollTop = top - h + it.offsetHeight;
      }
    }
    function pick(name){
      if (typeof name !== 'string') return;
      input.value = name;
      if (typeof onPick === 'function') Promise.resolve(onPick(name));
      close();
    }
    input.addEventListener('focus', ()=>{ open(); render(); });
    input.addEventListener('input', render);
    window.addEventListener('resize', position);
    input.addEventListener('keydown', (e)=>{
      if (!panel) return;
      if (e.key === 'ArrowDown'){ e.preventDefault(); index = Math.min(index + 1, results.length - 1); highlight(); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); index = Math.max(index - 1, 0); highlight(); }
      else if (e.key === 'Enter'){ if (index >= 0){ e.preventDefault(); pick(results[index]); } }
      else if (e.key === 'Escape'){ close(); }
    });
    document.addEventListener('click', (e)=>{ if (panel && !panel.contains(e.target) && e.target !== input) close(); });
  }

  // numeric sanitizer – necháme ho tam, kde chceme okamžité „čistenie“
  function attachNumericSanitizer(input, decimals=3){
    input.addEventListener('wheel', (e)=>{ e.preventDefault(); input.blur(); }, { passive:false });
    input.addEventListener('input', ()=>{
      let v = (input.value || '').replace(',', '.');
      v = v.replace(/[^0-9.]/g, '');
      const parts = v.split('.');
      if (parts.length > 2){ v = parts.shift() + '.' + parts.join(''); }
      if (decimals >= 0 && v.includes('.')){
        const [a,b] = v.split('.');
        v = a + '.' + b.slice(0, decimals);
      }
      input.value = v;
    });
  }

  // ------------- shell (header bar) -------------
  function makeShell(){
    const node = el(`
      <div class="stock-shell">
        <h3><i class="fas fa-warehouse"></i> Sklad</h3>
        <div class="btn-grid" style="margin-bottom:1rem;">
          <button id="btn-stock-raw"    class="btn-secondary"><i class="fa-solid fa-boxes-stacked"></i> Suroviny (výrobný sklad)</button>
          <button id="btn-stock-prods"  class="btn-secondary"><i class="fa-solid fa-layer-group"></i> Celkový prehľad (podľa predajnej kategórie)</button>
          <button id="btn-stock-intake" class="btn-secondary"><i class="fa-solid fa-truck-ramp-box"></i> Výrobný príjem (viac položiek)</button>
          
          <button id="btn-stock-rozrabka" class="btn-secondary" style="border:1px solid #16a34a; color:#166534;">
            <i class="fa-solid fa-file-import"></i> Import z Rozrábky
          </button>

          <button id="btn-stock-additem" class="btn-secondary"><i class="fa-solid fa-plus"></i> Pridať položku do výrobného skladu</button>
          <button id="btn-stock-suppliers" class="btn-secondary"><i class="fa-solid fa-user-tie"></i> Nový dodávateľ</button>
          
          <span style="display:flex;gap:.5rem;align-items:center;margin-left:auto;">
            <input id="stock-search" type="text" class="input" placeholder="Hľadať názov/kategóriu…" style="max-width:280px;">
            <button id="btn-stock-refresh" class="btn-info"><i class="fa-solid fa-rotate"></i> Obnoviť</button>
          </span>
        </div>
        <div id="stock-body"></div>
      </div>
    `);

    // Listeners pre navigačné tlačidlá
    qs("#btn-stock-raw", node).addEventListener("click", () => renderRaw(node));
    qs("#btn-stock-prods", node).addEventListener("click", () => renderProducts(node));
    qs("#btn-stock-intake", node).addEventListener("click", () => renderIntake(node));
    
    // Listener pre nové tlačidlo
    qs("#btn-stock-rozrabka", node).addEventListener("click", () => renderRozrabkaImport(node));

    qs("#btn-stock-additem", node).addEventListener("click", () => renderAddItem(node));
    qs("#btn-stock-suppliers", node).addEventListener("click", () => renderSuppliers(node));

    // Listener pre tlačidlo Obnoviť (Refresh)
    qs("#btn-stock-refresh", node).addEventListener("click", () => {
      const v = qs("#stock-body [data-view]", node)?.getAttribute("data-view");
      
      if (v === "products") renderProducts(node);
      else if (v === "intake") renderIntake(node);
      else if (v === "rozrabka") renderRozrabkaImport(node); // <--- Pridané pre obnovenie rozrábky
      else if (v === "add") renderAddItem(node);
      else if (v === "suppliers") renderSuppliers(node);
      else renderRaw(node);
    });

    return node;
  }

  function loading(){ return el(`<div class="stat-card"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam…</div>`); }
  function empty(msg="Žiadne dáta"){ return el(`<div class="stat-card">${txt(msg)}</div>`); }

  // ---------- Allowed names / prices pre intake ----------
  async function ensureDatalist(shell, category){
    const id = 'rm-name-dl';
    const old = document.getElementById(id); if (old) old.remove();

    shell.__allowedNames = []; shell.__allowedLower = new Set(); shell.__lastPriceMap = new Map();

    try{
      let url = "/api/kancelaria/stock/allowed-names";
      if (category) url += `?category=${encodeURIComponent(category)}`;
      const resp = await apiRequest(url);

      const items = Array.isArray(resp?.items) ? resp.items : [];
      const names = items.length ? items.map(it => it.name) : (Array.isArray(resp?.names) ? resp.names : []);

      if (items.length){
        items.forEach(it => {
          const key = (it.name || "").trim().toLowerCase();
          if (key) shell.__lastPriceMap.set(key, (it.last_price != null ? Number(it.last_price) : null));
        });
      }
      shell.__allowedNames = names;
      shell.__allowedLower = new Set(names.map(n => (n || '').toLowerCase()));

      const dl = el(`<datalist id="${id}">${names.map(n => `<option value="${n}"></option>`).join("")}</datalist>`);
      shell.appendChild(dl);
    }catch(e){ console.error("ensureDatalist:", e); }
  }
  function getAllowedNamesSet(shell){
    if (shell && shell.__allowedLower instanceof Set && shell.__allowedLower.size){
      return shell.__allowedLower;
    }
    const set = new Set();
    const dl = document.getElementById('rm-name-dl');
    if (!dl) return set;
    Array.from(dl.querySelectorAll('option')).forEach(opt => {
      const v = (opt.value || '').trim().toLowerCase();
      if (v) set.add(v);
    });
    return set;
  }

  // ------------- Suroviny (výrobný sklad) -------------
  async function renderRaw(shell){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.appendChild(loading()); body.setAttribute("data-view", "raw");
    const search = qs("#stock-search", shell);

    const label = {
      maso: 'Mäso – výrobný sklad',
      koreniny: 'Koreniny – výrobný sklad',
      obal: 'Obaly – výrobný sklad',
      pomocny_material: 'Pomocný materiál – výrobný sklad',
      nezaradene: 'Nezaradené – výrobný sklad'
    };
    const order = ['maso','koreniny','obal','pomocny_material','nezaradene'];

    const catOf = (r)=>{
  const t = String(r.typ || '').toLowerCase();
  const p = String(r.podtyp || '').toLowerCase();
  if (t === 'mäso' || t === 'maso' || t === 'meat' || p === 'maso') return 'maso';
  if (t.startsWith('koren') || p === 'koreniny') return 'koreniny';
  if (t.startsWith('obal')) return 'obal';
  if (t.startsWith('pomoc')) return 'pomocny_material';
  return 'nezaradene';
};


    try{
      const res = await apiRequest("/api/kancelaria/getRawMaterialStockOverview");
      const items = Array.isArray(res?.items) ? res.items : [];

      // datalist pre intake/autocomplete
      const dlHtml = items.map(r => `<option value="${r.nazov}"></option>`).join("");
      if (!qs("#rm-name-dl", shell)) shell.appendChild(el(`<datalist id="rm-name-dl">${dlHtml}</datalist>`));
      else qs("#rm-name-dl", shell).innerHTML = dlHtml;

      body.innerHTML = "";
      const container = el(`<div></div>`);
      body.appendChild(container);

      const asGroups = (list)=>{
        const g = { maso:[], koreniny:[], obal:[], pomocny_material:[], nezaradene:[] };
        list.forEach(r => g[catOf(r)].push(r));
        return g;
      };

      const draw = (groups)=>{
        container.innerHTML = "";
        order.forEach(cat=>{
          const rows = groups[cat] || [];
          if (!rows.length) return;

          const card = el(`<div class="stat-card" style="margin-bottom:1rem;"></div>`);
          card.appendChild(el(`<h4 style="margin:0 0 .5rem 0;">${label[cat]}</h4>`));
          const wrap = el(`<div class="table-container"></div>`);
          const table = el(`
            <table>
              <thead>
                <tr><th>Názov</th><th>Typ</th><th>Sklad (kg)</th><th>Akcie</th></tr>
              </thead>
              <tbody></tbody>
              <tfoot class="total-row"><tr><td colspan="3">Súčet</td><td class="js-sum">0.00</td></tr></tfoot>
            </table>
          `);
          const tb = qs("tbody", table);
          let sum = 0;

          rows.forEach(r=>{
            const qty = r.quantity != null ? r.quantity : (r.mnozstvo != null ? r.mnozstvo : 0);
            const tr = el(`
              <tr data-name="${txt(r.nazov)}" data-cat="${cat}">
                <td class="c-name">${txt(r.nazov)}</td>
                <td>${label[cat].split(' – ')[0]}</td>
                <td class="c-qty">${fmt(qty, 3)}</td>
                <td class="c-actions" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                  <button class="btn-secondary js-editqty" style="margin:0;">Upraviť množstvo</button>
                  <button class="btn-secondary js-editcard" style="margin:0;">Upraviť kartu</button>
                  <button class="btn-danger js-del" style="margin:0;">Zmazať</button>
                </td>
              </tr>
            `);

            // Edit množstva (inline)
            qs(".js-editqty", tr).addEventListener("click", async ()=>{
              if (tr.classList.contains("editing-qty")) return;
              tr.classList.add("editing-qty");
              const cQty = qs(".c-qty", tr);
              const oldQty = parseAmount(cQty.textContent || "0", 3) || 0;
              cQty.innerHTML = `<input type="text" class="input js-newqty" placeholder="kg" value="${oldQty.toFixed(3)}" style="max-width:9rem;">`;
              const newInput = qs(".js-newqty", tr);
              attachNumericSanitizer(newInput, 3);

              const actions = qs(".c-actions", tr);
              const oldActions = actions.innerHTML;
              actions.innerHTML = `
                <button class="btn-success js-save" style="margin:0;">Uložiť</button>
                <button class="btn-secondary js-cancel" style="margin:0;">Zrušiť</button>
              `;
              qs(".js-cancel", tr).onclick = ()=>{
                cQty.textContent = oldQty.toFixed(3);
                actions.innerHTML = oldActions;
                bindRowActions();
                tr.classList.remove("editing-qty");
              };
              qs(".js-save", tr).onclick = async ()=>{
                const newQty = parseAmount(qs(".js-newqty", tr).value, 3);
                const name = tr.dataset.name;
                if (newQty == null || newQty < 0){ alert("Neplatné množstvo."); return; }
                if (!confirmTwice(`Upraviť množstvo položky „${name}“ na ${newQty.toFixed(3)} kg?`,"Prosím potvrďte ešte raz úpravu množstva.")) return;
                try{
                  await apiRequest("/api/kancelaria/stock/updateProductionItemQty", "POST", { name, quantity: newQty });
                  renderRaw(shell);
                }catch(e){ alert("Chyba pri ukladaní: " + e.message); }
              };

              function bindRowActions(){
                qs(".js-editqty", tr).addEventListener("click", ()=>{ tr.classList.remove("editing-qty"); qs(".js-editqty", tr).click(); });
                qs(".js-editcard", tr).addEventListener("click", ()=> openEditCard(shell, tr.dataset.name));
                qs(".js-del", tr).addEventListener("click", delHandler);
              }
            });

            // Edit karty (full)
            qs(".js-editcard", tr).addEventListener("click", ()=> openEditCard(shell, tr.dataset.name));

            // Delete
            function delHandler(){
              const name = tr.dataset.name;
              const ok1 = confirm(`Naozaj chcete zmazať položku „${name}“ z výrobného skladu?`);
              if (!ok1) return;

              const deleteCard = confirm(
                `Chceš zmazať „${name}“ aj z karty v hlavnom sklade (resp. prestať ju sledovať v objednávkach)?\n\n` +
                `OK = Zmazať aj z karty (vynuluje minimálnu zásobu – položka už nebude figurovať v „pod minimom“)\n` +
                `Zrušiť = Zmazať iba z výrobného skladu`
              );

              apiRequest("/api/kancelaria/stock/deleteProductionItem", "POST", {
                  name,
                  delete_card: deleteCard
                })
                .then(()=> renderRaw(shell))
                .catch(e => alert("Chyba pri mazaní: " + e.message));
            }
            qs(".js-del", tr).addEventListener("click", delHandler);

            tb.appendChild(tr);
            sum += qty;
          });

          qs(".js-sum", table).textContent = fmt(sum, 3);
          wrap.appendChild(table);
          card.appendChild(wrap);
          container.appendChild(card);
        });

        if (!container.children.length){
          container.appendChild(empty("Žiadne položky vo výrobnom sklade."));
        }
      };

      const allGroups = asGroups(items);
      draw(allGroups);

      if (search){
        search._h && search.removeEventListener("input", search._h);
        search._h = ()=>{
          const q = (search.value || "").toLowerCase().trim();
          if (!q) { draw(allGroups); return; }
          const filtered = items.filter(r=>{
            const cat = catOf(r);
            return txt(r.nazov).toLowerCase().includes(q)
                || txt(r.typ).toLowerCase().includes(q)
                || label[cat].toLowerCase().includes(q);
          });
          draw(asGroups(filtered));
        };
        search.addEventListener("input", search._h);
      }
    }catch(e){
      console.error(e);
      body.innerHTML = ""; body.appendChild(empty("Nepodarilo sa načítať výrobný sklad."));
    }
  }

  // ---------- Editačný panel karty ----------
  async function openEditCard(shell, originalName){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.setAttribute("data-view","edit");
    body.appendChild(el(`<div class="stat-card"><h4 style="margin:0 0 .5rem 0;">Upraviť kartu – ${txt(originalName)}</h4></div>`));

    // načítaj dáta položky + dodávateľov
    let item = {}, suppliers = [];
    try {
      const r = await apiRequest(`/api/kancelaria/stock/item?name=${encodeURIComponent(originalName)}`);
      item = r?.item || {};
    } catch(e){}
    try {
      const s = await apiRequest(`/api/kancelaria/suppliers`, "GET");
      suppliers = Array.isArray(s?.items) ? s.items : [];
    } catch(e){}

    const typOptions = [
      {key:'',  label:'—'},
      {key:'maso', label:'Mäso'},
      {key:'koreniny', label:'Koreniny'},
      {key:'obal', label:'Obaly - Črevá'},
      {key:'pomocny_material', label:'Pomocný materiál'}
    ];

    const form = el(`
      <div class="stat-card">
        <div class="form-grid">
          <div class="form-group"><label>Názov</label><input class="js-name" value="${escapeHtml(item.nazov||originalName)}"></div>
          <div class="form-group"><label>EAN</label><input class="js-ean" value="${escapeHtml(item.ean||'')}"></div>
          <div class="form-group"><label>Jednotka (mj)</label><input class="js-mj" value="${escapeHtml(item.jednotka||item.mj||'kg')}"></div>

          <div class="form-group"><label>Min. zásoba (kg)</label><input class="js-min-zasoba" type="text" placeholder="kg" value="${escapeHtml(item.min_zasoba||'')}"></div>

          <div class="form-group"><label>Nákupná cena</label><input class="js-nakup" type="text" placeholder="€/kg" value="${escapeHtml(item.nakupna_cena||'')}"></div>
          <div class="form-group"><label>Default cena €/kg</label><input class="js-defcena" type="text" placeholder="€/kg" value="${escapeHtml(item.default_cena_eur_kg||'')}"></div>

          <div class="form-group"><label>Balenie – množstvo</label><input class="js-pack-qty" type="text" placeholder="napr. 0,500" value="${escapeHtml(item.balenie_mnozstvo||'')}"></div>
          <div class="form-group"><label>Balenie – MJ</label><input class="js-pack-mj" type="text" placeholder="kg / ks / bm" value="${escapeHtml(item.balenie_mj||'')}"></div>

          <div class="form-group">
            <label>Kategória (typ)</label>
            <select class="js-typ">
              ${typOptions.map(o=>{
                const isSel =
                  (String(item.kategoria||'').toLowerCase()===o.key) ||
                  (o.key && String(item.typ||'').toLowerCase().includes(o.key));
                return `<option value="${o.key}" ${isSel?'selected':''}>${o.label}</option>`;
              }).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Dodávateľ</label>
            <select class="js-supplier">
              <option value="">— bez prepojenia —</option>
              ${suppliers.map(s=>`<option value="${s.id||''}" ${String(s.id||'')==String(item.dodavatel_id||'')?'selected':''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="btn-grid" style="margin-top:.75rem;">
          <button class="btn-secondary js-back">Späť</button>
          <span></span>
          <button class="btn-primary js-save"><i class="fa-solid fa-floppy-disk"></i> Uložiť zmeny</button>
        </div>
      </div>
    `);

    body.appendChild(form);

    qs(".js-back", form).addEventListener("click", ()=> renderRaw(shell));
    qs(".js-save", form).addEventListener("click", async ()=>{
      const minZas = parseAmount(qs(".js-min-zasoba", form).value, 3);
      const nakup  = parseAmount(qs(".js-nakup", form).value, 3);
      const defCena= parseAmount(qs(".js-defcena", form).value, 3);
      const packQty= parseAmount(qs(".js-pack-qty", form).value, 3);
      const packMj = qs(".js-pack-mj", form).value.trim() || null;

      const payload = {
        original_name: originalName,
        name: qs(".js-name", form).value.trim() || originalName,
        ean: qs(".js-ean", form).value.trim() || null,
        mj:  qs(".js-mj", form).value.trim() || null,

        min_zasoba: minZas,
        nakupna_cena: nakup,
        default_cena_eur_kg: defCena,

        balenie_mnozstvo: packQty,
        balenie_mj:       packMj,

        kategoria: qs(".js-typ", form).value || null,
        typ: (function(){
          const k = qs(".js-typ", form).value;
          if (k === 'koreniny') return 'Koreniny';
          if (k === 'obal') return 'Obaly - Črevá';
          if (k === 'pomocny_material') return 'Pomocný materiál';
          if (k === 'maso') return 'Mäso';
          return null;
        })(),
        dodavatel_id: qs(".js-supplier", form).value || null
      };
      try{
        await apiRequest('/api/kancelaria/stock/saveItem', 'POST', payload);
        alert('Karta uložená.');
        renderRaw(shell);
      }catch(e){ alert('Chyba: '+ e.message); }
    });
  }

  // ------------- Intake (samostatné zobrazenie so 4 kartami) -------------
  async function loadSuppliersByCategory(cat){
    try {
      const data = await apiRequest(`/api/kancelaria/suppliers?category=${encodeURIComponent(cat)}`);
      return Array.isArray(data?.items) ? data.items : [];
    } catch(e){ return []; }
  }
  function buildRowsTable(columns){
    return el(`
      <div class="table-container">
        <table class="js-intake-table">
          <thead><tr>${columns.map(c=>`<th style="width:${c.w||'auto'}">${c.t}</th>`).join('')}</tr></thead>
          <tbody></tbody>
        </table>
      </div>
    `);
  }
  function addLineRow(tbody, shell){
    const tr = el(`<tr>
      <td><input class="input js-name" placeholder="Názov suroviny"></td>
      <td><input class="input js-qty" type="text" placeholder="kg"></td>
      <td><input class="input js-price" type="text" placeholder="€/kg"></td>
      <td><input class="input js-note" placeholder="Poznámka"></td>
      <td><button class="btn-danger js-del" title="Odstrániť"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`);
    const nameInput  = tr.querySelector('.js-name');
    const qtyInput   = tr.querySelector('.js-qty');
    const priceInput = tr.querySelector('.js-price');
    attachNumericSanitizer(qtyInput, 3);
    attachNumericSanitizer(priceInput, 3);
    attachAutocomplete(
      nameInput,
      Array.isArray(shell?.__allowedNames) ? shell.__allowedNames : [],
      async (pickedName)=>{
        const key = (pickedName || '').toLowerCase();
        let lp = shell?.__lastPriceMap?.get(key) ?? null;
        if (lp == null){
          try{
            const r = await apiRequest(`/api/kancelaria/stock/last-price?name=${encodeURIComponent(pickedName)}`);
            if (r && r.last_price != null) lp = Number(r.last_price);
          }catch(_){}
        }
        if (lp != null && !priceInput.value){
          priceInput.value = Number(lp).toFixed(3);
        }
      }
    );
    tr.querySelector('.js-del').addEventListener('click', ()=> tr.remove());
    tbody.appendChild(tr);
  }

  function buildIntakeMaso(shell){
    const card = el(`<div class="stat-card"></div>`);
    card.appendChild(el(`<h4 style="margin:0 0 .5rem 0;">Príjem – Mäso</h4>`));
    const srcWrap = el(`
      <div class="form-grid" style="margin-bottom:.75rem">
        <div class="form-group"><label>Zdroj</label>
          <select class="js-source">
            <option value="rozrabka">Rozrábka</option>
            <option value="expedicia">Expedícia</option>
            <option value="externy">Externý</option>
            <option value="ine">Iné</option>
          </select>
        </div>
      </div>
    `);
    card.appendChild(srcWrap);

    const table = buildRowsTable([
      {t:'Názov položky', w:'18rem'},
      {t:'Množstvo (kg)',  w:'10rem'},
      {t:'Cena €/kg',      w:'10rem'},
      {t:'Poznámka',       w:'20rem'},
      {t:'',               w:'4rem'}
    ]);
    card.appendChild(table);
    const tbody = table.querySelector('tbody');
    addLineRow(tbody, shell); addLineRow(tbody, shell);

    const actions = el(`
      <div class="btn-grid" style="margin-top:.75rem">
        <button class="btn-secondary js-add"><i class="fa-solid fa-plus"></i> Pridať riadok</button>
        <span style="flex:1"></span>
        <button class="btn-success js-save"><i class="fa-solid fa-floppy-disk"></i> Uložiť príjem</button>
      </div>
    `);
    card.appendChild(actions);

    actions.querySelector('.js-add').addEventListener('click', ()=> addLineRow(tbody, shell));
    actions.querySelector('.js-save').addEventListener('click', async ()=>{
      const source = srcWrap.querySelector('.js-source').value;
      const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => ({
        category: 'maso',
        source,
        name:  (tr.querySelector('.js-name').value || '').trim(),
        quantity: parseAmount(tr.querySelector('.js-qty').value, 3),
        price: tr.querySelector('.js-price').value ? parseAmount(tr.querySelector('.js-price').value, 3) : null,
        note:  (tr.querySelector('.js-note').value || '').trim()
      })).filter(r => r.name && r.quantity>0);
      if (!rows.length){ alert('Pridaj aspoň jednu položku.'); return; }
      const allowed = getAllowedNamesSet(shell);
      const bad = rows.filter(r => !allowed.has(r.name.toLowerCase()));
      if (bad.length){ alert("Položky mimo kategórie nie je možné prijať:\n - " + bad.map(b=>b.name).join("\n - ")); return; }
      try{
        await apiRequest('/api/kancelaria/stock/receiveProduction', 'POST', { items: rows });
        alert('Príjem uložený.'); tbody.innerHTML=''; addLineRow(tbody, shell); addLineRow(tbody, shell);
      }catch(e){ alert('Chyba: '+e.message); }
    });

    return card;
  }

  function buildIntakeNonMaso(shell, cat){
    const card = el(`<div class="stat-card"></div>`);
    const titleMap = {koreniny:'Koreniny', obal:'Obaly', pomocny_material:'Pomocný materiál'};
    card.appendChild(el(`<h4 style="margin:0 0 .5rem 0;">Príjem – ${titleMap[cat] || cat}</h4>`));
    const supWrap = el(`
      <div class="form-grid" style="margin-bottom:.75rem">
        <div class="form-group"><label>Dodávateľ</label>
          <select class="js-supplier"><option value="">— vyber dodávateľa —</option></select>
        </div>
      </div>
    `);
    card.appendChild(supWrap);

    loadSuppliersByCategory(cat).then(list => {
      supWrap.querySelector('.js-supplier').innerHTML =
        `<option value="">— vyber dodávateľa —</option>` +
        list.map(s => `<option value="${s.id}">${txt(s.name)}</option>`).join('');
    });

    const table = buildRowsTable([
      {t:'Názov položky', w:'18rem'},
      {t:'Množstvo (kg)', w:'10rem'},
      {t:'Cena €/kg',     w:'10rem'},
      {t:'Poznámka',      w:'20rem'},
      {t:'',              w:'4rem'}
    ]);
    card.appendChild(table);
    const tbody = table.querySelector('tbody');
    addLineRow(tbody, shell); addLineRow(tbody, shell);

    const actions = el(`
      <div class="btn-grid" style="margin-top:.75rem">
        <button class="btn-secondary js-add"><i class="fa-solid fa-plus"></i> Pridať riadok</button>
        <span style="flex:1"></span>
        <button class="btn-success js-save"><i class="fa-solid fa-floppy-disk"></i> Uložiť príjem</button>
      </div>
    `);
    card.appendChild(actions);

    actions.querySelector('.js-add').addEventListener('click', ()=> addLineRow(tbody, shell));
    actions.querySelector('.js-save').addEventListener('click', async ()=>{
      const supplier_id = supWrap.querySelector('.js-supplier').value;
      if (!supplier_id){ alert('Vyber dodávateľa.'); return; }
      const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => ({
        category: cat,
        supplier_id: Number(supplier_id),
        name:  tr.querySelector('.js-name').value.trim(),
        quantity: parseAmount(tr.querySelector('.js-qty').value, 3),
        price: tr.querySelector('.js-price').value ? parseAmount(tr.querySelector('.js-price').value, 3) : null,
        note:  tr.querySelector('.js-note').value.trim()
      })).filter(r => r.name && r.quantity>0);
      if (!rows.length){ alert('Pridaj aspoň jednu položku.'); return; }
      const allowed = getAllowedNamesSet(shell);
      const bad = rows.filter(r => !allowed.has(r.name.toLowerCase()));
      if (bad.length){ alert("Položky mimo kategórie nie je možné prijať:\n - " + bad.map(b=>b.name).join("\n - ")); return; }
      try{
        await apiRequest('/api/kancelaria/stock/receiveProduction', 'POST', { items: rows });
        alert('Príjem uložený.'); tbody.innerHTML=''; addLineRow(tbody, shell); addLineRow(tbody, shell);
      }catch(e){ alert('Chyba: '+e.message); }
    });

    return card;
  }

  function renderIntake(shell){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.setAttribute("data-view","intake");

    const tabs = el(`
      <div class="btn-grid" style="margin-bottom:.75rem">
        <button class="btn-secondary js-tab" data-cat="maso">Mäso</button>
        <button class="btn-secondary js-tab" data-cat="koreniny">Koreniny</button>
        <button class="btn-secondary js-tab" data-cat="obal">Obaly</button>
        <button class="btn-secondary js-tab" data-cat="pomocny_material">Pomocný materiál</button>
        <span style="flex:1"></span>
      </div>
    `);
    const host = el(`<div></div>`);
    body.appendChild(tabs); body.appendChild(host);

    async function openCat(cat){
      host.innerHTML = "";
      shell.__activeIntakeCat = cat;
      await ensureDatalist(shell, cat); // názvy podľa kategórie
      if (cat === "maso") host.appendChild(buildIntakeMaso(shell));
      else host.appendChild(buildIntakeNonMaso(shell, cat));
      qsa(".js-tab", tabs).forEach(b => b.classList.toggle("btn-primary", b.dataset.cat===cat));
    }

    qsa(".js-tab", tabs).forEach(b => b.addEventListener("click", () => openCat(b.dataset.cat)));
    openCat("maso"); // default
  }

  // ------------- Pridať položku -------------
  function ensureSupplierPickerStyles(){
    if (document.getElementById('supplier-styles')) return;
    document.head.appendChild(el(`<style id="supplier-styles">
      .supplier-list{
        border:1px solid #e5e7eb; border-radius:10px; overflow:auto; max-height:320px;
        background:#fff;
      }
      .sup-header{
        position:sticky; top:0; z-index:1;
        display:grid; grid-template-columns: 42px 48px minmax(220px,1.3fr) minmax(160px,1fr) 120px;
        gap:8px; align-items:center;
        padding:10px 12px; background:#f9fafb; border-bottom:1px solid #e5e7eb; font-weight:600; font-size:.92rem;
      }
      .sup-header .muted{ font-weight:500; color:#6b7280; }
      .sup-body{ display:block; }
      .sup-row{
        display:grid; grid-template-columns: 42px 48px minmax(220px,1.3fr) minmax(160px,1fr) 120px;
        gap:8px; align-items:center; padding:10px 12px; transition:background .15s ease;
        border-bottom:1px solid #f3f4f6;
      }
      .sup-row:nth-child(odd){ background:#fcfcfd; }
      .sup-row:hover{ background:#f5f7fb; }
      .sup-cell{ display:flex; align-items:center; gap:8px; min-width:0; }
      .sup-name{ font-weight:600; color:#111827; }
      .sup-meta{ font-size:.85rem; color:#6b7280; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sup-contact{ font-size:.9rem; color:#374151; display:flex; gap:10px; flex-wrap:wrap; }
      .sup-contact .tag{ font-size:.85rem; color:#4b5563; }
      .sup-avatar{
        width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;
        background:#eef2ff; color:#3730a3; font-weight:700; font-size:.9rem; box-shadow: inset 0 0 0 1px #e5e7eb;
        user-select:none;
      }
      .chip{
        display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px;
        background:#f1f5f9; color:#334155; font-size:.78rem; border:1px solid #e2e8f0; margin-right:6px; margin-bottom:6px;
        white-space:nowrap;
      }
      .sup-def{ justify-content:flex-end; gap:8px; color:#6b7280; }
      .sup-def label{ display:flex; align-items:center; gap:6px; }
      #pi-suppliers-block .js-sup-search{ margin:6px 0 8px 0; width:100%; }
      .sup-select-all{ display:flex; align-items:center; gap:6px; color:#374151; }
      .sup-select-all input{ transform: translateY(1px); }
      .hidden{ display:none; }
      @media (max-width: 920px){
        .sup-header, .sup-row{
          grid-template-columns: 36px 0px minmax(200px,1.2fr) 1fr 108px;
        }
        .sup-avatar{ display:none; }
      }
    </style>`));
  }

  function normalizeCategoryForApi(label) {
    const s = String(label || '').toLowerCase();
    if (s.includes('mäso') || s.includes('maso') || s === 'meat') return 'maso';
    if (s.includes('koren')) return 'koreniny';
    if (s.includes('obal')) return 'obal';
    if (s.includes('pomoc')) return 'pomocny_material';
    return s || null;
  }

  function buildAddItemPanel(shell){
    ensureSupplierPickerStyles();

    const node = el(`
      <div class="stat-card">
        <h4 style="margin:0 0 .5rem 0;">Pridať položku do výrobného skladu</h4>
        <div class="form-grid">
          <div class="form-group">
            <label>Kategória</label>
            <select class="js-cat" id="pi-category">
              <option value="mäso">Mäso</option>
              <option value="koreniny">Koreniny</option>
              <option value="obal">Obaly</option>
              <option value="pomocny_material">Pomocný materiál</option>
            </select>
          </div>
          <div class="form-group"><label>EAN (voliteľné)</label><input class="js-ean" id="pi-ean" placeholder="napr. 858..." /></div>
          <div class="form-group"><label>Názov položky</label><input class="js-name" id="pi-name" placeholder="napr. Bravčové plece" /></div>
          <div class="form-group"><label>Počiatočné množstvo</label><input class="js-qty" id="pi-qty" type="text" placeholder="kg"></div>
          <div class="form-group"><label>Začiatočná cena / jednotka</label><input class="js-price" id="pi-price" type="text" placeholder="€"></div>
          <div class="form-group">
            <label>Minimálna zásoba na sklade (kg)</label>
            <input class="js-min" id="pi-min" type="text" placeholder="kg">
            <small class="hint">Používa sa na sledovanie „pod minimom“ a návrhy do objednávok.</small>
          </div>

          <div class="form-group"><label>Balenie – množstvo</label><input class="js-pack-qty" id="pi-pack-qty" type="text" placeholder="napr. 0,500"></div>
          <div class="form-group"><label>Balenie – MJ (kg / ks / bm)</label><input class="js-pack-mj" id="pi-pack-mj" type="text" placeholder="kg / ks / bm"></div>

          <div class="form-group" id="pi-suppliers-block" style="grid-column:1/-1; display:none;">
            <label>Dodávatelia (viacnásobný výber)</label>
            <input type="text" class="input js-sup-search" placeholder="Hľadať dodávateľa…">
            <div class="supplier-list js-sup-list"></div>
            <small class="supplier-empty js-sup-empty" style="display:none;">
              Pre túto kategóriu nemáš zatiaľ evidovaných dodávateľov. Pridaj ich v sekcii „Dodávatelia“.
            </small>
            <small class="hint">Zaškrtni jedného alebo viac dodávateľov a označ predvoleného (použije sa v objednávkach).</small>
          </div>
        </div>
        <div class="btn-grid" style="margin-top:.75rem;">
          <span></span><button class="btn-success js-create" id="pi-submit"><i class="fa-solid fa-plus"></i> Pridať položku</button>
        </div>
      </div>
    `);

    const catEl   = qs(".js-cat", node);
    const supWrap = qs("#pi-suppliers-block", node);
    const supList = qs(".js-sup-list", node);
    const supEmpty= qs(".js-sup-empty", node);
    const supSearch = qs(".js-sup-search", node);

    async function loadSuppliersUIForCategory(catKey){
      if (!catKey || catKey === 'maso'){
        supWrap.style.display = 'none';
        supList.innerHTML = '';
        supEmpty.style.display = 'none';
        return;
      }
      supWrap.style.display = '';
      try{
        const suppliers = await loadSuppliersByCategory(catKey);
        renderSupplierRows(suppliers);
      }catch(e){
        supList.innerHTML = '';
        supEmpty.style.display = '';
      }
    }

    function renderSupplierRows(list){
      supList.innerHTML = '';

      if (!list.length){
        supEmpty.style.display = '';
        return;
      }
      supEmpty.style.display = 'none';

      const initials = (name)=> {
        const parts = String(name||'').trim().split(/\s+/).slice(0,2);
        return parts.map(p=>p[0]||'').join('').toUpperCase();
      };
      const chipsHtml = (arr)=> (arr||[]).map(c=>`<span class="chip">${escapeHtml(c)}</span>`).join('');

      const header = el(`
        <div class="sup-header">
          <div class="sup-cell">
            <label class="sup-select-all">
              <input type="checkbox" class="js-sup-all">
              <span class="muted">Všetko</span>
            </label>
          </div>
          <div class="sup-cell"></div>
          <div class="sup-cell">Dodávateľ</div>
          <div class="sup-cell">Kontakt / Kategórie</div>
          <div class="sup-cell sup-def">Predvolený</div>
        </div>
      `);
      const body = el(`<div class="sup-body"></div>`);
      supList.appendChild(header);
      supList.appendChild(body);

      const frag = document.createDocumentFragment();
      list.forEach(s => {
        const row = el(`
          <div class="sup-row" data-id="${s.id}">
            <div class="sup-cell">
              <input type="checkbox" class="pi-supplier-checkbox" value="${s.id}">
            </div>
            <div class="sup-cell"><div class="sup-avatar">${escapeHtml(initials(s.name))}</div></div>
            <div class="sup-cell" title="${escapeHtml(s.name)}">
              <div class="sup-name">${escapeHtml(s.name)}</div>
              <div class="sup-meta">${escapeHtml(s.address || '')}</div>
            </div>
            <div class="sup-cell">
              <div class="sup-contact">
                ${s.phone ? `<span class="tag">${escapeHtml(s.phone)}</span>` : ''}
                ${s.email ? `<span class="tag">${escapeHtml(s.email)}</span>` : ''}
              </div>
              <div style="margin-top:6px;">${chipsHtml(s.categories)}</div>
            </div>
            <div class="sup-cell sup-def">
              <label title="Predvolený dodávateľ">
                <input type="radio" name="pi-supplier-default" class="pi-supplier-default" value="${s.id}" disabled>
                predvolený
              </label>
            </div>
          </div>
        `);
        frag.appendChild(row);
      });
      body.appendChild(frag);

      if (!supList.__bound){
        supList.addEventListener('change', (e)=>{
          const t = e.target;

          if (t.classList.contains('js-sup-all')){
            const all = !!t.checked;
            qsa('.pi-supplier-checkbox', supList).forEach(cb=>{
              cb.checked = all;
              const rb = supList.querySelector(`.pi-supplier-default[value="${cb.value}"]`);
              if (rb){
                rb.disabled = !all;
                if (all && !supList.querySelector('.pi-supplier-default:checked')) rb.checked = true;
              }
            });
            return;
          }

          if (t.classList.contains('pi-supplier-checkbox')){
            const id = t.value;
            const rb = supList.querySelector(`.pi-supplier-default[value="${id}"]`);
            if (!rb) return;
            if (t.checked){
              rb.disabled = false;
              if (!supList.querySelector('.pi-supplier-default:checked')) rb.checked = true;
            } else {
              if (rb.checked){
                rb.checked = false;
                const first = supList.querySelector('.pi-supplier-checkbox:checked');
                if (first){
                  const rb2 = supList.querySelector(`.pi-supplier-default[value="${first.value}"]`);
                  if (rb2){ rb2.disabled = false; rb2.checked = true; }
                }
              }
              rb.disabled = true;
            }
          }

          if (t.classList.contains('pi-supplier-default')){
            const id = t.value;
            const cb = supList.querySelector(`.pi-supplier-checkbox[value="${id}"]`);
            if (cb && !cb.checked){
              t.checked = false;
              alert('Predvolený musí byť medzi vybranými dodávateľmi.');
            }
          }
        });

        supSearch.addEventListener('input', ()=>{
          const q = supSearch.value.trim().toLowerCase();
          qsa('.sup-row', supList).forEach(r => {
            r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
          });
        });

        supList.__bound = true;
      }
    }

    (async ()=> {
      const cat = normalizeCategoryForApi(catEl.value);
      await loadSuppliersUIForCategory(cat);
    })();

    catEl.addEventListener("change", async (ev)=>{
      const cat = normalizeCategoryForApi(ev.target.value);
      await loadSuppliersUIForCategory(cat);
    });

    qs(".js-create", node).addEventListener("click", async ()=>{
      const cat   = normalizeCategoryForApi(qs(".js-cat", node).value);
      const ean   = qs(".js-ean", node).value.trim() || null;
      const name  = qs(".js-name", node).value.trim();
      const qty   = parseAmount(qs(".js-qty", node).value, 3) || 0;
      const price = qs(".js-price", node).value ? parseAmount(qs(".js-price", node).value, 3) : null;

      const minRaw = qs(".js-min", node)?.value ?? '';
      const min_qty = (minRaw === '' ? null : parseAmount(minRaw, 3));

      const packQty = parseAmount(qs(".js-pack-qty", node)?.value || '', 3);
      const packMj  = (qs(".js-pack-mj", node)?.value || '').trim() || null;

      if (!name){ alert("Zadaj názov."); return; }
      if (qty < 0){ alert("Záporné množstvo nie je povolené."); return; }
      if (min_qty !== null && min_qty < 0){ alert("Minimálne množstvo nemôže byť záporné."); return; }

      const payload = {
        name,
        ean,
        mnozstvo: qty,
        min_zasoba: min_qty,
        nakupna_cena: price,
        balenie_mnozstvo: packQty,
        balenie_mj: packMj,
        kategoria: cat
      };

      try{
        await apiRequest("/api/kancelaria/addNewStockItem", "POST", payload);
        alert("Položka pridaná.");
        renderRaw(shell);
      }catch(e){
        alert("Chyba: " + e.message);
        console.error(e);
      }
    });

    return node;
  }

// ------------- Import z Rozrábky -------------
  // ------------- Import z Rozrábky (Výrobný sklad) -------------
  async function renderRozrabkaImport(shell) {
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.appendChild(loading()); body.setAttribute("data-view", "rozrabka");

    try {
      const [statusRes, histRes] = await Promise.all([
        apiRequest("/api/kancelaria/stock/rozrabka/status"),
        apiRequest("/api/kancelaria/stock/rozrabka/history")
      ]);
      
      const fileStatus = statusRes || { exists: false };
      const history = histRes?.history || [];

      body.innerHTML = "";
      const container = el(`<div class="dashboard-grid" style="grid-template-columns: 1fr; gap:1.5rem;"></div>`);
      
      // KARTA 1: Importy
      const importCard = el(`
        <div class="stat-card" style="border-top: 4px solid #16a34a;">
          <h4 style="margin-top:0"><i class="fa-solid fa-file-import"></i> Príjem na Výrobný Sklad (z Rozrábky)</h4>
          <p class="text-muted small">Položky sa spárujú podľa EAN kódu z centrálneho číselníka a pripočítajú sa do výrobného skladu.</p>
          
          <div style="background:${fileStatus.exists ? '#dcfce7' : '#f1f5f9'}; padding:15px; border-radius:8px; margin:15px 0; border:1px solid ${fileStatus.exists ? '#86efac' : '#e2e8f0'};">
             <div style="font-weight:bold; margin-bottom:5px; color:${fileStatus.exists ? '#166534':'#475569'}">A. Zo servera (automaticky)</div>
             ${fileStatus.exists 
                ? `<div>Súbor <b>PRIJEMVYROBA.CSV</b> je pripravený. <br><small>Čas: ${fileStatus.time}</small></div>`
                : `<div class="text-muted small">Súbor na serveri sa nenašiel.</div>`
             }
             <div style="margin-top:10px">
                <button class="btn-success js-process-server" ${!fileStatus.exists ? 'disabled' : ''} style="width:100%">
                    <i class="fa-solid fa-gears"></i> Spracovať súbor zo servera
                </button>
             </div>
          </div>

          <div style="border-top:1px solid #eee; padding-top:15px;">
             <div style="font-weight:bold; margin-bottom:5px; color:#475569">B. Nahrať ručne (testovanie/manuál)</div>
             <div style="display:flex; gap:10px;">
                <input type="file" class="input js-manual-file" accept=".csv,.txt" style="flex:1">
                <button class="btn-primary js-process-manual"><i class="fa-solid fa-upload"></i> Nahrať</button>
             </div>
          </div>
        </div>
      `);

      // Handler: Automatika
      importCard.querySelector('.js-process-server').onclick = async () => {
        if(!confirm("Spracovať súbor zo servera?")) return;
        try {
            const res = await apiRequest("/api/kancelaria/stock/rozrabka/process", "POST");
            alert(res.message);
            renderRozrabkaImport(shell);
        } catch(e) { alert("Chyba: " + e.message); }
      };

      // Handler: Manuál
      importCard.querySelector('.js-process-manual').onclick = async () => {
        const fileInput = importCard.querySelector('.js-manual-file');
        const file = fileInput.files[0];
        if(!file) return alert("Vyberte súbor!");
        
        const fd = new FormData();
        fd.append('file', file);
        
        try {
            const res = await fetch("/api/kancelaria/stock/rozrabka/manual-import", { method: 'POST', body: fd });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error || "Chyba uploadu");
            alert(data.message);
            renderRozrabkaImport(shell);
        } catch(e) { alert("Chyba: " + e.message); }
      };
      
      container.appendChild(importCard);

      // KARTA 2: História
      const histCard = el(`
        <div class="stat-card">
          <h4 style="margin-top:0">História príjmov</h4>
          <div class="table-container">
            <table class="table table-sm">
                <thead><tr><th>Dátum</th><th>Ref</th><th>Pol.</th><th>Hodnota</th><th>Tlač</th></tr></thead>
                <tbody></tbody>
            </table>
          </div>
        </div>
      `);
      
      const tbody = histCard.querySelector('tbody');
      if (history.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Žiadna história.</td></tr>';
      } else {
          history.forEach(h => {
              const tr = el(`
                <tr>
                    <td>${h.datum_display}</td>
                    <td title="${h.import_ref}" style="max-width:120px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(h.import_ref)}</td>
                    <td>${h.items_count}</td>
                    <td>${fmt(h.total_value)} €</td>
                    <td>
                        <button class="btn-secondary btn-sm js-print">
                            <i class="fa-solid fa-print"></i>
                        </button>
                    </td>
                </tr>
              `);
              tr.querySelector('.js-print').onclick = () => {
                  window.open(`/api/kancelaria/stock/rozrabka/print/${encodeURIComponent(h.import_ref)}`, '_blank');
              };
              tbody.appendChild(tr);
          });
      }
      container.appendChild(histCard);
      body.appendChild(container);

    } catch(e) {
        console.error(e);
        body.innerHTML = `<div class="stat-card error">Chyba načítania: ${e.message}</div>`;
    }
  }

  function renderAddItem(shell){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.setAttribute("data-view","add");
    body.appendChild(buildAddItemPanel(shell));
  }

  // ------------- Suppliers (CRUD) -------------
  async function renderSuppliers(shell){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.appendChild(loading()); body.setAttribute("data-view","suppliers");

    try{
      const data = await apiRequest("/api/kancelaria/suppliers", "GET");
      const items = Array.isArray(data?.items) ? data.items : [];

      body.innerHTML = "";
      const card = el(`<div class="stat-card"><h4 style="margin:0 0 .5rem 0;">Dodávatelia</h4></div>`);
      const tools = el(`
        <div class="btn-grid" style="margin:0 0 1rem 0;">
          <button class="btn-secondary js-new"><i class="fa-solid fa-plus"></i> Pridať dodávateľa</button>
          <span style="flex:1"></span>
        </div>
      `);
      const tableWrap = el(`<div class="table-container"></div>`);
      const table = el(`
        <table>
          <thead><tr><th>Názov</th><th>Kategórie</th><th>Kontakt</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      `);
      tableWrap.appendChild(table);
      body.appendChild(card);
      body.appendChild(tools);
      body.appendChild(tableWrap);

      function draw(list){
        const tb = qs("tbody", table); tb.innerHTML = "";
        list.forEach(s => {
          const cats = (s.categories || []).join(", ");
          const contact = [s.phone, s.email].filter(Boolean).join(" · ");
          const tr = el(`<tr>
            <td>${txt(s.name)}</td>
            <td>${txt(cats)}</td>
            <td>${txt(contact)}</td>
            <td style="display:flex;gap:.5rem;">
              <button class="btn-secondary js-edit">Upraviť</button>
              <button class="btn-danger js-del">Zmazať</button>
            </td>
          </tr>`);
          qs(".js-edit", tr).addEventListener("click", () => openForm(s));
          qs(".js-del", tr).addEventListener("click", async () => {
            if (!confirm(`Zmazať dodávateľa ${s.name}?`)) return;
            try{
              await apiRequest(`/api/kancelaria/suppliers/${s.id}`, "DELETE");
              renderSuppliers(shell);
            }catch(e){ alert("Chyba: " + e.message); }
          });
          tb.appendChild(tr);
        });
      }

      function openForm(pref={}){
        const form = el(`
          <div class="stat-card">
            <h4 style="margin:0 0 .5rem 0;">${pref.id ? "Upraviť dodávateľa" : "Nový dodávateľ"}</h4>
            <div class="form-grid">
              <div class="form-group"><label>Názov</label><input class="js-name" value="${txt(pref.name)||""}"></div>
              <div class="form-group"><label>Telefón</label><input class="js-phone" value="${txt(pref.phone)||""}"></div>
              <div class="form-group"><label>Email</label><input class="js-email" value="${txt(pref.email)||""}"></div>
              <div class="form-group"><label>Adresa</label><input class="js-address" value="${txt(pref.address)||""}"></div>
              <div class="form-group">
                <label>Kategórie</label>
                <div class="checkbox-group">
                  <label><input type="checkbox" class="js-cat" value="koreniny"> Koreniny</label>
                  <label><input type="checkbox" class="js-cat" value="obal"> Obaly</label>
                  <label><input type="checkbox" class="js-cat" value="pomocny_material"> Pomocný materiál</label>
                </div>
              </div>
            </div>
            <div class="btn-grid" style="margin-top:.75rem;">
              <span></span>
              <button class="btn-success js-save"><i class="fa-solid fa-floppy-disk"></i> Uložiť</button>
            </div>
          </div>
        `);
        const cats = new Set(pref.categories || []);
        qsa(".js-cat", form).forEach(c => c.checked = cats.has(c.value));
        body.insertBefore(form, tableWrap);

        qs(".js-save", form).addEventListener("click", async ()=>{
          const name = qs(".js-name", form).value.trim();
          if (!name) { alert("Názov je povinný."); return; }
          const payload = {
            name,
            phone: qs(".js-phone", form).value.trim() || null,
            email: qs(".js-email", form).value.trim() || null,
            address: qs(".js-address", form).value.trim() || null,
            categories: qsa(".js-cat", form).filter(x=>x.checked).map(x=>x.value)
          };
          try{
            if (pref.id){
              await apiRequest(`/api/kancelaria/suppliers/${pref.id}`,"PUT",payload);
            } else {
              await apiRequest(`/api/kancelaria/suppliers`,"POST",payload);
            }
            renderSuppliers(shell);
          }catch(e){ alert("Chyba: " + e.message); }
        });
      }

      qs(".js-new", tools).addEventListener("click", () => openForm({}));
      draw(items);
    }catch(e){
      console.error(e);
      body.innerHTML = ""; body.appendChild(empty("Nepodarilo sa načítať dodávateľov."));
    }
  }

  // ------------- Products view (centrál – bez akcií) -------------
  async function renderProducts(shell){
    const body = qs("#stock-body", shell);
    body.innerHTML = ""; body.appendChild(loading()); body.setAttribute("data-view","products");
    const search = qs("#stock-search", shell);

    try{
      const data = await apiRequest("/api/kancelaria/getComprehensiveStockView");
      const grouped = data?.groupedByCategory || (() => {
        const g={}; (data?.products || []).forEach(p=>{
          const c = p.category || "Nezaradené";
          (g[c]||(g[c]=[])).push(p);
        });
        return g;
      })();

      body.innerHTML = "";

      const container = el(`<div></div>`);
      body.appendChild(container);

      function draw(groups){
        container.innerHTML = "";
        const cats = Object.keys(groups).sort((a,b)=> a.localeCompare(b, "sk"));
        if (!cats.length){ container.appendChild(empty("Žiadne produkty.")); return; }
        for (const cat of cats){
          const card = el(`<div class="stat-card" style="margin-bottom:1rem;"></div>`);
          card.appendChild(el(`<h4 style="margin:0 0 .5rem 0;">${txt(cat)}</h4>`));
          const wrap = el(`<div class="table-container"></div>`);
          const table = el(`
            <table>
              <thead><tr><th>Názov</th><th>Množstvo</th><th>Jedn.</th><th>Cena / kg</th></tr></thead>
              <tbody></tbody>
            </table>
          `);
          const tb = qs("tbody", table);
          (groups[cat] || []).forEach(p=>{
            const tr = el(`<tr><td>${txt(p.name)}</td><td>${fmt(p.quantity)}</td><td>${txt(p.unit||"kg")}</td><td>${fmt(p.price)}</td></tr>`);
            tb.appendChild(tr);
          });
          wrap.appendChild(table);
          card.appendChild(wrap);
          container.appendChild(card);
        }
      }

      function applyFilter(){
        const q = (search?.value || "").trim().toLowerCase();
        if (!q) { draw(grouped); return; }
        const g = {};
        Object.keys(grouped).forEach(cat=>{
          const f = (grouped[cat]||[]).filter(p =>
            txt(p.name).toLowerCase().includes(q) || txt(cat).toLowerCase().includes(q)
          );
          if (f.length) g[cat] = f;
        });
        draw(g);
      }

      draw(grouped);
      if (search){
        search._h && search.removeEventListener("input", search._h);
        search._h = ()=> applyFilter();
        search.addEventListener("input", search._h);
      }
    }catch(e){
      console.error(e);
      body.innerHTML = ""; body.appendChild(empty("Nepodarilo sa načítať celkový prehľad."));
    }
  }

  // ------------- init -------------
  window.initializeStockModule = function(){
    const shell = makeShell();
    mountInSectionStock(shell);
    renderRaw(shell); // default
  };
})(window, document);
