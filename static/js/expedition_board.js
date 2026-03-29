// static/js/expedition_board.js

let vsetkyTrasy = []; 
let aktualnaStrana = 0;
let pocetNaStranu = 3; 
let rotaciaInterval = null;

function aktualizujCas() {
    const teraz = new Date();
    const hodina = teraz.getHours();
    
    const casString = teraz.toLocaleTimeString('sk-SK', { hour12: false });
    document.getElementById('aktualny-cas').textContent = casString;

    // TMavý režim (Dark Mode) - od 16:00 večer do 05:59 ráno
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
            const datumElement = document.getElementById('cielovy-datum');
            const globalNoteElement = document.getElementById('global-note-container');
            const promoContainer = document.getElementById('coop-promo-container');
            const promoList = document.getElementById('coop-promo-list');
            
            // 1. Zobrazenie dátumu
            if (data.cielovy_datum) {
                datumElement.innerHTML = `Chystáme na: <strong>${data.cielovy_datum}</strong>`;
            }

            // 2. Zobrazenie Globálneho oznamu
            if (data.global_note && data.global_note.trim() !== '') {
                globalNoteElement.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> OZNAM: ${data.global_note}`;
                globalNoteElement.style.display = 'block';
            } else {
                globalNoteElement.style.display = 'none';
            }

            // 3. Zobrazenie AKCIÍ COOP JEDNOTA
            if (data.akcie_coop && data.akcie_coop.length > 0) {
                const naformatovaneAkcie = data.akcie_coop.map(produkt => `<span class="promo-highlight">${produkt}</span>`).join(' • ');
                promoList.innerHTML = naformatovaneAkcie;
                promoContainer.style.display = 'block';
            } else {
                promoContainer.style.display = 'none';
            }

            const poznamky = data.poznamky || [];

            // 4. Ak nie sú žiadne trasy/výnimky
            if (poznamky.length === 0) {
                vsetkyTrasy = [];
                zastavRotaciu();
                document.getElementById('paginacia-container').innerHTML = '';
                document.getElementById('obsah-tabule').innerHTML = `
                    <div style="text-align: center; margin-top: 15vh;">
                        <i class="fa-solid fa-check-circle" style="font-size: 6rem; color: #28a745; margin-bottom: 20px;"></i>
                        <h2 style="font-size: 2.5rem; color: var(--text-main);">Všetko je pripravené.</h2>
                        <p style="font-size: 1.5rem; color: #6c757d;">Chystajte štandardne podľa objednávok.</p>
                    </div>`;
                document.getElementById('obsah-tabule').style.transform = 'none';
                return;
            }

            // Rozdelenie do stĺpcov podľa trasy
            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov || 'Ostatné';
                if (!skupinyTrasy.has(trasa)) {
                    skupinyTrasy.set(trasa, []);
                }
                skupinyTrasy.get(trasa).push(obj);
            });

            vsetkyTrasy = Array.from(skupinyTrasy, ([trasa, zoznamKariet]) => ({ trasa, zoznamKariet }));

            const availableWidth = window.innerWidth - 40; 
            pocetNaStranu = Math.max(1, Math.floor(availableWidth / 500)); 

            if (aktualnaStrana * pocetNaStranu >= vsetkyTrasy.length) {
                aktualnaStrana = 0;
            }

            vykresliStranu();

            // Carousel rotácia
            if (vsetkyTrasy.length > pocetNaStranu) {
                if (!rotaciaInterval) {
                    rotaciaInterval = setInterval(() => {
                        aktualnaStrana++;
                        if (aktualnaStrana * pocetNaStranu >= vsetkyTrasy.length) {
                            aktualnaStrana = 0; 
                        }
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
    
    const start = aktualnaStrana * pocetNaStranu;
    const end = start + pocetNaStranu;
    const trasyNaZobrazenie = vsetkyTrasy.slice(start, end);

    let html = '';
    trasyNaZobrazenie.forEach(skupina => {
        html += `
            <div class="kanban-col">
                <div class="col-header"><i class="fas fa-truck-fast"></i> ${skupina.trasa}</div>
                <div class="col-body">
        `;
        
        skupina.zoznamKariet.forEach(obj => {
            let poznamkyHtml = '';
            if (obj.trvala_poznamka) {
                poznamkyHtml += `<div class="p-riadok stala-poznamka"><i class="fas fa-exclamation-circle"></i><div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div></div>`;
            }
            if (obj.poznamka_objednavky) {
                poznamkyHtml += `<div class="p-riadok dnesna-poznamka"><i class="fas fa-info-circle"></i><div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div></div>`;
            }

            html += `
                <div class="karta">
                    <div class="z-nazov">${obj.zakaznik}</div>
                    <div class="z-info">
                        <span>${obj.id_objednavky}</span>
                        <span class="z-tag">${obj.datum_dodania}</span>
                    </div>
                    ${poznamkyHtml}
                </div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    obsah.innerHTML = html;

    const pocetStran = Math.ceil(vsetkyTrasy.length / pocetNaStranu);
    let paginaciaHtml = '';
    if (pocetStran > 1) {
        for (let i = 0; i < pocetStran; i++) {
            paginaciaHtml += `<div class="dot ${i === aktualnaStrana ? 'active' : ''}"></div>`;
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