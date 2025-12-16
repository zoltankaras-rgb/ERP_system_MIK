document.addEventListener("DOMContentLoaded", () => {
  const sec = document.getElementById("section-core-temp");
  if (!sec) {
    console.warn("[core_temp] section-core-temp not found");
    return;
  }

  // DEBUG: vynútime zobrazenie aspoň obsahu (nech vidíš, či sa to spúšťa)
  sec.innerHTML = `
    <div class="analysis-card">
      <h3 style="margin:0 0 .75rem 0;">Teplota jadra – DEBUG</h3>
      <div class="muted" id="ct-debug">JS loaded – ak toto vidíš, skript sa spustil.</div>
      <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="ct-load" type="button">Načítať dáta z API</button>
      </div>
      <pre id="ct-out" style="margin-top:10px; white-space:pre-wrap; background:#f9fafb; border:1px solid #e5e7eb; padding:10px; border-radius:10px;"></pre>
    </div>
  `;

  const btn = document.getElementById("ct-load");
  const out = document.getElementById("ct-out");

  btn.addEventListener("click", async () => {
    out.textContent = "Loading...";
    try {
      const r = await fetch("/api/kancelaria/core_temp/list?days=365", { credentials: "same-origin" });
      const txt = await r.text();
      out.textContent = `HTTP ${r.status}\n\n${txt}`;
    } catch (e) {
      out.textContent = `ERROR: ${e.message}`;
    }
  });
});
