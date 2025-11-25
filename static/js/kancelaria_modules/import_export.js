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
            <h3><i class="fas fa-exchange-alt"></i> Synchronizácia s ERP (Sklad)</h3>
            <p class="text-muted">
                Výmenný adresár: <code>/static/erp_exchange/</code>.<br>
                Export generuje súbor <b>VYROBKY.CSV</b> (Smart Pricing). Import číta <b>ZASOBA.CSV</b>.
            </p>
        </div>

        <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem;">
            
            <div class="stat-card">
                <h4><i class="fas fa-file-import"></i> Manuálny Import</h4>
                <p class="small text-muted">Nahrať ZASOBA.CSV a aktualizovať sklad/ceny.</p>
                <div class="form-group" style="margin-top:15px;">
                    <input type="file" id="erp-import-file" accept=".csv,.txt" class="form-control">
                </div>
                <button id="btn-manual-import" class="btn btn-primary w-full"><i class="fas fa-upload"></i> Nahrať a spracovať</button>
                <div id="import-status" style="margin-top:10px; font-weight:bold; color:#166534;"></div>
            </div>

            <div class="stat-card">
                <h4><i class="fas fa-file-export"></i> Manuálny Export</h4>
                <p class="small text-muted">Vygenerovať VYROBKY.CSV s aktuálnymi cenami.</p>
                <div style="margin-top:15px; text-align:center; padding: 10px;">
                    <i class="fas fa-file-csv fa-3x" style="color:#16a34a;"></i>
                </div>
                <button id="btn-manual-export" class="btn btn-success w-full"><i class="fas fa-download"></i> Vygenerovať a stiahnuť</button>
            </div>

            <div class="stat-card" style="grid-column: 1 / -1;">
                <h4><i class="fas fa-clock"></i> Nastavenie Automatického Exportu</h4>
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
                <p class="small text-muted" style="margin-top:10px;">
                    Pri zmene času sa plánovač automaticky reštartuje (do 5 minút).
                </p>
            </div>
        </div>
      `;

      // --- Handlers ---

      // Import
      document.getElementById('btn-manual-import').onclick = async () => {
          const file = document.getElementById('erp-import-file').files[0];
          if (!file) return alert("Vyberte súbor!");
          
          const fd = new FormData();
          fd.append('file', file);
          
          try {
              document.getElementById('btn-manual-import').innerText = "Pracujem...";
              const res = await fetch('/api/erp/manual-import', { method:'POST', body:fd });
              const data = await res.json();
              alert(data.message || (data.error ? "Chyba: "+data.error : "Hotovo"));
              if(!data.error) document.getElementById('import-status').innerText = "Posledný import OK: " + new Date().toLocaleTimeString();
          } catch(e) { alert("Chyba importu: " + e); }
          finally { document.getElementById('btn-manual-import').innerHTML = '<i class="fas fa-upload"></i> Nahrať a spracovať'; }
      };

      // Export
      document.getElementById('btn-manual-export').onclick = () => {
          window.location.href = '/api/erp/manual-export';
      };

      // Uloženie nastavení
      document.getElementById('btn-save-settings').onclick = async () => {
          const payload = {
              enabled: document.getElementById('erp-auto-enabled').value === '1',
              time: document.getElementById('erp-auto-time').value
          };
          try {
              const res = await fetch('/api/erp/settings', {
                  method: 'POST',
                  headers: {'Content-Type':'application/json'},
                  body: JSON.stringify(payload)
              });
              const d = await res.json();
              alert(d.message);
          } catch(e) { alert("Chyba: " + e); }
      };
  }

  // Inicializácia po načítaní kancelaria.js (Router hook)
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