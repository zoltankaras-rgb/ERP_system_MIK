// ======================================================================
// ENTERPRISE PLÁNOVACÍ KALENDÁR – FRONTEND MODUL
// - mesačná mriežka (ako papierový kalendár)
// - klik na deň -> modal s udalosťami a formulárom
// - používa /api/calendar/events (GET, POST)
// - používa globálnu apiRequest(), showModal(), showStatus()
// ======================================================================

const CAL_ESC = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s || ''));

function ensureCalendarStyles() {
  if (document.getElementById('erp-calendar-styles')) return;
  const s = document.createElement('style');
  s.id = 'erp-calendar-styles';
  s.textContent = `
    #section-enterprise-calendar .erp-calendar-header{
      display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem;
      justify-content:space-between; flex-wrap:wrap;
    }
    #section-enterprise-calendar .erp-calendar-header-left{
      display:flex; align-items:center; gap:.25rem;
    }
    #section-enterprise-calendar .erp-calendar-month-label{
      font-weight:600; font-size:1.1rem; margin:0 .5rem;
    }
    #section-enterprise-calendar .erp-calendar-grid{
      display:grid;
      grid-template-columns: repeat(7, minmax(110px,1fr));
      gap:4px;
    }
    #section-enterprise-calendar .erp-calendar-daynames{
      display:grid;
      grid-template-columns: repeat(7, minmax(110px,1fr));
      gap:4px;
      margin-bottom:2px;
      font-size:.8rem;
      color:#6b7280;
      text-transform:uppercase;
      letter-spacing:.03em;
    }
    #section-enterprise-calendar .erp-calendar-dayname{
      text-align:center;
      padding:2px 0;
    }
    #section-enterprise-calendar .erp-calendar-cell{
      border-radius:8px;
      border:1px solid #e5e7eb;
      background:#fff;
      min-height:90px;
      display:flex;
      flex-direction:column;
      padding:4px 6px;
      cursor:pointer;
      transition:box-shadow .12s ease, transform .06s ease;
      overflow:hidden;
    }
    #section-enterprise-calendar .erp-calendar-cell:hover{
      box-shadow:0 2px 4px rgba(0,0,0,.08);
      transform:translateY(-1px);
    }
    #section-enterprise-calendar .erp-calendar-cell.other-month{
      background:#f9fafb;
      color:#9ca3af;
    }
    #section-enterprise-calendar .erp-calendar-cell.today{
      border:2px solid var(--primary-color, #2563eb);
    }
    #section-enterprise-calendar .erp-calendar-cell-header{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:.25rem;
      margin-bottom:2px;
    }
    #section-enterprise-calendar .erp-calendar-day-number{
      font-weight:600;
      font-size:.9rem;
    }
    #section-enterprise-calendar .erp-calendar-add-btn{
      border:0;
      background:transparent;
      cursor:pointer;
      font-size:.7rem;
      width:1.35rem; height:1.35rem;
      border-radius:999px;
      display:flex; align-items:center; justify-content:center;
      color:#6b7280;
    }
    #section-enterprise-calendar .erp-calendar-add-btn:hover{
      background:#e5e7eb;
      color:#111827;
    }
    #section-enterprise-calendar .erp-calendar-cell-body{
      margin-top:2px;
      font-size:.72rem;
      line-height:1.2;
      max-height:70px;
      overflow-y:auto;
      padding-right:2px;
    }
    #section-enterprise-calendar .erp-calendar-event-pill{
      border-radius:999px;
      padding:1px 6px;
      margin-bottom:2px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      background:#e5e7eb;
      font-size:.7rem;
    }
    #section-enterprise-calendar .erp-calendar-event-pill.high{
      background:#fee2e2;
      color:#b91c1c;
      font-weight:600;
    }
    #section-enterprise-calendar .erp-calendar-event-pill.critical{
      background:#f97373;
      color:#fff;
      font-weight:700;
    }
    #section-enterprise-calendar .erp-calendar-more{
      font-size:.7rem;
      color:#9ca3af;
    }
    #section-enterprise-calendar .erp-calendar-day-summary{
      font-size:.85rem;
      color:#4b5563;
    }
    #section-enterprise-calendar .erp-calendar-day-summary ul{
      margin:.25rem 0 0; padding-left:1.1rem;
    }
  `;
  document.head.appendChild(s);
}

const CAL_MONTH_NAMES = [
  'Január','Február','Marec','Apríl','Máj','Jún',
  'Júl','August','September','Október','November','December'
];
const CAL_DAY_NAMES = ['Po','Ut','St','Št','Pi','So','Ne'];

function calPad(n){ return String(n).padStart(2,'0'); }
function calDateKey(d){
  return `${d.getFullYear()}-${calPad(d.getMonth()+1)}-${calPad(d.getDate())}`;
}

// pomocná API funkcia
async function calendarApi(url, opts = {}) {
  return apiRequest(url, opts);
}

// ======================================================================
// HLAVNÝ MODUL
// ======================================================================
function initializeEnterpriseCalendar(){
  ensureCalendarStyles();
  const root = document.getElementById('section-enterprise-calendar');
  if (!root) return;

  root.innerHTML = `
    <h3>Enterprise Plánovací Kalendár</h3>
    <div class="analysis-card">
      <div class="erp-calendar-header">
        <div class="erp-calendar-header-left">
          <button class="btn btn-secondary btn-xs" id="erp-cal-prev"><i class="fas fa-chevron-left"></i></button>
          <div class="erp-calendar-month-label" id="erp-cal-month-label">—</div>
          <button class="btn btn-secondary btn-xs" id="erp-cal-next"><i class="fas fa-chevron-right"></i></button>
          <button class="btn btn-light btn-xs" id="erp-cal-today">Dnes</button>
        </div>
        <div>
          <!-- priestor pre budúce filtre (typ udalosti, zdroj atď.) -->
        </div>
      </div>
      <div class="erp-calendar-daynames" id="erp-cal-daynames"></div>
      <div class="erp-calendar-grid" id="erp-cal-grid"></div>
    </div>

    <div class="analysis-card" style="margin-top:1rem;">
      <h4>Vybraný deň</h4>
      <div id="erp-cal-day-summary" class="erp-calendar-day-summary">
        Klikni na deň v kalendári.
      </div>
    </div>
  `;

  const state = {
    currentMonth: (()=>{
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    })(),
    eventsByDay: {}, // { 'YYYY-MM-DD': [event, ...] }
  };

  const daynamesEl = document.getElementById('erp-cal-daynames');
  daynamesEl.innerHTML = CAL_DAY_NAMES.map(n => `<div class="erp-calendar-dayname">${n}</div>`).join('');

  const gridEl = document.getElementById('erp-cal-grid');
  const lblEl  = document.getElementById('erp-cal-month-label');
  const summaryEl = document.getElementById('erp-cal-day-summary');

  async function reloadMonth(){
    await loadEventsForMonth(state);
    renderMonth(state);
  }

  async function loadEventsForMonth(st){
    const year = st.currentMonth.getFullYear();
    const month = st.currentMonth.getMonth();
    const start = new Date(year, month, 1);
    const end   = new Date(year, month + 1, 0);

    const params = new URLSearchParams();
    params.set('start', `${start.getFullYear()}-${calPad(start.getMonth()+1)}-${calPad(start.getDate())}T00:00`);
    params.set('end',   `${end.getFullYear()}-${calPad(end.getMonth()+1)}-${calPad(end.getDate())}T23:59`);

    const res = await calendarApi('/api/calendar/events?' + params.toString());
    const list = Array.isArray(res) ? res : [];
    const byDay = {};

    list.forEach(ev => {
      // očakávame ISO string v ev.start
      const d = new Date(ev.start);
      const key = calDateKey(d);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(ev);
    });

    st.eventsByDay = byDay;
  }

  function renderMonth(st){
    const year = st.currentMonth.getFullYear();
    const month = st.currentMonth.getMonth();
    lblEl.textContent = `${CAL_MONTH_NAMES[month]} ${year}`;

    // prvý deň mesiaca
    const first = new Date(year, month, 1);
    const jsDow = first.getDay(); // 0=Ne,1=Po,...
    const mondayIndex = (jsDow + 6) % 7; // 0=Po
    const startDate = new Date(year, month, 1 - mondayIndex);

    const todayKey = calDateKey(new Date());

    let html = '';
    for (let i = 0; i < 42; i++){
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = calDateKey(d);
      const isOtherMonth = d.getMonth() !== month;
      const isToday = key === todayKey;
      const events = st.eventsByDay[key] || [];

      const classes = [
        'erp-calendar-cell',
        isOtherMonth ? 'other-month' : '',
        isToday ? 'today' : '',
      ].join(' ');

      let pills = '';
      events.slice(0,3).forEach(ev => {
        let prioClass = '';
        if (ev.priority === 'HIGH') prioClass = 'high';
        if (ev.priority === 'CRITICAL') prioClass = 'critical';
        pills += `<div class="erp-calendar-event-pill ${prioClass}">${CAL_ESC(ev.title)}</div>`;
      });
      if (events.length > 3){
        pills += `<div class="erp-calendar-more">+${events.length - 3} ďalších...</div>`;
      }

      html += `
        <div class="${classes}" data-date="${key}">
          <div class="erp-calendar-cell-header">
            <span class="erp-calendar-day-number">${d.getDate()}</span>
            <button class="erp-calendar-add-btn" data-date="${key}" title="Pridať udalosť">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <div class="erp-calendar-cell-body">
            ${pills}
          </div>
        </div>
      `;
    }

    gridEl.innerHTML = html;

    // kliky na bunky / plusko
    gridEl.querySelectorAll('.erp-calendar-cell').forEach(cell=>{
      const dateKey = cell.getAttribute('data-date');
      cell.addEventListener('click', (e)=>{
        if (e.target.closest('.erp-calendar-add-btn')) return;
        openDayModal(dateKey, st);
      });
    });
    gridEl.querySelectorAll('.erp-calendar-add-btn').forEach(btn=>{
      const dateKey = btn.getAttribute('data-date');
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        openDayModal(dateKey, st, true);
      });
    });

    // nastaviť summary na aktuálny mesiac bez konkrétneho dňa
    summaryEl.textContent = 'Klikni na deň v kalendári.';
  }

  function openDayModal(dateKey, st, createOnly=false){
    const events = st.eventsByDay[dateKey] || [];
    const [year, month, day] = dateKey.split('-');

    const summaryEl = document.getElementById('erp-cal-day-summary');
    if (summaryEl){
      if (!events.length){
        summaryEl.innerHTML = `Deň <strong>${day}.${month}.${year}</strong> – žiadne udalosti.`;
      } else {
        summaryEl.innerHTML = `
          <div>Deň <strong>${day}.${month}.${year}</strong> – ${events.length} udalostí:</div>
          <ul>
            ${events.map(ev=>`<li>${CAL_ESC(ev.title)} (${CAL_ESC(ev.type || '')})</li>`).join('')}
          </ul>
        `;
      }
    }

    showModal(`Kalendár – ${day}.${month}.${year}`, () => {
      const eventsHtml = !events.length ? '<p>Žiadne udalosti v tento deň.</p>' :
        `<ul>${events.map(ev=>`<li><strong>${CAL_ESC(ev.title)}</strong> (${CAL_ESC(ev.type || '')})</li>`).join('')}</ul>`;

      const html = `
        <div class="form-grid" style="grid-template-columns: minmax(240px, 1.2fr) minmax(260px, 1.3fr); gap:1rem;">
          <div>
            <h5>Udalosti v tento deň</h5>
            <div style="font-size:.85rem;">${eventsHtml}</div>
          </div>
          <div>
            <h5>Nová udalosť</h5>
            <form id="erp-cal-event-form">
              <input type="hidden" name="date" value="${dateKey}">
              <div class="form-group">
                <label>Názov udalosti</label>
                <input name="title" required>
              </div>
              <div class="form-group">
                <label>Typ</label>
                <select name="event_type" required>
                  <option value="MEETING">Stretnutie</option>
                  <option value="TENDER">Verejné obstarávanie / Súťaž</option>
                  <option value="VACATION">Dovolenka</option>
                  <option value="ABSENCE">Absencia</option>
                  <option value="SERVICE">Servis / Správa majetku</option>
                  <option value="TASK">Deadline / Úloha</option>
                </select>
              </div>
              <div class="form-group">
                <label>Čas</label>
                <div style="display:flex; gap:.5rem; align-items:center;">
                  <input type="time" name="start_time" value="08:00">
                  <span>–</span>
                  <input type="time" name="end_time" value="16:00">
                </div>
                <label style="margin-top:.25rem; display:flex; align-items:center; gap:.25rem; font-size:.85rem;">
                  <input type="checkbox" name="all_day">
                  Celý deň
                </label>
              </div>
              <div class="form-group">
                <label>Priorita</label>
                <select name="priority">
                  <option value="LOW">Nízka</option>
                  <option value="NORMAL" selected>Normálna</option>
                  <option value="HIGH">Vysoká</option>
                  <option value="CRITICAL">Kritická</option>
                </select>
              </div>
              <div class="form-group">
                <label>Farba (voliteľné)</label>
                <input type="color" name="color_hex" value="#2563eb" style="padding:0; border:0; background:transparent;">
              </div>
              <div class="form-group">
                <label>Poznámka</label>
                <textarea name="description" rows="3"></textarea>
              </div>

              <fieldset style="border:1px solid #e5e7eb; border-radius:8px; padding:.5rem .75rem; margin-top:.5rem;">
                <legend style="font-size:.85rem; padding:0 .25rem;">Notifikácia</legend>
                <label style="display:flex; align-items:center; gap:.35rem; font-size:.9rem; margin-bottom:.35rem;">
                  <input type="checkbox" name="notify_enabled">
                  Poslať pripomienku k udalosti
                </label>
                <div class="form-grid" style="grid-template-columns: repeat(2, minmax(100px,1fr)); gap:.5rem;">
                  <div class="form-group">
                    <label>Pred (minút)</label>
                    <input type="number" name="notify_before" value="60" min="0" step="5">
                  </div>
                  <div class="form-group">
                    <label>Kanál</label>
                    <select name="notify_channel">
                      <option value="EMAIL">E‑mail</option>
                      <option value="SMS">SMS</option>
                      <option value="BOTH">E‑mail + SMS</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Komu</label>
                    <select name="notify_target">
                      <option value="CREATOR">Len mne (tvorca)</option>
                      <option value="ALL_ATTENDEES">Všetkým účastníkom</option>
                    </select>
                  </div>
                </div>
              </fieldset>

              <div class="form-group" style="margin-top:.75rem;">
                <button class="btn btn-success w-full"><i class="fas fa-save"></i> Uložiť udalosť</button>
              </div>
            </form>
          </div>
        </div>
      `;

      return {
        html,
        onReady: () => {
          const f = document.getElementById('erp-cal-event-form');
          const allDayCheckbox = f.querySelector('input[name="all_day"]');
          const startTimeInput = f.querySelector('input[name="start_time"]');
          const endTimeInput   = f.querySelector('input[name="end_time"]');

          function syncAllDay(){
            const allDay = allDayCheckbox.checked;
            startTimeInput.disabled = allDay;
            endTimeInput.disabled = allDay;
          }
          allDayCheckbox.addEventListener('change', syncAllDay);
          syncAllDay();

          f.onsubmit = async (e) => {
            e.preventDefault();
            await submitNewEventForm(f, dateKey, state);
          };
        }
      };
    });
  }

  async function submitNewEventForm(form, dateKey, st){
    const fd = new FormData(form);
    const title = (fd.get('title') || '').trim();
    if (!title){
      showStatus('Zadaj názov udalosti.', true);
      return;
    }
    const type = fd.get('event_type');
    const allDay = form.querySelector('input[name="all_day"]').checked;

    let startISO, endISO;
    if (allDay){
      startISO = `${dateKey}T00:00`;
      endISO   = `${dateKey}T23:59`;
    } else {
      const st = fd.get('start_time') || '08:00';
      const et = fd.get('end_time') || '16:00';
      startISO = `${dateKey}T${st}`;
      endISO   = `${dateKey}T${et}`;
    }

    const priority = fd.get('priority') || 'NORMAL';
    const colorHex = fd.get('color_hex') || null;
    const description = fd.get('description') || '';

    // Notifikácie
    const notifyEnabled = form.querySelector('input[name="notify_enabled"]').checked;
    const reminders = [];
    if (notifyEnabled){
      const beforeMin = parseInt(fd.get('notify_before') || '0', 10);
      const channel   = fd.get('notify_channel') || 'EMAIL';
      const target    = fd.get('notify_target') || 'CREATOR';
      if (beforeMin > 0){
        reminders.push({
          minutes_before: beforeMin,
          channel: channel,
          target_type: target,
          anchor_field: 'start_at'
        });
      }
    }

    const payload = {
      title: title,
      type: type,
      start_at: startISO,
      end_at: endISO,
      all_day: allDay,
      priority: priority,
      description: description,
      color_hex: colorHex,
      attendee_ids: [],      // zatiaľ prázdne, dá sa rozšíriť
      resource_ids: [],      // sem vieš neskôr prepojiť auto, zasadačku atď.
      reminders: reminders,
      type_specific: {}      // sem v ďalšom kroku doplníme VO, servis, projekty...
    };

    try{
      const res = await calendarApi('/api/calendar/events', {
        method: 'POST',
        body: payload
      });
      if (res && res.error){
        showStatus(res.error, true);
        return;
      }

      showStatus('Udalosť uložená.', false);
      // zavri modal
      const modal = document.getElementById('modal-container');
      if (modal) modal.style.display = 'none';

      // reload aktuálneho mesiaca
      await loadEventsForMonth(st);
      renderMonth(st);
    } catch (e){
      console.error('calendar create error', e);
      showStatus('Chyba pri ukladaní udalosti.', true);
    }
  }

  // navigácia mesiacov
  document.getElementById('erp-cal-prev').onclick = async () => {
    state.currentMonth = new Date(
      state.currentMonth.getFullYear(),
      state.currentMonth.getMonth() - 1,
      1
    );
    await reloadMonth();
  };
  document.getElementById('erp-cal-next').onclick = async () => {
    state.currentMonth = new Date(
      state.currentMonth.getFullYear(),
      state.currentMonth.getMonth() + 1,
      1
    );
    await reloadMonth();
  };
  document.getElementById('erp-cal-today').onclick = async () => {
    const d = new Date();
    state.currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    await reloadMonth();
  };

  // prvé načítanie
  reloadMonth();
}

// auto-init po načítaní
(function(){
  const root = document.getElementById('section-enterprise-calendar');
  if (root) initializeEnterpriseCalendar();
})();
