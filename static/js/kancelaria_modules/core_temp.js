/* ============================================================
   Kancelária – HACCP: Teplota jadra (Core Temp)
   - Pridaný REPORT a TLAČ
   - Zobrazenie Limitov a Času
   ============================================================ */

(function () {
  const SECTION_ID = "section-core-temp";

  const API = {
    list: (days) => `/api/kancelaria/core_temp/list?days=${encodeURIComponent(days)}`,
    productDefaults: `/api/kancelaria/core_temp/product_defaults`,
    saveProductDefault: `/api/kancelaria/core_temp/product_defaults/save`,
    saveMeasurement: `/api/kancelaria/core_temp/measurement/save`,
    history: (batchId) => `/api/kancelaria/core_temp/measurement/history?batchId=${encodeURIComponent(batchId)}`
  };

  // -----------------------
  // Helpers
  // -----------------------
  function $(sel, root = document) { return root.querySelector(sel); }
  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v;
      else n.setAttribute(k, v);
    }
    const arr = Array.isArray(children) ? children : [children];
    for (const ch of arr) {
      if (ch == null) continue;
      if (typeof ch === "string") n.appendChild(document.createTextNode(ch));
      else n.appendChild(ch);
    }
    return n;
  }

  function safeStr(x) { return (x === null || x === undefined) ? "" : String(x); }
  function safeNum(x) {
    if (x === null || x === undefined || x === "") return null;
    const v = Number(String(x).replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }
  function fmtQtyKg(v) {
    const n = safeNum(v);
    if (n === null) return "-";
    return n.toFixed(3);
  }
  function fmtFloat(v, d = 1) {
    const n = safeNum(v);
    if (n === null) return "-";
    return n.toFixed(d);
  }
  function ymdParts(ymd) {
    const s = safeStr(ymd);
    const p = s.split("-");
    if (p.length !== 3) return null;
    return { y: p[0], m: p[1], d: p[2] };
  }

  function statusLabel(it) {
    const st = safeStr(it.haccpStatus || "NA");
    if (st === "OK") return { text: "OK", cls: "status-ok" };
    if (st === "MISSING") return { text: "CHÝBA", cls: "status-missing" };
    if (st === "FAIL") return { text: "MIMO", cls: "status-low" };
    return { text: "—", cls: "" };
  }

  function pill(it) {
    const s = statusLabel(it);
    return el("span", { class: `status-pill ${s.cls}` }, s.text);
  }

  async function apiGet(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  async function apiPost(url, payload) {
    const r = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  function toast(msg) { alert(msg); }

  // -----------------------
  // Modal Logic
  // -----------------------
  function getModal() {
    const wrap = $("#modal-container");
    if (!wrap) return null;
    const title = $(".modal-header h3", wrap);
    const body = $(".modal-body", wrap);
    const closeBtn = $(".close-btn", wrap);
    return { wrap, title, body, closeBtn };
  }
  function openModal(titleText, bodyNode, footerNode) {
    const m = getModal();
    if (!m) { toast("Modal container chýba."); return; }
    m.title.textContent = titleText || "—";
    m.body.innerHTML = "";
    if (bodyNode) m.body.appendChild(bodyNode);
    if (footerNode) m.body.appendChild(footerNode);
    m.wrap.classList.add("visible");
    const onClose = () => closeModal();
    if (m.closeBtn) m.closeBtn.onclick = onClose;
    const backdrop = $(".modal-backdrop", m.wrap);
    if (backdrop) backdrop.onclick = onClose;
  }
  function closeModal() {
    const m = getModal();
    if (!m) return;
    m.wrap.classList.remove("visible");
    m.body.innerHTML = "";
  }

  // -----------------------
  // State
  // -----------------------
  const state = {
    loadedOnce: false,
    items: [],
    days: 365,
    filterText: "",
    onlyRequired: false,
    onlyMissing: false,
    tree: { years: [], monthsByYear: new Map(), daysByYM: new Map() },
    selected: { y: null, m: null, d: null }
  };

  // -----------------------
  // REPORT & PRINT LOGIC
  // -----------------------
  function openReportModal() {
    // Predvolené dátumy (dnes)
    const today = new Date().toISOString().split("T")[0];
    
    const body = el("div", {}, [
        el("div", {class: "muted", style:"margin-bottom:15px"}, "Vyberte rozsah a filtre pre tlač HACCP reportu."),
        el("div", {class: "form-grid"}, [
            el("div", {class: "form-group"}, [
                el("label", {}, "Dátum OD:"),
                el("input", {type: "date", id: "rpt-date-from", value: today})
            ]),
            el("div", {class: "form-group"}, [
                el("label", {}, "Dátum DO:"),
                el("input", {type: "date", id: "rpt-date-to", value: today})
            ]),
            el("div", {class: "form-group"}, [
                el("label", {}, "Názov výrobku (voliteľné):"),
                el("input", {type: "text", id: "rpt-prod-filter", placeholder: "Všetky"})
            ]),
            el("div", {class: "form-group"}, [
                el("label", {}, "Typ:"),
                el("select", {id: "rpt-type"}, [
                    el("option", {value: "all"}, "Všetky záznamy"),
                    el("option", {value: "ccp"}, "Len CCP (Varené)"),
                    el("option", {value: "missing"}, "Len chýbajúce merania")
                ])
            ])
        ])
    ]);

    const footer = el("div", {style:"display:flex;justify-content:flex-end;gap:10px;margin-top:20px"}, [
        el("button", {class: "btn btn-secondary", type:"button"}, "Zrušiť"),
        el("button", {class: "btn btn-primary", type:"button"}, [
            el("i", {class:"fas fa-print"}), " Generovať a Tlačiť"
        ])
    ]);

    footer.children[0].addEventListener("click", closeModal);
    footer.children[1].addEventListener("click", () => {
        const dFrom = $("#rpt-date-from").value;
        const dTo = $("#rpt-date-to").value;
        const prod = $("#rpt-prod-filter").value;
        const type = $("#rpt-type").value;
        printReport(dFrom, dTo, prod, type);
    });

    openModal("Tlač Reportu - Teplota Jadra", body, footer);
  }

  function printReport(dFrom, dTo, prodFilter, type) {
    // Filtrovanie dát
    const fromTime = new Date(dFrom).getTime();
    const toTime = new Date(dTo).getTime();
    const pf = prodFilter.trim().toLowerCase();

    const reportItems = state.items.filter(it => {
        const t = new Date(it.productionDate).getTime();
        if (t < fromTime || t > toTime) return false;
        if (pf && !it.productName.toLowerCase().includes(pf)) return false;
        if (type === "ccp" && !it.isRequired) return false;
        if (type === "missing" && (!it.isRequired || it.haccpStatus !== "MISSING")) return false;
        return true;
    }).sort((a,b) => {
        // Sort by Date then Product
        if (a.productionDate !== b.productionDate) return a.productionDate.localeCompare(b.productionDate);
        return a.productName.localeCompare(b.productName, "sk");
    });

    if (reportItems.length === 0) {
        toast("Pre zvolené kritériá sa nenašli žiadne záznamy.");
        return;
    }

    // Generovanie HTML pre nové okno
    const win = window.open("", "_blank");
    win.document.write(`
        <html>
        <head>
            <title>HACCP Report - Teplota Jadra</title>
            <style>
                body { font-family: sans-serif; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
                th { background-color: #f0f0f0; }
                h1 { font-size: 18px; text-align: center; margin-bottom: 5px; }
                .meta { text-align: center; font-size: 11px; margin-bottom: 20px; }
                .status-ok { color: green; font-weight: bold; }
                .status-missing { color: red; font-weight: bold; }
                @media print {
                    @page { margin: 1cm; size: landscape; }
                }
            </style>
        </head>
        <body>
            <h1>HACCP REPORT - TEPLOTA JADRA</h1>
            <div class="meta">
                Obdobie: ${dFrom} – ${dTo} | Filter: ${prodFilter || "Všetky"} | Typ: ${type} <br>
                Vygenerované: ${new Date().toLocaleString("sk-SK")}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Dátum</th>
                        <th>Výrobok</th>
                        <th>Šarža</th>
                        <th>Množ. (kg)</th>
                        <th>Limit (°C)</th>
                        <th>Čas (min)</th>
                        <th>Slot</th>
                        <th>Namerané (°C)</th>
                        <th>Čas merania</th>
                        <th>Stav</th>
                        <th>Poznámka</th>
                    </tr>
                </thead>
                <tbody>
    `);

    reportItems.forEach(it => {
        const limit = it.isRequired ? `${fmtFloat(it.targetLowC)}–${fmtFloat(it.targetHighC)}` : "-";
        const hold = it.isRequired ? it.holdMinutes : "-";
        const status = it.haccpStatus === "OK" ? "OK" : (it.haccpStatus === "MISSING" ? "CHÝBA" : "MIMO");
        const cls = it.haccpStatus === "OK" ? "status-ok" : "status-missing";
        
        win.document.write(`
            <tr>
                <td>${it.productionDate}</td>
                <td>${it.productName}</td>
                <td>${it.batchId}</td>
                <td>${fmtQtyKg(it.realQtyKg)}</td>
                <td>${limit}</td>
                <td>${hold}</td>
                <td>${it.slotText}</td>
                <td>${it.measuredC !== null ? fmtFloat(it.measuredC) : "-"}</td>
                <td>${it.measuredAt || "-"}</td>
                <td class="${cls}">${status}</td>
                <td>${it.note || ""}</td>
            </tr>
        `);
    });

    win.document.write(`
                </tbody>
            </table>
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    win.document.close();
  }

  // -----------------------
  // UI Building
  // -----------------------
  function buildSkeleton(section) {
    section.innerHTML = "";
    const header = el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("div", { html: "<h3 style='margin:0;border:none;padding:0'>Teplota jadra</h3><div class='muted'>Automatické sledovanie CCP (70°C+).</div>" }),
        el("div", { class: "coretemp-toolbar" }, [
          el("label", { class: "muted", style: "margin-right:6px" }, "Rozsah:"),
          el("select", { id: "ct-days" }, [
            el("option", { value: "30" }, "30 dní"),
            el("option", { value: "90" }, "90 dní"),
            el("option", { value: "365", selected: "selected" }, "365 dní"),
          ]),
          el("input", { id: "ct-filter", type: "text", placeholder: "Filter názvu...", style: "max-width:300px" }),
          el("span", { class: "spacer" }),
          // TLAČIDLO REPORT
          el("button", { class: "btn btn-secondary", id: "ct-report", type: "button" }, [
            el("i", { class: "fas fa-print" }), " Tlač Reportu"
          ]),
          el("button", { class: "btn btn-secondary", id: "ct-settings", type: "button" }, [
            el("i", { class: "fas fa-sliders-h" }), " Nastavenia"
          ]),
          el("button", { class: "btn btn-secondary", id: "ct-refresh", type: "button" }, [
            el("i", { class: "fas fa-rotate" }), " Obnoviť"
          ])
        ])
      ]),
      el("div", { class: "card-body" }, [
        el("div", { class: "coretemp-grid" }, [
          el("div", { class: "coretemp-aside" }, [
            el("div", { class: "analysis-card" }, [
               el("div", {class: "tree"}, [
                  el("div", {class: "tree-col"}, [el("h4",{},"Rok"), el("ul", {class: "tree-list", id: "ct-years"}, [])]),
                  el("div", {class: "tree-col"}, [el("h4",{},"Mesiac"), el("ul", {class: "tree-list", id: "ct-months"}, [])]),
                  el("div", {class: "tree-col"}, [el("h4",{},"Deň"), el("ul", {class: "tree-list", id: "ct-dayslist"}, [])])
               ])
            ])
          ]),
          el("div", { class: "coretemp-main" }, [
            el("div", { class: "analysis-card" }, [
              el("div", { class: "mini-row", style: "justify-content:space-between" }, [
                el("div", { id: "ct-day-title", class: "muted" }, "Vyber deň vľavo."),
                el("div", { id: "ct-summary", class: "muted" }, "")
              ]),
              el("div", { class: "table-container", style: "margin-top:10px" }, [
                el("table", {}, [
                  el("thead", {}, el("tr", {}, [
                    el("th", {}, "Dátum"),
                    el("th", {}, "Výrobok"),
                    el("th", {}, "Šarža"),
                    el("th", {}, "Plán (kg)"),
                    el("th", {}, "Limit °C"),  // UPRAVENÉ
                    el("th", {}, "Čas"),      // UPRAVENÉ
                    el("th", {}, "Slot"),
                    el("th", {}, "Namerané"),
                    el("th", {}, "Stav"),
                    el("th", {}, "Akcie"),
                  ])),
                  el("tbody", { id: "ct-tbody" }, [])
                ])
              ])
            ])
          ])
        ])
      ])
    ]);
    section.appendChild(header);
  }

  function normalizeItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(x => ({
        batchId: safeStr(x.batchId),
        productionDate: safeStr(x.productionDate),
        productName: safeStr(x.productName),
        plannedQtyKg: safeNum(x.plannedQtyKg),
        realQtyKg: safeNum(x.realQtyKg),
        isRequired: !!x.isRequired,
        targetLowC: safeNum(x.targetLowC),
        targetHighC: safeNum(x.targetHighC),
        holdMinutes: safeNum(x.holdMinutes),
        measuredC: safeNum(x.measuredC),
        measuredAt: safeStr(x.measuredAt),
        note: safeStr(x.note),
        slotText: safeStr(x.slotText),
        haccpStatus: safeStr(x.haccpStatus)
    }));
  }

  function buildTreeFromItems(items) {
    // Reset Tree
    state.tree.years = [];
    state.tree.monthsByYear.clear();
    state.tree.daysByYM.clear();

    const yearsSet = new Set();
    for (const it of items) {
        const p = ymdParts(it.productionDate);
        if(!p) continue;
        yearsSet.add(p.y);
        
        if(!state.tree.monthsByYear.has(p.y)) state.tree.monthsByYear.set(p.y, new Set());
        state.tree.monthsByYear.get(p.y).add(p.m);
        
        const ym = `${p.y}-${p.m}`;
        if(!state.tree.daysByYM.has(ym)) state.tree.daysByYM.set(ym, new Set());
        state.tree.daysByYM.get(ym).add(p.d);
    }
    state.tree.years = Array.from(yearsSet).sort().reverse();
  }

  function renderList(container, entries, onClick, activeKey) {
    container.innerHTML = "";
    entries.sort((a,b) => b.key.localeCompare(a.key)); // Descending
    for (const e of entries) {
        const btn = el("button", { type: "button", class: (activeKey === e.key) ? "active" : "" }, [
            el("span", {}, e.label),
            el("span", { class: "count" }, String(e.count))
        ]);
        btn.addEventListener("click", () => onClick(e.key));
        container.appendChild(el("li", {}, btn));
    }
  }

  function renderTreeUI(section) {
    const yearsUl = $("#ct-years", section);
    const monthsUl = $("#ct-months", section);
    const daysUl = $("#ct-dayslist", section);
    
    // Years
    const yEntries = state.tree.years.map(y => ({
        key: y, label: y, 
        count: state.items.filter(i => i.productionDate.startsWith(y)).length
    }));
    renderList(yearsUl, yEntries, (y) => {
        state.selected.y = y; state.selected.m = null; state.selected.d = null;
        renderTreeUI(section); renderTableUI(section);
    }, state.selected.y);

    // Months
    if(state.selected.y) {
        const months = Array.from(state.tree.monthsByYear.get(state.selected.y) || []);
        const mEntries = months.map(m => ({
            key: m, label: m,
            count: state.items.filter(i => i.productionDate.startsWith(`${state.selected.y}-${m}`)).length
        }));
        renderList(monthsUl, mEntries, (m) => {
            state.selected.m = m; state.selected.d = null;
            renderTreeUI(section); renderTableUI(section);
        }, state.selected.m);
    } else { monthsUl.innerHTML = ""; }

    // Days
    if(state.selected.m) {
        const ym = `${state.selected.y}-${state.selected.m}`;
        const days = Array.from(state.tree.daysByYM.get(ym) || []);
        const dEntries = days.map(d => ({
            key: d, label: d,
            count: state.items.filter(i => i.productionDate === `${ym}-${d}`).length
        }));
        renderList(daysUl, dEntries, (d) => {
            state.selected.d = d;
            renderTreeUI(section); renderTableUI(section);
        }, state.selected.d);
    } else { daysUl.innerHTML = ""; }
  }

  function renderTableUI(section) {
    const tbody = $("#ct-tbody", section);
    const title = $("#ct-day-title", section);
    const summary = $("#ct-summary", section);
    
    // Filter by Tree Selection
    let showItems = [];
    if (state.selected.y && state.selected.m && state.selected.d) {
        const day = `${state.selected.y}-${state.selected.m}-${state.selected.d}`;
        title.textContent = `Záznamy pre: ${day}`;
        showItems = state.items.filter(x => x.productionDate === day);
    } else {
        title.textContent = "Vyberte deň v strome.";
        summary.textContent = "";
        tbody.innerHTML = "";
        tbody.appendChild(el("tr", {}, el("td", {colspan:10, class:"muted"}, "Dáta sú skryté, vyberte deň.")));
        return;
    }

    // Filter by Text
    const ft = state.filterText.toLowerCase();
    if(ft) showItems = showItems.filter(x => x.productName.toLowerCase().includes(ft));

    // Summary
    const total = showItems.length;
    const okCount = showItems.filter(x => x.haccpStatus === "OK").length;
    summary.textContent = `Položiek: ${total} | OK: ${okCount}`;

    tbody.innerHTML = "";
    if(!showItems.length) {
        tbody.appendChild(el("tr", {}, el("td", {colspan:10, class:"muted"}, "Žiadne dáta.")));
        return;
    }

    showItems.sort((a,b) => a.productName.localeCompare(b.productName, "sk"));

    for(const it of showItems) {
        // Limit Text
        const limitTxt = it.isRequired ? `${fmtFloat(it.targetLowC)}–${fmtFloat(it.targetHighC)}` : "-";
        const holdTxt = it.isRequired ? `${it.holdMinutes} min` : "-";

        const actions = el("div", {class: "mini-row"}, [
            el("button", {class: "btn btn-secondary btn-icon", title:"História"}, [
                el("i", {class:"fas fa-clock-rotate-left"})
            ])
        ]);
        actions.children[0].onclick = () => openHistoryModal(it.batchId);

        tbody.appendChild(el("tr", {}, [
            el("td", {}, it.productionDate),
            el("td", {}, it.productName),
            el("td", {}, it.batchId),
            el("td", {}, fmtQtyKg(it.plannedQtyKg)),
            el("td", {}, limitTxt), // ZOBRAZENIE LIMITU
            el("td", {}, holdTxt),  // ZOBRAZENIE ČASU
            el("td", {}, it.slotText),
            el("td", {}, it.measuredC ? fmtFloat(it.measuredC) : "-"),
            el("td", {}, pill(it)),
            el("td", {}, actions),
        ]));
    }
  }

  // -----------------------
  // Modals (History + Settings)
  // -----------------------
  async function openHistoryModal(batchId) {
    openModal("História meraní", el("div", {class:"muted"}, "Načítavam..."), null);
    try {
        const rows = await apiGet(API.history(batchId));
        const table = el("table", {}, [
            el("thead", {}, el("tr", {}, [
                el("th", {}, "Čas"), el("th", {}, "Teplota"), el("th", {}, "Poznámka")
            ])),
            el("tbody", {}, rows.map(r => el("tr", {}, [
                el("td", {}, r.measuredAt),
                el("td", {}, fmtFloat(r.measuredC)),
                el("td", {}, r.note || "")
            ])))
        ]);
        openModal(`História: ${batchId}`, el("div", {class:"table-container"}, [table]), el("button", {class:"btn btn-secondary", text:"Zavrieť", onclick: closeModal}));
    } catch(e) { toast(e.message); closeModal(); }
  }

  async function openSettingsModal(section) {
     openModal("Nastavenia", el("div", {class:"muted"}, "Načítavam..."), null);
     try {
         const rows = await apiGet(API.productDefaults);
         const tb = el("tbody", {}, []);
         
         // Search
         const search = el("input", {placeholder: "Hľadať...", style:"margin-bottom:10px;width:100%"});
         search.oninput = () => renderRows(search.value);

         function renderRows(filter) {
             tb.innerHTML = "";
             const ft = filter.toLowerCase();
             rows.filter(r => !ft || r.productName.toLowerCase().includes(ft)).forEach(r => {
                 const chk = el("input", {type:"checkbox", checked: r.isRequired});
                 const low = el("input", {type:"number", value: r.targetLowC||70, style:"width:60px"});
                 const high = el("input", {type:"number", value: r.targetHighC||72, style:"width:60px"});
                 const min = el("input", {type:"number", value: r.holdMinutes||10, style:"width:50px"});
                 const btn = el("button", {class:"btn btn-primary btn-sm", text:"Uložiť"});
                 
                 btn.onclick = async () => {
                     await apiPost(API.saveProductDefault, {
                         productName: r.productName,
                         isRequired: chk.checked,
                         targetLowC: low.value, targetHighC: high.value, holdMinutes: min.value
                     });
                     toast("Uložené");
                     await loadDataAndRender(section, {keepSelection:true});
                 };

                 tb.appendChild(el("tr", {}, [
                     el("td", {}, r.productName),
                     el("td", {}, chk),
                     el("td", {}, low),
                     el("td", {}, high),
                     el("td", {}, min),
                     el("td", {}, btn)
                 ]));
             });
         }
         renderRows("");

         const table = el("table", {}, [
             el("thead", {}, el("tr", {}, [
                 el("th", {}, "Názov"), el("th", {}, "CCP"), el("th", {}, "Min °C"), el("th", {}, "Max °C"), el("th", {}, "Min."), el("th", {}, "Akcia")
             ])),
             tb
         ]);
         
         openModal("Nastavenia výrobkov", el("div", {}, [search, el("div", {class:"table-container"}, [table])]), el("button", {class:"btn btn-secondary", text:"Zavrieť", onclick: closeModal}));

     } catch(e) { toast(e.message); closeModal(); }
  }

  async function loadDataAndRender(section, opts={}) {
     const raw = await apiGet(API.list(state.days));
     state.items = normalizeItems(raw);
     buildTreeFromItems(state.items);
     
     // Select defaults if empty
     if(!opts.keepSelection && state.tree.years.length) {
         state.selected.y = state.tree.years[0];
         // ... cascade select logic simplified
     }
     renderTreeUI(section);
     renderTableUI(section);
  }

  function init() {
    const section = document.getElementById(SECTION_ID);
    if(!section || state.loadedOnce) return;
    state.loadedOnce = true;
    
    buildSkeleton(section);
    
    $("#ct-days", section).onchange = (e) => { state.days = e.target.value; loadDataAndRender(section); };
    $("#ct-filter", section).oninput = (e) => { state.filterText = e.target.value; renderTableUI(section); };
    $("#ct-report", section).onclick = openReportModal; // TLAČ REPORTU
    $("#ct-settings", section).onclick = () => openSettingsModal(section);
    $("#ct-refresh", section).onclick = () => loadDataAndRender(section, {keepSelection:true});

    loadDataAndRender(section);
  }

  document.addEventListener("DOMContentLoaded", init);
})();