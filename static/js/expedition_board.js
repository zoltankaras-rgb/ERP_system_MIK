// static/js/expedition_board.js

let vsetkyTrasy = []; 
let aktualnaTrasaIndex = 0; 
let rotaciaInterval = null;

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
                document.getElementById('obsah-tabule').innerHTML = `<h2 style="text-align:center; margin-top:20vh; color:#6c757d; font-size: 2.5rem;">Zatiaľ nie sú naplánované žiadne objednávky na trase.</h2>`;
                return;
            }

            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov;
                if (!skupinyTrasy.has(trasa)) skupinyTrasy.set(trasa, []);
                skupinyTrasy.get(trasa).push(obj);
            });

            vsetkyTrasy = Array.from(skupinyTrasy, ([trasa, zoznamKariet]) => ({ trasa, zoznamKariet }));

            if (aktualnaTrasaIndex >= vsetkyTrasy.length) aktualnaTrasaIndex = 0;

            vykresliTrasnu();

            if (vsetkyTrasy.length > 1) {
                if (!rotaciaInterval) {
                    rotaciaInterval = setInterval(() => {
                        aktualnaTrasaIndex++;
                        if (aktualnaTrasaIndex >= vsetkyTrasy.length) aktualnaTrasaIndex = 0;
                        vykresliTrasnu();
                    }, 12000); 
                }
            } else {
                zastavRotaciu();
            }
        })
        .catch(error => console.error('Chyba spojenia s backendom tabule:', error));
}

function vykresliTrasnu() {
    const obsah = document.getElementById('obsah-tabule');
    const paginacia = document.getElementById('paginacia-container');
    const trasaData = vsetkyTrasy[aktualnaTrasaIndex];

    let html = `<div class="full-route-header"><i class="fas fa-truck-fast"></i> ${trasaData.trasa}</div>`;
    html += `<div class="customers-grid">`;

    trasaData.zoznamKariet.forEach(obj => {
        const maPoznamku = obj.trvala_poznamka || obj.poznamka_objednavky;
        const cssClass = maPoznamku ? 'has-notes' : 'has-order';
        const badge = `<span class="status-badge badge-order"><i class="fas fa-box"></i> Objednané</span>`;

        let poznamkyHtml = '';
        if (maPoznamku) {
            if (obj.trvala_poznamka) poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
            if (obj.poznamka_objednavky) poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
        }

        // Zobrazenie Adresy (Napr. Vlčany 063) ak je zadaná
        let adresaHtml = '';
        if (obj.adresa) {
            adresaHtml = `<div style="font-size: 1.3rem; margin-top: 6px; font-weight: 600; opacity: 0.7;">
                            <i class="fas fa-map-marker-alt" style="margin-right: 5px;"></i>${obj.adresa}
                          </div>`;
        }

        html += `
            <div class="karta ${cssClass}">
                <div class="z-nazov">
                    ${obj.zakaznik}
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
    if (vsetkyTrasy.length > 1) {
        for (let i = 0; i < vsetkyTrasy.length; i++) {
            paginaciaHtml += `<div class="dot ${i === aktualnaTrasaIndex ? 'active' : ''}"></div>`;
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
    const availableHeight = contentArea.clientHeight - 50; 
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