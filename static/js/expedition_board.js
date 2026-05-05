// static/js/expedition_board.js

let vsetkyStrany = []; 
let aktualnaStranaIndex = 0; 
let rotaciaInterval = null;

// PREMENNÉ PRE TERMINÁL FOCUS
let aktualnyFocus = null;
let vsetkyPoznamkyData = []; 

const MAX_KARIET_NA_OBRAZOVKU = 8; 

// =======================================================================
// CSS INJEKCIA: Špeciálne štýly pre TV a gigantický Focus Overlay
// =======================================================================
const style = document.createElement('style');
style.innerHTML = `
  @keyframes blink-critical {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.02); }
    100% { opacity: 1; transform: scale(1); }
  }

  /* Fullscreen tmavé pozadie pre focus mód (viewport units) */
  #tv-focus-overlay {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.95); /* Tmavá modrosivá nepriehľadnosť */
      z-index: 99999;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      color: white;
      text-align: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s ease-in-out;
  }
  
  /* Aktívny stav */
  #tv-focus-overlay.active {
      opacity: 1;
      pointer-events: auto;
  }

  /* Samotná masívna karta */
  .tv-focus-box {
      background: #1e293b;
      border: 1vh solid #3b82f6;
      border-radius: 4vh;
      padding: 6vh 5vw;
      width: 85vw;
      box-shadow: 0 4vh 10vh rgba(0,0,0,0.8);
      transform: scale(0.8);
      transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  
  #tv-focus-overlay.active .tv-focus-box {
      transform: scale(1);
  }

  /* Gigantické texty pre čitateľnosť z 10 metrov */
  .tv-title {
      font-size: 8vh;
      color: #60a5fa;
      text-transform: uppercase;
      letter-spacing: 0.5vw;
      margin-bottom: 2vh;
      font-weight: 900;
  }
  .tv-customer {
      font-size: 10vh;
      font-weight: bold;
      color: #ffffff;
      margin-bottom: 4vh;
      line-height: 1.2;
  }
  
  /* Nový dizajn pre poznámky */
  .tv-notes-container {
      background: #0f172a;
      padding: 4vh 4vw;
      border-radius: 3vh;
      border-left: 1vw solid #f59e0b;
      text-align: left;
      min-height: 20vh;
      display: flex;
      flex-direction: column;
      gap: 2vh;
  }
  
  .tv-note-item {
      font-size: 4vh;
      color: #f8fafc;
      background: rgba(255, 255, 255, 0.05);
      padding: 2vh 3vw;
      border-radius: 1.5vh;
      border-left: 0.5vw solid #3b82f6;
  }
  
  .tv-note-item i {
      margin-right: 1.5vw;
      color: #60a5fa;
  }
  
  .tv-note-item.permanent {
      border-left-color: #ef4444;
  }
  .tv-note-item.permanent i {
      color: #f87171;
  }
  
  .tv-note-item.empty {
      border-left-color: #64748b;
      color: #94a3b8;
      text-align: center;
      background: transparent;
  }
`;
document.head.appendChild(style);

// =======================================================================
// ZÁKLADNÁ LOGIKA ČASU A KPI
// =======================================================================
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

// =======================================================================
// NAČÍTANIE OBSAHU TABULE
// =======================================================================
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

            // Ak je aktívny mód váhy, len aktualizujeme meno (ak sa načíta lepšie), inak necháme rotáciu
            if (aktualnyFocus !== null) {
                zastavRotaciu();
                ukazTvFocusOverlay(aktualnyFocus, false);
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

// =======================================================================
// MASÍVNY OVERLAY PRE VÁŽENIE (FOCUS MÓD) - UPRAVENÝ
// =======================================================================

// Funkcia na zapnutie a vizuálne nastavenie Overlay okna (s poznámkami)
function ukazTvFocusOverlay(cisloObjednavky, jeNovyFocus = false) {
    const overlay = document.getElementById('tv-focus-overlay');
    const customerEl = document.getElementById('tv-focus-customer');
    const notesEl = document.getElementById('tv-focus-notes');

    if (!overlay) return;

    let custName = cisloObjednavky;
    let notesHtml = '';
    
    // 1. BEZPEČNÉ PÁROVANIE: odstránime medzery a zjednotíme veľkosť písmen pre istotu
    const hladaneCislo = String(cisloObjednavky).trim().toLowerCase();
    let obj = vsetkyPoznamkyData.find(o => String(o.id_objednavky).trim().toLowerCase() === hladaneCislo);
    
    // 2. OKAMŽITÝ REFRESH: Ak TV monitor ešte nestihol stiahnuť túto objednávku, prinútime ho stiahnuť dáta hneď!
    if (!obj && jeNovyFocus) {
        fetch('/api/tv-board/data')
            .then(r => r.json())
            .then(data => {
                vsetkyPoznamkyData = data.poznamky || [];
                // Zavoláme funkciu znova s už čerstvými dátami, aby sa detail okamžite zobrazil
                ukazTvFocusOverlay(cisloObjednavky, false);
            })
            .catch(err => console.error("Chyba pri nútenom načítaní dát:", err));
        // Zatiaľ necháme zobrazené "Načítavam...", kým sa nedokončí fetch
    }

    if (obj) {
        custName = obj.zakaznik;
        if (obj.cislo_prevadzky && String(obj.cislo_prevadzky).trim() !== '') {
            custName = `<span style="color: #94a3b8;">[${obj.cislo_prevadzky}]</span> ${custName}`;
        }
        
        let hasNotes = false;
        
        if (obj.trvala_poznamka && obj.trvala_poznamka.trim() !== '') {
            notesHtml += `<div class="tv-note-item permanent"><i class="fas fa-exclamation-circle"></i> <strong>STÁLA POŽIADAVKA:</strong> ${obj.trvala_poznamka}</div>`;
            hasNotes = true;
        }
        
        // Poznámka k objednávke (vrátane pripojených poznámok k položkám z backendu)
        if (obj.poznamka_objednavky && obj.poznamka_objednavky.trim() !== '') {
            notesHtml += `<div class="tv-note-item"><i class="fas fa-info-circle"></i> <strong>K OBJEDNÁVKE / POLOŽKÁM:</strong> ${obj.poznamka_objednavky}</div>`;
            hasNotes = true;
        }
        
        // 3. OPRAVA: Vynútené vykreslenie poznámok od VEDÚCEJ VÝROBY
        if (obj.poznamka_veduceho && obj.poznamka_veduceho.trim() !== '') {
            notesHtml += `<div class="tv-note-item" style="border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.15); color: #fbbf24;"><i class="fas fa-comment-dots"></i> <strong>OD VEDÚCEJ VÝROBY:</strong> ${obj.poznamka_veduceho}</div>`;
            hasNotes = true;
        }
        
        if (obj.mrazene_polozky && obj.mrazene_polozky.trim() !== '') {
            notesHtml += `<div class="tv-note-item"><i class="fas fa-snowflake"></i> <strong>MRAZENÉ:</strong> ${obj.mrazene_polozky}</div>`;
            hasNotes = true;
        }
        
        if (!hasNotes) {
            notesHtml = `<div class="tv-note-item empty"><i class="fas fa-check"></i> Žiadne špeciálne poznámky k objednávke.</div>`;
        }
        
    } else {
        notesHtml = `<div class="tv-note-item empty"><i class="fas fa-search"></i> Načítavam detaily objednávky...</div>`;
    }
    
    customerEl.innerHTML = custName;
    notesEl.innerHTML = notesHtml;
    overlay.classList.add('active');
}

// Funkcia na vypnutie Overlay okna
function skryTvFocusOverlay() {
    const overlay = document.getElementById('tv-focus-overlay');
    if (overlay) overlay.classList.remove('active');
    
    // Zvyšok nechávame pre spätnú kompatibilitu alebo neskoršie využitie
}

async function kontrolujFocus() {
    try {
        const res = await fetch('/api/tv-board/current-focus');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.active_order !== aktualnyFocus) {
            aktualnyFocus = data.active_order;
            
            // AK SA VÁŽENIE SKONČILO / PRERUŠILO
            if (aktualnyFocus === null || aktualnyFocus === "") {
                skryTvFocusOverlay();
                
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
            } 
            // AK SA ZAČÍNA NOVÉ VÁŽENIE
            else {
                zastavRotaciu();
                const promo = document.getElementById('coop-promo-container');
                if (promo) promo.style.display = 'none';
                
                // Zobraziť Fullscreen TV Overlay
                ukazTvFocusOverlay(aktualnyFocus, true);
            }
        }
    } catch (e) { console.error("Chyba overovania focusu:", e); }
}

// =======================================================================
// VYKRESLENIE ŠTANDARDNEJ ROTUJÚCEJ TABULE
// =======================================================================
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
            // PRIDANÉ: Skontrolujeme aj poznamka_veduceho
            const maPoznamku = obj.trvala_poznamka || obj.poznamka_objednavky || obj.mrazene_polozky || obj.poznamka_veduceho;
            cssClass = maPoznamku ? 'has-notes' : 'has-order';
            badge = `<span class="status-badge badge-order"><i class="fas fa-box"></i> Objednané</span>`;

            if (maPoznamku) {
                if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
                if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
                // PRIDANÉ: Výpis jednorazovej poznámky do malej kartičky
                if (obj.poznamka_veduceho) poznamkyHtml += `<div class="p-riadok" style="color: #b45309; background: #fef3c7; border-left: 4px solid #f59e0b;"><i class="fas fa-comment-dots"></i><div><strong>JEDNORÁZOVÁ:</strong> ${obj.poznamka_veduceho}</div></div>`;
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

// =======================================================================
// INICIALIZÁCIA
// =======================================================================
document.addEventListener("DOMContentLoaded", function() {
    
    // Pridanie Overlay elementu do DOMu pre TV Focus Mode - UPRAVENÉ (s poznámkami)
    if (!document.getElementById('tv-focus-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'tv-focus-overlay';
        overlay.innerHTML = `
            <div class="tv-focus-box">
                <div class="tv-title"><i class="fas fa-satellite-dish fa-fade"></i> Práve sa chystá</div>
                <div class="tv-customer" id="tv-focus-customer">HĽADÁM OBJEDNÁVKU...</div>
                <div class="tv-notes-container" id="tv-focus-notes">
                    </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    aktualizujCas();
    setInterval(aktualizujCas, 1000); 
    
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); 
    
    nacitajLiveKPI();
    setInterval(nacitajLiveKPI, 25000);

    // Overovanie focusu veľmi rýchlo (každú 1.5 sekundu)
    setInterval(kontrolujFocus, 1500); 
});