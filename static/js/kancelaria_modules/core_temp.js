/* ============================================================
   Core Temp Auto-Monitor (70-72°C Range)
   ============================================================ */

(function () {
  const SECTION_ID = "section-core-temp";

  // --- KONFIGURÁCIA API ---
  const API = {
    list: (days) => `/api/kancelaria/core_temp/list?days=${days}`,
    history: (batchId) => `/api/kancelaria/core_temp/measurement/history?batchId=${encodeURIComponent(batchId)}`
  };

  // --- POMOCNÉ FUNKCIE (DOM) ---
  function $(sel, root = document) { return root.querySelector(sel); }
  
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.substring(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const ch of arr) {
      if (typeof ch === "string" || typeof ch === "number") 
        n.appendChild(document.createTextNode(String(ch)));
      else if (ch) n.appendChild(ch);
    }
    return n;
  }

  function apiCall(url) {
    return fetch(url).then(r => r.json()).catch(e => {
        console.error(e);
        return [];
    });
  }

  // --- MODAL SYSTÉM (SELF-HEALING) ---
  function ensureModalContainer() {
    let wrap = $("#modal-container");
    if (!wrap) {
        wrap = el("div", { id: "modal-container" }, [
            el("div", { class: "modal-dialog" }, [
                el("div", { class: "modal-header" }, [
                    el("h3", {}),
                    el("button", { class: "close-btn", text: "×" })
                ]),
                el("div", { class: "modal-body" })
            ])
        ]);
        document.body.appendChild(wrap);
        
        // CSS Injekcia pre istotu
        const style = document.createElement('style');
        style.innerHTML = `
            #modal-container { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center; }
            #modal-container.visible { display:flex; }
            .modal-dialog { background:#fff; padding:20px; border-radius:8px; width:500px; max-width:90%; max-height:80vh; overflow-y:auto; }
            .modal-header { display:flex; justify-content:space-between; border-bottom:1px solid #eee; margin-bottom:15px; }
            .close-btn { background:none; border:none; font-size:20px; cursor:pointer; }
        `;
        document.head.appendChild(style);
    }
    return wrap;
  }

  function openModal(title, content) {
    const wrap = ensureModalContainer();
    $(".modal-header h3", wrap).textContent = title;
    const body = $(".modal-body", wrap);
    body.innerHTML = "";
    body.appendChild(content);
    
    wrap.classList.add("visible");
    const close = () => wrap.classList.remove("visible");
    $(".close-btn", wrap).onclick = close;
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
  }

  // --- LOGIKA APLIKÁCIE ---
  const state = { days: 30 };

  function buildUI(section) {
    section.innerHTML = "";
    
    const toolbar = el("div", { style: "margin-bottom:15px; display:flex; gap:10px; align-items:center;" }, [
        el("h3", { style: "margin:0; margin-right:auto;" }, "Monitoring Teploty (Auto 70-72°C)"),
        el("label", {}, "Rozsah dní:"),
        el("select", { class: "form-control", style: "width:auto;", onchange: (e) => loadData(e.target.value) }, [
            el("option", { value: "30", selected: true }, "30 dní"),
            el("option", { value: "90" }, "90 dní"),
        ]),
        el("button", { class: "btn btn-primary", text: "Obnoviť", onclick: () => loadData(state.days) })
    ]);

    const table = el("table", { class: "table table-striped", style: "width:100%; border-collapse:collapse;" }, [
        el("thead", {}, el("tr", { style: "background:#f8f9fa; text-align:left;" }, [
            el("th", { style:"padding:10px" }, "Dátum"),
            el("th", { style:"padding:10px" }, "Výrobok"),
            el("th", { style:"padding:10px" }, "Slot"),
            el("th", { style:"padding:10px" }, "Teplota (Posledná)"),
            el("th", { style:"padding:10px" }, "Stav"),
            el("th", { style:"padding:10px" }, "História")
        ])),
        el("tbody", { id: "ct-tbody" })
    ]);

    section.appendChild(toolbar);
    section.appendChild(el("div", { style: "overflow-x:auto; background:#fff; padding:10px; border-radius:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1);" }, table));
  }

  async function loadData(days) {
    state.days = days;
    const tbody = $("#ct-tbody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Načítavam dáta...</td></tr>';

    const data = await apiCall(API.list(days));
    renderTable(data);
  }

  function renderTable(items) {
    const tbody = $("#ct-tbody");
    tbody.innerHTML = "";

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Žiadne záznamy.</td></tr>';
        return;
    }

    items.forEach(it => {
        const tr = el("tr", { style: "border-bottom:1px solid #eee;" });
        
        // Farba stavu
        let statusHtml = el("span", { style: "color:orange; font-weight:bold;" }, "ČAKÁ");
        if (it.status === "OK") {
            statusHtml = el("span", { style: "color:green; font-weight:bold; background:#e8f5e9; padding:2px 6px; border-radius:4px;" }, "OK");
        }

        const btnHist = el("button", { class: "btn btn-sm btn-secondary", text: "Zobraziť priebeh" });
        btnHist.onclick = () => showHistory(it);

        tr.appendChild(el("td", { style:"padding:10px" }, it.productionDate));
        tr.appendChild(el("td", { style:"padding:10px; font-weight:600;" }, it.productName));
        tr.appendChild(el("td", { style:"padding:10px" }, it.slotText));
        tr.appendChild(el("td", { style:"padding:10px; font-size:1.1em;" }, it.measuredC ? `${it.measuredC.toFixed(1)} °C` : "-"));
        tr.appendChild(el("td", { style:"padding:10px" }, statusHtml));
        tr.appendChild(el("td", { style:"padding:10px" }, btnHist));

        tbody.appendChild(tr);
    });
  }

  async function showHistory(item) {
      if (item.status !== "OK") {
          alert("Dáta pre túto dávku ešte neboli vygenerované (čas slotu ešte nenastal).");
          return;
      }
      
      const rows = await apiCall(API.history(item.batchId));
      
      const list = el("div", {}, [
          el("div", { style: "margin-bottom:10px; font-weight:bold;" }, `${item.productName} (${item.productionDate})`),
          el("table", { style: "width:100%; font-size:0.9em;" }, [
              el("thead", {}, el("tr", {}, [
                  el("th", { style:"text-align:left" }, "Čas"),
                  el("th", { style:"text-align:left" }, "Teplota"),
                  el("th", {}, "Poznámka")
              ])),
              el("tbody", {}, rows.map(r => el("tr", { style: "border-bottom:1px solid #eee;" }, [
                  el("td", { style:"padding:4px" }, r.measuredAt.split(" ")[1]), // Iba čas
                  el("td", { style:"padding:4px" }, `${r.measuredC.toFixed(1)} °C`),
                  el("td", { style:"padding:4px; color:#666;" }, r.note || "")
              ])))
          ])
      ]);
      
      openModal("História merania (Minúta po minúte)", list);
  }

  // START
  document.addEventListener("DOMContentLoaded", () => {
      const section = document.getElementById(SECTION_ID);
      if (section) {
          buildUI(section);
          loadData(30);
      }
  });

})();