/* ============================================================
   Kancelária – HACCP: Teplota jadra (Core Temp)
   kompatibilné s backendom:
     GET  /api/kancelaria/core_temp/list?days=...
     GET  /api/kancelaria/core_temp/product_defaults
     POST /api/kancelaria/core_temp/product_defaults/save
     POST /api/kancelaria/core_temp/measurement/save
     GET  /api/kancelaria/core_temp/measurement/history?batchId=...

   Backend posiela (list):
     batchId, productionDate, status, productName,
     plannedQtyKg, realQtyKg, realQtyKs,
     isRequired, targetLowC, targetHighC, holdMinutes,
     limitText (napr. 70.0–71.9),
     measuredC, measuredAt, measuredBy, note,
     slotText (napr. 08:25–08:35), slotStart, slotEnd,
     haccpStatus ("OK","MISSING","FAIL","NA") + voliteľne haccpDetail ("LOW"/"HIGH")
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
    // haccpStatus: OK/MISSING/FAIL/NA, haccpDetail: LOW/HIGH
    const st = safeStr(it.haccpStatus || "NA");
    const det = safeStr(it.haccpDetail || "");
    if (st === "OK") return { text: "OK", cls: "status-ok" };
    if (st === "MISSING") return { text: "CHÝBA", cls: "status-missing" };
    if (st === "FAIL" && det === "HIGH") return { text: "VYSOKÁ", cls: "status-low" };
    if (st === "FAIL" && det === "LOW") return { text: "NÍZKA", cls: "status-low" };
    if (st === "FAIL") return { text: "MIMO", cls: "status-low" };
    return { text: "NEVYŽADUJE", cls: "" };
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

    tree: {
      years: [],
      monthsByYear: new Map(),
      daysByYM: new Map(),
    },

    selected: { y: null, m: null, d: null }
  };

  function buildSkeleton(section) {
    section.innerHTML = "";

    const header = el("div", { class: "card" }, [
      el("div", { class: "card-header" }, [
        el("div", { html: "<h3 style='margin:0;border:none;padding:0'>Teplota jadra</h3><div class='muted'>CCP výrobky majú pásmo 70.0–71.9 °C a automaticky pridelený čas merania v pracovnom okne 07:00–17:00.</div>" }),
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
                  el("ul", { class: "tree-list", id: "ct-dayslist" }, [])
                ]),
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
                    el("th", {}, "Reál (kg)"),
                    el("th", {}, "Reál (ks)"),
                    el("th", {}, "Limit °C"),
                    el("th", {}, "Čas"),
                    el("th", {}, "Meranie °C"),
                    el("th", {}, "Stav"),
                    el("th", {}, "Akcie"),
                  ])),
                  el("tbody", { id: "ct-tbody" }, [
                    el("tr", {}, el("td", { colspan: "11", class: "muted" }, "Načítavam…"))
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
      .filter(x => x && x.batchId && x.productionDate)
      .map(x => ({
        batchId: safeStr(x.batchId).trim(),
        productionDate: safeStr(x.productionDate).trim(),
        status: safeStr(x.status),
        productName: safeStr(x.productName).trim(),
        plannedQtyKg: safeNum(x.plannedQtyKg) ?? 0,
        realQtyKg: safeNum(x.realQtyKg) ?? 0,
        realQtyKs: safeNum(x.realQtyKs) ?? 0,
        isRequired: !!x.isRequired,
        targetLowC: safeNum(x.targetLowC),
        targetHighC: safeNum(x.targetHighC),
        holdMinutes: safeNum(x.holdMinutes) ?? 10,
        limitText: safeStr(x.limitText),
        measuredC: safeNum(x.measuredC),
        measuredAt: safeStr(x.measuredAt),
        measuredBy: safeStr(x.measuredBy),
        note: safeStr(x.note),
        slotText: safeStr(x.slotText),
        haccpStatus: safeStr(x.haccpStatus || "NA"),
        haccpDetail: safeStr(x.haccpDetail || ""),
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

    state.tree.years = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));

    const mm = new Map();
    for (const [y, set] of monthsByYear.entries()) {
      mm.set(y, Array.from(set).sort((a, b) => b.localeCompare(a)));
    }
    state.tree.monthsByYear = mm;

    const dd = new Map();
    for (const [ym, set] of daysByYM.entries()) {
      dd.set(ym, Array.from(set).sort((a, b) => b.localeCompare(a)));
    }
    state.tree.daysByYM = dd;
  }

  function applyFilters(items) {
    let out = items;

    const ft = state.filterText.trim().toLowerCase();
    if (ft) out = out.filter(x => x.productName.toLowerCase().includes(ft));

    if (state.onlyRequired) out = out.filter(x => x.isRequired);

    if (state.onlyMissing) out = out.filter(x => x.isRequired && x.haccpStatus === "MISSING");

    return out;
  }

  function itemsForSelectedDay(items) {
    if (!state.selected.y || !state.selected.m || !state.selected.d) return [];
    const day = `${state.selected.y}-${state.selected.m}-${state.selected.d}`;
    return items.filter(x => x.productionDate === day);
  }

  function countForYear(y) {
    return state.items.filter(it => (ymdParts(it.productionDate)?.y === y)).length;
  }
  function countForMonth(y, m) {
    return state.items.filter(it => {
      const p = ymdParts(it.productionDate);
      return p && p.y === y && p.m === m;
    }).length;
  }
  function countForDay(y, m, d) {
    const day = `${y}-${m}-${d}`;
    return state.items.filter(it => it.productionDate === day).length;
  }

  function renderList(container, entries, onClick, activeKey) {
    container.innerHTML = "";
    for (const e of entries) {
      const btn = el("button", { type: "button", class: (activeKey === e.key) ? "active" : "" }, [
        el("span", {}, e.label),
        el("span", { class: "count" }, String(e.count ?? ""))
      ]);
      btn.addEventListener("click", () => onClick(e.key));
      container.appendChild(el("li", {}, btn));
    }
  }

  function renderTreeUI(section) {
    const yearsUl = $("#ct-years", section);
    const monthsUl = $("#ct-months", section);
    const daysUl = $("#ct-dayslist", section);

    // years
    const yEntries = state.tree.years.map(y => ({ key: y, label: y, count: countForYear(y) }));
    renderList(yearsUl, yEntries, (y) => {
      state.selected.y = y;
      state.selected.m = null;
      state.selected.d = null;
      renderTreeUI(section);
      renderTableUI(section);
    }, state.selected.y);

    // months
    if (!state.selected.y) {
      monthsUl.innerHTML = "";
      monthsUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Vyber rok.")));
      daysUl.innerHTML = "";
      daysUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Vyber mesiac.")));
      return;
    }

    const months = state.tree.monthsByYear.get(state.selected.y) || [];
    const mEntries = months.map(m => ({ key: m, label: m, count: countForMonth(state.selected.y, m) }));
    renderList(monthsUl, mEntries, (m) => {
      state.selected.m = m;
      state.selected.d = null;
      renderTreeUI(section);
      renderTableUI(section);
    }, state.selected.m);

    // days
    if (!state.selected.m) {
      daysUl.innerHTML = "";
      daysUl.appendChild(el("li", {}, el("div", { class: "muted", style: "padding:10px 12px" }, "Vyber mesiac.")));
      return;
    }

    const ym = `${state.selected.y}-${state.selected.m}`;
    const days = state.tree.daysByYM.get(ym) || [];
    const dEntries = days.map(d => ({ key: d, label: d, count: countForDay(state.selected.y, state.selected.m, d) }));
    renderList(daysUl, dEntries, (d) => {
      state.selected.d = d;
      renderTreeUI(section);
      renderTableUI(section);
    }, state.selected.d);
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
      tbody.appendChild(el("tr", {}, el("td", { colspan: "11", class: "muted" }, "Najprv vyber Rok → Mesiac → Deň.")));
      return;
    }

    const dayKey = `${state.selected.y}-${state.selected.m}-${state.selected.d}`;
    title.textContent = `Záznamy pre: ${dayKey}`;

    const total = dayItems.length;
    const missing = dayItems.filter(x => x.haccpStatus === "MISSING").length;
    const fail = dayItems.filter(x => x.haccpStatus === "FAIL").length;
    const ok = dayItems.filter(x => x.haccpStatus === "OK").length;
    summary.textContent = `Spolu: ${total} | OK: ${ok} | Chýba: ${missing} | Mimo pásma: ${fail}`;

    tbody.innerHTML = "";
    if (!dayItems.length) {
      tbody.appendChild(el("tr", {}, el("td", { colspan: "11", class: "muted" }, "Pre tento deň nie sú záznamy (alebo ich skryli filtre).")));
      return;
    }

    dayItems.sort((a, b) => a.productName.localeCompare(b.productName, "sk"));

    for (const it of dayItems) {
      const limitText = it.isRequired ? (it.limitText || `${fmtFloat(it.targetLowC,1)}–${fmtFloat(it.targetHighC,1)}`) : "-";
      const slotText = it.isRequired ? (it.slotText || "-") : "-";
      const measText = (it.measuredC === null) ? "-" : fmtFloat(it.measuredC, 1);

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

      tbody.appendChild(el("tr", {}, [
        el("td", {}, it.productionDate),
        el("td", {}, it.productName || "-"),
        el("td", {}, it.batchId || "-"),
        el("td", {}, fmtQtyKg(it.plannedQtyKg)),
        el("td", {}, fmtQtyKg(it.realQtyKg)),
        el("td", {}, it.realQtyKs ? String(it.realQtyKs) : "-"),
        el("td", {}, limitText),
        el("td", {}, slotText),
        el("td", {}, measText),
        el("td", {}, pill(it)),
        el("td", {}, actions),
      ]));
    }
  }

  // -----------------------
  // Modals
  // -----------------------

  function openMeasureModal(item, section) {
    const low = safeNum(item.targetLowC);
    const high = safeNum(item.targetHighC);

    const body = el("div", {}, [
      el("div", { class: "analysis-card" }, [
        el("div", { class: "muted" }, `Výrobok: ${item.productName}`),
        el("div", { class: "muted" }, `Šarža: ${item.batchId}`),
        el("div", { class: "muted" }, `Dátum: ${item.productionDate}`),
        el("div", { class: "muted" }, `Čas merania: ${item.slotText || "—"} (držanie ${item.holdMinutes || 10} min)`),
        el("div", { class: "muted", style: "margin-top:8px" }, item.isRequired ? `CCP: ÁNO (pásmo ${fmtFloat(low,1)}–${fmtFloat(high,1)} °C)` : "CCP: NIE (meranie sa nevyžaduje)"),
      ]),
      el("div", { style: "height:12px" }),
      el("div", { class: "form-grid" }, [
        el("div", { class: "form-group" }, [
          el("label", { for: "ct-measured" }, "Nameraná teplota (°C)"),
          el("input", { id: "ct-measured", type: "number", step: "0.1", placeholder: "napr. 70.8" })
        ]),
        el("div", { class: "form-group" }, [
          el("label", { for: "ct-note" }, "Poznámka / nápravné opatrenie"),
          el("textarea", { id: "ct-note", rows: "3", placeholder: "povinné ak je mimo pásma" })
        ])
      ])
    ]);

    const footer = el("div", { style: "display:flex;justify-content:flex-end;gap:10px;margin-top:12px" }, [
      el("button", { class: "btn btn-secondary", type: "button" }, "Zrušiť"),
      el("button", { class: "btn btn-primary", type: "button" }, "Uložiť meranie")
    ]);

    footer.children[0].addEventListener("click", closeModal);

    footer.children[1].addEventListener("click", async () => {
      const measuredC = safeNum($("#ct-measured")?.value);
      if (measuredC === null) { toast("Zadaj nameranú teplotu."); return; }

      const note = safeStr($("#ct-note")?.value).trim();

      if (item.isRequired && low != null && high != null) {
        const ok = (measuredC >= low && measuredC <= high);
        if (!ok && !note) {
          toast("Pri meraní mimo pásma je povinná poznámka / nápravné opatrenie.");
          return;
        }
      }

      footer.children[1].disabled = true;
      try {
        await apiPost(API.saveMeasurement, {
          batchId: item.batchId,
          measuredC: measuredC,
          note: note
        });
        closeModal();
        await loadDataAndRender(section, { keepSelection: true });
        toast("Meranie uložené.");
      } catch (e) {
        toast(`Chyba pri ukladaní: ${e.message}`);
      } finally {
        footer.children[1].disabled = false;
      }
    });

    openModal("Záznam merania teploty jadra", body, footer);
  }

  async function openHistoryModal(batchId) {
    openModal("História meraní", el("div", { class: "muted" }, `Načítavam históriu pre šaržu: ${batchId}…`), null);

    try {
      const rows = await apiGet(API.history(batchId));

      const table = el("table", {}, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Čas merania"),
          el("th", {}, "Teplota (°C)"),
          el("th", {}, "Pásmo (°C)"),
          el("th", {}, "Trvanie"),
          el("th", {}, "Kto"),
          el("th", {}, "Poznámka"),
        ])),
        el("tbody", {}, [])
      ]);

      const tb = table.querySelector("tbody");
      if (!Array.isArray(rows) || rows.length === 0) {
        tb.appendChild(el("tr", {}, el("td", { colspan: "6", class: "muted" }, "Bez histórie meraní.")));
      } else {
        for (const r of rows) {
          const tl = safeNum(r.targetLowC);
          const th = safeNum(r.targetHighC);
          const band = (tl != null && th != null) ? `${fmtFloat(tl,1)}–${fmtFloat(th,1)}` : "-";
          const hm = r.holdMinutes ? `${r.holdMinutes} min` : "-";

          tb.appendChild(el("tr", {}, [
            el("td", {}, safeStr(r.measuredAt || "")),
            el("td", {}, (r.measuredC != null ? fmtFloat(r.measuredC, 1) : "-")),
            el("td", {}, band),
            el("td", {}, hm),
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

      const footer = el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]);
      footer.querySelector("button").addEventListener("click", closeModal);

      openModal("História meraní", wrap, footer);
    } catch (e) {
      const footer = el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]);
      footer.querySelector("button").addEventListener("click", closeModal);

      openModal("História meraní", el("div", { class: "muted" }, `Chyba: ${e.message}`), footer);
    }
  }

  async function openSettingsModal(section) {
    openModal("Nastavenia výrobkov – Teplota jadra", el("div", { class: "muted" }, "Načítavam výrobky…"), null);

    try {
      const rows = await apiGet(API.productDefaults);

      const search = el("input", { type: "text", placeholder: "Hľadať výrobok…", id: "ct-prod-search" });

      const table = el("table", {}, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Výrobok"),
          el("th", {}, "Varený (CCP)"),
          el("th", {}, "Pásmo od (°C)"),
          el("th", {}, "Pásmo do (°C)"),
          el("th", {}, "Trvanie (min)"),
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
          tb.appendChild(el("tr", {}, el("td", { colspan: "6", class: "muted" }, "Žiadne položky.")));
          return;
        }

        for (const r of filtered) {
          const name = safeStr(r.productName);
          const isReq = !!r.isRequired;

          const chk = el("input", { type: "checkbox" });
          chk.checked = isReq;

          const inpLow = el("input", { type: "number", step: "0.1", style: "max-width:120px" });
          const inpHigh = el("input", { type: "number", step: "0.1", style: "max-width:120px" });
          const inpHold = el("input", { type: "number", step: "1", min: "1", style: "max-width:120px" });

          inpLow.value = (r.targetLowC != null ? String(r.targetLowC) : "70.0");
          inpHigh.value = (r.targetHighC != null ? String(r.targetHighC) : "71.9");
          inpHold.value = (r.holdMinutes != null ? String(r.holdMinutes) : "10");

          const setEnabled = (on) => {
            inpLow.disabled = !on;
            inpHigh.disabled = !on;
            inpHold.disabled = !on;
          };
          setEnabled(chk.checked);

          chk.addEventListener("change", () => {
            setEnabled(chk.checked);
            if (chk.checked) {
              if (!inpLow.value) inpLow.value = "70.0";
              if (!inpHigh.value) inpHigh.value = "71.9";
              if (!inpHold.value) inpHold.value = "10";
            }
          });

          const btnSave = el("button", { class: "btn btn-primary", type: "button" }, "Uložiť");
          btnSave.addEventListener("click", async () => {
            btnSave.disabled = true;
            try {
              const payload = {
                productName: name,
                isRequired: chk.checked,
                targetLowC: chk.checked ? safeNum(inpLow.value) : null,
                targetHighC: chk.checked ? safeNum(inpHigh.value) : null,
                holdMinutes: chk.checked ? Number(inpHold.value || 10) : null
              };
              await apiPost(API.saveProductDefault, payload);
              toast("Uložené.");
              // refresh data to reflect new CCP
              await loadDataAndRender(section, { keepSelection: true });
            } catch (e) {
              toast(`Chyba: ${e.message}`);
            } finally {
              btnSave.disabled = false;
            }
          });

          tb.appendChild(el("tr", {}, [
            el("td", {}, name),
            el("td", {}, chk),
            el("td", {}, inpLow),
            el("td", {}, inpHigh),
            el("td", {}, inpHold),
            el("td", {}, btnSave),
          ]));
        }
      }

      renderProducts("");
      search.addEventListener("input", () => renderProducts(search.value));

      const wrap = el("div", {}, [
        el("div", { class: "analysis-card" }, [
          el("div", { class: "muted" }, "Označ varené výrobky ako CCP. Predvolené pásmo je 70.0–71.9 °C, trvanie 10 min (časové sloty sú automaticky generované 07:00–17:00)."),
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
      const footer = el("div", { style: "display:flex;justify-content:flex-end;margin-top:12px" }, [
        el("button", { class: "btn btn-secondary", type: "button" }, "Zavrieť")
      ]);
      footer.querySelector("button").addEventListener("click", closeModal);
      openModal("Nastavenia výrobkov – Teplota jadra", el("div", { class: "muted" }, `Chyba: ${e.message}`), footer);
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
      tbody.appendChild(el("tr", {}, el("td", { colspan: "11", class: "muted" }, "Načítavam…")));
    }

    const raw = await apiGet(API.list(state.days));
    state.items = normalizeItems(raw);
    buildTreeFromItems(state.items);

    if (!keepSelection || !state.selected.y) {
      state.selected.y = state.tree.years.length ? state.tree.years[0] : null;
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
      renderTableUI(section);
    });

    chkReq.addEventListener("change", () => {
      state.onlyRequired = !!chkReq.checked;
      renderTableUI(section);
    });

    chkMissing.addEventListener("change", () => {
      state.onlyMissing = !!chkMissing.checked;
      renderTableUI(section);
    });

    btnRefresh.addEventListener("click", async () => {
      await loadDataAndRender(section, { keepSelection: true });
    });

    btnSettings.addEventListener("click", () => openSettingsModal(section));
  }

  function initOnce() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    if (state.loadedOnce) return;
    state.loadedOnce = true;

    buildSkeleton(section);
    bindControls(section);

    loadDataAndRender(section, { keepSelection: false }).catch(e => {
      const tbody = $("#ct-tbody", section);
      if (tbody) {
        tbody.innerHTML = "";
        tbody.appendChild(el("tr", {}, el("td", { colspan: "11", class: "muted" }, `Chyba pri načítaní: ${e.message}`)));
      } else {
        toast(`Chyba pri načítaní: ${e.message}`);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", initOnce);
})();
