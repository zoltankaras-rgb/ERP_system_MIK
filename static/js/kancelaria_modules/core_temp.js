/* ============================================================
   Kancelária – HACCP: Teplota jadra (Core Temp)
   ------------------------------------------------------------
   Backend:
     GET  /api/kancelaria/core_temp/list?days=365
     GET  /api/kancelaria/core_temp/product_defaults
     POST /api/kancelaria/core_temp/product_defaults/save
     POST /api/kancelaria/core_temp/measurement/save
     GET  /api/kancelaria/core_temp/measurement/history?batchId=...

   Očakávaný formát list_items:
     [
       {
         batchId, productionDate (YYYY-MM-DD),
         status, productName,
         plannedQtyKg, realQtyKg, realQtyKs,
         mj, pieceWeightG,
         isRequired, limitC,
         measuredC, measuredAt, measuredBy, note,
         haccpStatus: "OK"|"MISSING"|"FAIL"|"NA"
       }, ...
     ]
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
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
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

  function safeNum(x) {
    if (x === null || x === undefined || x === "") return null;
    const v = Number(String(x).replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }

  function safeStr(x) {
    return (x === null || x === undefined) ? "" : String(x);
  }

  function fmtDateYMD(ymd) {
    // ymd: "YYYY-MM-DD"
    return safeStr(ymd);
  }

  function ymdParts(ymd) {
    const s = safeStr(ymd);
    const p = s.split("-");
    if (p.length !== 3) return null;
    return { y: p[0], m: p[1], d: p[2] };
  }

  function fmtFloat(v, digits = 2) {
    const n = safeNum(v);
    if (n === null) return "-";
    return n.toFixed(digits);
  }

  function fmtQtyKg(v) {
    const n = safeNum(v);
    if (n === null) return "-";
    // kg bežne stačí 3 desatinné pre výrobu
    return n.toFixed(3);
  }

  function pill(status) {
    // status: OK/MISSING/FAIL/NA
    let cls = "";
    let label = status;
    if (status === "OK") { cls = "status-ok"; label = "OK"; }
    else if (status === "MISSING") { cls = "status-missing"; label = "CHÝBA"; }
    else if (status === "FAIL") { cls = "status-low"; label = "NÍZKA"; }
    else { cls = ""; label = "NEVYŽADUJE"; }

    return el("span", { class: `status-pill ${cls}` }, label);
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

  function toast(msg) {
    // jednoduché, bezpečné – nech to nerozbije UI
    alert(msg);
  }

  // -----------------------
  // Modal (použije existujúci #modal-container)
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
    if (!m) { toast("Modal container chýba v HTML."); return; }

    m.title.textContent = titleText || "—";
    m.body.innerHTML = "";
    if (bodyNode) m.body.appendChild(bodyNode);
    if (footerNode) m.body.appendChild(footerNode);

    m.wrap.classList.add("visible");

    const onClose = () => closeModal();
    if (m.closeBtn) {
      m.closeBtn.onclick = onClose;
    }
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
  // UI / State
  // -----------------------
  const state = {
    loadedOnce: false,
    items: [],
    days: 365,
    filterText: "",
    onlyRequired: false,
    onlyMissing: false,

    tree: {
      years: [],                 // ["2025","2024",...]
      monthsByYear: new Map(),   // year -> ["12","11"...]
      daysByYM: new Map(),       // "YYYY-MM" -> ["16","15"...]
    },

    selected: { y: null, m: null, d: null }
  };

  function buildSkeleton(section) {
    section.innerHTML = "";

    // Header card
    const header = el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("div", { html: "<h3 style='margin:0;border:none;padding:0'>Teplota jadra</h3><div class='muted'>Rok → Mesiac → Deň. Dáta sa berú z výroby (zaznamy_vyroba) + merania HACCP.</div>" }),
        el("div", { class: "coretemp-toolbar" }, [
          el("label", { class: "muted", for: "ct-days", style: "margin-right:6px" }, "Rozsah:"),
          el("select", { id: "ct-days" }, [
            el("option", { value: "30" }, "30 dní"),
            el("option", { value: "90" }, "90 dní"),
            el("option", { value: "180" }, "180 dní"),
            el("option", { value: "365", selected: "selected" }, "365 dní"),
            el("option", { value: "730" }, "730 dní"),
            el("option", { value: "3650" }, "10 rokov"),
          ]),
          el("input", { id: "ct-filter", type: "text", placeholder: "Filter názvu výrobku…", style: "max-width:420px" }),
          el("label", { class: "muted", style: "display:inline-flex;align-items:center;gap:8px" }, [
            el("input", { id: "ct-only-required", type: "checkbox" }),
            "Len varené (CCP)"
          ]),
          el("label", { class: "muted", style: "display:inline-flex;align-items:center;gap:8px" }, [
            el("input", { id: "ct-only-missing", type: "checkbox" }),
            "Len bez merania"
          ]),
          el("span", { class: "spacer" }),
          el("button", { class: "btn btn-secondary", id: "ct-settings", type: "button" }, [
            el("i", { class: "fas fa-sliders-h" }),
            "Nastavenia výrobkov"
          ]),
          el("button", { class: "btn btn-secondary", id: "ct-refresh", type: "button" }, [
            el("i", { class: "fas fa-rotate" }),
            "Obnoviť"
          ])
        ])
      ]),
      el("div", { class: "card-body" }, [
        el("div", { class: "coretemp-grid" }, [
          // Left: tree
          el("div", { class: "coretemp-aside" }, [
            el("div", { class: "analysis-card" }, [
              el("div", { class: "tree" }, [
                el("div", { class: "tree-col" }, [
                  el("h4", {}, "Rok"),
                  el("ul", { class: "tree-list", id: "ct-years" }, [])
                ]),
                el("div", { class: "tree-col" }, [
                  el("h4", {}, "Mesiac"),
                  el("ul", { class: "tree-list", id: "ct-months" }, [])
                ]),
                el("div", { class: "tree-col" }, [
                  el("h4", {}, "Deň"),
                  el("ul", { class: "tree-list", id: "ct-days" }, [])
                ]),
              ])
            ])
          ]),
          // Right: table
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
                    el("th", {}, "Reál (kg)"),
                    el("th", {}, "Reál (ks)"),
                    el("th", {}, "Limit °C"),
                    el("th", {}, "Meranie °C"),
                    el("th", {}, "Stav"),
                    el("th", {}, "Akcie"),
                  ])),
                  el("tbody", { id: "ct-tbody" }, [
                    el("tr", {}, el("td", { colspan: "10", class: "muted" }, "Načítavam…"))
                  ])
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
    return raw
      .filter(x => x && x.batchId && x.productionDate) // musíme mať dátum pre strom
      .map(x => ({
        batchId: safeStr(x.batchId).trim(),
        productionDate: safeStr(x.productionDate).trim(),
        status: safeStr(x.status),
        productName: safeStr(x.productName).trim(),
        plannedQtyKg: safeNum(x.plannedQtyKg) ?? 0,
        realQtyKg: safeNum(x.realQtyKg) ?? 0,
        realQtyKs: safeNum(x.realQtyKs) ?? 0,
        mj: safeStr(x.mj || "kg"),
        pieceWeightG: safeNum(x.pieceWeightG) ?? 0,
        isRequired: !!x.isRequired,
        limitC: safeNum(x.limitC),
        measuredC: safeNum(x.measuredC),
        measuredAt: safeStr(x.measuredAt),
        measuredBy: safeStr(x.measuredBy),
        note: safeStr(x.note),
        haccpStatus: safeStr(x.haccpStatus || "NA"),
      }));
  }

  function buildTreeFromItems(items) {
    const yearsSet = new Set();
    const monthsByYear = new Map();
    const daysByYM = new Map();

    for (const it of items) {
      const p = ymdParts(it.productionDate);
      if (!p) continue;
      yearsSet.add(p.y);

      if (!monthsByYear.has(p.y)) monthsByYear.set(p.y, new Set());
      monthsByYear.get(p.y).add(p.m);

      const ym = `${p.y}-${p.m}`;
      if (!daysByYM.has(ym)) daysByYM.set(ym, new Set());
      daysByYM.get(ym).add(p.d);
    }

    const years = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
    const monthsMap = new Map();
    for (const [y, set] of monthsByYear.entries()) {
      monthsMap.set(y, Array.from(set).sort((a, b) => b.localeCompare(a)));
    }
    const daysMap = new Map();
    for (const [ym, set] of daysByYM.entries()) {
      daysMap.set(ym, Array.from(set).sort((a, b) => b.localeCompare(a)));
    }

    state.tree.years = years;
    state.tree.monthsByYear = monthsMap;
    state.tree.daysByYM = daysMap;
  }

  function countForYear(y) {
    let c = 0;
    for (const it of state.items) {
      const p = ymdParts(it.productionDate);
      if (p && p.y === y) c++;
    }
    return c;
  }

  function countForMonth(y, m) {
    let c = 0;
    for (const it of state.items) {
      const p = ymdParts(it.productionDate);
      if (p && p.y === y && p.m === m) c++;
    }
    return c;
  }

  function countForDay(y, m, d) {
    let c = 0;
    for (const it of state.items) {
      const p = ymdParts(it.productionDate);
      if (p && p.y === y && p.m === m && p.d === d) c++;
    }
    return c;
  }

  function renderTreeUI(section) {
    const yearsUl = $("#ct-years", section);
    const monthsUl = $("#ct-months", section);
    const daysUl = $("#ct-days", section);

    yearsUl.innerHTML = "";
    monthsUl.innerHTML = "";
    daysUl.innerHTML = "";

    if (!state.tree.years.length) {
      yearsUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Žiadne dáta.")));
      return;
    }

    // Years
    for (const y of state.tree.years) {
      const btn = el("button", {
        type: "button",
        class: (state.selected.y === y) ? "active" : ""
      }, [
        el("span", {}, y),
        el("span", { class: "count" }, String(countForYear(y)))
      ]);
      btn.addEventListener("click", () => {
        state.selected.y = y;
        state.selected.m = null;
        state.selected.d = null;
        renderTreeUI(section);
        renderTableUI(section);
      });
      yearsUl.appendChild(el("li", {}, btn));
    }

    // Months (only when year selected)
    if (state.selected.y) {
      const months = state.tree.monthsByYear.get(state.selected.y) || [];
      if (!months.length) {
        monthsUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "—")));
      } else {
        for (const m of months) {
          const btn = el("button", {
            type: "button",
            class: (state.selected.m === m) ? "active" : ""
          }, [
            el("span", {}, m),
            el("span", { class: "count" }, String(countForMonth(state.selected.y, m)))
          ]);
          btn.addEventListener("click", () => {
            state.selected.m = m;
            state.selected.d = null;
            renderTreeUI(section);
            renderTableUI(section);
          });
          monthsUl.appendChild(el("li", {}, btn));
        }
      }
    } else {
      monthsUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Vyber rok.")));
    }

    // Days (only when year+month selected)
    if (state.selected.y && state.selected.m) {
      const ym = `${state.selected.y}-${state.selected.m}`;
      const days = state.tree.daysByYM.get(ym) || [];
      if (!days.length) {
        daysUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "—")));
      } else {
        for (const d of days) {
          const btn = el("button", {
            type: "button",
            class: (state.selected.d === d) ? "active" : ""
          }, [
            el("span", {}, d),
            el("span", { class: "count" }, String(countForDay(state.selected.y, state.selected.m, d)))
          ]);
          btn.addEventListener("click", () => {
            state.selected.d = d;
            renderTreeUI(section);
            renderTableUI(section);
          });
          daysUl.appendChild(el("li", {}, btn));
        }
      }
    } else {
      daysUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Vyber mesiac.")));
    }
  }

  function applyFilters(items) {
    let out = items;

    const ft = state.filterText.trim().toLowerCase();
    if (ft) {
      out = out.filter(x => x.productName.toLowerCase().includes(ft));
    }
    if (state.onlyRequired) {
      out = out.filter(x => x.isRequired);
    }
    if (state.onlyMissing) {
      out = out.filter(x => x.isRequired && (x.haccpStatus === "MISSING"));
    }
    return out;
  }

  function itemsForSelectedDay(items) {
    if (!state.selected.y || !state.selected.m || !state.selected.d) return [];
    const day = `${state.selected.y}-${state.selected.m}-${state.selected.d}`;
    return items.filter(x => x.productionDate === day);
  }

  function renderTableUI(section) {
    const tbody = $("#ct-tbody", section);
    const title = $("#ct-day-title", section);
    const summary = $("#ct-summary", section);

    const filtered = applyFilters(state.items);
    const dayItems = itemsForSelectedDay(filtered);

    if (!state.selected.y || !state.selected.m || !state.selected.d) {
      title.textContent = "Vyber deň vľavo.";
      summary.textContent = "";
      tbody.innerHTML = "";
      tbody.appendChild(el("tr", {}, el("td", { colspan: "10", class: "muted" }, "Najprv vyber Rok → Mesiac → Deň.")));
      return;
    }

    const dayKey = `${state.selected.y}-${state.selected.m}-${state.selected.d}`;
    title.textContent = `Záznamy pre: ${dayKey}`;

    // Summary
    const total = dayItems.length;
    const missing = dayItems.filter(x => x.haccpStatus === "MISSING").length;
    const fail = dayItems.filter(x => x.haccpStatus === "FAIL").length;
    const ok = dayItems.filter(x => x.haccpStatus === "OK").length;
    summary.textContent = `Spolu: ${total} | OK: ${ok} | Chýba: ${missing} | Nízka: ${fail}`;

    tbody.innerHTML = "";
    if (!dayItems.length) {
      tbody.appendChild(el("tr", {}, el("td", { colspan: "10", class: "muted" }, "Pre tento deň nie sú záznamy (alebo ich skryli filtre).")));
      return;
    }

    // Sort: product ASC
    dayItems.sort((a, b) => a.productName.localeCompare(b.productName, "sk"));

    for (const it of dayItems) {
      const limit = (it.limitC === null || it.limitC === undefined) ? "-" : fmtFloat(it.limitC, 1);
      const meas = (it.measuredC === null || it.measuredC === undefined) ? "-" : fmtFloat(it.measuredC, 1);

      const actions = el("div", { class: "mini-row" }, []);

      const btnMeasure = el("button", { class: "btn btn-secondary btn-icon", type: "button", title: "Zadať meranie" }, [
        el("i", { class: "fas fa-thermometer-half" })
      ]);
      btnMeasure.addEventListener("click", () => openMeasureModal(it, section));

      const btnHist = el("button", { class: "btn btn-secondary btn-icon", type: "button", title: "História meraní" }, [
        el("i", { class: "fas fa-clock-rotate-left" })
      ]);
      btnHist.addEventListener("click", () => openHistoryModal(it.batchId));

      actions.appendChild(btnMeasure);
      actions.appendChild(btnHist);

      const tr = el("tr", {}, [
        el("td", {}, fmtDateYMD(it.productionDate)),
        el("td", {}, it.productName || "-"),
        el("td", {}, it.batchId || "-"),
        el("td", {}, fmtQtyKg(it.plannedQtyKg)),
        el("td", {}, fmtQtyKg(it.realQtyKg)),
        el("td", {}, (it.realQtyKs ? String(it.realQtyKs) : "-")),
        el("td", {}, limit),
        el("td", {}, meas),
        el("td", {}, pill(it.haccpStatus)),
        el("td", {}, actions),
      ]);

      tbody.appendChild(tr);
    }
  }

  // -----------------------
  // Measurement modal
  // -----------------------
  function openMeasureModal(item, section) {
    const limit = (item.limitC === null || item.limitC === undefined) ? null : Number(item.limitC);

    const body = el("div", {}, [
      el("div", { class: "analysis-card" }, [
        el("div", { class: "muted" }, `Výrobok: ${item.productName}`),
        el("div", { class: "muted" }, `Šarža: ${item.batchId}`),
        el("div", { class: "muted" }, `Dátum: ${item.productionDate}`),
        el("div", { class: "muted" }, `Plán: ${fmtQtyKg(item.plannedQtyKg)} kg | Reál: ${fmtQtyKg(item.realQtyKg)} kg | Reál: ${item.realQtyKs || 0} ks`),
        el("div", { class: "muted", style: "margin-top:8px" }, item.isRequired ? `CCP: ÁNO (limit ${limit !== null ? fmtFloat(limit, 1) : "—"} °C)` : "CCP: NIE (meranie sa nevyžaduje)"),
      ]),
      el("div", { style: "height:12px" }),
      el("div", { class: "form-grid" }, [
        el("div", { class: "form-group" }, [
          el("label", { for: "ct-measured" }, "Nameraná teplota (°C)"),
          el("input", { id: "ct-measured", type: "number", step: "0.1", placeholder: "napr. 74.5" })
        ]),
        el("div", { class: "form-group" }, [
          el("label", { for: "ct-note" }, "Poznámka / nápravné opatrenie"),
          el("textarea", { id: "ct-note", rows: "3", placeholder: "povinné pri nízkej teplote" })
        ])
      ])
    ]);

    const footer = el("div", { style: "display:flex;justify-content:flex-end;gap:10px;margin-top:12px" }, [
      el("button", { class: "btn btn-secondary", type: "button" }, "Zrušiť"),
      el("button", { class: "btn btn-primary", type: "button" }, "Uložiť meranie")
    ]);

    const btnCancel = footer.children[0];
    const btnSave = footer.children[1];

    btnCancel.addEventListener("click", closeModal);

    btnSave.addEventListener("click", async () => {
      const measuredC = safeNum($("#ct-measured")?.value);
      if (measuredC === null) { toast("Zadaj nameranú teplotu."); return; }

      const note = safeStr($("#ct-note")?.value).trim();

      if (item.isRequired && limit !== null && measuredC < limit && !note) {
        toast("Pri nízkej teplote je povinná poznámka / nápravné opatrenie.");
        return;
      }

      btnSave.disabled = true;
      try {
        await apiPost(API.saveMeasurement, {
          batchId: item.batchId,
          measuredC: measuredC,
          limitC: item.limitC,   // snapshot limitu (ak je)
          note: note
        });

        closeModal();
        await loadDataAndRender(section, { keepSelection: true });
        toast("Meranie uložené.");
      } catch (e) {
        toast(`Chyba pri ukladaní: ${e.message}`);
      } finally {
        btnSave.disabled = false;
      }
    });

    openModal("Záznam merania teploty jadra", body, footer);
  }

  async function openHistoryModal(batchId) {
    const body = el("div", {}, [
      el("div", { class: "muted" }, `Načítavam históriu pre šaržu: ${batchId}…`)
    ]);
    openModal("História meraní", body, null);

    try {
      const rows = await apiGet(API.history(batchId));
      const table = el("table", {}, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Čas merania"),
          el("th", {}, "Teplota (°C)"),
          el("th", {}, "Limit (°C)"),
          el("th", {}, "Kto"),
          el("th", {}, "Poznámka"),
        ])),
        el("tbody", {}, [])
      ]);

      const tb = table.querySelector("tbody");
      if (!Array.isArray(rows) || rows.length === 0) {
        tb.appendChild(el("tr", {}, el("td", { colspan: "5", class: "muted" }, "Bez histórie meraní.")));
      } else {
        for (const r of rows) {
          tb.appendChild(el("tr", {}, [
            el("td", {}, safeStr(r.measuredAt || "")),
            el("td", {}, (r.measuredC != null ? fmtFloat(r.measuredC, 1) : "-")),
            el("td", {}, (r.limitC != null ? fmtFloat(r.limitC, 1) : "-")),
            el("td", {}, safeStr(r.measuredBy || "")),
            el("td", {}, safeStr(r.note || "")),
          ]));
        }
      }

      const wrap = el("div", {}, [
        el("div", { class: "analysis-card" }, [
          el("div", { class: "muted" }, `Šarža: ${batchId}`),
          el("div", { class: "table-container", style: "margin-top:10px" }, [table])
        ])
      ]);

      openModal("História meraní", wrap, el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]));

      const btnClose = $(".modal-body button.btn.btn-secondary");
      if (btnClose) btnClose.addEventListener("click", closeModal);

    } catch (e) {
      openModal("História meraní", el("div", { class: "muted" }, `Chyba: ${e.message}`), el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]));
      const btnClose = $(".modal-body button.btn.btn-secondary");
      if (btnClose) btnClose.addEventListener("click", closeModal);
    }
  }

  // -----------------------
  // Product defaults modal (CCP / limit)
  // -----------------------
  async function openSettingsModal() {
    const body = el("div", {}, [
      el("div", { class: "muted" }, "Načítavam výrobky…")
    ]);
    openModal("Nastavenia výrobkov – Teplota jadra", body, null);

    try {
      const rows = await apiGet(API.productDefaults);

      const search = el("input", { type: "text", placeholder: "Hľadať výrobok…", id: "ct-prod-search" });
      const table = el("table", {}, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Výrobok"),
          el("th", {}, "Typ"),
          el("th", {}, "Varený (CCP)"),
          el("th", {}, "Limit °C"),
          el("th", {}, "Akcia"),
        ])),
        el("tbody", { id: "ct-prod-tbody" }, [])
      ]);

      function renderProducts(filterText) {
        const tb = $("#ct-prod-tbody", table);
        tb.innerHTML = "";

        const ft = (filterText || "").trim().toLowerCase();
        const filtered = (Array.isArray(rows) ? rows : []).filter(r => {
          const n = safeStr(r.productName).toLowerCase();
          return !ft || n.includes(ft);
        });

        if (!filtered.length) {
          tb.appendChild(el("tr", {}, el("td", { colspan: "5", class: "muted" }, "Žiadne položky.")));
          return;
        }

        for (const r of filtered) {
          const name = safeStr(r.productName);
          const type = safeStr(r.itemType);
          const isReq = !!r.isRequired;
          const limitC = (r.limitC == null) ? "" : String(r.limitC);

          const chk = el("input", { type: "checkbox" });
          chk.checked = isReq;

          const inp = el("input", { type: "number", step: "0.1", placeholder: "napr. 72.0", style: "max-width:140px" });
          inp.value = limitC;
          inp.disabled = !chk.checked;

          chk.addEventListener("change", () => {
            inp.disabled = !chk.checked;
            if (chk.checked && !inp.value) inp.value = "72.0";
            if (!chk.checked) inp.value = "";
          });

          const btnSave = el("button", { class: "btn btn-primary", type: "button" }, "Uložiť");
          btnSave.addEventListener("click", async () => {
            btnSave.disabled = true;
            try {
              const payload = {
                productName: name,
                isRequired: chk.checked,
                limitC: chk.checked ? safeNum(inp.value) : null
              };
              await apiPost(API.saveProductDefault, payload);
              toast("Uložené.");
            } catch (e) {
              toast(`Chyba: ${e.message}`);
            } finally {
              btnSave.disabled = false;
            }
          });

          tb.appendChild(el("tr", {}, [
            el("td", {}, name),
            el("td", {}, type),
            el("td", {}, chk),
            el("td", {}, inp),
            el("td", {}, btnSave),
          ]));
        }
      }

      renderProducts("");

      search.addEventListener("input", () => renderProducts(search.value));

      const wrap = el("div", {}, [
        el("div", { class: "analysis-card" }, [
          el("div", { class: "muted" }, "Označ varené výrobky ako CCP a nastav minimálnu teplotu jadra. Ak necháš limit prázdny, použije sa 72 °C."),
          el("div", { style: "margin-top:10px" }, search),
          el("div", { class: "table-container", style: "margin-top:10px" }, [table]),
        ])
      ]);

      const footer = el("div", { style: "display:flex;justify-content:flex-end;gap:10px;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]);
      footer.querySelector("button").addEventListener("click", closeModal);

      openModal("Nastavenia výrobkov – Teplota jadra", wrap, footer);
    } catch (e) {
      openModal("Nastavenia výrobkov – Teplota jadra", el("div", { class: "muted" }, `Chyba: ${e.message}`), el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]));
      const btnClose = $(".modal-body button.btn.btn-secondary");
      if (btnClose) btnClose.addEventListener("click", closeModal);
    }
  }

  // -----------------------
  // Load & Render
  // -----------------------
  async function loadDataAndRender(section, opts = {}) {
    const keepSelection = !!opts.keepSelection;

    const tbody = $("#ct-tbody", section);
    if (tbody) {
      tbody.innerHTML = "";
      tbody.appendChild(el("tr", {}, el("td", { colspan: "10", class: "muted" }, "Načítavam…")));
    }

    const raw = await apiGet(API.list(state.days));
    state.items = normalizeItems(raw);

    // build tree on full set (bez filtrov), ale záznamy bez productionDate sa už vyhodili
    buildTreeFromItems(state.items);

    // default selection (ak nemáme)
    if (!keepSelection || !state.selected.y) {
      const years = state.tree.years;
      state.selected.y = years.length ? years[0] : null;
      state.selected.m = null;
      state.selected.d = null;

      if (state.selected.y) {
        const months = state.tree.monthsByYear.get(state.selected.y) || [];
        state.selected.m = months.length ? months[0] : null;

        if (state.selected.m) {
          const ym = `${state.selected.y}-${state.selected.m}`;
          const days = state.tree.daysByYM.get(ym) || [];
          state.selected.d = days.length ? days[0] : null;
        }
      }
    }

    renderTreeUI(section);
    renderTableUI(section);
  }

  function bindControls(section) {
    const selDays = $("#ct-days", section);
    const inpFilter = $("#ct-filter", section);
    const chkReq = $("#ct-only-required", section);
    const chkMissing = $("#ct-only-missing", section);
    const btnRefresh = $("#ct-refresh", section);
    const btnSettings = $("#ct-settings", section);

    selDays.addEventListener("change", async () => {
      state.days = Number(selDays.value || 365);
      await loadDataAndRender(section, { keepSelection: false });
    });

    inpFilter.addEventListener("input", () => {
      state.filterText = inpFilter.value || "";
      // tree zostáva z full datasetu, tabuľka sa filtruje
      renderTableUI(section);
    });

    chkReq.addEventListener("change", () => {
      state.onlyRequired = !!chkReq.checked;
      // strom necháme stabilný, mení sa len tabuľka
      renderTableUI(section);
    });

    chkMissing.addEventListener("change", () => {
      state.onlyMissing = !!chkMissing.checked;
      renderTableUI(section);
    });

    btnRefresh.addEventListener("click", async () => {
      await loadDataAndRender(section, { keepSelection: true });
    });

    btnSettings.addEventListener("click", openSettingsModal);
  }

  function initOnce() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;

    if (state.loadedOnce) return;
    state.loadedOnce = true;

    buildSkeleton(section);
    bindControls(section);

    // initial load
    loadDataAndRender(section, { keepSelection: false }).catch(e => {
      const tbody = $("#ct-tbody", section);
      if (tbody) {
        tbody.innerHTML = "";
        tbody.appendChild(el("tr", {}, el("td", { colspan: "10", class: "muted" }, `Chyba pri načítaní: ${e.message}`)));
      } else {
        toast(`Chyba pri načítaní: ${e.message}`);
      }
    });
  }

  // Init on DOM ready (sekcia je v HTML stále prítomná, len sa prepína .active)
  document.addEventListener("DOMContentLoaded", initOnce);

})();
