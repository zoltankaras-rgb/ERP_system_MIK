const PricelistManager = {
    data() {
        return {
            // Editor state
            currentId: null,
            pricelistName: '',
            validFrom: new Date().toISOString().split('T')[0], // Defaultne dnešný dátum
            customersInput: '',
            pricelistItems: [],
            
            // Product Catalog Logic
            allCatalogProducts: [], // Načítané všetky produkty
            productSearch: '',
            showProductDropdown: false,
            
            // Data
            savedPricelists: [],
            savedContacts: [],
            
            // UI state
            isLoading: false,
            showAddressBook: false,
            
            // Adresár
            selectedContacts: [],
            newContactName: '',
            newContactEmail: ''
        }
    },
    computed: {
        filteredProducts() {
            if (!this.productSearch || this.productSearch.length < 2) return [];
            const term = this.productSearch.toLowerCase();
            return this.allCatalogProducts.filter(p => 
                (p.nazov_vyrobku && p.nazov_vyrobku.toLowerCase().includes(term)) || 
                (p.ean && p.ean.includes(term))
            ).slice(0, 10); // Limit na 10 výsledkov pre rýchlosť
        }
    },
    mounted() {
        this.fetchSavedPricelists();
        this.fetchContacts();
        this.fetchCatalog(); // Načítame produkty pre našepkávač
    },
    methods: {
        resetForm() {
            this.currentId = null;
            this.pricelistName = '';
            this.validFrom = new Date().toISOString().split('T')[0];
            this.customersInput = '';
            this.pricelistItems = [];
            this.selectedContacts = [];
            this.productSearch = '';
        },
        
        // --- Catalog Logic ---
        async fetchCatalog() {
            try {
                // Použijeme existujúci endpoint z ERP Admina
                const r = await fetch('/api/kancelaria/getCatalogManagementData');
                const data = await r.json();
                if (data.products) {
                    this.allCatalogProducts = data.products;
                }
            } catch (e) { console.error("Chyba katalógu:", e); }
        },

        selectProduct(product) {
            // Kontrola duplicity
            const exists = this.pricelistItems.find(p => p.ean === product.ean);
            if (exists) {
                alert(`"${product.nazov_vyrobku}" už v cenníku je.`);
                return;
            }

            let dphVal = 20;
            if (product.dph != null) dphVal = parseFloat(product.dph);
            
            this.pricelistItems.push({
                ean: product.ean,
                name: product.nazov_vyrobku,
                old_price: 0, // Bežná cena
                price: 0,     // Nová cena
                mj: product.mj || 'kg',
                dph: dphVal,
                is_action: false // Defaultne
            });

            // Reset search
            this.productSearch = '';
            this.showProductDropdown = false;
        },

        remove(index) {
            this.pricelistItems.splice(index, 1);
        },
        
        // --- API Calls ---
        async fetchSavedPricelists() {
            try {
                const r = await fetch('/api/cenniky/list');
                if (r.ok) this.savedPricelists = await r.json();
            } catch (e) { console.error(e); }
        },

        async fetchContacts() {
            try {
                const r = await fetch('/api/contacts/list');
                if (r.ok) this.savedContacts = await r.json();
            } catch (e) { console.error(e); }
        },

        async addContact() {
            if (!this.newContactName || !this.newContactEmail) return alert("Vyplň meno a email.");
            try {
                await fetch('/api/contacts/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({name: this.newContactName, email: this.newContactEmail})
                });
                this.newContactName = '';
                this.newContactEmail = '';
                this.fetchContacts();
            } catch (e) { alert("Chyba: " + e); }
        },

        async deleteContact(id) {
            if(!confirm("Zmazať kontakt?")) return;
            try {
                await fetch(`/api/contacts/delete/${id}`, { method: 'DELETE' });
                this.fetchContacts();
                this.selectedContacts = this.selectedContacts.filter(cId => cId !== id);
            } catch (e) { alert("Chyba: " + e); }
        },

        // --- ULOŽENIE ---
        async savePricelist() {
            if (!this.pricelistName) return alert("Zadaj názov cenníka!");
            if (this.pricelistItems.length === 0) return alert("Cenník je prázdny.");

            let method = 'POST';
            let url = '/api/cenniky/save';
            
            if (this.currentId) {
                if (confirm("Chceš AKTUALIZOVAŤ tento otvorený cenník?\n(Zrušiť = uložiť ako nový)")) {
                    method = 'PUT';
                    url = `/api/cenniky/${this.currentId}/update`;
                } else {
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
                        platnost_od: this.validFrom, // Posielame dátum
                        polozky: this.pricelistItems
                    })
                });
                const data = await res.json();
                
                if (data.success) {
                    alert("✅ Uložené.");
                    this.fetchSavedPricelists();
                    if (method === 'POST') this.resetForm();
                } else {
                    alert("Chyba: " + (data.message || data.error));
                }
            } catch (e) { alert(e.message); } 
            finally { this.isLoading = false; }
        },

        async loadPricelist(id) {
            this.isLoading = true;
            try {
                const r = await fetch(`/api/cenniky/${id}`);
                if (!r.ok) throw new Error("Chyba načítania");
                const data = await r.json();
                
                this.currentId = data.id;
                this.pricelistName = data.nazov;
                this.validFrom = data.platnost_od || new Date().toISOString().split('T')[0];
                this.customersInput = data.email || '';
                this.pricelistItems = data.polozky;
                this.selectedContacts = [];
                
                document.querySelector('.card').scrollIntoView({behavior: 'smooth'});
            } catch (e) { alert(e.message); }
            finally { this.isLoading = false; }
        },

        async deletePricelist(id) {
            if (!confirm("Naozaj vymazať?")) return;
            try {
                const r = await fetch(`/api/cenniky/${id}/delete`, { method: 'DELETE' });
                const data = await r.json();
                if (data.success) {
                    if (this.currentId === id) this.resetForm();
                    this.fetchSavedPricelists();
                } else { alert("Chyba: " + data.error); }
            } catch(e) { alert("Chyba siete."); }
        },

        async sendStoredPricelist(id, nazov) {
            // Určenie dátumu platnosti pre odoslanie
            let dateToSend = this.validFrom;
            // Ak posielame zo zoznamu (nie otvoreného), skúsme zistiť dátum z DB, alebo použijeme dnešný
            if (this.currentId !== id) {
                 // Pre jednoduchosť pri rýchlom odoslaní použijeme dnešný dátum alebo user bude musieť otvoriť cenník
                 // Alebo pošleme parameter v requeste, aby backend použil uložený dátum
            }

            let manualEntry = prompt(`Komu odoslať cenník "${nazov}"?\n(Zadaj emaily oddelené čiarkou)`, this.customersInput);
            if (manualEntry === null) return;

            let recipients = [];
            if (manualEntry) {
                manualEntry.split(',').forEach(email => {
                    if (email.trim()) recipients.push({ name: nazov, email: email.trim() });
                });
            }

            this.selectedContacts.forEach(id => {
                const c = this.savedContacts.find(x => x.id === id);
                if (c) recipients.push({ name: c.name, email: c.email });
            });

            if (recipients.length === 0) return alert("Nezadal si žiadneho príjemcu.");

            this.isLoading = true;
            try {
                const detailResp = await fetch(`/api/cenniky/${id}`);
                const detailData = await detailResp.json();
                
                const sendResp = await fetch('/api/send_custom_pricelist', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        customers: recipients,
                        items: detailData.polozky,
                        valid_from: detailData.platnost_od || new Date().toLocaleDateString('sk-SK') // Použijeme uložený dátum
                    })
                });
                
                const res = await sendResp.json();
                if (res.success) {
                    alert("✅ " + res.message);
                    this.selectedContacts = [];
                } else {
                    alert("❌ " + (res.message || res.error));
                }

            } catch (e) { alert("Chyba: " + e.message); }
            finally { this.isLoading = false; }
        }
    },
    template: `
    <div class="card p-4 shadow-sm">
        <div class="d-flex justify-content-between align-items-center mb-4 border-bottom pb-3">
            <h3 class="m-0 text-primary">
                <span v-if="currentId"><i class="fas fa-edit"></i> Úprava cenníka</span>
                <span v-else><i class="fas fa-plus-circle"></i> Nový Veľkoobchodný Cenník</span>
            </h3>
            <button @click="resetForm" class="btn btn-secondary btn-sm"><i class="fas fa-redo"></i> Vyčistiť / Nový</button>
        </div>
        
        <div class="row g-3 mb-4 bg-light p-3 rounded border">
            <div class="col-md-4">
                <label class="form-label fw-bold">Názov cenníka:</label>
                <input v-model="pricelistName" type="text" class="form-control" placeholder="napr. VO Cenník - Reštaurácie">
            </div>
            <div class="col-md-3">
                <label class="form-label fw-bold">Platnosť od:</label>
                <input v-model="validFrom" type="date" class="form-control">
            </div>
            <div class="col-md-5">
                <label class="form-label fw-bold">Email príjemcovia:</label>
                <div class="input-group">
                    <button class="btn btn-outline-dark" type="button" @click="showAddressBook = !showAddressBook">
                        <i class="fas fa-address-book"></i> Adresár ({{ selectedContacts.length }})
                    </button>
                    <input v-model="customersInput" type="text" class="form-control" placeholder="email1@xyz.sk, email2@...">
                </div>
            </div>
        </div>

        <div v-if="showAddressBook" class="card mb-3 border-info">
            <div class="card-header bg-info text-white d-flex justify-content-between py-1 px-3">
                <span>📖 Adresár kontaktov</span>
                <button class="btn btn-sm btn-light py-0" @click="showAddressBook = false">X</button>
            </div>
            <div class="card-body p-2">
                <div class="d-flex gap-2 mb-2">
                    <input v-model="newContactName" class="form-control form-control-sm" placeholder="Meno Firmy">
                    <input v-model="newContactEmail" class="form-control form-control-sm" placeholder="Email">
                    <button @click="addContact" class="btn btn-success btn-sm">Pridať</button>
                </div>
                <div style="max-height: 150px; overflow-y: auto;">
                    <table class="table table-sm table-hover mb-0">
                        <tbody>
                            <tr v-for="c in savedContacts" :key="c.id">
                                <td style="width:30px"><input type="checkbox" :value="c.id" v-model="selectedContacts"></td>
                                <td>{{ c.name }}</td>
                                <td>{{ c.email }}</td>
                                <td class="text-end"><button @click="deleteContact(c.id)" class="btn btn-xs text-danger border-0">x</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="mb-3 position-relative">
            <label class="form-label fw-bold">Pridať produkt do cenníka:</label>
            <div class="input-group">
                <span class="input-group-text"><i class="fas fa-search"></i></span>
                <input 
                    type="text" 
                    class="form-control" 
                    placeholder="Začnite písať názov produktu alebo EAN..." 
                    v-model="productSearch"
                    @focus="showProductDropdown = true"
                    @blur="setTimeout(() => showProductDropdown = false, 200)"
                >
            </div>
            <div v-if="showProductDropdown && filteredProducts.length > 0" class="list-group position-absolute w-100 shadow" style="z-index: 1000; max-height: 300px; overflow-y: auto;">
                <button 
                    v-for="p in filteredProducts" 
                    :key="p.ean"
                    class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                    @click="selectProduct(p)"
                >
                    <div>
                        <strong>{{ p.nazov_vyrobku }}</strong>
                        <br><small class="text-muted">EAN: {{ p.ean }}</small>
                    </div>
                    <span class="badge bg-secondary">{{ p.mj }}</span>
                </button>
            </div>
        </div>

        <div v-if="pricelistItems.length === 0" class="alert alert-secondary text-center p-4">
            <h5 class="text-muted">Cenník zatiaľ neobsahuje žiadne položky.</h5>
            <p>Použite vyhľadávanie vyššie na pridanie produktov.</p>
        </div>

        <table v-else class="table table-bordered table-hover align-middle shadow-sm">
            <thead class="table-dark">
                <tr>
                    <th>Produkt / EAN</th>
                    <th style="width:70px">MJ</th>
                    <th style="width:70px">DPH%</th>
                    <th style="width:130px; background:#d1e7dd; color:#0f5132;">NOVÁ CENA<br><small>(bez DPH)</small></th>
                    <th style="width:130px">Bežná cena<br><small>(voliteľné)</small></th>
                    <th class="text-center" style="width:50px"><i class="fas fa-trash"></i></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) in pricelistItems" :key="index">
                    <td>
                        <strong>{{ item.name }}</strong>
                        <br><small class="text-muted">{{ item.ean }}</small>
                    </td>
                    <td><input v-model="item.mj" class="form-control form-control-sm text-center"></td>
                    <td><input type="number" v-model="item.dph" class="form-control form-control-sm text-center"></td>
                    <td class="bg-light">
                        <input type="number" v-model="item.price" class="form-control fw-bold text-success border-success" step="0.01">
                    </td>
                    <td>
                        <input type="number" v-model="item.old_price" class="form-control form-control-sm text-muted" step="0.01" placeholder="0.00">
                    </td>
                    <td class="text-center">
                        <button @click="remove(index)" class="btn btn-outline-danger btn-sm border-0"><i class="fas fa-times"></i></button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div class="d-flex justify-content-end gap-2 mb-5">
            <button v-if="currentId" @click="sendStoredPricelist(currentId, pricelistName)" class="btn btn-success btn-lg" :disabled="isLoading">
                <i class="fas fa-paper-plane"></i> Odoslať emailom
            </button>
            <button @click="savePricelist" :disabled="isLoading" class="btn btn-primary btn-lg px-5">
                <span v-if="isLoading"><i class="fas fa-spinner fa-spin"></i> Ukladám...</span>
                <span v-else><i class="fas fa-save"></i> Uložiť Cenník</span>
            </button>
        </div>

        <hr>

        <h4 class="mt-4 text-secondary"><i class="fas fa-folder-open"></i> Uložené cenníky</h4>
        <div class="table-responsive">
            <table class="table table-striped table-hover mt-2">
                <thead class="table-light">
                    <tr>
                        <th>Názov cenníka</th>
                        <th>Platnosť od</th>
                        <th>Vytvorený</th>
                        <th>Položiek</th>
                        <th class="text-end">Akcie</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="c in savedPricelists" :key="c.id">
                        <td><b>{{ c.nazov }}</b></td>
                        <td><span class="badge bg-info text-dark">{{ c.platnost_od || '-' }}</span></td>
                        <td>{{ c.datum }}</td>
                        <td>{{ c.pocet_poloziek }}</td>
                        <td class="text-end">
                            <button @click="loadPricelist(c.id)" class="btn btn-sm btn-primary me-1" title="Editovať"><i class="fas fa-pen"></i></button>
                            <button @click="sendStoredPricelist(c.id, c.nazov)" class="btn btn-sm btn-success me-1" title="Odoslať"><i class="fas fa-envelope"></i></button>
                            <button @click="deletePricelist(c.id)" class="btn btn-sm btn-danger" title="Zmazať"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    `
};