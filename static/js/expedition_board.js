// static/js/expedition_board.js

let vsetkyStrany = []; // Bude obsahovať už rozsekané časti trás
let aktualnaStranaIndex = 0; 
let rotaciaInterval = null;

const MAX_KARIET_NA_OBRAZOVKU = 8; // Bezpečný limit pre masívne TV písmo

function aktualizujCas() {
    const teraz = new Date();
    const hodina = teraz.getHours();
    
    document.getElementById('aktualny-cas').textContent = teraz.toLocaleTimeString('sk-SK', { hour12: false });

    if (hodina >= 16 || hodina < 6) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

function nacitajPoznamkyNaTabulu() {
    fetch('/api/tv-board/data') 
        .then(response => response.json())
        .then(data => {
            if (data.cielovy_datum) document.getElementById('cielovy-datum').innerHTML = `Chystáme na: <strong>${data.cielovy_datum}</strong>`;

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
                document.getElementById('paginacia-container').innerHTML = '';
                document.getElementById('obsah-tabule').innerHTML = `<h2 style="text-align:center; margin-top:20vh; color:#6c757d; font-size: 3rem;">Zatiaľ nie sú naplánované žiadne objednávky na trase.</h2>`;
                return;
            }

            // 1. Zoskupenie kariet podľa trasy
            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov;
                if (!skupinyTrasy.has(trasa)) skupinyTrasy.set(trasa, []);
                skupinyTrasy.get(trasa).push(obj);
            });

            // 2. Rozsekanie veľkých trás na menšie strany (stránkovanie pre TV)
            vsetkyStrany = [];
            skupinyTrasy.forEach((zoznamKariet, trasaNazov) => {
                const celkovoCasti = Math.ceil(zoznamKariet.length / MAX_KARIET_NA_OBRAZOVKU);
                
                for (let i = 0; i < zoznamKariet.length; i += MAX_KARIET_NA_OBRAZOVKU) {
                    vsetkyStrany.push({
                        trasa: trasaNazov,
                        cast: Math.floor(i / MAX_KARIET_NA_OBRAZOVKU) + 1,
                        celkovoCasti: celkovoCasti,
                        kartyNaZobrazenie: zoznamKariet.slice(i, i + MAX_KARIET_NA_OBRAZOVKU)
                    });
                }
            });

            if (aktualnaStranaIndex >= vsetkyStrany.length) aktualnaStranaIndex = 0;

            vykresliStranu();

            // Rotácia preblikne každú "stranu" (nie nutne celú trasu naraz)
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
    const stranaData = vsetkyStrany[aktualnaStranaIndex];

    // Ak má trasa viac častí, zobrazíme napr. (1/2) v hlavičke
    let castInfo = '';
    if (stranaData.celkovoCasti > 1) {
        castInfo = `<span class="route-page-info">(Časť ${stranaData.cast}/${stranaData.celkovoCasti})</span>`;
    }

    let html = `
        <div class="full-route-header">
            <i class="fas fa-truck-fast"></i> ${stranaData.trasa} ${castInfo}
        </div>
        <div class="customers-grid">
    `;

    stranaData.kartyNaZobrazenie.forEach(obj => {
        const maPoznamku = obj.trvala_poznamka || obj.poznamka_objednavky;
        const cssClass = maPoznamku ? 'has-notes' : 'has-order';
        const badge = `<span class="status-badge badge-order"><i class="fas fa-box"></i> Objednané</span>`;

        let poznamkyHtml = '';
        if (maPoznamku) {
            if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
            if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
        }

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
                    <span>${obj.id_objednavky || '-'}</span>
                    ${badge}
                </div>
                ${poznamkyHtml}
            </div>
        `;
    });
    
    html += `</div>`;
    obsah.innerHTML = html;

    let paginaciaHtml = '';
    if (vsetkyStrany.length > 1) {
        for (let i = 0; i < vsetkyStrany.length; i++) {
            paginaciaHtml += `<div class="dot ${i === aktualnaStranaIndex ? 'active' : ''}"></div>`;
        }
    }
    paginacia.innerHTML = paginaciaHtml;

    // Aplikujeme jemné prispôsobenie len ako absolútnu záchranu, text by už nemal byť mikroskopický
    setTimeout(prisposobVelkostVertical, 50);
}

function prisposobVelkostVertical() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    if (!contentArea || !board) return;

    board.style.transform = 'none';
    const availableHeight = contentArea.clientHeight - 60; 
    const currentHeight = board.scrollHeight;

    if (currentHeight > availableHeight && availableHeight > 0) {
        let finalScale = (availableHeight / currentHeight) * 0.98;
        board.style.transform = `scale(${finalScale})`;
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