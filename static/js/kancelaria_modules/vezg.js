// =================================================================
// === SUB-MODUL KANCELÁRIA: BURZA VEZG ============================
// =================================================================

document.addEventListener("DOMContentLoaded", () => {
    let vezgChartInstance = null;

    async function loadVezgPrices() {
        try {
            const response = await fetch('/api/vezg-prices');
            if (!response.ok) throw new Error('Sieťová chyba pri načítaní dát');
            
            const data = await response.json();
            
            if(data.error) {
                document.getElementById('vezg-indicator').innerText = 'Dáta nedostupné';
                return;
            }

            // Podpora oboch štruktúr API (aktualna/minula vs current_price/previous_price)
            const aktualnaCena = data.aktualna !== undefined ? data.aktualna : data.current_price;
            const minulaCena = data.minula !== undefined ? data.minula : data.previous_price;

            const finalAktualna = aktualnaCena !== undefined ? aktualnaCena : 0;
            const finalMinula = minulaCena !== undefined ? minulaCena : 0;

            document.getElementById('vezg-current-price').innerText = finalAktualna.toFixed(2) + ' € / kg';
            document.getElementById('vezg-prev-price').innerText = finalMinula.toFixed(2) + ' € / kg';
            
            const indicatorElement = document.getElementById('vezg-indicator');
            const farba = data.farba || data.status_color || 'black';
            indicatorElement.style.color = farba;
            
            if (farba === 'red') {
                indicatorElement.innerHTML = '▲ Zvýšenie ceny (nárast nákladov)';
            } else if (farba === 'green') {
                indicatorElement.innerHTML = '▼ Zníženie ceny (zlacnenie nákupu)';
            } else {
                indicatorElement.innerHTML = '➖ Bez zmeny';
            }

            if (data.history && Array.isArray(data.history) && data.history.length > 0) {
                renderChart(data.history);
            }

        } catch (error) {
            console.error("Kritická chyba VEZG API modulu:", error);
            const indEl = document.getElementById('vezg-indicator');
            if (indEl) indEl.innerText = 'Chyba spojenia s ERP';
        }
    }

    function renderChart(historyData) {
        const canvasEl = document.getElementById('vezgChart');
        if (!canvasEl) return;
        
        const ctx = canvasEl.getContext('2d');
        const labels = historyData.map(item => item.date);
        const values = historyData.map(item => item.price);

        if (vezgChartInstance) {
            vezgChartInstance.destroy();
        }

        vezgChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Vývoj ceny €/kg',
                    data: values,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    fill: true,
                    tension: 0.1,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgb(54, 162, 235)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { 
                    y: { 
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: 'Cena (€)'
                        }
                    } 
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    const refreshBtn = document.getElementById('refresh-vezg-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadVezgPrices);
    }
    
    // Auto-exekúcia modulu
    loadVezgPrices();
});