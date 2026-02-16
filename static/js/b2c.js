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
// === OPRAVA PRE TLAČIDLO VIAC ===
function handleReadMoreClick(el) {
    // Načítame dáta bezpečne z atribútov elementu
    const title = el.getAttribute('data-title');
    const img = el.getAttribute('data-img');
    const desc = el.getAttribute('data-desc');
    
    // Zavoláme pôvodnú funkciu na otvorenie modalu
    openProductInfo(title, img, desc);
}
async function apiRequest(endpoint, options = {}) {
  try {
    const method = (options.method || 'GET').toUpperCase();
    
    // 1. Anti-cache trik
    let url = endpoint;
    if (method === 'GET') {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}_t=${Date.now()}`;
    }

    // 2. Hlavičky
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
    // === POUŽÍVATEĽ JE PRIHLÁSENÝ ===
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
    // === POUŽÍVATEĽ JE ODHLÁSENÝ (Pridávame Scroll tlačidlo) ===
    loggedOutView?.classList.remove('hidden');
    loggedInView?.classList.add('hidden');
    
    // TU JE ZMENA: Namiesto vyčistenia pridáme navigačné tlačidlo
    if (authLinksContainer) {
        authLinksContainer.innerHTML = `
            <button class="button" style="width: auto; margin: 0; padding: 8px 20px; background-color: #334155;" 
                onclick="document.getElementById('auth-section').scrollIntoView({behavior: 'smooth'})">
                <i class="fas fa-sign-in-alt"></i> Prejsť na prihlásenie
            </button>
        `;
    }
    
    loadPublicPricelist();
  }
}

async function handleLogout(event) {
  event.preventDefault();
  await apiRequest('/api/b2c/logout', { method: 'POST' });
  checkSession();
}

function initializeEventListeners() {
  document.getElementById('registerForm')?.addEventListener('submit', handleRegistration);
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);

  document.getElementById('same-address-checkbox')?.addEventListener('change', (e) => {
    document.getElementById('delivery-address-group')?.classList
      .toggle('hidden', e.target.checked);
  });

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

  const termsEl   = form.querySelector('input[name="gdpr_terms"]');
  const privacyEl = form.querySelector('input[name="gdpr_privacy"]');
  const sameEl    = document.getElementById('same-address-checkbox');
  const tsEl      = form.querySelector('input[name="form_ts"]');

  const termsOk   = !!(termsEl && termsEl.checked);
  const privacyOk = !!(privacyEl && privacyEl.checked);
  if (!termsOk || !privacyOk) {
    alert('Pre registráciu musíte potvrdiť Podmienky a Ochranu osobných údajov.');
    return;
  }

  if (tsEl && !tsEl.value) tsEl.value = String(Date.now());

  const fd = new FormData(form);
  if (sameEl && sameEl.checked) {
    fd.set('delivery_address', fd.get('address') || '');
  }
  fd.set('gdpr', '1');

  const data = Object.fromEntries(fd.entries());

  try {
    const result = await apiRequest('/api/b2c/register', { method: 'POST', body: data });
    alert(result.message || 'OK');

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
// Verejný cenník (pred loginom) – NOVÝ KARTOVÝ DIZAJN (GRID)
// -----------------------------------------------------------------
async function loadPublicPricelist() {
  const container = document.getElementById('public-pricelist-container');
  if (!container) return;
  
  container.innerHTML = '<p style="text-align:center; padding:20px;">Načítavam aktuálnu ponuku...</p>';
  
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

    let html = '';

    // --- AKCIA TÝŽĎA (Špeciálna sekcia) ---
    if (akciaItems.length) {
      html += `
        <div class="category-header-wrapper" style="margin-bottom:15px; margin-top:10px;">
            <h2 style="color:#b91c1c; display:flex; align-items:center; gap:10px;">
                <i class="fas fa-fire"></i> Akcia týždňa
            </h2>
        </div>
        <div class="product-grid" style="margin-bottom:40px;">`;

      akciaItems.forEach(p => {
        html += generateProductCardHTML(p, false); // false = not logged in (no inputs)
      });

      html += `</div>`;
    }

    // --- Ostatné kategórie ---
    // ... (začiatok funkcie loadPublicPricelist ostáva rovnaký) ...

    // --- Ostatné kategórie ---
    otherCategories.forEach(category => {
      // VYTVORENIE ID PRE SCROLLOVANIE (nahradí medzery pomlčkami)
      const catId = `cat-${category.replace(/\s+/g, '-')}`;
      
      html += `
        <div class="category-header-wrapper" style="margin-bottom:15px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">
            <h3 id="${catId}" style="color:#334155; scroll-margin-top: 140px;">${escapeHtml(category)}</h3>
        </div>
        <div class="product-grid">`;

      (productsByCat[category] || []).forEach(p => {
        html += generateProductCardHTML(p, false);
      });

      html += `</div>`;
    });

    container.innerHTML = html;

    // NOVÉ: Zavolanie funkcie na vytvorenie navigačných tlačidiel (chipsov)
    renderCategoryChips(otherCategories);

  } catch (error) {
    container.innerHTML =
      `<h2>Naša ponuka</h2><p class="error">Nepodarilo sa načítať produkty: ${escapeHtml(error.message)}</p>`;
  }
}

// -----------------------------------------------------------------
// Objednávka (po logine) – NOVÝ KARTOVÝ DIZAJN (GRID)
// -----------------------------------------------------------------
async function loadOrderForm() {
  const container = document.getElementById('order-pricelist-container');
  if (!container) return;
  container.innerHTML = '<p style="text-align:center; padding:20px;">Pripravujem objednávkový formulár...</p>';

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

    let html = '';

    // --- AKCIA TÝŽĎA ---
    if (akciaItems.length) {
      html += `
        <div class="category-header-wrapper" style="margin-bottom:15px; margin-top:10px;">
            <h2 style="color:#b91c1c; display:flex; align-items:center; gap:10px;">
                <i class="fas fa-fire"></i> Akcia týždňa
            </h2>
        </div>
        <div class="product-grid" style="margin-bottom:40px;">`;

      akciaItems.forEach(p => {
        html += generateProductCardHTML(p, true); // true = logged in (with inputs)
      });

      html += `</div>`;
    }

    // --- Ostatné kategórie ---
    otherCategories.forEach(category => {
      const catId = `cat-${category.replace(/\s+/g, '-')}`;

      html += `
        <div class="category-header-wrapper" style="margin-bottom:15px; border-bottom:2px solid #e2e8f0; padding-bottom:5px;">
            <h3 id="${catId}" style="color:#334155; scroll-margin-top: 140px;">${escapeHtml(category)}</h3>
        </div>
        <div class="product-grid">`;

      (productsByCat[category] || []).forEach(p => {
        html += generateProductCardHTML(p, true);
      });

      html += `</div>`;
    });

    container.innerHTML = html;

    // Eventy pre inputy
    container.querySelectorAll('.quantity-input').forEach(input => {
      input.addEventListener('input', updateOrderTotal);
    });
    // NOVÉ: Zavolanie funkcie na vytvorenie navigačných tlačidiel
    renderCategoryChips(otherCategories);
    ensureOrderExtras();
    // Nastavenie dátumu (zajtra ako min)
    const deliveryDateInput = document.getElementById('deliveryDate');
    if (deliveryDateInput) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      deliveryDateInput.min = tomorrow.toISOString().split('T')[0];
      if(!deliveryDateInput.value) deliveryDateInput.value = deliveryDateInput.min;
    }

    ensureOrderExtras();
    const form = document.getElementById('orderForm');
    if (form && !form.dataset.submitHandlerBound) {
      form.addEventListener('submit', handleOrderSubmit);
      form.dataset.submitHandlerBound = '1';
    }

    enforceManualSubmit();
    updateOrderTotal();
renderCategoryChips(otherCategories);
  } catch (error) {
    container.innerHTML =
      `<h2>Vytvoriť objednávku</h2><p class="error">Nepodarilo sa načítať produkty: ${escapeHtml(error.message)}</p>`;
  }
}

// -----------------------------------------------------------------
//  GENEROVANIE KARTY PRODUKTU (HTML)
// -----------------------------------------------------------------
function generateProductCardHTML(p, isLoggedIn) {
    const title = escapeHtml(p.nazov_vyrobku);
    const composition = p.popis ? escapeHtml(p.popis) : 'Zloženie a pôvod sú k dispozícii na vyžiadanie.';
    const priceFormatted = `${Number(p.cena_s_dph).toFixed(2)} €`;
    const imgUrl = p.obrazok_url || 'https://www.miksro.sk/wp-content/uploads/2025/09/Dizajn-bez-nazvu-1.png';
    const unit = escapeHtml(p.mj);

    // Sekcia pre inputy (len ak je prihlásený)
    let controlsHtml = '';
    if (isLoggedIn) {
        const byPieceHtml = (p.mj === 'kg') 
          ? `<div class="piece-checkbox-wrapper" style="margin-top:8px; font-size:0.8rem; display:flex; align-items:center; gap:5px;">
               <input type="checkbox" class="by-piece-checkbox" id="chk-${p.ean}" onchange="toggleItemNote(this, '${p.ean}')">
               <label for="chk-${p.ean}" style="cursor:pointer; color:#64748b;">Objednať na kusy</label>
               <button type="button" class="by-piece-button hidden" onclick="openItemNoteModal('${p.ean}')" 
                       style="background:none; border:none; color:#16a34a; cursor:pointer;">
                   <i class="fas fa-pen"></i>
               </button>
             </div>`
          : '';

        controlsHtml = `
            <div class="card-controls" style="margin-top: auto; padding-top: 15px; border-top: 1px solid #f1f5f9;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:1.2rem; color:#16a34a;">${priceFormatted} <small style="font-size:0.7rem; color:#64748b;">/ ${unit}</small></div>
                    <div style="display:flex; align-items:center; gap:5px;">
                        <input type="number" class="quantity-input" 
                               min="0" step="${p.mj === 'ks' ? '1' : '0.1'}" 
                               placeholder="0"
                               style="width:70px; padding:8px; text-align:center; border:1px solid #cbd5e1; border-radius:6px; font-weight:bold;"
                               data-ean="${p.ean}"
                               data-name="${title}"
                               data-price-s-dph="${p.cena_s_dph}"
                               data-price-bez-dph="${p.cena_bez_dph}"
                               data-unit="${p.mj}">
                        <span style="font-size:0.8rem; color:#64748b;">${unit}</span>
                    </div>
                </div>
                ${byPieceHtml}
            </div>
        `;
    } else {
        // Ak nie je prihlásený, zobraz len cenu
        controlsHtml = `
            <div class="card-controls" style="margin-top: auto; padding-top: 15px; border-top: 1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                 <div style="font-weight:bold; font-size:1.2rem; color:#16a34a;">${priceFormatted}</div>
                 <div style="font-size:0.85rem; color:#64748b;">za ${unit}</div>
            </div>
        `;
    }

    // Akciový odznak
    const badgeHtml = p.je_v_akcii 
        ? `<div style="position:absolute; top:10px; left:10px; background:#dc2626; color:white; font-weight:bold; font-size:0.75rem; padding:4px 10px; border-radius:20px; box-shadow:0 2px 4px rgba(0,0,0,0.2); z-index:2;">AKCIA</div>`
        : '';

    return `
      <div class="product-card" data-ean="${p.ean}" style="position:relative; background:white; border:1px solid #e2e8f0; border-radius:12px; padding:15px; display:flex; flex-direction:column; transition:transform 0.2s; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
        ${badgeHtml}
        
        <div class="img-wrapper" style="width:100%; height:180px; overflow:hidden; border-radius:8px; margin-bottom:12px; background:#f8fafc; display:flex; align-items:center; justify-content:center;">
            <img src="${imgUrl}" alt="${title}" loading="lazy" style="width:100%; height:100%; object-fit:cover;">
        </div>

        <h3 style="margin:0 0 8px 0; font-size:1.1rem; color:#1e293b; line-height:1.3; min-height:2.6em;">${title}</h3>
        
        <div class="product-meta" style="font-size:0.8rem; color:#64748b; line-height:1.4; margin-bottom:10px; flex-grow:1;">
            ${composition.substring(0, 120)}${composition.length > 120 ? '...' : ''}
            ${composition.length > 120 ? `<a href="#" onclick="handleReadMoreClick(this); return false;" data-title="${escapeHtml(title)}" data-img="${escapeHtml(imgUrl)}" data-desc="${escapeHtml(p.popis)}" style="color:#16a34a; text-decoration:none; font-weight:600;"> Viac</a>` : ''}
            <div style="margin-top:6px; font-size:0.75rem; color:#94a3b8;">
                <i class="fas fa-temperature-low"></i> Skladujte pri 0°C až +4°C
            </div>
        </div>

        ${controlsHtml}
      </div>
    `;
}

// -----------------------------------------------------------------
// Výpočet sumy
// -----------------------------------------------------------------
function updateOrderTotal() {
  let total_s_dph   = 0;
  let total_bez_dph = 0;

  const formEl = document.getElementById('orderForm');
  if (!formEl) return;

  // 1. Spočítanie sumy zo všetkých inputov
  formEl.querySelectorAll('.quantity-input').forEach(input => {
    const rawQty = String(input.value || '').replace(',', '.');
    const quantity      = parseFloat(rawQty) || 0;
    const price_s_dph   = parseFloat(input.dataset.priceSDph)   || 0;
    const price_bez_dph = parseFloat(input.dataset.priceBezDph) || 0;

    total_s_dph   += quantity * price_s_dph;
    total_bez_dph += quantity * price_bez_dph;
  });

  const total_dph = total_s_dph - total_bez_dph;

  // 2. Elementy DOM
  const totalPriceEl      = document.getElementById('total-price');
  const minOrderWarningEl = document.getElementById('min-order-warning');
  const submitBtn         = formEl.querySelector('button[type="submit"]');

  // 3. Výpočet pre Progress Bar (Limit)
  const minOrder = B2C_STATE.minOrderValue;
  // Percento naplnenia (max 100%)
  const percentage = Math.min((total_s_dph / minOrder) * 100, 100);
  // Koľko chýba do limitu
  const remaining = Math.max(minOrder - total_s_dph, 0);
  // Farba: Žltá (nedokončené) vs. Zelená (hotovo)
  const barColor = total_s_dph >= minOrder ? '#16a34a' : '#eab308';

  // 4. Vykreslenie Progress Baru a Sumy
  if (totalPriceEl) {
    totalPriceEl.innerHTML = `
      <div style="background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:15px;">
        
        <div style="margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; font-size:0.9rem; margin-bottom:6px; font-weight:600; color:#334155;">
                <span>Aktuálna hodnota: ${total_s_dph.toFixed(2)} €</span>
                <span>Cieľ: ${minOrder.toFixed(2)} €</span>
            </div>
            
            <div style="width:100%; background:#e2e8f0; height:12px; border-radius:6px; overflow:hidden; box-shadow:inset 0 1px 2px rgba(0,0,0,0.05);">
                <div style="width:${percentage}%; background-color:${barColor}; height:100%; transition:width 0.4s ease-out;"></div>
            </div>

            <div style="text-align:center; font-size:0.9rem; margin-top:8px; font-weight:500;">
                ${remaining > 0 
                    ? `<span style="color:#b45309;">Nakúpte ešte za <strong>${remaining.toFixed(2)} €</strong> pre možnosť objednať.</span>`
                    : `<span style="color:#16a34a;"><i class="fas fa-check-circle"></i> Minimálna hodnota splnená, môžete objednať!</span>`
                }
            </div>
        </div>

        <div style="border-top:1px dashed #cbd5e1; padding-top:10px; font-size:.9em; text-align:right; line-height:1.6;">
          Celkom bez DPH: ${total_bez_dph.toFixed(2).replace('.', ',')} €<br>
          DPH: ${total_dph.toFixed(2).replace('.', ',')} €<br>
          <strong style="font-size:1.4em; color:#1e293b;">Suma k úhrade: ${total_s_dph.toFixed(2).replace('.', ',')} €</strong>
          <div style="font-size:0.75rem; color:#64748b; margin-top:5px; font-style:italic;">
             Poznámka: Pri váženom tovare je cena orientačná. Presná suma bude určená po prevážení pri expedícii.
          </div>
        </div>
      </div>`;
  }

  // 5. Logika tlačidla (Zamknutie / Odomknutie)
  if (submitBtn) {
    submitBtn.textContent = 'Objednať s povinnosťou platby';
    
    // Starý textový warning skryjeme, lebo progress bar ho nahrádza
    if (minOrderWarningEl) minOrderWarningEl.classList.add('hidden');

    if (total_s_dph > 0 && total_s_dph < minOrder) {
      // Máme tovar, ale pod limitom -> Zablokovať
      submitBtn.disabled = true;
      submitBtn.style.backgroundColor = '#ccc';
      submitBtn.style.cursor = 'not-allowed';
    } else {
      // Buď je košík prázdny (0), alebo je nad limitom
      // Ak je prázdny, tiež nepovolíme odoslať
      if (total_s_dph <= 0) {
          submitBtn.disabled = true;
          submitBtn.style.backgroundColor = '#ccc'; // šedá pre prázdny košík
          submitBtn.style.cursor = 'not-allowed';
      } else {
          // Všetko OK -> Povoliť
          submitBtn.disabled = false;
          submitBtn.style.backgroundColor = ''; // reset na pôvodnú (zelenú/červenú z CSS)
          submitBtn.style.cursor = 'pointer';
      }
    }
  }

// Vždy zobraziť sekciu súhrnu
  const summarySection = document.getElementById('order-summary-section');
  if (summarySection) {
    summarySection.classList.remove('hidden');
  }

  // === UPDATE STICKY BAR (MOBILE) ===
  const stickyBar = document.getElementById('mobile-sticky-cart');
  const stickyTotal = document.getElementById('msc-total');
  
  if (stickyBar && stickyTotal) {
      stickyTotal.textContent = total_s_dph.toFixed(2) + ' €';
      
      // Zobrazíme lištu len ak je v košíku niečo (> 0) a nie sme na desktope (voliteľné)
      if (total_s_dph > 0) {
          stickyBar.classList.remove('hidden');
          // Posunieme body padding, aby lišta neprekrývala obsah na spodku
          document.body.style.paddingBottom = '70px';
      } else {
          stickyBar.classList.add('hidden');
          document.body.style.paddingBottom = '0';
      }
  }
}
async function handleOrderSubmit(event) {
  event.preventDefault();

  const items = Array.from(document.querySelectorAll('#orderForm .quantity-input')).map(input => {
    const quantity = parseFloat(input.value);
    if (quantity > 0) {
      const byPieceCheckbox = input.closest('.product-card')?.querySelector('.by-piece-checkbox');
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
    delivery_window: document.getElementById('deliveryWindow')?.value || '',
    reward_code: document.getElementById('rewardCode')?.value?.trim() || ''
  };

  try {
    const result = await apiRequest('/api/b2c/submit-order', { method: 'POST', body: orderData });
    alert(result.message);

    if ((result.message || '').includes("úspešne")) {
      document.getElementById('orderForm')?.reset();
      updateOrderTotal();
      checkSession(); 
      document.querySelector('.tab-button[data-tab="history-content"]')?.click();
    }
  } catch (_) {}
}

// -----------------------------------------------------------------
// História objednávok
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
  const itemCard = checkbox.closest('.product-card');
  if (!itemCard) return;

  const noteButton = itemCard.querySelector('.by-piece-button');
  const quantityInput = itemCard.querySelector('.quantity-input');

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
// Detailný Info modal (pre tlačidlo "Viac" v karte)
// -----------------------------------------------------------------
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
        <div id="pim-title" style="font-weight:700;font-size:1.2rem;margin-bottom:8px; color:#1e293b;"></div>
        <div id="pim-desc" style="white-space:pre-wrap; color:#333; line-height:1.6; font-size:0.95rem;"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
}

function openProductInfo(title, imgUrl, desc) {
  ensureProductInfoModalV2();
  const m = document.getElementById('product-info-modal');
  if (!m) return;

  const titleEl = m.querySelector('#pim-title');
  const descEl  = m.querySelector('#pim-desc');
  const imgCont = m.querySelector('#pim-img-container');

  if (titleEl) titleEl.textContent = title;
  if (descEl)  descEl.textContent  = desc || 'Bez popisu.';

  if (imgCont) {
    if (imgUrl) {
      imgCont.innerHTML = `<img src="${imgUrl}" alt="${escapeHtml(title)}"
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
// Garant: objednávka sa pošle len fyzickým klikom na tlačidlo "Odoslať"
// -----------------------------------------------------------------
function enforceManualSubmit() {
  const form = document.getElementById('orderForm');
  if (!form) return;

  if (form.dataset.manualSubmitGuard === '1') return;
  form.dataset.manualSubmitGuard = '1';

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') e.preventDefault();
  });

  let submitViaPointer = false;
  form.addEventListener('pointerdown', (e) => {
    const btn = e.target && e.target.closest('button[type="submit"], input[type="submit"]');
    if (btn) submitViaPointer = true;
  }, true);

  form.addEventListener('submit', (e) => {
    if (!submitViaPointer) e.preventDefault();
    submitViaPointer = false;
  });
}

// -----------------------------------------------------------------
// DOPLNOK – dodacie okno + kód odmeny
// -----------------------------------------------------------------
function ensureOrderExtras() {
  const host = document.getElementById('order-summary-section') ||
               document.getElementById('orderForm') ||
               document.body;
  if (!host) return;

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
    loadDeliveryWindows();
  }

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
  let PASSWORD_RESET_TOKEN = '';

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
    }
  };

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

  document.addEventListener('DOMContentLoaded', function () {
    window.maybeOpenPasswordChangeModalFromUrl();
  });
})();
// =================================================================
// === COOKIE CONSENT LOGIKA ===
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    initCookieBanner();
});

function initCookieBanner() {
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;

    // Skontrolujeme, či už máme rozhodnutie (uložené v localStorage)
    const consent = localStorage.getItem('mik_cookie_consent');

    // Ak ešte nemáme rozhodnutie, ukážeme lištu
    if (!consent) {
        banner.classList.remove('hidden');
    } else {
        // Tu by sa spustili skripty podľa súhlasu (napr. Google Analytics)
        if (consent === 'all') {
            enableAnalytics(); 
        }
    }

    // Tlačidlo "Súhlasím so všetkým"
    document.getElementById('cookie-accept')?.addEventListener('click', () => {
        localStorage.setItem('mik_cookie_consent', 'all');
        banner.classList.add('hidden');
        enableAnalytics();
    });

    // Tlačidlo "Len nevyhnutné"
    document.getElementById('cookie-reject')?.addEventListener('click', () => {
        localStorage.setItem('mik_cookie_consent', 'necessary');
        banner.classList.add('hidden');
        // Nespustíme analytiku
    });
}

function enableAnalytics() {
    console.log('Spúšťam Google Analytics (GA4)...');
    
    // Vaše ID merania
    const GA_MEASUREMENT_ID = 'G-S399B7ZDCT'; 

    // 1. Dynamické vloženie <script> tagu pre Google Tag Manager
    // Toto je to isté, ako keby ste to dali do HTML, ale robíme to cez JS kvôli súhlasu
    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    script.async = true;
    document.head.appendChild(script);

    // 2. Inicializácia gtag funkcie (podľa dokumentácie Google)
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    // 3. Konfigurácia s vaším ID
    gtag('config', GA_MEASUREMENT_ID);
}// === FILTER PRODUKTOV ===
function filterProducts() {
    const input = document.getElementById('productSearch');
    const filter = input.value.toLowerCase();
    const cards = document.querySelectorAll('.product-card');

    cards.forEach(card => {
        const title = card.querySelector('h3')?.textContent || '';
        if (title.toLowerCase().includes(filter)) {
            card.style.display = "";
        } else {
            card.style.display = "none";
        }
    });
}

// ==========================================
// === GENERÁTOR NAVIGAČNÝCH TLAČIDIEL (OPRAVENÝ) ===
// ==========================================
function renderCategoryChips(categories) {
    const nav = document.getElementById('category-nav');
    if (!nav) return;

    // Vyčistíme existujúci obsah navigácie
    nav.innerHTML = '';

    // 1. Tlačidlo pre AKCIU (ak existuje sekcia s akciou)
    // Skontrolujeme, či v HTML existuje element pre akciu
    const actionSection = document.querySelector('.akcia-tyzdna-box') || document.querySelector('.fa-fire');
    
    if (actionSection) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-chip akcia';
        // Nastavenie štýlov priamo
        btn.style.cssText = "white-space:nowrap; background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; border-radius:20px; padding:6px 14px; font-size:0.85rem; font-weight:700; cursor:pointer; margin-right:8px;";
        btn.innerHTML = '<i class="fas fa-fire"></i> AKCIA';
        
        // Priradenie funkcie kliknutia priamo (nie cez HTML string)
        btn.onclick = function() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        
        nav.appendChild(btn);
    }

    // 2. Tlačidlá pre ostatné kategórie
    categories.forEach(cat => {
        // Vytvoríme ID rovnakým spôsobom ako pri generovaní produktov
        const catId = `cat-${cat.replace(/\s+/g, '-')}`;
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-chip';
        btn.style.cssText = "white-space:nowrap; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:20px; padding:6px 14px; font-size:0.85rem; font-weight:600; color:#475569; cursor:pointer; margin-right:8px;";
        btn.textContent = cat; // Bezpečné vloženie textu
        
        btn.onclick = function() {
            const targetEl = document.getElementById(catId);
            if (targetEl) {
                // Posun (scroll) s malou rezervou pre fixnú hlavičku
                const headerOffset = 130; 
                const elementPosition = targetEl.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: "smooth"
                });
            } else {
                console.warn('Cieľ scrollovania nenájdený:', catId);
            }
        };
        
        nav.appendChild(btn);
    });
}