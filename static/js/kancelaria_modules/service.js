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
    
    // Nastavíme obsah okna
    const body = modal.querySelector('.modal-body');
    const headerTitle = modal.querySelector('.modal-header h3');
    if (headerTitle) headerTitle.innerText = "Servis a Metrológia";
    if (body) body.innerHTML = html;
    
    // Zobrazíme okno (väčšinou sa používa flex alebo block a class active)
    modal.style.display = 'flex';
    modal.classList.add('show');
    
    // Pridáme logiku na zatvorenie okna cez krížik a kliknutím mimo okna
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
    },

    // --- VÁHY ---
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
                // SEMAFOR PLATNOSTI
                let statusColor = '#16a34a'; // Zelená (OK)
                let statusIkona = 'fa-check-circle';
                if (v.dni_do_konca < 0) { statusColor = '#dc2626'; statusIkona = 'fa-times-circle'; } // Červená (Prepadnuté)
                else if (v.dni_do_konca < 30) { statusColor = '#f59e0b'; statusIkona = 'fa-exclamation-triangle'; } // Žltá (Končí čoskoro)

                return `
                <tr>
                    <td style="font-weight:bold;">${escapeHtml(v.cislo_vahy)}</td>
                    <td><span class="chip">${escapeHtml(v.umiestnenie)}</span></td>
                    <td>${v.datum_poslednej}</td>
                    <td style="color:${statusColor}; font-weight:bold;"><i class="fas ${statusIkona}"></i> ${v.datum_dalsej}</td>
                    <td>${escapeHtml(v.poznamka || '')}</td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-light" onclick='ServiceModule.editVaha(${JSON.stringify(v).replace(/'/g, "&apos;")})'><i class="fas fa-edit"></i></button>
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
            showStatus("Váha uložená", false);
        } catch(e) { alert(e.message); }
    },

    // --- STROJE ---
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
                    <td class="text-right font-weight-bold">${s.cena_bez_dph.toFixed(2)} €<br><small class="muted">s DPH: ${s.cena_s_dph.toFixed(2)} €</small></td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-light" onclick='ServiceModule.editStroj(${JSON.stringify(s).replace(/'/g, "&apos;")})'><i class="fas fa-edit"></i></button>
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
                        <input type="number" id="ss-cenabez" class="form-control" step="0.01" value="${s ? s.cena_bez_dph : '0.00'}" oninput="document.getElementById('ss-cenas').value = (this.value * 1.2).toFixed(2)">
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
            showStatus("Záznam o servise uložený", false);
        } catch(e) { alert(e.message); }
    }
};