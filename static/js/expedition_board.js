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
            
            // Aktualizácia hlavičky s cieľovým dátumom
            if (data.cielovy_datum) {
                datumElement.innerHTML = `Chystáme na: <strong>${data.cielovy_datum}</strong>`;
            }

            const poznamky = data.poznamky || [];

            // Ak na daný deň nie sú žiadne výnimky
            if (poznamky.length === 0) {
                obsah.innerHTML = `
                    <div class="nic-nove">
                        <i class="fa-solid fa-circle-check"></i>
                        Všetky špeciálne požiadavky na ${data.cielovy_datum} sú pripravené.<br>Chystajte štandardne.
                    </div>`;
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
                            <div class="objednavka-info">${obj.id_objednavky}</div>
                        </div>
                        ${poznamkyHtml}
                    </div>
                `;
            });
            
            obsah.innerHTML = html;
        })
        .catch(error => {
            console.error('Chyba spojenia s backendom tabule:', error);
        });
}

// Spustenie po načítaní stránky
document.addEventListener("DOMContentLoaded", function() {
    aktualizujCas();
    setInterval(aktualizujCas, 1000); // Hodiny tikajú každú sekundu
    
    nacitajPoznamkyNaTabulu();
    setInterval(nacitajPoznamkyNaTabulu, 15000); // Dáta sa ťahajú každých 15 sekúnd
});