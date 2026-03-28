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

            if (poznamky.length === 0) {
                obsah.innerHTML = `
                    <div style="text-align: center; margin-top: 20vh;">
                        <i class="fa-solid fa-check-circle" style="font-size: 6rem; color: #28a745; margin-bottom: 20px;"></i>
                        <h2 style="font-size: 2.5rem; color: #495057;">Všetko je pripravené.</h2>
                        <p style="font-size: 1.5rem; color: #6c757d;">Chystajte štandardne podľa objednávok.</p>
                    </div>`;
                prisposobVelkost(); 
                return;
            }

            // ROZDELENIE DO STĹPCOV PODĽA TRASY
            const skupinyTrasy = new Map();
            poznamky.forEach(obj => {
                const trasa = obj.trasa_nazov || 'Ostatné';
                if (!skupinyTrasy.has(trasa)) {
                    skupinyTrasy.set(trasa, []);
                }
                skupinyTrasy.get(trasa).push(obj);
            });

            let html = '';
            
            // Vykreslenie každého stĺpca (Trasy)
            for (const [trasa, zoznamKariet] of skupinyTrasy.entries()) {
                html += `
                    <div class="kanban-col">
                        <div class="col-header"><i class="fas fa-truck-fast"></i> ${trasa}</div>
                        <div class="col-body">
                `;
                
                // Vykreslenie kariet v stĺpci
                zoznamKariet.forEach(obj => {
                    let poznamkyHtml = '';
                    
                    if (obj.trvala_poznamka) {
                        poznamkyHtml += `
                            <div class="p-riadok stala-poznamka">
                                <i class="fas fa-exclamation-circle"></i>
                                <div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div>
                            </div>`;
                    }
                    
                    if (obj.poznamka_objednavky) {
                        poznamkyHtml += `
                            <div class="p-riadok dnesna-poznamka">
                                <i class="fas fa-info-circle"></i>
                                <div><strong>DOPLNENIE:</strong> ${obj.poznamka_objednavky}</div>
                            </div>`;
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
                
                html += `</div></div>`; // Koniec col-body a kanban-col
            }
            
            obsah.innerHTML = html;

            // Okamžité prispôsobenie veľkosti
            setTimeout(prisposobVelkost, 50); 
        })
        .catch(error => console.error('Chyba spojenia s backendom tabule:', error));
}

// INTELIGENTNÉ PRISPÔSOBENIE NA OBRAZOVKU (Pre Kanban stĺpce)
function prisposobVelkost() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    
    if (!contentArea || !board) return;

    // Reset
    board.style.transform = 'none';
    board.style.width = 'max-content'; // Umožní stĺpcom roztiahnuť sa
    
    const availableWidth = contentArea.clientWidth;
    const availableHeight = contentArea.clientHeight;
    
    const currentWidth = board.scrollWidth;
    const currentHeight = board.scrollHeight;
    
    // Zistíme, v akom smere nástenka pretŕča najviac
    let scaleW = 1;
    let scaleH = 1;
    
    if (currentWidth > availableWidth && availableWidth > 0) {
        scaleW = availableWidth / currentWidth;
    }
    
    if (currentHeight > availableHeight && availableHeight > 0) {
        scaleH = availableHeight / currentHeight;
    }
    
    // Použijeme menší koeficient (odrátame 2% aby to nebolo natlačené na hranách)
    let finalScale = Math.min(scaleW, scaleH) * 0.98;
    
    if (finalScale < 1) {
        board.style.transform = `scale(${finalScale})`;
    }
}

window.addEventListener('resize', prisposobVelkost);

document.addEventListener("DOMContentLoaded", function() {
    aktualizujCas();
    setInterval(aktualizujCas, 1000); 
    
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); 
});