// static/js/expedition_board.js

let vsetkyStrany = []; 
let aktualnaStranaIndex = 0; 
let rotaciaInterval = null;

// PREMENNÉ PRE TERMINÁL FOCUS
let aktualnyFocus = null;
let vsetkyPoznamkyData = []; 

const MAX_KARIET_NA_OBRAZOVKU = 8; 

// --- DYNAMICKÉ CSS PRE TABUĽU ---
const style = document.createElement('style');
style.innerHTML = `
  @keyframes blink-critical {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.02); }
    100% { opacity: 1; transform: scale(1); }
  }
`;
document.head.appendChild(style);

function aktualizujCas() {
    const teraz = new Date();
    const casString = teraz.toLocaleTimeString('sk-SK', { timeZone: 'Europe/Bratislava', hour12: false });
    document.getElementById('aktualny-cas').textContent = casString;
    const hodina = parseInt(new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', hour: 'numeric', hour12: false }).format(teraz), 10);
    if (hodina >= 16 || hodina < 6) { document.body.classList.add('dark-mode'); } 
    else { document.body.classList.remove('dark-mode'); }
}

async function nacitajLiveKPI() {
    try {
        const res = await fetch('/api/leader/tv_board/live_kpi');
        if (!res.ok) return;
        const kpi = await res.json();
        
        let kpiContainer = document.getElementById('tv-live-kpi-banner');
        if (!kpiContainer) {
            kpiContainer = document.createElement('div');
            kpiContainer.id = 'tv-live-kpi-banner';
            const gn = document.getElementById('global-note-container');
            if (gn) gn.parentNode.insertBefore(kpiContainer, gn.nextSibling);
            else document.body.prepend(kpiContainer);
        }

        if (kpi.zostava_chystat === 0) {
            kpiContainer.style.display = 'none';
            return;
        } else {
            kpiContainer.style.display = 'block';
        }

        let bgColor = '#1e293b'; 
        let textColor = '#f8fafc'; 
        let blinkStyle = '';
        
        if (kpi.tempo_minuty > 0) {
            if (kpi.tempo_minuty < 7.0) bgColor = '#064e3b'; 
            else if (kpi.tempo_minuty > 10.0) {
                bgColor = '#7f1d1d'; 
                blinkStyle = 'animation: blink-critical 1.5s infinite; border-bottom: 2px solid #f87171;';
            }
        }

        kpiContainer.innerHTML = `
            <div style="background: ${bgColor}; color: ${textColor}; padding: 10px 25px; display: flex; justify-content: space-between; align-items: center; font-family: sans-serif; border-bottom: 2px solid rgba(255,255,255,0.1); box-shadow: 0 4px 6px rgba(0,0,0,0.15); transition: background-color 0.5s; ${blinkStyle}">
                <div style="font-size: 1.2rem; font-weight: bold; letter-spacing: 1px;">
                    <i class="fas fa-calendar-check" style="margin-right: 8px; color: #94a3b8;"></i> DNES CHYSTÁME NA: <span style="color: #fbbf24;">${kpi.target_date || '--.--.----'}</span>
                </div>
                <div style="display: flex; gap: 40px; font-size: 1.2rem; align-items: center;">
                    <span>Zostáva: <strong style="font-size: 1.5rem;">${kpi.zostava_chystat}</strong> obj.</span>
                    <span>Tempo: <strong style="font-size: 1.5rem;">${kpi.tempo_minuty > 0 ? kpi.tempo_minuty : '--'}</strong> min/obj</span>
                    <span style="background: rgba(0,0,0,0.3); padding: 4px 15px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                        Odhad konca: <strong style="font-size: 1.6rem; color: #fbbf24; letter-spacing: 1px;">${kpi.odhad_konca || '--:--'}</strong>
                    </span>
                </div>
            </div>
        `;
    } catch (e) { console.error("Chyba pri načítaní KPI:", e); }
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
                if (aktualnyFocus === null) promo.style.display = 'block';
            } else { 
                promo.style.display = 'none'; 
                document.getElementById('coop-promo-list').innerHTML = '';
            }

            const poznamky = data.poznamky || [];
            
            // Uloženie dát pre focus mód
            vsetkyPoznamkyData = poznamky; 

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
                if (obj.stav !== 'Hotová' && obj.stav !== 'Expedovaná') skupinyTrasy.get(trasa).pending.push(obj);
            });

            let noveStrany = [];
            let globalCelkom = 0;
            let globalHotovych = 0;

            skupinyTrasy.forEach((dataTrasy, trasaNazov) => {
                const pocetCelkom = dataTrasy.vsetky.filter(k => k.ma_objednavku === 1).length;
                const pocetHotovych = dataTrasy.vsetky.filter(k => k.ma_objednavku === 1 && (k.stav === 'Hotová' || k.stav === 'Expedovaná')).length;
                const zoznamKariet = dataTrasy.pending;
                
                globalCelkom += pocetCelkom;
                globalHotovych += pocetHotovych;

                if (zoznamKariet.length > 0) {
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

            if (globalCelkom > 0 && globalCelkom === globalHotovych) {
                noveStrany.push({
                    trasa: '🎉 VŠETKO HOTOVÉ', skoreObjednavok: globalCelkom, hotovychObjednavok: globalHotovych,
                    cast: 1, celkovoCasti: 1, kartyNaZobrazenie: [], jeMrazeneSumar: false, jeGlobalnySumarHotovo: true, datum_text: data.cielovy_datum
                });
            }

            const mrazeneKarty = poznamky.filter(obj => obj.mrazene_polozky && obj.mrazene_polozky.trim() !== '');
            if (mrazeneKarty.length > 0) {
                const celkovoCastiMrazene = Math.ceil(mrazeneKarty.length / MAX_KARIET_NA_OBRAZOVKU);
                for (let i = 0; i < mrazeneKarty.length; i += MAX_KARIET_NA_OBRAZOVKU) {
                    noveStrany.push({
                        trasa: '❄️ SUMÁR: MRAZENÝ TOVAR', skoreObjednavok: mrazeneKarty.length, hotovychObjednavok: 0,
                        cast: Math.floor(i / MAX_KARIET_NA_OBRAZOVKU) + 1, celkovoCasti: celkovoCastiMrazene,
                        kartyNaZobrazenie: mrazeneKarty.slice(i, i + MAX_KARIET_NA_OBRAZOVKU), jeMrazeneSumar: true, jeGlobalnySumarHotovo: false
                    });
                }
            }

            vsetkyStrany = noveStrany;

            // ZÁMOK: Necháme tabuľu v zobrazení detailu, ak vážia na termináli.
            if (aktualnyFocus !== null) {
                zastavRotaciu();
                vykresliDetailObjednavky(aktualnyFocus);
                return;
            }

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
            } else zastavRotaciu();
        })
        .catch(error => console.error('Chyba spojenia:', error));
}

function vykresliStranu() {
    const obsah = document.getElementById('obsah-tabule');
    const paginacia = document.getElementById('paginacia-container');
    const hlavnyNadpis = document.getElementById('hlavny-nazov-trasy');
    
    if (vsetkyStrany.length === 0) return;
    const stranaData = vsetkyStrany[aktualnaStranaIndex];

    if (stranaData.jeGlobalnySumarHotovo) {
        hlavnyNadpis.innerHTML = `<i class="fas fa-trophy"></i> SKVELÁ PRÁCA`;
        obsah.innerHTML = `
            <div style="text-align:center; width:100%; margin-top:10vh;">
                <i class="fas fa-check-double" style="font-size: 10rem; color: #28a745; margin-bottom: 30px;"></i>
                <h2 style="font-size: 4.5rem; color: #28a745; margin: 0;">Všetky objednávky na ${stranaData.datum_text} sú hotové!</h2>
                <div style="font-size: 3.5rem; color: #ffffff; background: #28a745; display: inline-block; padding: 20px 40px; border-radius: 20px; margin-top: 40px; font-weight: 800;">
                    Hotové objednávky: ${stranaData.hotovychObjednavok} / ${stranaData.skoreObjednavok}
                </div>
            </div>`;
        vykresliPaginaciu(paginacia);
        return; 
    }

    let castInfo = stranaData.celkovoCasti > 1 ? ` <span style="font-size: 0.6em; color: #6c757d; font-weight: 600; margin-left: 10px;">(ČASŤ ${stranaData.cast}/${stranaData.celkovoCasti})</span>` : '';
    let scoreBadge = stranaData.jeMrazeneSumar 
        ? `<span class="route-score" style="color: #0284c7; border: 1px solid #0284c7;"><i class="fas fa-snowflake"></i> MRAZÁK: ${stranaData.skoreObjednavok} PREVÁDZOK</span>`
        : `<span class="route-score"><i class="fas fa-boxes"></i> SPOLU: ${stranaData.skoreObjednavok} <span class="hotove-text">| <i class="fas fa-check-circle"></i> HOTOVÉ: ${stranaData.hotovychObjednavok}</span></span>`;
    
    hlavnyNadpis.innerHTML = `<i class="fas fa-truck-fast"></i> ${stranaData.trasa} ${scoreBadge} ${castInfo}`;

    let html = `<div class="customers-grid">`;
    stranaData.kartyNaZobrazenie.forEach(obj => {
        let cssClass = '';
        let poznamkyHtml = '';
        let badge = '';

        if (stranaData.jeMrazeneSumar) {
            cssClass = 'mrazene-sumar-karta';
            badge = `<span class="status-badge" style="background:#e0f2fe; color:#0284c7; border: 1px solid #bae6fd;"><i class="fas fa-snowflake"></i> Chystať z mrazáku</span>`;
            poznamkyHtml = `<div class="p-riadok mrazena-poznamka"><i class="fas fa-snowflake" style="font-size: 1.5rem; margin-top: 5px;"></i><div style="font-size: 1.6rem;"><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
        } else {
            const maPoznamku = obj.trvala_poznamka || obj.poznamka_objednavky || obj.mrazene_polozky;
            cssClass = maPoznamku ? 'has-notes' : 'has-order';
            badge = `<span class="status-badge badge-order"><i class="fas fa-box"></i> Objednané</span>`;

            if (maPoznamku) {
                if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
                if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
                if (obj.mrazene_polozky) poznamkyHtml += `<div class="p-riadok mrazena-poznamka"><i class="fas fa-snowflake"></i><div><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
            }
        }

        let vahaIkonka = obj.vaha_kategoria === 'velka' ? '🚛' : (obj.vaha_kategoria === 'stredna' ? '🛒' : '🧺');
        let presnaVaha = parseFloat(Number(obj.vaha_kg).toFixed(2));
        let nazovFirmy = obj.zakaznik;
        
        if (obj.cislo_prevadzky && obj.cislo_prevadzky.trim() !== '') {
             if (!nazovFirmy.includes(`[${obj.cislo_prevadzky}]`)) nazovFirmy = `<span style="color: #6c757d; margin-right: 8px;">[${obj.cislo_prevadzky}]</span>${nazovFirmy}`;
        }
        let adresaHtml = obj.adresa ? `<div style="font-size: 1.3rem; margin-top: 8px; font-weight: 500; opacity: 0.7;">${obj.adresa}</div>` : '';

        html += `
            <div class="karta ${cssClass}">
                <div class="z-nazov">${nazovFirmy} ${adresaHtml}</div>
                <div class="z-info">
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <span>${obj.id_objednavky || '-'}</span>
                        <span class="vaha-badge">${vahaIkonka} ${presnaVaha} kg</span>
                    </div>
                    ${badge}
                </div>
                ${poznamkyHtml}
            </div>
        `;
    });
    
    html += `</div>`;
    obsah.innerHTML = html;
    vykresliPaginaciu(paginacia);
    setTimeout(prisposobVelkostVertical, 50);
}

// --- RÝCHLY POLLING (Overovanie zámku terminálu) ---
async function kontrolujFocus() {
    try {
        const res = await fetch('/api/tv-board/current-focus');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.active_order !== aktualnyFocus) {
            aktualnyFocus = data.active_order;
            
            if (aktualnyFocus === null || aktualnyFocus === "") {
                // Vypnutie focus módu
                const promo = document.getElementById('coop-promo-container');
                if (promo && document.getElementById('coop-promo-list').innerHTML !== '') promo.style.display = 'block'; 
                
                vykresliStranu();
                if (!rotaciaInterval && vsetkyStrany.length > 1) {
                    rotaciaInterval = setInterval(() => {
                        aktualnaStranaIndex++;
                        if (aktualnaStranaIndex >= vsetkyStrany.length) aktualnaStranaIndex = 0;
                        vykresliStranu();
                    }, 12000); 
                }
            } else {
                // Zapnutie focus módu
                zastavRotaciu();
                vykresliDetailObjednavky(aktualnyFocus);
            }
        }
    } catch (e) { console.error("Chyba overovania focusu:", e); }
}

// --- NOVÝ OPTIMALIZOVANÝ DETAIL (Centrovaná "Mega-Karta") ---
function vykresliDetailObjednavky(cisloObjednavky) {
    const obsah = document.getElementById('obsah-tabule');
    const paginacia = document.getElementById('paginacia-container');
    const hlavnyNadpis = document.getElementById('hlavny-nazov-trasy');
    const promo = document.getElementById('coop-promo-container');
    
    paginacia.innerHTML = ''; 
    if (promo) promo.style.display = 'none'; 
    obsah.style.transform = 'none'; 
    
    const obj = vsetkyPoznamkyData.find(o => o.id_objednavky === cisloObjednavky);
    
    if (!obj) {
        hlavnyNadpis.innerHTML = `<span style="color:#d32f2f;"><i class="fas fa-satellite-dish fa-fade"></i> HĽADÁM OBJEDNÁVKU...</span>`;
        obsah.innerHTML = `<h2 style="text-align:center; margin-top:20vh; font-size:4rem; color:#6c757d;">Objednávka ${cisloObjednavky} zatiaľ nebola priradená na trasu.</h2>`;
        return;
    }

    hlavnyNadpis.innerHTML = `<span style="color:#28a745;"><i class="fas fa-satellite-dish fa-fade"></i> VÁHA SPRACUJE:</span> ${cisloObjednavky}`;
    
    // Používame natívne triedy pre poznámky z tvojho štandardného CSS
    let poznamkyHtml = '';
    if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka" style="font-size: 3rem; margin-top: 15px;"><i class="fas fa-exclamation-circle" style="margin-top: 5px;"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
    if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka" style="font-size: 3rem; margin-top: 15px;"><i class="fas fa-info-circle" style="margin-top: 5px;"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
    if (obj.mrazene_polozky) poznamkyHtml += `<div class="p-riadok mrazena-poznamka" style="font-size: 3rem; margin-top: 15px;"><i class="fas fa-snowflake" style="margin-top: 5px;"></i><div><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
    
    if (!poznamkyHtml) poznamkyHtml = `<div class="p-riadok" style="font-size: 3rem; color: #28a745; margin-top: 15px;"><i class="fas fa-check-circle" style="margin-top: 5px;"></i> <div>Bez špeciálnych poznámok k tejto objednávke.</div></div>`;

    const vahaZobrazena = parseFloat(Number(obj.vaha_kg).toFixed(2));
    let vahaIkonka = obj.vaha_kategoria === 'velka' ? '🚛' : (obj.vaha_kategoria === 'stredna' ? '🛒' : '🧺');
    
    let nazovFirmy = obj.zakaznik;
    if (obj.cislo_prevadzky && obj.cislo_prevadzky.trim() !== '') {
         if (!nazovFirmy.includes(`[${obj.cislo_prevadzky}]`)) nazovFirmy = `<span style="color: #6c757d; margin-right: 15px;">[${obj.cislo_prevadzky}]</span>${nazovFirmy}`;
    }

    let cssClass = (obj.trvala_poznamka || obj.poznamka_objednavky || obj.mrazene_polozky) ? 'has-notes' : 'has-order';
    if (obj.mrazene_polozky && !obj.trvala_poznamka && !obj.poznamka_objednavky) { cssClass = 'mrazene-sumar-karta'; }

    // Flexbox centrovanie jednej "Mega-Karty" s obmedzenou max-šírkou (max-width)
    obsah.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: flex-start; width: 100%; height: 100%; padding-top: 30px; box-sizing: border-box;">
            
            <div class="karta ${cssClass}" style="width: 100%; max-width: 1400px; padding: 50px; border-left-width: 25px; box-shadow: 0 15px 50px rgba(0,0,0,0.2);">
                
                <div class="z-nazov" style="font-size: 5rem; margin-bottom: 20px; line-height: 1.1;">
                    ${nazovFirmy}
                </div>
                
                <div style="font-size: 2.8rem; opacity: 0.7; margin-bottom: 40px; border-bottom: 3px solid rgba(128,128,128,0.2); padding-bottom: 25px; display: flex; align-items: center; gap: 15px;">
                    <i class="fas fa-map-marker-alt"></i> ${obj.adresa || 'Adresa neuvedená'}
                </div>

                <div class="z-info" style="border: none; padding: 0; margin-bottom: 40px;">
                    <div style="display: flex; gap: 30px; align-items: center; width: 100%; flex-wrap: wrap;">
                        <span class="vaha-badge" style="font-size: 4rem; padding: 20px 40px; border-radius: 20px;">
                            ${vahaIkonka} ${vahaZobrazena} kg
                        </span>
                        <span class="vaha-badge" style="font-size: 4rem; padding: 20px 40px; border-radius: 20px; background: #ffc107; color: #000; border: 2px solid #e0a800;">
                            <i class="fas fa-truck"></i> ${obj.trasa_nazov}
                        </span>
                        <span class="status-badge badge-order" style="font-size: 3rem; padding: 20px 40px; border-radius: 20px; margin-left: auto;">
                            <i class="fas fa-barcode"></i> OBJ: ${obj.id_objednavky || '-'}
                        </span>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 20px;">
                    ${poznamkyHtml}
                </div>
                
            </div>

        </div>
    `;
}

function vykresliPaginaciu(container) {
    let paginaciaHtml = '';
    if (vsetkyStrany.length > 1) {
        for (let i = 0; i < vsetkyStrany.length; i++) paginaciaHtml += `<div class="dot ${i === aktualnaStranaIndex ? 'active' : ''}"></div>`;
    }
    container.innerHTML = paginaciaHtml;
}

function prisposobVelkostVertical() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    if (!contentArea || !board) return;

    if (aktualnyFocus !== null) {
        board.style.transform = 'none';
        return;
    }

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
    
    nacitajLiveKPI();
    setInterval(nacitajLiveKPI, 25000);

    // Overovanie každú 1.5 sekundu pre rýchlu odozvu s terminálom
    setInterval(kontrolujFocus, 1500); 
});