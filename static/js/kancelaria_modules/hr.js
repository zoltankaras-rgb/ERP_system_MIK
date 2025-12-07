// hr.js – HR & dochádzka modul (Kancelária)

(function () {
  const api = {
    async get(url) {
      const res = await fetch(url, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Chyba servera');
      return data;
    },
    async post(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Chyba servera');
      return data;
    }
  };

  const HR = {
    employees: [],
    dom: {},

    init() {
      this.dom.section = document.getElementById('section-hr');
      if (!this.dom.section) return;

      // nakresli layout, ak je sekcia prázdna
      if (!this.dom.section.hasChildNodes()) {
        this.renderLayout();
      }

      this.cacheDom();
      this.bindTabs();
      this.bindEmployeeForm();
      this.bindAttendanceForm();
      this.bindLeaveForm();
      this.bindSummary();

      this.initDefaultDates();
      this.switchTab('employees'); // default karta

      this.loadEmployees()
        .then(() => {
          this.loadAttendance();
          this.loadLeaves();
          this.loadSummary();
        })
        .catch(console.error);
    },

    // ------------------------------------------------------------------
    // LAYOUT – všetko UI sa kreslí tu
    // ------------------------------------------------------------------
    renderLayout() {
      this.dom.section.innerHTML = `
        <div class="card" style="margin-bottom: 1rem;">
          <div class="card-body">
            <h2 style="margin-bottom: .35rem;">HR & dochádzka</h2>
            <p style="margin: 0 0 .75rem 0; font-size: .9rem; color: #555;">
              Evidencia zamestnancov, dochádzky z "píchačiek", dovoleniek/PN a súhrn nákladov na prácu.
            </p>

            <div class="hr-tab-nav" style="display:flex; gap:.5rem; flex-wrap:wrap;">
              <button class="btn btn-sm btn-secondary hr-tab-btn" data-hr-tab="employees">
                <i class="fas fa-users"></i> Zamestnanci
              </button>
              <button class="btn btn-sm btn-secondary hr-tab-btn" data-hr-tab="attendance">
                <i class="fas fa-user-clock"></i> Dochádzka
              </button>
              <button class="btn btn-sm btn-secondary hr-tab-btn" data-hr-tab="leaves">
                <i class="fas fa-plane-departure"></i> Neprítomnosti
              </button>
              <button class="btn btn-sm btn-secondary hr-tab-btn" data-hr-tab="summary">
                <i class="fas fa-chart-pie"></i> Súhrn nákladov
              </button>
            </div>
          </div>
        </div>

        <div class="hr-tabs">

          <!-- TAB: ZAMESTNANCI -->
          <section id="hr-tab-employees" class="hr-tab" data-hr-panel="employees" style="display:none;">
            <div class="card">
              <div class="card-body">
                <h3 style="margin-top:0;">Zamestnanci</h3>
                <p class="text-muted" style="font-size:.85rem; margin-bottom:.75rem;">
                  Tu nastavíš fixné mzdy, sekciu (výroba/expedícia/rozvoz), normu hodín a nárok na dovolenku.
                </p>

                <div style="display:flex; flex-wrap:wrap; gap:1.5rem;">
                  <form id="hr-employee-form" class="form-grid" style="flex:0 0 320px; max-width:380px;">
                    <input type="hidden" id="hr-employee-id" />

                    <div class="form-group">
                      <label for="hr-employee-name">Meno</label>
                      <input type="text" id="hr-employee-name" required />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-code">Kód (interný / píchačka)</label>
                      <input type="text" id="hr-employee-code" />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-punch">Kód z píchačky</label>
                      <input type="text" id="hr-employee-punch" />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-section">Sekcia</label>
                      <select id="hr-employee-section">
                        <option value="VYROBA">Výroba</option>
                        <option value="EXPEDICIA">Expedícia</option>
                        <option value="ROZVOZ">Rozvoz</option>
                        <option value="ADMIN">Admin</option>
                        <option value="INE">Iné</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-salary">Mesačná mzda (EUR)</label>
                      <input type="number" step="0.01" id="hr-employee-salary" />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-base-hours">Norma hodín / mesiac</label>
                      <input type="number" step="0.01" id="hr-employee-base-hours" value="168" />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-vacation-total">Nárok na dovolenku (dni/rok)</label>
                      <input type="number" step="0.5" id="hr-employee-vacation-total" />
                    </div>

                    <div class="form-group">
                      <label for="hr-employee-active">Aktívny</label>
                      <input type="checkbox" id="hr-employee-active" checked />
                    </div>

                    <div class="form-actions" style="display:flex; gap:.5rem; margin-top:.5rem;">
                      <button type="submit" class="btn btn-primary">Uložiť</button>
                      <button type="button" id="hr-employee-reset" class="btn btn-secondary">Nový</button>
                    </div>
                  </form>

                  <div style="flex:1 1 400px; min-width:300px;">
                    <table class="table" id="hr-employees-table">
                      <thead>
                        <tr>
                          <th>Meno</th>
                          <th>Sekcia</th>
                          <th>Mzda</th>
                          <th>Dovolenka (nárok / čerpané / zostatok)</th>
                          <th style="width:90px;"></th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- TAB: DOCHÁDZKA -->
          <section id="hr-tab-attendance" class="hr-tab" data-hr-panel="attendance" style="display:none;">
            <div class="card">
              <div class="card-body">
                <h3 style="margin-top:0;">Dochádzka</h3>
                <p class="text-muted" style="font-size:.85rem; margin-bottom:.75rem;">
                  Prepis z píchačiek: príchod / odchod. Z toho sa spočítajú hodiny a náklady na prácu.
                </p>

                <div class="filters-row" style="display:flex; flex-wrap:wrap; gap:.75rem; align-items:flex-end; margin-bottom:.75rem;">
                  <div>
                    <label>Od</label><br />
                    <input type="date" id="hr-att-date-from" />
                  </div>
                  <div>
                    <label>Do</label><br />
                    <input type="date" id="hr-att-date-to" />
                  </div>
                  <div>
                    <label>Zamestnanec</label><br />
                    <select id="hr-att-employee-filter" style="min-width:160px;">
                      <option value="">Všetci</option>
                    </select>
                  </div>
                  <div>
                    <button type="button" id="hr-att-filter-btn" class="btn btn-secondary">Načítať</button>
                  </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:1.5rem;">
                  <form id="hr-att-form" class="form-grid small" style="flex:0 0 320px; max-width:380px;">
                    <input type="hidden" id="hr-att-id" />

                    <div class="form-group">
                      <label for="hr-att-employee">Zamestnanec</label>
                      <select id="hr-att-employee"></select>
                    </div>

                    <div class="form-group">
                      <label for="hr-att-date">Dátum</label>
                      <input type="date" id="hr-att-date" required />
                    </div>

                    <div class="form-group">
                      <label for="hr-att-time-in">Príchod</label>
                      <input type="time" id="hr-att-time-in" />
                    </div>

                    <div class="form-group">
                      <label for="hr-att-time-out">Odchod</label>
                      <input type="time" id="hr-att-time-out" />
                    </div>

                    <div class="form-group">
                      <label for="hr-att-section-override">Sekcia (prepis)</label>
                      <select id="hr-att-section-override">
                        <option value="">(podľa zamestnanca)</option>
                        <option value="VYROBA">Výroba</option>
                        <option value="EXPEDICIA">Expedícia</option>
                        <option value="ROZVOZ">Rozvoz</option>
                        <option value="ADMIN">Admin</option>
                        <option value="INE">Iné</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label for="hr-att-note">Poznámka</label>
                      <input type="text" id="hr-att-note" />
                    </div>

                    <div class="form-actions" style="display:flex; gap:.5rem; margin-top:.5rem;">
                      <button type="submit" class="btn btn-primary">Uložiť</button>
                      <button type="button" id="hr-att-reset" class="btn btn-secondary">Nový</button>
                    </div>
                  </form>

                  <div style="flex:1 1 400px; min-width:300px;">
                    <table class="table" id="hr-att-table">
                      <thead>
                        <tr>
                          <th>Dátum</th>
                          <th>Meno</th>
                          <th>Sekcia</th>
                          <th>Príchod</th>
                          <th>Odchod</th>
                          <th>Hodiny</th>
                          <th>Poznámka</th>
                          <th style="width:90px;"></th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- TAB: NEPRÍTOMNOSTI -->
          <section id="hr-tab-leaves" class="hr-tab" data-hr-panel="leaves" style="display:none;">
            <div class="card">
              <div class="card-body">
                <h3 style="margin-top:0;">Neprítomnosti (PN, dovolenka, priepustky)</h3>
                <p class="text-muted" style="font-size:.85rem; margin-bottom:.75rem;">
                  Pri dovolenke sa dni automaticky odrátajú z nároku zamestnanca.
                </p>

                <div class="filters-row" style="display:flex; flex-wrap:wrap; gap:.75rem; align-items:flex-end; margin-bottom:.75rem;">
                  <div>
                    <label>Od</label><br />
                    <input type="date" id="hr-leave-from" />
                  </div>
                  <div>
                    <label>Do</label><br />
                    <input type="date" id="hr-leave-to" />
                  </div>
                  <div>
                    <label>Zamestnanec</label><br />
                    <select id="hr-leave-employee-filter" style="min-width:160px;">
                      <option value="">Všetci</option>
                    </select>
                  </div>
                  <div>
                    <button type="button" id="hr-leave-filter-btn" class="btn btn-secondary">Načítať</button>
                  </div>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:1.5rem;">
                  <form id="hr-leave-form" class="form-grid small" style="flex:0 0 320px; max-width:380px;">
                    <input type="hidden" id="hr-leave-id" />

                    <div class="form-group">
                      <label for="hr-leave-employee">Zamestnanec</label>
                      <select id="hr-leave-employee"></select>
                    </div>

                    <div class="form-group">
                      <label for="hr-leave-from-date">Od</label>
                      <input type="date" id="hr-leave-from-date" required />
                    </div>

                    <div class="form-group">
                      <label for="hr-leave-to-date">Do</label>
                      <input type="date" id="hr-leave-to-date" required />
                    </div>

                    <div class="form-group">
                      <label for="hr-leave-type">Typ</label>
                      <select id="hr-leave-type">
                        <option value="VACATION">Dovolenka</option>
                        <option value="SICK">PN</option>
                        <option value="PASS">Priepustka</option>
                        <option value="OTHER">Iné</option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label>
                        <input type="checkbox" id="hr-leave-full-day" checked />
                        Celé dni
                      </label>
                    </div>

                    <div class="form-group">
                      <label for="hr-leave-hours">Hodiny (ak nie celé dni)</label>
                      <input type="number" step="0.25" id="hr-leave-hours" />
                    </div>

                    <div class="form-group">
                      <label for="hr-leave-note">Poznámka</label>
                      <input type="text" id="hr-leave-note" />
                    </div>

                    <div class="form-actions" style="display:flex; gap:.5rem; margin-top:.5rem;">
                      <button type="submit" class="btn btn-primary">Uložiť</button>
                      <button type="button" id="hr-leave-reset" class="btn btn-secondary">Nový</button>
                    </div>
                  </form>

                  <div style="flex:1 1 400px; min-width:300px;">
                    <table class="table" id="hr-leave-table">
                      <thead>
                        <tr>
                          <th>Dátum od</th>
                          <th>Dátum do</th>
                          <th>Meno</th>
                          <th>Typ</th>
                          <th>Dni</th>
                          <th>Poznámka</th>
                          <th style="width:90px;"></th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- TAB: SÚHRN NÁKLADOV -->
          <section id="hr-tab-summary" class="hr-tab" data-hr-panel="summary" style="display:none;">
            <div class="card">
              <div class="card-body">
                <h3 style="margin-top:0;">Súhrn nákladov na prácu</h3>
                <p class="text-muted" style="font-size:.85rem; margin-bottom:.75rem;">
                  Na základe dochádzky a miezd vypočíta náklady na prácu a cenu práce na 1 kg.
                </p>

                <div class="filters-row" style="display:flex; flex-wrap:wrap; gap:.75rem; align-items:flex-end; margin-bottom:.75rem;">
                  <div>
                    <label>Od</label><br />
                    <input type="date" id="hr-sum-from" />
                  </div>
                  <div>
                    <label>Do</label><br />
                    <input type="date" id="hr-sum-to" />
                  </div>
                  <div>
                    <button type="button" id="hr-sum-refresh" class="btn btn-secondary">Prepočítať</button>
                  </div>
                </div>

                <div id="hr-sum-totals" class="totals-row" style="margin-bottom:1rem;"></div>

                <h4>Podiel podľa sekcie</h4>
                <table class="table" id="hr-sum-sections-table">
                  <thead>
                    <tr>
                      <th>Sekcia</th>
                      <th>Hodiny</th>
                      <th>Náklady (€)</th>
                      <th>€/kg</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>

                <h4 style="margin-top:1.25rem;">Detail podľa zamestnanca</h4>
                <table class="table" id="hr-sum-employees-table">
                  <thead>
                    <tr>
                      <th>Meno</th>
                      <th>Sekcia</th>
                      <th>Hodiny</th>
                      <th>€/hod</th>
                      <th>Náklady (€)</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </section>

        </div>
      `;
    },

    // ------------------------------------------------------------------
    // TABY
    // ------------------------------------------------------------------
    bindTabs() {
      this.dom.tabButtons = this.dom.section.querySelectorAll('.hr-tab-btn');
      this.dom.tabPanels = this.dom.section.querySelectorAll('.hr-tab');

      this.dom.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-hr-tab');
          this.switchTab(tab);
        });
      });
    },

    switchTab(tabName) {
      // panely
      this.dom.tabPanels.forEach(panel => {
        const name = panel.getAttribute('data-hr-panel');
        panel.style.display = (name === tabName) ? 'block' : 'none';
      });

      // tlačidlá
      this.dom.tabButtons.forEach(btn => {
        const name = btn.getAttribute('data-hr-tab');
        if (name === tabName) {
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
        } else {
          btn.classList.add('btn-secondary');
          btn.classList.remove('btn-primary');
        }
      });
    },

    // ------------------------------------------------------------------
    // CACHE DOM
    // ------------------------------------------------------------------
    cacheDom() {
      // zamestnanci
      this.dom.empForm = document.getElementById('hr-employee-form');
      this.dom.empId = document.getElementById('hr-employee-id');
      this.dom.empName = document.getElementById('hr-employee-name');
      this.dom.empCode = document.getElementById('hr-employee-code');
      this.dom.empPunch = document.getElementById('hr-employee-punch');
      this.dom.empSection = document.getElementById('hr-employee-section');
      this.dom.empSalary = document.getElementById('hr-employee-salary');
      this.dom.empBaseHours = document.getElementById('hr-employee-base-hours');
      this.dom.empVacTotal = document.getElementById('hr-employee-vacation-total');
      this.dom.empActive = document.getElementById('hr-employee-active');
      this.dom.empReset = document.getElementById('hr-employee-reset');
      this.dom.empTableBody = document.querySelector('#hr-employees-table tbody');

      // dochádzka
      this.dom.attForm = document.getElementById('hr-att-form');
      this.dom.attId = document.getElementById('hr-att-id');
      this.dom.attEmployee = document.getElementById('hr-att-employee');
      this.dom.attDate = document.getElementById('hr-att-date');
      this.dom.attTimeIn = document.getElementById('hr-att-time-in');
      this.dom.attTimeOut = document.getElementById('hr-att-time-out');
      this.dom.attSectionOverride = document.getElementById('hr-att-section-override');
      this.dom.attNote = document.getElementById('hr-att-note');
      this.dom.attReset = document.getElementById('hr-att-reset');
      this.dom.attTableBody = document.querySelector('#hr-att-table tbody');

      this.dom.attFilterFrom = document.getElementById('hr-att-date-from');
      this.dom.attFilterTo = document.getElementById('hr-att-date-to');
      this.dom.attFilterEmployee = document.getElementById('hr-att-employee-filter');
      this.dom.attFilterBtn = document.getElementById('hr-att-filter-btn');

      // neprítomnosti
      this.dom.leaveForm = document.getElementById('hr-leave-form');
      this.dom.leaveId = document.getElementById('hr-leave-id');
      this.dom.leaveEmployee = document.getElementById('hr-leave-employee');
      this.dom.leaveFromDate = document.getElementById('hr-leave-from-date');
      this.dom.leaveToDate = document.getElementById('hr-leave-to-date');
      this.dom.leaveType = document.getElementById('hr-leave-type');
      this.dom.leaveFullDay = document.getElementById('hr-leave-full-day');
      this.dom.leaveHours = document.getElementById('hr-leave-hours');
      this.dom.leaveNote = document.getElementById('hr-leave-note');
      this.dom.leaveReset = document.getElementById('hr-leave-reset');
      this.dom.leaveTableBody = document.querySelector('#hr-leave-table tbody');

      this.dom.leaveFilterFrom = document.getElementById('hr-leave-from');
      this.dom.leaveFilterTo = document.getElementById('hr-leave-to');
      this.dom.leaveFilterEmployee = document.getElementById('hr-leave-employee-filter');
      this.dom.leaveFilterBtn = document.getElementById('hr-leave-filter-btn');

      // súhrn
      this.dom.sumFrom = document.getElementById('hr-sum-from');
      this.dom.sumTo = document.getElementById('hr-sum-to');
      this.dom.sumRefresh = document.getElementById('hr-sum-refresh');
      this.dom.sumTotals = document.getElementById('hr-sum-totals');
      this.dom.sumSectionsBody = document.querySelector('#hr-sum-sections-table tbody');
      this.dom.sumEmployeesBody = document.querySelector('#hr-sum-employees-table tbody');
    },

    // ------------------------------------------------------------------
    // DÁTUMY
    // ------------------------------------------------------------------
    initDefaultDates() {
      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const fmt = d => d.toISOString().slice(0, 10);

      if (this.dom.attFilterFrom) this.dom.attFilterFrom.value = fmt(first);
      if (this.dom.attFilterTo) this.dom.attFilterTo.value = fmt(today);
      if (this.dom.attDate) this.dom.attDate.value = fmt(today);

      if (this.dom.leaveFilterFrom) this.dom.leaveFilterFrom.value = fmt(first);
      if (this.dom.leaveFilterTo) this.dom.leaveFilterTo.value = fmt(today);
      if (this.dom.leaveFromDate) this.dom.leaveFromDate.value = fmt(today);
      if (this.dom.leaveToDate) this.dom.leaveToDate.value = fmt(today);

      if (this.dom.sumFrom) this.dom.sumFrom.value = fmt(first);
      if (this.dom.sumTo) this.dom.sumTo.value = fmt(today);
    },

    // ------------------------------------------------------------------
    // ZAMESTNANCI
    // ------------------------------------------------------------------
    async loadEmployees() {
      const data = await api.get('/api/kancelaria/hr/employees');
      this.employees = data.employees || [];
      this.renderEmployees();
      this.fillEmployeeSelects();
    },

    renderEmployees() {
      if (!this.dom.empTableBody) return;
      this.dom.empTableBody.innerHTML = '';

      this.employees.forEach(emp => {
        const tr = document.createElement('tr');

        const vacTotal = parseFloat(emp.vacation_days_total || 0) || 0;
        const vacUsed = parseFloat(emp.vacation_days_used || 0) || 0;
        const vacBal = vacTotal - vacUsed;

        tr.innerHTML = `
          <td>${emp.full_name}</td>
          <td>${emp.section}</td>
          <td>${(emp.monthly_salary || 0).toFixed(2)} €</td>
          <td>${vacTotal.toFixed(1)} / ${vacUsed.toFixed(1)} / ${vacBal.toFixed(1)}</td>
          <td>
            <button class="btn btn-sm btn-secondary hr-emp-edit" data-id="${emp.id}">Upraviť</button>
            <button class="btn btn-sm btn-danger hr-emp-delete" data-id="${emp.id}">X</button>
          </td>
        `;
        this.dom.empTableBody.appendChild(tr);
      });

      this.dom.empTableBody.querySelectorAll('.hr-emp-edit').forEach(btn =>
        btn.addEventListener('click', () => this.fillEmployeeForm(btn.dataset.id))
      );
      this.dom.empTableBody.querySelectorAll('.hr-emp-delete').forEach(btn =>
        btn.addEventListener('click', () => this.deleteEmployee(btn.dataset.id))
      );
    },

    fillEmployeeSelects() {
      const selects = [
        this.dom.attEmployee,
        this.dom.attFilterEmployee,
        this.dom.leaveEmployee,
        this.dom.leaveFilterEmployee
      ].filter(Boolean);

      selects.forEach(sel => {
        sel.innerHTML = '';
        if (sel === this.dom.attFilterEmployee || sel === this.dom.leaveFilterEmployee) {
          const optAll = document.createElement('option');
          optAll.value = '';
          optAll.textContent = 'Všetci';
          sel.appendChild(optAll);
        }

        this.employees
          .filter(e => e.is_active)
          .forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.full_name;
            sel.appendChild(opt);
          });
      });
    },

    fillEmployeeForm(id) {
      const emp = this.employees.find(e => String(e.id) === String(id));
      if (!emp) return;
      this.dom.empId.value = emp.id;
      this.dom.empName.value = emp.full_name || '';
      this.dom.empCode.value = emp.code || '';
      this.dom.empPunch.value = emp.punch_code || '';
      this.dom.empSection.value = emp.section || 'VYROBA';
      this.dom.empSalary.value = emp.monthly_salary || '';
      this.dom.empBaseHours.value = emp.base_hours_month || '';
      this.dom.empVacTotal.value = emp.vacation_days_total || '';
      this.dom.empActive.checked = !!emp.is_active;
    },

    resetEmployeeForm() {
      if (!this.dom.empForm) return;
      this.dom.empId.value = '';
      this.dom.empForm.reset();
      this.dom.empSection.value = 'VYROBA';
      this.dom.empActive.checked = true;
    },

    bindEmployeeForm() {
      if (!this.dom.empForm) return;

      this.dom.empForm.addEventListener('submit', async (e) => {
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
            is_active: this.dom.empActive.checked
          };
          await api.post('/api/kancelaria/hr/employee/save', payload);
          await this.loadEmployees();
          this.resetEmployeeForm();
        } catch (err) {
          alert(err.message || 'Chyba pri ukladaní zamestnanca.');
        }
      });

      if (this.dom.empReset) {
        this.dom.empReset.addEventListener('click', () => this.resetEmployeeForm());
      }
    },

    async deleteEmployee(id) {
      if (!confirm('Naozaj chceš vymazať zamestnanca?')) return;
      try {
        await api.post('/api/kancelaria/hr/employee/delete', { id });
        await this.loadEmployees();
      } catch (err) {
        alert(err.message || 'Chyba pri mazaní zamestnanca.');
      }
    },

    // ------------------------------------------------------------------
    // DOCHÁDZKA
    // ------------------------------------------------------------------
    bindAttendanceForm() {
      if (!this.dom.attForm) return;

      this.dom.attForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const payload = {
            id: this.dom.attId.value || null,
            employee_id: this.dom.attEmployee.value,
            work_date: this.dom.attDate.value,
            time_in: this.dom.attTimeIn.value,
            time_out: this.dom.attTimeOut.value,
            section_override: this.dom.attSectionOverride.value || null,
            note: this.dom.attNote.value || null
          };
          await api.post('/api/kancelaria/hr/attendance/save', payload);
          await this.loadAttendance();
          this.resetAttendanceForm();
        } catch (err) {
          alert(err.message || 'Chyba pri ukladaní dochádzky.');
        }
      });

      if (this.dom.attReset) {
        this.dom.attReset.addEventListener('click', () => this.resetAttendanceForm());
      }

      if (this.dom.attFilterBtn) {
        this.dom.attFilterBtn.addEventListener('click', () => this.loadAttendance());
      }
    },

    resetAttendanceForm() {
      this.dom.attId.value = '';
      this.dom.attForm.reset();
    },

    async loadAttendance() {
      if (!this.dom.attFilterFrom || !this.dom.attFilterTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.attFilterFrom.value) params.append('date_from', this.dom.attFilterFrom.value);
        if (this.dom.attFilterTo.value) params.append('date_to', this.dom.attFilterTo.value);
        if (this.dom.attFilterEmployee.value) params.append('employee_id', this.dom.attFilterEmployee.value);
        const data = await api.get('/api/kancelaria/hr/attendance?' + params.toString());
        this.renderAttendance(data.items || []);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Chyba pri načítaní dochádzky.');
      }
    },

    renderAttendance(items) {
      if (!this.dom.attTableBody) return;
      this.dom.attTableBody.innerHTML = '';

      items.forEach(it => {
        const tr = document.createElement('tr');

        const fmtTime = t => (t || '').toString().slice(0, 5);
        const hoursVal = it.worked_hours || 0;
        const hoursStr = (typeof hoursVal === 'number'
          ? hoursVal
          : Number(hoursVal || 0)).toFixed(2);

        tr.innerHTML = `
          <td>${(it.work_date || '').slice(0, 10)}</td>
          <td>${it.full_name || ''}</td>
          <td>${it.section_override || it.section || ''}</td>
          <td>${fmtTime(it.time_in)}</td>
          <td>${fmtTime(it.time_out)}</td>
          <td>${hoursStr}</td>
          <td>${it.note || ''}</td>
          <td>
            <button class="btn btn-sm btn-secondary hr-att-edit" data-id="${it.id}">Upraviť</button>
            <button class="btn btn-sm btn-danger hr-att-delete" data-id="${it.id}">X</button>
          </td>
        `;
        this.dom.attTableBody.appendChild(tr);
      });

      this.dom.attTableBody.querySelectorAll('.hr-att-edit').forEach(btn =>
        btn.addEventListener('click', () => this.fillAttendanceForm(btn.dataset.id, items))
      );
      this.dom.attTableBody.querySelectorAll('.hr-att-delete').forEach(btn =>
        btn.addEventListener('click', () => this.deleteAttendance(btn.dataset.id))
      );
    },

    fillAttendanceForm(id, items) {
      const it = items.find(r => String(r.id) === String(id));
      if (!it) return;
      this.dom.attId.value = it.id;
      this.dom.attEmployee.value = it.employee_id;
      this.dom.attDate.value = (it.work_date || '').slice(0, 10);
      this.dom.attTimeIn.value = (it.time_in || '').toString().slice(0, 5);
      this.dom.attTimeOut.value = (it.time_out || '').toString().slice(0, 5);
      this.dom.attSectionOverride.value = it.section_override || '';
      this.dom.attNote.value = it.note || '';
    },

    async deleteAttendance(id) {
      if (!confirm('Zmazať záznam dochádzky?')) return;
      try {
        await api.post('/api/kancelaria/hr/attendance/delete', { id });
        await this.loadAttendance();
      } catch (err) {
        alert(err.message || 'Chyba pri mazaní dochádzky.');
      }
    },

    // ------------------------------------------------------------------
    // NEPRÍTOMNOSTI
    // ------------------------------------------------------------------
    bindLeaveForm() {
      if (!this.dom.leaveForm) return;

      this.dom.leaveForm.addEventListener('submit', async (e) => {
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
            note: this.dom.leaveNote.value || null
          };
          await api.post('/api/kancelaria/hr/leave/save', payload);
          await this.loadLeaves();
          await this.loadEmployees(); // aktualizuje zostatky dovolenky
          this.resetLeaveForm();
        } catch (err) {
          alert(err.message || 'Chyba pri ukladaní neprítomnosti.');
        }
      });

      if (this.dom.leaveReset) {
        this.dom.leaveReset.addEventListener('click', () => this.resetLeaveForm());
      }

      if (this.dom.leaveFilterBtn) {
        this.dom.leaveFilterBtn.addEventListener('click', () => this.loadLeaves());
      }
    },

    resetLeaveForm() {
      this.dom.leaveId.value = '';
      this.dom.leaveForm.reset();
      if (this.dom.leaveFullDay) this.dom.leaveFullDay.checked = true;
    },

    async loadLeaves() {
      if (!this.dom.leaveFilterFrom || !this.dom.leaveFilterTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.leaveFilterFrom.value) params.append('date_from', this.dom.leaveFilterFrom.value);
        if (this.dom.leaveFilterTo.value) params.append('date_to', this.dom.leaveFilterTo.value);
        if (this.dom.leaveFilterEmployee.value) params.append('employee_id', this.dom.leaveFilterEmployee.value);
        const data = await api.get('/api/kancelaria/hr/leaves?' + params.toString());
        this.renderLeaves(data.items || []);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Chyba pri načítaní neprítomností.');
      }
    },

    renderLeaves(items) {
      if (!this.dom.leaveTableBody) return;
      this.dom.leaveTableBody.innerHTML = '';

      const typeLabel = t => {
        switch ((t || '').toUpperCase()) {
          case 'VACATION': return 'Dovolenka';
          case 'SICK': return 'PN';
          case 'PASS': return 'Priepustka';
          default: return 'Iné';
        }
      };

      items.forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${(it.date_from || '').slice(0, 10)}</td>
          <td>${(it.date_to || '').slice(0, 10)}</td>
          <td>${it.full_name || ''}</td>
          <td>${typeLabel(it.leave_type)}</td>
          <td>${Number(it.days_count || 0).toFixed(2)}</td>
          <td>${it.note || ''}</td>
          <td>
            <button class="btn btn-sm btn-secondary hr-leave-edit" data-id="${it.id}">Upraviť</button>
            <button class="btn btn-sm btn-danger hr-leave-delete" data-id="${it.id}">X</button>
          </td>
        `;
        this.dom.leaveTableBody.appendChild(tr);
      });

      this.dom.leaveTableBody.querySelectorAll('.hr-leave-edit').forEach(btn =>
        btn.addEventListener('click', () => this.fillLeaveForm(btn.dataset.id, items))
      );
      this.dom.leaveTableBody.querySelectorAll('.hr-leave-delete').forEach(btn =>
        btn.addEventListener('click', () => this.deleteLeave(btn.dataset.id))
      );
    },

    fillLeaveForm(id, items) {
      const it = items.find(r => String(r.id) === String(id));
      if (!it) return;
      this.dom.leaveId.value = it.id;
      this.dom.leaveEmployee.value = it.employee_id;
      this.dom.leaveFromDate.value = (it.date_from || '').slice(0, 10);
      this.dom.leaveToDate.value = (it.date_to || '').slice(0, 10);
      this.dom.leaveType.value = it.leave_type || 'VACATION';
      this.dom.leaveFullDay.checked = !!it.full_day;
      this.dom.leaveHours.value = it.hours || '';
      this.dom.leaveNote.value = it.note || '';
    },

    async deleteLeave(id) {
      if (!confirm('Zmazať neprítomnosť?')) return;
      try {
        await api.post('/api/kancelaria/hr/leave/delete', { id });
        await this.loadLeaves();
        await this.loadEmployees(); // refresh zostatkov dovolenky
      } catch (err) {
        alert(err.message || 'Chyba pri mazaní neprítomnosti.');
      }
    },

    // ------------------------------------------------------------------
    // SÚHRN NÁKLADOV
    // ------------------------------------------------------------------
    bindSummary() {
      if (!this.dom.sumRefresh) return;
      this.dom.sumRefresh.addEventListener('click', () => this.loadSummary());
    },

    async loadSummary() {
      if (!this.dom.sumFrom || !this.dom.sumTo) return;
      try {
        const params = new URLSearchParams();
        if (this.dom.sumFrom.value) params.append('date_from', this.dom.sumFrom.value);
        if (this.dom.sumTo.value) params.append('date_to', this.dom.sumTo.value);
        const data = await api.get('/api/kancelaria/hr/summary?' + params.toString());
        this.renderSummary(data);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Chyba pri načítaní súhrnu.');
      }
    },

    renderSummary(data) {
      if (this.dom.sumTotals) {
        this.dom.sumTotals.innerHTML = `
          <strong>Obdobie:</strong> ${data.period.date_from} – ${data.period.date_to}
          &nbsp; | &nbsp;
          <strong>Hodiny spolu:</strong> ${Number(data.total_hours || 0).toFixed(2)}
          &nbsp; | &nbsp;
          <strong>Náklady na prácu spolu:</strong> ${Number(data.total_labor_cost || 0).toFixed(2)} €
          &nbsp; | &nbsp;
          <strong>Vyrobené kg:</strong> ${Number(data.total_prod_kg || 0).toFixed(3)} kg
          &nbsp; | &nbsp;
          <strong>Práca na 1 kg:</strong> ${Number(data.cost_per_kg_total || 0).toFixed(4)} €/kg
        `;
      }

      if (this.dom.sumSectionsBody) {
        this.dom.sumSectionsBody.innerHTML = '';
        (data.sections || []).forEach(sec => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${sec.section}</td>
            <td>${Number(sec.hours || 0).toFixed(2)}</td>
            <td>${Number(sec.labor_cost || 0).toFixed(2)} €</td>
            <td>${Number(sec.cost_per_kg || 0).toFixed(4)} €/kg</td>
          `;
          this.dom.sumSectionsBody.appendChild(tr);
        });
      }

      if (this.dom.sumEmployeesBody) {
        this.dom.sumEmployeesBody.innerHTML = '';
        (data.employees || []).forEach(emp => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${emp.full_name}</td>
            <td>${emp.section}</td>
            <td>${Number(emp.hours || 0).toFixed(2)}</td>
            <td>${Number(emp.hourly_rate || 0).toFixed(4)} €/hod</td>
            <td>${Number(emp.labor_cost || 0).toFixed(2)} €</td>
          `;
          this.dom.sumEmployeesBody.appendChild(tr);
        });
      }
    }
  };

  document.addEventListener('DOMContentLoaded', () => HR.init());
})();
