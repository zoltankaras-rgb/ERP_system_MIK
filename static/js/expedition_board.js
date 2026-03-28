// static/js/expedition_board.js

function nacitajPoznamkyNaTabulu() {
    fetch('/api/expedition_board/data')
        .then(response => response.json())
        .then(data => {
            const obsah = document.getElementById('obsah-tabule');
            
            // Ak nie sú žiadne výnimky, ukážeme upokojujúcu správu
            if (!data || data.length === 0) {
                obsah.innerHTML = '<div class="nic-nove">✓ Žiadne špeciálne požiadavky.<br>Chystajte štandardne.</div>';
                return;
            }

            // Generovanie kariet pre zákazníkov
            let html = '';
            data.forEach(obj => {
                let poznamkyHtml = '';
                
                // Trvalá poznámka inštitúcie/zákazníka
                if (obj.trvala_poznamka) {
                    poznamkyHtml += `
                        <div class="poznamka-riadok stala-poznamka">
                            <span class="ikona">⚠️</span>
                            <div><strong>VŽDY:</strong> ${obj.trvala_poznamka}</div>
                        </div>`;
                }
                
                // Dnešná špeciálna poznámka k objednávke
                if (obj.poznamka_objednavky) {
                    poznamkyHtml += `
                        <div class="poznamka-riadok dnesna-poznamka">
                            <span class="ikona">ℹ️</span>
                            <div><strong>PRE TÚTO OBJ:</strong> ${obj.poznamka_objednavky}</div>
                        </div>`;
                }

                html += `
                    <div class="karta">
                        <div class="zakaznik-hlavicka">
                            <div class="zakaznik-nazov">${obj.zakaznik}</div>
                            <div class="objednavka-info">Dodanie: ${obj.datum_dodania} | ${obj.id_objednavky}</div>
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
    nacitajPoznamkyNaTabulu();
    // Automatický refresh každých 15 sekúnd (15000 milisekúnd)
    setInterval(nacitajPoznamkyNaTabulu, 15000);
});