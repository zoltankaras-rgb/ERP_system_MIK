// static/js/kancelaria_modules/pricelist_manager.js

const PricelistManager = {
    data() {
        return {
            customersInput: '', 
            pricelistItems: [], // Tu sa budú ukladať vybrané produkty
            isLoading: false
        }
    },
    mounted() {
        // TOTO JE TÁ BRÁNA - sprístupníme funkciu pre erp_admin.js
        window.addToPricelist = (product) => {
            // Skontrolujeme, či už v zozname nie je
            const exists = this.pricelistItems.find(p => p.ean === product.ean);
            if (exists) {
                alert(`Produkt "${product.nazov_vyrobku}" už je v cenníku pridaný.`);
                return;
            }

            // Pridáme do zoznamu
            this.pricelistItems.push({
                ean: product.ean,
                name: product.nazov_vyrobku,
                old_price: 0,      // Cena sa z katalógu neťahá (nie je tam), musíš ju zadať ručne alebo doniesť z iného API
                price: 0,          // Nová cena
                is_action: false
            });

            // Ukážeme hlášku (alebo len ticho pridáme)
            // alert(`Pridané: ${product.nazov_vyrobku}`);
            
            // Prepneme užívateľa do sekcie cenníkov (voliteľné)
            // document.querySelector('[data-section="section-pricelists"]').click();
        };
    },
    methods: {
        remove(index) {
            this.pricelistItems.splice(index, 1);
        },
        async sendPricelist() {
            if (!this.customersInput) {
                alert("Zadajte e-mail zákazníka!");
                return;
            }
            if (this.pricelistItems.length === 0) {
                alert("Cenník je prázdny!");
                return;
            }

            this.isLoading = true;
            const emailList = this.customersInput.split(',').map(e => e.trim());
            const customers = emailList.map(email => ({ email: email, name: 'Partner' }));

            const payload = {
                customers: customers,
                items: this.pricelistItems,
                valid_from: new Date().toLocaleDateString('sk-SK')
            };

            try {
                const response = await fetch('/api/send_custom_pricelist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                alert(result.message);
            } catch (error) {
                console.error(error);
                alert("Chyba spojenia so serverom.");
            } finally {
                this.isLoading = false;
            }
        }
    },
    template: `
    <div class="card p-4">
        <h3>⚡ Tvorba Cenníka (Položky pridávaj z ERP Katalógu)</h3>
        
        <div class="mb-3">
            <label>Zákazníci (E-maily):</label>
            <input v-model="customersInput" type="text" class="form-control" placeholder="klient@firma.sk">
        </div>

        <div v-if="pricelistItems.length === 0" class="alert alert-info">
            Zatiaľ si nepridal žiadne produkty. Choď do <b>Správa ERP -> Katalóg</b> a klikni na "Pridať do cenníka".
        </div>

        <table v-else class="table table-bordered">
            <thead>
                <tr>
                    <th>Produkt</th>
                    <th>Bežná cena</th>
                    <th>Nová cena</th>
                    <th>Akcia</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(item, index) in pricelistItems" :key="item.ean" :class="{'table-warning': item.is_action}">
                    <td>{{ item.name }}</td>
                    <td><input type="number" v-model="item.old_price" class="form-control form-control-sm" step="0.01"></td>
                    <td><input type="number" v-model="item.price" class="form-control form-control-sm" step="0.01"></td>
                    <td class="text-center"><input type="checkbox" v-model="item.is_action"></td>
                    <td><button @click="remove(index)" class="btn btn-danger btn-sm">X</button></td>
                </tr>
            </tbody>
        </table>

        <div class="text-end mt-2" v-if="pricelistItems.length > 0">
            <button @click="sendPricelist" :disabled="isLoading" class="btn btn-success">
                {{ isLoading ? 'Odosielam...' : 'Odoslať Cenník' }}
            </button>
        </div>
    </div>
    `
};