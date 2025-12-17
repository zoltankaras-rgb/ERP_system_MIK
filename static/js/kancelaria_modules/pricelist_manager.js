const PricelistManager = {
    data() {
        return {
            currentId: null,         // ID aktuálne načítaného cenníka (null = nový)
            pricelistName: '',
            customersInput: '',      // String s emailami
            pricelistItems: [],
            savedPricelists: [],
            isLoading: false
        }
    },
    mounted() {
        this.fetchSavedPricelists();

        // --- PRIDANIE PRODUKTU Z KATALÓGU ---
        window.addToPricelist = (product) => {
            const exists = this.pricelistItems.find(p => p.ean === product.ean);
            if (exists) {
                alert(`"${product.nazov_vyrobku}" už v cenníku je.`);
                return;
            }

            // OPRAVA DPH: Skúsi nájsť dph, vat, alebo použije 20
            let dphVal = 20;
            if (product.dph != null) dphVal = parseFloat(product.dph);
            else if (product.vat != null) dphVal = parseFloat(product.vat);
            
            // Poistka ak je to 0 alebo NaN
            if (isNaN(dphVal) || dphVal === 0) dphVal = 20;

            this.pricelistItems.push({
                ean: product.ean,
                name: product.nazov_vyrobku,
                old_price: 0, 
                price: 0, 
                mj: product.mj || 'kg',
                dph: dphVal,
                is_action: false
            });
        };
    },
    methods: {
        resetForm() {
            this.currentId = null;
            this.pricelistName = '';
            this.customersInput = '';
            this.pricelistItems = [];
        },
        
        remove(index) {
            this.pricelistItems.splice(index, 1);
        },
        
        async fetchSavedPricelists() {
            try {
                const r = await fetch('/api/cenniky/list');
                if (r.ok) this.savedPricelists = await r.json();
            } catch (e) { console.error(e); }
        },

        // --- ULOŽENIE (NOVÝ alebo EDITÁCIA) ---
        async savePricelist() {
            if (!this.pricelistName) return alert("Zadaj názov cenníka!");
            if (this.pricelistItems.length === 0) return alert("Cenník je prázdny.");

            // Ak máme ID, pýtame sa či prepísať
            let method = 'POST';
            let url = '/api/cenniky/save';
            
            if (this.currentId) {
                if (confirm("Chceš AKTUALIZOVAŤ tento otvorený cenník?\n(Klikni Zrušiť pre uloženie ako NOVÝ)")) {
                    method = 'PUT';
                    url = `/api/cenniky/${this.currentId}/update`;
                } else {
                    // Uloží ako nový (vynulujeme ID pre backend)
                    this.currentId = null; 
                }
            }

            this.isLoading = true;
            try {
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nazov: this.pricelistName,
                        email: this.customersInput,
                        polozky: this.pricelistItems
                    })
                });
                const data = await res.json();
                
                if (data.success) {
                    alert("✅ Uložené.");
                    this.fetchSavedPricelists();
                    if (method === 'POST') this.resetForm(); // Pri novom vyčistíme
                } else {
                    alert("Chyba: " + (data.message || data.error));
                }
            } catch (e) { alert(e.message); } 
            finally { this.isLoading = false; }
        },

        // --- NAČÍTANIE NA ÚPRAVU ---
        async loadPricelist(id) {
            this.isLoading = true;
            try {
                const r = await fetch(`/api/cenniky/${id}`);
                if (!r.ok) throw new Error("Chyba načítania");
                const data = await r.json();
                
                this.currentId = data.id;
                this.pricelistName = data.nazov;
                this.customersInput = data.email || '';
                this.pricelistItems = data.polozky;
                
                // Scroll hore
                document.querySelector('.card').scrollIntoView({behavior: 'smooth'});
            } catch (e) { alert(e.message); }
            finally { this.isLoading = false; }
        },

        // --- MAZANIE ---
        async deletePricelist(id) {
            if (!confirm("Naozaj vymazať tento cenník?")) return;
            
            try {
                const r = await fetch(`/api/cenniky/${id}/delete`, { method: 'DELETE' });
                const data = await r.json();
                if (data.success) {
                    // Ak sme zmazali ten, čo máme práve otvorený
                    if (this.currentId === id) this.resetForm();
                    this.fetchSavedPricelists();
                } else {
                    alert("Chyba: " + data.error);
                }
            } catch(e) { alert("Chyba siete."); }
        },

        // --- ODOSLANIE ---
        async sendStoredPricelist(id, nazov) {
            // Predvyplníme email z DB, ale dovolíme userovi zadať viac
            let email = prompt(`Zadaj emaily pre "${nazov}" (oddeľ čiarkou):`, this.customersInput);
            if (!email) return;

            // Spracovanie na pole objektov pre backend
            // Backend čaká: [{name: '...', email: '...'}]
            // User zadá: "jano@x.sk, fero@x.sk"
            
            const recipients = [{
                name: nazov, // Do mena dáme názov cenníka (alebo "Partner")
                email: email // Backend si to v pythone splitne ak tam su čiarky
            }];

            this.isLoading = true;
            try {
                const r = await fetch('/api/send_custom_pricelist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customers: recipients,
                        // Musíme poslať aj items, lebo backend generuje PDF on-the-fly
                        // Keďže posielame ULOŽENÝ cenník, musíme ho najprv načítať (backend by to mohol robiť, ale tu je logika v JS)
                        // Zjednodušenie: Načítame dáta cenníka a pošleme ich
                        items: [], // Toto je problém, ak nemáme dáta. 
                                   // FIX: Backend by mal vedieť poslať podľa ID, 
                                   // ALEBO frontend musí najprv načítať.
                                   // Pre jednoduchosť - spravme LOAD a potom SEND z editora, 
                                   // alebo tu spravíme fetch navyše.
                    })
                });
                
                // == OPRAVA LOGIKY ODOSIELANIA ZO ZOZNAMU ==
                // Keďže backend 'send_custom_pricelist' čaká 'items', 
                // musíme najprv načítať položky cenníka podľa ID.
                const detailResp = await fetch(`/api/cenniky/${id}`);
                const detailData = await detailResp.json();
                
                const sendResp = await fetch('/api/send_custom_pricelist', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        customers: recipients,
                        items: detailData.polozky,
                        valid_from: new Date().toLocaleDateString('sk-SK')
                    })
                });
                
                const res = await sendResp.json();
                if (res.success) alert("✅ " + res.message);
                else alert("❌ " + (res.message || res.error));

            } catch (e) { alert("Chyba: " + e.message); }
            finally { this.isLoading = false; }
        }
    },
    template: `
    <div class="card p-4">
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h3>
                <span v-if="currentId">✏️ Úprava: {{ pricelistName }}</span>
                <span v-else>📝 Nový Cenník</span>
            </h3>
            <button @click="resetForm" class="btn btn-secondary btn-sm">Vyčistiť / Nový</button>
        </div>
        
        <div class="row mb-3">
            <div class="col-md-5">
                <label>Názov cenníka:</label>
                <input v-model="pricelistName" type="text" class="form-control" placeholder="napr. Veľkoodberateľ 2025">
            </div>
            <div class="col-md-7">
                <label>E-maily (oddeľ čiarkou):</label>
                <input v-model="customersInput" type="text" class="form-control" placeholder="email1@firma.sk, email2@firma.sk">
            </div>
        </div>

        <div v-if="pricelistItems.length === 0" class="alert alert-light border text-center p-5">
            <h4 class="text-muted">Prázdny cenník</h4>
            <p>Choď do <b>Katalógu</b> a pridaj produkty tlačidlom "Do cenníka".</p>
        </div>

        <table v-else class="table table-bordered table-hover align-middle">
            <thead class="table-dark">
                <tr>
                    <th>Produkt</th>
                    <th style="width:70px">MJ</th>
                    <th style="width:70px">DPH</th>
                    <th style="width:110px">Cena (bez)</th>
                    <th style="width:110px">Stará cena</th>
                    <th class="text-center" style="width:80px">Akcia</th>
                    <th style="width:50px"></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) in pricelistItems" :key="index" :class="{'table-warning': item.is_action}">
                    <td><strong>{{ item.name }}</strong></td>
                    <td><input v-model="item.mj" class="form-control form-control-sm text-center"></td>
                    <td><input type="number" v-model="item.dph" class="form-control form-control-sm text-center"></td>
                    <td>
                        <input type="number" v-model="item.price" class="form-control form-control-sm fw-bold" step="0.01">
                    </td>
                    <td>
                        <input type="number" v-model="item.old_price" class="form-control form-control-sm text-muted" step="0.01">
                    </td>
                    <td class="text-center">
                        <div class="form-check d-flex justify-content-center">
                            <input class="form-check-input" type="checkbox" v-model="item.is_action" style="transform: scale(1.3);">
                        </div>
                    </td>
                    <td><button @click="remove(index)" class="btn btn-outline-danger btn-sm border-0"><i class="fas fa-times"></i></button></td>
                </tr>
            </tbody>
        </table>

        <div class="text-end mb-5">
            <button @click="savePricelist" :disabled="isLoading" class="btn btn-primary btn-lg px-5">
                <span v-if="isLoading"><i class="fas fa-spinner fa-spin"></i></span>
                <span v-else>💾 Uložiť Cenník</span>
            </button>
        </div>

        <hr>

        <h4 class="mt-4">📂 Uložené cenníky</h4>
        <table class="table table-striped mt-2">
            <thead>
                <tr>
                    <th>Názov</th>
                    <th>Dátum</th>
                    <th>Položiek</th>
                    <th class="text-end">Akcie</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="c in savedPricelists" :key="c.id">
                    <td><b>{{ c.nazov }}</b></td>
                    <td>{{ c.datum }}</td>
                    <td>{{ c.pocet_poloziek }}</td>
                    <td class="text-end">
                        <button @click="loadPricelist(c.id)" class="btn btn-sm btn-info text-white me-1" title="Editovať">
                            ✏️
                        </button>
                        <button @click="sendStoredPricelist(c.id, c.nazov)" class="btn btn-sm btn-success me-1" title="Odoslať">
                            📧
                        </button>
                        <button @click="deletePricelist(c.id)" class="btn btn-sm btn-danger" title="Zmazať">
                            🗑️
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    `
};