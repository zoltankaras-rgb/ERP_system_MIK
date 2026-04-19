;(function (window, document) {
    'use strict';

    // 1. OPRAVA: BEZPEČNOSTNÁ FUNKCIA (Zabráni chybe escapeHtml is not a function)
    window.escapeHtml = function(text) {
        if (text === null || text === undefined) return "";
        return text.toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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
            <button id="btn-bill-dls" class="btn btn-primary"><i class="fa-solid fa-layer-group"></i> Čakajúce na fakturáciu</button>
            <button id="btn-bill-cash" class="btn btn-secondary"><i class="fa-solid fa-cash-register"></i> Hotovostný predaj</button>
          </div>
          <div id="billing-body"></div>
        </div>
      `;
      node.querySelector("#btn-bill-dls").addEventListener("click", () => renderReadyForInvoice(node));
      return node;
    }
  
    async function renderReadyForInvoice(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam dáta z terminálov...</div></div>`;
        
        try {
            const data = await apiRequest("/api/billing/ready_for_invoice");
            body.innerHTML = "";
            
            if (!data.trasy || data.trasy.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> Všetky ukončené objednávky sú vyfakturované.</div></div>`;
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
                    card.style.borderLeft = cust.typ_fakturacie === 'Zberná' ? "4px solid #3b82f6" : "4px solid #f59e0b";
                    
                    let objRows = cust.objednavky.map(obj => `
                        <tr class="obj-row" data-id="${obj.id}">
                            <td style="width: 40px; text-align: center;">
                                <input type="checkbox" class="dl-checkbox" value="${obj.id}" checked style="transform: scale(1.2);">
                            </td>
                            <td><strong>${obj.cislo}</strong></td>
                            <td>${new Date(obj.datum).toLocaleDateString('sk-SK')}</td>
                            <td style="text-align:right; font-weight:bold;">${Number(obj.suma).toFixed(2)} €</td>
                            <td style="width: 50px; text-align:center;">
                                <button class="btn btn-sm btn-light toggle-items-btn" title="Upraviť položky"><i class="fas fa-chevron-down"></i></button>
                            </td>
                        </tr>
                        <tr class="items-row" id="items-row-${obj.id}" style="display:none; background:#f8fafc;">
                            <td colspan="5">
                                <div class="p-2 text-center text-muted"><i class="fas fa-spinner fa-spin"></i> Načítavam položky...</div>
                            </td>
                        </tr>
                    `).join('');

                    card.innerHTML = `
                        <div class="card-body">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                                <div>
                                    <h4 style="margin:0; color:#1e293b;">${window.escapeHtml(cust.nazov_firmy)}</h4>
                                    <span class="badge" style="background:${cust.typ_fakturacie === 'Zberná' ? '#dbeafe; color:#1e40af' : '#fef3c7; color:#b45309'};">${window.escapeHtml(cust.typ_fakturacie)} fakturácia</span>
                                </div>
                                <button class="btn btn-success btn-sm js-create-fa" data-zid="${cust.zakaznik_id}">
                                    <i class="fa-solid fa-file-invoice"></i> Vyfakturovať označené
                                </button>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-hover">
                                    <thead style="background-color: #f1f5f9;">
                                        <tr>
                                            <th style="text-align: center;"><input type="checkbox" class="js-select-all" checked></th>
                                            <th>Číslo Objednávky</th>
                                            <th>Dátum rozvozu</th>
                                            <th style="text-align:right">Suma s DPH</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>${objRows}</tbody>
                                </table>
                            </div>
                        </div>
                    `;

                    // Rozklikávanie (Accordion) a úprava položiek
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
                                        let itemsHtml = `<table class="table table-sm table-bordered" style="background:#fff; margin:0;">
                                            <tr style="background:#e2e8f0;"><th>Produkt</th><th>EAN</th><th>Množstvo</th><th>MJ</th><th>Cena (bez DPH)</th></tr>`;
                                        
                                        res.items.forEach(it => {
                                            itemsHtml += `<tr>
                                                <td>${window.escapeHtml(it.name)}</td>
                                                <td><small class="text-muted">${it.ean}</small></td>
                                                <td><input type="number" class="form-control form-control-sm edit-qty" data-item-id="${it.id}" value="${it.qty}" step="0.01" style="width:80px;"></td>
                                                <td>${it.mj}</td>
                                                <td><input type="number" class="form-control form-control-sm edit-price" data-item-id="${it.id}" value="${it.price}" step="0.01" style="width:80px;"></td>
                                            </tr>`;
                                        });
                                        itemsHtml += `</table>
                                        <div style="text-align:right; padding:5px;">
                                            <button class="btn btn-sm btn-primary save-edits-btn" data-order-id="${orderId}">
                                                <i class="fa-solid fa-save"></i> Uložiť zmeny položiek
                                            </button>
                                        </div>`;
                                        itemsRow.querySelector('td').innerHTML = itemsHtml;

                                        // 2. OPRAVA: PRIDANIE AKCIE NA TLAČIDLO ULOŽIŤ
                                        const saveBtn = itemsRow.querySelector('.save-edits-btn');
                                        saveBtn.addEventListener('click', async function() {
                                            const btn = this;
                                            const inputsQty = itemsRow.querySelectorAll('.edit-qty');
                                            const inputsPrice = itemsRow.querySelectorAll('.edit-price');
                                            
                                            const itemsToUpdate = [];
                                            for (let i = 0; i < inputsQty.length; i++) {
                                                itemsToUpdate.push({
                                                    id: inputsQty[i].getAttribute('data-item-id'),
                                                    mnozstvo: parseFloat(inputsQty[i].value),
                                                    cena_bez_dph: parseFloat(inputsPrice[i].value)
                                                });
                                            }
                                            
                                            try {
                                                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ukladám...';
                                                btn.disabled = true;

                                                await apiRequest('/api/billing/update_order_items', 'POST', { items: itemsToUpdate });
                                                
                                                btn.classList.replace('btn-primary', 'btn-success');
                                                btn.innerHTML = '<i class="fa-solid fa-check"></i> Uložené';
                                                
                                                setTimeout(() => {
                                                    btn.classList.replace('btn-success', 'btn-primary');
                                                    btn.innerHTML = '<i class="fa-solid fa-save"></i> Uložiť zmeny položiek';
                                                    btn.disabled = false;
                                                }, 2000);
                                                
                                            } catch (e) {
                                                alert('Chyba pri ukladaní: ' + e.message);
                                                btn.innerHTML = '<i class="fa-solid fa-save"></i> Uložiť zmeny položiek';
                                                btn.disabled = false;
                                            }
                                        });
                                        
                                    } catch (e) {
                                        itemsRow.querySelector('td').innerHTML = `<span style="color:red;">Chyba: ${e.message}</span>`;
                                    }
                                }
                            } else {
                                itemsRow.style.display = 'none';
                                icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
                            }
                        };
                    });

                    const selectAllBtn = card.querySelector('.js-select-all');
                    const checkboxes = card.querySelectorAll('.dl-checkbox');
                    selectAllBtn.addEventListener('change', (e) => {
                        checkboxes.forEach(cb => cb.checked = e.target.checked);
                    });

                    trasaDiv.appendChild(card);
                });
                
                body.appendChild(trasaDiv);
            });
            
        } catch (error) {
            body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba načítania: ${error.message}</div></div>`;
        }
    }
  
    window.initializeLeaderBillingModule = function() {
      const shell = makeShell();
      mount(shell);
      renderReadyForInvoice(shell);
    };
})(window, document);