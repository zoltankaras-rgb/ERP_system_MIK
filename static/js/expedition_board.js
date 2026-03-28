// static/js/expedition_board.js

function aktualizujCas() {
    const teraz = new Date();
    const casString = teraz.toLocaleTimeString('sk-SK', { hour12: false });
    document.getElementById('aktualny-cas').textContent = casString;
}

function nacitajPoznamkyNaTabulu() {
    fetch('/api/tv-board/data') 
        .then(response => response.json())
        .then(data => {
            const obsah = document.getElementById('obsah-tabule');
            const datumElement = document.getElementById('cielovy-datum');
            const globalNoteElement = document.getElementById('global-note-container');
            
            if (data.cielovy_datum) {
                datumElement.innerHTML = `Chystáme na: <strong>${data.cielovy_datum}</strong>`;
            }

            if (data.global_note && data.global_note.trim() !== '') {
                globalNoteElement.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> OZNAM: ${data.global_note}`;
                globalNoteElement.style.display = 'block';
            } else {
                globalNoteElement.style.display = 'none';
            }

            const poznamky = data.poznamky || [];
            const pocetKariet = poznamky.length;

            // INTELIGENTNÉ PRISPÔSOBENIE VEĽKOSTI PÍSMA (Zohľadňuje aj nadpisy trás)
            let baseSize = 22; 
            if (pocetKariet === 0) baseSize = 24;
            else if (pocetKariet <= 2) baseSize = 26; 
            else if (pocetKariet <= 4) baseSize = 22; 
            else if (pocetKariet <= 6) baseSize = 18; 
            else if (pocetKariet <= 9) baseSize = 15; 
            else baseSize = 13;                       

            obsah.style.setProperty('--board-font-size', baseSize + 'px');

            if (pocetKariet === 0) {
                obsah.innerHTML = `
                    <div style="text-align: center; font-size: 2em; color: #7f8c8d; margin-top: 15vh; font-weight: 600;">
                        <i class="fa-solid fa-circle-check" style="font-size: 4em; color: #2ecc71; margin-bottom: 20px; display: block;"></i>
                        Všetky špeciálne požiadavky na ${data.cielovy_datum} sú pripravené.<br>Chystajte štandardne.
                    </div>`;
                prisposobVelkost(); 
                return;
            }

            // ZOSKUPOVANIE DO TRÁS (Pomocou Map zachováme poradie z SQL)
            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov;
                if (!skupinyTrasy.has(trasa)) {
                    skupinyTrasy.set(trasa, []);
                }
                skupinyTrasy.get(trasa).push(obj);
            });

            let html = '';
            
            // Vykreslenie kategórií
            for (const [trasa, zoznamKariet] of skupinyTrasy.entries()) {
                html += `
                    <div class="trasa-sekcia">
                        <h2 class="trasa-nadpis"><i class="fas fa-truck-fast"></i> ${trasa}</h2>
                        <div class="trasa-grid">
                `;
                
                zoznamKariet.forEach(obj => {
                    let poznamkyHtml = '';
                    
                    if (obj.trvala_poznamka) {
                        poznamkyHtml += `
                            <div class="poznamka-riadok stala-poznamka">
                                <span class="ikona">⚠️</span>
                                <div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div>
                            </div>`;
                    }
                    
                    if (obj.poznamka_objednavky) {
                        poznamkyHtml += `
                            <div class="poznamka-riadok dnesna-poznamka">
                                <span class="ikona">ℹ️</span>
                                <div><strong>POZNÁMKA:</strong> ${obj.poznamka_objednavky}</div>
                            </div>`;
                    }

                    html += `
                        <div class="karta">
                            <div class="zakaznik-hlavicka">
                                <div class="zakaznik-nazov">${obj.zakaznik}</div>
                                <div class="objednavka-info">
                                    <span class="datum-tag">
                                        <i class="fa-regular fa-calendar"></i> ${obj.datum_dodania}
                                    </span>
                                    <span>${obj.id_objednavky}</span>
                                </div>
                            </div>
                            ${poznamkyHtml}
                        </div>
                    `;
                });
                
                html += `</div></div>`; // Uzavretie gridu a sekcie
            }
            
            obsah.innerHTML = html;

            setTimeout(prisposobVelkost, 50); 
        })
        .catch(error => console.error('Chyba spojenia s backendom tabule:', error));
}

function prisposobVelkost() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    
    if (!contentArea || !board) return;

    board.style.transform = 'none';
    board.style.width = '100%';
    board.style.transformOrigin = 'top left'; 
    
    const availableHeight = contentArea.clientHeight;
    const currentHeight = board.scrollHeight;
    
    if (currentHeight > availableHeight && availableHeight > 0) {
        let scaleFactor = (availableHeight / currentHeight) * 0.98;
        
        board.style.transform = `scale(${scaleFactor})`;
        board.style.width = `${100 / scaleFactor}%`;
    }
}

window.addEventListener('resize', prisposobVelkost);

document.addEventListener("DOMContentLoaded", function() {
    aktualizujCas();
    setInterval(aktualizujCas, 1000); 
    
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); 
});