;(function (window, document) {
    'use strict';
  
    // Helper pre API volania (Líder používa rovnaké API)
    async function apiRequest(url, method = "GET", body = null) {
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }
  
    function mount(node) {
      const host = document.getElementById("section-billing"); // Musí existovať v leaderexpediction.html
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
            <button id="btn-bill-dls" class="btn btn-primary"><i class="fa-solid fa-layer-group"></i> Nevyfakturované DL (Zberné FA)</button>
            <button id="btn-bill-cash" class="btn btn-secondary"><i class="fa-solid fa-cash-register"></i> Hotovostný predaj</button>
            <button id="btn-bill-archive" class="btn btn-secondary"><i class="fa-solid fa-box-archive"></i> Archív Dokladov</button>
          </div>
          <div id="billing-body"></div>
        </div>
      `;
  
      node.querySelector("#btn-bill-dls").addEventListener("click", () => renderUninvoicedDLs(node));
      
      return node;
    }
  
    async function renderUninvoicedDLs(shell) {
        const body = shell.querySelector("#billing-body");
        body.innerHTML = `<div class="card"><div class="card-body"><i class="fa-solid fa-spinner fa-spin"></i> Načítavam dáta...</div></div>`;
        
        try {
            const data = await apiRequest("/api/billing/uninvoiced_dls");
            body.innerHTML = "";
            
            if (!data.customers || data.customers.length === 0) {
                body.innerHTML = `<div class="card"><div class="card-body" style="color:#16a34a; font-weight:bold;"><i class="fa-solid fa-check-circle"></i> Všetky dodacie listy sú vyfakturované. Skvelá práca!</div></div>`;
                return;
            }

            data.customers.forEach(cust => {
                const card = document.createElement('div');
                card.className = "card";
                card.style.marginBottom = "1rem";
                
                let dlRows = cust.dodaky.map(dl => `
                    <tr>
                        <td style="width: 50px; text-align: center;">
                            <input type="checkbox" class="dl-checkbox" value="${dl.id}" data-sum="${dl.suma_s_dph}" checked style="transform: scale(1.2);">
                        </td>
                        <td><strong>${dl.cislo_dokladu}</strong></td>
                        <td>${new Date(dl.datum_vystavenia).toLocaleDateString('sk-SK')}</td>
                        <td style="text-align:right; font-weight:bold;">${Number(dl.suma_s_dph).toFixed(2)} €</td>
                    </tr>
                `).join('');

                card.innerHTML = `
                    <div class="card-body">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                            <h4 style="margin:0; color:#1e293b;">${cust.nazov} <span style="color:#64748b; font-size:0.9em; font-weight:normal;">(${cust.dodaky.length} nevyfakturovaných DL)</span></h4>
                            <button class="btn btn-success btn-sm js-create-fa" data-zid="${cust.zakaznik_id}">
                                <i class="fa-solid fa-file-invoice"></i> Vystaviť Zbernú Faktúru
                            </button>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-striped table-hover">
                                <thead style="background-color: #f8fafc;">
                                    <tr>
                                        <th style="text-align: center;"><input type="checkbox" class="js-select-all" checked title="Označiť všetko"></th>
                                        <th>Číslo DL</th>
                                        <th>Dátum</th>
                                        <th style="text-align:right">Suma s DPH</th>
                                    </tr>
                                </thead>
                                <tbody>${dlRows}</tbody>
                            </table>
                        </div>
                    </div>
                `;

                // Logika pre checkbox "Označiť všetko"
                const selectAllBtn = card.querySelector('.js-select-all');
                const checkboxes = card.querySelectorAll('.dl-checkbox');
                selectAllBtn.addEventListener('change', (e) => {
                    checkboxes.forEach(cb => cb.checked = e.target.checked);
                });

                // Logika pre Vystavenie Faktúry
                card.querySelector('.js-create-fa').addEventListener('click', async () => {
                    const selectedIds = Array.from(checkboxes).filter(cb => cb.checked).map(cb => parseInt(cb.value));
                    if (selectedIds.length === 0) return alert("Vyberte aspoň jeden dodací list!");
                    
                    if (!confirm(`Naozaj vystaviť Zbernú faktúru z ${selectedIds.length} dodacích listov pre ${cust.nazov}?`)) return;

                    try {
                        // Voláme ten istý backend endpoint, aký sme vytvorili v billing_handler.py
                        const res = await apiRequest("/api/billing/create_collective_invoice", "POST", { dl_ids: selectedIds });
                        alert(res.message);
                        renderUninvoicedDLs(shell); // Obnoví zoznam
                    } catch (error) {
                        alert("Chyba: " + error.message);
                    }
                });

                body.appendChild(card);
            });
            
        } catch (error) {
            body.innerHTML = `<div class="card"><div class="card-body" style="color:red;">Chyba načítania: ${error.message}</div></div>`;
        }
    }
  
    // Inicializácia modulu (Líder)
    window.initializeLeaderBillingModule = function() {
      const shell = makeShell();
      mount(shell);
      renderUninvoicedDLs(shell); // Zobrazí sa ako prvé po otvorení modulu
    };
  })(window, document);