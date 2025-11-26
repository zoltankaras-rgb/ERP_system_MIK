// ======================================================================
// ENTERPRISE PLÁNOVACÍ KALENDÁR – FRONTEND (Bez SQLAlchemy verzia)
// ======================================================================

const CAL_ESC = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s || ''));

function ensureCalendarStyles() {
  if (document.getElementById('erp-calendar-styles')) return;
  const s = document.createElement('style');
  s.id = 'erp-calendar-styles';
  s.textContent = `
    #section-enterprise-calendar .erp-calendar-header{ display:flex; align-items:center; gap:.5rem; margin-bottom:.5rem; justify-content:space-between; flex-wrap:wrap; }
    #section-enterprise-calendar .erp-calendar-header-left{ display:flex; align-items:center; gap:.25rem; }
    #section-enterprise-calendar .erp-calendar-month-label{ font-weight:600; font-size:1.1rem; margin:0 .5rem; }
    #section-enterprise-calendar .erp-calendar-grid{ display:grid; grid-template-columns: repeat(7, minmax(110px,1fr)); gap:4px; }
    #section-enterprise-calendar .erp-calendar-daynames{ display:grid; grid-template-columns: repeat(7, minmax(110px,1fr)); gap:4px; margin-bottom:2px; font-size:.8rem; color:#6b7280; text-transform:uppercase; letter-spacing:.03em; }
    #section-enterprise-calendar .erp-calendar-dayname{ text-align:center; padding:2px 0; }
    #section-enterprise-calendar .erp-calendar-cell{ border-radius:8px; border:1px solid #e5e7eb; background:#fff; min-height:90px; display:flex; flex-direction:column; padding:4px 6px; cursor:pointer; transition:box-shadow .12s ease, transform .06s ease; overflow:hidden; }
    #section-enterprise-calendar .erp-calendar-cell:hover{ box-shadow:0 2px 4px rgba(0,0,0,.08); transform:translateY(-1px); }
    #section-enterprise-calendar .erp-calendar-cell.other-month{ background:#f9fafb; color:#9ca3af; }
    #section-enterprise-calendar .erp-calendar-cell.today{ border:2px solid var(--primary-color, #2563eb); }
    #section-enterprise-calendar .erp-calendar-cell-header{ display:flex; align-items:center; justify-content:space-between; gap:.25rem; margin-bottom:2px; }
    #section-enterprise-calendar .erp-calendar-day-number{ font-weight:600; font-size:.9rem; }
    #section-enterprise-calendar .erp-calendar-add-btn{ border:0; background:transparent; cursor:pointer; font-size:.7rem; width:1.35rem; height:1.35rem; border-radius:999px; display:flex; align-items:center; justify-content:center; color:#6b7280; }
    #section-enterprise-calendar .erp-calendar-add-btn:hover{ background:#e5e7eb; color:#111827; }
    #section-enterprise-calendar .erp-calendar-cell-body{ margin-top:2px; font-size:.72rem; line-height:1.2; max-height:70px; overflow-y:auto; padding-right:2px; }
    #section-enterprise-calendar .erp-calendar-event-pill{ border-radius:999px; padding:1px 6px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:#e5e7eb; font-size:.7rem; }
    #section-enterprise-calendar .erp-calendar-more{ font-size:.7rem; color:#9ca3af; }
    #section-enterprise-calendar .erp-calendar-day-summary{ font-size:.85rem; color:#4b5563; }
  `;
  document.head.appendChild(s);
}

const CAL_MONTH_NAMES = ['Január','Február','Marec','Apríl','Máj','Jún','Júl','August','September','Október','November','December'];
const CAL_DAY_NAMES = ['Po','Ut','St','Št','Pi','So','Ne'];

function calPad(n){ return String(n).padStart(2,'0'); }
function calDateKey(d){ return `${d.getFullYear()}-${calPad(d.getMonth()+1)}-${calPad(d.getDate())}`; }

async function calendarApi(url, opts = {}) { return apiRequest(url, opts); }
async function calendarDeleteEvent(id) { return apiRequest(`/api/calendar/events/${id}`, { method: 'DELETE' }); }

function initializeEnterpriseCalendar(){
  ensureCalendarStyles();
  const root = document.getElementById('section-enterprise-calendar');
  if (!root) return;

  root.innerHTML = `
    <h3>Plánovací Kalendár</h3>
    <div class="analysis-card">
      <div class="erp-calendar-header">
        <div class="erp-calendar-header-left">
          <button class="btn btn-secondary btn-xs" id="erp-cal-prev"><</button>
          <div class="erp-calendar-month-label" id="erp-cal-month-label">—</div>
          <button class="btn btn-secondary btn-xs" id="erp-cal-next">></button>
          <button class="btn btn-light btn-xs" id="erp-cal-today">Dnes</button>
        </div>
      </div>
      <div class="erp-calendar-daynames" id="erp-cal-daynames"></div>
      <div class="erp-calendar-grid" id="erp-cal-grid"></div>
    </div>
    <div class="analysis-card" style="margin-top:1rem;">
      <h4>Vybraný deň</h4>
      <div id="erp-cal-day-summary" class="erp-calendar-day-summary">Klikni na deň v kalendári.</div>
    </div>
  `;

  const state = {
    currentMonth: new Date(),
    eventsByDay: {}
  };
  state.currentMonth.setDate(1);

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
    
    // Načítame udalosti pre širší rozsah
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month + 2, 0);

    const params = new URLSearchParams();
    params.set('start', start.toISOString().slice(0,10));
    params.set('end', end.toISOString().slice(0,10));

    const res = await calendarApi('/api/calendar/events?' + params.toString());
    const list = Array.isArray(res) ? res : [];
    const byDay = {};

    list.forEach(ev => {
        let dStart = new Date(ev.start);
        let dEnd = ev.end ? new Date(ev.end) : new Date(ev.start);
        if (isNaN(dStart.getTime())) return;

        let current = new Date(dStart.getFullYear(), dStart.getMonth(), dStart.getDate());
        let limit = new Date(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate());

        // Cyklus pre vykreslenie dlhých udalostí
        let safe = 0;
        while (current <= limit && safe < 365) {
            const key = calDateKey(current);
            if (!byDay[key]) byDay[key] = [];
            if (!byDay[key].some(e => e.id === ev.id)) {
                byDay[key].push(ev);
            }
            current.setDate(current.getDate() + 1);
            safe++;
        }
    });

    st.eventsByDay = byDay;
  }

  function renderMonth(st){
    const year = st.currentMonth.getFullYear();
    const month = st.currentMonth.getMonth();
    lblEl.textContent = `${CAL_MONTH_NAMES[month]} ${year}`;

    const first = new Date(year, month, 1);
    const jsDow = first.getDay(); 
    const mondayIndex = (jsDow + 6) % 7; 
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

      let pills = '';
      events.slice(0,3).forEach(ev => {
        let style = ev.color_hex ? `style="background-color:${ev.color_hex}20; color:${ev.color_hex}; border:1px solid ${ev.color_hex}"` : '';
        pills += `<div class="erp-calendar-event-pill" ${style}>${CAL_ESC(ev.title)}</div>`;
      });
      if (events.length > 3) pills += `<div class="erp-calendar-more">+${events.length - 3}</div>`;

      html += `
        <div class="erp-calendar-cell ${isOtherMonth?'other-month':''} ${isToday?'today':''}" data-date="${key}">
          <div class="erp-calendar-cell-header">
            <span class="erp-calendar-day-number">${d.getDate()}</span>
            <button class="erp-calendar-add-btn" data-date="${key}">+</button>
          </div>
          <div class="erp-calendar-cell-body">${pills}</div>
        </div>
      `;
    }
    gridEl.innerHTML = html;

    gridEl.querySelectorAll('.erp-calendar-cell').forEach(c => {
        c.onclick = (e) => {
            if(e.target.classList.contains('erp-calendar-add-btn')) return;
            openDayModal(c.dataset.date, state);
        }
    });
    gridEl.querySelectorAll('.erp-calendar-add-btn').forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation();
            openDayModal(b.dataset.date, state, true);
        }
    });
  }

  function openDayModal(dateKey, st, createNew=false){
    const events = st.eventsByDay[dateKey] || [];
    const [y, m, d] = dateKey.split('-');
    
    const eventsHtml = !events.length ? '<p>Žiadne udalosti.</p>' : 
      `<ul style="list-style:none; padding:0;">
         ${events.map(ev => `
           <li style="margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
             <div>
               <strong>${CAL_ESC(ev.title)}</strong>
               <div style="font-size:0.8em; color:#666;">${CAL_ESC(ev.type)}</div>
             </div>
             <button class="btn btn-xs btn-danger" onclick="window.deleteCalEvent(${ev.id})"><i class="fas fa-trash"></i></button>
           </li>
         `).join('')}
       </ul>`;

    window.deleteCalEvent = async (id) => {
      if(!confirm('Vymazať udalosť?')) return;
      try {
        await calendarDeleteEvent(id);
        document.getElementById('modal-container').style.display = 'none';
        await reloadMonth();
      } catch(e) { alert('Chyba pri mazaní'); }
    };

    showModal(`Kalendár – ${d}.${m}.${y}`, () => {
      const html = `
        <div class="form-grid" style="grid-template-columns: 1fr 1fr; gap:1rem;">
          <div>
            <h5>Udalosti</h5>
            ${eventsHtml}
          </div>
          <div>
            <h5>${createNew ? 'Nová' : 'Upraviť'} udalosť</h5>
            <form id="erp-cal-form">
              <div class="form-group">
                <label>Názov</label><input name="title" required>
              </div>
              <div class="form-group">
                <label>Typ</label>
                <select name="type"><option value="MEETING">Stretnutie</option><option value="TASK">Úloha</option><option value="VACATION">Dovolenka</option><option value="SERVICE">Servis</option></select>
              </div>
              <div class="form-group">
                <label>Trvanie (Od – Do)</label>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                   <div><small>Dátum od</small><input type="date" name="start_date" value="${dateKey}" required></div>
                   <div><small>Čas od</small><input type="time" name="start_time" value="08:00"></div>
                   <div><small>Dátum do</small><input type="date" name="end_date" value="${dateKey}" required></div>
                   <div><small>Čas do</small><input type="time" name="end_time" value="16:00"></div>
                </div>
              </div>
              <div class="form-group">
                 <label><input type="checkbox" name="all_day"> Celý deň</label>
              </div>
              <div class="form-group">
                <label>Farba</label><input type="color" name="color_hex" value="#2563eb">
              </div>
              <div class="form-group">
                <label>Popis</label><textarea name="description"></textarea>
              </div>
              <button class="btn btn-success w-full">Uložiť</button>
            </form>
          </div>
        </div>
      `;
      return {
        html,
        onReady: () => {
          const f = document.getElementById('erp-cal-form');
          f.querySelector('[name="all_day"]').addEventListener('change', e => {
             f.querySelector('[name="start_time"]').disabled = e.target.checked;
             f.querySelector('[name="end_time"]').disabled = e.target.checked;
          });

          f.onsubmit = async (e) => {
            e.preventDefault();
            const fd = new FormData(f);
            const payload = {
                title: fd.get('title'),
                type: fd.get('type'),
                start_date: fd.get('start_date'),
                end_date: fd.get('end_date'),
                start_time: fd.get('start_time'),
                end_time: fd.get('end_time'),
                all_day: fd.get('all_day') === 'on',
                color_hex: fd.get('color_hex'),
                description: fd.get('description')
            };
            try {
                await calendarApi('/api/calendar/events', { method: 'POST', body: payload });
                document.getElementById('modal-container').style.display = 'none';
                await reloadMonth();
            } catch(err) { alert('Chyba pri ukladaní: ' + err.message); }
          };
        }
      };
    });
  }

  document.getElementById('erp-cal-prev').onclick = async () => { state.currentMonth.setMonth(state.currentMonth.getMonth() - 1); await reloadMonth(); };
  document.getElementById('erp-cal-next').onclick = async () => { state.currentMonth.setMonth(state.currentMonth.getMonth() + 1); await reloadMonth(); };
  document.getElementById('erp-cal-today').onclick = async () => { state.currentMonth = new Date(); state.currentMonth.setDate(1); await reloadMonth(); };

  reloadMonth();
}

(function(){ if(document.getElementById('section-enterprise-calendar')) initializeEnterpriseCalendar(); })();e