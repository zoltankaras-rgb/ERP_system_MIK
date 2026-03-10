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

  console.log('✅ b2b_app.js bol úspešne načítaný a opravený');

  let appState = { currentUser: null, products: {}, order: {} };
  let commInited = false;
  let helpLoaded = false;

  // ==========================================
  // === ANTISPAM (CAPTCHA) PREMENNÉ ===
  // ==========================================
  let captchaA = 0;
  let captchaB = 0;

  function generateCaptcha() {
    captchaA = Math.floor(Math.random() * 10) + 1; // Číslo 1-10
    captchaB = Math.floor(Math.random() * 10) + 1; // Číslo 1-10
    
    const label = document.getElementById('captcha-question');
    const input = document.getElementById('captcha-answer');
    
    if (label) label.textContent = `Koľko je ${captchaA} + ${captchaB}?`;
    if (input) input.value = ''; // Vyčistíme pole
  }

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
        hp: registerForm.querySelector('input[name="hp"]')?.value || '',
        
        // === PRIDANÉ: Antispam dáta ===
        captcha_a: captchaA,
        captcha_b: captchaB,
        captcha_answer: document.getElementById('captcha-answer').value
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

  // =================================================================
  // FRONTEND LOGIKA PRE B2B (Parent-Child / Pobočky)
  // =================================================================

  function handleLoginSuccess(user) {
    appState.currentUser = user;
    sessionStorage.setItem('b2bUser', JSON.stringify(user));

    if (user.role === 'admin') {
        showNotification('Admin prihlásenie úspešné.', 'success');
        return;
    }

    if (user.sub_accounts && user.sub_accounts.length > 0) {
        showBranchSelector(user);
    } else {
        initializeCustomerPortal(user, user.zakaznik_id, user.nazov_firmy, user.adresa);
    }
  }

  function showBranchSelector(user) {
    hideLoader();
    const mc = document.getElementById('modal-container');
    
    let buttonsHtml = `
        <button class="button secondary" style="width:100%; margin-bottom:10px; text-align:left; padding:15px; border:1px solid #ccc;" 
            onclick="selectBranch('${user.zakaznik_id}', '${user.nazov_firmy.replace(/'/g, "\\'")}', '${(user.adresa || '').replace(/'/g, "\\'")}')">
            <div style="font-weight:bold;">${user.nazov_firmy} (Centrála)</div>
            <small style="color:#666;">ID: ${user.zakaznik_id} • ${user.adresa || ''}</small>
        </button>
    `;

    if (user.sub_accounts) {
        user.sub_accounts.forEach(sub => {
            const safeName = sub.nazov_firmy.replace(/'/g, "\\'");
            const safeAddr = (sub.adresa_dorucenia || sub.adresa || '').replace(/'/g, "\\'");
            
            buttonsHtml += `
                <button class="button" style="width:100%; margin-bottom:10px; text-align:left; padding:15px;" 
                    onclick="selectBranch('${sub.zakaznik_id}', '${safeName}', '${safeAddr}')">
                    <div style="font-weight:bold;">${sub.nazov_firmy}</div>
                    <small>ID: ${sub.zakaznik_id} • ${sub.adresa_dorucenia || sub.adresa || ''}</small>
                </button>
            `;
        });
    }

    mc.innerHTML = `
        <div class="modal-backdrop" style="background:rgba(0,0,0,0.8);" onclick="closeModal('modal-container')"></div>
        <div class="modal-content" style="max-width:500px; width:95%;">
            <div class="modal-header">
                <h3>Vyberte prevádzku</h3>
            </div>
            <div style="padding:15px;">
                <p style="margin-bottom:15px;">Na ktorú prevádzku chcete vytvoriť objednávku?</p>
                ${buttonsHtml}
            </div>
        </div>
    `;
    mc.style.display = 'flex';
  }

  window.selectBranch = function(loginId, name, address) {
    const mc = document.getElementById('modal-container');
    mc.style.display = 'none';
    mc.innerHTML = '';

    appState.activeBranch = {
        loginId: loginId,
        name: name,
        address: address,
        internalId: null
    };

    if (loginId === appState.currentUser.zakaznik_id) {
        appState.activeBranch.internalId = appState.currentUser.id;
    } else {
        const sub = appState.currentUser.sub_accounts.find(x => x.zakaznik_id === loginId);
        appState.activeBranch.internalId = sub ? sub.id : null;
    }

    initializeCustomerPortal(appState.currentUser, loginId, name, address);
  };

  function initializeCustomerPortal(user, activeLoginId, activeName, activeAddress) {
    showMainView('customer');

    const nameEl = document.getElementById('customer-name');
    nameEl.innerHTML = `
        <div style="line-height:1.2;">
            ${activeName} 
            <span style="font-size:0.8em; opacity:0.8; font-weight:normal;">(${activeLoginId})</span>
        </div>
        ${(user.sub_accounts && user.sub_accounts.length > 0) 
            ? `<a href="#" onclick="location.reload()" style="font-size:0.75rem; color:#dbeafe; text-decoration:underline; display:block; margin-top:2px;">↻ Zmeniť prevádzku</a>` 
            : ''}
    `;

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

  window.handleLoginSuccess = handleLoginSuccess;
  
  window.submitOrder = async function() {
    const d = document.getElementById('delivery-date').value;
    if (!d) return showNotification('Zadajte požadovaný dátum dodania.', 'error');
    
    // Vyfiltrujeme len položky, ktoré majú zadané množstvo väčšie ako 0
    const items = Object.values(appState.order).filter(i => i.quantity > 0);
    if (!items.length) return showNotification('Nemáte v objednávke žiadne položky s vyplneným množstvom.', 'error');

    const targetId = (appState.activeBranch && appState.activeBranch.internalId) 
        ? appState.activeBranch.internalId 
        : appState.currentUser.id;

    const custName = (appState.activeBranch && appState.activeBranch.name)
        ? appState.activeBranch.name
        : appState.currentUser.nazov_firmy;

    const ccEmailsInput = document.getElementById('cc-emails');
    const ccEmails = ccEmailsInput ? ccEmailsInput.value : '';

    const out = await apiCall('/api/b2b/submit-order', {
      userId: appState.currentUser.id,
      targetCustomerId: targetId,
      customerName: custName,
      customerEmail: appState.currentUser.email,
      ccEmails: ccEmails,
      items: items, 
      deliveryDate: d,
      note: document.getElementById('order-note').value
    });

    if (!out) return;

    appState.order = {};
    document.querySelectorAll('.quantity-input').forEach(i => i.value = '');
    document.getElementById('order-note').value = '';
    document.getElementById('delivery-date').value = '';
    if (ccEmailsInput) ccEmailsInput.value = '';
    updateTotals();

    document.getElementById('products-container').innerHTML =
      `<h3>Ďakujeme!</h3>
       <p style="font-size:1.2rem;text-align:center;">Objednávka pre <strong>${custName}</strong> bola prijatá.</p>
       <p style="text-align:center;">${out.message}</p>
       <p style="text-align:center; font-size:0.9rem; color:#666;">Potvrdenie bolo odoslané na e-mail centrály${ccEmails ? ' a na zadané kópie.' : '.'}</p>`;

    setTimeout(() => {
      const sel = document.getElementById('pricelist-select');
      const stepProducts = document.getElementById('step-products');
      sel.value = '';
      stepProducts.classList.add('hidden');
      document.getElementById('products-container').innerHTML = '';
      document.getElementById('order-form-details').classList.add('hidden');
    }, 3000);
  };

  // =========================
  // PRODUKTY + OBJEDNÁVKA + POZNÁMKY
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
        
        const safeTitle = (p.nazov_vyrobku || '').replace(/"/g, '&quot;');
        const safeImg = (p.obrazok_url || '').replace(/"/g, '&quot;');
        const safeDesc = (p.info || p.popis || '').replace(/"/g, '&quot;');

        html += `<tr data-product-ean="${ean}">
          <td>
            ${p.nazov_vyrobku}
            <div style="margin-top: 4px;">
                <button type="button"
                   style="background:none; border:none; padding:0; color:#16a34a; font-size:0.8rem; text-decoration:underline; cursor:pointer;"
                   data-title="${safeTitle}"
                   data-img="${safeImg}"
                   data-desc="${safeDesc}"
                   onclick="window.openProductInfo(this.dataset.title, this.dataset.img, this.dataset.desc);">
                   Viac info
                </button>
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
                <button id="noteBtn_${ean}" class="item-note-button hidden" title="Pridať poznámku" style="border:none;background:none;cursor:pointer;font-size:1.1rem;">
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
    const input = e.target;
    const ean = input.dataset.ean;
    const v = (input.value || '').replace(',', '.');
    const q = parseFloat(v);
    
    if (!isNaN(q) && q > 0) {
      const p = findByEan(ean);
      const isPieceChecked = document.getElementById(`isPiece_${ean}`)?.checked;
      const finalUnit = isPieceChecked ? 'ks' : (p.mj || 'kg');

      // Ak objekt neexistuje, vytvoríme ho
      if (!appState.order[ean]) {
        appState.order[ean] = {
          ean,
          name: p.nazov_vyrobku,
          price: Number(p.cena || 0),
          dph: Math.abs(Number(p.dph || 0)),
          item_note: '',
          poznamka: ''
        };
      }
      
      // Aktualizujeme iba meniace sa dáta
      appState.order[ean].unit = finalUnit;
      appState.order[ean].quantity = q;

    } else {
      // Ak používateľ vymaže množstvo, nastavíme ho na 0
      if (appState.order[ean]) {
        appState.order[ean].quantity = 0;
        
        // Ak položka nemá ani poznámku, úplne ju vymažeme z pamäte
        const note = appState.order[ean].poznamka || appState.order[ean].item_note || '';
        if (note.trim() === '') {
          delete appState.order[ean];
        }
      }
    }
    updateTotals();
  }

  function togglePiece(chk) {
    const ean = chk.id.replace('isPiece_', '');
    const btn = document.getElementById(`noteBtn_${ean}`);
    
    if (chk.checked) {
      btn?.classList.remove('hidden');
      if (appState.order[ean]) {
        appState.order[ean].unit = 'ks';
      }
    } else {
      btn?.classList.add('hidden');
      if (appState.order[ean]) {
        const p = findByEan(ean);
        appState.order[ean].unit = p.mj || 'kg';
        appState.order[ean].item_note = '';
        appState.order[ean].poznamka = '';
        
        // Zrušenie zafarbenia ikonky po odškrtnutí
        if(btn) {
            btn.style.color = 'inherit';
            btn.style.transform = 'none';
        }
      }
    }
    updateTotals();
  }

  function openItemNoteModal(ean) {
    const p = findByEan(ean);
    const cur = appState.order[ean]?.poznamka || appState.order[ean]?.item_note || '';
    const mc = document.getElementById('modal-container');
    mc.innerHTML = `<div class="modal-backdrop" onclick="closeModal('modal-container')"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h4>Poznámka k položke: ${p?.nazov_vyrobku || ean}</h4>
          <button class="close-button" onclick="closeModal('modal-container')">&times;</button>
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
    
    if (!appState.order[ean]) {
      const p = findByEan(ean);
      const isPieceChecked = document.getElementById(`isPiece_${ean}`)?.checked;
      
      appState.order[ean] = {
        ean,
        name: p.nazov_vyrobku,
        price: Number(p.cena || 0),
        dph: Math.abs(Number(p.dph || 0)),
        unit: isPieceChecked ? 'ks' : (p.mj || 'kg'),
        quantity: 0
      };
    }
    
    appState.order[ean].item_note = note;
    appState.order[ean].poznamka = note;

    // Zvýraznenie tlačidla pre lepšie UX
    const btn = document.getElementById(`noteBtn_${ean}`);
    if (btn) {
        if (note.trim() !== '') {
            btn.style.color = '#b91c1c';
            btn.style.transform = 'scale(1.2)';
        } else {
            btn.style.color = 'inherit';
            btn.style.transform = 'none';
        }
    }
    
    closeModal('modal-container');
  };

  // UNIFIKOVANÁ FUNKCIA NA ZATVÁRANIE VŠETKÝCH MODALOV
  window.closeModal = function(modalId) {
      if (modalId) {
          const el = document.getElementById(modalId);
          if (el) {
              el.classList.remove('visible');
              el.style.display = 'none';
              if (modalId === 'modal-container') el.innerHTML = '';
          }
      } else {
          // Ak nepríde ID, zatvoríme oba
          const pm = document.getElementById('product-info-modal');
          if (pm) {
              pm.classList.remove('visible');
              pm.style.display = 'none';
          }
          const mc = document.getElementById('modal-container');
          if (mc) {
              mc.style.display = 'none';
              mc.innerHTML = '';
          }
      }
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

  // =========================
  // História objednávok
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
  // KOMUNIKÁCIA
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

    showMainView('auth');

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

    document.querySelectorAll('.tab-button[data-tab]')?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        document.getElementById('login-form-container').classList.toggle('hidden', tab !== 'login');
        document.getElementById('register-form-container').classList.toggle('hidden', tab !== 'register');
        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        if (tab === 'register') {
            generateCaptcha();
        }
      });
    });

    ensureHelpView();
    ensureHelpTab();
  })();
});

// =========================================================
// === ZATVÁRANIE OKIEN A OVERLAY===
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
    const closeButtons = document.querySelectorAll('.modal-close');
    closeButtons.forEach(btn => {
        btn.replaceWith(btn.cloneNode(true));
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const modal = this.closest('.modal-overlay');
            if (modal) {
                modal.classList.remove('visible');
                modal.style.display = 'none';
            }
        });
        btn.style.cursor = 'pointer'; 
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.classList.remove('visible');
                modal.style.display = 'none';
            }
        });
    });
});

// =========================================================
// === GLOBÁLNE FUNKCIE PRE MODÁLNE OKNO (INFO O PRODUKTE) ===
// =========================================================

window.openProductInfo = function(title, imgUrl, desc) {
  const m = document.getElementById('product-info-modal');
  if (!m) return;

  const titleEl = m.querySelector('#pim-title');
  const descEl  = m.querySelector('#pim-desc');
  const imgCont = m.querySelector('#pim-img-container');

  if (titleEl) titleEl.textContent = title;
  
  if (descEl) {
      descEl.textContent = desc || 'Zloženie a pôvod sú v súlade so súťažnými podkladmi.';
  }

  if (imgCont) {
    if (imgUrl && imgUrl !== 'undefined') {
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
};

// =========================================================
// === COOKIE CONSENT & ANALYTICS (B2B) ===
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
    initCookieBanner();
});

function initCookieBanner() {
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;

    const consent = localStorage.getItem('mik_cookie_consent');

    if (!consent) {
        banner.classList.remove('hidden');
    } else {
        if (consent === 'all') {
            enableAnalytics(); 
        }
    }

    document.getElementById('cookie-accept')?.addEventListener('click', () => {
        localStorage.setItem('mik_cookie_consent', 'all');
        banner.classList.add('hidden');
        enableAnalytics();
    });

    document.getElementById('cookie-reject')?.addEventListener('click', () => {
        localStorage.setItem('mik_cookie_consent', 'necessary');
        banner.classList.add('hidden');
    });
}

function enableAnalytics() {
    console.log('Spúšťam Google Analytics (GA4) pre B2B...');
    const GA_MEASUREMENT_ID = 'G-S399B7ZDCT'; 

    const script = document.createElement('script');
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    script.async = true;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);
}