const PricelistManager = {
    data() {
        return {
            pricelistName: '',       // Názov cenníka (napr. Zima 2025)
            customersInput: '',      // Email
            pricelistItems: [],      // Položky v editore
            savedPricelists: [],     // Zoznam uložených cenníkov z DB
            isLoading: false
        }
    },
    mounted() {
        // 1. Načítame zoznam už existujúcich cenníkov
        this.fetchSavedPricelists();

        // 2. Sprístupníme funkciu pre pridávanie z katalógu (volá ju erp_admin.js)
        window.addToPricelist = (product) => {
            // Kontrola, či už produkt nie je v zozname
            const exists = this.pricelistItems.find(p => p.ean === product.ean);
            if (exists) {
                alert(`Produkt "${product.nazov_vyrobku}" už je v cenníku pridaný.`);
                return;
            }

            // Zistenie DPH (ak v katalógu existuje, inak 20%)
            let dphVal = 20;
            if (product.dph) dphVal = parseFloat(product.dph);
            else if (product.vat) dphVal = parseFloat(product.vat);

            // Pridanie do lokálneho zoznamu
            this.pricelistItems.push({
                ean: product.ean,
                name: product.nazov_vyrobku,
                old_price: 0, 
                price: 0, 
                mj: product.mj || 'kg', // ZMENA: Predvolené je 'kg'
                dph: dphVal,            // ZMENA: Ukladáme aj DPH
                is_action: false
            });
        };
    },
    methods: {
        remove(index) {
            this.pricelistItems.splice(index, 1);
        },
        
        // --- Načítanie zoznamu cenníkov z DB ---
        async fetchSavedPricelists() {
            try {
                const response = await fetch('/api/cenniky/list');
                if (response.ok) {
                    this.savedPricelists = await response.json();
                }
            } catch (error) {
                console.error("Chyba načítania zoznamu cenníkov:", error);
            }
        },

        // --- Uloženie cenníka do DB ---
        async savePricelist() {
            if (!this.pricelistName) {
                alert("Zadaj názov cenníka! (napr. Zima 2025)");
                return;
            }
            if (this.pricelistItems.length === 0) {
                alert("Cenník je prázdny, pridaj nejaké produkty.");
                return;
            }

            this.isLoading = true;
            try {
                const payload = {
                    nazov: this.pricelistName,
                    email: this.customersInput,
                    polozky: this.pricelistItems // Posielame aj s DPH a MJ
                };

                const response = await fetch('/api/cenniky/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                if (result.success) {
                    alert("✅ Cenník uložený!");
                    this.fetchSavedPricelists(); // Obnovíme zoznam dole
                } else {
                    alert("Chyba: " + result.message);
                }
            } catch (e) {
                alert("Chyba komunikácie.");
                console.error(e);
            } finally {
                this.isLoading = false;
            }
        },

        // --- Načítanie konkrétneho cenníka do editora ---
        async loadPricelist(id) {
            if (this.pricelistItems.length > 0) {
                if(!confirm("Máš rozpracovaný cenník. Chceš ho prepísať týmto uloženým?")) return;
            }
            
            this.isLoading = true;
            try {
                const response = await fetch(`/api/cenniky/${id}`);
                const data = await response.json();
                
                this.pricelistName = data.nazov;
                this.customersInput = data.email || '';
                this.pricelistItems = data.polozky; // Naplní tabuľku (vrátane DPH a MJ)
                
            } catch (e) {
                alert("Nepodarilo sa načítať cenník.");
            } finally {
                this.isLoading = false;
            }
        },

        // --- Odoslanie ULOŽENÉHO cenníka ---
        async sendStoredPricelist(id, nazov) {
            const email = prompt(`Na aký email odoslať cenník "${nazov}"?`, this.customersInput);
            if (!email) return;

            this.isLoading = true;
            try {
                const response = await fetch(`/api/cenniky/${id}/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email })
                });
                const res = await response.json();
                
                if (res.success) {
                    alert(`✅ Cenník bol odoslaný na ${email}`);
                } else {
                    alert("❌ Chyba: " + (res.message || res.error));
                }
            } catch (e) {
                alert("Chyba odosielania.");
                console.error(e);
            } finally {
                this.isLoading = false;
            }
        }
    },
    template: `
    <div class="card p-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h3>📝 Editor Cenníkov</h3>
            <div>
                <button @click="pricelistItems = []; pricelistName = ''" class="btn btn-secondary btn-sm">Vyčistiť</button>
            </div>
        </div>
        
        <div class="row mb-3">
            <div class="col-md-6">
                <label><b>Názov cenníka:</b> (napr. VIP Klient 2025)</label>
                <input v-model="pricelistName" type="text" class="form-control" placeholder="Zadaj názov pre uloženie...">
            </div>
            <div class="col-md-6">
                <label>Predvolený E-mail:</label>
                <input v-model="customersInput" type="text" class="form-control" placeholder="klient@firma.sk">
            </div>
        </div>

        <div v-if="pricelistItems.length === 0" class="alert alert-light border text-center">
            Zatiaľ prázdne. <br>
            Choď do <b>Katalógu</b> a klikaj na "Pridať do cenníka", alebo <b>načítaj uložený cenník</b> nižšie.
        </div>

        <table v-else class="table table-bordered table-striped">
            <thead class="table-dark">
                <tr>
                    <th>Produkt</th>
                    <th style="width:80px">MJ</th>
                    <th style="width:80px">DPH %</th>
                    <th style="width:120px">Cena bez DPH</th>
                    <th style="width:120px">Pôvodná cena</th>
                    <th class="text-center">Akcia</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) in pricelistItems" :key="index" :class="{'table-warning': item.is_action}">
                    <td>{{ item.name }}</td>
                    <td><input v-model="item.mj" class="form-control form-control-sm"></td>
                    <td><input type="number" v-model="item.dph" class="form-control form-control-sm" readonly title="DPH sa ťahá z karty produktu"></td>
                    <td><input type="number" v-model="item.price" class="form-control form-control-sm" step="0.01" style="font-weight:bold"></td>
                    <td><input type="number" v-model="item.old_price" class="form-control form-control-sm" step="0.01"></td>
                    <td class="text-center"><input type="checkbox" v-model="item.is_action"></td>
                    <td><button @click="remove(index)" class="btn btn-danger btn-sm">X</button></td>
                </tr>
            </tbody>
        </table>

        <div class="text-end mb-5">
            <button @click="savePricelist" :disabled="isLoading" class="btn btn-primary btn-lg">
                💾 Uložiť Cenník do Databázy
            </button>
        </div>

        <hr>

        <h4 class="mt-4">📂 Uložené cenníky</h4>
        <div v-if="savedPricelists.length === 0" class="text-muted">Nemáš žiadne uložené cenníky.</div>
        
        <table v-else class="table table-hover mt-2">
            <thead>
                <tr>
                    <th>Názov</th>
                    <th>Dátum</th>
                    <th>Položiek</th>
                    <th>Akcie</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="c in savedPricelists" :key="c.id">
                    <td><b>{{ c.nazov }}</b></td>
                    <td>{{ c.datum }}</td>
                    <td>{{ c.pocet_poloziek }}</td>
                    <td>
                        <button @click="loadPricelist(c.id)" class="btn btn-sm btn-info text-white me-2">
                            ✏️ Upraviť/Načítať
                        </button>
                        <button @click="sendStoredPricelist(c.id, c.nazov)" class="btn btn-sm btn-success">
                            📧 Odoslať
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    `
};