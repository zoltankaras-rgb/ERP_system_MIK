(function (window, document) {
  'use strict';

  async function viewImportExport() {
      const host = document.getElementById('section-import-export');
      if (!host) return;

      // Načítame aktuálne nastavenia (čas exportu)
      let settings = { enabled: false, time: "06:00" };
      try {
          const res = await fetch('/api/erp/settings');
          if(res.ok) settings = await res.json();
      } catch(e) { console.error(e); }

      host.innerHTML = `
        <div class="stat-card" style="border-left: 5px solid #2563eb; margin-bottom: 1rem;">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div>
                    <h3><i class="fas fa-exchange-alt"></i> Synchronizácia s ERP</h3>
                    <p class="text-muted" style="margin-bottom:0.5rem">
                        Výmenný adresár: <code>/static/erp_exchange/</code> (SFTP).
                    </p>
                </div>
                <button id="btn-refresh-status" class="btn btn-sm btn-secondary">
                    <i class="fas fa-sync"></i> Obnoviť stav
                </button>
            </div>

            <!-- STATUS PANEL -->
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
            
            <!-- KARTA IMPORT -->
            <div class="stat-card">
                <h4><i class="fas fa-file-import"></i> Import Skladu</h4>
                
                <!-- Možnosť A: Zo servera -->
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

                <!-- Možnosť B: Upload -->
                <div style="border-top:1px solid #eee; padding-top:12px;">
                    <strong style="color:#334155">B. Nahrať z počítača</strong>
                    <div class="form-group" style="margin-top:8px; margin-bottom:8px;">
                        <input type="file" id="erp-import-file" accept=".csv,.txt" class="form-control form-control-sm">
                    </div>
                    <button id="btn-manual-import" class="btn btn-primary w-full btn-sm"><i class="fas fa-upload"></i> Nahrať a spracovať</button>
                </div>
                
                <div id="import-status" style="margin-top:10px; font-weight:bold; color:#166534; font-size:0.9em; min-height:1.2em;"></div>
            </div>

            <!-- KARTA EXPORT -->
            <div class="stat-card">
                <h4><i class="fas fa-file-export"></i> Export Cien</h4>
                <p class="small text-muted">
                    Vygeneruje aktuálny <b>VYROBKY.CSV</b> na server. Synchronizačný skript si ho potom stiahne.
                </p>
                <div style="margin:20px 0; text-align:center;">
                    <i class="fas fa-file-csv fa-3x" style="color:#2563eb; opacity:0.8;"></i>
                </div>
                <button id="btn-manual-export" class="btn btn-primary w-full">
                    <i class="fas fa-cog"></i> Vygenerovať a stiahnuť
                </button>
                <p class="small text-muted" style="margin-top:10px; text-align:center;">
                    (Zároveň sa uloží do priečinka pre sync)
                </p>
            </div>

            <!-- KARTA NASTAVENIA -->
            <div class="stat-card" style="grid-column: 1 / -1;">
                <h4><i class="fas fa-clock"></i> Automatický Export</h4>
                <div class="form-grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 1rem; align-items:end;">
                    <div class="form-group">
                        <label>Stav automatizácie</label>
                        <select id="erp-auto-enabled" style="width:100%; padding:8px;">
                            <option value="0" ${!settings.enabled ? 'selected' : ''}>Vypnuté</option>
                            <option value="1" ${settings.enabled ? 'selected' : ''}>Zapnuté</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Čas exportu (denne)</label>
                        <input type="time" id="erp-auto-time" value="${settings.time}" style="width:100%; padding:8px;">
                    </div>
                    <div class="form-group">
                        <button id="btn-save-settings" class="btn btn-secondary w-full"><i class="fas fa-save"></i> Uložiť nastavenia</button>
                    </div>
                </div>
            </div>
        </div>
      `;

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
              if(data.export_file.exists) {
                  elExp.innerHTML = `<span style="color:#166534; font-weight:600;"><i class="fas fa-check-circle"></i> ${data.export_file.time}</span><br><small>Veľkosť: ${(data.export_file.size/1024).toFixed(1)} kB</small>`;
              } else {
                  elExp.innerHTML = `<span style="color:#94a3b8"><i class="fas fa-times-circle"></i> Neexistuje</span>`;
              }

              // Import status
              if(data.import_file.exists) {
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

          } catch(e) { console.error("Chyba statusu", e); }
      }

      // Spustiť načítanie stavu pri otvorení
      loadStatus();
      document.getElementById('btn-refresh-status').onclick = loadStatus;

      // --- HANDLERS ---

      // 1. Spracovať zo servera
      document.getElementById('btn-server-import').onclick = async () => {
          if(!confirm("Naozaj spustiť import súboru ZASOBA.CSV zo servera?")) return;
          
          const btn = document.getElementById('btn-server-import');
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pracujem...';
          
          try {
              const res = await fetch('/api/erp/process-server', { method: 'POST' });
              const d = await res.json();
              if(d.error) throw new Error(d.error);
              
              alert(d.message);
              document.getElementById('import-status').innerText = "Import OK: " + new Date().toLocaleTimeString();
              loadStatus(); // Obnoviť, lebo súbor sa asi zmazal/spracoval
          } catch(e) {
              alert("Chyba: " + e.message);
          } finally {
              btn.innerHTML = '<i class="fas fa-server"></i> Spracovať súbor zo servera';
              // ne-enableujeme hneď, lebo loadStatus rozhodne či tam súbor ešte je
              loadStatus();
          }
      };

      // 2. Manuálny upload
      document.getElementById('btn-manual-import').onclick = async () => {
          const file = document.getElementById('erp-import-file').files[0];
          if (!file) return alert("Vyberte súbor!");
          
          const fd = new FormData();
          fd.append('file', file);
          
          const btn = document.getElementById('btn-manual-import');
          btn.innerText = "Nahrávam...";
          
          try {
              const res = await fetch('/api/erp/manual-import', { method:'POST', body:fd });
              const data = await res.json();
              alert(data.message || (data.error ? "Chyba: "+data.error : "Hotovo"));
              if(!data.error) document.getElementById('import-status').innerText = "Import OK: " + new Date().toLocaleTimeString();
          } catch(e) { alert("Chyba importu: " + e); }
          finally { btn.innerHTML = '<i class="fas fa-upload"></i> Nahrať a spracovať'; }
      };

      // 3. Export
      document.getElementById('btn-manual-export').onclick = async () => {
          // Najprv stiahnuť (to triggeruje generovanie na serveri)
          window.location.href = '/api/erp/manual-export';
          // Po chvíľke obnoviť status, aby sme videli nový čas exportu
          setTimeout(loadStatus, 2000);
      };

      // 4. Settings
      document.getElementById('btn-save-settings').onclick = async () => {
          const payload = {
              enabled: document.getElementById('erp-auto-enabled').value === '1',
              time: document.getElementById('erp-auto-time').value
          };
          try {
              await fetch('/api/erp/settings', {
                  method: 'POST',
                  headers: {'Content-Type':'application/json'},
                  body: JSON.stringify(payload)
              });
              alert("Nastavenia uložené.");
          } catch(e) { alert("Chyba: " + e); }
      };
  }

  // Router hook
  document.addEventListener('DOMContentLoaded', () => {
      const link = document.querySelector('a[data-section="section-import-export"]');
      if(link) {
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