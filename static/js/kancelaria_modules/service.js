// static/js/kancelaria_modules/service.js

// Pomocná funkcia pre aktuálny dátum
const getTodayISO = () => new Date().toISOString().slice(0,10);

// ==========================================
// FUNKCIE PRE OVLÁDANIE MODÁLNEHO OKNA
// ==========================================
window.openKancModal = function(html) {
    const modal = document.getElementById('modal-container');
    if (!modal) {
        console.error('Modal container sa nenašiel!');
        return;
    }
    const body = modal.querySelector('.modal-body');
    const headerTitle = modal.querySelector('.modal-header h3');
    if (headerTitle) headerTitle.innerText = "Servis a Metrológia";
    if (body) body.innerHTML = html;
    
    modal.style.display = 'flex';
    modal.classList.add('show');
    
    const closeBtn = modal.querySelector('.close-btn');
    const backdrop = modal.querySelector('.modal-backdrop');
    if (closeBtn) closeBtn.onclick = window.closeKancModal;
    if (backdrop) backdrop.onclick = window.closeKancModal;
};

window.closeKancModal = function() {
    const modal = document.getElementById('modal-container');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('show');
    }
};

// ==========================================
// HLAVNÝ MODUL SERVISU
// ==========================================
window.ServiceModule = {
    init: function() {
        this.loadVahy();
        this.loadStroje();
        this.loadBudova();
    },

    // ==========================================
    // --- VÁHY ---
    // ==========================================
    loadVahy: async function() {
        const tbody = document.getElementById('tbody-service-vahy');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Načítavam váhy...</td></tr>';
        
        try {
            const data = await apiRequest('/api/service/vahy');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center muted">Žiadne evidované váhy.</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.map(v => {
                let statusColor = '#16a34a'; 
                let statusIkona = 'fa-check-circle';
                if (v.dni_do_konca < 0) { statusColor = '#dc2626'; statusIkona = 'fa-times-circle'; }
                else if (v.dni_do_konca < 30) { statusColor = '#f59e0b'; statusIkona = 'fa-exclamation-triangle'; } 

                return `
                <tr>
                    <td style="font-weight:bold;">${escapeHtml(v.cislo_vahy)}</td>
                    <td><span class="chip">${escapeHtml(v.umiestnenie)}</span></td>
                    <td>${v.datum_poslednej}</td>
                    <td style="color:${statusColor}; font-weight:bold;"><i class="fas ${statusIkona}"></i> ${v.datum_dalsej}</td>
                    <td>${escapeHtml(v.poznamka || '')}</td>
                    <td class="text-right" style="white-space:nowrap;">
                        <button class="btn btn-sm btn-light" onclick='ServiceModule.editVaha(${JSON.stringify(v).replace(/'/g, "&apos;")})' title="Upraviť"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="ServiceModule.deleteVaha(${v.id})" title="Zmazať"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        } catch(e) {
            tbody.innerHTML = `<tr><td colspan="6" class="error">${e.message}</td></tr>`;
        }
    },

    editVaha: function(v = null) {
        const html = `
            <div style="padding: 20px;">
                <h3>${v ? 'Upraviť' : 'Pridať'} Váhu / Metrológiu</h3>
                <input type="hidden" id="sv-id" value="${v ? v.id : ''}">
                
                <label>Číslo/Názov Váhy:</label>
                <input type="text" id="sv-cislo" class="form-control mb-3" value="${escapeHtml(v ? v.cislo_vahy : '')}">
                
                <label>Umiestnenie:</label>
                <select id="sv-um" class="form-control mb-3">
                    ${['Rozrábka', 'Výroba', 'Expedícia', 'Baliareň', 'Obchod', 'Iné'].map(u => 
                        `<option value="${u}" ${v && v.umiestnenie === u ? 'selected' : ''}>${u}</option>`
                    ).join('')}
                </select>

                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:1;">
                        <label>Dátum poslednej skúšky:</label>
                        <input type="date" id="sv-posl" class="form-control" value="${v ? v.datum_poslednej : getTodayISO()}">
                    </div>
                    <div style="flex:1;">
                        <label>Dátum ďalšej skúšky (Platí do):</label>
                        <input type="date" id="sv-dalsia" class="form-control" value="${v ? v.datum_dalsej : ''}">
                    </div>
                </div>

                <label>Poznámka:</label>
                <textarea id="sv-pozn" class="form-control mb-3" rows="2">${escapeHtml(v ? v.poznamka : '')}</textarea>

                <div class="text-right">
                    <button class="btn btn-secondary" onclick="window.closeKancModal()">Zrušiť</button>
                    <button class="btn btn-primary" onclick="ServiceModule.saveVaha()">Uložiť váhu</button>
                </div>
            </div>
        `;
        window.openKancModal(html);
    },

    saveVaha: async function() {
        const payload = {
            id: document.getElementById('sv-id').value,
            cislo_vahy: document.getElementById('sv-cislo').value,
            umiestnenie: document.getElementById('sv-um').value,
            datum_poslednej: document.getElementById('sv-posl').value,
            datum_dalsej: document.getElementById('sv-dalsia').value,
            poznamka: document.getElementById('sv-pozn').value
        };
        if(!payload.cislo_vahy || !payload.datum_dalsej) { alert("Číslo váhy a dátum ďalšej skúšky sú povinné!"); return; }
        
        try {
            await apiRequest('/api/service/vahy', { method: 'POST', body: payload });
            window.closeKancModal();
            this.loadVahy();
            if(window.showStatus) showStatus("Váha uložená", false);
        } catch(e) { alert(e.message); }
    },

    deleteVaha: async function(id) {
        if (!confirm("Naozaj chcete natrvalo zmazať tento záznam o váhe?")) return;
        try {
            await apiRequest(`/api/service/vahy/${id}`, { method: 'DELETE' });
            if(window.showStatus) showStatus("Záznam bol zmazaný.", false);
            this.loadVahy();
        } catch(e) { alert(e.message); }
    },

    // ==========================================
    // --- STROJE ---
    // ==========================================
    loadStroje: async function() {
        const tbody = document.getElementById('tbody-service-stroje');
        if (!tbody) return;
        
        try {
            const data = await apiRequest('/api/service/stroje');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center muted">Žiadne servisné záznamy.</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.map(s => `
                <tr>
                    <td>${s.datum_opravy}</td>
                    <td style="font-weight:bold; color:#0369a1;">${escapeHtml(s.nazov_stroja)}</td>
                    <td><span class="chip" style="background:${s.typ_zaznamu === 'Preventívna údržba' ? '#e0f2fe' : '#fee2e2'}; color:${s.typ_zaznamu === 'Preventívna údržba' ? '#0369a1' : '#dc2626'};">${escapeHtml(s.typ_zaznamu)}</span></td>
                    <td>${escapeHtml(s.popis_prace || '')}</td>
                    <td>${escapeHtml(s.dodavatel_servisu || '')}</td>
                    <td class="text-right font-weight-bold">${Number(s.cena_bez_dph || 0).toFixed(2)} €<br><small class="muted">s DPH: ${Number(s.cena_s_dph || 0).toFixed(2)} €</small></td>
                    <td class="text-right" style="white-space:nowrap;">
                        <button class="btn btn-sm btn-light" onclick='ServiceModule.editStroj(${JSON.stringify(s).replace(/'/g, "&apos;")})' title="Upraviť"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="ServiceModule.deleteStroj(${s.id})" title="Zmazať"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        } catch(e) { tbody.innerHTML = `<tr><td colspan="7" class="error">${e.message}</td></tr>`; }
    },

    editStroj: function(s = null) {
        const html = `
            <div style="padding: 20px;">
                <h3>${s ? 'Upraviť' : 'Pridať'} Servisný záznam stroja</h3>
                <input type="hidden" id="ss-id" value="${s ? s.id : ''}">
                
                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:2;">
                        <label>Názov stroja (napr. Kuter č. 1):</label>
                        <input type="text" id="ss-stroj" class="form-control" value="${escapeHtml(s ? s.nazov_stroja : '')}">
                    </div>
                    <div style="flex:1;">
                        <label>Dátum:</label>
                        <input type="date" id="ss-datum" class="form-control" value="${s ? s.datum_opravy : getTodayISO()}">
                    </div>
                </div>

                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:1;">
                        <label>Typ záznamu:</label>
                        <select id="ss-typ" class="form-control">
                            <option value="Oprava - Havária" ${s && s.typ_zaznamu === 'Oprava - Havária' ? 'selected' : ''}>Oprava - Havária</option>
                            <option value="Preventívna údržba" ${s && s.typ_zaznamu === 'Preventívna údržba' ? 'selected' : ''}>Preventívna údržba</option>
                        </select>
                    </div>
                    <div style="flex:1;">
                        <label>Dodávateľ servisu / Technik:</label>
                        <input type="text" id="ss-dodavatel" class="form-control" value="${escapeHtml(s ? s.dodavatel_servisu : '')}">
                    </div>
                </div>

                <label>Čo sa opravovalo / robilo:</label>
                <textarea id="ss-popis" class="form-control mb-3" rows="3">${escapeHtml(s ? s.popis_prace : '')}</textarea>

                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:1;">
                        <label>Cena servisu BEZ DPH:</label>
                        <input type="number" id="ss-cenabez" class="form-control" step="0.01" value="${s ? s.cena_bez_dph : '0.00'}" oninput="document.getElementById('ss-cenas').value = (Number(this.value) * 1.23).toFixed(2)">
                    </div>
                    <div style="flex:1;">
                        <label>Cena servisu S DPH:</label>
                        <input type="number" id="ss-cenas" class="form-control" step="0.01" value="${s ? s.cena_s_dph : '0.00'}">
                    </div>
                </div>

                <div class="text-right">
                    <button class="btn btn-secondary" onclick="window.closeKancModal()">Zrušiť</button>
                    <button class="btn btn-primary" onclick="ServiceModule.saveStroj()">Uložiť záznam</button>
                </div>
            </div>
        `;
        window.openKancModal(html);
    },

    saveStroj: async function() {
        const payload = {
            id: document.getElementById('ss-id').value,
            nazov_stroja: document.getElementById('ss-stroj').value,
            typ_zaznamu: document.getElementById('ss-typ').value,
            datum_opravy: document.getElementById('ss-datum').value,
            popis_prace: document.getElementById('ss-popis').value,
            dodavatel_servisu: document.getElementById('ss-dodavatel').value,
            cena_bez_dph: document.getElementById('ss-cenabez').value,
            cena_s_dph: document.getElementById('ss-cenas').value
        };
        if(!payload.nazov_stroja || !payload.datum_opravy) { alert("Názov stroja a dátum sú povinné!"); return; }
        
        try {
            await apiRequest('/api/service/stroje', { method: 'POST', body: payload });
            window.closeKancModal();
            this.loadStroje();
            if(window.showStatus) showStatus("Záznam o servise uložený", false);
        } catch(e) { alert(e.message); }
    },

    deleteStroj: async function(id) {
        if (!confirm("Naozaj chcete natrvalo zmazať tento servisný záznam?")) return;
        try {
            await apiRequest(`/api/service/stroje/${id}`, { method: 'DELETE' });
            if(window.showStatus) showStatus("Záznam bol zmazaný.", false);
            this.loadStroje();
        } catch(e) { alert(e.message); }
    },

    // ==========================================
    // --- ÚDRŽBA BUDOVY (RVPS atď.) ---
    // ==========================================
    loadBudova: async function() {
        const tbody = document.getElementById('tbody-service-budova');
        if (!tbody) return;
        
        try {
            const data = await apiRequest('/api/service/budova');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center muted">Žiadne záznamy o údržbe budovy.</td></tr>';
                return;
            }
            
            tbody.innerHTML = data.map(b => `
                <tr>
                    <td>${b.datum}</td>
                    <td><span class="chip" style="background:${b.stav === 'Dokončené' ? '#dcfce7' : '#fef08a'}; color:${b.stav === 'Dokončené' ? '#166534' : '#854d0e'};">${b.stav}</span></td>
                    <td style="font-weight:bold; color:#1e293b;">${escapeHtml(b.miestnost)}</td>
                    <td>${escapeHtml(b.popis_prace)}</td>
                    <td>${escapeHtml(b.nariadene_kym || '-')}</td>
                    <td>${escapeHtml(b.vykonal || '-')}</td>
                    <td class="text-right" style="white-space:nowrap;">
                        <button class="btn btn-sm btn-light" onclick='ServiceModule.editBudova(${JSON.stringify(b).replace(/'/g, "&apos;")})' title="Upraviť"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="ServiceModule.deleteBudova(${b.id})" title="Zmazať"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        } catch(e) { tbody.innerHTML = `<tr><td colspan="7" class="error">${e.message}</td></tr>`; }
    },

    editBudova: function(b = null) {
        const html = `
            <div style="padding: 20px;">
                <h3>${b ? 'Upraviť' : 'Pridať'} záznam o údržbe budovy</h3>
                <input type="hidden" id="sb-id" value="${b ? b.id : ''}">
                
                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:1;">
                        <label>Dátum:</label>
                        <input type="date" id="sb-datum" class="form-control" value="${b ? b.datum : getTodayISO()}">
                    </div>
                    <div style="flex:1;">
                        <label>Stav:</label>
                        <select id="sb-stav" class="form-control">
                            <option value="V riešení" ${b && b.stav === 'V riešení' ? 'selected' : ''}>V riešení (Pracuje sa na tom)</option>
                            <option value="Dokončené" ${b && b.stav === 'Dokončené' ? 'selected' : ''}>Dokončené (Hotovo)</option>
                        </select>
                    </div>
                </div>

                <label>Úsek / Miestnosť (napr. Rozrábka, Šatne, Podlaha v chladničke):</label>
                <input type="text" id="sb-miestnost" class="form-control mb-3" value="${escapeHtml(b ? b.miestnost : '')}">

                <label>Čo sa robilo / bude robiť (Popis):</label>
                <textarea id="sb-popis" class="form-control mb-3" rows="3" placeholder="Napr. Maľovanie stien, oprava odpadnutých obkladačiek...">${escapeHtml(b ? b.popis_prace : '')}</textarea>

                <div style="display:flex; gap:10px;" class="mb-3">
                    <div style="flex:1;">
                        <label>Nariadil (napr. RVPS, Interná kontrola):</label>
                        <input type="text" id="sb-nariadil" class="form-control" value="${escapeHtml(b ? b.nariadene_kym : 'RVPS')}">
                    </div>
                    <div style="flex:1;">
                        <label>Vykonal (Meno zamestnanca alebo Firma):</label>
                        <input type="text" id="sb-vykonal" class="form-control" value="${escapeHtml(b ? b.vykonal : 'Interný údržbár')}">
                    </div>
                </div>
                
                <div style="width: 50%; margin-bottom:15px;">
                    <label>Cena materiálu/práce (Nepovinné, bez DPH):</label>
                    <input type="number" id="sb-cena" class="form-control" step="0.01" value="${b ? b.cena : '0.00'}">
                </div>

                <div class="text-right">
                    <button class="btn btn-secondary" onclick="window.closeKancModal()">Zrušiť</button>
                    <button class="btn btn-primary" onclick="ServiceModule.saveBudova()">Uložiť záznam</button>
                </div>
            </div>
        `;
        window.openKancModal(html);
    },

    saveBudova: async function() {
        const payload = {
            id: document.getElementById('sb-id').value,
            datum: document.getElementById('sb-datum').value,
            stav: document.getElementById('sb-stav').value,
            miestnost: document.getElementById('sb-miestnost').value,
            popis_prace: document.getElementById('sb-popis').value,
            nariadene_kym: document.getElementById('sb-nariadil').value,
            vykonal: document.getElementById('sb-vykonal').value,
            cena: document.getElementById('sb-cena').value
        };
        if(!payload.miestnost || !payload.popis_prace) { alert("Miestnosť a popis práce sú povinné!"); return; }
        
        try {
            await apiRequest('/api/service/budova', { method: 'POST', body: payload });
            window.closeKancModal();
            this.loadBudova();
            if(window.showStatus) showStatus("Záznam o údržbe uložený", false);
        } catch(e) { alert(e.message); }
    },

    deleteBudova: async function(id) {
        if (!confirm("Naozaj chcete natrvalo zmazať tento záznam o údržbe?")) return;
        try {
            await apiRequest(`/api/service/budova/${id}`, { method: 'DELETE' });
            if(window.showStatus) showStatus("Záznam bol zmazaný.", false);
            this.loadBudova();
        } catch(e) { alert(e.message); }
    },

    // ==========================================
    // --- FUNKCIE PRE TLAČ VÝSTUPOV ---
    // ==========================================
    printVahy: async function() {
        try {
            const data = await apiRequest('/api/service/vahy');
            const dnes = new Date().toLocaleDateString('sk-SK');
            
            let html = `
            <!DOCTYPE html>
            <html lang="sk">
            <head>
                <meta charset="UTF-8">
                <title>Evidencia meradiel a váh</title>
                <style>
                    body { font-family: 'Arial', sans-serif; color: #000; padding: 40px; font-size: 14px; }
                    h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 30px; }
                    .header-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
                    th, td { border: 1px solid #000; padding: 10px; text-align: left; }
                    th { background-color: #e2e8f0; -webkit-print-color-adjust: exact; }
                    .warning { color: #dc2626; font-weight: bold; }
                    .signature-box { margin-top: 50px; display: flex; justify-content: space-between; }
                    .signature-line { border-top: 1px solid #000; width: 250px; text-align: center; padding-top: 5px; }
                    @media print { button { display: none; } }
                </style>
            </head>
            <body>
                <h1>PROTOKOL: Evidencia meradiel a váh (Metrológia)</h1>
                <div class="header-info">
                    <div>Prevádzka: MIK s.r.o., Šaľa</div>
                    <div>Vygenerované dňa: ${dnes}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:50px;">#</th>
                            <th>Číslo / Názov Váhy</th>
                            <th>Umiestnenie</th>
                            <th>Dátum pos. skúšky</th>
                            <th>Platnosť ciachy DO</th>
                            <th>Poznámka</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map((v, index) => {
                            const isExpired = v.dni_do_konca < 0;
                            return `
                            <tr>
                                <td>${index + 1}</td>
                                <td><strong>${escapeHtml(v.cislo_vahy)}</strong></td>
                                <td>${escapeHtml(v.umiestnenie)}</td>
                                <td>${v.datum_poslednej}</td>
                                <td class="${isExpired ? 'warning' : ''}">${v.datum_dalsej} ${isExpired ? '(NEPLATNÁ)' : ''}</td>
                                <td>${escapeHtml(v.poznamka || '-')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                
                <div class="signature-box">
                    <div class="signature-line">Dátum a pečiatka</div>
                    <div class="signature-line">Zodpovedný vedúci / Podpis</div>
                </div>
                
                <div style="text-align:center; margin-top: 30px;">
                    <button onclick="window.print()" style="padding:10px 20px; font-size:16px; cursor:pointer;">Vytlačiť dokument</button>
                </div>
                <script>window.onload = () => setTimeout(() => window.print(), 500);</script>
            </body>
            </html>`;

            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
        } catch(e) {
            alert('Chyba pri generovaní tlače: ' + e.message);
        }
    },

    printStroje: async function() {
        try {
            const data = await apiRequest('/api/service/stroje');
            const dnes = new Date().toLocaleDateString('sk-SK');
            
            let html = `
            <!DOCTYPE html>
            <html lang="sk">
            <head>
                <meta charset="UTF-8">
                <title>Kniha opráv a údržby</title>
                <style>
                    body { font-family: 'Arial', sans-serif; color: #000; padding: 40px; font-size: 14px; }
                    h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 30px; }
                    .header-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
                    th, td { border: 1px solid #000; padding: 8px; text-align: left; }
                    th { background-color: #e2e8f0; -webkit-print-color-adjust: exact; }
                    .signature-box { margin-top: 50px; display: flex; justify-content: space-between; }
                    .signature-line { border-top: 1px solid #000; width: 250px; text-align: center; padding-top: 5px; }
                    @media print { button { display: none; } }
                </style>
            </head>
            <body>
                <h1>PROTOKOL: Kniha opráv a údržby strojov</h1>
                <div class="header-info">
                    <div>Prevádzka: MIK s.r.o., Šaľa</div>
                    <div>Vygenerované dňa: ${dnes}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:80px;">Dátum</th>
                            <th>Názov stroja</th>
                            <th>Typ úkonu</th>
                            <th>Popis práce</th>
                            <th>Technik / Dodávateľ</th>
                            <th style="text-align:right;">Cena (Bez DPH)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(s => `
                            <tr>
                                <td>${s.datum_opravy}</td>
                                <td><strong>${escapeHtml(s.nazov_stroja)}</strong></td>
                                <td>${escapeHtml(s.typ_zaznamu)}</td>
                                <td>${escapeHtml(s.popis_prace || '-')}</td>
                                <td>${escapeHtml(s.dodavatel_servisu || '-')}</td>
                                <td style="text-align:right;">${Number(s.cena_bez_dph || 0).toFixed(2)} &euro;</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="signature-box">
                    <div class="signature-line">Schválil (Dátum a Podpis)</div>
                </div>
                
                <div style="text-align:center; margin-top: 30px;">
                    <button onclick="window.print()" style="padding:10px 20px; font-size:16px; cursor:pointer;">Vytlačiť dokument</button>
                </div>
                <script>window.onload = () => setTimeout(() => window.print(), 500);</script>
            </body>
            </html>`;

            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
        } catch(e) {
            alert('Chyba pri generovaní tlače: ' + e.message);
        }
    },

    printBudova: async function() {
        try {
            const data = await apiRequest('/api/service/budova');
            const dnes = new Date().toLocaleDateString('sk-SK');
            
            let html = `
            <!DOCTYPE html>
            <html lang="sk">
            <head>
                <meta charset="UTF-8">
                <title>Kniha bežných opráv a údržby</title>
                <style>
                    body { font-family: 'Arial', sans-serif; color: #000; padding: 40px; font-size: 14px; }
                    h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 30px; }
                    .header-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
                    th, td { border: 1px solid #000; padding: 8px; text-align: left; }
                    th { background-color: #e2e8f0; -webkit-print-color-adjust: exact; }
                    .signature-box { margin-top: 50px; display: flex; justify-content: space-between; }
                    .signature-line { border-top: 1px solid #000; width: 250px; text-align: center; padding-top: 5px; }
                    @media print { button { display: none; } }
                </style>
            </head>
            <body>
                <h1>PROTOKOL: Kniha bežných opráv a údržby (Budova a Areál)</h1>
                <div class="header-info">
                    <div>Prevádzka: MIK s.r.o., Šaľa</div>
                    <div>Vygenerované dňa: ${dnes}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:80px;">Dátum</th>
                            <th>Miestnosť / Úsek</th>
                            <th>Popis práce (Závada)</th>
                            <th>Nariadil</th>
                            <th>Vykonal</th>
                            <th>Stav</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(b => `
                            <tr>
                                <td>${b.datum}</td>
                                <td><strong>${escapeHtml(b.miestnost)}</strong></td>
                                <td>${escapeHtml(b.popis_prace)}</td>
                                <td>${escapeHtml(b.nariadene_kym || '-')}</td>
                                <td>${escapeHtml(b.vykonal || '-')}</td>
                                <td>${escapeHtml(b.stav)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="signature-box">
                    <div class="signature-line">Kontroloval (RVPS / Hygiena)</div>
                    <div class="signature-line">Zodpovedný vedúci</div>
                </div>
                
                <div style="text-align:center; margin-top: 30px;">
                    <button onclick="window.print()" style="padding:10px 20px; font-size:16px; cursor:pointer;">Vytlačiť dokument</button>
                </div>
                <script>window.onload = () => setTimeout(() => window.print(), 500);</script>
            </body>
            </html>`;

            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
        } catch(e) {
            alert('Chyba pri generovaní tlače: ' + e.message);
        }
    }
};