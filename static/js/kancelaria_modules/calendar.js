// ======================================================================
// ENTERPRISE PLÁNOVACÍ KALENDÁR (frontend modul)
// - mesačný kalendár
// - klik na deň -> modal s udalosťami + formulár
// - kontaktné osoby (calendar_contacts)
// - status udalosti: OPEN / DONE / CANCELLED
// ======================================================================

(function(){

  // --------------------------------------------------------------------
  // CSS len pre tento modul
  // --------------------------------------------------------------------
  function ensureCalendarStyles(){
    if (document.getElementById('calendar-inline-styles')) return;
    const s = document.createElement('style');
    s.id = 'calendar-inline-styles';
    s.textContent = `
      #section-calendar .erp-calendar-header{
        display:flex;
        justify-content:space-between;
        align-items:center;
        margin-bottom:.5rem;
      }
      #section-calendar .erp-calendar-header-left{
        display:flex;
        gap:.35rem;
        align-items:center;
      }
      #section-calendar .erp-calendar-month-label{
        font-weight:600;
        font-size:1.05rem;
        min-width:9rem;
        text-align:center;
      }
      #section-calendar .erp-calendar-daynames{
        display:grid;
        grid-template-columns:repeat(7,1fr);
        gap:2px;
        margin-bottom:2px;
        font-size:.8rem;
        color:#6b7280;
        text-align:center;
      }
      #section-calendar .erp-calendar-dayname{
        padding:2px 0;
      }
      #section-calendar .erp-calendar-grid{
        display:grid;
        grid-template-columns:repeat(7,1fr);
        gap:4px;
      }
      #section-calendar .erp-calendar-cell{
        border-radius:.35rem;
        border:1px solid #e5e7eb;
        padding:3px 4px;
        min-height:4.5rem;
        background:#ffffff;
        display:flex;
        flex-direction:column;
      }
      #section-calendar .erp-calendar-cell.other-month{
        background:#f9fafb;
        color:#9ca3af;
      }
      #section-calendar .erp-calendar-cell.today{
        border-color:#2563eb;
        box-shadow:0 0 0 1px rgba(37,99,235,.4);
      }
      #section-calendar .erp-calendar-cell-header{
        display:flex;
        justify-content:space-between;
        align-items:center;
      }
      #section-calendar .erp-calendar-day-number{
        font-weight:600;
        font-size:.9rem;
      }
      #section-calendar .erp-calendar-add-btn{
        border:0;
        background:transparent;
        cursor:pointer;
        font-size:.7rem;
        width:1.35rem;
        height:1.35rem;
        border-radius:999px;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#6b7280;
      }
      #section-calendar .erp-calendar-add-btn:hover{
        background:#e5e7eb;
        color:#111827;
      }
      #section-calendar .erp-calendar-cell-body{
        margin-top:2px;
        font-size:.72rem;
        line-height:1.2;
        max-height:74px;
        overflow-y:auto;
        padding-right:2px;
      }
      #section-calendar .erp-calendar-event-pill{
        border-radius:999px;
        padding:1px 6px;
        margin-bottom:2px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        background:#e5e7eb;
        font-size:.7rem;
      }
      #section-calendar .erp-calendar-event-pill.high{
        background:#fee2e2;
        color:#b91c1c;
        font-weight:600;
      }
      #section-calendar .erp-calendar-event-pill.critical{
        background:#f97373;
        color:#fff;
        font-weight:700;
      }
      #section-calendar .erp-calendar-event-pill.done{
        opacity:.5;
        text-decoration:line-through;
      }
      #section-calendar .erp-calendar-more{
        font-size:.7rem;
        color:#9ca3af;
      }
      #section-calendar .erp-calendar-day-summary{
        font-size:.85rem;
        color:#4b5563;
      }
      #section-calendar .erp-calendar-day-summary ul{
        margin:.25rem 0 0;
        padding-left:1.1rem;
      }
      #section-calendar .badge-status{
        display:inline-block;
        padding:0 6px;
        border-radius:999px;
        font-size:.65rem;
        border:1px solid #e5e7eb;
        margin-left:.25rem;
      }
      #section-calendar .badge-status.OPEN{
        background:#ecfdf3;
        border-color:#bbf7d0;
        color:#15803d;
      }
      #section-calendar .badge-status.DONE{
        background:#eff6ff;
        border-color:#bfdbfe;
        color:#1d4ed8;
      }
      #section-calendar .badge-status.CANCELLED{
        background:#fef2f2;
        border-color:#fecaca;
        color:#b91c1c;
      }
    `;
    document.head.appendChild(s);
  }

  const CAL_ESC = (s)=> (window.escapeHtml ? window.escapeHtml(s) : String(s || ''));

  const CAL_MONTH_NAMES = [
    'Január','Február','Marec','Apríl','Máj','Jún',
    'Júl','August','September','Október','November','December'
  ];
  const CAL_DAY_NAMES = ['Po','Ut','St','Št','Pi','So','Ne'];

  function calPad(n){ return String(n).padStart(2,'0'); }
  function calDateKey(d){
    return `${d.getFullYear()}-${calPad(d.getMonth()+1)}-${calPad(d.getDate())}`;
  }

  // --------------------------------------------------------------------
  // API helpery
  // --------------------------------------------------------------------
  async function calendarApi(url, opts = {}){
    return apiRequest(url, opts); // z common.js
  }

  async function calendarFetchEvents(range = {}){
    const params = new URLSearchParams();
    if (range.start instanceof Date) params.set('start', range.start.toISOString().slice(0,16));
    if (range.end   instanceof Date) params.set('end',   range.end.toISOString().slice(0,16));
    if (range.type)                  params.set('type',  range.type);
    if (range.resource_id)           params.set('resource_id', range.resource_id);
    const url = '/api/calendar/events?' + params.toString();
    return await calendarApi(url);
  }

  async function calendarCreateOrUpdateEvent(payload){
    return await calendarApi('/api/calendar/events', {
      method: 'POST',
      body: payload
    });
  }

  // kontaktné osoby
  let CAL_CONTACTS_CACHE = [];

  async function calendarFetchContacts(){
    const res = await calendarApi('/api/calendar/contacts');
    CAL_CONTACTS_CACHE = Array.isArray(res) ? res : [];
    return CAL_CONTACTS_CACHE;
  }

  async function calendarSaveContact(body){
    return await calendarApi('/api/calendar/contacts', {
      method: 'POST',
      body
    });
  }

  // --------------------------------------------------------------------
  // Hlavný modul – mesačný kalendár
  // --------------------------------------------------------------------
  function initializeCalendarModule(){
    ensureCalendarStyles();
    const root = document.getElementById('section-calendar');
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
      currentMonth: (()=> {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1);
      })(),
      eventsByDay: {} // { 'YYYY-MM-DD': [event, ...] }
    };

    const daynamesEl = document.getElementById('erp-cal-daynames');
    daynamesEl.innerHTML = CAL_DAY_NAMES
      .map(n => `<div class="erp-calendar-dayname">${n}</div>`)
      .join('');

    const gridEl    = document.getElementById('erp-cal-grid');
    const lblEl     = document.getElementById('erp-cal-month-label');
    const summaryEl = document.getElementById('erp-cal-day-summary');

    async function reloadMonth(){
      await loadEventsForMonth(state);
      renderMonth(state);
    }

    async function loadEventsForMonth(st){
      const year  = st.currentMonth.getFullYear();
      const month = st.currentMonth.getMonth();
      const start = new Date(year, month, 1);
      const end   = new Date(year, month + 1, 0);

      const res = await calendarFetchEvents({ start, end });
      if (res && res.__error){
        console.warn('calendar events load error', res.__error);
      }
      const list = Array.isArray(res) ? res : [];
      const byDay = {};

      list.forEach(ev => {
        const d = new Date(ev.start || ev.start_at);
        if (isNaN(d)) return;
        const key = calDateKey(d);
        if (!byDay[key]) byDay[key] = [];
        // doplň defaulty
        ev.priority = (ev.priority || 'NORMAL').toString().toUpperCase();
        ev.status   = (ev.status || 'OPEN').toString().toUpperCase();
        byDay[key].push(ev);
      });

      st.eventsByDay = byDay;
    }

    function renderMonth(st){
      const year  = st.currentMonth.getFullYear();
      const month = st.currentMonth.getMonth();
      lblEl.textContent = `${CAL_MONTH_NAMES[month]} ${year}`;

      const first = new Date(year, month, 1);
      const jsDow = first.getDay();           // 0=Ne,1=Po
      const mondayIndex = (jsDow + 6) % 7;    // 0=Po
      const startDate = new Date(year, month, 1 - mondayIndex);

      const todayKey = calDateKey(new Date());

      let html = '';
      for (let i = 0; i < 42; i++){
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const key = calDateKey(d);
        const isOtherMonth = d.getMonth() !== month;
        const isToday      = key === todayKey;
        const events       = st.eventsByDay[key] || [];

        const classes = [
          'erp-calendar-cell',
          isOtherMonth ? 'other-month' : '',
          isToday ? 'today' : ''
        ].join(' ');

        let pills = '';
        events.slice(0,3).forEach(ev => {
          const pr = (ev.priority || '').toString().toUpperCase();
          const stStatus = (ev.status || '').toString().toUpperCase();
          let prioClass = '';
          if (pr === 'HIGH')      prioClass = 'high';
          if (pr === 'CRITICAL')  prioClass = 'critical';
          const doneClass = (stStatus === 'DONE' || stStatus === 'CANCELLED') ? 'done' : '';
          pills += `<div class="erp-calendar-event-pill ${prioClass} ${doneClass}">${CAL_ESC(ev.title)}</div>`;
        });
        if (events.length > 3){
          pills += `<div class="erp-calendar-more">+${events.length - 3} ďalších.</div>`;
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

      gridEl.querySelectorAll('.erp-calendar-cell').forEach(cell=>{
        const dateKey = cell.getAttribute('data-date');
        cell.addEventListener('click', (e)=>{
          if (e.target.closest('.erp-calendar-add-btn')) return;
          openDayModal(dateKey, state);
        });
      });
      gridEl.querySelectorAll('.erp-calendar-add-btn').forEach(btn=>{
        const dateKey = btn.getAttribute('data-date');
        btn.addEventListener('click', (e)=>{
          e.stopPropagation();
          openDayModal(dateKey, state, true);
        });
      });

      summaryEl.textContent = 'Klikni na deň v kalendári.';
    }

    // --------------------------------------------------------------
    // Modal pre deň
    // --------------------------------------------------------------
    function openDayModal(dateKey, st, createNew = false){
      const events = st.eventsByDay[dateKey] || [];
      const niceDate = dateKey.split('-').reverse().join('.');

      const eventsHtml = events.length ? `
        <ul>
          ${events.map(ev => {
            const pr = (ev.priority || '').toString().toUpperCase();
            const stStatus = (ev.status || 'OPEN').toString().toUpperCase();
            const timePart = (() => {
              const d = new Date(ev.start || ev.start_at);
              if (isNaN(d)) return '';
              const hh = calPad(d.getHours());
              const mm = calPad(d.getMinutes());
              return ` (${hh}:${mm})`;
            })();
            return `
              <li>
                <strong>${CAL_ESC(ev.title)}</strong>
                <span class="badge-status ${stStatus}">${stStatus}</span>
                ${timePart}
                <div style="margin-top:2px; display:flex; gap:.25rem; flex-wrap:wrap;">
                  <button class="btn btn-xs btn-secondary" data-ev-edit="${ev.id}">
                    <i class="fas fa-pen"></i> Upraviť
                  </button>
                  <button class="btn btn-xs btn-outline-success" data-ev-done="${ev.id}">
                    <i class="fas fa-check"></i> Splnené
                  </button>
                  <button class="btn btn-xs btn-outline-danger" data-ev-cancel="${ev.id}">
                    <i class="fas fa-ban"></i> Zrušiť
                  </button>
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      ` : `<p>Žiadne udalosti v tento deň.</p>`;

      showModal(`Udalosti ${niceDate}`, () => {
        const html = `
          <div class="form-grid" style="grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.3fr); gap:1rem;">
            <div>
              <h5>Udalosti v tento deň</h5>
              <div class="erp-calendar-day-summary">${eventsHtml}</div>
            </div>
            <div>
              <h5>${createNew ? 'Nová udalosť' : 'Upraviť / vytvoriť udalosť'}</h5>
              <form id="erp-cal-event-form">
                <input type="hidden" name="event_id">
                <div class="form-grid" style="grid-template-columns:repeat(2,minmax(140px,1fr));gap:.5rem;">
                  <div class="form-group" style="grid-column:1/-1;">
                    <label>Názov udalosti</label>
                    <input name="title" required>
                  </div>
                  <div class="form-group">
                    <label>Typ</label>
                    <select name="type">
                      <option value="MEETING">Stretnutie</option>
                      <option value="TENDER">Verejné obstarávanie / Súťaž</option>
                      <option value="TASK">Úloha / Deadline</option>
                      <option value="SERVICE">Servis / STK / EK</option>
                      <option value="VACATION">Dovolenka</option>
                      <option value="ABSENCE">Absencia</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Priorita</label>
                    <select name="priority">
                      <option value="NORMAL">Normálna</option>
                      <option value="HIGH">Vysoká</option>
                      <option value="CRITICAL">Kritická</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Stav</label>
                    <select name="status">
                      <option value="OPEN">Otvorená</option>
                      <option value="DONE">Splnená</option>
                      <option value="CANCELLED">Zrušená</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Celý deň</label>
                    <label style="display:flex;align-items:center;gap:.4rem;">
                      <input type="checkbox" name="all_day">
                      <span>Bez konkrétneho času</span>
                    </label>
                  </div>
                </div>

                <div class="form-grid" style="grid-template-columns:repeat(2,minmax(140px,1fr));gap:.5rem;margin-top:.5rem;">
                  <div class="form-group">
                    <label>Dátum</label>
                    <input type="date" name="date" value="${dateKey}" required>
                  </div>
                  <div class="form-group">
                    <label>Začiatok</label>
                    <input type="time" name="start_time" value="08:00">
                  </div>
                  <div class="form-group">
                    <label>Koniec</label>
                    <input type="time" name="end_time" value="09:00">
                  </div>
                  <div class="form-group">
                    <label>Miesto / Asset</label>
                    <input name="location" placeholder="Zasadačka / Vozidlo / Projekt">
                  </div>
                </div>

                <div class="form-group" style="margin-top:.5rem;">
                  <label>Popis / poznámka</label>
                  <textarea name="description" rows="3"></textarea>
                </div>

                <fieldset style="margin-top:.75rem;">
                  <legend>Kontakt – osoba pre notifikácie</legend>
                  <div class="form-grid" style="grid-template-columns:minmax(140px,1fr) auto;gap:.5rem;">
                    <div class="form-group">
                      <label>Meno kontaktu</label>
                      <input list="cal-contacts-datalist" id="cal-contact-name" name="contact_name" placeholder="Vyber zo zoznamu alebo napíš nové meno">
                      <datalist id="cal-contacts-datalist"></datalist>
                      <input type="hidden" id="cal-contact-id" name="contact_id">
                    </div>
                    <div class="form-group" style="align-self:end;">
                      <button type="button" class="btn btn-secondary btn-xs" id="cal-contact-manage">
                        <i class="fas fa-user-plus"></i> Nový / Upraviť kontakt
                      </button>
                    </div>
                  </div>
                </fieldset>

                <fieldset style="margin-top:.75rem;">
                  <legend>Notifikácia (jednoduchá pripomienka)</legend>
                  <div class="form-grid" style="grid-template-columns:repeat(3,minmax(120px,1fr));gap:.5rem;">
                    <div class="form-group">
                      <label>Pred (minút)</label>
                      <input type="number" name="notify_before" value="60" min="0" step="5">
                    </div>
                    <div class="form-group">
                      <label>Kanál</label>
                      <select name="notify_channel">
                        <option value="">Žiadna (bez pripomienky)</option>
                        <option value="EMAIL">E‑mail</option>
                        <option value="SMS">SMS</option>
                        <option value="BOTH">E‑mail + SMS</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Komu</label>
                      <select name="notify_target">
                        <option value="CREATOR">Len mne (tvorca)</option>
                        <option value="CONTACT">Kontaktnej osobe</option>
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
          onReady: async () => {
            const f = document.getElementById('erp-cal-event-form');
            const allDayCheckbox = f.querySelector('input[name="all_day"]');
            const startTimeInput = f.querySelector('input[name="start_time"]');
            const endTimeInput   = f.querySelector('input[name="end_time"]');
            const contactNameInput = document.getElementById('cal-contact-name');
            const contactIdInput   = document.getElementById('cal-contact-id');
            const contactManageBtn = document.getElementById('cal-contact-manage');

            function syncAllDay(){
              const allDay = allDayCheckbox.checked;
              startTimeInput.disabled = allDay;
              endTimeInput.disabled   = allDay;
            }
            allDayCheckbox.addEventListener('change', syncAllDay);
            syncAllDay();

            // načítaj kontakty do datalistu
            await loadContactsIntoDatalist(contactNameInput, contactIdInput);

            // klik "upraviť" pri udalosti -> naplní formulár
            const modalBody = document.querySelector('#modal-container .modal-body');
            if (modalBody){
              modalBody.querySelectorAll('[data-ev-edit]').forEach(btn=>{
                const evId = btn.getAttribute('data-ev-edit');
                btn.onclick = (e)=>{
                  e.preventDefault();
                  const ev = events.find(x=> String(x.id) === String(evId));
                  if (!ev) return;
                  fillFormFromEvent(f, ev, dateKey);
                };
              });

              // rýchle „Splnené“ / „Zrušené“
              modalBody.querySelectorAll('[data-ev-done]').forEach(btn=>{
                const evId = btn.getAttribute('data-ev-done');
                btn.onclick = async (e)=>{
                  e.preventDefault();
                  const ev = events.find(x=> String(x.id) === String(evId));
                  if (!ev) return;
                  await quickUpdateStatus(ev, 'DONE');
                };
              });
              modalBody.querySelectorAll('[data-ev-cancel]').forEach(btn=>{
                const evId = btn.getAttribute('data-ev-cancel');
                btn.onclick = async (e)=>{
                  e.preventDefault();
                  const ev = events.find(x=> String(x.id) === String(evId));
                  if (!ev) return;
                  await quickUpdateStatus(ev, 'CANCELLED');
                };
              });
            }

            // zmena mena kontaktu -> nastav contact_id
            function syncContactId(){
              const name = (contactNameInput.value || '').trim();
              const match = CAL_CONTACTS_CACHE.find(c => c.name === name);
              contactIdInput.value = match ? match.id : '';
            }
            contactNameInput.addEventListener('change', syncContactId);
            contactNameInput.addEventListener('blur', syncContactId);

            // tlačidlo + -> modal na nový kontakt
            contactManageBtn.onclick = ()=>{
              openContactModal(contactNameInput.value || '', async (savedContact) => {
                await loadContactsIntoDatalist(contactNameInput, contactIdInput);
                contactNameInput.value = savedContact.name;
                contactIdInput.value   = savedContact.id;
              });
            };

            // uloženie udalosti z formulára
            f.onsubmit = async (e) => {
              e.preventDefault();
              await submitEventForm(f, dateKey, state);
            };
          }
        };
      });
    }

    async function quickUpdateStatus(ev, newStatus){
      // backend musí vedieť UPDATE podľa id
      const payload = {
        id: ev.id,
        title: ev.title,
        type: ev.type,
        start_at: ev.start || ev.start_at,
        end_at: ev.end || ev.end_at,
        all_day: !!ev.all_day,
        priority: ev.priority || 'NORMAL',
        location: ev.location || '',
        description: ev.description || '',
        status: newStatus
      };
      const res = await calendarCreateOrUpdateEvent(payload);
      if (res && res.error){
        showStatus(res.error, true);
        return;
      }
      showStatus(`Udalosť #${ev.id} označená ako ${newStatus}.`, false);
      await reloadMonth();
      const summaryEl = document.getElementById('erp-cal-day-summary');
      if (summaryEl){
        summaryEl.textContent = 'Obnovujem...';
      }
    }

    function fillFormFromEvent(f, ev, dateKey){
      f.reset();
      f.event_id.value   = ev.id || '';
      f.title.value      = ev.title || '';
      f.type.value       = ev.type || 'MEETING';
      f.priority.value   = (ev.priority || 'NORMAL').toString().toUpperCase();
      if (f.status){
        f.status.value = (ev.status || 'OPEN').toString().toUpperCase();
      }

      const d = new Date(ev.start || ev.start_at);
      if (!isNaN(d)){
        f.date.value = calDateKey(d);
        const hh = calPad(d.getHours());
        const mm = calPad(d.getMinutes());
        f.start_time.value = `${hh}:${mm}`;
      } else {
        f.date.value = dateKey;
      }

      const d2 = new Date(ev.end || ev.end_at);
      if (!isNaN(d2)){
        const hh = calPad(d2.getHours());
        const mm = calPad(d2.getMinutes());
        f.end_time.value = `${hh}:${mm}`;
      }

      f.location.value    = ev.location || '';
      if (f.description) f.description.value = ev.description || '';
      if (f.all_day){
        f.all_day.checked = !!ev.all_day;
      }

      // kontakt
      if (document.getElementById('cal-contact-name')){
        document.getElementById('cal-contact-name').value = ev.contact_name || '';
      }
      if (document.getElementById('cal-contact-id')){
        document.getElementById('cal-contact-id').value = ev.contact_id || '';
      }

      // jednoduchá notifikácia – nechávam defaulty, detailnejšie riešenie je na backend-e
    }

    async function submitEventForm(f, dateKey, state){
      const fd = new FormData(f);
      const raw = Object.fromEntries(fd.entries());

      const title = (raw.title || '').trim();
      if (!title){
        showStatus('Názov udalosti je povinný.', true);
        return;
      }

      const date = raw.date || dateKey;
      const allDay = raw.all_day === 'on';

      let startStr = date + 'T' + (raw.start_time || '08:00');
      let endStr   = date + 'T' + (raw.end_time   || '09:00');
      if (allDay){
        startStr = date + 'T00:00';
        endStr   = date + 'T23:59';
      }

      const payload = {
        id: raw.event_id || null,
        title,
        type: raw.type || 'MEETING',
        priority: raw.priority || 'NORMAL',
        status: (raw.status || 'OPEN').toUpperCase(),
        all_day: allDay,
        start_at: startStr,
        end_at: endStr,
        location: raw.location || '',
        description: raw.description || '',
        contact_id: raw.contact_id || null,
        contact_name: raw.contact_name || '',
        // jednoduchá pripomienka – nechávame backend-u na spracovanie
        notify_before: raw.notify_before ? Number(raw.notify_before) : null,
        notify_channel: raw.notify_channel || '',
        notify_target: raw.notify_target || ''
      };

      const res = await calendarCreateOrUpdateEvent(payload);
      if (res && res.error){
        showStatus(res.error, true);
        return;
      }

      showStatus('Udalosť uložená.', false);
      document.getElementById('modal-container').style.display = 'none';
      await reloadMonth();
    }

    async function loadContactsIntoDatalist(inputEl, hiddenIdEl){
      const contacts = await calendarFetchContacts();
      const dl = document.getElementById('cal-contacts-datalist');
      if (dl){
        dl.innerHTML = contacts.map(c=>`<option value="${CAL_ESC(c.name)}"></option>`).join('');
      }
      if (inputEl && hiddenIdEl){
        const name = (inputEl.value || '').trim();
        const match = contacts.find(c=>c.name === name);
        hiddenIdEl.value = match ? match.id : '';
      }
    }

    function openContactModal(initialName, onSaved){
      showModal(initialName ? 'Upraviť kontakt' : 'Nový kontakt', () => {
        const html = `
          <form id="calendar-contact-form">
            <input type="hidden" name="id">
            <div class="form-group">
              <label>Meno kontaktnej osoby</label>
              <input name="name" value="${CAL_ESC(initialName || '')}" required>
            </div>
            <div class="form-group">
              <label>E‑mail</label>
              <input name="email" type="email" placeholder="napr. meno@firma.sk">
            </div>
            <div class="form-group">
              <label>Telefón</label>
              <input name="phone" placeholder="+421...">
            </div>
            <div class="form-group" style="margin-top:.75rem;">
              <button class="btn btn-success w-full"><i class="fas fa-save"></i> Uložiť kontakt</button>
            </div>
          </form>
        `;
        return {
          html,
          onReady: () => {
            const f = document.getElementById('calendar-contact-form');
            f.onsubmit = async (e)=>{
              e.preventDefault();
              const body = Object.fromEntries(new FormData(f).entries());
              const res = await calendarSaveContact(body);
              if (res && res.error){
                showStatus(res.error, true);
                return;
              }
              showStatus('Kontakt uložený.', false);
              document.getElementById('modal-container').style.display = 'none';
              if (typeof onSaved === 'function'){
                onSaved({ id: res.id, name: body.name, email: body.email, phone: body.phone });
              }
            };
          }
        };
      });
    }

    // ovládacie tlačidlá v hlavičke
    document.getElementById('erp-cal-prev').onclick = ()=>{
      state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      reloadMonth();
    };
    document.getElementById('erp-cal-next').onclick = ()=>{
      state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      reloadMonth();
    };
    document.getElementById('erp-cal-today').onclick = ()=>{
      const d = new Date();
      state.currentMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      reloadMonth();
    };

    reloadMonth();
  }

  // auto-registrácia po načítaní
  document.addEventListener('DOMContentLoaded', initializeCalendarModule);

})();
