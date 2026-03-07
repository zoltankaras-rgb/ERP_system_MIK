const B2BChainsAdmin = {
    template: `
    <div class="chains-admin-container">
        <h2>Správa Reťazcov a EDI (COOP)</h2>
        
        <div class="form-group" style="margin-bottom: 20px;">
            <label><strong>Vyberte Reťazec (Centrálu):</strong></label>
            <select v-model="selectedChainId" @change="loadChainData" class="form-control" style="max-width: 400px;">
                <option value="">-- Vyberte --</option>
                <option v-for="chain in chains" :key="chain.id" :value="chain.id">
                    {{ chain.nazov_firmy }} ({{ chain.zakaznik_id || 'Bez ID' }})
                </option>
            </select>
        </div>

        <div v-if="selectedChainId">
            <ul class="nav nav-tabs" style="margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-left: 0; list-style: none; display: flex; gap: 10px;">
                <li style="cursor: pointer; padding: 10px 20px; border: 1px solid #ccc; border-bottom: none; background: #f9f9f9;" 
                    :style="activeTab === 'branches' ? 'background: #fff; font-weight: bold; border-bottom: 2px solid white; margin-bottom: -1px;' : ''"
                    @click="activeTab = 'branches'">Prevádzky</li>
                <li style="cursor: pointer; padding: 10px 20px; border: 1px solid #ccc; border-bottom: none; background: #f9f9f9;"
                    :style="activeTab === 'mapping' ? 'background: #fff; font-weight: bold; border-bottom: 2px solid white; margin-bottom: -1px;' : ''"
                    @click="activeTab = 'mapping'">EDI Mapovanie</li>
                <li style="cursor: pointer; padding: 10px 20px; border: 1px solid #ccc; border-bottom: none; background: #f9f9f9;"
                    :style="activeTab === 'reports' ? 'background: #fff; font-weight: bold; border-bottom: 2px solid white; margin-bottom: -1px;' : ''"
                    @click="activeTab = 'reports'">Report Akcií</li>
                <li style="cursor: pointer; padding: 10px 20px; border: 1px solid #ccc; border-bottom: none; background: #f9f9f9; color: #b91c1c;"
                    :style="activeTab === 'orders' ? 'background: #fff; font-weight: bold; border-bottom: 2px solid white; margin-bottom: -1px;' : ''"
                    @click="activeTab = 'orders'"><i class="fas fa-file-upload"></i> Nahrať EDI Objednávky</li>
            </ul>

            <div v-show="activeTab === 'branches'">
                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; background: #fdfdfd;">
                    <h4>Import prevádzok z CSV</h4>
                    <input type="file" ref="csvFile" accept=".csv" />
                    <button @click="importCsv" class="btn btn-primary" :disabled="isImporting">
                        {{ isImporting ? 'Importujem...' : 'Nahrať a spracovať CSV' }}
                    </button>
                </div>

                <table class="table table-bordered">
                    <thead class="table-dark">
                        <tr>
                            <th>Číslo PJ</th>
                            <th>Názov a Adresa</th>
                            <th>EDI Kód (GLN)</th>
                            <th>Interné ERP ID</th>
                            <th>Kontakt</th>
                            <th>Akcia</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="b in branches" :key="b.id">
                            <td>{{ b.cislo_prevadzky }}</td>
                            <td>
                                <strong>{{ b.nazov_firmy }}</strong><br>
                                <small>{{ b.adresa_dorucenia }}</small>
                            </td>
                            <td><input type="text" v-model="b.edi_kod" class="form-control form-control-sm"></td>
                            <td><input type="text" v-model="b.zakaznik_id" class="form-control form-control-sm" placeholder="Zadajte ID..."></td>
                            <td>
                                <input type="text" v-model="b.telefon" class="form-control form-control-sm mb-1" placeholder="Mobil">
                                <input type="text" v-model="b.email" class="form-control form-control-sm" placeholder="Email">
                            </td>
                            <td>
                                <button @click="saveBranch(b)" class="btn btn-success btn-sm">Uložiť</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-show="activeTab === 'mapping'">
                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; background: #fdfdfd; display: flex; gap: 10px; align-items: end;">
                    <div>
                        <label>EAN Reťazca (z CSV)</label>
                        <input type="text" v-model="newMapping.edi_ean" class="form-control">
                    </div>
                    <div>
                        <label>Váš interný EAN</label>
                        <input type="text" v-model="newMapping.interny_ean" class="form-control">
                    </div>
                    <button @click="addMapping" class="btn btn-primary">Pridať preklad</button>
                </div>

                <table class="table table-bordered">
                    <thead class="table-dark">
                        <tr>
                            <th>EDI EAN (Zákazník)</th>
                            <th>Interný EAN (MIK)</th>
                            <th>Názov produktu v ERP</th>
                            <th>Akcia</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="m in ediMappings" :key="m.id">
                            <td>{{ m.edi_ean }}</td>
                            <td>{{ m.interny_ean }}</td>
                            <td>{{ m.nazov_vyrobku || 'Neznámy produkt!' }}</td>
                            <td><button @click="deleteMapping(m.id)" class="btn btn-danger btn-sm">Zmazať</button></td>
                        </tr>
                        <tr v-if="ediMappings.length === 0">
                            <td colspan="4" class="text-center">Zatiaľ nie je definované žiadne mapovanie.</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-show="activeTab === 'reports'">
                <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; background: #fdfdfd; display: flex; gap: 10px; align-items: end;">
                    <div>
                        <label>Dátum od (dodanie)</label>
                        <input type="date" v-model="reportParams.date_from" class="form-control">
                    </div>
                    <div>
                        <label>Dátum do (dodanie)</label>
                        <input type="date" v-model="reportParams.date_to" class="form-control">
                    </div>
                    <button @click="generateReport" class="btn btn-primary" :disabled="isGenerating">
                        {{ isGenerating ? 'Generujem...' : 'Generovať Report' }}
                    </button>
                </div>

                <div v-if="reportData">
                    <h4>Celkové tržby z akcií: {{ reportData.total_action_revenue.toFixed(2) }} €</h4>
                    <table class="table table-bordered mt-3">
                        <thead class="table-dark">
                            <tr>
                                <th>EAN</th>
                                <th>Produkt</th>
                                <th>Predané množstvo</th>
                                <th>MJ</th>
                                <th>Min. aplikovaná cena</th>
                                <th>Tržby (bez DPH)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in reportData.report" :key="r.ean">
                                <td>{{ r.ean }}</td>
                                <td>{{ r.produkt }}</td>
                                <td class="text-end"><strong>{{ r.predane_mnozstvo.toFixed(2) }}</strong></td>
                                <td>{{ r.mj }}</td>
                                <td class="text-end">{{ r.aplikovana_cena.toFixed(2) }} €</td>
                                <td class="text-end">{{ r.trzby_bez_dph.toFixed(2) }} €</td>
                            </tr>
                            <tr v-if="reportData.report.length === 0">
                                <td colspan="6" class="text-center">Za zvolené obdobie nie sú k dispozícii žiadne akciové predaje.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div v-show="activeTab === 'orders'">
                <div style="margin-bottom: 20px; padding: 20px; border: 1px solid #ddd; background: #fdfdfd; border-radius: 8px;">
                    <h4 style="color: #b91c1c;"><i class="fas fa-file-upload"></i> Manuálny testovací import z EDI (CSV)</h4>
                    <p>Dátum dodania a čísla objednávok si systém načíta priamo z vnútra súboru automaticky. Tieto objednávky sa po importe automaticky zaradia medzi bežné B2B objednávky, zobrazia sa v Slepom liste a na Dashboarde.</p>
                    
                    <div style="display: flex; gap: 15px; align-items: end; margin-top: 15px;">
                        <div>
                            <label><strong>Vyberte CSV súbor z váhy/terminálu:</strong></label>
                            <input type="file" ref="orderCsvFile" accept=".csv" class="form-control">
                        </div>
                        <button @click="importOrders" class="btn btn-success" :disabled="isImportingOrders">
                            <i class="fas fa-cogs"></i> {{ isImportingOrders ? 'Spracovávam...' : 'Nahrať Objednávky' }}
                        </button>
                    </div>
                </div>
            </div>

        </div>
    </div>
    `,
    data() {
        return {
            chains: [],
            selectedChainId: "",
            activeTab: 'branches', // Predvolená záložka
            branches: [],
            ediMappings: [],
            isImporting: false,
            isGenerating: false,
            isImportingOrders: false,
            newMapping: { edi_ean: '', interny_ean: '' },
            reportParams: { date_from: '', date_to: '' },
            reportData: null
        }
    },
    mounted() {
        this.loadChains();
        // Nastavenie default dátumov pre report (aktuálny mesiac)
        const date = new Date();
        this.reportParams.date_from = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().split('T')[0];
        this.reportParams.date_to = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];
    },
    methods: {
        async loadChains() {
            try {
                const res = await fetch('/api/chains');
                const data = await res.json();
                this.chains = data.chains || [];
            } catch (e) {
                alert("Chyba načítania reťazcov.");
            }
        },
        loadChainData() {
            if (!this.selectedChainId) return;
            this.loadBranches();
            this.loadMappings();
            this.reportData = null;
        },
        async loadBranches() {
            try {
                const res = await fetch(`/api/chains/${this.selectedChainId}/branches`);
                const data = await res.json();
                this.branches = data.branches || [];
            } catch (e) {
                alert("Chyba načítania pobočiek.");
            }
        },
        async saveBranch(branch) {
            try {
                const res = await fetch(`/api/chains/branch/${branch.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        zakaznik_id: branch.zakaznik_id,
                        edi_kod: branch.edi_kod,
                        telefon: branch.telefon,
                        email: branch.email
                    })
                });
                const result = await res.json();
                if (result.error) alert(result.error);
                else alert("Údaje pobočky uložené.");
            } catch (e) {
                alert("Chyba pri ukladaní.");
            }
        },
        async importCsv() {
            const fileInput = this.$refs.csvFile;
            if (!fileInput.files.length) {
                alert("Prosím, vyberte CSV súbor prevádzok.");
                return;
            }
            this.isImporting = true;
            const formData = new FormData();
            formData.append("file", fileInput.files[0]);

            try {
                const res = await fetch(`/api/chains/${this.selectedChainId}/import_stores`, {
                    method: 'POST',
                    body: formData
                });
                const result = await res.json();
                if (result.error) alert(result.error);
                else {
                    alert(result.message);
                    this.loadBranches(); // Refresh tabuľky
                    fileInput.value = ""; // Clear input
                }
            } catch (e) {
                alert("Kritická chyba pri importe prevádzok.");
            } finally {
                this.isImporting = false;
            }
        },
        async loadMappings() {
            try {
                const res = await fetch(`/api/chains/${this.selectedChainId}/edi_mapping`);
                const data = await res.json();
                this.ediMappings = data.mapping || [];
            } catch (e) {
                alert("Chyba načítania mapovaní.");
            }
        },
        async addMapping() {
            if (!this.newMapping.edi_ean || !this.newMapping.interny_ean) {
                alert("Vyplňte oba EAN kódy."); return;
            }
            try {
                const res = await fetch(`/api/chains/${this.selectedChainId}/edi_mapping`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.newMapping)
                });
                const result = await res.json();
                if (result.error) alert(result.error);
                else {
                    this.newMapping = { edi_ean: '', interny_ean: '' };
                    this.loadMappings();
                }
            } catch (e) {
                alert("Chyba pri pridávaní.");
            }
        },
        async deleteMapping(mappingId) {
            if (!confirm("Naozaj vymazať toto mapovanie?")) return;
            try {
                await fetch(`/api/chains/edi_mapping/${mappingId}`, { method: 'DELETE' });
                this.loadMappings();
            } catch (e) {
                alert("Chyba pri mazaní.");
            }
        },
        async generateReport() {
            if (!this.reportParams.date_from || !this.reportParams.date_to) {
                alert("Zadajte rozsah dátumov."); return;
            }
            this.isGenerating = true;
            try {
                const res = await fetch(`/api/chains/action_report`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        parent_id: this.selectedChainId,
                        date_from: this.reportParams.date_from,
                        date_to: this.reportParams.date_to
                    })
                });
                const data = await res.json();
                if (data.error) alert(data.error);
                else this.reportData = data;
            } catch (e) {
                alert("Chyba pri generovaní reportu.");
            } finally {
                this.isGenerating = false;
            }
        },
        async importOrders() {
            const fileInput = this.$refs.orderCsvFile;
            if (!fileInput.files.length) {
                alert("Prosím, vyberte CSV súbor objednávok.");
                return;
            }
            
            this.isImportingOrders = true;
            const formData = new FormData();
            formData.append("file", fileInput.files[0]);

            try {
                const res = await fetch(`/api/chains/${this.selectedChainId}/import_orders`, {
                    method: 'POST',
                    body: formData
                });
                const result = await res.json();
                
                if (result.error) {
                    alert(result.error);
                } else {
                    let msg = result.message;
                    if (result.errors && result.errors.length > 0) {
                        msg += "\n\nUpozornenia (Zlyhalo párovanie):\n" + result.errors.join("\n");
                    }
                    alert(msg);
                    fileInput.value = ""; // Vyčistenie inputu
                }
            } catch (e) {
                alert("Kritická chyba pri nahrávaní EDI objednávok.");
            } finally {
                this.isImportingOrders = false;
            }
        }
    }
};