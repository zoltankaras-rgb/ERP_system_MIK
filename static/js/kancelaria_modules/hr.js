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
      this.cacheDom();
      if (!this.dom.section) return; // stránka ešte nie je načítaná

      this.bindEmployeeForm();
      this.bindAttendanceForm();
      this.bindLeaveForm();
      this.bindSummary();

      this.initDefaultDates();
      this.loadEmployees().then(() => {
        this.loadAttendance();
        this.loadLeaves();
        this.loadSummary();
      }).catch(console.error);
    },

    cacheDom() {
      this.dom.section = document.getElementById('section-hr');

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

      // leave
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

      // summary
      this.dom.sumFrom = document.getElementById('hr-sum-from');
      this.dom.sumTo = document.getElementById('hr-sum-to');
      this.dom.sumRefresh = document.getElementById('hr-sum-refresh');
      this.dom.sumTotals = document.getElementById('hr-sum-totals');
      this.dom.sumSectionsBody = document.querySelector('#hr-sum-sections-table tbody');
      this.dom.sumEmployeesBody = document.querySelector('#hr-sum-employees-table tbody');
    },

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

    // ------------------------------------------------------------
    // Zamestnanci
    // ------------------------------------------------------------
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
        alert(err.message || 'Chyba pri mazání zamestnanca.');
      }
    },

    // ------------------------------------------------------------
    // Dochádzka
    // ------------------------------------------------------------
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

        tr.innerHTML = `
          <td>${(it.work_date || '').slice(0, 10)}</td>
          <td>${it.full_name || ''}</td>
          <td>${it.section_override || it.section || ''}</td>
          <td>${fmtTime(it.time_in)}</td>
          <td>${fmtTime(it.time_out)}</td>
          <td>${(it.worked_hours || 0).toFixed ? it.worked_hours.toFixed(2) : Number(it.worked_hours || 0).toFixed(2)}</td>
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

    // ------------------------------------------------------------
    // Neprítomnosti
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // Súhrn nákladov
    // ------------------------------------------------------------
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
