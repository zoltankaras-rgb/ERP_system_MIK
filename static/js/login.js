// static/js/login.js
(() => {
  'use strict';

  const form = document.getElementById('login-form');
  const statusEl = document.getElementById('status');

  function setStatus(msg, isError = false) {
    if (window.showStatus) {
      window.showStatus(msg, isError);
      return;
    }

    if (statusEl) {
      statusEl.textContent = msg || '';
      statusEl.classList.remove('error', 'ok');
      statusEl.classList.add(isError ? 'error' : 'ok');
    } else if (msg) {
      alert(msg);
    }
  }

  if (!form) {
    console.warn('login.js: nenašiel sa <form id="login-form">');
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = (document.getElementById('username')?.value || '').trim();
    const password = (document.getElementById('password')?.value || '');

    if (!username || !password) {
      setStatus('Zadajte používateľské meno aj heslo.', true);
      return;
    }

    try {
      if (!window.apiRequest) {
        console.error('login.js: apiRequest() nie je dostupné');
        setStatus('Chýba klientská funkcia apiRequest().', true);
        return;
      }

      setStatus('Prihlasujem...');

      // NEPOSIELAME "module" – backend si vyberie podľa role
      const resp = await window.apiRequest('/api/internal/login', {
        method: 'POST',
        body: { username, password }
      });

      // 1) Backend vráti rovno redirect
      if (resp && resp.redirect) {
        window.location.href = resp.redirect;
        return;
      }

      // 2) Alebo vráti len user → redirect si spravíme sami podľa role
      if (resp && resp.user) {
        const role = (resp.user.role || '').toLowerCase();
        let target = '/';

        if (role === 'admin') {
          target = '/expedicia';               // prípadne zmeň napr. na '/kancelaria'
        } else if (role === 'kancelaria') {
          target = '/kancelaria';
        } else if (role === 'vyroba') {
          target = '/vyroba';
        } else if (role === 'veduci' || role === 'expedicia') {
          target = '/expedicia';
        }

        setStatus('Prihlásenie úspešné.');
        window.location.href = target;
        return;
      }

      const msg = (resp && (resp.error || resp.message)) || 'Prihlásenie zlyhalo.';
      setStatus(msg, true);
    } catch (err) {
      console.error('Prihlásenie zlyhalo:', err);
      setStatus('Prihlásenie zlyhalo: sieťová chyba.', true);
    }
  });
})();
