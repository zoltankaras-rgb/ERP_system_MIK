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
                    <div style="grid-column: 1 / -1; text-align: center; font-size: 3rem; color: #7f8c8d; margin-top: 15vh; font-weight: 600;">
                        <i class="fa-solid fa-circle-check" style="font-size: 6rem; color: #2ecc71; margin-bottom: 25px; display: block;"></i>
                        Všetky špeciálne požiadavky na ${data.cielovy_datum} sú pripravené.<br>Chystajte štandardne.
                    </div>`;
                prisposobVelkost(); 
                return;
            }

            let html = '';
            poznamky.forEach(obj => {
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
                                <span style="color: #d32f2f; font-weight: 800; font-size: 1.6rem; margin-right: 15px; background: #ffebee; padding: 6px 12px; border-radius: 6px;">
                                    <i class="fa-regular fa-calendar"></i> ${obj.datum_dodania}
                                </span>
                                ${obj.id_objednavky}
                            </div>
                        </div>
                        ${poznamkyHtml}
                    </div>
                `;
            });
            
            obsah.innerHTML = html;

            // Počkáme 50ms kým prehliadač vykreslí prvky a potom zmenšíme, ak treba
            setTimeout(prisposobVelkost, 50); 
        })
        .catch(error => console.error('Chyba spojenia s backendom tabule:', error));
}

function prisposobVelkost() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    
    if (!contentArea || !board) return;

    // 1. Resetujeme veľkosť na plnú obrazovku
    board.style.transform = 'none';
    board.style.width = '100%';
    board.style.transformOrigin = 'top left'; // Sťahovať sa to bude zhora zľava
    
    const availableHeight = contentArea.clientHeight;
    const currentHeight = board.scrollHeight;
    
    // 2. Ak objednávky pretekajú pod obrazovku
    if (currentHeight > availableHeight && availableHeight > 0) {
        // Vypočítame zmenšenie (necháme si 2% rezervu)
        let scaleFactor = (availableHeight / currentHeight) * 0.98;
        
        // KĽÚČOVÁ VEC: Keďže sme to zmenšili napr. na 80%, musíme 
        // umelo natiahnuť šírku na 125 %, aby to roztiahlo na plnú šírku TV!
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