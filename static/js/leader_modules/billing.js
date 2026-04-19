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
            <button id="btn-bill-dls" class="btn btn-primary"><i class="fa-solid fa-layer-group"></i> Návrhy na doklady (Nové)</button>
            <button id="btn-uninvoiced-dls" class="btn btn-warning"><i class="fa-solid fa-file-signature"></i> Nevyfakturované DL (Zberné)</button>
            <button id="btn-bill-cash" class="btn btn-secondary"><i class="fa-solid fa-cash-register"></i> Hotovostný predaj</button>
          </div>
          <div id="billing-body"></div>
        </div>
      `;
      node.querySelector("#btn-bill-dls").addEventListener("click", () => {
          node.querySelectorAll('.btn-grid button').forEach(b => b.style.opacity = '0.5');
          node.querySelector("#btn-bill-dls").style.opacity = '1';
          renderReadyForInvoice(node);
      });
      node.querySelector("#btn-uninvoiced-dls").addEventListener("click", () => {
          node.querySelectorAll('.btn-grid button').forEach(b => b.style.opacity = '0.5');
          node.querySelector("#btn-uninvoiced-dls").style.opacity = '1';
          renderUninvoicedDLs(node);
      });
      return node;
    }
  
    // --- FÁZA 1: NÁVRHY (Vystavenie DL alebo DL+FA) ---
    async function renderReadyForInvoice(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam dáta z terminálov...</div></div>`;
        
        try {
            const data = await apiRequest("/api/billing/ready_for_invoice");
            body.innerHTML = "";
            
            if (!data.trasy || data.trasy.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> Žiadne nové návrhy. Všetko je vystavené.</div></div>`;
                return;
            }

            data.trasy.forEach(trasaObj => {
                const trasaDiv = document.createElement('div');
                trasaDiv.style.marginBottom = "2rem";
                trasaDiv.innerHTML = `<h3 style="background:#e2e8f0; padding:10px; border-radius:6px; color:#334155;"><i class="fas fa-truck"></i> Trasa: ${window.escapeHtml(trasaObj.trasa)}</h3>`;
                
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
                        <tr class="items-row" id="items-row-${obj.id}" style="display:none; background:#f8fafc;"><td colspan="5"><div class="p-2 text-center text-muted"><i class="fas fa-spinner fa-spin"></i> Načítavam...</div></td></tr>
                    `).join('');

                    card.innerHTML = `
                        <div class="card-body">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                                <div><h4 style="margin:0; color:#1e293b;">${window.escapeHtml(cust.nazov_firmy)}</h4></div>
                                <button class="btn btn-success btn-sm js-issue-docs">
                                    <i class="fa-solid fa-print"></i> Vystaviť doklady pre označené
                                </button>
                            </div>
                            <table class="table table-hover">
                                <thead style="background-color: #f1f5f9;"><tr><th style="text-align:center;"><input type="checkbox" class="js-select-all" checked></th><th>Návrh (Objednávka)</th><th>Dátum</th><th style="text-align:right">Suma</th><th></th></tr></thead>
                                <tbody>${objRows}</tbody>
                            </table>
                        </div>
                    `;

                    // Rozklikávanie a ukladanie
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
                                        let itemsHtml = `<table class="table table-sm table-bordered" style="background:#fff; margin:0;"><tr style="background:#e2e8f0;"><th>Produkt</th><th>Množstvo</th><th>MJ</th><th>Cena (bez DPH)</th></tr>`;
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
                                            try {
                                                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ukladám...';
                                                btn.disabled = true;
                                                await apiRequest('/api/billing/update_order_items', 'POST', { items: itemsToUpdate });
                                                btn.classList.replace('btn-primary', 'btn-success');
                                                btn.innerHTML = '<i class="fa-solid fa-check"></i> Uložené';
                                                setTimeout(() => { btn.classList.replace('btn-success', 'btn-primary'); btn.innerHTML = '<i class="fa-solid fa-save"></i> Uložiť zmeny'; btn.disabled = false; }, 2000);
                                            } catch (e) { alert('Chyba pri ukladaní: ' + e.message); btn.disabled = false; }
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

                    // --- VYSTAVENIE DOKLADOV (Voľba DL / FA) ---
                    card.querySelector('.js-issue-docs').addEventListener('click', async () => {
                        const selectedIds = Array.from(card.querySelectorAll('.dl-checkbox:checked')).map(cb => parseInt(cb.value));
                        if (selectedIds.length === 0) return alert("Vyberte aspoň jeden návrh!");

                        // Vyskakovacie okno s otázkou
                        if(confirm(`Idete vystaviť doklady a ODPÍSAŤ TOVAR ZO SKLADU.\n\nKliknite na OK pre vystavenie Dodacieho listu + Faktúry (ÁNO).\nKliknite na ZRUŠIŤ pre vystavenie Iba Dodacieho listu (NIE).`)) {
                            // ÁNO = DL + FA
                            issueDocs(selectedIds, true);
                        } else {
                            // NIE = Len DL
                            issueDocs(selectedIds, false);
                        }
                    });

                    async function issueDocs(ids, createFa) {
                        try {
                            const res = await apiRequest('/api/billing/issue_documents', 'POST', { order_ids: ids, create_fa: createFa });
                            alert(res.message);
                            renderReadyForInvoice(shell); // Refresh
                        } catch (e) {
                            alert("Chyba: " + e.message);
                        }
                    }

                    trasaDiv.appendChild(card);
                });
                body.appendChild(trasaDiv);
            });
        } catch (error) {
            body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba načítania: ${error.message}</div></div>`;
        }
    }

    // --- FÁZA 2: NEVYFAKTUROVANÉ DL (Zberná fakturácia) ---
    async function renderUninvoicedDLs(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam nevyfakturované DL...</div></div>`;
        
        try {
            const data = await apiRequest("/api/billing/uninvoiced_dls");
            body.innerHTML = "";
            
            if (!data.zakaznici || data.zakaznici.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> Všetky dodacie listy sú vyfakturované.</div></div>`;
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
                            <div><h4 style="margin:0; color:#1e293b;">${window.escapeHtml(cust.nazov_firmy)}</h4><small>${window.escapeHtml(cust.trasa)}</small></div>
                            <button class="btn btn-warning btn-sm js-create-zberna">
                                <i class="fa-solid fa-file-invoice"></i> Vystaviť Zbernú Faktúru
                            </button>
                        </div>
                        <table class="table table-hover">
                            <thead style="background-color: #f1f5f9;"><tr><th style="text-align:center;"><input type="checkbox" class="js-select-all" checked></th><th>Dodací list</th><th>Dátum</th><th style="text-align:right">Suma DL</th></tr></thead>
                            <tbody>${dlRows}</tbody>
                        </table>
                    </div>
                `;

                card.querySelector('.js-select-all').addEventListener('change', (e) => {
                    card.querySelectorAll('.zberna-checkbox').forEach(cb => cb.checked = e.target.checked);
                });

                card.querySelector('.js-create-zberna').addEventListener('click', async () => {
                    const selectedIds = Array.from(card.querySelectorAll('.zberna-checkbox:checked')).map(cb => parseInt(cb.value));
                    if (selectedIds.length === 0) return alert("Vyberte aspoň jeden Dodací list!");

                    if(confirm(`Vytvoriť Zbernú faktúru pre zákazníka ${cust.nazov_firmy}?`)) {
                        try {
                            const res = await apiRequest('/api/billing/create_collective_invoice', 'POST', { dl_ids: selectedIds });
                            alert(res.message);
                            renderUninvoicedDLs(shell); // Refresh
                        } catch (e) { alert("Chyba: " + e.message); }
                    }
                });
                body.appendChild(card);
            });
        } catch (error) {
            body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba načítania: ${error.message}</div></div>`;
        }
    }
  
    window.initializeLeaderBillingModule = function() {
      const shell = makeShell();
      mount(shell);
      shell.querySelector("#btn-bill-dls").style.opacity = '1';
      renderReadyForInvoice(shell);
    };
})(window, document);