;(function (window, document) {
    'use strict';

    window.escapeHtml = window.escapeHtml || function(text) {
        if (text === null || text === undefined) return "";
        return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };

    async function apiRequest(url, method = "GET", body = null) {
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }
  
    function mount(node) {
      const host = document.getElementById("section-billing");
      if (!host) return;
      host.innerHTML = "";
      host.appendChild(node);
    }
  
    function makeShell() {
      const node = document.createElement('div');
      node.innerHTML = `
        <div class="billing-shell">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
              <h2 style="margin:0; color:#1e293b;"><i class="fa-solid fa-file-invoice-dollar"></i> Sklady a Fakturácia</h2>
          </div>
          <div class="btn-grid" style="margin-bottom:1rem; display:flex; gap:10px;">
            <button id="btn-bill-dls" class="btn btn-primary"><i class="fa-solid fa-layer-group"></i> Návrhy dokladov</button>
            <button id="btn-uninvoiced-dls" class="btn btn-warning"><i class="fa-solid fa-file-signature"></i> Zberná fakturácia (Nevyfakturované DL)</button>
            <button id="btn-issued-docs" class="btn btn-info" style="color:white;"><i class="fa-solid fa-folder-open"></i> Vystavené doklady (TLAČ)</button>
          </div>
          <div id="billing-body"></div>
        </div>
      `;
      
      const resetButtons = () => node.querySelectorAll('.btn-grid button').forEach(b => b.style.opacity = '0.5');

      node.querySelector("#btn-bill-dls").addEventListener("click", () => {
          resetButtons(); node.querySelector("#btn-bill-dls").style.opacity = '1';
          renderReadyForInvoice(node);
      });
      node.querySelector("#btn-uninvoiced-dls").addEventListener("click", () => {
          resetButtons(); node.querySelector("#btn-uninvoiced-dls").style.opacity = '1';
          renderUninvoicedDLs(node);
      });
      node.querySelector("#btn-issued-docs").addEventListener("click", () => {
          resetButtons(); node.querySelector("#btn-issued-docs").style.opacity = '1';
          renderIssuedDocs(node);
      });
      return node;
    }
  
    // --- PROFI VYSKAKOVACIE OKNO PRE TLAČ ---
    function showPrintModal(onConfirm) {
        const overlay = document.createElement('div');
        overlay.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.7); z-index:9999; display:flex; justify-content:center; align-items:center; backdrop-filter: blur(4px);";
        
        const box = document.createElement('div');
        box.style = "background:#fff; padding:40px; border-radius:16px; width:550px; max-width:90%; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); text-align:center; animation: popIn 0.3s ease-out;";
        
        // Pridáme malú CSS animáciu priamo sem pre plynulý nábeh
        if(!document.getElementById('modal-styles')) {
            const s = document.createElement('style');
            s.id = 'modal-styles';
            s.innerHTML = `@keyframes popIn { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
                           .btn-print-choice { transition: all 0.2s; border: 2px solid transparent; }
                           .btn-print-choice:hover { transform: translateY(-3px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }`;
            document.head.appendChild(s);
        }

        box.innerHTML = `
            <div style="background:#eff6ff; width:80px; height:80px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin: 0 auto 20px auto; color:#3b82f6; font-size:35px;">
                <i class="fa-solid fa-print"></i>
            </div>
            <h2 style="margin-top:0; color:#1e293b; font-weight:800;">Tlač dokladov a Odpis skladu</h2>
            <p style="color:#64748b; margin-bottom:30px; font-size:15px;">Vyberte, aký balík dokladov chcete vygenerovať. Tovar bude <strong>okamžite odpísaný zo skladu</strong> a spustí sa automatická tlač.</p>
            
            <div style="display:flex; flex-direction:column; gap:15px;">
                <button id="btn-print-dlfa" class="btn btn-success btn-lg btn-print-choice" style="padding:20px; font-size:18px; font-weight:bold; background:#10b981; border-color:#059669;">
                    <i class="fa-solid fa-file-invoice-dollar" style="margin-right:10px;"></i> Vystaviť DL + Faktúru
                    <div style="font-size:13px; font-weight:normal; opacity:0.9; margin-top:5px;">(Vytlačia sa automaticky 2 kópie DL a 2 kópie FA)</div>
                </button>
                
                <button id="btn-print-dl" class="btn btn-primary btn-lg btn-print-choice" style="padding:20px; font-size:18px; font-weight:bold; background:#3b82f6; border-color:#2563eb;">
                    <i class="fa-solid fa-file-lines" style="margin-right:10px;"></i> Vystaviť Iba Dodací list
                    <div style="font-size:13px; font-weight:normal; opacity:0.9; margin-top:5px;">(Vytlačia sa automaticky 4 kópie DL)</div>
                </button>
                
                <button id="btn-print-cancel" class="btn btn-light" style="margin-top:15px; font-weight:bold; color:#64748b;">Zrušiť a vrátiť sa späť</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Akcie po kliknutí na tlačidlá v modale
        box.querySelector('#btn-print-dlfa').onclick = () => { document.body.removeChild(overlay); onConfirm(true); };
        box.querySelector('#btn-print-dl').onclick = () => { document.body.removeChild(overlay); onConfirm(false); };
        box.querySelector('#btn-print-cancel').onclick = () => { document.body.removeChild(overlay); };
    }

    // --- FÁZA 1: NÁVRHY ---
    async function renderReadyForInvoice(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam návrhy...</div></div>`;
        try {
            const data = await apiRequest("/api/billing/ready_for_invoice");
            body.innerHTML = "";
            if (!data.trasy || data.trasy.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> Žiadne nové návrhy.</div></div>`;
                return;
            }

            data.trasy.forEach(trasaObj => {
                const trasaDiv = document.createElement('div');
                trasaDiv.style.marginBottom = "2rem";
                trasaDiv.innerHTML = `<h3 style="background:#e2e8f0; padding:10px; border-radius:6px;"><i class="fas fa-truck"></i> Trasa: ${window.escapeHtml(trasaObj.trasa)}</h3>`;
                
                trasaObj.zakaznici.forEach(cust => {
                    const card = document.createElement('div');
                    card.className = "card";
                    card.style.marginBottom = "1rem";
                    card.style.borderLeft = "4px solid #3b82f6";
                    
                    let objRows = cust.objednavky.map(obj => `
                        <tr class="obj-row" data-id="${obj.id}">
                            <td style="width: 40px; text-align: center;"><input type="checkbox" class="dl-checkbox" value="${obj.id}" checked style="transform: scale(1.2);"></td>
                            <td><strong>${obj.cislo}</strong></td>
                            <td>${new Date(obj.datum).toLocaleDateString('sk-SK')}</td>
                            <td style="text-align:right; font-weight:bold;">${Number(obj.suma).toFixed(2)} €</td>
                            <td style="width: 50px; text-align:center;"><button class="btn btn-sm btn-light toggle-items-btn" title="Upraviť položky"><i class="fas fa-chevron-down"></i></button></td>
                        </tr>
                        <tr class="items-row" id="items-row-${obj.id}" style="display:none; background:#f8fafc;"><td colspan="5"><div class="p-2 text-center"><i class="fas fa-spinner fa-spin"></i> Načítavam...</div></td></tr>
                    `).join('');

                    card.innerHTML = `
                        <div class="card-body">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                                <div><h4 style="margin:0;">${window.escapeHtml(cust.nazov_firmy)}</h4></div>
                                <button class="btn btn-success btn-sm js-issue-docs"><i class="fa-solid fa-print"></i> Vystaviť doklady (Výber tlače)</button>
                            </div>
                            <table class="table table-hover">
                                <thead style="background:#f1f5f9;"><tr><th style="text-align:center;"><input type="checkbox" class="js-select-all" checked></th><th>Návrh (Obj.)</th><th>Dátum</th><th style="text-align:right">Suma</th><th></th></tr></thead>
                                <tbody>${objRows}</tbody>
                            </table>
                        </div>
                    `;

                    // Rozklikávanie a ukladanie položiek
                    card.querySelectorAll('.toggle-items-btn').forEach(btn => {
                        btn.onclick = async function() {
                            const tr = this.closest('.obj-row');
                            const orderId = tr.getAttribute('data-id');
                            const itemsRow = card.querySelector(`#items-row-${orderId}`);
                            const icon = this.querySelector('i');
                            
                            if (itemsRow.style.display === 'none') {
                                itemsRow.style.display = 'table-row';
                                icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
                                if (itemsRow.innerHTML.includes('fa-spinner')) {
                                    try {
                                        const res = await apiRequest(`/api/billing/order_items/${orderId}`);
                                        let itemsHtml = `<table class="table table-sm table-bordered" style="background:#fff; margin:0;"><tr style="background:#e2e8f0;"><th>Produkt</th><th>Množstvo</th><th>MJ</th><th>Cena/MJ</th></tr>`;
                                        res.items.forEach(it => {
                                            itemsHtml += `<tr><td>${window.escapeHtml(it.name)}</td><td><input type="number" class="form-control form-control-sm edit-qty" data-item-id="${it.id}" value="${it.qty}" step="0.01" style="width:80px;"></td><td>${it.mj}</td><td><input type="number" class="form-control form-control-sm edit-price" data-item-id="${it.id}" value="${it.price}" step="0.01" style="width:80px;"></td></tr>`;
                                        });
                                        itemsHtml += `</table><div style="text-align:right; padding:5px;"><button class="btn btn-sm btn-primary save-edits-btn"><i class="fa-solid fa-save"></i> Uložiť zmeny</button></div>`;
                                        itemsRow.querySelector('td').innerHTML = itemsHtml;

                                        itemsRow.querySelector('.save-edits-btn').addEventListener('click', async function() {
                                            const btn = this;
                                            const inputsQty = itemsRow.querySelectorAll('.edit-qty');
                                            const inputsPrice = itemsRow.querySelectorAll('.edit-price');
                                            const itemsToUpdate = [];
                                            for (let i = 0; i < inputsQty.length; i++) {
                                                itemsToUpdate.push({ id: inputsQty[i].getAttribute('data-item-id'), mnozstvo: parseFloat(inputsQty[i].value), cena_bez_dph: parseFloat(inputsPrice[i].value) });
                                            }
                                            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>...'; btn.disabled = true;
                                            await apiRequest('/api/billing/update_order_items', 'POST', { items: itemsToUpdate });
                                            btn.innerHTML = '<i class="fa-solid fa-check"></i> OK';
                                            setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-save"></i> Uložiť zmeny'; btn.disabled = false; }, 1500);
                                        });
                                    } catch (e) { itemsRow.querySelector('td').innerHTML = `<span style="color:red;">Chyba: ${e.message}</span>`; }
                                }
                            } else {
                                itemsRow.style.display = 'none';
                                icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
                            }
                        };
                    });

                    card.querySelector('.js-select-all').addEventListener('change', (e) => {
                        card.querySelectorAll('.dl-checkbox').forEach(cb => cb.checked = e.target.checked);
                    });

                    // TLAČIDLO VYSTAVIŤ DOKLADY -> OTVÁRA PROFI OKNO
                    card.querySelector('.js-issue-docs').addEventListener('click', async () => {
                        const selectedIds = Array.from(card.querySelectorAll('.dl-checkbox:checked')).map(cb => parseInt(cb.value));
                        if (selectedIds.length === 0) return alert("Vyberte aspoň jeden návrh!");

                        // Zavoláme našu novú profi funkciu
                        showPrintModal((createFa) => {
                            issueDocs(selectedIds, createFa);
                        });
                    });

                    async function issueDocs(ids, createFa) {
                        try {
                            // Tmavý overlay kým sa to spracúva na servery
                            const loadingOverlay = document.createElement('div');
                            loadingOverlay.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.8); z-index:9999; display:flex; justify-content:center; align-items:center; font-size:24px; font-weight:bold; color:#2563eb;";
                            loadingOverlay.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:15px;"></i> Vystavujem doklady...';
                            document.body.appendChild(loadingOverlay);

                            const res = await apiRequest('/api/billing/issue_documents', 'POST', { order_ids: ids, create_fa: createFa });
                            
                            document.body.removeChild(loadingOverlay);
                            
                            // OKAMŽITÉ OTVORENIE TLAČOVÉHO BALÍKA V NOVOM OKNE
                            let printUrl = `/api/billing/print_pack?dl_id=${res.dl_id}`;
                            if (createFa && res.fa_id) {
                                printUrl += `&fa_id=${res.fa_id}`;
                            }
                            window.open(printUrl, '_blank');

                            // Refreshnem zoznam návrhov v pozadí
                            renderReadyForInvoice(shell);
                        } catch (e) { 
                            alert("Chyba pri vystavovaní: " + e.message); 
                        }
                    }

                    trasaDiv.appendChild(card);
                });
                body.appendChild(trasaDiv);
            });
        } catch (error) { body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba: ${error.message}</div></div>`; }
    }

    // --- FÁZA 2: NEVYFAKTUROVANÉ DL ---
    async function renderUninvoicedDLs(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam nevyfakturované DL...</div></div>`;
        try {
            const data = await apiRequest("/api/billing/uninvoiced_dls");
            body.innerHTML = "";
            if (!data.zakaznici || data.zakaznici.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;">Všetky dodacie listy sú vyfakturované.</div></div>`;
                return;
            }

            data.zakaznici.forEach(cust => {
                const card = document.createElement('div');
                card.className = "card";
                card.style.marginBottom = "1rem";
                card.style.borderLeft = "4px solid #f59e0b";
                
                let dlRows = cust.dodacie_listy.map(dl => `
                    <tr>
                        <td style="width: 40px; text-align: center;"><input type="checkbox" class="zberna-checkbox" value="${dl.dl_id}" checked style="transform: scale(1.2);"></td>
                        <td><strong>DL č. ${dl.cislo_dl}</strong></td>
                        <td>${new Date(dl.datum).toLocaleDateString('sk-SK')}</td>
                        <td style="text-align:right; font-weight:bold;">${Number(dl.suma).toFixed(2)} €</td>
                    </tr>
                `).join('');

                card.innerHTML = `
                    <div class="card-body">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                            <div><h4 style="margin:0;">${window.escapeHtml(cust.nazov_firmy)}</h4><small>${window.escapeHtml(cust.trasa)}</small></div>
                            <button class="btn btn-warning btn-sm js-create-zberna"><i class="fa-solid fa-file-invoice"></i> Vystaviť Zbernú Faktúru</button>
                        </div>
                        <table class="table table-hover">
                            <thead style="background:#f1f5f9;"><tr><th style="text-align:center;"><input type="checkbox" class="js-select-all" checked></th><th>Dodací list</th><th>Dátum</th><th style="text-align:right">Suma DL</th></tr></thead>
                            <tbody>${dlRows}</tbody>
                        </table>
                    </div>
                `;

                card.querySelector('.js-select-all').addEventListener('change', (e) => card.querySelectorAll('.zberna-checkbox').forEach(cb => cb.checked = e.target.checked));
                card.querySelector('.js-create-zberna').addEventListener('click', async () => {
                    const selectedIds = Array.from(card.querySelectorAll('.zberna-checkbox:checked')).map(cb => parseInt(cb.value));
                    if (selectedIds.length === 0) return alert("Vyberte aspoň jeden Dodací list!");
                    if(confirm(`Vytvoriť Zbernú faktúru pre zákazníka ${cust.nazov_firmy}?`)) {
                        try {
                            const res = await apiRequest('/api/billing/create_collective_invoice', 'POST', { dl_ids: selectedIds });
                            alert(res.message + "\\n\\nNájdeš ju v záložke Vystavené doklady (TLAČ).");
                            renderUninvoicedDLs(shell);
                        } catch (e) { alert("Chyba: " + e.message); }
                    }
                });
                body.appendChild(card);
            });
        } catch (error) { body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba: ${error.message}</div></div>`; }
    }

    // --- FÁZA 3: ARCHÍV A TLAČ DOKLADOV ---
    async function renderIssuedDocs(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam archív dokladov...</div></div>`;
        try {
            const data = await apiRequest("/api/billing/issued_documents");
            if (!data.documents || data.documents.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body">Zatiaľ neboli vystavené žiadne doklady.</div></div>`;
                return;
            }
            
            let rows = data.documents.map(d => `
                <tr>
                    <td><strong>${d.cislo_dokladu}</strong> <span class="badge ${d.typ_dokladu === 'FA' ? 'bg-success' : 'bg-primary'}">${d.typ_dokladu}</span></td>
                    <td>${d.datum}</td>
                    <td>${window.escapeHtml(d.odberatel_nazov)}</td>
                    <td style="text-align:right; font-weight:bold;">${Number(d.suma_s_dph).toFixed(2)} €</td>
                    <td style="text-align:center;">
                        <button class="btn btn-sm btn-info print-doc-btn" data-id="${d.id}" style="color:white;">
                            <i class="fa-solid fa-print"></i> Zobraziť a Tlačiť
                        </button>
                    </td>
                </tr>
            `).join('');

            body.innerHTML = `
                <div class="card">
                    <div class="card-body">
                        <h3 style="margin-bottom:20px; color:#1e293b;">Vystavené doklady (Posledných 100)</h3>
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead style="background:#f1f5f9;">
                                    <tr><th>Číslo Dokladu</th><th>Dátum</th><th>Odberateľ</th><th style="text-align:right">Suma s DPH</th><th style="text-align:center">Akcia</th></tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            
            body.querySelectorAll('.print-doc-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const docId = this.getAttribute('data-id');
                    // Otvorí HTML šablónu na tlač v novej karte
                    window.open('/api/billing/print/' + docId, '_blank');
                });
            });
            
        } catch(e) {
            body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba: ${e.message}</div></div>`;
        }
    }
  
    window.initializeLeaderBillingModule = function() {
      const shell = makeShell();
      mount(shell);
      shell.querySelector("#btn-bill-dls").style.opacity = '1';
      renderReadyForInvoice(shell);
    };
})(window, document);