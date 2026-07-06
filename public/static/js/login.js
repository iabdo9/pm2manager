/*
 * login.js — drives the login + two-factor flow on /login.
 *
 * Self-contained (does not use window.api) so a 401 for bad credentials is
 * shown inline rather than triggering the app's redirect-on-401 behaviour.
 * A fresh CSRF token is fetched before each POST.
 */
(function () {
  'use strict';

  var loginForm = document.getElementById('login-form');
  var twofaForm = document.getElementById('twofa-form');
  var twofaBack = document.getElementById('twofa-back');
  var errorBox = document.getElementById('login-error');
  var errorText = document.getElementById('login-error-text');
  var loginSubmit = document.getElementById('login-submit');
  var twofaSubmit = document.getElementById('twofa-submit');
  var codeInput = document.getElementById('twofa-code');

  function showError(message) {
    errorText.textContent = message;
    errorBox.classList.remove('hidden');
  }
  function clearError() {
    errorText.textContent = '';
    errorBox.classList.add('hidden');
  }

  async function fetchCsrfToken() {
    var res = await fetch('/api/auth/csrf-token', { credentials: 'same-origin' });
    var payload = await res.json();
    if (!payload || !payload.ok) throw new Error('Could not initialise session.');
    return payload.data.csrfToken;
  }

  async function postJson(path, body) {
    var token = await fetchCsrfToken();
    var res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(body)
    });
    var payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    if (payload && payload.ok === true) return payload.data;
    throw new Error(payload && payload.error ? payload.error.message : 'Request failed');
  }

  function setBusy(button, busy) {
    if (busy) { button.classList.add('is-loading'); button.disabled = true; }
    else { button.classList.remove('is-loading'); button.disabled = false; }
  }

  function revealTwoFactor() {
    loginForm.classList.add('hidden');
    twofaForm.classList.remove('hidden');
    clearError();
    codeInput.value = '';
    codeInput.focus();
  }

  loginForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    clearError();
    setBusy(loginSubmit, true);
    try {
      var data = await postJson('/api/auth/login', {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      });
      if (data && data.twoFactorRequired) revealTwoFactor();
      else window.location = '/';
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(loginSubmit, false);
    }
  });

  twofaForm.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    clearError();
    setBusy(twofaSubmit, true);
    try {
      await postJson('/api/auth/2fa', { token: codeInput.value.trim() });
      window.location = '/';
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(twofaSubmit, false);
    }
  });

  twofaBack.addEventListener('click', function () {
    twofaForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    clearError();
    document.getElementById('password').value = '';
    document.getElementById('username').focus();
  });

  // Warm the CSRF token / session cookie as soon as the page loads.
  fetchCsrfToken().catch(function () { /* surfaced on first submit if it truly failed */ });
})();
