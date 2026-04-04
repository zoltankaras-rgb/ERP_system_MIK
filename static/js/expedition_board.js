// static/js/expedition_board.js

let vsetkyStrany = []; 
let aktualnaStranaIndex = 0; 
let rotaciaInterval = null;

const MAX_KARIET_NA_OBRAZOVKU = 8; 

function aktualizujCas() {
    const teraz = new Date();
    const casString = teraz.toLocaleTimeString('sk-SK', { timeZone: 'Europe/Bratislava', hour12: false });
    document.getElementById('aktualny-cas').textContent = casString;
    const hodina = parseInt(new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: 'numeric', hour12: false }).format(teraz), 10);
    if (hodina >= 16 || hodina < 6) { document.body.classList.add('dark-mode'); } 
    else { document.body.classList.remove('dark-mode'); }
}

function nacitajPoznamkyNaTabulu() {
    fetch('/api/tv-board/data') 
        .then(response => response.json())
        .then(data => {
            if (data.cielovy_datum) document.getElementById('cielovy-datum').innerHTML = `CHYSTÁME NA: ${data.cielovy_datum}`;

            const gn = document.getElementById('global-note-container');
            if (data.global_note && data.global_note.trim() !== '') {
                gn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> OZNAM: ${data.global_note}`;
                gn.style.display = 'block';
            } else { gn.style.display = 'none'; }

            const promo = document.getElementById('coop-promo-container');
            if (data.akcie_coop && data.akcie_coop.length > 0) {
                document.getElementById('coop-promo-list').innerHTML = data.akcie_coop.map(p => `<span class="promo-highlight">${p}</span>`).join(' • ');
                promo.style.display = 'block';
            } else { promo.style.display = 'none'; }

            const poznamky = data.poznamky || [];

            if (poznamky.length === 0) {
                zastavRotaciu();
                document.getElementById('hlavny-nazov-trasy').innerHTML = `<i class="fas fa-check-circle"></i> VŠETKO JE HOTOVÉ`;
                document.getElementById('paginacia-container').innerHTML = '';
                document.getElementById('obsah-tabule').innerHTML = `<h2 style="text-align:center; margin-top:20vh; color:#6c757d; font-size: 3rem;">Zatiaľ nie sú naplánované žiadne objednávky na trase.</h2>`;
                return;
            }

            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov;
                if (!skupinyTrasy.has(trasa)) skupinyTrasy.set(trasa, { vsetky: [], pending: [] });
                skupinyTrasy.get(trasa).vsetky.push(obj);
                if (obj.stav !== 'Hotová' && obj.stav !== 'Expedovaná') {
                    skupinyTrasy.get(trasa).pending.push(obj);
                }
            });

            let noveStrany = [];
            skupinyTrasy.forEach((dataTrasy, trasaNazov) => {
                const pocetCelkom = dataTrasy.vsetky.filter(k => k.ma_objednavku === 1).length;
                const pocetHotovych = dataTrasy.vsetky.filter(k => k.ma_objednavku === 1 && (k.stav === 'Hotová' || k.stav === 'Expedovaná')).length;
                const zoznamKariet = dataTrasy.pending;
                
                if (zoznamKariet.length === 0) {
                    noveStrany.push({
                        trasa: trasaNazov, skoreObjednavok: pocetCelkom, hotovychObjednavok: pocetHotovych,
                        cast: 1, celkovoCasti: 1, kartyNaZobrazenie: [], jeMrazeneSumar: false
                    });
                } else {
                    const celkovoCasti = Math.ceil(zoznamKariet.length / MAX_KARIET_NA_OBRAZOVKU);
                    for (let i = 0; i < zoznamKariet.length; i += MAX_KARIET_NA_OBRAZOVKU) {
                        noveStrany.push({
                            trasa: trasaNazov, skoreObjednavok: pocetCelkom, hotovychObjednavok: pocetHotovych,
                            cast: Math.floor(i / MAX_KARIET_NA_OBRAZOVKU) + 1, celkovoCasti: celkovoCasti,
                            kartyNaZobrazenie: zoznamKariet.slice(i, i + MAX_KARIET_NA_OBRAZOVKU), jeMrazeneSumar: false
                        });
                    }
                }
            });

            // --- NOVÉ: PRIDÁME SUMÁR MRAZENÉHO TOVARU NA ZÁVER ROTÁCIE ---
            const mrazeneKarty = poznamky.filter(obj => obj.mrazene_polozky && obj.mrazene_polozky.trim() !== '');
            if (mrazeneKarty.length > 0) {
                const celkovoCastiMrazene = Math.ceil(mrazeneKarty.length / MAX_KARIET_NA_OBRAZOVKU);
                for (let i = 0; i < mrazeneKarty.length; i += MAX_KARIET_NA_OBRAZOVKU) {
                    noveStrany.push({
                        trasa: '❄️ SUMÁR: MRAZENÝ TOVAR',
                        skoreObjednavok: mrazeneKarty.length,
                        hotovychObjednavok: 0,
                        cast: Math.floor(i / MAX_KARIET_NA_OBRAZOVKU) + 1,
                        celkovoCasti: celkovoCastiMrazene,
                        kartyNaZobrazenie: mrazeneKarty.slice(i, i + MAX_KARIET_NA_OBRAZOVKU),
                        jeMrazeneSumar: true
                    });
                }
            }

            vsetkyStrany = noveStrany;

            if (aktualnaStranaIndex >= vsetkyStrany.length) aktualnaStranaIndex = 0;
            vykresliStranu();

            if (vsetkyStrany.length > 1) {
                if (!rotaciaInterval) {
                    rotaciaInterval = setInterval(() => {
                        aktualnaStranaIndex++;
                        if (aktualnaStranaIndex >= vsetkyStrany.length) aktualnaStranaIndex = 0;
                        vykresliStranu();
                    }, 12000); 
                }
            } else {
                zastavRotaciu();
            }
        })
        .catch(error => console.error('Chyba spojenia s backendom tabule:', error));
}

function vykresliStranu() {
    const obsah = document.getElementById('obsah-tabule');
    const paginacia = document.getElementById('paginacia-container');
    const hlavnyNadpis = document.getElementById('hlavny-nazov-trasy');
    const stranaData = vsetkyStrany[aktualnaStranaIndex];

    let castInfo = '';
    if (stranaData.celkovoCasti > 1) {
        castInfo = ` <span style="font-size: 0.6em; color: #6c757d; font-weight: 600; margin-left: 10px;">(ČASŤ ${stranaData.cast}/${stranaData.celkovoCasti})</span>`;
    }
    
    let scoreBadge = '';
    if (stranaData.jeMrazeneSumar) {
         scoreBadge = `<span class="route-score" style="color: #0284c7; border: 1px solid #0284c7;"><i class="fas fa-snowflake"></i> MRAZÁK: ${stranaData.skoreObjednavok} PREVÁDZOK</span>`;
    } else {
         scoreBadge = `<span class="route-score">
            <i class="fas fa-boxes"></i> SPOLU: ${stranaData.skoreObjednavok} 
            <span class="hotove-text">| <i class="fas fa-check-circle"></i> HOTOVÉ: ${stranaData.hotovychObjednavok}</span>
        </span>`;
    }
    
    hlavnyNadpis.innerHTML = `<i class="fas fa-truck-fast"></i> ${stranaData.trasa} ${scoreBadge} ${castInfo}`;

    if (stranaData.kartyNaZobrazenie.length === 0) {
        let htmlHotovo = `
            <div style="text-align:center; width:100%; margin-top:15vh;">
                <i class="fas fa-check-circle" style="font-size: 8rem; color: #28a745; margin-bottom: 30px;"></i>
                <h2 style="font-size: 3.5rem; color: #28a745; margin: 0;">Všetky objednávky na tejto trase sú pripravené!</h2>
                <p style="font-size: 2rem; color: #6c757d; margin-top: 15px;">(${stranaData.hotovychObjednavok} z ${stranaData.skoreObjednavok})</p>
            </div>
        `;
        obsah.innerHTML = htmlHotovo;
    } else {
        let html = `<div class="customers-grid">`;

        stranaData.kartyNaZobrazenie.forEach(obj => {
            let cssClass = '';
            let poznamkyHtml = '';
            let badge = '';

            // Dizajn pre špeciálnu Sumárnu stranu
            if (stranaData.jeMrazeneSumar) {
                cssClass = 'mrazene-sumar-karta';
                badge = `<span class="status-badge" style="background:#e0f2fe; color:#0284c7; border: 1px solid #bae6fd;"><i class="fas fa-snowflake"></i> Chystať z mrazáku</span>`;
                poznamkyHtml = `<div class="p-riadok mrazena-poznamka"><i class="fas fa-snowflake" style="font-size: 1.5rem; margin-top: 5px;"></i><div style="font-size: 1.6rem;"><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
            } 
            // Dizajn pre klasické strany
            else {
                const maPoznamku = obj.trvala_poznamka || obj.poznamka_objednavky || obj.mrazene_polozky;
                cssClass = maPoznamku ? 'has-notes' : 'has-order';
                badge = `<span class="status-badge badge-order"><i class="fas fa-box"></i> Objednané</span>`;

                if (maPoznamku) {
                    if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
                    if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
                    if (obj.mrazene_polozky) poznamkyHtml += `<div class="p-riadok mrazena-poznamka"><i class="fas fa-snowflake"></i><div><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
                }
            }

            let vahaIkonka = '🧺';
            if (obj.vaha_kategoria === 'velka') vahaIkonka = '🚛';
            else if (obj.vaha_kategoria === 'stredna') vahaIkonka = '🛒';
            
            let vahaHtml = `<span class="vaha-badge">${vahaIkonka} ${Math.round(obj.vaha_kg)} kg</span>`;

            let nazovFirmy = obj.zakaznik;
            if (obj.cislo_prevadzky && obj.cislo_prevadzky.trim() !== '') {
                 if (!nazovFirmy.includes(`[${obj.cislo_prevadzky}]`)) {
                      nazovFirmy = `<span style="color: #6c757d; margin-right: 8px;">[${obj.cislo_prevadzky}]</span>${nazovFirmy}`;
                 }
            }

            let adresaHtml = '';
            if (obj.adresa) {
                adresaHtml = `<div style="font-size: 1.3rem; margin-top: 8px; font-weight: 500; opacity: 0.7;">
                                ${obj.adresa}
                              </div>`;
            }

            html += `
                <div class="karta ${cssClass}">
                    <div class="z-nazov">
                        ${nazovFirmy} 
                        ${adresaHtml}
                    </div>
                    <div class="z-info">
                        <div style="display: flex; gap: 15px; align-items: center;">
                            <span>${obj.id_objednavky || '-'}</span>
                            ${vahaHtml}
                        </div>
                        ${badge}
                    </div>
                    ${poznamkyHtml}
                </div>
            `;
        });
        
        html += `</div>`;
        obsah.innerHTML = html;
    }

    let paginaciaHtml = '';
    if (vsetkyStrany.length > 1) {
        for (let i = 0; i < vsetkyStrany.length; i++) {
            paginaciaHtml += `<div class="dot ${i === aktualnaStranaIndex ? 'active' : ''}"></div>`;
        }
    }
    paginacia.innerHTML = paginaciaHtml;

    setTimeout(prisposobVelkostVertical, 50);
}

function prisposobVelkostVertical() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    if (!contentArea || !board) return;

    board.style.transform = 'none';
    const availableHeight = contentArea.clientHeight - 30; 
    const currentHeight = board.scrollHeight;

    if (currentHeight > availableHeight && availableHeight > 0) {
        let finalScale = (availableHeight / currentHeight) * 0.98;
        finalScale = Math.floor(finalScale * 100) / 100;
        board.style.transform = `scale(${finalScale}) translateZ(0)`;
    }
}

function zastavRotaciu() {
    if (rotaciaInterval) {
        clearInterval(rotaciaInterval);
        rotaciaInterval = null;
    }
}

document.addEventListener("DOMContentLoaded", function() {
    aktualizujCas();
    setInterval(aktualizujCas, 1000); 
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); 
});