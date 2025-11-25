// =================================================================
// === SUB-MODUL KANCELÁRIA: HACCP ===
// =================================================================
(function (root, doc) {
    'use strict';

    // --- Helpers ---
    const apiRequest = async (url, options = {}) => {
        const res = await fetch(url, {
            method: options.method || 'GET',
            headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
            body: options.body instanceof FormData ? options.body : JSON.stringify(options.body),
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        return data;
    };

    // Globálna premenná pre editor v rámci modulu
    let activeTinyMceEditor = null;

    function initializeHaccpModule() {
        const container = document.getElementById('section-haccp');
        if (!container) return;

        container.innerHTML = `
        <h3>Správa HACCP Dokumentácie</h3>
        <div style="display:flex; gap:2rem; height: 80vh;">
          <div style="flex:1; display:flex; flex-direction:column; border-right:1px solid #ddd; padding-right:1rem;">
            <div style="margin-bottom:1rem;">
                <button id="add-new-haccp-doc-btn" class="btn btn-success" style="width:100%; margin-bottom: 10px;">
                  <i class="fas fa-plus"></i> Nový Dokument
                </button>
                
                <input type="file" id="haccp-import-input" accept=".docx" style="display:none;">
                <button id="haccp-import-btn" class="btn btn-secondary" style="width:100%;">
                  <i class="fas fa-file-import"></i> Import DOCX
                </button>
            </div>
            <h4>Zoznam dokumentov</h4>
            <ul id="haccp-doc-list" class="sidebar-nav" style="flex:1; overflow-y:auto; border:1px solid #eee; padding:5px; border-radius:4px;">
                <li class="muted">Načítavam...</li>
            </ul>
          </div>
    
          <div style="flex:3; display:flex; flex-direction:column;">
            <div class="form-group" style="display:flex; gap:.5rem; align-items:center; margin-bottom:10px;">
              <label for="haccp-doc-title" style="min-width:80px; font-weight:bold;">Názov:</label>
              <input type="text" id="haccp-doc-title" class="form-control" style="flex:1;" placeholder="Zadajte názov dokumentu...">
              <input type="hidden" id="haccp-doc-id">
              
              <div style="display:flex; gap:.5rem;">
                <button id="haccp-export-btn" class="btn btn-primary" disabled title="Stiahnuť ako Word">
                  <i class="fas fa-file-export"></i> Export
                </button>
                <button id="haccp-export-original-btn" class="btn btn-soft" disabled title="Stiahnuť pôvodný súbor">
                  <i class="fas fa-download"></i> Orig.
                </button>
                <button id="haccp-delete-btn" class="btn btn-danger" disabled title="Vymazať dokument">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
    
            <div style="flex:1; border:1px solid #ccc;">
                <textarea id="haccp-editor"></textarea>
            </div>
            
            <div style="margin-top:10px; text-align:right;">
                <button id="save-haccp-doc-btn" class="btn btn-success" style="padding:10px 20px; font-size:1.1em;">
                  <i class="fas fa-save"></i> Uložiť Dokument
                </button>
            </div>
          </div>
        </div>
      `;

        // Elementy
        const docList = container.querySelector('#haccp-doc-list');
        const titleEl = container.querySelector('#haccp-doc-title');
        const idEl = container.querySelector('#haccp-doc-id');
        const btnSave = container.querySelector('#save-haccp-doc-btn');
        const btnNew = container.querySelector('#add-new-haccp-doc-btn');
        const btnImp = container.querySelector('#haccp-import-btn');
        const inpImp = container.querySelector('#haccp-import-input');
        const btnExp = container.querySelector('#haccp-export-btn');
        const btnExpOrig = container.querySelector('#haccp-export-original-btn');
        const btnDel = container.querySelector('#haccp-delete-btn');

        // ===== 1. Inicializácia TinyMCE Editora =====
        const ensureEditor = (content) => {
            if (activeTinyMceEditor && !activeTinyMceEditor.isHidden()) {
                activeTinyMceEditor.setContent(content || '');
                return;
            }

            if (tinymce.get('haccp-editor')) {
                tinymce.get('haccp-editor').remove();
            }

            tinymce.init({
                selector: '#haccp-editor',
                language: 'sk',
                plugins: 'anchor autolink charmap codesample emoticons image link lists media searchreplace table visualblocks wordcount',
                toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline | align | link image | numlist bullist indent outdent | removeformat',
                height: '100%',
                resize: false,
                menubar: false,
                setup: (editor) => {
                    activeTinyMceEditor = editor;
                    editor.on('init', () => {
                        editor.setContent(content || '');
                    });
                }
            });
        };

        // ===== 2. Načítanie zoznamu dokumentov =====
        const loadDocs = async (selectId = null) => {
            docList.innerHTML = '<li class="muted"><i class="fas fa-spinner fa-spin"></i> Načítavam...</li>';
            try {
                const data = await apiRequest('/api/kancelaria/getHaccpDocs');
                const docs = data.docs || [];

                docList.innerHTML = '';

                if (docs.length === 0) {
                    docList.innerHTML = '<li class="muted" style="padding:10px;">Zatiaľ žiadne dokumenty.</li>';
                    return;
                }

                docs.forEach(doc => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'nav-link';
                    a.style.display = 'block';
                    a.style.padding = '8px';
                    a.style.borderBottom = '1px solid #eee';
                    a.textContent = doc.title || '(Bez názvu)';
                    a.dataset.id = doc.id;

                    if (selectId && doc.id === selectId) {
                        a.classList.add('active');
                        a.style.backgroundColor = '#e0f2fe';
                    }

                    a.onclick = async (e) => {
                        e.preventDefault();
                        docList.querySelectorAll('a').forEach(x => {
                            x.classList.remove('active');
                            x.style.backgroundColor = '';
                        });
                        a.classList.add('active');
                        a.style.backgroundColor = '#e0f2fe';

                        await loadDocContent(doc.id);
                    };
                    li.appendChild(a);
                    docList.appendChild(li);
                });
            } catch (e) {
                docList.innerHTML = `<li class="error">Chyba: ${e.message}</li>`;
            }
        };

        // ===== 3. Načítanie obsahu konkrétneho dokumentu =====
        const loadDocContent = async (id) => {
            try {
                const res = await apiRequest('/api/kancelaria/getHaccpDocContent', {
                    method: 'POST', body: { id: id }
                });

                if (res.doc) {
                    titleEl.value = res.doc.title || '';
                    idEl.value = res.doc.id || '';
                    ensureEditor(res.doc.content || '');

                    // Povoliť tlačidlá
                    btnExp.disabled = false;
                    btnDel.disabled = false;

                    const hasOrig = res.doc.attachments && res.doc.attachments.original_docx;
                    btnExpOrig.disabled = !hasOrig;
                    if (hasOrig) {
                        btnExpOrig.onclick = () => window.open(res.doc.attachments.original_docx, '_blank');
                    }
                }
            } catch (e) {
                alert("Nepodarilo sa načítať dokument: " + e.message);
            }
        };

        // ===== 4. Tlačidlo NOVÝ =====
        btnNew.onclick = () => {
            docList.querySelectorAll('a').forEach(x => {
                x.classList.remove('active');
                x.style.backgroundColor = '';
            });
            titleEl.value = 'Nový dokument';
            idEl.value = '';
            ensureEditor('');
            btnExp.disabled = true;
            btnExpOrig.disabled = true;
            btnDel.disabled = true;
            titleEl.focus();
        };

        // ===== 5. Tlačidlo ULOŽIŤ =====
        btnSave.onclick = async () => {
            const title = titleEl.value.trim();
            const id = idEl.value || null;

            let content = '';
            if (activeTinyMceEditor) {
                content = activeTinyMceEditor.getContent();
            } else {
                content = document.getElementById('haccp-editor').value;
            }

            if (!title) { alert('Zadajte názov dokumentu.'); return; }

            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ukladám...';

            try {
                const res = await apiRequest('/api/kancelaria/saveHaccpDoc', {
                    method: 'POST',
                    body: { id, title, content }
                });

                if (res && res.doc && res.doc.id) {
                    idEl.value = res.doc.id;
                    await loadDocs(res.doc.id);

                    btnExp.disabled = false;
                    btnDel.disabled = false;

                    alert("Dokument uložený.");
                }
            } catch (e) {
                console.error(e);
                alert("Chyba pri ukladaní: " + e.message);
            } finally {
                btnSave.disabled = false;
                btnSave.innerHTML = '<i class="fas fa-save"></i> Uložiť Dokument';
            }
        };

        // ===== 6. Tlačidlo VYMAZAŤ =====
        btnDel.onclick = async () => {
            const id = idEl.value;
            if (!id) return;

            if (!confirm("Naozaj chcete tento dokument nenávratne vymazať?")) return;

            try {
                const res = await apiRequest('/api/kancelaria/deleteHaccpDoc', {
                    method: 'POST',
                    body: { id: id }
                });

                alert(res.message || "Vymazané.");

                btnNew.click(); // Reset do stavu nový
                await loadDocs();

            } catch (e) {
                alert("Chyba pri mazaní: " + e.message);
            }
        };

        // ===== 7. IMPORT DOCX =====
        btnImp.onclick = () => {
            inpImp.value = '';
            inpImp.click();
        };

        inpImp.onchange = async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;

            if (!/\.docx$/i.test(f.name)) {
                alert('Prosím, vyberte súbor s príponou .docx');
                return;
            }

            const fd = new FormData();
            fd.append('file', f);

            const origLabel = btnImp.innerHTML;
            btnImp.disabled = true;
            btnImp.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importujem...';

            try {
                // Priamy fetch pre FormData
                const res = await fetch('/api/kancelaria/haccp/import_docx', {
                    method: 'POST',
                    body: fd
                });

                let data;
                try { data = await res.json(); } catch { data = { error: 'Chybná odpoveď servera' }; }

                if (!res.ok || data.error) {
                    throw new Error(data.error || 'Import zlyhal.');
                }

                alert("Import úspešný.");
                await loadDocs(data.doc ? data.doc.id : null);

                if (data.doc && data.doc.id) {
                    await loadDocContent(data.doc.id);
                }

            } catch (e) {
                console.error(e);
                alert("Chyba pri importe: " + e.message);
            } finally {
                btnImp.disabled = false;
                btnImp.innerHTML = origLabel;
                inpImp.value = '';
            }
        };

        // ===== 8. EXPORT DOCX =====
        btnExp.onclick = () => {
            const id = idEl.value;
            if (!id) return;
            window.open(`/api/kancelaria/haccp/export_docx?id=${encodeURIComponent(id)}`, '_blank');
        };

        // Štart
        ensureEditor('');
        loadDocs();
    }

    // Export do window, aby sa to dalo spustiť
    if (typeof window !== 'undefined') {
        window.initializeHaccpModule = initializeHaccpModule;
    }

})(window, document);