// hr.js – HR & dochádzka modul (Kancelária) - MODERN UI s generátorom oficiálnej dochádzky a formátovaním času

(function () {
  // Pomocná funkcia na prepočet desatinných hodín na "X hod Y min"
  function formatHM(decimalHours) {
      if (!decimalHours || decimalHours <= 0) return "0 hod 0 min";
      let h = Math.floor(decimalHours);
      let m = Math.round((decimalHours - h) * 60);
      if (m === 60) {
          h += 1;
          m = 0;
      }
      return `${h} hod ${m} min`;
  }

  const api = {
    async get(url) {
      const res = await fetch(url, { credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Chyba servera");
      return data;
    },
    async post(url, payload) {
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Chyba servera");
      return data;
    },
  };

  const HR = {
    employees: [],
    currentAttendanceData: [],
    currentOfficialData: [],
    currentOfficialMeta: {},
    dom: {},

    init() {
      this.dom.section = document.getElementById("section-hr");
      if (!this.dom.section) return;

      if (!this.dom.section.hasChildNodes()) {
        this.renderLayout();
      }

      this.cacheDom();
      this.bindTabs();
      this.bindEmployeeForm();
      this.bindAttendanceForm();
      this.bindLeaveForm();
      this.bindSummary();
      this.bindOfficialTemplate();

      this.initDefaultDates();
      this.switchTab('employees');

      this.loadEmployees()
        .then(() => {
          this.loadLeaves();
          this.loadSummary();
        })
        .catch(console.error);
    },

    // ------------------------------------------------------------------
    // VYLEPŠENÝ LAYOUT
    // ------------------------------------------------------------------
    renderLayout() {
      this.dom.section.innerHTML = `
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; padding: 25px; color: white; margin-bottom: 25px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                <div>
                    <h2 style="margin: 0 0 5px 0; color: #f8fafc; font-size: 1.8rem;"><i class="fas fa-id-badge" style="color: #38bdf8; margin-right: 10px;"></i>Ľudské zdroje a Dochádzka</h2>
                    <p style="margin: 0; color: #94a3b8; font-size: 1rem;">Komplexná správa zamestnancov, dochádzkového terminálu a výpočtu ceny práce.</p>
                </div>
            </div>
            
            <div class="hr-tab-nav" style="display:flex; gap: 10px; flex-wrap:wrap; margin-top: 25px;">
              <button class="btn hr-tab-btn" data-hr-tab="employees" style="border-radius: 8px; font-weight: 600; padding: 10px 20px;">
                <i class="fas fa-users"></i> Zamestnanci
              </button>
              <button class="btn hr-tab-btn" data-hr-tab="attendance" style="border-radius: 8px; font-weight: 600; padding: 10px 20px;">
                <i class="fas fa-user-clock"></i> Píchačky (Reálna)
              </button>
              <button class="btn hr-tab-btn" data-hr-tab="leaves" style="border-radius: 8px; font-weight: 600; padding: 10px 20px;">
                <i class="fas fa-umbrella-beach"></i> Neprítomnosti
              </button>
              <button class="btn hr-tab-btn" data-hr-tab="summary" style="border-radius: 8px; font-weight: 600; padding: 10px 20px;">
                <i class="fas fa-chart-pie"></i> Súhrn nákladov
              </button>
              <button class="btn hr-tab-btn" data-hr-tab="official" style="border-radius: 8px; font-weight: 600; padding: 10px 20px; background: #6366f1; color: white; border:none;">
                <i class="fas fa-file-signature"></i> Oficiálny Výkaz (Pre Úrady)
              </button>
            </div>
        </div>

        <div class="hr-tabs">

          <section id="hr-tab-employees" class="hr-tab" data-hr-panel="employees" style="display:none;">
            <div style="display:flex; flex-wrap:wrap; gap:25px;">
                
                <div style="flex:0 0 350px; background: #fff; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); align-self: flex-start;">
                    <h4 style="margin-top: 0; color: #0f172a; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">Vytvoriť / Upraviť profil</h4>
                    <form id="hr-employee-form">
                        <input type="hidden" id="hr-employee-id" />

                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600; color: #475569;">Meno a priezvisko</label>
                        <input type="text" id="hr-employee-name" class="filter-input" style="width: 100%;" required />
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div class="form-group">
                                <label style="font-weight: 600; color: #475569;">PIN do terminálu</label>
                                <input type="text" id="hr-employee-punch" class="filter-input" style="width: 100%; font-size: 1.2rem; font-weight: bold; letter-spacing: 2px; text-align: center;" placeholder="Napr. 4053" />
                            </div>
                            <div class="form-group">
                                <label style="font-weight: 600; color: #475569;">Sekcia</label>
                                <select id="hr-employee-section" class="filter-input" style="width: 100%;">
                                  <option value="VYROBA">Výroba</option>
                                  <option value="ROZRABKA">Rozrábka</option>
                                  <option value="EXPEDICIA">Expedícia</option>
                                  <option value="ROZVOZ">Rozvoz</option>
                                  <option value="UPRATOVANIE">Upratovanie</option>
                                  <option value="ADMIN">Admin</option>
                                  <option value="INE">Iné</option>
                                </select>
                            </div>
                        </div>
                        
                        <div style="display: none;"><input type="text" id="hr-employee-code" /></div>

                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 20px 0;">
                            <label style="font-weight: 600; color: #0369a1; display: block; margin-bottom: 10px;"><i class="fas fa-coins"></i> Platové podmienky</label>
                            
                            <div class="form-group" style="margin-bottom: 15px;">
                                <label>Fixná mesačná mzda (€)</label>
                                <input type="number" step="0.01" id="hr-employee-salary" class="filter-input" style="width: 100%; font-weight: bold; color: #166534;" />
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                <div class="form-group">
                                    <label>Norma hodín</label>
                                    <input type="number" step="0.01" id="hr-employee-base-hours" class="filter-input" style="width: 100%;" value="168" />
                                </div>
                                <div class="form-group">
                                    <label>Nárok Dovolenka</label>
                                    <input type="number" step="0.5" id="hr-employee-vacation-total" class="filter-input" style="width: 100%;" />
                                </div>
                            </div>
                        </div>

                        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                            <input type="checkbox" id="hr-employee-active" checked style="transform: scale(1.3); cursor: pointer;" />
                            <label for="hr-employee-active" style="margin: 0; font-weight: 600; cursor: pointer;">Zamestnanec je aktívny</label>
                        </div>

                        <div style="display:flex; gap:10px;">
                        <button type="submit" class="btn btn-primary" style="flex: 1; padding: 10px; font-weight: bold;">💾 Uložiť</button>
                        <button type="button" id="hr-employee-reset" class="btn btn-secondary" style="padding: 10px;"><i class="fas fa-redo"></i></button>
                        </div>
                    </form>
                </div>

                <div style="flex:1; min-width: 500px;">
                    <div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: hidden;">
                        <table class="table-refined" id="hr-employees-table" style="margin: 0; width: 100%;">
                        <thead style="background: #f8fafc;">
                            <tr>
                            <th style="padding: 15px;">Zamestnanec</th>
                            <th>PIN</th>
                            <th>Fixná Mzda</th>
                            <th>Dovolenka (Nárok/Zostatok)</th>
                            <th>Stav</th>
                            <th style="text-align: right; padding-right: 15px;">Akcie</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
          </section>

          <section id="hr-tab-attendance" class="hr-tab" data-hr-panel="attendance" style="display:none;">
            <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 25px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:flex-end;">
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Od</label><br />
                    <input type="date" id="hr-att-date-from" class="filter-input" />
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Do</label><br />
                    <input type="date" id="hr-att-date-to" class="filter-input" />
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Úsek</label><br />
                    <select id="hr-att-section-filter" class="filter-input" style="min-width:140px;">
                      <option value="">Všetky</option>
                      <option value="VYROBA">Výroba</option>
                      <option value="ROZRABKA">Rozrábka</option>
                      <option value="EXPEDICIA">Expedícia</option>
                      <option value="ROZVOZ">Rozvoz</option>
                      <option value="UPRATOVANIE">Upratovanie</option>
                      <option value="ADMIN">Admin</option>
                      <option value="INE">Iné</option>
                    </select>
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Zamestnanec</label><br />
                    <select id="hr-att-employee-filter" class="filter-input" style="min-width:200px;"></select>
                  </div>
                  <div>
                    <button type="button" id="hr-att-filter-btn" class="btn btn-primary" style="padding: 8px 20px;"><i class="fas fa-search"></i> Zobraziť</button>
                    <button type="button" id="hr-att-print-btn" class="btn btn-secondary" style="padding: 8px 20px; margin-left: 10px; background: #475569;"><i class="fas fa-print"></i> Tlačiť report</button>
                  </div>
                </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:25px;">
                <div style="flex:0 0 320px; background: #f0fdf4; padding: 25px; border-radius: 12px; border: 1px solid #bbf7d0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); align-self: flex-start;">
                    <h4 style="margin-top: 0; color: #166534; border-bottom: 2px solid #dcfce7; padding-bottom: 10px;"><i class="fas fa-clock"></i> Manuálna úprava pichnutia</h4>
                    <form id="hr-att-form">
                        <input type="hidden" id="hr-att-id" />
                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600;">Zamestnanec</label>
                        <select id="hr-att-employee" class="filter-input" style="width: 100%;"></select>
                        </div>
                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600;">Dátum</label>
                        <input type="date" id="hr-att-date" class="filter-input" style="width: 100%;" required />
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                            <div class="form-group">
                                <label style="font-weight: 600; color: #0284c7;">Príchod</label>
                                <input type="time" id="hr-att-time-in" class="filter-input" style="width: 100%;" />
                            </div>
                            <div class="form-group">
                                <label style="font-weight: 600; color: #dc2626;">Odchod</label>
                                <input type="time" id="hr-att-time-out" class="filter-input" style="width: 100%;" />
                            </div>
                        </div>
                        <div class="form-group" style="display:none;">
                        <select id="hr-att-section-override"><option value=""></option></select>
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                        <label style="font-weight: 600;">Dôvod manuálnej úpravy</label>
                        <input type="text" id="hr-att-note" class="filter-input" style="width: 100%;" placeholder="Napr. Zabudol pípnuť..." />
                        </div>
                        <div style="display:flex; gap:10px;">
                        <button type="submit" class="btn btn-success" style="flex: 1; font-weight: bold;">Uložiť záznam</button>
                        <button type="button" id="hr-att-reset" class="btn btn-secondary"><i class="fas fa-times"></i></button>
                        </div>
                    </form>
                </div>

                <div style="flex:1; min-width: 500px;">
                    <div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <table class="table-refined" id="hr-att-table" style="margin: 0; width: 100%;">
                        <thead style="background: #f8fafc;">
                            <tr>
                            <th style="padding: 15px;">Dátum</th>
                            <th>Meno</th>
                            <th>Úsek</th>
                            <th>Príchod</th>
                            <th>Odchod</th>
                            <th>Čisté Hodiny</th>
                            <th>Poznámka</th>
                            <th style="text-align: right; padding-right: 15px;">Akcie</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
          </section>

          <section id="hr-tab-leaves" class="hr-tab" data-hr-panel="leaves" style="display:none;">
            <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 25px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; flex-wrap:wrap; gap:15px; align-items:flex-end;">
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Od dátumu</label><br />
                    <input type="date" id="hr-leave-from" class="filter-input" />
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Do dátumu</label><br />
                    <input type="date" id="hr-leave-to" class="filter-input" />
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Zamestnanec</label><br />
                    <select id="hr-leave-employee-filter" class="filter-input" style="min-width:200px;"></select>
                  </div>
                  <div>
                    <button type="button" id="hr-leave-filter-btn" class="btn btn-primary" style="padding: 8px 20px;"><i class="fas fa-search"></i> Zobraziť</button>
                  </div>
                </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:25px;">
                <div style="flex:0 0 320px; background: #fff7ed; padding: 25px; border-radius: 12px; border: 1px solid #fed7aa; box-shadow: 0 1px 3px rgba(0,0,0,0.05); align-self: flex-start;">
                    <h4 style="margin-top: 0; color: #9a3412; border-bottom: 2px solid #ffedd5; padding-bottom: 10px;"><i class="fas fa-plane"></i> Zadať neprítomnosť</h4>
                    <form id="hr-leave-form">
                        <input type="hidden" id="hr-leave-id" />
                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600;">Zamestnanec</label>
                        <select id="hr-leave-employee" class="filter-input" style="width: 100%;"></select>
                        </div>
                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600;">Typ neprítomnosti</label>
                        <select id="hr-leave-type" class="filter-input" style="width: 100%; font-weight: bold;">
                            <option value="VACATION">🏖️ Dovolenka</option>
                            <option value="SICK">🤒 PN / OČR</option>
                            <option value="PASS">🏥 Lekár (Priepustka)</option>
                            <option value="OTHER">⚪ Iné neplatené</option>
                        </select>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                            <div class="form-group">
                                <label style="font-weight: 600;">Od dňa</label>
                                <input type="date" id="hr-leave-from-date" class="filter-input" style="width: 100%;" required />
                            </div>
                            <div class="form-group">
                                <label style="font-weight: 600;">Do dňa</label>
                                <input type="date" id="hr-leave-to-date" class="filter-input" style="width: 100%;" required />
                            </div>
                        </div>
                        <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                            <input type="checkbox" id="hr-leave-full-day" checked style="transform: scale(1.3); cursor: pointer;" />
                            <label for="hr-leave-full-day" style="margin: 0; font-weight: 600; cursor: pointer;">Ide o celé dni</label>
                        </div>
                        <div class="form-group" style="margin-bottom: 15px;">
                        <label style="font-weight: 600;">Vybrať si len zopár hodín?</label>
                        <input type="number" step="0.5" id="hr-leave-hours" class="filter-input" style="width: 100%;" placeholder="Zadaj iba ak NEjde o celé dni" />
                        </div>
                        <div class="form-group" style="margin-bottom: 20px;">
                        <label style="font-weight: 600;">Poznámka pre mzdárku</label>
                        <input type="text" id="hr-leave-note" class="filter-input" style="width: 100%;" />
                        </div>
                        <div style="display:flex; gap:10px;">
                        <button type="submit" class="btn btn-warning" style="flex: 1; font-weight: bold; color: #000;">Uložiť do systému</button>
                        <button type="button" id="hr-leave-reset" class="btn btn-secondary"><i class="fas fa-times"></i></button>
                        </div>
                    </form>
                </div>

                <div style="flex:1; min-width: 500px;">
                    <div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                        <table class="table-refined" id="hr-leave-table" style="margin: 0; width: 100%;">
                        <thead style="background: #f8fafc;">
                            <tr>
                            <th style="padding: 15px;">Termín</th>
                            <th>Zamestnanec</th>
                            <th>Typ</th>
                            <th>Odčerpané dni</th>
                            <th>Poznámka</th>
                            <th style="text-align: right; padding-right: 15px;">Akcie</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                        </table>
                    </div>
                </div>
            </div>
          </section>

          <section id="hr-tab-summary" class="hr-tab" data-hr-panel="summary" style="display:none;">
            <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 25px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
                <div style="display:flex; gap:15px; align-items:flex-end;">
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Analýza od</label><br />
                    <input type="date" id="hr-sum-from" class="filter-input" />
                  </div>
                  <div>
                    <label style="font-weight: 600; font-size: 0.9rem;">Analýza do</label><br />
                    <input type="date" id="hr-sum-to" class="filter-input" />
                  </div>
                  <div>
                    <button type="button" id="hr-sum-refresh" class="btn btn-primary" style="padding: 8px 20px;"><i class="fas fa-sync"></i> Prepočítať náklady</button>
                  </div>
                </div>
                <div id="hr-sum-period-text" style="color: #64748b; font-weight: 600;"></div>
            </div>

            <div id="hr-sum-totals" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px;">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 25px;">
                <div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); align-self: flex-start;">
                    <h4 style="margin: 0; padding: 15px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #0f172a;"><i class="fas fa-building" style="color:#64748b; margin-right:8px;"></i> Náklady podľa sekcie</h4>
                    <table class="table-refined" id="hr-sum-sections-table" style="margin: 0; width: 100%;">
                    <thead>
                        <tr>
                        <th style="padding-left: 15px;">Sekcia</th>
                        <th>Hodiny</th>
                        <th>Cena Práce</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                    </table>
                </div>

                <div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <h4 style="margin: 0; padding: 15px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #0f172a;"><i class="fas fa-user-tie" style="color:#64748b; margin-right:8px;"></i> Presný rozpis na zamestnanca</h4>
                    <table class="table-refined" id="hr-sum-employees-table" style="margin: 0; width: 100%;">
                    <thead>
                        <tr>
                        <th style="padding-left: 15px;">Zamestnanec</th>
                        <th>Sekcia</th>
                        <th>Hodiny (Desatinné)</th>
                        <th>€/hod (z fixu)</th>
                        <th>Celkom €</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                    </table>
                </div>
            </div>
          </section>

          <section id="hr-tab-official" class="hr-tab" data-hr-panel="official" style="display:none;">
            <div style="background: #eef2ff; padding: 25px; border-radius: 12px; border: 1px solid #c7d2fe; margin-bottom: 25px;">
               <h4 style="margin-top: 0; color: #3730a3;"><i class="fas fa-magic"></i> Šablóna Oficialnej Dochádzky (Pre Mzdárku)</h4>
               <p style="color: #4f46e5; margin-bottom: 0;">Tento nástroj vygeneruje ideálnu tabuľkovú dochádzky zamestnanca na vybraný mesiac s predvolenými príchodmi/odchodmi. 
               Automaticky vynechá víkendy a automaticky na príslušné dni doplní riadne zapísané dovolenky/PN z karty "Neprítomnosti". Všetko funguje bez zásahu do reálnych hodín.</p>
               
               <div style="display:flex; gap:15px; flex-wrap:wrap; margin-top: 20px;">
                 <div class="form-group">
                   <label style="font-weight: bold; color: #3730a3;">Zamestnanec</label>
                   <select id="hr-off-employee" class="filter-input" style="min-width:220px;"></select>
                 </div>
                 <div class="form-group">
                   <label style="font-weight: bold; color: #3730a3;">Mesiac</label>
                   <input type="month" id="hr-off-month" class="filter-input" />
                 </div>
                 <div class="form-group">
                   <label style="font-weight: bold; color: #3730a3;">Fixný Príchod</label>
                   <input type="time" id="hr-off-time-in" class="filter-input" value="06:00" />
                 </div>
                 <div class="form-group">
                   <label style="font-weight: bold; color: #3730a3;">Fixný Odchod</label>
                   <input type="time" id="hr-off-time-out" class="filter-input" value="14:30" />
                 </div>
                 <div class="form-group" style="align-self: flex-end;">
                   <button type="button" id="hr-off-generate" class="btn btn-primary" style="background: #4f46e5; border-color: #4f46e5;"><i class="fas fa-cogs"></i> Generovať pre Mzdárku</button>
                   <button type="button" id="hr-off-print" class="btn btn-secondary" style="margin-left:10px; display:none; background: #312e81;"><i class="fas fa-print"></i> Vytlačiť Výkaz</button>
                 </div>
               </div>
            </div>
            
            <div id="hr-off-preview" style="background: #fff; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; display:none; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
               </div>
          </section>

        </div>
      `;
    },

    // ------------------------------------------------------------------
    // TABY
    // ------------------------------------------------------------------
    bindTabs() {
      this.dom.tabButtons = this.dom.section.querySelectorAll(".hr-tab-btn");
      this.dom.tabPanels = this.dom.section.querySelectorAll(".hr-tab");

      this.dom.tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.getAttribute("data-hr-tab");
          this.switchTab(tab);
        });
      });
    },

    switchTab(tabName) {
      this.dom.tabPanels.forEach(panel => {
        const name = panel.getAttribute('data-hr-panel');
        panel.style.display = (name === tabName) ? 'block' : 'none';
      });

      this.dom.tabButtons.forEach(btn => {
        const name = btn.getAttribute('data-hr-tab');
        if (name === tabName) {
          if (name === 'official') {
              btn.style.background = '#4f46e5';
              btn.style.color = '#fff';
          } else {
              btn.classList.remove('btn-secondary');
              btn.classList.add('btn-primary');
          }
          btn.style.boxShadow = '0 4px 6px -1px rgba(59, 130, 246, 0.3)';
        } else {
          if (name === 'official') {
             btn.style.background = '#6366f1';
             btn.style.color = '#fff';
             btn.style.boxShadow = 'none';
          } else {
              btn.classList.add('btn-secondary');
              btn.classList.remove('btn-primary');
              btn.style.boxShadow = 'none';
          }
        }
      });

      if (tabName === 'attendance') this.loadAttendance().catch(console.error);
      else if (tabName === 'leaves') this.loadLeaves().catch(console.error);
      else if (tabName === 'summary') this.loadSummary().catch(console.error);
    },

    // ------------------------------------------------------------------
    // CACHE DOM
    // ------------------------------------------------------------------
    cacheDom() {
      this.dom.empForm = document.getElementById("hr-employee-form");
      this.dom.empId = document.getElementById("hr-employee-id");
      this.dom.empName = document.getElementById("hr-employee-name");
      this.dom.empCode = document.getElementById("hr-employee-code");
      this.dom.empPunch = document.getElementById("hr-employee-punch");
      this.dom.empSection = document.getElementById("hr-employee-section");
      this.dom.empSalary = document.getElementById("hr-employee-salary");
      this.dom.empBaseHours = document.getElementById("hr-employee-base-hours");
      this.dom.empVacTotal = document.getElementById("hr-employee-vacation-total");
      this.dom.empActive = document.getElementById("hr-employee-active");
      this.dom.empReset = document.getElementById("hr-employee-reset");
      this.dom.empTableBody = document.querySelector("#hr-employees-table tbody");

      this.dom.attForm = document.getElementById("hr-att-form");
      this.dom.attId = document.getElementById("hr-att-id");
      this.dom.attEmployee = document.getElementById("hr-att-employee");
      this.dom.attDate = document.getElementById("hr-att-date");
      this.dom.attTimeIn = document.getElementById("hr-att-time-in");
      this.dom.attTimeOut = document.getElementById("hr-att-time-out");
      this.dom.attSectionOverride = document.getElementById("hr-att-section-override");
      this.dom.attNote = document.getElementById("hr-att-note");
      this.dom.attReset = document.getElementById("hr-att-reset");
      this.dom.attTableBody = document.querySelector("#hr-att-table tbody");

      this.dom.attFilterFrom = document.getElementById("hr-att-date-from");
      this.dom.attFilterTo = document.getElementById("hr-att-date-to");
      this.dom.attFilterEmployee = document.getElementById("hr-att-employee-filter");
      this.dom.attFilterSection = document.getElementById("hr-att-section-filter");
      this.dom.attFilterBtn = document.getElementById("hr-att-filter-btn");
      this.dom.attPrintBtn = document.getElementById("hr-att-print-btn");

      this.dom.leaveForm = document.getElementById("hr-leave-form");
      this.dom.leaveId = document.getElementById("hr-leave-id");
      this.dom.leaveEmployee = document.getElementById("hr-leave-employee");
      this.dom.leaveFromDate = document.getElementById("hr-leave-from-date");
      this.dom.leaveToDate = document.getElementById("hr-leave-to-date");
      this.dom.leaveType = document.getElementById("hr-leave-type");
      this.dom.leaveFullDay = document.getElementById("hr-leave-full-day");
      this.dom.leaveHours = document.getElementById("hr-leave-hours");
      this.dom.leaveNote = document.getElementById("hr-leave-note");
      this.dom.leaveReset = document.getElementById("hr-leave-reset");
      this.dom.leaveTableBody = document.querySelector("#hr-leave-table tbody");

      this.dom.leaveFilterFrom = document.getElementById("hr-leave-from");
      this.dom.leaveFilterTo = document.getElementById("hr-leave-to");
      this.dom.leaveFilterEmployee = document.getElementById("hr-leave-employee-filter");
      this.dom.leaveFilterBtn = document.getElementById("hr-leave-filter-btn");

      this.dom.sumFrom = document.getElementById("hr-sum-from");
      this.dom.sumTo = document.getElementById("hr-sum-to");
      this.dom.sumRefresh = document.getElementById("hr-sum-refresh");
      this.dom.sumTotals = document.getElementById("hr-sum-totals");
      this.dom.sumSectionsBody = document.querySelector("#hr-sum-sections-table tbody");
      this.dom.sumEmployeesBody = document.querySelector("#hr-sum-employees-table tbody");

      // OFICIALNA
      this.dom.offEmployee = document.getElementById("hr-off-employee");
      this.dom.offMonth = document.getElementById("hr-off-month");
      this.dom.offTimeIn = document.getElementById("hr-off-time-in");
      this.dom.offTimeOut = document.getElementById("hr-off-time-out");
      this.dom.offGenerateBtn = document.getElementById("hr-off-generate");
      this.dom.offPrintBtn = document.getElementById("hr-off-print");
      this.dom.offPreview = document.getElementById("hr-off-preview");
    },

    // ------------------------------------------------------------------
    // DÁTUMY
    // ------------------------------------------------------------------
    initDefaultDates() {
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const fmt = (d) => d.toISOString().slice(0, 10);

      if (this.dom.attFilterFrom) this.dom.attFilterFrom.value = fmt(first);
      if (this.dom.attFilterTo) this.dom.attFilterTo.value = fmt(today);
      if (this.dom.attDate) this.dom.attDate.value = fmt(today);

      if (this.dom.leaveFilterFrom) this.dom.leaveFilterFrom.value = fmt(first);
      if (this.dom.leaveFilterTo) this.dom.leaveFilterTo.value = fmt(today);
      if (this.dom.leaveFromDate) this.dom.leaveFromDate.value = fmt(today);
      if (this.dom.leaveToDate) this.dom.leaveToDate.value = fmt(today);

      if (this.dom.sumFrom) this.dom.sumFrom.value = fmt(first);
      if (this.dom.sumTo) this.dom.sumTo.value = fmt(today);

      if (this.dom.offMonth) {
          const mm = (today.getMonth() + 1).toString().padStart(2, '0');
          this.dom.offMonth.value = `${today.getFullYear()}-${mm}`;
      }
    },

    // ------------------------------------------------------------------
    // ZAMESTNANCI
    // ------------------------------------------------------------------
    async loadEmployees() {
      const data = await api.get("/api/kancelaria/hr/employees");
      this.employees = data.employees || [];
      this.renderEmployees();
      this.fillEmployeeSelects();
    },

    renderEmployees() {
      if (!this.dom.empTableBody) return;
      this.dom.empTableBody.innerHTML = "";

      this.employees.forEach((emp) => {
        const tr = document.createElement("tr");

        const vacTotal = parseFloat(emp.vacation_days_total || 0) || 0;
        const vacUsed = parseFloat(emp.vacation_days_used || 0) || 0;
        const vacBal = vacTotal - vacUsed;
        const salary = Number(emp.monthly_salary || 0);
        
        const badgeStatus = emp.is_active 
            ? `<span style="background:#dcfce7; color:#166534; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 0.8rem;">Aktívny</span>`
            : `<span style="background:#fee2e2; color:#991b1b; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 0.8rem;">Vyradený</span>`;
            
        const sectionBadge = `<span style="background:#e0f2fe; color:#0369a1; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight:bold;">${emp.section}</span>`;

        tr.innerHTML = `
          <td style="padding-left: 15px;">
            <strong style="color: #0f172a; font-size: 1.05rem; display:block;">${emp.full_name}</strong>
            ${sectionBadge}
          </td>
          <td><span style="font-family: monospace; font-size: 1.1rem; background: #f1f5f9; padding: 3px 8px; border-radius: 4px;">${emp.punch_code || '-'}</span></td>
          <td><strong style="color: #166534;">${salary.toFixed(2)} €</strong></td>
          <td>
            <div style="font-size: 0.9rem; color: #475569;">Nárok: <strong style="color:#0f172a;">${vacTotal.toFixed(1)}</strong> | Zostáva: <strong style="color:#2563eb;">${vacBal.toFixed(1)}</strong></div>
            <div style="width: 100%; background: #e2e8f0; height: 6px; border-radius: 3px; margin-top: 5px; overflow: hidden;">
                <div style="width: ${vacTotal > 0 ? (vacUsed/vacTotal)*100 : 0}%; background: #f59e0b; height: 100%;"></div>
            </div>
          </td>
          <td>${badgeStatus}</td>
          <td style="text-align: right; padding-right: 15px;">
            <button class="btn btn-sm btn-primary hr-emp-edit" data-id="${emp.id}" title="Upraviť"><i class="fas fa-pen"></i></button>
            <button class="btn btn-sm btn-danger hr-emp-delete" data-id="${emp.id}" title="Vymazať" style="margin-left: 5px;"><i class="fas fa-trash"></i></button>
          </td>
        `;
        this.dom.empTableBody.appendChild(tr);
      });

      this.dom.empTableBody.querySelectorAll(".hr-emp-edit").forEach(btn => btn.addEventListener("click", () => this.fillEmployeeForm(btn.dataset.id)));
      this.dom.empTableBody.querySelectorAll(".hr-emp-delete").forEach(btn => btn.addEventListener("click", () => this.deleteEmployee(btn.dataset.id)));
    },

    fillEmployeeSelects() {
      const selects = [
          this.dom.attEmployee, 
          this.dom.attFilterEmployee, 
          this.dom.leaveEmployee, 
          this.dom.leaveFilterEmployee,
          this.dom.offEmployee 
      ].filter(Boolean);

      selects.forEach((sel) => {
        sel.innerHTML = "";
        if (sel === this.dom.attFilterEmployee || sel === this.dom.leaveFilterEmployee) {
          const optAll = document.createElement("option");
          optAll.value = "";
          optAll.textContent = "-- Zobraz všetkých --";
          sel.appendChild(optAll);
        }

        this.employees.filter(e => e.is_active).forEach(emp => {
            const opt = document.createElement("option");
            opt.value = emp.id;
            opt.textContent = emp.full_name;
            sel.appendChild(opt);
          });
      });
    },

    fillEmployeeForm(id) {
      const emp = this.employees.find((e) => String(e.id) === String(id));
      if (!emp) return;
      this.dom.empId.value = emp.id;
      this.dom.empName.value = emp.full_name || "";
      this.dom.empCode.value = emp.code || "";
      this.dom.empPunch.value = emp.punch_code || "";
      this.dom.empSection.value = emp.section || "VYROBA";
      this.dom.empSalary.value = emp.monthly_salary || "";
      this.dom.empBaseHours.value = emp.base_hours_month || "";
      this.dom.empVacTotal.value = emp.vacation_days_total || "";
      this.dom.empActive.checked = !!emp.is_active;
    },

    resetEmployeeForm() {
      if (!this.dom.empForm) return;
      this.dom.empId.value = "";
      this.dom.empForm.reset();
      this.dom.empSection.value = "VYROBA";
      this.dom.empActive.checked = true;
    },

    bindEmployeeForm() {
      if (!this.dom.empForm) return;

      this.dom.empForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const payload = {
            id: this.dom.empId.value || null,
            full_name: this.dom.empName.value,
            code: this.dom.empCode.value,
            punch_code: this.dom.empPunch.value,
            section: this.dom.empSection.value,
            monthly_salary: this.dom.empSalary.value,
            base_hours_month: this.dom.empBaseHours.value,
            vacation_days_total: this.dom.empVacTotal.value,
            is_active: this.dom.empActive.checked,
          };
          await api.post("/api/kancelaria/hr/employee/save", payload);
          await this.loadEmployees();
          this.resetEmployeeForm();
        } catch (err) { alert(err.message || "Chyba pri ukladaní."); }
      });

      if (this.dom.empReset) {
        this.dom.empReset.addEventListener("click", () => this.resetEmployeeForm());
      }
    },

    async deleteEmployee(id) {
      if (!confirm("Naozaj chceš vymazať zamestnanca? Odstránia sa aj jeho dochádzky.")) return;
      try {
        await api.post("/api/kancelaria/hr/employee/delete", { id });
        await this.loadEmployees();
        await this.loadAttendance();
        await this.loadLeaves();
      } catch (err) { alert(err.message || "Chyba pri mazaní."); }
    },

    // ------------------------------------------------------------------
    // DOCHÁDZKA REÁLNA
    // ------------------------------------------------------------------
    bindAttendanceForm() {
      if (!this.dom.attForm) return;

      this.dom.attForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const payload = {
            id: this.dom.attId.value || null,
            employee_id: this.dom.attEmployee.value,
            work_date: this.dom.attDate.value,
            time_in: this.dom.attTimeIn.value,
            time_out: this.dom.attTimeOut.value,
            section_override: this.dom.attSectionOverride.value || null,
            note: this.dom.attNote.value || null,
          };
          await api.post("/api/kancelaria/hr/attendance/save", payload);
          await this.loadAttendance();
          this.resetAttendanceForm();
        } catch (err) { alert(err.message || "Chyba pri ukladaní."); }
      });

      if (this.dom.attReset) this.dom.attReset.addEventListener("click", () => this.resetAttendanceForm());
      if (this.dom.attFilterBtn) this.dom.attFilterBtn.addEventListener("click", () => this.loadAttendance());
      if (this.dom.attPrintBtn) this.dom.attPrintBtn.addEventListener("click", () => this.printAttendanceReport());
    },

    resetAttendanceForm() {
      this.dom.attId.value = "";
      this.dom.attForm.reset();
    },

    async loadAttendance() {
      if (!this.dom.attFilterFrom || !this.dom.attFilterTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.attFilterFrom.value) params.append("date_from", this.dom.attFilterFrom.value);
        if (this.dom.attFilterTo.value) params.append("date_to", this.dom.attFilterTo.value);
        if (this.dom.attFilterEmployee.value) params.append("employee_id", this.dom.attFilterEmployee.value);
        if (this.dom.attFilterSection && this.dom.attFilterSection.value) params.append("section", this.dom.attFilterSection.value);
        
        const data = await api.get("/api/kancelaria/hr/attendance?" + params.toString());
        this.currentAttendanceData = data.items || [];
        this.renderAttendance(this.currentAttendanceData);
      } catch (err) { console.error(err); }
    },

    printAttendanceReport() {
        if (!this.currentAttendanceData || this.currentAttendanceData.length === 0) {
            alert("Tabuľka je prázdna. Zmeňte filter a načítajte dáta.");
            return;
        }

        const dateFrom = this.dom.attFilterFrom.value;
        const dateTo = this.dom.attFilterTo.value;
        
        let html = `
        <html>
        <head>
            <title>Report Reálnej Dochádzky</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
                h2 { margin-top: 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #000; padding: 6px 8px; text-align: left; }
                th { background-color: #f1f5f9; font-weight: bold; }
                .note { margin-top: 20px; font-weight: bold; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <h2>Report reálnej dochádzky (${dateFrom} - ${dateTo})</h2>
            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; font-size: 14px; margin-bottom: 20px; cursor: pointer;">🖨️ Vytlačiť report</button>
            <table>
                <thead>
                    <tr>
                        <th>Dátum</th>
                        <th>Zamestnanec</th>
                        <th>Úsek</th>
                        <th>Príchod</th>
                        <th>Odchod</th>
                        <th>Čisté Hodiny</th>
                        <th>Poznámka</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let totalHours = 0;

        this.currentAttendanceData.forEach(it => {
            const dateParts = (it.work_date || "").slice(0, 10).split('-');
            const fDate = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : it.work_date;
            const tIn = it.time_in ? it.time_in.slice(0, 5) : '-';
            const tOut = it.time_out ? it.time_out.slice(0, 5) : '-';
            const activeSec = it.section_override || it.section || '-';
            
            const hours = Number(it.worked_hours || 0);
            totalHours += hours;
            
            // Naformátujeme pre tlačové výstupy
            const timeStr = hours > 0 ? formatHM(hours) : "0 hod 0 min";
            
            html += `
                <tr>
                    <td>${fDate}</td>
                    <td><strong>${it.full_name}</strong></td>
                    <td>${activeSec}</td>
                    <td>${tIn}</td>
                    <td>${tOut}</td>
                    <td><strong>${timeStr}</strong></td>
                    <td>${it.note || ''}</td>
                </tr>
            `;
        });

        // Sumár pre formátovaný výstup
        const totalTimeStr = formatHM(totalHours);

        html += `
                    <tr>
                        <td colspan="5" style="text-align: right; font-weight: bold;">SPOLU ODPRACOVANÉ:</td>
                        <td colspan="2" style="font-weight: bold; font-size: 1.1em; color: #166534;">${totalTimeStr}</td>
                    </tr>
                </tbody>
            </table>
        </body>
        </html>
        `;

        const printWin = window.open('', '', 'width=1000,height=800');
        printWin.document.write(html);
        printWin.document.close();
    },

    renderAttendance(items) {
      if (!this.dom.attTableBody) return;
      this.dom.attTableBody.innerHTML = "";

      items.forEach((it) => {
        const tr = document.createElement("tr");

        const fmtDate = (d) => {
            const p = (d || "").slice(0, 10).split('-');
            return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
        };
        const fmtTime = (t) => t ? `<strong style="font-size:1.1rem; color:#0f172a;">${t.slice(0, 5)}</strong>` : '<span style="color:#ef4444; font-weight:bold;">Chýba</span>';
        
        const hoursVal = Number(it.worked_hours || 0);
        
        // Zobrazujeme cez novy inteligentný formát (X hod Y min)
        const timeStr = formatHM(hoursVal);

        const hBadge = hoursVal > 0 
            ? `<span style="background:#dcfce7; color:#166534; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 1.05em;">${timeStr}</span>`
            : `<span style="background:#fee2e2; color:#991b1b; padding: 4px 10px; border-radius: 12px; font-weight: bold; font-size: 1.05em;">0 hod 0 min</span>`;

        const activeSec = it.section_override || it.section || '-';
        const secBadge = `<span style="background:#e0f2fe; color:#0369a1; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight:bold;">${activeSec}</span>`;

        tr.innerHTML = `
          <td style="padding-left:15px; font-weight:bold; color:#475569;">${fmtDate(it.work_date)}</td>
          <td><strong style="color: #0ea5e9;">${it.full_name}</strong></td>
          <td>${secBadge}</td>
          <td>${fmtTime(it.time_in)}</td>
          <td>${fmtTime(it.time_out)}</td>
          <td>${hBadge}</td>
          <td><span style="font-size:0.85rem; color:#64748b;">${it.note || '-'}</span></td>
          <td style="text-align: right; padding-right:15px;">
            <button class="btn btn-sm btn-primary hr-att-edit" data-id="${it.id}" title="Manuálna úprava"><i class="fas fa-pen"></i></button>
            <button class="btn btn-sm btn-danger hr-att-delete" data-id="${it.id}" style="margin-left:5px;"><i class="fas fa-trash"></i></button>
          </td>
        `;
        this.dom.attTableBody.appendChild(tr);
      });

      this.dom.attTableBody.querySelectorAll(".hr-att-edit").forEach(btn => btn.addEventListener("click", () => this.fillAttendanceForm(btn.dataset.id, items)));
      this.dom.attTableBody.querySelectorAll(".hr-att-delete").forEach(btn => btn.addEventListener("click", () => this.deleteAttendance(btn.dataset.id)));
    },

    fillAttendanceForm(id, items) {
      const it = items.find((r) => String(r.id) === String(id));
      if (!it) return;
      this.dom.attId.value = it.id;
      this.dom.attEmployee.value = it.employee_id;
      this.dom.attDate.value = (it.work_date || "").slice(0, 10);
      this.dom.attTimeIn.value = (it.time_in || "").toString().slice(0, 5);
      this.dom.attTimeOut.value = (it.time_out || "").toString().slice(0, 5);
      this.dom.attNote.value = it.note || "";
    },

    async deleteAttendance(id) {
      if (!confirm("Naozaj zmazať tento záznam?")) return;
      try {
        await api.post("/api/kancelaria/hr/attendance/delete", { id });
        await this.loadAttendance();
      } catch (err) { alert(err.message || "Chyba pri mazaní."); }
    },

    // ------------------------------------------------------------------
    // NEPRÍTOMNOSTI
    // ------------------------------------------------------------------
    bindLeaveForm() {
      if (!this.dom.leaveForm) return;

      this.dom.leaveForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const payload = {
            id: this.dom.leaveId.value || null,
            employee_id: this.dom.leaveEmployee.value,
            date_from: this.dom.leaveFromDate.value,
            date_to: this.dom.leaveToDate.value,
            leave_type: this.dom.leaveType.value,
            full_day: this.dom.leaveFullDay.checked,
            hours: this.dom.leaveHours.value || null,
            note: this.dom.leaveNote.value || null,
          };
          await api.post("/api/kancelaria/hr/leave/save", payload);
          await this.loadLeaves();
          await this.loadEmployees(); 
          this.resetLeaveForm();
        } catch (err) { alert(err.message || "Chyba pri ukladaní."); }
      });

      if (this.dom.leaveReset) this.dom.leaveReset.addEventListener("click", () => this.resetLeaveForm());
      if (this.dom.leaveFilterBtn) this.dom.leaveFilterBtn.addEventListener("click", () => this.loadLeaves());
    },

    resetLeaveForm() {
      this.dom.leaveId.value = "";
      this.dom.leaveForm.reset();
      if (this.dom.leaveFullDay) this.dom.leaveFullDay.checked = true;
    },

    async loadLeaves() {
      if (!this.dom.leaveFilterFrom || !this.dom.leaveFilterTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.leaveFilterFrom.value) params.append("date_from", this.dom.leaveFilterFrom.value);
        if (this.dom.leaveFilterTo.value) params.append("date_to", this.dom.leaveFilterTo.value);
        if (this.dom.leaveFilterEmployee.value) params.append("employee_id", this.dom.leaveFilterEmployee.value);
        const data = await api.get("/api/kancelaria/hr/leaves?" + params.toString());
        this.renderLeaves(data.items || []);
      } catch (err) { console.error(err); }
    },

    renderLeaves(items) {
      if (!this.dom.leaveTableBody) return;
      this.dom.leaveTableBody.innerHTML = "";

      const fmtDate = (d) => {
          const p = (d || "").slice(0, 10).split('-');
          return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
      };

      const typeLabel = (t) => {
        switch ((t || "").toUpperCase()) {
          case "VACATION": return `<span style="background:#dcfce7; color:#166534; padding: 4px 8px; border-radius: 4px; font-weight:bold; font-size:0.8rem;">🏖️ Dovolenka</span>`;
          case "SICK": return `<span style="background:#fef08a; color:#854d0e; padding: 4px 8px; border-radius: 4px; font-weight:bold; font-size:0.8rem;">🤒 PN / OČR</span>`;
          case "PASS": return `<span style="background:#e0f2fe; color:#0369a1; padding: 4px 8px; border-radius: 4px; font-weight:bold; font-size:0.8rem;">🏥 Priepustka</span>`;
          default: return `<span style="background:#f1f5f9; color:#475569; padding: 4px 8px; border-radius: 4px; font-weight:bold; font-size:0.8rem;">⚪ Iné</span>`;
        }
      };

      items.forEach((it) => {
        const tr = document.createElement("tr");
        const dates = it.date_from === it.date_to ? fmtDate(it.date_from) : `${fmtDate(it.date_from)} - ${fmtDate(it.date_to)}`;
        
        tr.innerHTML = `
          <td style="padding-left:15px; font-weight:bold; color:#0f172a;">${dates}</td>
          <td><strong>${it.full_name}</strong></td>
          <td>${typeLabel(it.leave_type)}</td>
          <td><strong style="font-size:1.1rem;">${Number(it.days_count || 0).toFixed(2)}</strong> dňa</td>
          <td><span style="font-size:0.85rem; color:#64748b;">${it.note || '-'}</span></td>
          <td style="text-align: right; padding-right:15px;">
            <button class="btn btn-sm btn-primary hr-leave-edit" data-id="${it.id}"><i class="fas fa-pen"></i></button>
            <button class="btn btn-sm btn-danger hr-leave-delete" data-id="${it.id}" style="margin-left:5px;"><i class="fas fa-trash"></i></button>
          </td>
        `;
        this.dom.leaveTableBody.appendChild(tr);
      });

      this.dom.leaveTableBody.querySelectorAll(".hr-leave-edit").forEach(btn => btn.addEventListener("click", () => this.fillLeaveForm(btn.dataset.id, items)));
      this.dom.leaveTableBody.querySelectorAll(".hr-leave-delete").forEach(btn => btn.addEventListener("click", () => this.deleteLeave(btn.dataset.id)));
    },

    fillLeaveForm(id, items) {
      const it = items.find((r) => String(r.id) === String(id));
      if (!it) return;
      this.dom.leaveId.value = it.id;
      this.dom.leaveEmployee.value = it.employee_id;
      this.dom.leaveFromDate.value = (it.date_from || "").slice(0, 10);
      this.dom.leaveToDate.value = (it.date_to || "").slice(0, 10);
      this.dom.leaveType.value = it.leave_type || "VACATION";
      this.dom.leaveFullDay.checked = !!it.full_day;
      this.dom.leaveHours.value = it.hours || "";
      this.dom.leaveNote.value = it.note || "";
    },

    async deleteLeave(id) {
      if (!confirm("Zmazať neprítomnosť? Pri dovolenke sa vráti nárok späť.")) return;
      try {
        await api.post("/api/kancelaria/hr/leave/delete", { id });
        await this.loadLeaves();
        await this.loadEmployees(); 
      } catch (err) { alert(err.message || "Chyba pri mazaní."); }
    },

    // ------------------------------------------------------------------
    // SÚHRN NÁKLADOV
    // (Tu nechávame desatinné hodiny pre lepšiu kontrolu nákladov mzdárkou)
    // ------------------------------------------------------------------
    bindSummary() {
      if (!this.dom.sumRefresh) return;
      this.dom.sumRefresh.addEventListener("click", () => this.loadSummary());
    },

    async loadSummary() {
      if (!this.dom.sumFrom || !this.dom.sumTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.sumFrom.value) params.append("date_from", this.dom.sumFrom.value);
        if (this.dom.sumTo.value) params.append("date_to", this.dom.sumTo.value);
        const data = await api.get("/api/kancelaria/hr/summary?" + params.toString());
        this.renderSummary(data);
      } catch (err) { console.error(err); }
    },

    renderSummary(data) {
      const fmtDate = (d) => {
          const p = (d || "").split('-');
          return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
      };
      const periodText = document.getElementById("hr-sum-period-text");
      if(periodText) periodText.innerHTML = `Vybrané obdobie: <strong>${fmtDate(data.period.date_from)} - ${fmtDate(data.period.date_to)}</strong>`;

      if (this.dom.sumTotals) {
        this.dom.sumTotals.innerHTML = `
          <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #3b82f6;">
            <div style="color: #64748b; font-weight: 600; font-size: 0.9rem; margin-bottom: 5px;">Celkovo odpracované</div>
            <div style="color: #0f172a; font-size: 1.8rem; font-weight: bold;">${Number(data.total_hours || 0).toFixed(2)} <span style="font-size: 1rem; color: #94a3b8;">h</span></div>
          </div>
          
          <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #ef4444;">
            <div style="color: #64748b; font-weight: 600; font-size: 0.9rem; margin-bottom: 5px;">Mzdové náklady (Fix)</div>
            <div style="color: #dc2626; font-size: 1.8rem; font-weight: bold;">${Number(data.total_labor_cost || 0).toLocaleString('sk-SK', {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span style="font-size: 1rem;">€</span></div>
          </div>
          
          <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #10b981;">
            <div style="color: #64748b; font-weight: 600; font-size: 0.9rem; margin-bottom: 5px;">Vyrobené množstvo</div>
            <div style="color: #166534; font-size: 1.8rem; font-weight: bold;">${Number(data.total_prod_kg || 0).toLocaleString('sk-SK', {minimumFractionDigits: 1, maximumFractionDigits: 1})} <span style="font-size: 1rem;">kg</span></div>
          </div>
          
          <div style="background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #f59e0b;">
            <div style="color: #64748b; font-weight: 600; font-size: 0.9rem; margin-bottom: 5px;">Priemerná cena práce na 1 kg</div>
            <div style="color: #d97706; font-size: 1.8rem; font-weight: bold;">${Number(data.cost_per_kg_total || 0).toFixed(3)} <span style="font-size: 1rem;">€ / kg</span></div>
          </div>
        `;
      }

      if (this.dom.sumSectionsBody) {
        this.dom.sumSectionsBody.innerHTML = "";
        (data.sections || []).forEach((sec) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="padding-left: 15px; font-weight: bold; color: #0369a1;">${sec.section}</td>
            <td>${Number(sec.hours || 0).toFixed(2)} h</td>
            <td><strong style="color: #dc2626;">${Number(sec.labor_cost || 0).toLocaleString('sk-SK', {minimumFractionDigits: 2, maximumFractionDigits: 2})} €</strong></td>
          `;
          this.dom.sumSectionsBody.appendChild(tr);
        });
      }

      if (this.dom.sumEmployeesBody) {
        this.dom.sumEmployeesBody.innerHTML = "";
        (data.employees || []).forEach((emp) => {
          const tr = document.createElement("tr");
          const sectionBadge = `<span style="background:#e0f2fe; color:#0369a1; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight:bold;">${emp.section}</span>`;
          
          tr.innerHTML = `
            <td style="padding-left: 15px;"><strong>${emp.full_name}</strong></td>
            <td>${sectionBadge}</td>
            <td>${Number(emp.hours || 0).toFixed(2)} h</td>
            <td style="color: #64748b;">${Number(emp.hourly_rate || 0).toFixed(2)} €</td>
            <td><strong style="color: #dc2626;">${Number(emp.labor_cost || 0).toLocaleString('sk-SK', {minimumFractionDigits: 2, maximumFractionDigits: 2})} €</strong></td>
          `;
          this.dom.sumEmployeesBody.appendChild(tr);
        });
      }
    },

    // ------------------------------------------------------------------
    // OFICIÁLNA DOCHÁDZKA (GENERÁTOR)
    // ------------------------------------------------------------------
    bindOfficialTemplate() {
      if (!this.dom.offGenerateBtn) return;
      this.dom.offGenerateBtn.addEventListener("click", () => this.generateOfficialAttendance());
      this.dom.offPrintBtn.addEventListener("click", () => this.printOfficialAttendance());
    },

    async generateOfficialAttendance() {
        const empId = this.dom.offEmployee.value;
        const monthVal = this.dom.offMonth.value;
        const timeIn = this.dom.offTimeIn.value || "06:00";
        const timeOut = this.dom.offTimeOut.value || "14:30";

        if (!empId || !monthVal) {
            alert("Vyberte zamestnanca a mesiac.");
            return;
        }

        const [year, month] = monthVal.split('-');
        const lastDay = new Date(year, month, 0).getDate();
        const dateFrom = `${year}-${month}-01`;
        const dateTo = `${year}-${month}-${lastDay}`;

        let leaves = [];
        try {
            const data = await api.get(`/api/kancelaria/hr/leaves?date_from=${dateFrom}&date_to=${dateTo}&employee_id=${empId}`);
            leaves = data.items || [];
        } catch(e) {
            console.error("Chyba pri načítaní neprítomností:", e);
        }

        const emp = this.employees.find(e => String(e.id) === String(empId));
        const empName = emp ? emp.full_name : "Neznámy zamestnanec";

        let html = `
            <h3 style="margin-top:0; margin-bottom: 20px; color: #3730a3;">Oficiálny výkaz práce: <strong>${empName}</strong> (${month}/${year})</h3>
            <table class="table-refined" style="width:100%; border-collapse: collapse; border: 1px solid #e2e8f0;">
                <thead style="background: #f8fafc;">
                    <tr>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Dátum</th>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Deň v týždni</th>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Príchod</th>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Odchod</th>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Odpracované hod.</th>
                        <th style="border: 1px solid #cbd5e1; padding: 10px;">Dôvod absencie</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let totalHours = 0;
        const daysStr = ["Nedeľa", "Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota"];
        
        const parseDateOnly = (dStr) => {
            const parts = dStr.slice(0, 10).split('-');
            return new Date(parts[0], parseInt(parts[1])-1, parts[2]);
        };

        let defaultHrs = 8.0;
        try {
            const din = new Date(`1970-01-01T${timeIn}:00`);
            const dout = new Date(`1970-01-01T${timeOut}:00`);
            let diff = (dout - din) / 3600000;
            if (diff > 6.0) diff -= 0.5; // odpočítať 0.5h prestávku
            defaultHrs = diff;
        } catch(e) {}

        this.currentOfficialData = [];

        for(let i=1; i<=lastDay; i++) {
            const dObj = new Date(year, parseInt(month)-1, i);
            const dayOfWeek = dObj.getDay();
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            
            let activeLeave = leaves.find(l => {
                const lf = parseDateOnly(l.date_from);
                const lt = parseDateOnly(l.date_to);
                return dObj >= lf && dObj <= lt;
            });

            let status = "Práca";
            let tIn = timeIn;
            let tOut = timeOut;
            let hrs = defaultHrs; 
            
            if (isWeekend) {
                status = "Víkend"; 
                tIn = ""; tOut = ""; hrs = 0;
            } else if (activeLeave) {
                if(activeLeave.leave_type === "VACATION") status = "Dovolenka";
                else if(activeLeave.leave_type === "SICK") status = "PN / OČR";
                else status = "Lekár / Priepustka";
                
                tIn = ""; tOut = ""; 
                hrs = 8.0; 
            }

            if(hrs > 0) totalHours += hrs;

            this.currentOfficialData.push({
                date: `${String(i).padStart(2, '0')}.${month}.${year}`,
                dayName: daysStr[dayOfWeek],
                tIn: tIn,
                tOut: tOut,
                hours: hrs,
                status: status,
                isWeekend: isWeekend,
                hasLeave: !!activeLeave
            });

            let bg = isWeekend ? "background: #f1f5f9;" : (activeLeave ? "background: #fef3c7;" : "");
            let fWeight = activeLeave ? "font-weight: bold; color: #b45309;" : "";
            
            // Format time display
            const timeFormatted = hrs > 0 ? formatHM(hrs) : '-';

            html += `
                <tr style="${bg}">
                    <td style="border: 1px solid #e2e8f0; padding: 8px;"><strong>${String(i).padStart(2, '0')}.${month}.${year}</strong></td>
                    <td style="border: 1px solid #e2e8f0; padding: 8px; color: #64748b;">${daysStr[dayOfWeek]}</td>
                    <td style="border: 1px solid #e2e8f0; padding: 8px;">${tIn}</td>
                    <td style="border: 1px solid #e2e8f0; padding: 8px;">${tOut}</td>
                    <td style="border: 1px solid #e2e8f0; padding: 8px;"><strong>${timeFormatted}</strong></td>
                    <td style="border: 1px solid #e2e8f0; padding: 8px; ${fWeight}">${status === 'Práca' || status === 'Víkend' ? '' : status}</td>
                </tr>
            `;
        }

        const totalFormatted = formatHM(totalHours);

        html += `
                </tbody>
            </table>
            <div style="margin-top: 20px; font-size: 1.25rem; background: #e0e7ff; padding: 15px; border-radius: 8px; display: inline-block;">
                Mesačný fond (odpracované + uznané): <strong style="color: #4f46e5;">${totalFormatted}</strong>
            </div>
        `;

        const previewDiv = this.dom.offPreview;
        previewDiv.innerHTML = html;
        previewDiv.style.display = "block";
        this.dom.offPrintBtn.style.display = "inline-block";
        
        this.currentOfficialMeta = {
            empName,
            month: `${month}/${year}`,
            totalHours
        };
    },

    printOfficialAttendance() {
        if (!this.currentOfficialData || this.currentOfficialData.length === 0) return;

        let html = `
        <html>
        <head>
            <title>Výkaz Dochádzky - ${this.currentOfficialMeta.empName}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 30px; font-size: 13px; color: #000; }
                .header { text-align: center; margin-bottom: 30px; }
                h2 { margin: 0; font-size: 20px; }
                h3 { margin: 5px 0 0 0; font-weight: normal; font-size: 16px; color: #444; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { border: 1px solid #333; padding: 6px 8px; text-align: center; }
                th { background-color: #eee; font-weight: bold; }
                td:nth-child(2) { text-align: left; }
                td:nth-child(6) { text-align: left; }
                .weekend { background-color: #f9f9f9; color: #666; }
                .leave { background-color: #fffdf0; font-weight: bold; }
                .summary { margin-top: 30px; font-size: 15px; font-weight: bold; border: 2px solid #000; padding: 15px; width: 300px; display: inline-block; }
                .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
                .sig-box { width: 200px; border-top: 1px solid #000; text-align: center; padding-top: 5px; }
                @media print { .no-print { display: none; } body { padding: 0; } }
            </style>
        </head>
        <body>
            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; margin-bottom: 20px; font-weight: bold; cursor: pointer;">🖨️ Vytlačiť VÝKAZ PRE MZDOVÚ ÚČTOVNIČKU</button>
            
            <div class="header">
                <h2>VÝKAZ ODPRACOVANÝCH HODÍN</h2>
                <h3>Zamestnanec: <strong>${this.currentOfficialMeta.empName}</strong> &nbsp; | &nbsp; Obdobie: <strong>${this.currentOfficialMeta.month}</strong></h3>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Dátum</th>
                        <th>Deň</th>
                        <th>Príchod</th>
                        <th>Odchod</th>
                        <th>Hodiny spolu</th>
                        <th>Druh neprítomnosti</th>
                    </tr>
                </thead>
                <tbody>
        `;

        this.currentOfficialData.forEach(row => {
            let trClass = "";
            if (row.isWeekend) trClass = "weekend";
            else if (row.hasLeave) trClass = "leave";

            const rowFormatted = row.hours > 0 ? formatHM(row.hours) : '-';

            html += `
                <tr class="${trClass}">
                    <td>${row.date}</td>
                    <td>${row.dayName}</td>
                    <td>${row.tIn}</td>
                    <td>${row.tOut}</td>
                    <td><strong>${rowFormatted}</strong></td>
                    <td>${(row.status === 'Práca' || row.status === 'Víkend') ? '' : row.status}</td>
                </tr>
            `;
        });

        const totalFormatted = formatHM(this.currentOfficialMeta.totalHours);

        html += `
                </tbody>
            </table>
            
            <div class="summary">
                Mesačný fond celkom: ${totalFormatted}
            </div>

            <div class="signatures">
                <div class="sig-box">Podpis zamestnanca</div>
                <div class="sig-box">Schválil (Vedúci)</div>
            </div>
        </body>
        </html>
        `;

        const printWin = window.open('', '', 'width=900,height=800');
        printWin.document.write(html);
        printWin.document.close();
    }
  };

  document.addEventListener("DOMContentLoaded", () => HR.init());
})();