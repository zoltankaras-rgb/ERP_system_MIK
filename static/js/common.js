// ====================================================================================
// COMMON.JS v5 – tvrdý fix pre Kancelária (žiadne „samo‑odhlasovanie“)
// - potvrdenie session priamo v onUnauthorized() (aj keď ho vyvolá iný modul/skript)
// - normalizácia originu pre všetky /api/* (localhost vs 127.0.0.1)
// - X-Module header (kancelaria/expedicia/vyroba) pre zladenie s backendom
// - login fallback: na /kancelaria vyskúša 'kancelaria' -> 'office'
// - cudzie 401/403 nevyhadzujú overlay (len vrátia chybu volajúcemu)
// ====================================================================================

(() => {
  'use strict';

  // ------------------------------
  // Debug prepínač
  // ------------------------------
  const DEBUG = false;
  function dlog(...args) {
    if (DEBUG) console.log('[common.js]', ...args);
  }

  // ------------------------------
  // Jednoduchý escapeHtml (fallback)
  // ------------------------------
  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function (s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };
  }

  // ------------------------------
  // Globálny auth stav a throttling
  // ------------------------------
  window.__AUTH__ = Object.assign({
    locked: false,
    last401: 0,
    muteMs: 6000,
    csLastCheck: 0,          // cooldown pre check_session
    csCheckCooldownMs: 1000,
    onUnaInFlight: false     // bráni rekurzii onUnauthorized
  }, window.__AUTH__ || {});

  window.__LOGGED_IN__ = false; // nastavované v showApp()/showLogin()

  // ------------------------------
  // Modul / URL pomocníci
  // ------------------------------
  function getCurrentModule() {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.includes('/kancelaria'))      return 'kancelaria';
    if (p.includes('/leaderexpedicia')) return 'expedicia'; // leader je pod expedíciu
    if (p.includes('/expedicia'))       return 'expedicia';
    if (p.includes('/vyroba'))          return 'vyroba';
    return null;
  }

  function moduleOfUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      const path = (u.pathname || '').toLowerCase();
      if (path.startsWith('/api/kancelaria/'))      return 'kancelaria';
      if (path.startsWith('/api/expedicia/'))       return 'expedicia';
      if (path.startsWith('/api/leaderexpedicia/')) return 'expedicia';
      if (path.startsWith('/api/vyroba/'))          return 'vyroba';
      if (/^\/api\/(get|start|finish|submit|manual|weights|estimate)/.test(path)) return 'vyroba';
      if (path.startsWith('/api/internal/'))        return 'internal';
      return null;
    } catch {
      return null;
    }
  }

  /** 401 z cudzieho modulu vzhľadom na aktuálnu stránku? */
  function isForeignModuleCall(url) {
    const cur = getCurrentModule();
    const target = moduleOfUrl(url);
    if (!target || target === 'internal') return false;
    if (!cur) return false;
    return cur !== target;
  }

  /** Normalizuj /api/* URL na aktuálny origin (cookies!) */
  function normalizeApiUrl(inputUrl) {
    const u = new URL(inputUrl, window.location.origin);
    if (u.pathname.startsWith('/api/') && u.origin !== window.location.origin) {
      u.protocol = window.location.protocol;
      u.host = window.location.host;
    }
    return u.toString();
  }

  /** Vráť X-Module podľa cieľovej URL (alebo podľa stránky) */
  function moduleHeaderFor(url) {
    const target = moduleOfUrl(url);
    return target || getCurrentModule() || 'expedicia';
  }

  // ------------------------------
  // check_session s cooldownom
  // ------------------------------
  async function confirmSessionStillValid() {
    const now = Date.now();
    if (now - window.__AUTH__.csLastCheck < window.__AUTH__.csCheckCooldownMs) {
      dlog('check_session skipped due to cooldown');
      return { ok: true, loggedIn: window.__LOGGED_IN__, skipped: true };
    }
    window.__AUTH__.csLastCheck = now;

    try {
      const res = await fetch('/api/internal/check_session', { credentials: 'same-origin' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      let data = null;
      try { data = ct.includes('application/json') ? await res.json() : null; } catch {}
      if (res.ok && data && data.loggedIn) {
        dlog('check_session: still logged in');
        return { ok: true, loggedIn: true, data };
      }
      dlog('check_session: not logged in');
      return { ok: true, loggedIn: false, data };
    } catch (e) {
      dlog('check_session failed:', e);
      return { ok: false, loggedIn: true, error: e };
    }
  }

  // ------------------------------
  // Fetch wrapper
  // ------------------------------
  window.apiRequest = async function apiRequest(url, options = {}) {
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options);
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    const finalUrl = normalizeApiUrl(url);
    // pridaj X-Module header (pomôže backendu spojiť session a modul)
    const xm = moduleHeaderFor(finalUrl);
    if (!opts.headers['X-Module']) opts.headers['X-Module'] = xm;

    let response;
    try {
      response = await fetch(finalUrl, opts);
    } catch (err) {
      console.error('[apiRequest] Network error:', err);
      return { error: 'Network error', detail: String(err) };
    }

    const ct = (response.headers.get('content-type') || '').toLowerCase();
    let payload = null;
    try { payload = ct.includes('application/json') ? await response.json() : await response.text(); }
    catch { payload = null; }

    if (response.status === 401 || response.status === 403) {
      const status = response.status;
      const foreign = isForeignModuleCall(finalUrl);

      if (foreign) {
        // volanie do iného modulu – neotváraj overlay, len vráť chybu volajúcemu
        dlog('foreign-module 401/403:', finalUrl);
        return { error: status === 403 ? 'Forbidden' : 'Unauthorized', status, raw: payload };
      }

      // nie sme foreign → skontroluj, či session naozaj padla
      if (window.__LOGGED_IN__) {
        const result = await confirmSessionStillValid();
        if (!result.ok || result.loggedIn) {
          // sieťová chyba alebo stále prihlásený → neukazuj overlay
          return { error: status === 403 ? 'Forbidden' : 'Unauthorized', status, raw: payload };
        }
      }

      // Skutočne odhlásený → spusti bezpečné onUnauthorized
      await safeOnUnauthorized();
      return { error: status === 403 ? 'Forbidden' : 'Unauthorized', status, raw: payload };
    }

    if (!response.ok) {
      const msg = (payload && (payload.error || payload.message)) || response.statusText || `HTTP ${response.status}`;
      return { error: msg, status: response.status, raw: payload };
    }

    if (payload && typeof payload === 'object' && payload.redirect) {
      window.location.replace(payload.redirect);
      return;
    }

    return payload;
  };

  // alias
  async function apiRequest(url, options = {}) { return window.apiRequest(url, options); }

  // ------------------------------
  // Login, Logout, Session kontrola
  // ------------------------------
  function moduleCandidatesForCurrentPath() {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.includes('/kancelaria'))      return ['kancelaria', 'office']; // fallback alias
    if (p.includes('/leaderexpedicia')) return ['expedicia'];
    if (p.includes('/expedicia'))       return ['expedicia'];
    if (p.includes('/vyroba'))          return ['vyroba'];
    return ['expedicia'];
  }

  async function tryLoginSequence(username, password, candidates) {
    for (const m of candidates) {
      dlog('login attempt with module:', m);
      const resp = await apiRequest('/api/internal/login', {
        method: 'POST',
        headers: { 'X-Module': m }, // zosúladenie headra
        body: { username, password, module: m }
      });
      if (resp && resp.user) return resp;
      if (resp && resp.redirect) return resp;
      if (resp && resp.error && (resp.status === 401 || resp.status === 403)) continue;
      if (resp && resp.error) return resp;
    }
    return { error: 'Prihlásenie zlyhalo pre všetky moduly', status: 401 };
  }

  async function handleLogin(event) {
    event.preventDefault();
    const username = (document.getElementById('username')?.value || '').trim();
    const password = (document.getElementById('password')?.value || '');
    const candidates = moduleCandidatesForCurrentPath();

    try {
      const login = await tryLoginSequence(username, password, candidates);
      if (login && login.redirect) return; // redirect sa už vykoná

      if (login && login.user) {
        showApp(login.user);
        showStatus('Prihlásenie úspešné.');
        return;
      }
      const msg = (login && (login.error || login.message)) || 'Prihlásenie zlyhalo.';
      showStatus(msg, true);
    } catch (e) {
      console.error('Prihlásenie zlyhalo:', e);
      showStatus('Prihlásenie zlyhalo: sieťová chyba.', true);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/internal/logout', { method: 'POST' });
    } catch {}
    showLogin();
  }

  // ------------------------------
  // UI prepínanie
  // ------------------------------
  function showLogin() {
    window.__LOGGED_IN__ = false;
    const lw = document.getElementById('login-wrapper');
    const ac = document.getElementById('app-container');
    if (lw) lw.classList.remove('hidden');
    if (ac) ac.classList.add('hidden');
  }

  function showApp(user) {
    window.__LOGGED_IN__ = true;
    const role = String(user?.role || '').toLowerCase();
    const path = (window.location.pathname || '').toLowerCase();

    let requiredRole = null;
    let initFn = null;

    if (path.includes('/vyroba')) {
      requiredRole = 'vyroba';
      initFn = window.loadAndShowProductionMenu;

    } else if (path.includes('/leaderexpedicia')) {
      const lw = document.getElementById('login-wrapper');
      const ac = document.getElementById('app-container');
      if (lw) lw.classList.add('hidden');
      if (ac) ac.classList.remove('hidden');
      return;

    } else if (path.includes('/expedicia')) {
      if (role === 'veduci') { window.location.replace('/leaderexpedicia'); return; }
      requiredRole = 'expedicia';
      initFn = window.loadAndShowExpeditionMenu;

    } else if (path.includes('/kancelaria')) {
      requiredRole = 'kancelaria';
      initFn = window.loadAndShowOfficeMenu;
    }

    if (requiredRole && (role === requiredRole || role === 'admin')) {
      const lw = document.getElementById('login-wrapper');
      const ac = document.getElementById('app-container');
      if (lw) lw.classList.add('hidden');
      if (ac) ac.classList.remove('hidden');

      const userInfo = document.getElementById('user-info');
      if (userInfo) userInfo.textContent = `Vitajte, ${user.full_name || user.username} (${role})`;

      if (typeof initFn === 'function') {
        try { initFn(); } catch (e) { console.error('Init modulu zlyhal:', e); }
      }
    } else if (requiredRole) {
      showStatus(`Nemáte oprávnenie pre modul '${requiredRole}'. Vaša rola je '${role || 'neznáma'}'.`, true);
    } else {
      const lw = document.getElementById('login-wrapper');
      const ac = document.getElementById('app-container');
      if (lw) lw.classList.add('hidden');
      if (ac) ac.classList.remove('hidden');
    }
  }

  // ------------------------------
  // Status "toast"
  // ------------------------------
  let statusTimeout;
  function showStatus(message, isError = false) {
    let el = document.getElementById('status-notification');
    if (!el) {
      el = document.createElement('div');
      el.id = 'status-notification';
      document.body.appendChild(el);
      Object.assign(el.style, {
        position: 'fixed', bottom: '-60px', left: '50%', transform: 'translateX(-50%)',
        padding: '10px 16px', background: '#333', color: '#fff', borderRadius: '4px',
        transition: 'bottom .3s ease', zIndex: 99999, maxWidth: '90vw'
      });
    }
    el.style.background = isError ? '#B00020' : '#2E7D32';
    el.innerHTML = window.escapeHtml(String(message || ''));
    el.style.bottom = '16px';
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => { el.style.bottom = '-60px'; }, 3000);
  }
  window.showStatus = showStatus;

  // ------------------------------
  // onUnauthorized – bezpečne (s kontrolou session)
  // ------------------------------
  async function safeOnUnauthorized() {
    if (window.__AUTH__.onUnaInFlight) return;
    window.__AUTH__.onUnaInFlight = true;
    try {
      const result = await confirmSessionStillValid();
      if (result.ok && result.loggedIn) {
        // Stále prihlásený – nič neprepínaj, len vráť volajúcemu chybu
        dlog('safeOnUnauthorized: still logged in, suppressing overlay');
        return;
      }

      const now = Date.now();
      if (now - window.__AUTH__.last401 >= window.__AUTH__.muteMs && !window.__AUTH__.locked) {
        window.__AUTH__.last401 = now;
        window.__AUTH__.locked = true;
        try {
          const lw = document.getElementById('login-wrapper');
          const ac = document.getElementById('app-container');
          if (lw && lw.classList) lw.classList.remove('hidden');
          if (ac && ac.classList) ac.classList.add('hidden');
          showStatus('Vaša session vypršala. Prosím, prihláste sa znova.', true);
          window.__LOGGED_IN__ = false;
        } catch {}
        setTimeout(() => { window.__AUTH__.locked = false; }, window.__AUTH__.muteMs);
      }
    } finally {
      window.__AUTH__.onUnaInFlight = false;
    }
  }

  // Export – ak ľubovoľný kancelársky skript volá window.onUnauthorized(), pôjde cez náš confirm
  window.onUnauthorized = safeOnUnauthorized;

  // ------------------------------
  // Boot
  // ------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    checkUserSession();

    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) logoutButton.addEventListener('click', handleLogout);
  });

  // ------------------------------
  // Kontrola session
  // ------------------------------
  async function checkUserSession() {
    try {
      const data = await apiRequest('/api/internal/check_session');
      if (data && data.loggedIn && data.user) {
        showApp(data.user);
      } else {
        showLogin();
      }
    } catch (e) {
      console.warn('checkUserSession error:', e);
      showLogin();
    }
  }

  // ------------------------------
  // Pomocný layout – ak chýbajú wrappery, doplň ich
  // ------------------------------
  (function ensureWrappersExist() {
    function ensure(){
      const lw = document.getElementById('login-wrapper');
      const ac = document.getElementById('app-container');

      if (!lw) {
        const div = document.createElement('div');
        div.id = 'login-wrapper';
        div.className = 'hidden';
        div.innerHTML = `
          <form id="login-form" class="login-form">
            <h2>Prihlásenie</h2>
            <div><label>Meno</label><input id="username" type="text" autocomplete="username"></div>
            <div><label>Heslo</label><input id="password" type="password" autocomplete="current-password"></div>
            <button type="submit">Prihlásiť</button>
          </form>`;
        document.body.appendChild(div);
      }
      if (!ac) {
        const div = document.createElement('div');
        div.id = 'app-container';
        div.innerHTML = `
          <header class="app-header">
            <div id="user-info"></div>
            <button id="logout-button" type="button">Odhlásiť</button>
          </header>
          <main id="app-main"></main>`;
        document.body.appendChild(div);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', function onrs() {
        if (document.readyState === 'interactive') ensure();
      });
    } else {
      ensure();
    }
  })();
})();
