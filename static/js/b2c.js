// =================================================================
// === B2C PORTÁL – klientská logika (b2c.js) =======================
// =================================================================

const B2C_STATE = {
  minOrderValue: 20.00
  
};
// token na obnovu hesla z URL (?reset_token=...)
let PASSWORD_RESET_TOKEN = '';
// Inicializácia po načítaní DOM
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
  initializeEventListeners();
  setupCaptcha(); // anti-bot iba ak existuje registračný formulár
  maybeOpenPasswordChangeModalFromUrl(); // NOVÉ – otvorí modal, ak je v URL reset_token
});

// -----------------------------------------------------------------
// Anti-bot (captcha + honeypot + timestamp)
// -----------------------------------------------------------------
function setupCaptcha() {
  const regForm = document.getElementById('registerForm');
  if (!regForm) return;

  // timestamp (ms) – minimálny čas vyplnenia
  const tsInput = regForm.querySelector('input[name="form_ts"]');
  if (tsInput) tsInput.value = String(Date.now());

  // honeypot
  const hp = regForm.querySelector('input[name="hp_url"]');
  if (hp) hp.value = '';

  // otázka "nie som robot"
  fetch('/api/b2c/captcha/new')
    .then(r => r.json())
    .then(d => {
      const q = document.getElementById('captcha-question');
      if (q) q.textContent = d.question || 'Koľko je 3 + 4?';
    })
    .catch(() => {});
}

function refreshCaptcha() {
  setupCaptcha();
}

// -----------------------------------------------------------------
// Všeobecné helpers
// -----------------------------------------------------------------

// Pôvodná funkcia apiRequest spôsobovala cacheovanie. Toto je oprava:
async function apiRequest(endpoint, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    
    // 1. Anti-cache trik: Pridáme k URL časovú značku, aby si prehliadač myslel, že je to nová adresa
    let url = endpoint;
    if (method === 'GET') {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}_t=${Date.now()}`;
    }

    // 2. Nastavíme hlavičky na zákaz cacheovania
    const headers = { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...(options.headers || {}) 
    };

    const response = await fetch(url, {
      method: method,
      headers: headers,
      // 3. Explicitne povieme fetch API, aby neukladal cache
      cache: 'no-store', 
      body: options.body ? JSON.stringify(options.body) : null
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Server vrátil neplatnú odpoveď.' }));
      throw new Error(errorData.error || 'Neznáma chyba servera.');
    }
    return await response.json();
  } catch (error) {
    alert(`Chyba: ${error.message}`);
    throw error;
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}

function openModal(modalId)  {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.add('visible');
  el.style.display = el.style.display || 'flex';
}
function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  el.classList.remove('visible');
  el.style.display = 'none';
}

// -----------------------------------------------------------------
// Session + UI
// -----------------------------------------------------------------
async function checkSession() {
  try {
    const data = await apiRequest('/api/b2c/check_session');
    updateUI(data);
  } catch (_) {
    updateUI({ loggedIn: false });
  }
}

function updateUI(sessionData) {
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView  = document.getElementById('loggedInView');
  const authLinksContainer = document.getElementById('header-auth-links');

  if (sessionData.loggedIn && sessionData.user?.typ === 'B2C') {
    loggedOutView?.classList.add('hidden');
    loggedInView?.classList.remove('hidden');
    const name = sessionData.user.name || '';
    const points = sessionData.user.points || 0;

    const nameEl = document.getElementById('customer-name');
    if (nameEl) nameEl.textContent = name;

    if (authLinksContainer) {
      authLinksContainer.innerHTML =
        `Prihlásený: <strong>${escapeHtml(name)}</strong> | ` +
        `<a href="#" onclick="handleLogout(event)">Odhlásiť sa</a>`;
    }

    const pointsEl = document.getElementById('customer-points');
    if (pointsEl) pointsEl.textContent = points;
    document.getElementById('claim-reward-btn')?.classList
      .toggle('hidden', points <= 0);

    loadCustomerView();
  } else {
    loggedOutView?.classList.remove('hidden');
    loggedInView?.classList.add('hidden');
    if (authLinksContainer) authLinksContainer.innerHTML = '';
    loadPublicPricelist();
  }
}

async function handleLogout(event) {
  event.preventDefault();
  await apiRequest('/api/b2c/logout', { method: 'POST' });
  checkSession();
}

function initializeEventListeners() {
  // Auth formuláre
  document.getElementById('registerForm')?.addEventListener('submit', handleRegistration);
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);

  // Prepínač doručovacej adresy
  document.getElementById('same-address-checkbox')?.addEventListener('change', (e) => {
    document.getElementById('delivery-address-group')?.classList
      .toggle('hidden', e.target.checked);
  });

  // Tab v auth sekcii (login/registrácia)
  const authSection = document.getElementById('auth-section');
  if (authSection) {
    authSection.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        authSection.querySelectorAll('.tab-button')
          .forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        authSection.querySelectorAll('.tab-content')
          .forEach(content => content.classList.remove('active'));
        const target = document.getElementById(`${button.dataset.tab}-tab`);
        if (target) target.classList.add('active');
      });
    });
  }
}

function loadCustomerView() {
  const customerTabs = document.getElementById('customer-main-tabs');
  if (customerTabs && !customerTabs.dataset.listenerAttached) {
    customerTabs.querySelectorAll('.tab-button').forEach(button => {
      button.addEventListener('click', () => {
        customerTabs.querySelectorAll('.tab-button')
          .forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        document.querySelectorAll('#loggedInView .tab-content')
          .forEach(content => content.classList.remove('active'));

        const targetContent = document.getElementById(button.dataset.tab);
        if (targetContent) targetContent.classList.add('active');

        if (button.dataset.tab === 'history-content') {
          loadOrderHistory();
        }
      });
    });
    customerTabs.dataset.listenerAttached = 'true';
  }

  // default – otvor „Nová objednávka“
  const defaultTabBtn = document.querySelector('#customer-main-tabs .tab-button[data-tab="order-content"]');
  if (defaultTabBtn && !defaultTabBtn.classList.contains('active')) {
    defaultTabBtn.click();
  } else {
    loadOrderForm();
  }
}

// -----------------------------------------------------------------
// Registrácia + Login
// -----------------------------------------------------------------
async function handleRegistration(event) {
  event.preventDefault();
  const form = event.target;

  // Bezpečné nájdenie prvkov
  const termsEl   = form.querySelector('input[name="gdpr_terms"]');
  const privacyEl = form.querySelector('input[name="gdpr_privacy"]');
  const sameEl    = document.getElementById('same-address-checkbox');
  const tsEl      = form.querySelector('input[name="form_ts"]');

  // Over GDPR (2 povinné checkboxy)
  const termsOk   = !!(termsEl && termsEl.checked);
  const privacyOk = !!(privacyEl && privacyEl.checked);
  if (!termsOk || !privacyOk) {
    alert('Pre registráciu musíte potvrdiť Podmienky a Ochranu osobných údajov.');
    return;
  }

  // Doplň timestamp, ak chýba
  if (tsEl && !tsEl.value) tsEl.value = String(Date.now());

  // Zober dáta z formulára
  const fd = new FormData(form);

  // Ak je "rovnaká adresa" zaškrtnuté, doplň delivery_address
  if (sameEl && sameEl.checked) {
    fd.set('delivery_address', fd.get('address') || '');
  }

  // Kompatibilita – backend môže očakávať aj binárny flag "gdpr"
  fd.set('gdpr', '1');

  // Prevod na obyč. objekt
  const data = Object.fromEntries(fd.entries());

  try {
    const result = await apiRequest('/api/b2c/register', { method: 'POST', body: data });
    alert(result.message || 'OK');

    // Po úspechu reset + prepnúť na login + obnoviť captcha a timestamp
    if ((result.message || '').toLowerCase().includes('úspešne')) {
      form.reset();
      document.querySelector('.tab-button[data-tab="login"]')?.click();

      try {
        const d = await fetch('/api/b2c/captcha/new').then(r => r.json());
        const q = document.getElementById('captcha-question');
        if (q) q.textContent = d.question || 'Koľko je 3 + 4?';
        if (tsEl) tsEl.value = String(Date.now());
      } catch (_) {}
    }
  } catch (_) {
    // apiRequest už zobrazil chybu; skúsme len obnoviť captcha/timestamp
    try {
      const d = await fetch('/api/b2c/captcha/new').then(r => r.json());
      const q = document.getElementById('captcha-question');
      if (q) q.textContent = d.question || 'Koľko je 3 + 4?';
      if (tsEl) tsEl.value = String(Date.now());
    } catch (_) {}
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    const result = await apiRequest('/api/b2c/login', { method: 'POST', body: data });
    if (result.user) checkSession();
  } catch (_) {}
}

// -----------------------------------------------------------------
// Verejný cenník (pred loginom) – s AKCIOU a Info pri názve
// -----------------------------------------------------------------
async function loadPublicPricelist() {
  const container = document.getElementById('public-pricelist-container');
  if (!container) return;
  
  container.innerHTML = '<h2>Naša ponuka</h2><p>Načítavam produkty...</p>';
  
  try {
    const data = await apiRequest('/api/b2c/get-pricelist');
    const productsByCat = data.products || {};
    const hasProducts = productsByCat && Object.keys(productsByCat).length > 0;

    if (!hasProducts) {
      container.innerHTML = '<h2>Naša ponuka</h2><p>Momentálne nie sú dostupné žiadne produkty.</p>';
      return;
    }

    const akciaItems = productsByCat['AKCIA TÝŽĎA'] || [];
    const otherCategories = Object.keys(productsByCat)
      .filter(c => c !== 'AKCIA TÝŽĎA')
      .sort((a, b) => a.localeCompare(b));

    let html = '<h2>Naša ponuka</h2>';

    // --- AKCIA TÝŽĎA – špeciálny červený box ---
    if (akciaItems.length) {
      html += `
        <section class="akcia-tyzdna-box"
          style="border:2px solid #dc2626;border-radius:10px;padding:15px;margin-bottom:24px;background:#fef2f2;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <span style="background:#dc2626;color:#fff;font-weight:700;padding:4px 12px;border-radius:999px;font-size:0.85rem;letter-spacing:0.08em;">
              AKCIA!
            </span>
            <h3 style="margin:0;font-size:1.1rem;color:#b91c1c;">Akcia týždňa</h3>
          </div>`;

      akciaItems.forEach(p => {
        const title = escapeHtml(p.nazov_vyrobku);
        const price = `${Number(p.cena_s_dph).toFixed(2)} €`;
        const unit  = p.mj;
        const desc  = p.popis ? escapeHtml(p.popis) : '';
        const imgUrl = p.obrazok_url || '';

        html += `
          <div class="product-item akcia-item" style="padding:10px 0;border-top:1px dashed #fecaca;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <div style="font-weight:700;font-size:1.05rem;color:#b91c1c;">${title}</div>
                  <button type="button" class="info-btn" onclick="handleInfoClick(this)"
                    data-title="${title}"
                    data-description="${desc}"
                    data-price="${price}"
                    data-unit="${unit}"
                    data-image="${escapeHtml(imgUrl)}"
                    style="border:1px solid #fca5a5;background:#fee2e2;color:#b91c1c;border-radius:999px;padding:2px 10px;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-info-circle"></i> Info
                  </button>
                </div>
                ${desc ? `<div style="font-size:0.9rem;color:#7f1d1d;white-space:pre-wrap;line-height:1.4;">${desc}</div>` : ''}
              </div>
              <div style="text-align:right;min-width:110px;">
                <div style="font-weight:800;color:#b91c1c;font-size:1.15rem;">${price}</div>
                <div style="font-size:0.8rem;color:#991b1b;">za ${escapeHtml(unit)}</div>
              </div>
            </div>
          </div>`;
      });

      html += `</section>`;
    }

    // --- Ostatné kategórie (bez akcie) ---
    otherCategories.forEach(category => {
      html += `<div class="product-category"><h3>${escapeHtml(category)}</h3>`;

      (productsByCat[category] || []).forEach(p => {
        const title = escapeHtml(p.nazov_vyrobku);
        const price = `${Number(p.cena_s_dph).toFixed(2)} €`;
        const unit  = p.mj;
        const desc  = p.popis ? escapeHtml(p.popis) : '';
        const imgUrl = p.obrazok_url || '';

        html += `
          <div class="product-item" style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <div style="font-weight:600;font-size:1.05rem;color:#333;">${title}</div>
                  <button type="button" class="info-btn" onclick="handleInfoClick(this)"
                    data-title="${title}"
                    data-description="${desc}"
                    data-price="${price}"
                    data-unit="${unit}"
                    data-image="${escapeHtml(imgUrl)}"
                    style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:2px 10px;font-size:0.8rem;cursor:pointer;color:#475569;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-info-circle"></i> Info
                  </button>
                </div>
                ${desc ? `<div style="font-size:0.9rem;color:#555;white-space:pre-wrap;line-height:1.4;">${desc}</div>` : ''}
              </div>
              <div style="text-align:right;min-width:110px;">
                <div style="font-weight:700;color:#16a34a;font-size:1.1rem;">${price}</div>
                <div style="font-size:0.8rem;color:#888;">za ${escapeHtml(unit)}</div>
              </div>
            </div>
          </div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html;

  } catch (error) {
    container.innerHTML =
      `<h2>Naša ponuka</h2><p class="error">Nepodarilo sa načítať produkty: ${escapeHtml(error.message)}</p>`;
  }
}

// -----------------------------------------------------------------
// Objednávka – tvorba & odoslanie (s AKCIOU a kusovým tovarom pekne pod sebou)
// -----------------------------------------------------------------
async function loadOrderForm() {
  const container = document.getElementById('order-pricelist-container');
  if (!container) return;
  container.innerHTML = '<p>Načítavam ponuku...</p>';

  try {
    const data = await apiRequest('/api/b2c/get-pricelist');
    const productsByCat = data.products || {};
    if (!productsByCat || !Object.keys(productsByCat).length) {
      container.innerHTML = '<h2>Vytvoriť objednávku</h2><p>Momentálne nie sú dostupné žiadne produkty.</p>';
      return;
    }

    const akciaItems = productsByCat['AKCIA TÝŽĎA'] || [];
    const otherCategories = Object.keys(productsByCat)
      .filter(c => c !== 'AKCIA TÝŽĎA')
      .sort((a, b) => a.localeCompare(b));

    let html = '<h2>Vytvoriť objednávku</h2>';

    // --- AKCIA TÝŽĎA blok (oddelený, zvýraznený) ---
    if (akciaItems.length) {
      html += `
        <section class="akcia-tyzdna-box"
          style="border:2px solid #dc2626;border-radius:10px;padding:15px;margin-bottom:24px;background:#fef2f2;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <span style="background:#dc2626;color:#fff;font-weight:700;padding:4px 12px;border-radius:999px;font-size:0.85rem;letter-spacing:0.08em;">
              AKCIA!
            </span>
            <h3 style="margin:0;font-size:1.1rem;color:#b91c1c;">Akcia týždňa – špeciálne ceny</h3>
          </div>`;

      akciaItems.forEach(p => {
        const title = escapeHtml(p.nazov_vyrobku);
        const price = `${Number(p.cena_s_dph).toFixed(2)} €`;
        const unit  = p.mj;
        const desc  = p.popis ? escapeHtml(p.popis) : '';
        const imgUrl = p.obrazok_url || '';
        const itemStyle = 'border:1px solid #fecaca;background:#fff7ed;border-radius:8px;';

        const byPieceHtml = p.mj === 'kg'
          ? `<div class="by-piece-wrap" style="font-size:0.85rem;color:#444;display:flex;align-items:center;gap:6px;">
               <label style="font-weight:normal;cursor:pointer;">
                 <input type="checkbox" class="by-piece-checkbox" onchange="toggleItemNote(this, '${p.ean}')">
                 ks (objednávka na kusy)
               </label>
               <button type="button" class="by-piece-button hidden"
                       onclick="openItemNoteModal('${p.ean}')"
                       style="padding:2px 6px;font-size:0.8rem;">
                 <i class="fas fa-pen"></i> Poznámka
               </button>
             </div>`
          : '';

        html += `
          <div class="product-item akcia-item" data-ean="${p.ean}"
               style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:12px;margin-bottom:8px;${itemStyle}">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="background:#dc2626;color:#fff;font-weight:700;padding:2px 8px;border-radius:999px;font-size:0.75rem;letter-spacing:0.08em;">
                  AKCIA!
                </span>
                <div class="pi-title" style="font-weight:600;font-size:1.05rem;color:#111827;">
                  <strong>${title}</strong>
                </div>
                <button type="button" class="info-btn" onclick="handleInfoClick(this)"
                  data-title="${title}"
                  data-description="${desc}"
                  data-price="${price}"
                  data-unit="${unit}"
                  data-image="${escapeHtml(imgUrl)}"
                  style="border:1px solid #fca5a5;background:#fee2e2;color:#b91c1c;border-radius:999px;padding:2px 10px;font-size:0.8rem;cursor:pointer;display:flex;align-items:center;gap:6px;">
                  <i class="fas fa-info-circle"></i> Info
                </button>
              </div>
              ${desc ? `<div style="font-size:0.85rem;color:#7f1d1d;margin-bottom:4px;white-space:pre-wrap;">${desc}</div>` : ''}
              <div class="pi-price" style="font-size:0.9rem;color:#b91c1c;font-weight:700;">
                ${price} / ${unit}
              </div>
            </div>

            <div class="pi-qty"
                 style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:210px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <label for="qty-${p.ean}" style="white-space:nowrap;">Množstvo:</label>
                <input id="qty-${p.ean}" type="number" class="quantity-input"
                       min="0" step="${p.mj === 'ks' ? '1' : '0.1'}"
                       style="width:70px;text-align:center;font-weight:bold;border:1px solid #cbd5e1;border-radius:4px;padding:4px;"
                       data-ean="${p.ean}"
                       data-name="${title}"
                       data-price-s-dph="${p.cena_s_dph}"
                       data-price-bez-dph="${p.cena_bez_dph}"
                       data-unit="${p.mj}">
                <span style="font-size:0.85rem;color:#555;">${p.mj}</span>
              </div>
              ${byPieceHtml}
            </div>
          </div>`;
      });

      html += `</section>`;
    }

    // --- Ostatné kategórie (bez akcie) ---
    otherCategories.forEach(category => {
      html += `<div class="product-category"><h3>${escapeHtml(category)}</h3>`;

      (productsByCat[category] || []).forEach(p => {
        const title = escapeHtml(p.nazov_vyrobku);
        const price = `${Number(p.cena_s_dph).toFixed(2)} €`;
        const unit  = p.mj;
        const desc  = p.popis ? escapeHtml(p.popis) : '';
        const imgUrl = p.obrazok_url || '';
        const byPieceHtml = p.mj === 'kg'
          ? `<div class="by-piece-wrap" style="font-size:0.85rem;color:#444;display:flex;align-items:center;gap:6px;">
               <label style="font-weight:normal;cursor:pointer;">
                 <input type="checkbox" class="by-piece-checkbox" onchange="toggleItemNote(this, '${p.ean}')">
                 ks (objednávka na kusy)
               </label>
               <button type="button" class="by-piece-button hidden"
                       onclick="openItemNoteModal('${p.ean}')"
                       style="padding:2px 6px;font-size:0.8rem;">
                 <i class="fas fa-pen"></i> Poznámka
               </button>
             </div>`
          : '';

        html += `
          <div class="product-item" data-ean="${p.ean}"
               style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:12px;border-bottom:1px solid #eee;">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <div class="pi-title" style="font-weight:600;font-size:1.05rem;color:#333;">
                  <strong>${title}</strong>
                </div>
                <button type="button" class="info-btn" onclick="handleInfoClick(this)"
                  data-title="${title}"
                  data-description="${desc}"
                  data-price="${price}"
                  data-unit="${unit}"
                  data-image="${escapeHtml(imgUrl)}"
                  style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:2px 10px;font-size:0.8rem;cursor:pointer;color:#475569;display:flex;align-items:center;gap:6px;">
                  <i class="fas fa-info-circle"></i> Info
                </button>
              </div>
              ${desc ? `<div style="font-size:0.85rem;color:#666;margin-bottom:4px;white-space:pre-wrap;">${desc}</div>` : ''}
              <div class="pi-price" style="font-size:0.9rem;color:#16a34a;font-weight:600;">
                ${price} / ${unit}
              </div>
            </div>

            <div class="pi-qty"
                 style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:210px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <label for="qty-${p.ean}" style="white-space:nowrap;">Množstvo:</label>
                <input id="qty-${p.ean}" type="number" class="quantity-input"
                       min="0" step="${p.mj === 'ks' ? '1' : '0.1'}"
                       style="width:70px;text-align:center;font-weight:bold;border:1px solid #cbd5e1;border-radius:4px;padding:4px;"
                       data-ean="${p.ean}"
                       data-name="${title}"
                       data-price-s-dph="${p.cena_s_dph}"
                       data-price-bez-dph="${p.cena_bez_dph}"
                       data-unit="${p.mj}">
                <span style="font-size:0.85rem;color:#555;">${p.mj}</span>
              </div>
              ${byPieceHtml}
            </div>
          </div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html;

    // Eventy
    container.querySelectorAll('.quantity-input').forEach(input => {
      input.addEventListener('input', updateOrderTotal);
    });
    
    const deliveryDateInput = document.getElementById('deliveryDate');
    if (deliveryDateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      deliveryDateInput.min = tomorrow.toISOString().split('T')[0];
      deliveryDateInput.value = deliveryDateInput.min;
    }
// -----------------------------------------------------------------
// Obnova hesla – požiadavka na e‑mail s odkazom
// -----------------------------------------------------------------
async function submitPasswordResetRequest() {
  const input = document.getElementById('password-reset-email');
  const msgEl = document.getElementById('password-reset-message');

  if (!input) return;

  const email = (input.value || '').trim();
  if (!email) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = 'Prosím, zadajte e‑mail.';
    }
    return;
  }

  if (msgEl) {
    msgEl.style.color = '#334155';
    msgEl.textContent = 'Odosielam požiadavku...';
  }

  try {
    // Endpoint si môžeš pomenovať podľa seba, len ho zjednoť so serverom
    const data = await apiRequest('/api/b2c/request_password_reset', {
      method: 'POST',
      body: { email }
    });

    if (msgEl) {
      msgEl.style.color = '#15803d';
      msgEl.textContent =
        data.message ||
        'Ak u nás existuje účet s týmto e‑mailom, poslali sme vám odkaz na obnovu hesla.';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent =
        err.message || 'Nepodarilo sa odoslať požiadavku. Skúste to neskôr.';
    }
  }
}
// -----------------------------------------------------------------
// Po kliknutí na link v e‑maile (?reset_token=...) otvor modal
// -----------------------------------------------------------------
function maybeOpenPasswordChangeModalFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (!token) return;

    PASSWORD_RESET_TOKEN = token;

    const msgEl = document.getElementById('password-change-message');
    if (msgEl) {
      msgEl.style.color = '#334155';
      msgEl.textContent = 'Prosím, zvoľte si nové heslo a potvrďte ho.';
    }

    // použije tvoju existujúcu openModal(modalId)
    openModal('password-change-modal');
  } catch (_) {
    // nič, len ticho skončí
  }
}
// -----------------------------------------------------------------
// Uloženie nového hesla z modalu "Nastavenie nového hesla"
// -----------------------------------------------------------------
async function submitNewPassword() {
  const pwd1 = document.getElementById('new-password');
  const pwd2 = document.getElementById('new-password2');
  const msgEl = document.getElementById('password-change-message');

  if (!pwd1 || !pwd2) return;

  const p1 = (pwd1.value || '').trim();
  const p2 = (pwd2.value || '').trim();

  if (!p1 || !p2) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = 'Prosím, vyplňte obe polia s heslom.';
    }
    return;
  }

  if (p1.length < 6) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = 'Heslo musí mať aspoň 6 znakov.';
    }
    return;
  }

  if (p1 !== p2) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = 'Heslá sa nezhodujú.';
    }
    return;
  }

  if (!PASSWORD_RESET_TOKEN) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = 'Chýba token na obnovu hesla (link môže byť neplatný).';
    }
    return;
  }

  if (msgEl) {
    msgEl.style.color = '#334155';
    msgEl.textContent = 'Ukladám nové heslo...';
  }

  try {
    const data = await apiRequest('/api/b2c/reset_password', {
      method: 'POST',
      body: {
        token: PASSWORD_RESET_TOKEN,
        password: p1
      }
    });

    if (msgEl) {
      msgEl.style.color = '#15803d';
      msgEl.textContent =
        data.message || 'Heslo bolo úspešne zmenené. Môžete sa prihlásiť novým heslom.';
    }
  } catch (err) {
    if (msgEl) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent =
        err.message || 'Nepodarilo sa zmeniť heslo. Odkaz môže byť neplatný alebo expirovaný.';
    }
  }
}

    ensureOrderExtras();

    const form = document.getElementById('orderForm');
    if (form && !form.dataset.submitHandlerBound) {
      form.addEventListener('submit', handleOrderSubmit);
      form.dataset.submitHandlerBound = '1';
    }

    enforceManualSubmit();
    updateOrderTotal();

  } catch (error) {
    container.innerHTML =
      `<h2>Vytvoriť objednávku</h2><p class="error">Nepodarilo sa načítať produkty: ${escapeHtml(error.message)}</p>`;
  }
}

function updateOrderTotal() {
  let total_s_dph   = 0;
  let total_bez_dph = 0;

  // pre istotu – ak ešte neexistuje formulár, nerob nič
  const formEl = document.getElementById('orderForm');
  if (!formEl) return;

  formEl.querySelectorAll('.quantity-input').forEach(input => {
    // podporíme aj zápis s čiarkou (1,5 kg)
    const rawQty = String(input.value || '').replace(',', '.');
    const quantity      = parseFloat(rawQty) || 0;
    const price_s_dph   = parseFloat(input.dataset.priceSDph)   || 0;
    const price_bez_dph = parseFloat(input.dataset.priceBezDph) || 0;

    total_s_dph   += quantity * price_s_dph;
    total_bez_dph += quantity * price_bez_dph;
  });

  const total_dph = total_s_dph - total_bez_dph;

  const totalPriceEl      = document.getElementById('total-price');
  const minOrderWarningEl = document.getElementById('min-order-warning');
  const submitBtn         = formEl.querySelector('button[type="submit"]');

  if (totalPriceEl) {
    totalPriceEl.innerHTML = `
      <div style="font-size:.9em; text-align:right; line-height:1.5;">
        Celkom bez DPH: ${total_bez_dph.toFixed(2).replace('.', ',')} €<br>
        DPH: ${total_dph.toFixed(2).replace('.', ',')} €<br>
        <strong style="font-size:1.2em;">Celkom s DPH (predbežne): ${total_s_dph.toFixed(2).replace('.', ',')} €</strong>
      </div>`;
  }

  if (minOrderWarningEl && submitBtn) {
    if (total_s_dph > 0 && total_s_dph < B2C_STATE.minOrderValue) {
      // je objednané, ale pod limitom
      minOrderWarningEl.classList.remove('hidden');
      submitBtn.disabled = true;
      submitBtn.style.backgroundColor = '#ccc';
    } else {
      minOrderWarningEl.classList.add('hidden');
      submitBtn.disabled = (total_s_dph <= 0); // nič neobjednané = nepustiť
      submitBtn.style.backgroundColor = '';
    }
  }

  // 🔴 DÔLEŽITÉ: súhrn zobraz stále – žiadne schovávanie
  const summarySection = document.getElementById('order-summary-section');
  if (summarySection) {
    summarySection.classList.remove('hidden');
  }
}

async function handleOrderSubmit(event) {
  event.preventDefault();

  const items = Array.from(document.querySelectorAll('#orderForm .quantity-input')).map(input => {
    const quantity = parseFloat(input.value);
    if (quantity > 0) {
      const byPieceCheckbox = input.closest('.product-item')?.querySelector('.by-piece-checkbox');
      return {
        ean: input.dataset.ean,
        name: input.dataset.name,
        quantity: quantity,
        unit: (byPieceCheckbox && byPieceCheckbox.checked) ? 'ks' : input.dataset.unit,
        item_note: input.dataset.itemNote || ''
      };
    }
    return null;
  }).filter(Boolean);

  if (!items.length) {
    alert("Vaša objednávka je prázdna.");
    return;
  }

  // min. hodnota
  const totalValue = items.reduce((sum, item) => {
    const input = document.querySelector(`.quantity-input[data-ean="${item.ean}"]`);
    return sum + (item.quantity * (parseFloat(input.dataset.priceSDph) || 0));
  }, 0);

  if (totalValue < B2C_STATE.minOrderValue) {
    alert(`Minimálna hodnota objednávky je ${B2C_STATE.minOrderValue.toFixed(2)} €.`);
    return;
  }

  const orderData = {
    items: items,
    deliveryDate: document.getElementById('deliveryDate')?.value,
    note: document.getElementById('orderNote')?.value,
    // DOPLNENÉ: dodacie okno + kód odmeny (hmotný darček)
    delivery_window: document.getElementById('deliveryWindow')?.value || '',
    reward_code: document.getElementById('rewardCode')?.value?.trim() || ''
  };

  try {
    const result = await apiRequest('/api/b2c/submit-order', { method: 'POST', body: orderData });
    alert(result.message);

    if ((result.message || '').includes("úspešne")) {
      document.getElementById('orderForm')?.reset();
      updateOrderTotal();
      checkSession(); // obnov body a stav
      document.querySelector('.tab-button[data-tab="history-content"]')?.click();
    }
  } catch (_) {}
}

// -----------------------------------------------------------------
// História objednávok – robustné zobrazenie položiek
// -----------------------------------------------------------------
async function loadOrderHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;
  container.innerHTML = '<p>Načítavam históriu objednávok...</p>';
  try {
    const data = await apiRequest('/api/b2c/get-history');
    if (data.orders && data.orders.length > 0) {
      let html = '';
      data.orders.forEach(order => {
        const orderDate    = order.datum_objednavky ? new Date(order.datum_objednavky).toLocaleDateString('sk-SK') : '';
        const deliveryDate = order.pozadovany_datum_dodania ? new Date(order.pozadovany_datum_dodania).toLocaleDateString('sk-SK') : '';

        // preferuj už parsované 'items', inak parsuj 'polozky'
        let items = Array.isArray(order.items) ? order.items : [];
        if (!items.length && typeof order.polozky === 'string') {
          try { items = JSON.parse(order.polozky || '[]'); } catch { items = []; }
        }

        let itemsHtml = '<ul>' + items.map(item => {
          const nm  = item.name || item.nazov || item.nazov_vyrobku || '—';
          const qty = item.quantity ?? item.mnozstvo ?? '';
          const un  = item.unit || item.mj || '';
          const nt  = item.item_note || item.poznamka_k_polozke || '';
          return `<li>${escapeHtml(nm)} - ${escapeHtml(String(qty))} ${escapeHtml(un)} ${nt ? `<i>(${escapeHtml(nt)})</i>` : ''}</li>`;
        }).join('') + '</ul>';

        const finalPrice = (order.finalna_suma_s_dph != null)
          ? `${parseFloat(order.finalna_suma_s_dph).toFixed(2)} €`
          : `(čaká na preváženie)`;
        const stav = order.stav || '';

        html += `
          <div class="history-item">
            <div class="history-header">
              Obj. č. ${escapeHtml(order.cislo_objednavky || String(order.id))} ${orderDate ? `(${orderDate})` : ''} ${stav ? `- Stav: ${escapeHtml(stav)}` : ''}
            </div>
            <div class="history-body">
              ${deliveryDate ? `<p><strong>Požadované vyzdvihnutie:</strong> ${deliveryDate}</p>` : ''}
              <p><strong>Položky:</strong></p>
              ${itemsHtml}
              <p><strong>Finálna suma:</strong> ${finalPrice}</p>
            </div>
          </div>`;
      });
      container.innerHTML = html;
    } else {
      container.innerHTML = '<p>Zatiaľ nemáte žiadne objednávky.</p>';
    }
  } catch (error) {
    container.innerHTML = `<p class="error">Nepodarilo sa načítať históriu objednávok.</p>`;
  }
}

// -----------------------------------------------------------------
// Vernostné odmeny (modál)
// -----------------------------------------------------------------
async function showRewardsModal() {
  const listContainer = document.getElementById('rewards-list-container');
  document.getElementById('modal-customer-points').textContent =
    document.getElementById('customer-points').textContent;
  listContainer.innerHTML = '<p>Načítavam dostupné odmeny...</p>';
  openModal('rewards-modal');
  try {
    const data = await apiRequest('/api/b2c/get_rewards');
    const currentPoints = parseInt(
      document.getElementById('modal-customer-points').textContent || '0',
      10
    );
    if (data.rewards && data.rewards.length > 0) {
      let html = '';
      let hasAvailableReward = false;
      data.rewards.forEach(reward => {
        const canAfford = currentPoints >= reward.potrebne_body;
        if (canAfford) hasAvailableReward = true;
        html += `<div class="history-item" style="padding:10px; opacity:${canAfford ? '1' : '0.5'};">
          <strong>${escapeHtml(reward.nazov_odmeny)}</strong> (${reward.potrebne_body} bodov)
          <button class="button button-small" style="float:right;" ${!canAfford ? 'disabled' : ''} onclick="claimReward(${reward.id}, ${reward.potrebne_body})">Vybrať</button>
        </div>`;
      });
      listContainer.innerHTML = hasAvailableReward
        ? html
        : '<p>Nemáte dostatok bodov na uplatnenie žiadnej z dostupných odmien.</p>';
    } else {
      listContainer.innerHTML = '<p>Momentálne nie sú k dispozícii žiadne odmeny.</p>';
    }
  } catch (e) {
    listContainer.innerHTML = `<p class="error">Nepodarilo sa načítať odmeny: ${escapeHtml(e.message)}</p>`;
  }
}

async function claimReward(rewardId, pointsNeeded) {
  if (!confirm(`Naozaj si chcete uplatniť túto odmenu za ${pointsNeeded} bodov? Bude pridaná k Vašej nasledujúcej objednávke.`)) return;
  try {
    const result = await apiRequest('/api/b2c/claim_reward', { method: 'POST', body: { reward_id: rewardId } });
    alert(result.message);
    if (result.new_points !== undefined) {
      document.getElementById('customer-points').textContent = result.new_points;
      document.getElementById('modal-customer-points').textContent = result.new_points;
      document.getElementById('claim-reward-btn')?.classList
        .toggle('hidden', result.new_points <= 0);
    }
    closeModal('rewards-modal');
  } catch (_) {}
}

// -----------------------------------------------------------------
// Poznámky k položkám „na kusy“
// -----------------------------------------------------------------
function toggleItemNote(checkbox, ean) {
  const itemDiv = checkbox.closest('.product-item');
  if (!itemDiv) return;

  const noteButton = itemDiv.querySelector('.by-piece-button');
  const quantityInput = itemDiv.querySelector('.quantity-input');

  if (noteButton) noteButton.classList.toggle('hidden', !checkbox.checked);
  if (quantityInput) {
    if (checkbox.checked) {
      quantityInput.step = "1";
      if (quantityInput.value) {
        quantityInput.value = String(Math.round(parseFloat(quantityInput.value)));
      }
      openItemNoteModal(ean);
    } else {
      quantityInput.step = "0.1";
      quantityInput.dataset.itemNote = "";
    }
  }
  updateOrderTotal();
}

function openItemNoteModal(ean) {
  const input = document.querySelector(`.quantity-input[data-ean="${ean}"]`);
  if (!input) return;
  const modal = document.getElementById('item-note-modal');
  if (!modal) return;

  const titleEl = modal.querySelector('#item-note-modal-title');
  const noteTextarea = modal.querySelector('#item-note-input');
  const saveBtn = modal.querySelector('#save-item-note-btn');

  if (titleEl) titleEl.textContent = `Poznámka k: ${input.dataset.name}`;
  if (noteTextarea) noteTextarea.value = input.dataset.itemNote || '';
  if (saveBtn) {
    saveBtn.onclick = () => {
      input.dataset.itemNote = noteTextarea.value;
      closeModal('item-note-modal');
    };
  }
  openModal('item-note-modal');
}

// -----------------------------------------------------------------
// Plávajúci náhľad obrázka pre .product-title[data-img]
// -----------------------------------------------------------------
function attachImageHoverPreviews(root = document) {
  let preview = document.getElementById('b2c-img-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'b2c-img-preview';
    preview.style.position = 'fixed';
    preview.style.display = 'none';
    preview.style.zIndex = '10000';
    preview.style.background = '#fff';
    preview.style.border = '1px solid #e5e7eb';
    preview.style.padding = '4px';
    preview.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
    preview.innerHTML = '<img alt="náhľad" style="max-width:320px;max-height:240px;display:block;">';
    document.body.appendChild(preview);
  }
  const imgEl = preview.querySelector('img');

  root.querySelectorAll('.product-title[data-img]').forEach(el => {
    const url = el.getAttribute('data-img');
    if (!url) return;

    const show = (e) => {
      imgEl.src = url;
      position(e);
      preview.style.display = 'block';
    };
    const hide = () => { preview.style.display = 'none'; };

    const position = (e) => {
      const offset = 16;
      let x = (e.clientX || 0) + offset;
      let y = (e.clientY || 0) + offset;
      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = preview.getBoundingClientRect();
      if (x + rect.width > vw)  x = vw - rect.width - offset;
      if (y + rect.height > vh) y = vh - rect.height - offset;
      preview.style.left = x + 'px';
      preview.style.top  = y + 'px';
    };

    el.addEventListener('mouseenter', show);
    el.addEventListener('mousemove', (e) => {
      if (preview.style.display === 'block') position(e);
    });
    el.addEventListener('mouseleave', hide);
    el.addEventListener('click', show); // klik tiež zobrazí
  });
}

// === DOPLNOK: starší Info modal (ak by bol niekde použitý) ===
function ensureProductInfoModal(){
  if (document.getElementById('product-info-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'product-info-modal';
  wrap.className = 'modal-overlay';
  wrap.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h4 id="pi-title"></h4>
        <button class="modal-close" onclick="closeModal('product-info-modal')">&times;</button>
      </div>
      <div id="pi-body"></div>
    </div>`;
  document.body.appendChild(wrap);
}

function openProductInfo(name, img, desc){
  ensureProductInfoModal();
  const m = document.getElementById('product-info-modal');
  const titleEl = m.querySelector('#pi-title');
  const bodyEl  = m.querySelector('#pi-body');

  if (titleEl) titleEl.textContent = name || 'Info o produkte';
  const safeDesc = escapeHtml(desc || '');
  const imgHtml = img
    ? `<img src="${img}" alt="${escapeHtml(name||'')}" style="max-width:100%;max-height:280px;display:block;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px">`
    : '';
  if (bodyEl) {
    bodyEl.innerHTML =
      `${imgHtml}<div style="white-space:pre-wrap;color:#334155">${safeDesc || '<span class="muted">Bez popisu.</span>'}</div>`;
  }
  openModal('product-info-modal');
}

/** ======= INFO MODAL (detail produktu) a striktné pravidlá odosielania ======= **/

// 1) Garant: objednávka sa pošle len fyzickým klikom na tlačidlo "Odoslať"
function enforceManualSubmit() {
  const form = document.getElementById('orderForm');
  if (!form) return;

  // nech sa guard nastaví len raz
  if (form.dataset.manualSubmitGuard === '1') return;
  form.dataset.manualSubmitGuard = '1';

  // Blokuj Enter (okrem textarea)
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') e.preventDefault();
  });

  // Dovoľ odoslanie iba po pointer kliku na submit
  let submitViaPointer = false;
  form.addEventListener('pointerdown', (e) => {
    const btn = e.target && e.target.closest('button[type="submit"], input[type="submit"]');
    if (btn) submitViaPointer = true;
  }, true);

  form.addEventListener('submit', (e) => {
    if (!submitViaPointer) e.preventDefault();
    submitViaPointer = false;
  });

  // Všetky tlačidlá v cenníku nesmú byť submit
  form.querySelectorAll('#order-pricelist-container button').forEach((b) => {
    if (!b.getAttribute('type')) b.setAttribute('type', 'button');
    if (b.type.toLowerCase() === 'submit') b.type = 'button';
  });
}

// 2) Detailný INFO modal (používaný cez handleInfoClick)
function ensureProductInfoModalV2() {
  if (document.getElementById('product-info-modal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'product-info-modal';
  wrap.className = 'modal-overlay';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h4>Informácie o produkte</h4>
        <button class="modal-close" aria-label="Zavrieť"
                onclick="document.getElementById('product-info-modal').classList.remove('visible');document.getElementById('product-info-modal').style.display='none';">
          &times;
        </button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <div id="pim-img-container" style="margin-bottom:15px; text-align:center;"></div>
        <div id="pim-title" style="font-weight:700;font-size:1.05rem;margin-bottom:4px;"></div>
        <div id="pim-meta" style="font-weight:bold; color:#16a34a; margin-bottom:10px; border-bottom:1px solid #eee; padding-bottom:10px;"></div>
        <div id="pim-desc" style="white-space:pre-wrap; color:#333; line-height:1.6;"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
}

// Použi dataset z tlačidla (bez hoverov, bez náhľadov)
function handleInfoClick(btn) {
  ensureProductInfoModalV2();

  const data = {
    title: btn.dataset.title || '',
    price: btn.dataset.price || '',
    unit:  btn.dataset.unit  || '',
    desc:  btn.dataset.description || '',
    img:   btn.dataset.image || ''
  };

  const m = document.getElementById('product-info-modal');
  if (!m) return;

  const titleEl = m.querySelector('#pim-title');
  const metaEl  = m.querySelector('#pim-meta');
  const descEl  = m.querySelector('#pim-desc');
  const imgCont = m.querySelector('#pim-img-container');

  if (titleEl) titleEl.textContent = data.title;
  if (metaEl)  metaEl.textContent  = `${data.price} / ${data.unit}`;
  if (descEl)  descEl.textContent  = data.desc || 'Bez popisu.';

  if (imgCont) {
    if (data.img) {
      imgCont.innerHTML = `<img src="${data.img}" alt="${escapeHtml(data.title)}"
           style="max-width:100%; max-height:300px; border-radius:8px; box-shadow:0 4px 6px rgba(0,0,0,0.1);">`;
      imgCont.style.display = 'block';
    } else {
      imgCont.innerHTML = '';
      imgCont.style.display = 'none';
    }
  }

  m.classList.add('visible');
  m.style.display = 'flex';
}

// -----------------------------------------------------------------
// DOPLNOK – bez zásahu do šablóny: dodacie okno + kód odmeny
// -----------------------------------------------------------------
function ensureOrderExtras() {
  const host = document.getElementById('order-summary-section') ||
               document.getElementById('orderForm') ||
               document.body;
  if (!host) return;

  // 1) Časové okno
  if (!document.getElementById('deliveryWindow')) {
    const g = document.createElement('div');
    g.className = 'form-group';
    g.innerHTML = `
      <label for="deliveryWindow">Časové okno doručenia (nepovinné):</label>
      <select id="deliveryWindow" name="deliveryWindow">
        <option value="">-- vyberte časové okno (nepovinné) --</option>
      </select>`;
    const target = document.querySelector('.total-summary') || host.lastChild;
    host.insertBefore(g, target);
    // načítaj sloty
    loadDeliveryWindows();
  }

  // 2) Kód odmeny (hmotný darček)
  if (!document.getElementById('rewardCode')) {
    const g = document.createElement('div');
    g.className = 'form-group';
    g.innerHTML = `
      <label for="rewardCode">Kód odmeny (nepovinné):</label>
      <input type="text" id="rewardCode" name="rewardCode" placeholder="NAPR: DARCEK-KLOBASA">`;
    const target = document.querySelector('.total-summary') || host.lastChild;
    host.insertBefore(g, target);
  }
}

async function loadDeliveryWindows() {
  const sel = document.getElementById('deliveryWindow');
  if (!sel) return;

  // presne dve pracovné okná, Po–Pia, najneskôr do 15:00
  sel.innerHTML = [
    '<option value="">-- vyberte časové okno (nepovinné) --</option>',
    '<option value="workdays_08_12">Po–Pia 08:00–12:00</option>',
    '<option value="workdays_12_15">Po–Pia 12:00–15:00</option>'
  ].join('');
}
// =====================================================
// OBNOVA HESLA (globálne funkcie pre onclick v HTML)
// =====================================================
(function () {
  // token z URL (?reset_token=...)
  let PASSWORD_RESET_TOKEN = '';

  // Požiadavka na odoslanie e‑mailu s odkazom na obnovu hesla
  window.submitPasswordResetRequest = async function () {
    const input = document.getElementById('password-reset-email');
    const msgEl = document.getElementById('password-reset-message');

    if (!input) return;

    const email = (input.value || '').trim();
    if (!email) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Prosím, zadajte e‑mail.';
      }
      return;
    }

    if (msgEl) {
      msgEl.style.color = '#334155';
      msgEl.textContent = 'Odosielam požiadavku...';
    }

    try {
      const data = await apiRequest('/api/b2c/request_password_reset', {
        method: 'POST',
        body: { email }
      });
      if (msgEl) {
        msgEl.style.color = '#15803d';
        msgEl.textContent =
          data.message ||
          'Ak u nás existuje účet s týmto e‑mailom, poslali sme vám odkaz na obnovu hesla.';
      }
    } catch (err) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent =
          err.message || 'Nepodarilo sa odoslať požiadavku. Skúste to neskôr.';
      }
    }
  };

  // Skontroluje URL a prípadne otvorí modal na nové heslo
  window.maybeOpenPasswordChangeModalFromUrl = function () {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('reset_token');
      if (!token) return;

      PASSWORD_RESET_TOKEN = token;

      const msgEl = document.getElementById('password-change-message');
      if (msgEl) {
        msgEl.style.color = '#334155';
        msgEl.textContent = 'Prosím, zvoľte si nové heslo a potvrďte ho.';
      }

      openModal('password-change-modal');
    } catch (_) {
      // nič
    }
  };

  // Uloženie nového hesla po kliknutí na tlačidlo v modale
  window.submitNewPassword = async function () {
    const pwd1 = document.getElementById('new-password');
    const pwd2 = document.getElementById('new-password2');
    const msgEl = document.getElementById('password-change-message');

    if (!pwd1 || !pwd2) return;

    const p1 = (pwd1.value || '').trim();
    const p2 = (pwd2.value || '').trim();

    if (!p1 || !p2) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Prosím, vyplňte obe polia s heslom.';
      }
      return;
    }

    if (p1.length < 6) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Heslo musí mať aspoň 6 znakov.';
      }
      return;
    }

    if (p1 !== p2) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Heslá sa nezhodujú.';
      }
      return;
    }

    if (!PASSWORD_RESET_TOKEN) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent = 'Chýba token na obnovu hesla (link môže byť neplatný).';
      }
      return;
    }

    if (msgEl) {
      msgEl.style.color = '#334155';
      msgEl.textContent = 'Ukladám nové heslo...';
    }

    try {
      const data = await apiRequest('/api/b2c/reset_password', {
        method: 'POST',
        body: {
          token: PASSWORD_RESET_TOKEN,
          password: p1
        }
      });

      if (msgEl) {
        msgEl.style.color = '#15803d';
        msgEl.textContent =
          data.message || 'Heslo bolo úspešne zmenené. Môžete sa prihlásiť novým heslom.';
      }
    } catch (err) {
      if (msgEl) {
        msgEl.style.color = '#b91c1c';
        msgEl.textContent =
          err.message || 'Nepodarilo sa zmeniť heslo. Odkaz môže byť neplatný alebo expirovaný.';
      }
    }
  };

  // Po načítaní stránky automaticky skontrolujeme, či nie je v URL reset_token
  document.addEventListener('DOMContentLoaded', function () {
    window.maybeOpenPasswordChangeModalFromUrl();
  });
})();
