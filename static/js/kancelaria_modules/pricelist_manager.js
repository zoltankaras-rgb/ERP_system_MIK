const PricelistManager = {
    data() {
        return {
            // Editor state
            currentId: null,
            pricelistName: '',
            customersInput: '', // Ručne zadané emaily
            pricelistItems: [],
            
            // Data
            savedPricelists: [],
            savedContacts: [], // Načítané z DB
            
            // UI state
            isLoading: false,
            showAddressBook: false,
            
            // Výber kontaktov
            selectedContacts: [], // IDčka vybraných kontaktov
            newContactName: '',
            newContactEmail: ''
        }
    },
    mounted() {
        this.fetchSavedPricelists();
        this.fetchContacts();

        // Global handler pre pridanie z katalógu
        window.addToPricelist = (product) => {
            const exists = this.pricelistItems.find(p => p.ean === product.ean);
            if (exists) {
                alert(`"${product.nazov_vyrobku}" už v cenníku je.`);
                return;
            }

            let dphVal = 20;
            if (product.dph != null) dphVal = parseFloat(product.dph);
            else if (product.vat != null) dphVal = parseFloat(product.vat);
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
            this.selectedContacts = [];
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
                // Odstrániť z výberu ak bol vybraný
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
                this.customersInput = data.email || '';
                this.pricelistItems = data.polozky;
                this.selectedContacts = []; // Reset výberu pri načítaní
                
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

        // --- ODOSLANIE (FIX DOUBLE SEND) ---
        async sendStoredPricelist(id, nazov) {
            // 1. Získanie manuálnych emailov (prompt)
            let manualEntry = prompt(`Komu odoslať cenník "${nazov}"?\n(Zadaj emaily oddelené čiarkou, alebo nechaj prázdne ak máš vybrané kontakty z adresára)`, this.customersInput);
            
            // Ak user klikne Cancel, zrušíme akciu
            if (manualEntry === null) return;

            // 2. Zozbieranie všetkých príjemcov
            let recipients = [];

            // A) Manuálne zadané
            if (manualEntry) {
                manualEntry.split(',').forEach(email => {
                    email = email.trim();
                    if (email) recipients.push({ name: nazov, email: email });
                });
            }

            // B) Vybrané z adresára (ak sme v editore a odosielame ten otvorený, alebo globálne vybrané)
            // Pre zjednodušenie: pri odosielaní zo zoznamu (tlačidlo v tabuľke) použijeme len prompt.
            // Ak chcú použiť adresár, musia si cenník najprv načítať.
            // ALEBO: Pridáme logiku, že ak je 'showAddressBook' otvorený, použijeme aj tie.
            
            this.selectedContacts.forEach(id => {
                const c = this.savedContacts.find(x => x.id === id);
                if (c) recipients.push({ name: c.name, email: c.email });
            });

            if (recipients.length === 0) {
                return alert("Nezadal si žiadneho príjemcu.");
            }

            this.isLoading = true;
            try {
                // Fetch detail cenníka
                const detailResp = await fetch(`/api/cenniky/${id}`);
                const detailData = await detailResp.json();
                
                // ODOSLANIE (LEN JEDEN FETCH!)
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
                if (res.success) {
                    alert("✅ " + res.message);
                    this.selectedContacts = []; // Reset výberu po odoslaní
                } else {
                    alert("❌ " + (res.message || res.error));
                }

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
            <div class="col-md-4">
                <label>Názov cenníka:</label>
                <input v-model="pricelistName" type="text" class="form-control" placeholder="napr. VIP Klienti">
            </div>
            <div class="col-md-8">
                <label>Príjemcovia:</label>
                <div class="input-group">
                    <button class="btn btn-outline-secondary" type="button" @click="showAddressBook = !showAddressBook">
                        📖 Adresár ({{ selectedContacts.length }})
                    </button>
                    <input v-model="customersInput" type="text" class="form-control" placeholder="Ručné emaily (oddeľ čiarkou)...">
                </div>
                <small class="text-muted" v-if="selectedContacts.length > 0">
                    + vybraných {{ selectedContacts.length }} kontaktov z adresára.
                </small>
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
                <div style="max-height: 150px; overflow-y: auto; border: 1px solid #eee;">
                    <table class="table table-sm table-hover mb-0" style="font-size:0.9em;">
                        <tbody>
                            <tr v-for="c in savedContacts" :key="c.id">
                                <td style="width:30px">
                                    <input type="checkbox" :value="c.id" v-model="selectedContacts">
                                </td>
                                <td>{{ c.name }}</td>
                                <td>{{ c.email }}</td>
                                <td class="text-end">
                                    <button @click="deleteContact(c.id)" class="btn btn-xs text-danger border-0">x</button>
                                </td>
                            </tr>
                            <tr v-if="savedContacts.length === 0"><td colspan="4" class="text-center text-muted">Prázdny adresár</td></tr>
                        </tbody>
                    </table>
                </div>
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
                    <th style="width:110px">AKCIOVÁ CENA</th>
                    <th style="width:110px">BEŽNÁ CENA</th>
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
            <button v-if="currentId" @click="sendStoredPricelist(currentId, pricelistName)" class="btn btn-success btn-lg me-2" :disabled="isLoading">
                📧 Odoslať teraz
            </button>
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