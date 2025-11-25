// static/js/kancelaria_modules/hygiene.js
(function (root, doc) {
  'use strict';

  // =================================================================
  // 1. POMOCNÉ FUNKCIE (HELPERS)
  // =================================================================
  const $ = (sel, el = doc) => (el || doc).querySelector(sel);
  const $$ = (sel, el = doc) => Array.from((el || doc).querySelectorAll(sel));

  const showStatus = (msg, isError = false) => {
      console.log(isError ? "ERR:" : "OK:", msg);
      let el = doc.getElementById('status-bar');
      if (!el) {
          el = doc.createElement('div');
          el.id = 'status-bar';
          el.style.cssText = "position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:white;z-index:99999;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-weight:500;";
          doc.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.backgroundColor = isError ? '#dc2626' : '#16a34a';
      el.style.display = 'block';
      if (el._timer) clearTimeout(el._timer);
      el._timer = setTimeout(() => el.style.display = 'none', 4000);
  };

  const apiRequest = async (url, opts = {}) => {
      const res = await fetch(url, {
          method: opts.method || 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          credentials: 'same-origin'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
  };

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // =================================================================
  // 2. STAV APLIKÁCIE (STATE)
  // =================================================================
  let state = {
      agents: [],
      tasks: [],
      currentPlan: {},
      selectedDate: todayISO()
  };

  // =================================================================
  // 3. HLAVNÁ INICIALIZÁCIA
  // =================================================================
  function initializeHygieneModule() {
      const rootEl = doc.getElementById('section-hygiene');
      if (!rootEl) return;

      rootEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
            <div>
                <h3 style="margin:0 0 5px 0;">Hygienický plán a evidencia (HACCP)</h3>
                <small class="text-muted">Profesionálny systém pre ISO 22000</small>
            </div>
            <div>
                <button class="btn btn-secondary" onclick="window.hygieneOpenAdmin()">⚙️ Správa systému (Admin)</button>
            </div>
        </div>

        <div class="card">
            <div class="card-header" style="background:#f8fafc; padding:15px;">
                <div style="display:flex; gap:15px; align-items:flex-end; flex-wrap:wrap;">
                    <div>
                        <label style="font-size:0.85rem; font-weight:bold; color:#64748b;">Zobraziť deň:</label>
                        <input type="date" id="hyg-date" value="${state.selectedDate}" class="form-control">
                    </div>
                    <button id="hyg-refresh" class="btn btn-primary">Načítať plán</button>
                    
                    <div style="border-left:2px solid #e2e8f0; margin:0 5px;"></div>
                    
                    <div>
                        <label style="font-size:0.85rem; font-weight:bold; color:#64748b;">Report Od:</label>
                        <input type="date" id="rep-from" value="${state.selectedDate}" class="form-control">
                    </div>
                    <div>
                        <label style="font-size:0.85rem; font-weight:bold; color:#64748b;">Report Do:</label>
                        <input type="date" id="rep-to" value="${state.selectedDate}" class="form-control">
                    </div>
                    <div>
                        <label style="font-size:0.85rem; font-weight:bold; color:#64748b;">Filter Úlohy:</label>
                        <select id="rep-task" class="form-control" style="min-width:180px;"><option value="">Všetky úlohy</option></select>
                    </div>
                    <button class="btn btn-info" onclick="window.hygienePrintReport()">🖨️ Tlač (PDF)</button>
                </div>
            </div>
            <div class="card-body" id="hyg-plan-container" style="padding:0;">
                <div style="padding:30px; text-align:center; color:#64748b;">Načítavam dáta...</div>
            </div>
        </div>

        <div id="hyg-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; justify-content:center; align-items:center;">
            <div style="background:white; padding:0; border-radius:12px; width:90%; max-width:700px; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);">
                <div id="hyg-modal-content" style="overflow-y:auto; padding:25px;"></div>
            </div>
        </div>
      `;

      // Listeners
      doc.getElementById('hyg-date').addEventListener('change', (e) => {
          state.selectedDate = e.target.value;
          loadPlan();
      });
      doc.getElementById('hyg-refresh').onclick = loadPlan;

      // Initial Load
      loadLists().then(() => loadPlan());
  }

  // =================================================================
  // 4. DATA LOADING
  // =================================================================
  async function loadLists() {
      try {
          const [aData, tData] = await Promise.all([
              apiRequest('/api/kancelaria/hygiene/getAgents'),
              apiRequest('/api/kancelaria/hygiene/getTasks')
          ]);
          state.agents = aData || [];
          state.tasks = tData || [];

          // Naplnenie selectu pre report
          const sel = doc.getElementById('rep-task');
          if (sel) {
              sel.innerHTML = '<option value="">Všetky úlohy</option>';
              state.tasks.forEach(t => {
                  sel.innerHTML += `<option value="${t.id}">${escapeHtml(t.task_name)}</option>`;
              });
          }
      } catch (e) {
          console.error("Chyba pri načítaní číselníkov:", e);
      }
  }

  async function loadPlan() {
      const cont = doc.getElementById('hyg-plan-container');
      cont.innerHTML = '<div style="padding:30px; text-align:center; color:#64748b;">Načítavam plán...</div>';
      try {
          // timestamp pre anti-cache
          const data = await apiRequest(`/api/kancelaria/hygiene/getPlan?date=${state.selectedDate}&_t=${Date.now()}`);
          state.currentPlan = data.plan;
          renderPlan(data.plan);
      } catch (e) {
          cont.innerHTML = `<div style="padding:20px; color:#dc2626; text-align:center;">Chyba pri načítaní: ${escapeHtml(e.message)}</div>`;
      }
  }

  // =================================================================
  // 5. RENDERING (TABUĽKA)
  // =================================================================
  function renderPlan(plan) {
      const cont = doc.getElementById('hyg-plan-container');

      if (!plan || Object.keys(plan).length === 0) {
          cont.innerHTML = '<div style="padding:40px; text-align:center; color:#64748b;">Na tento deň nie sú naplánované žiadne úlohy.</div>';
          return;
      }

      let html = '';
      for (const loc in plan) {
          html += `
            <div style="background:#f1f5f9; padding:10px 20px; font-weight:700; color:#334155; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
                📍 ${escapeHtml(loc)}
            </div>
            <table class="table table-hover" style="width:100%; margin-bottom:0; border-collapse:collapse;">
                <thead style="background:#fff; color:#64748b; font-size:0.8rem; text-transform:uppercase;">
                    <tr>
                        <th style="padding:12px 20px; width:30%;">Úloha / Frekvencia</th>
                        <th style="padding:12px; width:15%;">Stav</th>
                        <th style="padding:12px; width:20%;">Vykonal / Čas</th>
                        <th style="padding:12px; width:20%;">Prostriedok / Teplota</th>
                        <th style="padding:12px; width:15%; text-align:right;">Akcia</th>
                    </tr>
                </thead>
                <tbody style="font-size:0.95rem;">`;

          plan[loc].forEach(t => {
              const log = t.log;
              let statusBadge = '<span class="badge bg-secondary" style="background:#e2e8f0; color:#475569; padding:4px 8px; border-radius:4px; font-size:0.75rem;">Na pláne</span>';
              let actionBtn = `<button class="btn btn-primary btn-sm" onclick="window.hygienePerform(${t.id})">Vykonať</button>`;
              
              let performerInfo = '<span style="color:#cbd5e1;">-</span>';
              let agentInfo = '<span style="color:#cbd5e1;">-</span>';

              if (log) {
                  // Časy
                  const tStart = (log.start_at || '').slice(11, 16);
                  const tEnd = (log.finished_at || '').slice(11, 16);
                  performerInfo = `<div><b>${escapeHtml(log.user_fullname)}</b></div><div style="font-size:0.8rem; color:#64748b;">${tStart} - ${tEnd}</div>`;
                  
                  if (log.agent_name) {
                      agentInfo = `<div>${escapeHtml(log.agent_name)}</div><div style="font-size:0.8rem; color:#64748b;">T: ${escapeHtml(log.water_temperature || '-')}°C, Šarža: ${escapeHtml(log.agent_batch || '-')}</div>`;
                  }

                  if (log.checked_by_fullname) {
                      // UZAVRETÉ / SKONTROLOVANÉ
                      if (log.verification_status === 'OK') {
                          statusBadge = '<span class="badge bg-success" style="background:#dcfce7; color:#166534; padding:4px 8px; border-radius:4px; font-size:0.75rem;">✅ Overené</span>';
                          actionBtn = `<button class="btn btn-light btn-sm" style="border:1px solid #cbd5e1;" onclick="window.hygienePerform(${t.id})">Detail</button>`;
                      } else {
                          statusBadge = '<span class="badge bg-danger" style="background:#fee2e2; color:#991b1b; padding:4px 8px; border-radius:4px; font-size:0.75rem;">❌ NOK</span>';
                          actionBtn = `<button class="btn btn-danger btn-sm" onclick="window.hygienePerform(${t.id})">Opakovať</button>`;
                      }
                  } else {
                      // ČAKÁ NA KONTROLU
                      statusBadge = '<span class="badge bg-warning" style="background:#fef3c7; color:#92400e; padding:4px 8px; border-radius:4px; font-size:0.75rem;">Čaká na kontrolu</span>';
                      actionBtn = `<button class="btn btn-warning btn-sm" style="background:#f59e0b; border:none; color:white;" onclick="window.hygieneCheck(${t.id})">Skontrolovať</button>`;
                  }
              }

              // Auto-štart tlačidlo pre rýchle spustenie
              if (!log && t.scheduled_time) {
                  actionBtn += ` <button class="btn btn-sm btn-info" style="margin-left:5px;" title="Spustiť teraz (plán: ${t.scheduled_time})" onclick="window.hygienePerform(${t.id}, '${t.scheduled_time}')">⚡</button>`;
              }

              html += `
                <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:12px 20px;">
                        <div style="font-weight:600; color:#1e293b;">${escapeHtml(t.task_name)}</div>
                        <div style="font-size:0.8rem; color:#64748b;">${escapeHtml(t.frequency)}</div>
                    </td>
                    <td style="padding:12px;">${statusBadge}</td>
                    <td style="padding:12px;">${performerInfo}</td>
                    <td style="padding:12px;">${agentInfo}</td>
                    <td style="padding:12px; text-align:right;">${actionBtn}</td>
                </tr>`;
          });
          html += `</tbody></table>`;
      }
      cont.innerHTML = html;
  }

  // =================================================================
  // 6. MODAL LOGIKA
  // =================================================================
  function openModal(title, html) {
      const m = doc.getElementById('hyg-modal');
      const c = doc.getElementById('hyg-modal-content');
      c.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:15px; margin-bottom:20px;">
            <h3 style="margin:0; font-size:1.25rem; color:#1e293b;">${escapeHtml(title)}</h3>
            <button style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#94a3b8;" onclick="window.hygieneCloseModal()">&times;</button>
        </div>
        ${html}
      `;
      m.style.display = 'flex';
  }
  window.hygieneCloseModal = () => { doc.getElementById('hyg-modal').style.display = 'none'; };

  // --- A) VYKONAŤ SANITÁCIU (Perform) ---
  window.hygienePerform = function (taskId, prefillTime = null) {
      let task = null;
      for (const loc in state.currentPlan) {
          const found = state.currentPlan[loc].find(t => t.id === taskId);
          if (found) { task = found; break; }
      }
      if (!task) return;

      const log = task.log || {};
      const agentOpts = state.agents.map(a => `<option value="${a.id}" ${(log.agent_id || task.default_agent_id) == a.id ? 'selected' : ''}>${escapeHtml(a.agent_name)}</option>`).join('');

      // Čas
      const nowTime = prefillTime ? prefillTime.slice(0, 5) : new Date().toTimeString().slice(0, 5);
      const startTime = log.start_at ? log.start_at.slice(11, 16) : nowTime;

      const html = `
        <form id="hyg-perf-form">
            <div class="form-group" style="margin-bottom:15px;">
                <label style="font-weight:600; display:block; margin-bottom:5px;">Vykonal (Meno):</label>
                <input class="form-control" id="p-name" value="${escapeHtml(log.user_fullname || '')}" required style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
            </div>
            
            <div style="margin-bottom:15px; padding:15px; background:#eff6ff; border-radius:8px; border:1px solid #dbeafe;">
                <label style="font-weight:600; display:block; margin-bottom:5px; color:#1e40af;">Čas začiatku:</label>
                <input type="time" class="form-control" id="p-time" value="${startTime}" required style="width:100%; padding:10px; border:1px solid #93c5fd; border-radius:6px;">
                <div style="font-size:0.85rem; margin-top:8px; color:#1e40af;">
                   ℹ️ Systém automaticky pripočíta <b>10 min</b> (pôsobenie) a <b>10 min</b> (oplach).
                </div>
            </div>

            <div class="form-group" style="margin-bottom:15px;">
                <label style="font-weight:600; display:block; margin-bottom:5px;">Použitý prostriedok:</label>
                <select class="form-control" id="p-agent" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
                    <option value="">-- Bez chémie (len voda) --</option>
                    ${agentOpts}
                </select>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:15px; margin-bottom:15px;">
                <div>
                    <label style="font-weight:600; display:block; margin-bottom:5px;">Šarža (LOT):</label>
                    <input class="form-control" id="p-batch" value="${escapeHtml(log.agent_batch || '')}" placeholder="napr. L123" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
                </div>
                <div>
                    <label style="font-weight:600; display:block; margin-bottom:5px;">Koncentrácia (%):</label>
                    <input class="form-control" id="p-conc" value="${escapeHtml(log.concentration || task.default_concentration || '')}" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
                </div>
                <div>
                    <label style="font-weight:600; display:block; margin-bottom:5px;">Teplota vody (°C):</label>
                    <input type="number" class="form-control" id="p-temp" value="${escapeHtml(log.water_temperature || '')}" placeholder="45" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
                </div>
            </div>
            
            <div class="form-group" style="margin-bottom:20px;">
                <label style="font-weight:600; display:block; margin-bottom:5px;">Poznámka:</label>
                <textarea class="form-control" id="p-note" rows="2" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">${escapeHtml(log.notes || '')}</textarea>
            </div>

            <div style="text-align:right; padding-top:15px; border-top:1px solid #e2e8f0;">
                <button type="button" class="btn btn-secondary" onclick="window.hygieneCloseModal()" style="margin-right:10px;">Zrušiť</button>
                <button type="submit" class="btn btn-success">💾 Uložiť záznam</button>
            </div>
        </form>
      `;

      openModal(`Vykonať: ${task.task_name}`, html);

      // Autofill mena
      if (!log.user_fullname) {
          const u = doc.getElementById('user-info');
          if (u) {
              const m = u.textContent.match(/Vitajte,\s*(.*?)\s*\(/);
              if (m) doc.getElementById('p-name').value = m[1];
          }
      }

      doc.getElementById('hyg-perf-form').onsubmit = async (e) => {
          e.preventDefault();
          const payload = {
              task_id: taskId,
              completion_date: state.selectedDate,
              performer_name: doc.getElementById('p-name').value,
              start_time: doc.getElementById('p-time').value,
              agent_id: doc.getElementById('p-agent').value,
              agent_batch: doc.getElementById('p-batch').value,
              concentration: doc.getElementById('p-conc').value,
              temperature: doc.getElementById('p-temp').value,
              notes: doc.getElementById('p-note').value
          };

          try {
              await apiRequest('/api/kancelaria/hygiene/logCompletion', { method: 'POST', body: payload });
              showStatus('Sanitácia uložená');
              window.hygieneCloseModal();
              loadPlan();
          } catch (err) {
              alert(err.message);
          }
      };
  };

  // --- B) SKONTROLOVAŤ (Check) ---
  window.hygieneCheck = function (taskId) {
      let task = null;
      for (const loc in state.currentPlan) {
          const found = state.currentPlan[loc].find(t => t.id === taskId);
          if (found) { task = found; break; }
      }
      if (!task || !task.log) return;
      const log = task.log;

      const html = `
        <div style="background:#f1f5f9; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid #e2e8f0;">
            <div style="margin-bottom:5px;"><strong>Vykonal:</strong> ${escapeHtml(log.user_fullname)}</div>
            <div style="margin-bottom:5px;"><strong>Prostriedok:</strong> ${state.agents.find(a => a.id == log.agent_id)?.agent_name || '-'} (Šarža: ${escapeHtml(log.agent_batch || '-')})</div>
            <div><strong>Teplota:</strong> ${escapeHtml(log.water_temperature || '-')} °C</div>
        </div>
        
        <form id="hyg-check-form">
            <div class="form-group" style="margin-bottom:15px;">
                <label style="font-weight:600; display:block; margin-bottom:5px;">Kontrolór (Meno):</label>
                <input class="form-control" id="c-name" required style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
            </div>
            
            <div class="form-group" style="margin-bottom:15px;">
                <label style="font-weight:600; display:block; margin-bottom:5px;">Výsledok kontroly:</label>
                <select class="form-control" id="c-status" onchange="document.getElementById('c-corr-box').style.display = (this.value==='NOK') ? 'block' : 'none';" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-weight:bold;">
                    <option value="OK" style="color:green;">✅ VYHOVUJE (OK)</option>
                    <option value="NOK" style="color:red;">❌ NEVYHOVUJE (NOK)</option>
                </select>
            </div>
            
            <div id="c-corr-box" style="display:none; margin-bottom:15px; padding:15px; background:#fef2f2; border:1px solid #fca5a5; border-radius:8px;">
                <label style="color:#991b1b; font-weight:bold; display:block; margin-bottom:5px;">Nápravné opatrenie (Povinné pri NOK):</label>
                <textarea class="form-control" id="c-corrective" placeholder="Popíšte, čo sa vykonalo na odstránenie nedostatku..." rows="2" style="width:100%; padding:10px; border:1px solid #fca5a5; border-radius:6px;"></textarea>
            </div>
            
            <div style="text-align:right; margin-top:20px;">
                <button type="submit" class="btn btn-primary">Potvrdiť kontrolu</button>
            </div>
        </form>
      `;

      openModal("Kontrola sanitácie", html);

      const u = doc.getElementById('user-info');
      if (u) {
          const m = u.textContent.match(/Vitajte,\s*(.*?)\s*\(/);
          if (m) doc.getElementById('c-name').value = m[1];
      }

      doc.getElementById('hyg-check-form').onsubmit = async (e) => {
          e.preventDefault();
          const stat = doc.getElementById('c-status').value;
          const corr = doc.getElementById('c-corrective').value;

          if (stat === 'NOK' && !corr.trim()) {
              alert("Pri hodnotení NEVYHOVUJE musíte zadať nápravné opatrenie.");
              return;
          }

          try {
              await apiRequest('/api/kancelaria/hygiene/checkLog', {
                  method: 'POST',
                  body: {
                      log_id: log.id,
                      checker_name: doc.getElementById('c-name').value,
                      status: stat,
                      corrective_action: corr
                  }
              });
              showStatus('Kontrola uložená');
              window.hygieneCloseModal();
              loadPlan();
          } catch (err) { alert(err.message); }
      };
  };

  // --- C) TLAČ REPORTU ---
  window.hygienePrintReport = function () {
      const from = doc.getElementById('rep-from').value;
      const to = doc.getElementById('rep-to').value;
      const task = doc.getElementById('rep-task').value;
      window.open(`/report/hygiene?date_from=${from}&date_to=${to}&task_id=${task}`, '_blank');
  };

  // =================================================================
  // 7. ADMIN (ÚLOHY A PROSTRIEDKY)
  // =================================================================
  window.hygieneOpenAdmin = async function () {
      const html = `
        <div style="display:flex; gap:10px; margin-bottom:20px;">
            <button class="btn btn-secondary" onclick="window.hygieneAdminRenderTasks()" id="btn-adm-tasks">📋 Správa Úloh (Šablóny)</button>
            <button class="btn btn-secondary" onclick="window.hygieneAdminRenderAgents()" id="btn-adm-agents">🧪 Čistiace prostriedky</button>
        </div>
        <div id="admin-content-area" style="min-height:300px;">Načítavam...</div>
    `;
      openModal("Nastavenia Hygienického plánu", html);
      window.hygieneAdminRenderTasks();
  };

  // --- ADMIN: ÚLOHY ---
  window.hygieneAdminRenderTasks = async function () {
      const area = doc.getElementById('admin-content-area');
      area.innerHTML = '<p class="muted">Načítavam...</p>';

      if (doc.getElementById('btn-adm-tasks')) {
          doc.getElementById('btn-adm-tasks').classList.add('btn-primary');
          doc.getElementById('btn-adm-tasks').classList.remove('btn-secondary');
          doc.getElementById('btn-adm-agents').classList.add('btn-secondary');
          doc.getElementById('btn-adm-agents').classList.remove('btn-primary');
      }

      try {
          const tasks = await apiRequest('/api/kancelaria/hygiene/getTasks');
          if (!state.agents.length) await loadAgents();

          let rows = '';
          tasks.forEach(t => {
              const activeBadge = t.is_active ? '<span style="color:green;">Aktívna</span>' : '<span style="color:grey;">Neaktívna</span>';
              const agName = state.agents.find(a => a.id == t.default_agent_id)?.agent_name || '-';
              const auto = t.auto_start ? '✅ Áno' : 'Nie';

              rows += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px;"><b>${escapeHtml(t.task_name)}</b><br><small>${escapeHtml(t.location)}</small></td>
                    <td style="padding:8px;">${escapeHtml(t.frequency)}</td>
                    <td style="padding:8px;">${escapeHtml(agName)}</td>
                    <td style="padding:8px;">${t.scheduled_time || '-'}</td>
                    <td style="padding:8px;">${auto}</td>
                    <td style="padding:8px;">${activeBadge}</td>
                    <td style="text-align:right; padding:8px;">
                        <button class="btn btn-sm btn-warning" onclick='window.hygieneAdminEditTask(${JSON.stringify(t).replace(/'/g, "&#39;")})'>✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="window.hygieneDeleteTask(${t.id})">🗑️</button>
                    </td>
                </tr>`;
          });

          area.innerHTML = `
            <div style="text-align:right; margin-bottom:10px;">
                <button class="btn btn-success btn-sm" onclick="window.hygieneAdminEditTask(null)">+ Nová Úloha</button>
            </div>
            <div style="overflow-y:auto; max-height:400px; border:1px solid #eee; border-radius:6px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead style="background:#f8fafc; text-align:left;">
                        <tr><th>Názov / Miesto</th><th>Frekvencia</th><th>Prostriedok</th><th>Čas</th><th>Auto</th><th>Stav</th><th></th></tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="7" style="padding:10px;">Žiadne úlohy.</td></tr>'}</tbody>
                </table>
            </div>
          `;
      } catch (e) { area.innerHTML = `<p class="error">${e.message}</p>`; }
  };

  window.hygieneAdminEditTask = function (task) {
      const t = task || {};
      const agentOpts = state.agents.map(a => `<option value="${a.id}" ${t.default_agent_id == a.id ? 'selected' : ''}>${escapeHtml(a.agent_name)}</option>`).join('');

      const html = `
        <form id="adm-task-form">
            <input type="hidden" id="at-id" value="${t.id || ''}">
            <div class="form-group" style="margin-bottom:10px;"><label>Názov:</label><input class="form-control" id="at-name" value="${escapeHtml(t.task_name || '')}" required style="width:100%;"></div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                <div><label>Miesto:</label><input class="form-control" id="at-loc" value="${escapeHtml(t.location || '')}" required style="width:100%;"></div>
                <div><label>Frekvencia:</label>
                    <select class="form-control" id="at-freq" style="width:100%;">
                        <option value="denne" ${t.frequency == 'denne' ? 'selected' : ''}>Denne</option>
                        <option value="tyzdenne" ${t.frequency == 'tyzdenne' ? 'selected' : ''}>Týždenne</option>
                        <option value="mesacne" ${t.frequency == 'mesacne' ? 'selected' : ''}>Mesačne</option>
                    </select>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:10px;"><label>Predvolený prostriedok:</label><select class="form-control" id="at-agent" style="width:100%;"><option value="">-</option>${agentOpts}</select></div>
            
            <div style="background:#f1f5f9; padding:10px; border-radius:6px; margin-bottom:15px;">
                <div style="font-weight:bold; margin-bottom:5px;">Automatizácia</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; align-items:center;">
                    <div><label>Čas (HH:MM):</label><input type="time" class="form-control" id="at-time" value="${t.scheduled_time || ''}" style="width:100%;"></div>
                    <div><input type="checkbox" id="at-auto" ${t.auto_start ? 'checked' : ''} style="transform:scale(1.2); margin-right:5px;"> <label for="at-auto">Auto-štart (zapísať do logu)</label></div>
                </div>
            </div>

            <div class="form-group" style="margin-bottom:15px;">
                <input type="checkbox" id="at-active" ${t.is_active === 0 ? '' : 'checked'} style="transform:scale(1.2); margin-right:5px;"> <label for="at-active">Úloha je aktívna</label>
            </div>
            
            <div style="text-align:right;">
                <button type="button" class="btn btn-secondary" onclick="window.hygieneAdminRenderTasks()">Späť</button>
                <button type="submit" class="btn btn-success">Uložiť</button>
            </div>
        </form>
      `;

      doc.getElementById('admin-content-area').innerHTML = html;

      doc.getElementById('adm-task-form').onsubmit = async (e) => {
          e.preventDefault();
          const body = {
              id: doc.getElementById('at-id').value || null,
              task_name: doc.getElementById('at-name').value,
              location: doc.getElementById('at-loc').value,
              frequency: doc.getElementById('at-freq').value,
              default_agent_id: doc.getElementById('at-agent').value,
              scheduled_time: doc.getElementById('at-time').value,
              auto_start: doc.getElementById('at-auto').checked,
              is_active: doc.getElementById('at-active').checked
          };
          try {
              await apiRequest('/api/kancelaria/hygiene/saveTask', { method: 'POST', body });
              showStatus('Uložené');
              window.hygieneAdminRenderTasks();
              loadPlan();
          } catch (err) { alert(err.message); }
      };
  };

  window.hygieneDeleteTask = async function (id) {
      if (!confirm("Vymazať túto úlohu?")) return;
      try {
          await apiRequest('/api/kancelaria/hygiene/deleteTask', { method: 'POST', body: { id } });
          showStatus('Vymazané');
          window.hygieneAdminRenderTasks();
          loadPlan();
      } catch (e) { alert(e.message); }
  };


  // --- B) Správa prostriedkov ---
  window.hygieneAdminRenderAgents = async function () {
      const area = doc.getElementById('admin-content-area');
      area.innerHTML = '<p class="muted">Načítavam zoznam prostriedkov...</p>';

      if (doc.getElementById('btn-adm-tasks')) {
          doc.getElementById('btn-adm-tasks').classList.remove('btn-primary');
          doc.getElementById('btn-adm-tasks').classList.add('btn-secondary');
          doc.getElementById('btn-adm-agents').classList.remove('btn-secondary');
          doc.getElementById('btn-adm-agents').classList.add('btn-primary');
      }

      try {
          const agents = await apiRequest('/api/kancelaria/hygiene/getAgents');
          let rows = '';
          agents.forEach(a => {
              rows += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:8px;">${escapeHtml(a.agent_name)}</td>
                    <td style="text-align:right; padding:8px;">
                        <button class="btn btn-sm btn-warning" onclick="window.hygieneAdminEditAgent(${a.id}, '${escapeHtml(a.agent_name)}')">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="window.hygieneDeleteAgent(${a.id})">🗑️</button>
                    </td>
                </tr>`;
          });

          area.innerHTML = `
            <div style="text-align:right; margin-bottom:10px;">
                <button class="btn btn-success btn-sm" onclick="window.hygieneAdminEditAgent(null, '')">+ Pridať</button>
            </div>
            <div style="overflow-y:auto; max-height:400px; border:1px solid #eee; border-radius:6px;">
                <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
                    <thead style="background:#f8fafc; text-align:left;"><tr><th>Názov</th><th></th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="2" style="padding:10px;">Žiadne prostriedky.</td></tr>'}</tbody>
                </table>
            </div>
          `;
      } catch (e) { area.innerHTML = `<p class="error">${e.message}</p>`; }
  };

  window.hygieneAdminEditAgent = function (id, name) {
      const html = `
        <form id="adm-agent-form">
            <input type="hidden" id="aa-id" value="${id || ''}">
            <div class="form-group" style="margin-bottom:15px;">
                <label>Názov prostriedku:</label>
                <input class="form-control" id="aa-name" value="${name || ''}" required style="width:100%;">
            </div>
            <div style="text-align:right;">
                <button type="button" class="btn btn-secondary" onclick="window.hygieneAdminRenderAgents()">Späť</button>
                <button type="submit" class="btn btn-success">Uložiť</button>
            </div>
        </form>
      `;
      doc.getElementById('admin-content-area').innerHTML = html;

      doc.getElementById('adm-agent-form').onsubmit = async (e) => {
          e.preventDefault();
          try {
              await apiRequest('/api/kancelaria/hygiene/saveAgent', {
                  method: 'POST',
                  body: {
                      id: doc.getElementById('aa-id').value || null,
                      agent_name: doc.getElementById('aa-name').value,
                      is_active: true
                  }
              });
              showStatus('Uložené');
              window.hygieneAdminRenderAgents();
          } catch (err) { alert(err.message); }
      };
  };

  window.hygieneDeleteAgent = async function (id) {
      if (!confirm("Vymazať tento prostriedok?")) return;
      try {
          await apiRequest('/api/kancelaria/hygiene/deleteAgent', { method: 'POST', body: { id } });
          showStatus('Vymazané');
          window.hygieneAdminRenderAgents();
      } catch (e) { alert(e.message); }
  };

  // Export do globálu
  (function (g) { g.initializeHygieneModule = initializeHygieneModule; })(typeof window !== 'undefined' ? window : this);

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);