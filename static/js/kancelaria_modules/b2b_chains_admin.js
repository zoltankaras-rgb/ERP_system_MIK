const B2BChainsAdmin = {
    template: `
    <div class="chains-admin-container">
        <h2>Správa Reťazcov a EDI (COOP)</h2>
        
        <div class="form-group" style="margin-bottom: 20px; display: flex; align-items: flex-end; gap: 10px;">
            <div>
                <label><strong>Vyberte Reťazec (Centrálu):</strong></label>
                <select v-model="selectedChainId" @change="loadChainData" class="form-control" style="min-width: 300px;">
                    <option value="">-- Vyberte --</option>
                    <option v-for="chain in chains" :key="chain.id" :value="chain.id">
                        {{ chain.nazov_firmy }} ({{ chain.zakaznik_id || 'Bez ID' }})
                    </option>
                </select>
            </div>
            <button @click="showCreateChain = !showCreateChain" class="btn btn-outline-secondary">
                <i class="fas fa-plus"></i> Nová Centrála
            </button>
        </div>

        <div v-if="showCreateChain" style="margin-bottom: 20px; padding: 15px; border: 1px dashed #b91c1c; background: #fffcfc; display: flex; gap: 10px; align-items: end; border-radius: 6px;">
            <div>
                <label>Názov (napr. COOP Jednota Galanta)</label>
                <input type="text" v-model="newChain.nazov_firmy" class="form-control" placeholder="Zadajte názov...">
            </div>
            <div>
                <label>Interné ERP ID</label>
                <input type="text" v-model="newChain.zakaznik_id" class="form-control" placeholder="Napr. 257400">
            </div>
            <button @click="createChain" class="btn btn-success" :disabled="isCreatingChain">
                {{ isCreatingChain ? 'Ukladám...' : 'Vytvoriť v ERP' }}
            </button>
            <button @click="showCreateChain = false" class="btn btn-secondary">Zrušiť</button>
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
                            <td>
                                <input type="text" v-model="b.cislo_prevadzky" class="form-control form-control-sm" style="width: 80px;" title="Číslo PJ">
                            </td>
                            <td>
                                <input type="text" v-model="b.nazov_firmy" class="form-control form-control-sm mb-1" placeholder="Názov pobočky">
                                <input type="text" v-model="b.adresa_dorucenia" class="form-control form-control-sm" placeholder="Ulica, PSČ Mesto">
                            </td>
                            <td><input type="text" v-model="b.edi_kod" class="form-control form-control-sm"></td>
                            <td><input type="text" v-model="b.zakaznik_id" class="form-control form-control-sm" placeholder="Zadajte ID..."></td>
                            <td>
                                <input type="text" v-model="b.telefon" class="form-control form-control-sm mb-1" placeholder="Mobil">
                                <input type="text" v-model="b.email" class="form-control form-control-sm" placeholder="Email">
                            </td>
                            <td class="text-center align-middle">
                                <button @click="saveBranch($event, b)" class="btn btn-success btn-sm" style="min-width: 85px;">
                                    <i class="fas fa-save"></i> Uložiť
                                </button>
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
            showCreateChain: false,
            newChain: { nazov_firmy: '', zakaznik_id: '' },
            isCreatingChain: false,
            activeTab: 'branches',
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
        async createChain() {
            if (!this.newChain.nazov_firmy || !this.newChain.zakaznik_id) {
                alert("Názov a ID sú povinné.");
                return;
            }
            this.isCreatingChain = true;
            try {
                const res = await fetch('/api/chains/create_parent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.newChain)
                });
                const data = await res.json();
                if (data.error) {
                    alert(data.error);
                } else {
                    alert(data.message);
                    this.newChain = { nazov_firmy: '', zakaznik_id: '' };
                    this.showCreateChain = false;
                    this.loadChains();
                }
            } catch (e) {
                alert("Chyba pri vytváraní centrály.");
            } finally {
                this.isCreatingChain = false;
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
        async saveBranch(event, branch) {
            // Zachytenie tlačidla do pamäte EŠTE PRED spustením await (server requestu)
            const btn = event.currentTarget;
            const originalHtml = btn.innerHTML;

            try {
                const res = await fetch(`/api/chains/branch/${branch.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        zakaznik_id: branch.zakaznik_id,
                        edi_kod: branch.edi_kod,
                        telefon: branch.telefon,
                        email: branch.email,
                        cislo_prevadzky: branch.cislo_prevadzky,
                        nazov_firmy: branch.nazov_firmy,
                        adresa_dorucenia: branch.adresa_dorucenia
                    })
                });
                const result = await res.json();
                
                if (result.error) {
                    alert(result.error);
                } else {
                    // Vizuálne potvrdenie na uloženom objekte
                    btn.innerHTML = '<i class="fas fa-check"></i> OK';
                    btn.classList.replace('btn-success', 'btn-outline-success');
                    setTimeout(() => {
                        btn.innerHTML = originalHtml;
                        btn.classList.replace('btn-outline-success', 'btn-success');
                    }, 1500);
                }
            } catch (e) {
                alert("Systémová chyba: " + e.message);
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
                    this.loadBranches();
                    fileInput.value = ""; 
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
                    fileInput.value = ""; 
                }
            } catch (e) {
                alert("Kritická chyba pri nahrávaní EDI objednávok.");
            } finally {
                this.isImportingOrders = false;
            }
        }
    }
};