let nakupCart = [];
let nakupChartInstance = null;
let dodavateliaList = [];
let produktyList = [];

window.renderNakupModule = async function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<div style="padding:40px; text-align:center; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Načítavam dáta...</div>';

    try {
        const [dodavateliaRes, produktyRes] = await Promise.all([
            fetch('/api/kancelaria/suppliers').then(r => r.json()),
            fetch('/api/kancelaria/nakup/produkty').then(r => r.json())
        ]);
        dodavateliaList = dodavateliaRes.items || [];
        produktyList = produktyRes.products || [];
    } catch (e) {
        console.error("Chyba pri načítaní dát:", e);
    }

    const today = new Date().toISOString().split('T')[0];

    let dodavateliaOptions = '<option value="">-- Vyberte dodávateľa --</option>';
    dodavateliaList.forEach(d => {
        dodavateliaOptions += `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
    });

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px;">
            <h2 style="color: #1e3a8a; margin: 0;"><i class="fas fa-shopping-cart"></i> Nákupy a Objednávky</h2>
            <div class="btn-grid" style="display:flex; gap:10px;">
                <button class="btn btn-primary js-nakup-tab active" data-target="nakup-nova">Nová Objednávka</button>
                <button class="btn btn-secondary js-nakup-tab" data-target="nakup-prehlad" onclick="nacitatPrehladNakupov()">Prehľad nákupov</button>
            </div>
        </div>

        <div id="nakup-nova" class="nakup-view">
            <div style="display:flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 350px; background: #fff; padding: 25px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                    <h4 style="margin-top: 0; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">1. Hlavička dokladu</h4>
                    
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight:bold; color:#475569;">Dodávateľ <span style="color:red">*</span></label>
                        <div style="display:flex; gap:10px;">
                            <select id="nakup-dodavatel" class="filter-input" style="flex:1; font-weight:bold; color:#0f172a;" required>
                                ${dodavateliaOptions}
                            </select>
                            <button class="btn btn-primary" onclick="window.pridatNovehoDodavatela()" title="Pridať nového dodávateľa">➕ Nový</button>
                        </div>
                    </div>

                    <div style="display:flex; gap:15px; margin-bottom: 15px;">
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:bold; color:#475569;">Dátum vystavenia</label>
                            <input type="date" id="nakup-datum" class="filter-input" style="width: 100%;" value="${today}" required>
                        </div>
                        <div class="form-group" style="flex:1;">
                            <label style="font-weight:bold; color:#475569;">Očakávané dodanie</label>
                            <input type="date" id="nakup-datum-dodania" class="filter-input" style="width: 100%;" value="${today}">
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="font-weight:bold; color:#475569;">Poznámka</label>
                        <input type="text" id="nakup-poznamka" class="filter-input" style="width: 100%;" placeholder="Interná poznámka...">
                    </div>

                    <h4 style="margin-top: 0; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">2. Pridanie položiek</h4>
                    
                    <div style="background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; position: relative;">
                        <div class="form-group">
                            <label style="font-size:0.85rem; font-weight:bold; color:#0284c7;">Hľadať produkt (Názov / EAN)</label>
                            <div style="display:flex; gap:10px;">
                                <input type="text" id="nakup-search-prod" class="filter-input" placeholder="Začnite písať názov..." style="flex:1; font-weight:bold;" autocomplete="off">
                                <button class="btn btn-secondary" onclick="window.ukazHistoriuNákupu()" title="Ukázať vývoj ceny tohto produktu">📈 Analýza</button>
                            </div>
                            <div id="nakup-autocomplete-list" style="display:none; position:absolute; top:70px; left:15px; right:15px; max-height:200px; overflow-y:auto; background:#fff; border:1px solid #cbd5e1; border-radius:4px; z-index:100; box-shadow:0 4px 6px rgba(0,0,0,0.1);"></div>
                        </div>
                        
                        <input type="hidden" id="nakup-ean">
                        
                        <div style="display:flex; gap:10px; margin-top:15px; width: 100%; box-sizing: border-box;">
                            <div style="flex:1; min-width: 0;">
                                <label style="font-size:0.8rem; font-weight:bold;">Množstvo (kg/ks)</label>
                                <input type="number" id="nakup-mnozstvo" class="filter-input" style="width: 100%; box-sizing: border-box; text-align:right;" step="0.01" placeholder="0.00">
                            </div>
                            <div style="flex:1; min-width: 0;">
                                <label style="font-size:0.8rem; font-weight:bold;">Nákupná cena bez DPH</label>
                                <input type="number" id="nakup-cena" class="filter-input" style="width: 100%; box-sizing: border-box; text-align:right; border-color:#0284c7;" step="0.0001" placeholder="0.0000">
                            </div>
                            <div style="flex: 0 0 90px; min-width: 0;">
                                <label style="font-size:0.8rem; font-weight:bold;">DPH %</label>
                                <input type="number" id="nakup-dph" class="filter-input" style="width: 100%; box-sizing: border-box; text-align:center;" step="1" value="20">
                            </div>
                        </div>
                        <div style="margin-top:15px; text-align:right;">
                            <button class="btn btn-success" style="width:100%; font-weight:bold;" onclick="pridatPolozkuNakupu()">Pridať do zoznamu ➕</button>
                        </div>
                    </div>
                </div>

                <div style="flex: 2; min-width: 400px; background: #fff; padding: 25px; border-radius: 8px; border: 1px solid #cbd5e1; display:flex; flex-direction:column;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
                        <h4 style="margin: 0; color: #334155;">Rozpis položiek</h4>
                        <button class="btn btn-sm btn-secondary" onclick="window.tlacitReportNakupu()"><i class="fas fa-print"></i> Tlačiť</button>
                    </div>
                    
                    <div style="flex:1; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; min-height:300px; margin-top:15px;">
                        <table class="table-refined" style="width:100%; font-size:0.9rem;">
                            <thead style="background: #f1f5f9; position: sticky; top: 0; z-index:10;">
                                <tr>
                                    <th>Produkt</th>
                                    <th style="text-align:right;">Množ.</th>
                                    <th style="text-align:right;">Cena/j. (bez DPH)</th>
                                    <th style="text-align:right;">DPH</th>
                                    <th style="text-align:right;">Spolu (s DPH)</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="nakup-cart-tbody">
                                <tr><td colspan="6" style="text-align:center; padding: 30px; color:#94a3b8;">Zoznam je prázdny. Pridajte položky zľava.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top: 2px solid #e2e8f0; padding-top: 20px; background:#f8fafc; border-radius:6px; padding:15px;">
                        <div>
                            <div style="font-size:0.85rem; color:#64748b;">Spolu bez DPH: <span id="nakup-total-net" style="font-weight:bold; color:#1e293b;">0.00 €</span></div>
                            <div style="font-size:1.1rem; color:#64748b; margin-top:5px;">Suma s DPH:</div>
                            <strong style="font-size: 1.6rem; color: #dc2626;" id="nakup-total-gross">0.00 €</strong>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:10px;">
                            <button class="btn btn-primary" style="padding: 10px 20px; font-weight: bold; box-shadow:0 4px 6px rgba(37,99,235,0.2);" onclick="ulozitCelyNakup('Objednané')">Uložiť záznam ako Objednané</button>
                            <button class="btn btn-success" style="padding: 10px 20px; font-weight: bold; box-shadow:0 4px 6px rgba(22,163,74,0.2);" onclick="ulozitCelyNakup('Prijaté')">Uložiť záznam ako Prijaté</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="nakup-prehlad" class="nakup-view" style="display:none;">
            <div id="nakup-prehlad-container"></div>
        </div>
    `;

    document.querySelectorAll('.js-nakup-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.js-nakup-tab').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-secondary'); });
            e.target.classList.remove('btn-secondary'); e.target.classList.add('btn-primary');
            document.querySelectorAll('.nakup-view').forEach(v => v.style.display = 'none');
            document.getElementById(e.target.dataset.target).style.display = 'block';
        });
    });

    const searchInput = document.getElementById('nakup-search-prod');
    const autoList = document.getElementById('nakup-autocomplete-list');
    const eanInput = document.getElementById('nakup-ean');

    searchInput.addEventListener('input', function() {
        const val = this.value.toLowerCase().trim();
        if (!val) { autoList.style.display = 'none'; eanInput.value = ''; return; }

        const matches = produktyList.filter(p => (p.name && p.name.toLowerCase().includes(val)) || (p.ean && p.ean.includes(val))).slice(0, 15);
        if (matches.length === 0) {
            autoList.innerHTML = '<div style="padding:10px; color:#94a3b8;">Nenájdené (vložte vlastný názov)</div>';
            autoList.style.display = 'block'; return;
        }

        autoList.innerHTML = matches.map(p => `
            <div class="autocomplete-item" style="padding:8px 12px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; justify-content:space-between;" 
                 onclick="window.vybratProdukt('${escapeHtml(p.name)}', '${p.ean || ''}', ${p.dph || 20})">
                <span style="font-weight:600; color:#1e293b;">${escapeHtml(p.name)}</span>
                <span style="color:#64748b; font-family:monospace; font-size:0.8rem;">${p.ean || ''}</span>
            </div>
        `).join('');
        
        autoList.style.display = 'block';
        autoList.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.backgroundColor = '#e0f2fe');
            item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');
        });
    });

    document.addEventListener('click', (e) => { if (e.target !== searchInput && e.target !== autoList) autoList.style.display = 'none'; });
    
    window.vybratProdukt = function(nazov, ean, dph) { 
        searchInput.value = nazov; 
        eanInput.value = ean; 
        if (dph !== undefined && dph !== null) {
            document.getElementById('nakup-dph').value = dph;
        }
        autoList.style.display = 'none'; 
        document.getElementById('nakup-mnozstvo').focus(); 
    };
};

window.pridatNovehoDodavatela = async function() {
    const newName = prompt("Zadajte názov nového dodávateľa:");
    if (!newName || !newName.trim()) return;
    try {
        const res = await fetch('/api/kancelaria/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim(), categories: [] }) });
        const out = await res.json();
        if (out.error) throw new Error(out.error);
        const select = document.getElementById('nakup-dodavatel');
        const opt = document.createElement('option');
        opt.value = newName.trim(); opt.textContent = newName.trim();
        select.appendChild(opt); select.value = newName.trim();
    } catch (e) { alert("Chyba pri pridávaní dodávateľa: " + e.message); }
};

window.pridatPolozkuNakupu = function() {
    const ean = document.getElementById('nakup-ean').value.trim();
    const nazov = document.getElementById('nakup-search-prod').value.trim();
    const mnozstvo = parseFloat(document.getElementById('nakup-mnozstvo').value);
    const cena_bez_dph = parseFloat(document.getElementById('nakup-cena').value);
    const dph = parseFloat(document.getElementById('nakup-dph').value);

    if (!nazov) return alert('Zadajte názov produktu.');
    if (isNaN(mnozstvo) || mnozstvo <= 0) return alert('Zadajte platné množstvo.');
    if (isNaN(cena_bez_dph) || cena_bez_dph <= 0) return alert('Zadajte platnú cenu.');
    if (isNaN(dph) || dph < 0) return alert('Zadajte platnú sadzbu DPH.');

    nakupCart.push({ ean, nazov, mnozstvo, cena_bez_dph, dph });
    
    document.getElementById('nakup-ean').value = ''; document.getElementById('nakup-search-prod').value = '';
    document.getElementById('nakup-mnozstvo').value = ''; document.getElementById('nakup-cena').value = '';
    vykresliNakupCart();
};

window.zmazatPolozkuNakupu = function(index) { nakupCart.splice(index, 1); vykresliNakupCart(); };

function vykresliNakupCart() {
    const tbody = document.getElementById('nakup-cart-tbody');
    let html = ''; let totalNet = 0; let totalGross = 0;

    if (nakupCart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px; color:#94a3b8;">Zoznam je prázdny. Pridajte položky zľava.</td></tr>';
        document.getElementById('nakup-total-net').innerText = '0.00 €'; document.getElementById('nakup-total-gross').innerText = '0.00 €'; return;
    }

    nakupCart.forEach((p, idx) => {
        const sumNet = p.mnozstvo * p.cena_bez_dph;
        const sumGross = sumNet * (1 + (p.dph / 100));
        totalNet += sumNet; totalGross += sumGross;
        html += `<tr style="border-bottom: 1px solid #f1f5f9; background:#fff;">
            <td style="padding:10px;"><strong style="color: #0f172a;">${escapeHtml(p.nazov)}</strong>${p.ean ? `<br><small style="color:#64748b; font-family:monospace;">${p.ean}</small>` : ''}</td>
            <td style="text-align:right; font-weight:bold;">${p.mnozstvo}</td>
            <td style="text-align:right; color: #0369a1;">${p.cena_bez_dph.toFixed(4)} €</td>
            <td style="text-align:right; color: #64748b;">${p.dph}%</td>
            <td style="text-align:right; font-weight:bold;">${sumGross.toFixed(2)} €</td>
            <td style="text-align:center;"><button class="btn btn-sm btn-danger" style="padding:4px 8px;" onclick="zmazatPolozkuNakupu(${idx})"><i class="fas fa-trash"></i></button></td>
        </tr>`;
    });

    tbody.innerHTML = html;
    document.getElementById('nakup-total-net').innerText = totalNet.toFixed(2) + ' €';
    document.getElementById('nakup-total-gross').innerText = totalGross.toFixed(2) + ' €';
}

window.ulozitCelyNakup = async function(stav) {
    const dodavatel = document.getElementById('nakup-dodavatel').value.trim();
    const datum_vystavenia = document.getElementById('nakup-datum').value;
    const datum_dodania = document.getElementById('nakup-datum-dodania').value;
    const poznamka = document.getElementById('nakup-poznamka').value.trim();

    if (!dodavatel) return alert("Musíte vybrať alebo zadať dodávateľa.");
    if (nakupCart.length === 0) return alert("Zoznam položiek je prázdny.");

    const celkova_suma_bez_dph = nakupCart.reduce((sum, item) => sum + (item.mnozstvo * item.cena_bez_dph), 0);
    const celkova_suma_s_dph = nakupCart.reduce((sum, item) => sum + ((item.mnozstvo * item.cena_bez_dph) * (1 + (item.dph/100))), 0);

    const confirmationMsg = stav === 'Prijaté' ? 'Záznam bude uložený ako Prijatý (História nákupov).\nPokračovať?' : 'Uložiť záznam ako Objednané?';
    if (!confirm(confirmationMsg)) return;

    try {
        const res = await fetch('/api/kancelaria/nakup/ulozit', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dodavatel, datum_vystavenia, datum_dodania, stav, celkova_suma_bez_dph, celkova_suma_s_dph, poznamka, polozky: nakupCart })
        });
        const out = await res.json();
        if (out.error) throw new Error(out.error);
        
        alert(out.message);
        nakupCart = []; vykresliNakupCart(); document.getElementById('nakup-poznamka').value = '';
    } catch (e) { alert("Chyba pri ukladaní: " + e.message); }
};

window.nacitatPrehladNakupov = async function() {
    const container = document.getElementById('nakup-prehlad-container');
    container.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';
    
    try {
        const res = await fetch('/api/kancelaria/nakup/zoznam');
        const data = await res.json();
        const obj = data.objednavky || [];
        
        if(obj.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:#64748b;">Neevidujeme žiadne záznamy.</div>';
            return;
        }

        let html = `
        <table class="table-refined" style="width:100%; font-size:0.9rem;">
            <thead style="background:#f8fafc;">
                <tr>
                    <th>ID</th>
                    <th>Dodávateľ</th>
                    <th>Vystavené</th>
                    <th>Očakávané dodanie</th>
                    <th style="text-align:right;">Suma bez DPH</th>
                    <th style="text-align:right;">Suma s DPH</th>
                    <th style="text-align:center;">Stav</th>
                    <th style="text-align:right;">Akcia</th>
                </tr>
            </thead>
            <tbody>
        `;
        
        obj.forEach(o => {
            const statusBadge = o.stav === 'Prijaté' ? `<span style="background:#dcfce7; color:#15803d; padding:3px 8px; border-radius:4px; font-weight:bold;">${o.stav}</span>` : `<span style="background:#fef08a; color:#854d0e; padding:3px 8px; border-radius:4px; font-weight:bold;">${o.stav}</span>`;
            
            const acceptBtn = o.stav === 'Objednané' ? `<button class="btn btn-success btn-sm" onclick="zmenitStavNaPrijate(${o.id})" style="margin-right:5px;" title="Označiť za prijaté">✔️</button>` : '';
            const printBtn = `<button class="btn btn-secondary btn-sm" onclick="window.tlacitUlozenuObjednavku(${o.id})" title="Tlačiť objednávku">🖨️</button>`;

            html += `
            <tr>
                <td><strong>#${o.id}</strong></td>
                <td style="font-weight:bold; color:#0369a1;">${escapeHtml(o.dodavatel)}</td>
                <td>${o.datum_vystavenia}</td>
                <td>${o.datum_dodania || '-'}</td>
                <td style="text-align:right;">${parseFloat(o.celkova_suma_bez_dph).toFixed(2)} €</td>
                <td style="text-align:right; font-weight:bold;">${parseFloat(o.celkova_suma_s_dph).toFixed(2)} €</td>
                <td style="text-align:center;">${statusBadge}</td>
                <td style="text-align:right; white-space:nowrap;">${acceptBtn}${printBtn}</td>
            </tr>`;
        });
        
        html += `</tbody></table>`;
        container.innerHTML = html;
        
    } catch(e) {
        container.innerHTML = `<div style="color:red; padding:20px;">Chyba: ${e.message}</div>`;
    }
};

window.zmenitStavNaPrijate = async function(id) {
    if(!confirm("Zmeniť stav objednávky na 'Prijaté'? (Záznam sa uchová v histórii)")) return;
    try {
        const res = await fetch('/api/kancelaria/nakup/zmenit_stav', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, stav: 'Prijaté' })
        });
        const out = await res.json();
        if(out.error) throw new Error(out.error);
        alert(out.message);
        nacitatPrehladNakupov();
    } catch (e) {
        alert("Chyba: " + e.message);
    }
};

window.tlacitReportNakupu = function() {
    const dodavatel = document.getElementById('nakup-dodavatel').value.trim() || 'Neznámy dodávateľ';
    const datum = document.getElementById('nakup-datum').value;
    const datumDodania = document.getElementById('nakup-datum-dodania').value;
    const poznamka = document.getElementById('nakup-poznamka').value.trim();
    
    if (nakupCart.length === 0) return alert("Nemôžete tlačiť prázdnu objednávku.");

    const fmtDate = (d) => d ? d.split('-').reverse().join('.') : '—';
    let riadkyHTML = '';
    
    nakupCart.forEach((p, i) => {
        const sumNet = p.mnozstvo * p.cena_bez_dph;
        const sumGross = sumNet * (1 + (p.dph / 100));
        riadkyHTML += `
            <tr>
                <td style="text-align:center;">${i+1}.</td>
                <td>${escapeHtml(p.nazov)}<br><small style="color:#666;">${p.ean || ''}</small></td>
                <td style="text-align:right;">${p.mnozstvo}</td>
                <td style="text-align:right;">${p.cena_bez_dph.toFixed(4)} €</td>
                <td style="text-align:right;">${p.dph}%</td>
                <td style="text-align:right; font-weight:bold;">${sumGross.toFixed(2)} €</td>
            </tr>
        `;
    });

    const printWin = window.open('', '_blank');
    printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head><title>Objednávka - ${dodavatel}</title><style>
            body { font-family: Arial, sans-serif; padding: 30px; font-size: 14px; color: #333; }
            h1 { margin: 0 0 5px 0; color: #1e3a8a; text-transform: uppercase; font-size: 22px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
            th { background-color: #f1f5f9; font-weight: bold; }
            .info-box { display: flex; justify-content: space-between; margin-top: 20px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
            @media print { body { padding: 0; } .no-print { display: none; } }
        </style></head>
        <body>
            <div class="no-print" style="text-align:center; margin-bottom:20px;"><button onclick="window.print()" style="padding:10px 20px; font-size:16px; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer;">🖨️ Potvrdiť tlač</button></div>
            <h1>Objednávka od dodávateľa</h1>
            <div class="info-box">
                <div>
                    <strong>Dodávateľ:</strong> <span style="font-size:16px;">${escapeHtml(dodavatel)}</span><br><br>
                    <strong>Dátum vystavenia:</strong> ${fmtDate(datum)}<br>
                    <strong>Očakávané dodanie:</strong> ${fmtDate(datumDodania)}<br>
                </div>
                <div style="max-width: 300px;"><strong>Poznámka:</strong><br>${escapeHtml(poznamka) || '—'}</div>
            </div>
            <table>
                <thead><tr><th style="width: 40px; text-align:center;">#</th><th>Produkt</th><th style="text-align:right;">Množstvo</th><th style="text-align:right;">Cena bez DPH</th><th style="text-align:right;">DPH</th><th style="text-align:right;">Spolu s DPH</th></tr></thead>
                <tbody>${riadkyHTML}</tbody>
                <tfoot>
                    <tr style="font-size: 16px; font-weight: bold; background: #f1f5f9;">
                        <td colspan="5" style="text-align:right;">CELKOVÁ SUMA NÁKUPU:</td>
                        <td style="text-align:right; color:#dc2626;">${document.getElementById('nakup-total-gross').innerText}</td>
                    </tr>
                </tfoot>
            </table>
            <div style="margin-top: 50px; display:flex; justify-content:space-between;">
                <div>Vystavil (Podpis): ________________________</div><div>Schválil: ________________________</div>
            </div>
        </body></html>
    `);
    printWin.document.close();
};

window.tlacitUlozenuObjednavku = async function(id) {
    try {
        const res = await fetch(`/api/kancelaria/nakup/detail/${id}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const header = data.header;
        const items = data.items || [];
        const dodavatel = header.dodavatel;
        
        const fmtDate = (d) => d ? d.split('-').reverse().join('.') : '—';
        let riadkyHTML = '';
        
        items.forEach((p, i) => {
            const cena_bez_dph = parseFloat(p.cena_bez_dph) || 0;
            const mnozstvo = parseFloat(p.mnozstvo) || 0;
            const dph = parseFloat(p.dph) || 0;
            const sumNet = mnozstvo * cena_bez_dph;
            const sumGross = sumNet * (1 + (dph / 100));
            
            riadkyHTML += `
                <tr>
                    <td style="text-align:center;">${i+1}.</td>
                    <td>${escapeHtml(p.nazov)}<br><small style="color:#666;">${p.ean || ''}</small></td>
                    <td style="text-align:right;">${mnozstvo}</td>
                    <td style="text-align:right;">${cena_bez_dph.toFixed(4)} €</td>
                    <td style="text-align:right;">${dph}%</td>
                    <td style="text-align:right; font-weight:bold;">${sumGross.toFixed(2)} €</td>
                </tr>
            `;
        });

        const printWin = window.open('', '_blank');
        printWin.document.write(`
            <!DOCTYPE html>
            <html>
            <head><title>Objednávka č. ${header.id} - ${escapeHtml(dodavatel)}</title><style>
                body { font-family: Arial, sans-serif; padding: 30px; font-size: 14px; color: #333; }
                h1 { margin: 0 0 5px 0; color: #1e3a8a; text-transform: uppercase; font-size: 22px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ccc; padding: 10px; text-align: left; }
                th { background-color: #f1f5f9; font-weight: bold; }
                .info-box { display: flex; justify-content: space-between; margin-top: 20px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
                @media print { body { padding: 0; } .no-print { display: none; } }
            </style></head>
            <body>
                <div class="no-print" style="text-align:center; margin-bottom:20px;"><button onclick="window.print()" style="padding:10px 20px; font-size:16px; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer;">🖨️ Potvrdiť tlač</button></div>
                <h1>Objednávka č. ${header.id} (${header.stav})</h1>
                <div class="info-box">
                    <div>
                        <strong>Dodávateľ:</strong> <span style="font-size:16px;">${escapeHtml(dodavatel)}</span><br><br>
                        <strong>Dátum vystavenia:</strong> ${fmtDate(header.datum_vystavenia)}<br>
                        <strong>Očakávané dodanie:</strong> ${fmtDate(header.datum_dodania)}<br>
                    </div>
                    <div style="max-width: 300px;"><strong>Poznámka:</strong><br>${escapeHtml(header.poznamka) || '—'}</div>
                </div>
                <table>
                    <thead><tr><th style="width: 40px; text-align:center;">#</th><th>Produkt</th><th style="text-align:right;">Množstvo</th><th style="text-align:right;">Cena bez DPH</th><th style="text-align:right;">DPH</th><th style="text-align:right;">Spolu s DPH</th></tr></thead>
                    <tbody>${riadkyHTML}</tbody>
                    <tfoot>
                        <tr style="font-size: 16px; font-weight: bold; background: #f1f5f9;">
                            <td colspan="5" style="text-align:right;">CELKOVÁ SUMA NÁKUPU:</td>
                            <td style="text-align:right; color:#dc2626;">${parseFloat(header.celkova_suma_s_dph).toFixed(2)} €</td>
                        </tr>
                    </tfoot>
                </table>
                <div style="margin-top: 50px; display:flex; justify-content:space-between;">
                    <div>Vystavil (Podpis): ________________________</div><div>Schválil: ________________________</div>
                </div>
            </body></html>
        `);
        printWin.document.close();
    } catch (e) {
        alert("Chyba pri získavaní dát pre tlač: " + e.message);
    }
};

window.ukazHistoriuNákupu = async function() {
    const ean = document.getElementById('nakup-ean').value.trim();
    const nazov = document.getElementById('nakup-search-prod').value.trim();

    if (!ean && !nazov) return alert('Na zobrazenie vývoja ceny musíte najprv začať písať názov produktu a vybrať ho.');

    let modal = document.getElementById('nakup-history-modal');
    if (!modal) {
        modal = document.createElement('div'); modal.id = 'nakup-history-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:10500; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px);';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="background:#fff; width:95%; max-width:1000px; border-radius:12px; display:flex; flex-direction:column; height:85vh; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);">
            <div style="background:#f8f9fa; padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; color:#1e3a8a;"><i class="fas fa-chart-line"></i> Vývoj nákupnej ceny: ${escapeHtml(nazov || ean)}</h3>
                <button onclick="document.getElementById('nakup-history-modal').style.display='none'" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:20px; overflow-y:auto; flex:1; display: flex; flex-direction: column;">
                <div id="nh-loading" style="text-align:center; padding:20px; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Analyzujem historické dáta...</div>
                <div id="nh-content" style="display:none; flex: 1; flex-direction: column;">
                    <div style="height:350px; width:100%; margin-bottom:20px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; background:#f8fafc;"><canvas id="nakupHistoryChart"></canvas></div>
                    <div style="flex:1; overflow-y:auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                        <table class="table-refined" style="width:100%; font-size:0.9rem;">
                            <thead style="background:#f1f5f9; position: sticky; top: 0;"><tr><th>Dátum nákupu</th><th>Dodanie</th><th>Dodávateľ</th><th style="text-align:right;">Množstvo</th><th style="text-align:right;">Nákupná cena (€ bez DPH)</th></tr></thead>
                            <tbody id="nh-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    try {
        const query = ean ? `ean=${encodeURIComponent(ean)}` : `nazov=${encodeURIComponent(nazov)}`;
        const response = await fetch(`/api/kancelaria/nakup/historia?${query}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('nh-loading').style.display = 'none';
        const contentDiv = document.getElementById('nh-content'); contentDiv.style.display = 'flex';

        const history = data.history || [];
        if (history.length === 0) { contentDiv.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-size: 1.1rem;">Zatiaľ neevidujeme žiadne nákupy tohto produktu.</div>'; return; }

        let tableHtml = '';
        [...history].reverse().forEach(row => {
            tableHtml += `<tr><td>${new Date(row.date).toLocaleDateString('sk-SK')}</td><td>${row.delivery_date ? row.delivery_date : '—'}</td><td><strong>${escapeHtml(row.supplier)}</strong></td><td style="text-align:right;">${parseFloat(row.qty).toFixed(2)}</td><td style="text-align:right; font-weight:bold; color:#b91c1c;">${parseFloat(row.price).toFixed(4)} €</td></tr>`;
        });
        document.getElementById('nh-table-body').innerHTML = tableHtml;

        const uniqueDates = [...new Set(history.map(item => item.date))].sort();
        const uniqueSuppliers = [...new Set(history.map(item => item.supplier))];
        const colors = ['#2563eb', '#16a34a', '#d97706', '#8b5cf6', '#dc2626', '#0891b2'];
        
        const datasets = uniqueSuppliers.map((supplier, idx) => {
            const dataPoints = uniqueDates.map(date => {
                const match = history.find(i => i.date === date && i.supplier === supplier);
                return match ? parseFloat(match.price) : null;
            });
            return { label: supplier, data: dataPoints, borderColor: colors[idx % colors.length], backgroundColor: colors[idx % colors.length], spanGaps: true, pointRadius: 5, pointHoverRadius: 8, borderWidth: 2, tension: 0.1 };
        });

        const ctx = document.getElementById('nakupHistoryChart').getContext('2d');
        if (nakupChartInstance) nakupChartInstance.destroy();

        nakupChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: uniqueDates.map(d => new Date(d).toLocaleDateString('sk-SK')), datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { tooltip: { callbacks: { label: function(c) { return c.dataset.label + ': ' + c.parsed.y.toFixed(4) + ' €'; } } } },
                scales: { y: { title: { display: true, text: 'Cena bez DPH v €' }, ticks: { callback: function(val) { return val.toFixed(2) + ' €'; } } }, x: { grid: { display: false } } }
            }
        });
    } catch (e) { document.getElementById('nh-loading').innerHTML = `<span style="color:red;">Chyba: ${e.message}</span>`; }
};