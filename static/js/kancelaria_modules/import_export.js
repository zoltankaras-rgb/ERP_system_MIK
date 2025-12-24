(function (window, document) {
  'use strict';

  async function viewImportExport() {
    const host = document.getElementById('section-import-export');
    if (!host) return;

    host.innerHTML = `
      <div class="stat-card" style="border-left: 5px solid #2563eb; margin-bottom: 1rem;">
          <div style="display:flex; justify-content:space-between; align-items:start;">
              <div>
                  <h3><i class="fas fa-exchange-alt"></i> Synchronizácia s ERP</h3>
                  <p class="text-muted" style="margin-bottom:0.5rem">
                      Výmenný adresár: <code>/static/erp_exchange/</code> (SFTP).
                  </p>
                  <p class="small text-muted" style="margin:0">
                      <b>Export VYROBKY.CSV</b> sa generuje výhradne pri uzavretí <b>Denného príjmu v EXPEDÍCII</b>.
                      V kancelárii nie je možné spúšťať manuálny ani automatický export.
                  </p>
              </div>
              <button id="btn-refresh-status" class="btn btn-sm btn-secondary">
                  <i class="fas fa-sync"></i> Obnoviť stav
              </button>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-top:1rem; background:#f8fafc; padding:12px; border-radius:6px; border:1px solid #e2e8f0;">
              <div>
                  <strong style="color:#0f172a">Export (VYROBKY.CSV)</strong><br>
                  <span id="st-export" class="text-muted" style="font-size:0.9em">Načítavam...</span>
              </div>
              <div>
                  <strong style="color:#0f172a">Import (ZASOBA.CSV)</strong><br>
                  <span id="st-import" class="text-muted" style="font-size:0.9em">Načítavam...</span>
              </div>
          </div>
      </div>

      <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem;">
          <div class="stat-card">
              <h4><i class="fas fa-file-import"></i> Import Skladu</h4>

              <div style="background:#f0fdf4; padding:12px; border-radius:6px; margin-bottom:15px; border:1px solid #bbf7d0;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                      <strong style="color:#166534">A. Zo servera (Sync)</strong>
                      <span id="server-file-badge" class="badge" style="background:#e5e7eb; color:#374151; font-size:0.7em; padding:2px 6px; border-radius:4px;">Kontrola...</span>
                  </div>
                  <p class="small text-muted" style="margin-bottom:8px;">
                      Spracuje <b>ZASOBA.CSV</b>, ktorý tam nahral tvoj synchronizačný skript.
                  </p>
                  <button id="btn-server-import" class="btn btn-success w-full btn-sm" disabled>
                      <i class="fas fa-server"></i> Spracovať súbor zo servera
                  </button>
              </div>

              <div style="border-top:1px solid #eee; padding-top:12px;">
                  <strong style="color:#334155">B. Nahrať z počítača</strong>
                  <div class="form-group" style="margin-top:8px; margin-bottom:8px;">
                      <input type="file" id="erp-import-file" accept=".csv,.txt" class="form-control form-control-sm">
                  </div>
                  <button id="btn-manual-import" class="btn btn-primary w-full btn-sm"><i class="fas fa-upload"></i> Nahrať a spracovať</button>
              </div>

              <div id="import-status" style="margin-top:10px; font-weight:bold; color:#166534; font-size:0.9em; min-height:1.2em;"></div>
          </div>

          <div class="stat-card">
              <h4><i class="fas fa-file-export"></i> Export (read-only)</h4>
              <p class="small text-muted">
                  Exportný súbor <b>VYROBKY.CSV</b> sa generuje <b>iba</b> po uzavretí <b>Denného príjmu v EXPEDÍCII</b>.
                  V kancelárii je export zablokovaný, aby sa súbor nemohol prepisovať nesprávnymi položkami.
              </p>
              <div style="margin:16px 0; text-align:center;">
                  <i class="fas fa-lock fa-3x" style="color:#64748b; opacity:0.85;"></i>
              </div>
              <div class="small text-muted" style="text-align:center;">
                  Pre vytvorenie exportu choď do modulu <b>Expedícia</b> → <b>Denný príjem</b> → <b>Uzavrieť deň</b>.
              </div>
          </div>

          <div class="stat-card" style="grid-column: 1 / -1; border-top: 4px solid #64748b;">
              <h4><i class="fas fa-list-ul"></i> Denník posledných operácií</h4>
              <div class="table-responsive">
                  <table class="table table-sm table-striped" style="font-size:0.9em;">
                      <thead>
                          <tr>
                              <th width="150">Čas</th>
                              <th>Akcia</th>
                              <th width="100">Stav</th>
                          </tr>
                      </thead>
                      <tbody id="erp-log-tbody">
                          <tr><td colspan="3" class="text-center text-muted">Načítavam...</td></tr>
                      </tbody>
                  </table>
              </div>
          </div>
      </div>
    `;

    // --- LOG FUNKCIE ---
    function addLog(action, status) {
      try {
        let logs = JSON.parse(localStorage.getItem('erp_sync_logs') || '[]');
        const now = new Date();
        const timeStr = now.getDate() + "." + (now.getMonth() + 1) + ". " +
          now.getHours().toString().padStart(2, '0') + ":" +
          now.getMinutes().toString().padStart(2, '0');

        logs.unshift({ time: timeStr, action: action, status: status });
        if (logs.length > 5) logs.length = 5;

        localStorage.setItem('erp_sync_logs', JSON.stringify(logs));
        renderLogs();
      } catch (e) {
        console.error(e);
      }
    }

    function renderLogs() {
      const tbody = document.getElementById('erp-log-tbody');
      if (!tbody) return;

      const logs = JSON.parse(localStorage.getItem('erp_sync_logs') || '[]');
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Žiadne záznamy</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map(l => {
        const color = l.status === 'OK' ? 'green' : (String(l.status).includes('Chyba') ? 'red' : 'orange');
        return `
          <tr>
              <td>${l.time}</td>
              <td>${l.action}</td>
              <td style="color:${color}; font-weight:bold;">${l.status}</td>
          </tr>
        `;
      }).join('');
    }

    renderLogs();

    // --- LOGIKA STAVU ---
    async function loadStatus() {
      const elExp = document.getElementById('st-export');
      const elImp = document.getElementById('st-import');
      const btnSrv = document.getElementById('btn-server-import');
      const badge = document.getElementById('server-file-badge');

      try {
        const res = await fetch('/api/erp/status');
        const data = await res.json();

        // Export status
        if (data.export_file && data.export_file.exists) {
          elExp.innerHTML = `<span style="color:#166534; font-weight:600;"><i class="fas fa-check-circle"></i> ${data.export_file.time}</span><br><small>Veľkosť: ${(data.export_file.size / 1024).toFixed(1)} kB</small>`;
        } else {
          elExp.innerHTML = `<span style="color:#94a3b8"><i class="fas fa-times-circle"></i> Neexistuje</span>`;
        }

        // Import status
        if (data.import_file && data.import_file.exists) {
          elImp.innerHTML = `<span style="color:#166534; font-weight:600;"><i class="fas fa-exclamation-circle"></i> ${data.import_file.time}</span><br><small>Čaká na spracovanie</small>`;
          btnSrv.disabled = false;
          badge.style.background = "#dcfce7";
          badge.style.color = "#166534";
          badge.innerHTML = `<i class="fas fa-check"></i> Pripravený`;
        } else {
          elImp.innerHTML = `<span style="color:#94a3b8"><i class="fas fa-times-circle"></i> Žiadny súbor</span>`;
          btnSrv.disabled = true;
          badge.style.background = "#f1f5f9";
          badge.style.color = "#64748b";
          badge.innerText = "Chýba súbor";
        }
      } catch (e) {
        console.error("Chyba statusu", e);
      }
    }

    loadStatus();
    document.getElementById('btn-refresh-status').onclick = loadStatus;

    // 1) Spracovať zo servera
    document.getElementById('btn-server-import').onclick = async () => {
      if (!confirm("Naozaj spustiť import súboru ZASOBA.CSV zo servera?")) return;

      const btn = document.getElementById('btn-server-import');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pracujem...';

      try {
        const res = await fetch('/api/erp/process-server', { method: 'POST' });
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        alert(d.message);
        addLog("Import (Server)", "OK");
        document.getElementById('import-status').innerText = "Import OK: " + new Date().toLocaleTimeString();
        loadStatus();
      } catch (e) {
        addLog("Import (Server)", "Chyba");
        alert("Chyba: " + (e && e.message ? e.message : e));
      } finally {
        btn.innerHTML = '<i class="fas fa-server"></i> Spracovať súbor zo servera';
        loadStatus();
      }
    };

    // 2) Manuálny upload
    document.getElementById('btn-manual-import').onclick = async () => {
      const file = document.getElementById('erp-import-file').files[0];
      if (!file) return alert("Vyberte súbor!");

      const fd = new FormData();
      fd.append('file', file);

      const btn = document.getElementById('btn-manual-import');
      btn.innerText = "Nahrávam...";

      try {
        const res = await fetch('/api/erp/manual-import', { method: 'POST', body: fd });
        const data = await res.json();
        if (!data.error) {
          alert(data.message || "Hotovo");
          addLog("Import (Upload)", "OK");
          document.getElementById('import-status').innerText = "Import OK: " + new Date().toLocaleTimeString();
        } else {
          throw new Error(data.error);
        }
      } catch (e) {
        addLog("Import (Upload)", "Chyba");
        alert("Chyba importu: " + (e && e.message ? e.message : e));
      } finally {
        btn.innerHTML = '<i class="fas fa-upload"></i> Nahrať a spracovať';
      }
    };
  }

  // Router hook
  document.addEventListener('DOMContentLoaded', () => {
    const link = document.querySelector('a[data-section="section-import-export"]');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
        document.getElementById('section-import-export').style.display = 'block';
        viewImportExport();
      });
    }
  });

})(window, document);
