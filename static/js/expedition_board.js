// static/js/expedition_board.js

// 1. Hodiny v reálnom čase
function aktualizujCas() {
    const teraz = new Date();
    const casString = teraz.toLocaleTimeString('sk-SK', { hour12: false });
    document.getElementById('aktualny-cas').textContent = casString;
}

// 2. Načítavanie poznámok
function nacitajPoznamkyNaTabulu() {
    fetch('/api/tv-board/data') 
        .then(response => response.json())
        .then(data => {
            const obsah = document.getElementById('obsah-tabule');
            const datumElement = document.getElementById('cielovy-datum');
            const globalNoteElement = document.getElementById('global-note-container');
            
            // A. Aktualizácia hlavičky s cieľovým dátumom
            if (data.cielovy_datum) {
                datumElement.innerHTML = `Chystáme na: <strong>${data.cielovy_datum}</strong>`;
            }

            // B. Zobrazenie GLOBÁLNEHO OZNAMU (Ak ho vedúca zadala)
            if (data.global_note && data.global_note.trim() !== '') {
                globalNoteElement.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> OZNAM: ${data.global_note}`;
                globalNoteElement.style.display = 'block';
            } else {
                globalNoteElement.style.display = 'none';
            }

            const poznamky = data.poznamky || [];

            // Ak na daný deň nie sú žiadne výnimky
            if (poznamky.length === 0) {
                obsah.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; font-size: 2.5rem; color: #7f8c8d; margin-top: 10vh; font-weight: 600;">
                        <i class="fa-solid fa-circle-check" style="font-size: 5rem; color: #2ecc71; margin-bottom: 20px; display: block;"></i>
                        Všetky špeciálne požiadavky na ${data.cielovy_datum} sú pripravené.<br>Chystajte štandardne.
                    </div>`;
                prisposobVelkost(); // Reset zmenšenia
                return;
            }

            // Generovanie úhľadných kariet pre zákazníkov
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
                                <span style="color: #d32f2f; font-weight: 800; font-size: 1.3rem; margin-right: 12px; background: #ffebee; padding: 4px 8px; border-radius: 4px;">
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

            // C. AUTO-SCALE: Zmenšenie mriežky, ak je tovaru veľa
            setTimeout(prisposobVelkost, 50); // Mierne oneskorenie, kým prehliadač vykreslí nové karty
        })
        .catch(error => {
            console.error('Chyba spojenia s backendom tabule:', error);
        });
}

// 3. FUNKCIA NA STLAČENIE OBSAHU DO 1 OBRAZOVKY (Zákaz scrollovania)
function prisposobVelkost() {
    const contentArea = document.querySelector('.tv-content');
    const board = document.getElementById('obsah-tabule');
    
    if (!contentArea || !board) return;

    // Najskôr vrátime všetko do pôvodnej veľkosti (100%)
    board.style.transform = 'scale(1)';
    
    // Zistíme, koľko máme miesta a aká vysoká je mriežka s kartami
    const availableHeight = contentArea.clientHeight;
    const currentHeight = board.scrollHeight;
    
    // Ak mriežka pretŕča z obrazovky von...
    if (currentHeight > availableHeight && availableHeight > 0) {
        // Vypočítame koeficient zmenšenia (necháme 2% rezervu, aby nebola prilepená úplne k okraju)
        let scaleFactor = (availableHeight / currentHeight) * 0.98;
        
        // Aplikujeme CSS zmenšenie
        board.style.transform = `scale(${scaleFactor})`;
    }
}

// Prepočet aj pri ručnej zmene veľkosti okna (napr. ak sa TV prepne na inú obrazovku)
window.addEventListener('resize', prisposobVelkost);

// Spustenie po načítaní stránky
document.addEventListener("DOMContentLoaded", function() {
    aktualizujCas();
    setInterval(aktualizujCas, 1000); // Hodiny tikajú každú sekundu
    
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); // Dáta sa ťahajú každých 15 sekúnd
});