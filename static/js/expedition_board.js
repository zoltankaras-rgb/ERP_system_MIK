// static/js/expedition_board.js

let vsetkyStrany = []; 
let aktualnaStranaIndex = 0; 
let rotaciaInterval = null;

const MAX_KARIET_NA_OBRAZOVKU = 8; 

// Dynamické pridanie CSS pre blikanie, aby si nemusel meniť CSS súbory
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

// --- NOVÁ FUNKCIA PRE TACHOMETER TEMPA ---
async function nacitajLiveKPI() {
    try {
        const res = await fetch('/api/leader/tv_board/live_kpi');
        if (!res.ok) return;
        const kpi = await res.json();
        
        let kpiContainer = document.getElementById('tv-live-kpi-banner');
        
        // Ak kontajner ešte neexistuje, dynamicky ho vytvoríme pod hlavičkou/oznamami
        if (!kpiContainer) {
            kpiContainer = document.createElement('div');
            kpiContainer.id = 'tv-live-kpi-banner';
            const gn = document.getElementById('global-note-container');
            if (gn) {
                gn.parentNode.insertBefore(kpiContainer, gn.nextSibling);
            } else {
                document.body.prepend(kpiContainer);
            }
        }

        // Ak už nemajú čo chystať alebo nezačal deň, schováme tachometer
        if (kpi.zostava_chystat === 0) {
            kpiContainer.innerHTML = '';
            return;
        }

        // --- FAREBNÁ PSYCHOLÓGIA (Semafor) ---
        let bgColor = '#3b82f6'; // Neutrálna modrá (ak ešte nezačali)
        let alertText = '';
        let containerStyle = '';
        
        if (kpi.tempo_minuty > 0) {
            if (kpi.tempo_minuty <= 7.0) {
                bgColor = '#10b981'; // Zelená (Dobré tempo, stíhajú)
            } else if (kpi.tempo_minuty <= 10.0) {
                bgColor = '#f59e0b'; // Oranžová (Mierne spomalenie)
            } else {
                bgColor = '#dc2626'; // Červená (KRITICKY POMALÉ TEMPO)
                alertText = '<div style="font-size: 2.2rem; font-weight: 900; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 2px;">⚠️ Kriticky pomalé tempo chystania ⚠️</div>';
                containerStyle = 'animation: blink-critical 1.5s infinite; border: 4px solid #f87171; box-shadow: 0 0 30px rgba(220, 38, 38, 0.8);';
            }
        }

        kpiContainer.innerHTML = `
            <div style="background-color: ${bgColor}; color: white; padding: 15px 20px; border-radius: 12px; margin: 10px 15px 20px 15px; transition: background-color 0.5s; ${containerStyle}">
                ${alertText}
                <div style="display: flex; justify-content: space-around; align-items: center; text-shadow: 1px 1px 3px rgba(0,0,0,0.3);">
                    <div style="text-align: center;">
                        <div style="font-size: 1.1rem; text-transform: uppercase; font-weight: 700; opacity: 0.9; margin-bottom: 5px;">Zostáva nachystať</div>
                        <div style="font-size: 3.5rem; font-weight: 900; line-height: 1;">${kpi.zostava_chystat} <span style="font-size: 1.5rem; font-weight: 600;">obj.</span></div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.1rem; text-transform: uppercase; font-weight: 700; opacity: 0.9; margin-bottom: 5px;">Aktuálne tempo</div>
                        <div style="font-size: 3.5rem; font-weight: 900; line-height: 1;">${kpi.tempo_minuty > 0 ? kpi.tempo_minuty : '--'}<span style="font-size: 1.5rem; font-weight: 600;"> min/obj</span></div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.1rem; text-transform: uppercase; font-weight: 700; opacity: 0.9; margin-bottom: 5px;">Odhadovaný koniec</div>
                        <div style="font-size: 3.5rem; font-weight: 900; line-height: 1; letter-spacing: 2px;">${kpi.odhad_konca ? kpi.odhad_konca : '--:--'}</div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error("Chyba pri načítaní KPI:", e);
    }
}
// ------------------------------------------

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
                    trasa: '🎉 VŠETKO HOTOVÉ',
                    skoreObjednavok: globalCelkom,
                    hotovychObjednavok: globalHotovych,
                    cast: 1, celkovoCasti: 1,
                    kartyNaZobrazenie: [], 
                    jeMrazeneSumar: false,
                    jeGlobalnySumarHotovo: true, 
                    datum_text: data.cielovy_datum
                });
            }

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
                        jeMrazeneSumar: true,
                        jeGlobalnySumarHotovo: false
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

    if (stranaData.jeGlobalnySumarHotovo) {
        hlavnyNadpis.innerHTML = `<i class="fas fa-trophy"></i> SKVELÁ PRÁCA`;
        let htmlHotovo = `
            <div style="text-align:center; width:100%; margin-top:10vh;">
                <i class="fas fa-check-double" style="font-size: 10rem; color: #28a745; margin-bottom: 30px;"></i>
                <h2 style="font-size: 4.5rem; color: #28a745; margin: 0;">Všetky objednávky na ${stranaData.datum_text} sú hotové!</h2>
                <div style="font-size: 3.5rem; color: #ffffff; background: #28a745; display: inline-block; padding: 20px 40px; border-radius: 20px; margin-top: 40px; font-weight: 800; box-shadow: 0 10px 20px rgba(40, 167, 69, 0.3);">
                    Hotové objednávky: ${stranaData.hotovychObjednavok} / ${stranaData.skoreObjednavok}
                </div>
            </div>
        `;
        obsah.innerHTML = htmlHotovo;
        vykresliPaginaciu(paginacia);
        return; 
    }

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

    let html = `<div class="customers-grid">`;

    stranaData.kartyNaZobrazenie.forEach(obj => {
        let cssClass = '';
        let poznamkyHtml = '';
        let badge = '';

        if (stranaData.jeMrazeneSumar) {
            cssClass = 'mrazene-sumar-karta';
            badge = `<span class="status-badge" style="background:#e0f2fe; color:#0284c7; border: 1px solid #bae6fd;"><i class="fas fa-snowflake"></i> Chystať z mrazáku</span>`;
            poznamkyHtml = `<div class="p-riadok mrazena-poznamka"><i class="fas fa-snowflake" style="font-size: 1.5rem; margin-top: 5px;"></i><div style="font-size: 1.6rem;"><strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div></div>`;
        } 
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
        
        let presnaVaha = parseFloat(Number(obj.vaha_kg).toFixed(2));
        let vahaHtml = `<span class="vaha-badge">${vahaIkonka} ${presnaVaha} kg</span>`;

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
    
    vykresliPaginaciu(paginacia);
    setTimeout(prisposobVelkostVertical, 50);
}

function vykresliPaginaciu(container) {
    let paginaciaHtml = '';
    if (vsetkyStrany.length > 1) {
        for (let i = 0; i < vsetkyStrany.length; i++) {
            paginaciaHtml += `<div class="dot ${i === aktualnaStranaIndex ? 'active' : ''}"></div>`;
        }
    }
    container.innerHTML = paginaciaHtml;
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
    
    // Spustenie hlavnej logiky kariet
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); 
    
    // Spustenie Live KPI (Tachometra) - beží súbežne každých 25 sekúnd
    nacitajLiveKPI();
    setInterval(nacitajLiveKPI, 25000);
});