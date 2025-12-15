// static/js/kancelaria_modules/pricelist_manager.js

const PricelistManager = {
    data() {
        return {
            customersInput: '', // Sem user napíše maily oddelené čiarkou
            products: [], // Načítané produkty z DB
            pricelistItems: [], // Položky cenníka
            isLoading: false
        }
    },
    methods: {
        // 1. Načítanie základných produktov pri štarte
        async loadProducts() {
            // Predpokladám endpoint na získanie produktov
            const response = await fetch('/api/products'); 
            const data = await response.json();
            
            // Namapujeme produkty do formátu pre cenník
            this.pricelistItems = data.map(prod => ({
                id: prod.id,
                name: prod.name,
                old_price: prod.price, // Aktuálna cena v systéme
                price: prod.price,     // Cena v novom cenníku (zatiaľ rovnaká)
                is_action: false,
                is_changed: false
            }));
        },

        // 2. Automatické označovanie zmien
        updateStatus(item) {
            // Porovnanie
            if (parseFloat(item.price) !== parseFloat(item.old_price)) {
                item.is_changed = true;
            } else {
                item.is_changed = false;
            }
        },

        // 3. Odoslanie na Backend
        async sendPricelist() {
            if (!this.customersInput) {
                alert("Zadajte aspoň jeden e-mail!");
                return;
            }

            this.isLoading = true;

            // Spracovanie emailov (napr. "test@test.sk, firma@firma.sk")
            const emailList = this.customersInput.split(',').map(e => e.trim());
            const customers = emailList.map(email => ({ email: email, name: 'Partner' })); // Name by sa dalo ťahať z DB

            // Filtrujeme len položky, ktoré chceme poslať (napríklad všetko alebo len zmenené?)
            // V tomto prípade posielame celý cenník
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
                if (result.status === 'success') {
                    alert("Cenníky boli úspešne odoslané! 🚀");
                } else {
                    alert("Chyba: " + result.message);
                }
            } catch (error) {
                console.error(error);
                alert("Chyba komunikácie so serverom.");
            } finally {
                this.isLoading = false;
            }
        }
    },
    template: `
    <div class="card p-4">
        <h3>⚡ Generátor Veľkoobchodného Cenníka</h3>
        
        <div class="mb-3">
            <label>Zákazníci (E-maily oddelené čiarkou):</label>
            <input v-model="customersInput" type="text" class="form-control" placeholder="jan@mäsiarstvo.sk, hotel@tatry.sk">
        </div>

        <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
            <table class="table table-bordered table-hover">
                <thead class="sticky-top bg-light">
                    <tr>
                        <th>Produkt</th>
                        <th>Bežná cena (€)</th>
                        <th>Cena v cenníku (€)</th>
                        <th>Akcia?</th>
                        <th>Stav</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in pricelistItems" :key="item.id" 
                        :class="{'table-warning': item.is_action, 'table-success': item.price < item.old_price, 'table-danger': item.price > item.old_price}">
                        
                        <td>{{ item.name }}</td>
                        <td>{{ item.old_price }}</td>
                        
                        <td>
                            <input type="number" step="0.01" v-model="item.price" @input="updateStatus(item)" class="form-control form-control-sm">
                        </td>
                        
                        <td class="text-center">
                            <input type="checkbox" v-model="item.is_action" class="form-check-input">
                        </td>

                        <td>
                            <span v-if="item.is_action" class="badge bg-warning text-dark">AKCIA</span>
                            <span v-else-if="item.price < item.old_price" class="badge bg-success">ZLACNENIE</span>
                            <span v-else-if="item.price > item.old_price" class="badge bg-danger">ZDRAŽENIE</span>
                            <span v-else class="text-muted">-</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="mt-3 text-end">
            <button @click="sendPricelist" :disabled="isLoading" class="btn btn-primary btn-lg">
                <span v-if="isLoading">Odosielam... ⏳</span>
                <span v-else>📤 Vygenerovať PDF a Odoslať</span>
            </button>
        </div>
    </div>
    `
};