// =================================================================
// === LOGIKA MODULU VÝROBA (VYROBA.JS) - UPRAVENÁ PRE VÁŠ HTML ===
// =================================================================

let vyrobaInitialData = {};
let allIngredientsList = []; // Zoznam surovín pre "Pridať surovinu"

// --- Prepínanie pohľadov (bez zmeny) ---
function showVyrobaView(viewId) {
    document.querySelectorAll('#production-module-container > .view').forEach(v => v.style.display = 'none');
    const view = document.getElementById(viewId);
    if (view) view.style.display = 'block';
    if (typeof clearStatus === 'function') clearStatus();
}

// --- Načítanie menu ---
async function loadAndShowProductionMenu() {
    try {
        const data = await apiRequest('/api/getProductionMenuData');
        if (data && data.error) { showStatus(data.error, true); return; }
        
        vyrobaInitialData = data || {};
        allIngredientsList = data.all_ingredients || [];

        // Použijeme novú funkciu pre týždenný plán
        populateWeeklySchedule(data.weekly_schedule); 
        populateRunningTasks(data.running_tasks);
        populateProductionCategories(data.recipes);
        
        showVyrobaView('view-production-menu');
    } catch (e) {
        console.error(e);
    }
}

// --- Zobrazenie Týždenného plánu (Dnes, Zajtra...) ---
function populateWeeklySchedule(schedule) {
    const container = document.getElementById('production-tasks-container');
    container.innerHTML = '';

    if (!schedule || Object.keys(schedule).length === 0) {
        container.innerHTML = "<p>Žiadne naplánované úlohy.</p>";
        return;
    }

    // Prejdeme dni (kľúče z backendu: Dnes, Zajtra, Pondelok...)
    for (const dayLabel in schedule) {
        const tasks = schedule[dayLabel];
        
        // Vytvoríme hlavičku dňa
        const header = document.createElement('h4');
        header.style.marginTop = '1rem';
        header.style.borderBottom = '2px solid #3b82f6'; // Modrá čiara
        header.style.paddingBottom = '5px';
        header.textContent = dayLabel;
        
        // Grid pre úlohy
        const grid = document.createElement('div');
        grid.className = 'btn-grid'; // Použijeme existujúcu CSS triedu z vášho HTML

        tasks.forEach(task => {
            const btn = document.createElement('button');
            // Zvýrazníme úlohy na "Dnes" inou farbou
            btn.className = (dayLabel === 'Dnes') ? 'btn-primary' : 'btn-secondary';
            btn.innerHTML = `
                <div style="font-weight:bold; font-size:1.1em;">${escapeHtml(task.productName)}</div>
                <div style="font-size:0.9em; opacity:0.9;">Množstvo: ${escapeHtml(task.displayQty)}</div>
            `;
            // Po kliknutí otvoríme plánovanie s predvyplneným ID logu
            btn.onclick = () => showBatchPlanningView(task.productName, task.actualKgQty, task.logId);
            grid.appendChild(btn);
        });

        container.appendChild(header);
        container.appendChild(grid);
    }
}

// --- Zobrazenie Prebiehajúcich úloh ---
function populateRunningTasks(tasks) {
    const container = document.getElementById('running-tasks-container');
    container.innerHTML = '';
    
    if (!tasks || Object.keys(tasks).length === 0) {
        container.innerHTML = "<p style='color:#6b7280; font-style:italic;'>Výroba stojí.</p>";
        return;
    }
    
    let listHtml = '<ul style="list-style:none; padding:0;">';
    for (const category in tasks) {
        tasks[category].forEach(task => {
            // Pridanie tlačidla Zrušiť
            listHtml += `
            <li style="padding:10px 0; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <i class="fas fa-cog fa-spin" style="color:#3b82f6; margin-right:5px;"></i> 
                    <strong>${escapeHtml(task.productName)}</strong> 
                    <span style="color:#666;">(${escapeHtml(task.displayQty)})</span>
                    <div style="font-size:0.8em; color:#999; margin-left:24px;">ID: ${task.logId}</div>
                </div>
                <button class="btn-danger" style="padding:4px 8px; font-size:0.8em;" onclick="cancelRunningTask('${task.logId}', '${escapeHtml(task.productName)}')">
                    <i class="fas fa-times"></i> Zrušiť
                </button>
            </li>`;
        });
    }
    container.innerHTML = listHtml + '</ul>';
}

// --- Nová funkcia na zrušenie ---
async function cancelRunningTask(batchId, productName) {
    if (!confirm(`Naozaj chcete ZRUŠIŤ výrobu produktu "${productName}"?\n\nSuroviny sa vrátia na sklad.`)) {
        return;
    }

    try {
        const result = await apiRequest('/api/cancelProduction', {
            method: 'POST',
            body: { batchId: batchId }
        });

        if (result && result.error) {
            showStatus(result.error, true);
        } else {
            showStatus(result.message || "Výroba zrušená.", false);
            loadAndShowProductionMenu(); // Obnoviť zoznam
        }
    } catch (e) {
        showStatus("Chyba pri rušení výroby.", true);
        console.error(e);
    }
}
function populateProductionCategories(recipes) {
    const container = document.getElementById('category-container');
    container.innerHTML = '';
    if (!recipes) return;
    for (const category in recipes) {
        const btn = document.createElement('button');
        btn.className = 'btn-primary'; // Použijeme btn-primary podľa vášho CSS
        btn.textContent = category;
        btn.onclick = () => populateProductionProducts(category, recipes[category]);
        container.appendChild(btn);
    }
}

function populateProductionProducts(category, products) {
    showVyrobaView('view-start-production-product');
    document.getElementById('product-selection-title').textContent = `Krok 2: Produkt (${category})`;
    const container = document.getElementById('product-container');
    container.innerHTML = '';
    products.forEach(product => {
        const btn = document.createElement('button');
        btn.className = 'btn-info';
        btn.textContent = product;
        btn.onclick = () => showBatchPlanningView(product);
        container.appendChild(btn);
    });
}

// --- HLAVNÁ LOGIKA: INTERAKTÍVNA TABUĽKA RECEPTÚR ---

function showBatchPlanningView(productName, plannedWeight = '', logId = null) {
    showVyrobaView('view-start-production-batch');
    document.getElementById('batch-planning-title').textContent = `Plánovanie: ${productName}`;
    
    const plannedWeightEl = document.getElementById('planned-weight');
    plannedWeightEl.value = plannedWeight || '';
    plannedWeightEl.dataset.productName = productName;
    plannedWeightEl.dataset.logId = logId || '';
    
    // Default dátum = dnes
    const prodDate = document.getElementById('production-date');
    if (!prodDate.value) prodDate.valueAsDate = new Date();

    // Reset UI
    const area = document.getElementById('ingredients-check-area');
    area.style.display = 'none';
    
    // Odstránime dynamické prvky ak tam ostali z minula (tlačidlo pridať, input na meno)
    // Aby sme ich nepridávali donekonečna
    const existingControls = document.getElementById('dynamic-recipe-controls');
    if (existingControls) existingControls.remove();

    if (plannedWeight) {
        calculateIngredientsForBatch(productName, plannedWeight);
    }
}

async function calculateIngredientsForBatch(productName, plannedWeight) {
    const startBtn = document.getElementById('start-production-btn');
    const ingredientsArea = document.getElementById('ingredients-check-area');
    const tableContainer = document.getElementById('ingredients-table'); // Toto je .table-container v HTML

    const plannedNorm = String(plannedWeight || '').replace(',', '.').trim();
    const plannedNum = Number(plannedNorm);

    if (!productName || !plannedNorm || !isFinite(plannedNum) || plannedNum <= 0) {
        return;
    }

    try {
        const result = await apiRequest('/api/calculateRequiredIngredients', {
            method: 'POST',
            body: { productName, plannedWeight: plannedNum }
        });

        if (result && result.error) {
            showStatus(result.error, true);
            return;
        }

        const rows = (result && result.data) || [];
        
        // --- 1. Generovanie Tabuľky s Inputmi ---
        let tableHtml = `
            <table>
                <thead>
                    <tr>
                        <th style="width:40%">Surovina</th>
                        <th style="width:25%">Množstvo (kg)</th>
                        <th style="width:20%">Sklad</th>
                        <th style="width:15%">Akcia</th>
                    </tr>
                </thead>
                <tbody id="recipe-tbody">
        `;

        rows.forEach(ing => {
            const qty = parseFloat(ing.required || 0);
            const stock = parseFloat(ing.inStock || 0);
            const isLow = stock < qty;
            
            // Všimnite si <input> pre množstvo a data-atribúty
            tableHtml += `
                <tr data-original-name="${escapeHtml(ing.name)}">
                    <td>
                        <strong>${escapeHtml(ing.name)}</strong>
                        <input type="hidden" class="ing-name-input" value="${escapeHtml(ing.name)}">
                    </td>
                    <td>
                        <input type="number" class="ing-qty-input" value="${qty.toFixed(3)}" step="0.001" style="width:100%; padding:4px;">
                    </td>
                    <td style="color:${isLow ? '#ef4444' : 'inherit'}">${stock.toFixed(2)}</td>
                    <td>
                        <button class="btn-danger" style="padding:4px 8px; margin:0;" onclick="this.closest('tr').remove()">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tableHtml += `</tbody></table>`;
        tableContainer.innerHTML = tableHtml;

        // --- 2. Dynamické vloženie ovládacích prvkov pod tabuľku ---
        // Vytvoríme kontajner pre "Pridať surovinu" a "Podpis"
        // Vložíme ho do ingredientsArea, HNEĎ ZA tableContainer
        
        // Najprv zmažeme starý ak existuje
        const oldControls = document.getElementById('dynamic-recipe-controls');
        if (oldControls) oldControls.remove();

        const controlsDiv = document.createElement('div');
        controlsDiv.id = 'dynamic-recipe-controls';
        controlsDiv.style.marginTop = '15px';
        controlsDiv.style.borderTop = '1px solid #e5e7eb';
        controlsDiv.style.paddingTop = '10px';

        // Dropdown surovín (skrytý zoznam v JS premennej)
        let options = `<option value="">-- Vyberte surovinu na pridanie --</option>`;
        allIngredientsList.forEach(item => {
            options += `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} (Sklad: ${item.quantity} kg)</option>`;
        });

        controlsDiv.innerHTML = `
            <div style="display:flex; gap:10px; margin-bottom:15px; align-items:flex-end;">
                <div style="flex-grow:1;">
                    <label style="font-size:0.85rem;">Pridať surovinu naviac:</label>
                    <select id="new-ingredient-select" style="margin-top:0;">${options}</select>
                </div>
                <button class="btn-secondary" style="width:auto; margin:0;" onclick="addManualIngredient()">
                    <i class="fas fa-plus"></i> Pridať
                </button>
            </div>

            <div style="background:#fff7ed; border:1px solid #fed7aa; padding:10px; border-radius:0.5rem;">
                <label style="color:#9a3412;">Potvrdenie zmien / Výroby:</label>
                <input type="text" id="recipe-changed-by" placeholder="Zadajte vaše meno (Povinné pri zmene receptu)" style="border-color:#fed7aa;">
                <small style="display:block; margin-top:4px; color:#666;">Ak meníte receptúru (napr. zámena suroviny), podpis je povinný.</small>
            </div>
        `;

        ingredientsArea.appendChild(controlsDiv);
        ingredientsArea.style.display = 'block';
        startBtn.disabled = false;

    } catch (e) {
        console.error(e);
        showStatus("Chyba pri výpočte.", true);
    }
}

// Funkcia pre manuálne pridanie riadku do tabuľky
window.addManualIngredient = function() {
    const select = document.getElementById('new-ingredient-select');
    const name = select.value;
    if (!name) return;

    // Zistíme sklad pre zobrazenie
    const item = allIngredientsList.find(i => i.name === name);
    const stock = item ? item.quantity : 0;

    const tbody = document.getElementById('recipe-tbody');
    const tr = document.createElement('tr');
    tr.style.backgroundColor = '#f0f9ff'; // Jemne modrá pre pridané položky

    tr.innerHTML = `
        <td>
            <strong>${escapeHtml(name)}</strong> <small>(Pridané)</small>
            <input type="hidden" class="ing-name-input" value="${escapeHtml(name)}">
        </td>
        <td>
            <input type="number" class="ing-qty-input" value="1.000" step="0.001" style="width:100%; padding:4px;">
        </td>
        <td>${parseFloat(stock).toFixed(2)}</td>
        <td>
            <button class="btn-danger" style="padding:4px 8px; margin:0;" onclick="this.closest('tr').remove()">
                <i class="fas fa-trash"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    select.value = ""; // Reset dropdownu
};

// --- Spustenie výroby ---
async function startProduction() {
    const plannedWeightEl = document.getElementById('planned-weight');
    const plannedNum = Number(plannedWeightEl.value);
    const prodDate = document.getElementById('production-date').value;
    const existingLogId = plannedWeightEl.dataset.logId || null;
    const productName = plannedWeightEl.dataset.productName;

    // 1. Zbieranie dát z tabuľky (Scraping DOM)
    const ingredients = [];
    const rows = document.querySelectorAll('#recipe-tbody tr');
    let hasZero = false;

    rows.forEach(tr => {
        const nameInput = tr.querySelector('.ing-name-input');
        const qtyInput = tr.querySelector('.ing-qty-input');
        
        if (nameInput && qtyInput) {
            const val = parseFloat(qtyInput.value);
            if (val <= 0) hasZero = true;
            ingredients.push({
                name: nameInput.value,
                quantity: val
            });
        }
    });

    if (ingredients.length === 0) {
        showStatus("Receptúra je prázdna.", true);
        return;
    }
    if (hasZero) {
        showStatus("Pozor: Niektoré suroviny majú nulové množstvo.", true);
        return;
    }

    // 2. Kontrola mena (podpisu)
    // Ak užívateľ pridal riadok (má iné pozadie) alebo zmenil počet riadkov, alebo zmenil hodnotu...
    // Pre zjednodušenie: Vždy vyžadujeme meno, ak je pole viditeľné a vyplnené, alebo ak je to 'manuálna' zmena.
    // Ale klient chcel: "každú zmenu receptu musi potvrdit zamestnanec zadaním mena".
    
    // Získame meno z dynamicky pridaného inputu
    const workerInput = document.getElementById('recipe-changed-by');
    let workerName = workerInput ? workerInput.value.trim() : '';

    // Ak nie je meno zadané manuálne, skúsime z prihlásenia (default)
    if (!workerName) {
        const userInfoEl = document.getElementById('user-info');
        const loggedUser = userInfoEl ? (userInfoEl.textContent.match(/Vitajte, (.*?)\s\(/)?.[1] || '') : '';
        
        // Tu je logika: Ak sme pridali surovinu manuálne, MUSÍ zadať meno explicitne (podľa zadania)
        // Skontrolujeme, či existuje riadok s poznámkou "(Pridané)"
        const hasManualRow = document.body.innerHTML.includes('(Pridané)');
        
        if (hasManualRow) {
            showStatus("Upravili ste receptúru. Zadajte prosím vaše meno do poľa 'Potvrdenie'.", true);
            if(workerInput) workerInput.focus();
            return;
        }
        
        // Ak nebola radikálna zmena, použijeme prihláseného usera
        workerName = loggedUser || 'Neznamy';
    }

    const submissionData = {
        productName: productName,
        plannedWeight: plannedNum,
        productionDate: prodDate,
        existingLogId: existingLogId,
        workerName: workerName,
        ingredients: ingredients // Posielame upravený zoznam
    };

    try {
        const result = await apiRequest('/api/startProduction', {
            method: 'POST',
            body: submissionData
        });

        if (result && result.error) {
            showStatus(result.error, true);
            return;
        }

        showStatus((result && result.message) || 'Výroba spustená.', false);
        setTimeout(() => loadAndShowProductionMenu(), 1500);
    } catch (e) {
        showStatus("Chyba spojenia.", true);
    }
}

// Export pre common.js
window.loadAndShowProductionMenu = loadAndShowProductionMenu;

// Zvyšok funkcií pre sklad (loadAndShowStockLevels, submitInventory, atď.) ostáva z pôvodného súboru.
// ... (sem skopírujte zvyšok funkcií z pôvodného vyroba.js pre Sklad a Inventúru, ak tam boli) ...
async function loadAndShowStockLevels() {
    try {
        const data = await apiRequest('/api/getWarehouseState');
        if (data && data.error) { showStatus(data.error, true); return; }
        showVyrobaView('view-stock-levels');
        const container = document.getElementById('stock-tables-container');
        container.innerHTML = '';
        ['Mäso', 'Koreniny', 'Obaly', 'Pomocný materiál'].forEach(cat => {
            const rows = data[cat] || [];
            if(rows.length > 0) {
                 container.innerHTML += `<h4>${escapeHtml(cat)}</h4><div class="table-container"><table><thead><tr><th>Názov</th><th>Sklad</th><th>Min</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${i.name}</td><td>${Number(i.quantity).toFixed(2)}</td><td>${i.minStock}</td></tr>`).join('')}</tbody></table></div>`;
            }
        });
    } catch (e) {}
}
let inventoryAllItems = [];

// =================================================================
// === OPRAVENÁ INVENTÚRA (vyroba.js) ===
// =================================================================

// 1. Pridajte túto chýbajúcu pomocnú funkciu
function safeToFixed(value, decimals = 2) {
    const num = parseFloat(value);
    return isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
}

async function loadAndShowInventory() {
    try {
        const data = await apiRequest('/api/getWarehouseState');
        if (data && data.error) { showStatus(data.error, true); return; }
        
        showVyrobaView('view-inventory');
        
        // Uložíme si dáta globálne
        inventoryAllItems = data; 

        const container = document.getElementById('inventory-tables-container');
        container.innerHTML = `
            <div class="inventory-tabs" style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button class="btn-tab btn-primary" onclick="renderInventoryTab('Mäso', this)">Mäso</button>
                <button class="btn-tab btn-secondary" onclick="renderInventoryTab('Koreniny', this)">Koreniny</button>
                <button class="btn-tab btn-secondary" onclick="renderInventoryTab('Obaly', this)">Obaly</button>
                <button class="btn-tab btn-secondary" onclick="renderInventoryTab('Pomocný materiál', this)">Pomocný mat.</button>
            </div>
            
            <div id="active-inventory-tab-content">
                </div>

            <div style="margin-top:30px; border-top:2px solid #ccc; padding-top:20px; text-align:right;">
                <span class="text-muted" style="margin-right:10px;">Po dokončení všetkých skladov:</span>
                <button class="btn-danger" onclick="finishInventoryGlobal()" style="padding:15px 25px; font-size:1.1em;">
                    <i class="fas fa-flag-checkered"></i> UKONČIŤ CELÚ INVENTÚRU
                </button>
            </div>
        `;

        // Otvoríme prvý tab defaultne
        renderInventoryTab('Mäso', container.querySelector('.btn-tab'));

    } catch (e) {
        console.error(e);
        showStatus("Chyba načítania skladu.", true);
    }
}

function renderInventoryTab(category, btnElement) {
    // 1. Prepnutie vizuálu tlačidiel
    if (btnElement) {
        document.querySelectorAll('.inventory-tabs .btn-tab').forEach(b => {
            b.classList.remove('btn-primary');
            b.classList.add('btn-secondary');
        });
        btnElement.classList.remove('btn-secondary');
        btnElement.classList.add('btn-primary');
    }

    // 2. Získanie dát pre kategóriu
    const items = inventoryAllItems[category] || [];
    const contentDiv = document.getElementById('active-inventory-tab-content');

    if (items.length === 0) {
        contentDiv.innerHTML = `<p>V kategórii <strong>${escapeHtml(category)}</strong> nie sú žiadne položky.</p>`;
        return;
    }

    // 3. Vykreslenie tabuľky
    let tableHtml = `
        <div class="stat-card" style="border:1px solid #bfdbfe; background:#eff6ff;">
            <h4 style="margin-top:0; color:#1e40af;">${escapeHtml(category)}</h4>
            <p class="text-muted small">Zadajte reálny stav. Tlačidlom "Uložiť" zapíšete stav skladu a uložíte koncept.</p>
            
            <div class="table-container" style="max-height:500px; background:white;">
                <table class="table-inventory" data-category="${escapeHtml(category)}">
                    <thead>
                        <tr>
                            <th>Názov položky</th>
                            <th style="width:100px;">Systém (kg)</th>
                            <th style="width:120px;">Reálne (kg)</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    items.forEach(item => {
        tableHtml += `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${safeToFixed(item.quantity, 2)}</td>
                <td>
                    <input type="number" step="0.01" 
                           class="inventory-input form-control" 
                           data-name="${escapeHtml(item.name)}" 
                           placeholder="${safeToFixed(item.quantity, 2)}"
                           style="font-weight:bold; width:100%;">
                </td>
            </tr>
        `;
    });

    // --- ZMENA: Tlačidlo má teraz priamy štýl (Zelená farba) ---
    tableHtml += `
                    </tbody>
                </table>
            </div>
            <div style="text-align:right; margin-top:15px;">
                <button onclick="saveCategoryInventory('${escapeHtml(category)}')"
                        style="background-color: var(--success-color); color: white; padding: 12px 24px; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;">
                    <i class="fas fa-save"></i> 
                    Uložiť ${escapeHtml(category)}
                </button>
            </div>
        </div>
    `;

    contentDiv.innerHTML = tableHtml;
}

// --- Funkcia pre ULOŽENIE jednej kategórie (Priebežne) ---
async function saveCategoryInventory(category) {
    const inputs = document.querySelectorAll(`.table-inventory[data-category="${category}"] .inventory-input`);
    const itemsToSave = [];

    inputs.forEach(input => {
        const val = input.value;
        if (val !== '') { // Posielame len vyplnené
            itemsToSave.push({
                name: input.dataset.name,
                realQty: val
            });
        }
    });

    if (itemsToSave.length === 0) {
        showStatus(`Nezadali ste žiadne hodnoty pre ${category}.`, true);
        return;
    }

    try {
        const result = await apiRequest('/api/saveInventoryCategory', {
            method: 'POST',
            body: {
                category: category,
                items: itemsToSave
            }
        });

        if (result && result.error) {
            showStatus(result.error, true);
        } else {
            showStatus(result.message || `Kategória ${category} uložená.`, false);
        }
    } catch (e) {
        showStatus("Chyba pri ukladaní.", true);
    }
}

// --- Funkcia pre FINÁLNE UKONČENIE ---
async function finishInventoryGlobal() {
    if (!confirm("Naozaj chcete UKONČIŤ celú inventúru? \n\nUistite sa, že ste uložili všetky kategórie. Po ukončení sa dáta odošlú do kancelárie.")) {
        return;
    }

    try {
        const result = await apiRequest('/api/finishInventory', { method: 'POST' });
        if (result && result.error) {
            showStatus(result.error, true);
        } else {
            alert(result.message || "Inventúra ukončená.");
            loadAndShowProductionMenu(); // Návrat do menu
        }
    } catch (e) {
        showStatus("Chyba pri ukončovaní.", true);
    }
}


async function submitInventory() {
    const items = [];
    document.querySelectorAll('.inv-input').forEach(i => {
        if(i.value) items.push({name: i.dataset.name, realQty: i.value});
    });
    if(!items.length) return;
    await apiRequest('/api/submitInventory', {method:'POST', body: items});
    showStatus('Inventúra zapísaná', false);
    loadAndShowProductionMenu();
}

async function loadAndShowManualWriteoff() {
     const items = await apiRequest('/api/getAllWarehouseItems');
     showVyrobaView('view-manual-writeoff');
     const sel = document.getElementById('writeoff-item-select');
     sel.innerHTML = items.map(i=>`<option value="${i.name}">${i.name}</option>`).join('');
}
async function submitManualWriteoff() {
    // ... existujúca logika ...
    const data = {
        workerName: document.getElementById('writeoff-worker-name').value,
        itemName: document.getElementById('writeoff-item-select').value,
        quantity: document.getElementById('writeoff-quantity').value,
        note: document.getElementById('writeoff-note').value
    };
    if(!data.quantity) return;
    await apiRequest('/api/manualWriteOff', {method:'POST', body:data});
    showStatus('Odpísané', false);
    loadAndShowProductionMenu();
}