document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  const notification = document.getElementById('notification');
  const authViewsContainer = document.getElementById('auth-views');
  const customerPortalView = document.getElementById('view-customer-portal');

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const passwordResetRequestForm = document.getElementById('passwordResetRequestForm');
  const passwordResetForm = document.getElementById('passwordResetForm');
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const backToLoginLinks = document.querySelectorAll('.back-to-login-link');
  const logoutLink = document.getElementById('logout-link');

  console.log('✅ b2b_app.js bol úspešne načítaný');

  let appState = { currentUser: null, products: {}, order: {} };
  let commInited = false;
  let helpLoaded = false;

  // =========================
  // Anti-bot (AB)
  // =========================
  const AB = { token: null, minDelay: 800, issuedAt: 0 };

  async function getAbToken() {
    try {
      const r = await fetch('/api/b2b/ab-token', { credentials: 'same-origin' });
      const j = await r.json();
      AB.token = j.token;
      AB.minDelay = j.min_delay_ms || 800;
      AB.issuedAt = performance.now();
    } catch {
      AB.token = null;
      AB.minDelay = 800;
      AB.issuedAt = performance.now();
    }
  }

  function ensureMinDelay() {
    const elapsed = performance.now() - (AB.issuedAt || 0);
    return new Promise(res => setTimeout(res, Math.max(0, (AB.minDelay || 800) - elapsed)));
  }

  function addHoneypot(form) {
    if (!form || form.querySelector('input[name="hp"]')) return;
    const hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'hp';
    hp.autocomplete = 'off';
    hp.tabIndex = -1;
    hp.style.position = 'absolute';
    hp.style.left = '-10000px';
    hp.style.opacity = '0';
    form.appendChild(hp);
  }

  [loginForm, registerForm, passwordResetRequestForm, passwordResetForm].forEach(addHoneypot);
  getAbToken();

  // =========================
  // a11y autocomplete
  // =========================
  const setA = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('autocomplete', val);
  };
  setA('login-id', 'username');
  setA('login-password', 'current-password');
  setA('reg-password', 'new-password');
  setA('new-password', 'new-password');
  setA('confirm-password', 'new-password');
  setA('reg-phone', 'tel');

  // =========================
  // UI helpers
  // =========================
  function showMainView(v) {
    authViewsContainer?.classList.toggle('hidden', v !== 'auth');
    customerPortalView?.classList.toggle('hidden', v !== 'customer');
  }

  function showNotification(msg, type) {
    if (!notification) return;
    notification.textContent = msg;
    notification.className = type;
    notification.classList.remove('hidden');
    setTimeout(() => notification.classList.add('hidden'), 5000);
  }

  function showLoader() { loader?.classList.remove('hidden'); }
  function hideLoader() { loader?.classList.add('hidden'); }

  async function apiCall(url, data) {
    showLoader();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(data || {})
      });
      const ct = res.headers.get('Content-Type') || '';
      const out = ct.includes('application/json') ? await res.json() : { error: await res.text() };
      if (!res.ok || out.error) throw new Error(out.error || `HTTP ${res.status}`);
      return out;
    } catch (e) {
      showNotification(e.message || 'Neznáma chyba servera.', 'error');
      return null;
    } finally {
      hideLoader();
    }
  }

  function showAuthView(viewId) {
    document.querySelectorAll('#auth-views > div').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
  }

  // =========================
  // AUTH
  // =========================

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await ensureMinDelay();
      const data = {
        zakaznik_id: loginForm.elements.zakaznik_id.value,
        password: loginForm.elements.password.value,
        ab_token: AB.token,
        hp: loginForm.querySelector('input[name="hp"]')?.value || ''
      };
      const result = await apiCall('/api/b2b/login', data);
      if (result && result.userData) handleLoginSuccess(result.userData);
      getAbToken();
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = registerForm.elements.password.value;
      if (pwd.length < 6) return showNotification('Heslo musí mať aspoň 6 znakov.', 'error');
      await ensureMinDelay();
      const data = {
        nazov_firmy: registerForm.elements.nazov_firmy.value,
        adresa: registerForm.elements.adresa.value,
        adresa_dorucenia: (registerForm.elements.adresa_dorucenia?.value || ''),
        email: registerForm.elements.email.value,
        telefon: registerForm.elements.telefon.value,
        password: pwd,
        gdpr: registerForm.elements.gdpr.checked,
        ab_token: AB.token,
        hp: registerForm.querySelector('input[name="hp"]')?.value || ''
      };
      const out = await apiCall('/api/b2b/register', data);
      if (out) {
        showNotification(out.message || 'Registrácia odoslaná.', 'success');
        registerForm.reset();
        document.querySelector('.tab-button[data-tab="login"]')?.click();
      }
      getAbToken();
    });
  }

  if (passwordResetRequestForm) {
    passwordResetRequestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await ensureMinDelay();
      const out = await apiCall('/api/b2b/request-reset', {
        email: passwordResetRequestForm.elements.email.value,
        ab_token: AB.token,
        hp: passwordResetRequestForm.querySelector('input[name="hp"]')?.value || ''
      });
      if (out) showNotification(out.message, 'success');
      getAbToken();
    });
  }

  if (passwordResetForm) {
    passwordResetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = passwordResetForm.elements.password.value;
      const p2 = passwordResetForm.elements['confirm-password'].value;
      if (p1.length < 6) return showNotification('Heslo musí mať aspoň 6 znakov.', 'error');
      if (p1 !== p2) return showNotification('Heslá sa nezhodujú.', 'error');
      await ensureMinDelay();
      const out = await apiCall('/api/b2b/perform-reset', {
        token: passwordResetForm.elements.token.value,
        password: p1,
        ab_token: AB.token,
        hp: passwordResetForm.querySelector('input[name="hp"]')?.value || ''
      });
      if (out) {
        showNotification(out.message, 'success');
        setTimeout(() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          showAuthView('view-auth');
        }, 2000);
      }
      getAbToken();
    });
  }

  forgotPasswordLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('view-password-reset-request');
  });

  backToLoginLinks?.forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    showAuthView('view-auth');
  }));

  logoutLink?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('b2bUser');
    appState.currentUser = null;
    loginForm?.reset();
    showMainView('auth');
    showAuthView('view-auth');
  });

  // =========================
  // LOGIN SUCCESS → PORTÁL
  // =========================

  function handleLoginSuccess(user) {
    appState.currentUser = user;
    sessionStorage.setItem('b2bUser', JSON.stringify(user));
    if (user.role === 'admin') {
      showNotification('Admin prihlásenie úspešné.', 'success');
      return;
    }

    showMainView('customer');
    document.getElementById('customer-name').textContent = user.nazov_firmy || '';

    const bar = document.getElementById('announcement-bar');
    if (user.announcement) {
      bar.textContent = user.announcement;
      bar.classList.remove('hidden');
    } else bar.classList.add('hidden');

    const sel = document.getElementById('pricelist-select');
    const stepProducts = document.getElementById('step-products');
    const productsContainer = document.getElementById('products-container');
    const details = document.getElementById('order-form-details');

    stepProducts.classList.add('hidden');
    productsContainer.innerHTML = '';
    details.classList.add('hidden');
    appState.order = {};
    appState.products = {};

    sel.innerHTML = '<option value="">-- Vyberte cenník --</option>';
    (user.pricelists || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.nazov_cennika;
      sel.appendChild(o);
    });

    sel.onchange = async () => {
      const id = sel.value;
      if (!id) {
        stepProducts.classList.add('hidden');
        productsContainer.innerHTML = '';
        details.classList.add('hidden');
        appState.order = {};
        appState.products = {};
        return;
      }
      const res = await apiCall('/api/b2b/get-products', { pricelist_id: id });
      if (!res) return;
      appState.products = res.productsByCategory || {};
      renderProducts();
      stepProducts.classList.remove('hidden');
    };

    document.getElementById('btn-back-to-pricelist').onclick = () => {
      sel.value = '';
      stepProducts.classList.add('hidden');
      productsContainer.innerHTML = '';
      details.classList.add('hidden');
      appState.order = {};
      appState.products = {};
    };

    document.getElementById('btn-submit-order').onclick = submitOrder;
  }

  // =========================
  // PRODUKTY + OBJEDNÁVKA
  // =========================

  function renderProducts() {
    const container = document.getElementById('products-container');
    const details = document.getElementById('order-form-details');
    container.innerHTML = '';
    appState.order = {};
    details.classList.add('hidden');

    const cats = Object.keys(appState.products || {});
    if (!cats.length) {
      container.innerHTML = '<p>Pre tento cenník neboli nájdené žiadne produkty.</p>';
      return;
    }

    cats.forEach(category => {
      let html = `<h3>${category}</h3><table class="b2b-products-table"><thead><tr><th>Názov</th><th style="width: 120px; text-align: center;">Cena/MJ</th><th style="width: 260px;">Množstvo</th></tr></thead><tbody>`;
      
      (appState.products[category] || []).forEach(p => {
        const price = Number(p.cena || 0).toFixed(2);
        const ean = p.ean_produktu;
        const isKg = (p.mj || '').toLowerCase() === 'kg';
        
        // --- PRÍPRAVA DÁT PRE MODÁLNE OKNO (Ošetrenie úvodzoviek) ---
        const safeTitle = (p.nazov_vyrobku || '').replace(/"/g, '&quot;');
        const safeImg = (p.obrazok_url || '').replace(/"/g, '&quot;');
        const safeDesc = (p.popis || '').replace(/"/g, '&quot;');

        html += `<tr data-product-ean="${ean}">
          <td>
            ${p.nazov_vyrobku}
            <div style="margin-top: 4px;">
                <a href="#" 
                   style="color:#16a34a; font-size:0.8rem; text-decoration:underline;"
                   data-title="${safeTitle}"
                   data-img="${safeImg}"
                   data-desc="${safeDesc}"
                   onclick="openProductInfo(this.dataset.title, this.dataset.img, this.dataset.desc); return false;">
                   Viac info
                </a>
            </div>
          </td>
          <td style="text-align:center;">${price} € / ${p.mj}</td>
          <td>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <input type="text" inputmode="decimal" class="quantity-input" data-ean="${ean}" style="width:90px;text-align:right;">
              ${isKg ? `
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="checkbox" id="isPiece_${ean}" class="by-piece-checkbox" style="cursor:pointer;width:18px;height:18px;">
                <label for="isPiece_${ean}" style="font-size:.9rem;cursor:pointer;">KS</label>
                <button id="noteBtn_${ean}" class="item-note-button hidden" title="Pridať poznámku" style="border:none;background:none;cursor:pointer;">
                  📝
                </button>
              </div>` : '<div></div>'}
            </div>
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
      container.insertAdjacentHTML('beforeend', html);
    });

    container.querySelectorAll('.quantity-input').forEach(i => i.addEventListener('input', onQty));
    container.querySelectorAll('.by-piece-checkbox').forEach(chk => chk.addEventListener('change', () => togglePiece(chk)));
    container.querySelectorAll('.item-note-button').forEach(btn => btn.addEventListener('click', () => {
      const ean = btn.id.replace('noteBtn_', '');
      openItemNoteModal(ean);
    }));
  }

  function findByEan(ean) {
    for (const c in appState.products) {
      const p = (appState.products[c] || []).find(x => String(x.ean_produktu) === String(ean));
      if (p) return p;
    }
    return null;
  }

  function onQty(e) {
    const input = e.target, ean = input.dataset.ean;
    const v = (input.value || '').replace(',', '.');
    const q = parseFloat(v);
    if (!isNaN(q) && q > 0) {
      const p = findByEan(ean);
      appState.order[ean] = {
        ean,
        name: p.nazov_vyrobku,
        price: Number(p.cena || 0),
        dph: Math.abs(Number(p.dph || 0)),
        unit: p.mj,
        quantity: q,
        item_note: appState.order[ean]?.item_note || ''
      };
    } else {
      delete appState.order[ean];
    }
    updateTotals();
  }

  function togglePiece(chk) {
    const ean = chk.id.replace('isPiece_', '');
    const btn = document.getElementById(`noteBtn_${ean}`);
    chk.checked ? btn?.classList.remove('hidden') : btn?.classList.add('hidden');
    if (!chk.checked && appState.order[ean]) appState.order[ean].item_note = '';
  }

  function openItemNoteModal(ean) {
    const p = findByEan(ean);
    const cur = appState.order[ean]?.item_note || '';
    const mc = document.getElementById('modal-container');
    mc.innerHTML = `<div class="modal-backdrop" onclick="closeModal()"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h4>Poznámka k položke: ${p?.nazov_vyrobku || ean}</h4>
          <button class="close-button" onclick="closeModal()">&times;</button>
        </div>
        <div class="form-group">
          <label for="item-note-input">Zadajte požiadavku (napr. 150g balenia):</label>
          <textarea id="item-note-input" rows="4">${cur}</textarea>
        </div>
        <button class="button" onclick="saveItemNote('${ean}')">Uložiť poznámku</button>
      </div>`;
    mc.style.display = 'flex';
  }

  window.saveItemNote = function (ean) {
    const note = document.getElementById('item-note-input').value;
    if (appState.order[ean]) appState.order[ean].item_note = note;
    else {
      const p = findByEan(ean);
      appState.order[ean] = {
        ean,
        name: p.nazov_vyrobku,
        price: Number(p.cena || 0),
        dph: Math.abs(Number(p.dph || 0)),
        unit: p.mj,
        quantity: 0,
        item_note: note
      };
    }
    closeModal();
  };

  window.closeModal = function () {
    const mc = document.getElementById('modal-container');
    mc.style.display = 'none';
    mc.innerHTML = '';
  };

  function updateTotals() {
    const box = document.getElementById('order-summary');
    const details = document.getElementById('order-form-details');
    const items = Object.values(appState.order);
    if (!items.length) {
      box.innerHTML = '';
      details.classList.add('hidden');
      return;
    }
    let net = 0, vat = 0;
    items.forEach(i => {
      const n = i.price * i.quantity;
      const v = n * ((Math.abs(i.dph) || 0) / 100);
      net += n; vat += v;
    });
    const gross = net + vat;
    box.innerHTML = `<div class="order-summary-box">
      <p><span>Spolu bez DPH:</span> <strong>${net.toFixed(2)} €</strong></p>
      <p><span>DPH:</span> <strong>${vat.toFixed(2)} €</strong></p>
      <p class="total"><span>Celkom s DPH:</span> <strong>${gross.toFixed(2)} €</strong></p>
    </div>`;
    details.classList.remove('hidden');
  }

  async function submitOrder() {
    const d = document.getElementById('delivery-date').value;
    if (!d) return showNotification('Zadajte požadovaný dátum dodania.', 'error');
    const items = Object.values(appState.order);
    if (!items.length) return showNotification('Nemáte v objednávke žiadne položky.', 'error');

    const out = await apiCall('/api/b2b/submit-order', {
      userId: appState.currentUser.id,
      customerName: appState.currentUser.nazov_firmy,
      customerEmail: appState.currentUser.email,
      items, deliveryDate: d,
      note: document.getElementById('order-note').value
    });
    if (!out) return;

    appState.order = {};
    document.querySelectorAll('.quantity-input').forEach(i => i.value = '');
    document.getElementById('order-note').value = '';
    document.getElementById('delivery-date').value = '';
    updateTotals();

    document.getElementById('products-container').innerHTML =
      `<h3>Ďakujeme!</h3><p style="font-size:1.5rem;text-align:center;">${out.message}</p><p style="text-align:center;">Na váš e-mail sme odoslali potvrdenie.</p>`;

    setTimeout(() => {
      const sel = document.getElementById('pricelist-select');
      const stepProducts = document.getElementById('step-products');
      sel.value = '';
      stepProducts.classList.add('hidden');
      document.getElementById('products-container').innerHTML = '';
      document.getElementById('order-form-details').classList.add('hidden');
    }, 1500);
  }

  window.submitOrder = submitOrder;

  // =========================
  // História objednávok – upravené UI
  // =========================

  window.loadB2BOrderHistory = async function () {
    const cont = document.getElementById('history-container');
    cont.innerHTML = '<p>Načítavam históriu objednávok...</p>';
    try {
      const uRaw = sessionStorage.getItem('b2bUser');
      const u = uRaw ? JSON.parse(uRaw) : null;
      if (!u || !u.id) {
        cont.innerHTML = '<p class="error">Nie ste prihlásený.</p>';
        return;
      }
      const resp = await apiCall('/api/b2b/get-order-history', { userId: u.id });
      const rows = (resp && resp.orders) || [];
      if (!rows.length) {
        cont.innerHTML = '<p>Zatiaľ nemáte žiadne B2B objednávky.</p>';
        return;
      }
      let html = '';
      rows.forEach(o => {
        const d = o.datum_vytvorenia ? new Date(o.datum_vytvorenia).toLocaleDateString('sk-SK') : '';
        const total = (o.celkova_suma_s_dph != null) ? Number(o.celkova_suma_s_dph).toFixed(2) + ' €' : '(neuvedené)';
        const pdf = `/api/b2b/order-pdf/${o.id}?user_id=${encodeURIComponent(u.id)}`;
        const pdfDl = `${pdf}&download=1`;
        html += `<div class="history-card" style="border:1px solid var(--border-color);border-radius:8px;padding:10px;margin-bottom:10px;background:#f9fafb;">
          <div style="display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;align-items:flex-start;justify-content:space-between;">
            <div style="flex:1 1 220px;min-width:180px;">
              <div class="history-title" style="font-weight:600;margin-bottom:2px;">Obj. č. ${o.cislo_objednavky}${d ? ` (${d})` : ''}</div>
              <div class="history-sub" style="font-size:.85rem;color:#4b5563;">Stav: ${o.stav || '—'}</div>
              ${o.poznamka ? `<div style="margin-top:4px;font-size:.85rem;word-wrap:break-word;">📌 <strong>Poznámka:</strong> ${o.poznamka}</div>` : ''}
            </div>
            <div style="flex:0 0 180px;min-width:180px;text-align:right;">
              <div class="history-total" style="font-weight:600;">Spolu: ${total}</div>
              <div class="history-actions" style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
                <a class="button" style="width:100%;text-align:center;" href="${pdf}" target="_blank" rel="noopener">Zobraziť PDF</a>
                <a class="button secondary" style="width:100%;text-align:center;" href="${pdfDl}" download>Stiahnuť PDF</a>
              </div>
            </div>
          </div>
        </div>`;
      });
      cont.innerHTML = html;
    } catch (e) {
      console.error(e);
      cont.innerHTML = '<p class="error">Nepodarilo sa načítať históriu.</p>';
    }
  };

  // =========================
  // KOMUNIKÁCIA – text sa zalamuje, prílohy
  // =========================

  async function initCommunicationView() {
    if (commInited) return;
    commInited = true;

    const form = document.getElementById('commForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subj = document.getElementById('comm-subject').value.trim();
      const body = document.getElementById('comm-body').value.trim();
      if (!subj || !body) {
        showNotification('Vyplňte predmet aj správu.', 'error');
        return;
      }

      const fd = new FormData();
      fd.append('userId', appState.currentUser.id);
      fd.append('subject', subj);
      fd.append('body', body);
      const file = document.getElementById('comm-file').files[0];
      if (file) fd.append('file', file);

      try {
        showLoader();
        const res = await fetch('/api/b2b/messages/send', {
          method: 'POST',
          body: fd,
          credentials: 'same-origin'
        });
        const out = await res.json();
        if (!res.ok || out.error) throw new Error(out.error || `HTTP ${res.status}`);
        showNotification(out.message || 'Správa odoslaná.', 'success');
        form.reset();
        await loadCommunicationList();
      } catch (err) {
        showNotification(err.message || 'Nepodarilo sa odoslať správu.', 'error');
      } finally {
        hideLoader();
      }
    });

    await loadCommunicationList();
  }

  async function openAttachment(id) {
    if (!appState.currentUser) return;
    const out = await apiCall('/api/b2b/messages/attachment', { id, userId: appState.currentUser.id });
    if (!out) return;
    try {
      const b64 = out.content_base64 || '';
      const byteCharacters = atob(b64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: out.mime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename || 'priloha';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error(e);
      showNotification('Nepodarilo sa otvoriť prílohu.', 'error');
    }
  }
  window.openAttachment = openAttachment;

  async function loadCommunicationList() {
    const list = document.getElementById('comm-list');
    list.innerHTML = '<p>Načítavam správy...</p>';
    try {
      const resp = await apiCall('/api/b2b/messages/my', { userId: appState.currentUser.id, page: 1, page_size: 50 });
      const rows = (resp && resp.messages) || [];
      if (!rows.length) {
        list.innerHTML = '<p>Zatiaľ nemáte žiadne správy.</p>';
        return;
      }
      let html = '';
      rows.forEach(m => {
        const dt = m.created_at ? new Date(m.created_at.replace(' ', 'T')).toLocaleString('sk-SK') : '';
        const dirLabel = m.direction === 'out' ? 'MIK → vy' : 'Vy → MIK';
        const badgeColor = m.direction === 'out' ? '#1d4ed8' : '#059669';
        const statusLabel = m.status === 'new' ? 'nová' : (m.status === 'closed' ? 'uzavretá' : 'prečítaná');
        const statusColor = m.status === 'new' ? '#b91c1c' : '#6b7280';

        html += `<div class="comm-card" style="border:1px solid var(--border-color);border-radius:8px;margin-bottom:10px;padding:10px;background:#f9fafb;">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="padding:2px 8px;border-radius:999px;font-size:.75rem;color:#fff;background:${badgeColor};">${dirLabel}</span>
              <span style="padding:2px 8px;border-radius:999px;font-size:.75rem;color:#fff;background:${statusColor};text-transform:uppercase;">${statusLabel}</span>
            </div>
            <span style="color:#6b7280;font-size:.8rem;">${dt}</span>
          </div>
          <div style="margin-top:6px;font-weight:600;">${m.subject || '(bez predmetu)'}</div>
          <div style="margin-top:6px;font-size:.9rem;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;">
            ${(m.body || '').replace(/</g, '&lt;')}
          </div>
          ${m.attachment_filename ? `
          <div style="margin-top:6px;">
            <button class="button secondary" style="width:auto;padding:4px 8px;font-size:.85rem;display:inline-flex;align-items:center;gap:4px;"
                    onclick="openAttachment(${m.id})">
              📎 Otvoriť prílohu (${m.attachment_filename})
            </button>
          </div>` : ''}
        </div>`;
      });
      list.innerHTML = html;
    } catch (e) {
      console.error(e);
      list.innerHTML = '<p class="error">Nepodarilo sa načítať správy.</p>';
    }
  }

  // =========================
  // POMOC / NÁVOD
  // =========================

  function ensureHelpView() {
    let view = document.getElementById('view-help');
    const container = document.getElementById('portal-views-container');
    if (!view && container) {
      view = document.createElement('div');
      view.id = 'view-help';
      view.className = 'hidden';
      view.innerHTML = '<div id="help-container" class="help-content"></div>';
      container.appendChild(view);
    }
  }

  function ensureHelpTab() {
    if (document.getElementById('tab-btn-help')) return;
    const historyBtn = document.getElementById('tab-btn-history');
    if (historyBtn && historyBtn.parentElement) {
      const helpBtn = document.createElement('button');
      helpBtn.id = 'tab-btn-help';
      helpBtn.type = 'button';
      helpBtn.className = 'tab-button';
      helpBtn.textContent = 'Pomoc / návod';
      helpBtn.addEventListener('click', () => showPortalView('view-help'));
      historyBtn.parentElement.appendChild(helpBtn);
    }
  }

  function loadHelpSection() {
    if (helpLoaded) return;
    helpLoaded = true;
    const box = document.getElementById('help-container');
    if (!box) return;
    box.innerHTML = `
      <h2>Pomoc a návod na použitie B2B portálu</h2>
      <p>Tento portál je určený pre zazmluvnených B2B zákazníkov spoločnosti MIK, s.r.o.</p>
      <h3>1. Prihlásenie</h3>
      <ul>
        <li>Prihláste sa pomocou priradeného ID zákazníka a hesla.</li>
        <li>Ak ste heslo zabudli, kliknite na <strong>"Zabudnuté heslo"</strong>, zadajte e-mail a v správe kliknite na odkaz na zmenu hesla.</li>
      </ul>
      <h3>2. Objednávky</h3>
      <ul>
        <li>Vyberte si cenník, z ktorého chcete objednávať.</li>
        <li>Pri jednotlivých položkách zadajte množstvo (kg alebo ks) a podľa potreby pridajte poznámku (napr. gramáž balenia).</li>
        <li>V dolnej časti vidíte súhrn bez DPH, DPH aj celkovú sumu.</li>
        <li>Zadajte požadovaný dátum dodania a objednávku odošlite.</li>
        <li>Potvrdenie objednávky dostanete e-mailom ako PDF + CSV pre expedíciu.</li>
      </ul>
      <h3>3. História objednávok</h3>
      <ul>
        <li>V sekcii <strong>História objednávok</strong> vidíte všetky svoje odoslané objednávky.</li>
        <li>Ku každej objednávke si viete zobraziť alebo stiahnuť PDF potvrdenie.</li>
      </ul>
      <h3>4. Komunikácia</h3>
      <ul>
        <li>V sekcii <strong>Komunikácia</strong> môžete posielať správy priamo expedícii.</li>
        <li>Správa môže obsahovať aj prílohu (napr. Excel, PDF, obrázok).</li>
        <li>V zozname vidíte históriu komunikácie a pri správach s prílohou tlačidlo <strong>📎 Otvoriť prílohu</strong>.</li>
      </ul>
      <h3>5. Kontakt na expedíciu</h3>
      <ul>
        <li><strong>Expedícia:</strong> 0905 518 114</li>
        <li><strong>E-mail:</strong> <a href="mailto:miksroexpedicia@gmail.com">miksroexpedicia@gmail.com</a></li>
      </ul>
      <p>V prípade problémov s portálom alebo objednávkami kontaktujte prosím expedíciu na uvedenom telefónnom čísle alebo e-maile.</p>
    `;
  }

  // =========================
  // Prepínač view v portáli
  // =========================

  window.showPortalView = function (viewId) {
    document.querySelectorAll('#portal-views-container > div').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    if (viewId === 'view-new-order') document.getElementById('tab-btn-order')?.classList.add('active');
    if (viewId === 'view-order-history') {
      document.getElementById('tab-btn-history')?.classList.add('active');
      loadB2BOrderHistory();
    }
    if (viewId === 'view-communication') {
      document.getElementById('tab-btn-comm')?.classList.add('active');
      initCommunicationView();
    }
    if (viewId === 'view-help') {
      document.getElementById('tab-btn-help')?.classList.add('active');
      ensureHelpView();
      loadHelpSection();
    }
  };

  // =========================
  // INIT
  // =========================

  (function init() {
    const storedUser = sessionStorage.getItem('b2bUser');
    if (storedUser) {
      try {
        handleLoginSuccess(JSON.parse(storedUser));
        return;
      } catch {
        sessionStorage.removeItem('b2bUser');
      }
    }

    // auth režim
    showMainView('auth');

    // ak prišiel z linku s tokenom (napr. /b2b?token=...), ukáž formulár na nové heslo
    try {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token') || params.get('reset_token');
      if (urlToken) {
        const tokenInput = document.getElementById('reset-token-input');
        if (tokenInput) tokenInput.value = urlToken;
        showAuthView('view-password-reset-form');
      } else {
        showAuthView('view-auth');
      }
    } catch {
      showAuthView('view-auth');
    }

    // prepínanie login/registrácia
    document.querySelectorAll('.tab-button[data-tab]')?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        document.getElementById('login-form-container').classList.toggle('hidden', tab !== 'login');
        document.getElementById('register-form-container').classList.toggle('hidden', tab !== 'register');
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });

    // helper tab a view
    ensureHelpView();
    ensureHelpTab();
  })();
});
// =========================================================
// === FUNKCIE PRE MODÁLNE OKNO (INFO O PRODUKTE) ===
// =========================================================

// 1. Otvorenie okna (s upraveným textom)
function openProductInfo(title, imgUrl, desc) {
  const m = document.getElementById('product-info-modal');
  if (!m) return;

  const titleEl = m.querySelector('#pim-title');
  const descEl  = m.querySelector('#pim-desc');
  const imgCont = m.querySelector('#pim-img-container');

  if (titleEl) titleEl.textContent = title;
  
  // === ZMENA: Text pre súťažné podklady ===
  if (descEl) {
      descEl.textContent = desc || 'Zloženie a pôvod sú v súlade so súťažnými podkladmi.';
  }

  if (imgCont) {
    if (imgUrl) {
      imgCont.innerHTML = `<img src="${imgUrl}" alt="${title}" 
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

// 2. Globálna funkcia pre zatvorenie krížikom
// (Musí byť priradená k 'window', aby ju HTML videlo)
window.closeModal = function(modalId) {
    const el = document.getElementById(modalId);
    if (el) {
        el.classList.remove('visible');
        el.style.display = 'none';
    }
};

// 3. Zatvorenie kliknutím na tmavé pozadie
window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.remove('visible');
        event.target.style.display = 'none';
    }
});