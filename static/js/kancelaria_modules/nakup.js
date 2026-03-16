let nakupCart = [];
let nakupChartInstance = null;

window.renderNakupModule = function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const today = new Date().toISOString().split('T')[0];

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;">
            <h2 style="color: #1e3a8a; margin: 0;">🛒 Nákupy od dodávateľov</h2>
        </div>

        <div style="display:flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 350px; background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <h4 style="margin-top: 0; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Zápis prijatého tovaru / faktúry</h4>
                
                <div class="form-group">
                    <label>Dodávateľ (Firma):</label>
                    <input type="text" id="nakup-dodavatel" class="filter-input" style="width: 100%;" placeholder="Napr. Kovář, Liška, Meat land..." required>
                </div>
                <div class="form-group">
                    <label>Dátum nákupu:</label>
                    <input type="date" id="nakup-datum" class="filter-input" style="width: 100%;" value="${today}" required>
                </div>

                <div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin-top: 15px; border: 1px solid #e2e8f0;">
                    <label style="font-weight: bold; color: #0284c7;">Pridať položku</label>
                    
                    <div style="display:flex; gap:10px; margin-top:10px;">
                        <input type="text" id="nakup-ean" class="filter-input" placeholder="EAN (voliteľné)" style="width: 120px;">
                        <input type="text" id="nakup-nazov" class="filter-input" placeholder="Názov produktu (napr. Bravčové karé)" style="flex:1;">
                        <button class="btn btn-secondary" onclick="ukazHistoriuNákupu()" title="Ukázať vývoj ceny tohto produktu">📈 Graf</button>
                    </div>
                    
                    <div style="display:flex; gap:10px; margin-top:10px;">
                        <div style="flex:1;">
                            <label style="font-size:0.8rem;">Množstvo (kg/ks)</label>
                            <input type="number" id="nakup-mnozstvo" class="filter-input" style="width: 100%;" step="0.01">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:0.8rem;">Nákupná cena (€)</label>
                            <input type="number" id="nakup-cena" class="filter-input" style="width: 100%;" step="0.0001">
                        </div>
                        <div style="display:flex; align-items:flex-end;">
                            <button class="btn btn-primary" onclick="pridatPolozkuNakupu()">Pridať ➕</button>
                        </div>
                    </div>
                </div>
            </div>

            <div style="flex: 2; min-width: 400px; background: #fff; padding: 20px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <h4 style="margin-top: 0; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">Košík aktuálneho nákupu</h4>
                <div style="max-height: 300px; overflow-y: auto;">
                    <table class="table-refined" style="width:100%;">
                        <thead style="background: #f8fafc; position: sticky; top: 0;">
                            <tr>
                                <th>Produkt</th>
                                <th style="text-align:right;">Množstvo</th>
                                <th style="text-align:right;">Nákupná Cena</th>
                                <th style="text-align:right;">Spolu</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="nakup-cart-tbody">
                            <tr><td colspan="5" style="text-align:center; padding: 20px; color:#94a3b8;">Zatiaľ nebola pridaná žiadna položka.</td></tr>
                        </tbody>
                    </table>
                </div>
                
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; border-top: 2px solid #e2e8f0; padding-top: 15px;">
                    <strong style="font-size: 1.2rem;">Celková hodnota: <span id="nakup-total-price" style="color: #dc2626;">0.00 €</span></strong>
                    <button class="btn btn-success" style="padding: 10px 30px; font-weight: bold;" onclick="ulozitCelyNakup()">💾 Uložiť záznam do histórie</button>
                </div>
            </div>
        </div>
    `;
};

// Logika pre pridávanie do košíka
window.pridatPolozkuNakupu = function() {
    const ean = document.getElementById('nakup-ean').value.trim();
    const nazov = document.getElementById('nakup-nazov').value.trim();
    const mnozstvo = parseFloat(document.getElementById('nakup-mnozstvo').value);
    const cena = parseFloat(document.getElementById('nakup-cena').value);

    if (!nazov) return alert('Zadajte názov produktu.');
    if (isNaN(mnozstvo) || mnozstvo <= 0) return alert('Zadajte platné množstvo.');
    if (isNaN(cena) || cena <= 0) return alert('Zadajte platnú cenu.');

    nakupCart.push({ ean, nazov, mnozstvo, cena });
    
    // Vyčistenie inputov
    document.getElementById('nakup-ean').value = '';
    document.getElementById('nakup-nazov').value = '';
    document.getElementById('nakup-mnozstvo').value = '';
    document.getElementById('nakup-cena').value = '';
    
    vykresliNakupCart();
};

window.zmazatPolozkuNakupu = function(index) {
    nakupCart.splice(index, 1);
    vykresliNakupCart();
};

function vykresliNakupCart() {
    const tbody = document.getElementById('nakup-cart-tbody');
    let html = '';
    let total = 0;

    if (nakupCart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#94a3b8;">Zatiaľ nebola pridaná žiadna položka.</td></tr>';
        document.getElementById('nakup-total-price').innerText = '0.00 €';
        return;
    }

    nakupCart.forEach((p, idx) => {
        const sum = p.mnozstvo * p.cena;
        total += sum;
        html += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td>
                    <strong style="color: #0f172a;">${escapeHtml(p.nazov)}</strong>
                    ${p.ean ? `<br><small style="color:#64748b;">EAN: ${p.ean}</small>` : ''}
                </td>
                <td style="text-align:right;">${p.mnozstvo}</td>
                <td style="text-align:right; font-weight:bold; color: #0369a1;">${p.cena.toFixed(3)} €</td>
                <td style="text-align:right; font-weight:bold;">${sum.toFixed(2)} €</td>
                <td style="text-align:center;"><button class="btn btn-sm btn-danger" onclick="zmazatPolozkuNakupu(${idx})">&times;</button></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
    document.getElementById('nakup-total-price').innerText = total.toFixed(2) + ' €';
}

// Uloženie nákupu do databázy
window.ulozitCelyNakup = async function() {
    const dodavatel = document.getElementById('nakup-dodavatel').value.trim();
    const datum = document.getElementById('nakup-datum').value;

    if (!dodavatel) return alert("Musíte vyplniť dodávateľa.");
    if (nakupCart.length === 0) return alert("Košík je prázdny.");

    try {
        const res = await fetch('/api/kancelaria/nakup/ulozit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dodavatel, datum, polozky: nakupCart })
        });
        const out = await res.json();
        
        if (out.error) throw new Error(out.error);
        
        alert("Nákup bol úspešne uložený.");
        nakupCart = [];
        vykresliNakupCart();
        document.getElementById('nakup-dodavatel').value = '';
    } catch (e) {
        alert("Chyba pri ukladaní: " + e.message);
    }
};

// =================================================================
// ANALYTIKA: Graf histórie cien produktu
// =================================================================
window.ukazHistoriuNákupu = async function() {
    const ean = document.getElementById('nakup-ean').value.trim();
    const nazov = document.getElementById('nakup-nazov').value.trim();

    if (!ean && !nazov) return alert('Na zobrazenie histórie musíte zadať EAN alebo Názov produktu do poľa.');

    // Vytvorenie modálu
    let modal = document.getElementById('nakup-history-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'nakup-history-modal';
        modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.6); z-index:10500; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(2px);';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="background:#fff; width:95%; max-width:1000px; border-radius:12px; display:flex; flex-direction:column; height:85vh; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);">
            <div style="background:#f8f9fa; padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <h3 style="margin:0; color:#1e3a8a;"><i class="fas fa-chart-line"></i> Vývoj nákupnej ceny: ${escapeHtml(nazov || ean)}</h3>
                <button onclick="document.getElementById('nakup-history-modal').style.display='none'" style="background:none; border:none; font-size:1.5rem; cursor:pointer;">&times;</button>
            </div>
            
            <div style="padding:20px; overflow-y:auto; flex:1; display: flex; flex-direction: column;">
                <div id="nh-loading" style="text-align:center; padding:20px; color:#64748b;">Načítavam dáta...</div>
                
                <div id="nh-content" style="display:none; flex: 1; flex-direction: column;">
                    <div style="height:350px; width:100%; margin-bottom:20px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px;">
                        <canvas id="nakupHistoryChart"></canvas>
                    </div>
                    
                    <div style="flex:1; overflow-y:auto; border: 1px solid #cbd5e1; border-radius: 8px;">
                        <table class="table-refined" style="width:100%; font-size:0.9rem;">
                            <thead style="background:#f1f5f9; position: sticky; top: 0;">
                                <tr>
                                    <th>Dátum</th>
                                    <th>Dodávateľ</th>
                                    <th style="text-align:right;">Množstvo</th>
                                    <th style="text-align:right;">Nákupná cena (€)</th>
                                </tr>
                            </thead>
                            <tbody id="nh-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;
    modal.style.display = 'flex';

    try {
        const query = ean ? `ean=${encodeURIComponent(ean)}` : `nazov=${encodeURIComponent(nazov)}`;
        const response = await fetch(`/api/kancelaria/nakup/historia?${query}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        document.getElementById('nh-loading').style.display = 'none';
        const contentDiv = document.getElementById('nh-content');
        contentDiv.style.display = 'flex';

        const history = data.history || [];
        if (history.length === 0) {
            contentDiv.innerHTML = '<div style="text-align:center; padding:40px; color:#94a3b8; font-size: 1.1rem;">Zatiaľ neevidujeme žiadne nákupy tohto produktu.</div>';
            return;
        }

        // 1. Zostavenie tabuľky (zoradené od najnovších pre tabuľku)
        let tableHtml = '';
        [...history].reverse().forEach(row => {
            tableHtml += `
                <tr>
                    <td>${new Date(row.date).toLocaleDateString('sk-SK')}</td>
                    <td><strong>${escapeHtml(row.supplier)}</strong></td>
                    <td style="text-align:right;">${parseFloat(row.qty).toFixed(2)}</td>
                    <td style="text-align:right; font-weight:bold; color:#b91c1c;">${parseFloat(row.price).toFixed(4)} €</td>
                </tr>
            `;
        });
        document.getElementById('nh-table-body').innerHTML = tableHtml;

        // 2. Kreslenie grafu Chart.js
        const uniqueDates = [...new Set(history.map(item => item.date))].sort();
        const uniqueSuppliers = [...new Set(history.map(item => item.supplier))];
        const colors = ['#2563eb', '#16a34a', '#d97706', '#8b5cf6', '#dc2626', '#0891b2'];
        
        const datasets = uniqueSuppliers.map((supplier, idx) => {
            const dataPoints = uniqueDates.map(date => {
                const match = history.find(i => i.date === date && i.supplier === supplier);
                return match ? parseFloat(match.price) : null;
            });
            return {
                label: supplier,
                data: dataPoints,
                borderColor: colors[idx % colors.length],
                backgroundColor: colors[idx % colors.length],
                spanGaps: true, // Prepojí čiarou aj keď dodávateľ v daný deň nedodal
                pointRadius: 5,
                tension: 0.1
            };
        });

        const ctx = document.getElementById('nakupHistoryChart').getContext('2d');
        if (nakupChartInstance) nakupChartInstance.destroy();

        nakupChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: uniqueDates.map(d => new Date(d).toLocaleDateString('sk-SK')),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(4) + ' €'; }
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: { callback: function(value) { return value.toFixed(2) + ' €'; } }
                    }
                }
            }
        });

    } catch (e) {
        document.getElementById('nh-loading').innerHTML = `<span style="color:red;">Chyba: ${e.message}</span>`;
    }
};