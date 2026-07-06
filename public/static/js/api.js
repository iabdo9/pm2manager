/*
 * api.js — tiny fetch-based API client for the PM2 Manager frontend.
 *
 * Exposes `window.api` with get/post/put/del helpers that:
 *   - always send credentials (session cookie) for same-origin requests,
 *   - attach an X-CSRF-Token header to every mutating request,
 *   - unwrap the { ok:true, data } / { ok:false, error } envelope,
 *   - throw an Error carrying `.code` / `.details` on failure,
 *   - redirect to /login on any 401.
 * Also exposes logout() and streamLogs() (Server-Sent Events).
 */
(function () {
  'use strict';

  // Cached CSRF token — fetched lazily, refreshed if it goes stale (403).
  var csrfToken = null;

  /** Build an Error from an API error envelope (or a fallback message). */
  function makeError(payload, fallbackMessage) {
    var message = fallbackMessage || 'Request failed';
    var code = 'ERROR';
    var details;
    if (payload && payload.error) {
      message = payload.error.message || message;
      code = payload.error.code || code;
      details = payload.error.details;
    }
    var err = new Error(message);
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
  }

  /**
   * Core request routine.
   * @param {string} method  HTTP verb.
   * @param {string} path    Absolute API path.
   * @param {*} [body]       JSON body for mutations.
   * @param {boolean} [retried] Internal: whether this is a post-CSRF retry.
   */
  async function request(method, path, body, retried) {
    var isMutation = method !== 'GET' && method !== 'HEAD';
    var opts = { method: method, credentials: 'same-origin', headers: {} };

    if (isMutation) {
      opts.headers['X-CSRF-Token'] = await getCsrfToken();
    }
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }

    var res;
    try {
      res = await fetch(path, opts);
    } catch (networkErr) {
      var netError = new Error('Network error — could not reach the server.');
      netError.code = 'NETWORK_ERROR';
      throw netError;
    }

    if (res.status === 401) {
      window.location = '/login';
      throw makeError(null, 'Session expired — please sign in again.');
    }

    var payload = null;
    try {
      payload = await res.json();
    } catch (parseErr) {
      payload = null;
    }

    if (payload && payload.ok === true) {
      return payload.data;
    }

    // A stale CSRF token typically surfaces as a 403 — refresh once and retry.
    if (res.status === 403 && isMutation && !retried) {
      csrfToken = null;
      return request(method, path, body, true);
    }

    throw makeError(payload, res.statusText || 'Request failed');
  }

  /** Fetch (and cache) the CSRF token used for mutating requests. */
  async function getCsrfToken() {
    if (csrfToken) return csrfToken;
    var data = await request('GET', '/api/auth/csrf-token');
    csrfToken = data && data.csrfToken;
    return csrfToken;
  }

  function get(path) {
    return request('GET', path);
  }
  function post(path, body) {
    return request('POST', path, body === undefined ? {} : body);
  }
  function put(path, body) {
    return request('PUT', path, body === undefined ? {} : body);
  }
  function del(path) {
    return request('DELETE', path);
  }

  /** Log the current user out and return to the login page. */
  async function logout() {
    try {
      await post('/api/auth/logout', {});
    } catch (err) {
      /* ignore — we redirect regardless */
    }
    csrfToken = null;
    window.location = '/login';
  }

  /**
   * Open an SSE log stream for a process.
   * @param {string|number} idOrName  Process id or name.
   * @param {(line:object)=>void} onLine   Called for each parsed log line.
   * @param {()=>void} [onReady]            Called once the stream opens.
   * @returns {EventSource} so the caller can `.close()` it.
   */
  function streamLogs(idOrName, onLine, onReady) {
    var url = '/api/processes/' + encodeURIComponent(idOrName) + '/logs/stream';
    var es = new EventSource(url, { withCredentials: true });

    function handle(raw) {
      if (typeof onLine !== 'function') return;
      var line;
      try {
        line = JSON.parse(raw);
      } catch (e) {
        line = { channel: 'out', message: String(raw), timestamp: Date.now() };
      }
      onLine(line);
    }

    es.addEventListener('open', function () {
      if (typeof onReady === 'function') onReady();
    });
    // The server may emit named `log` events or plain `message` events.
    es.addEventListener('log', function (ev) {
      handle(ev.data);
    });
    es.onmessage = function (ev) {
      handle(ev.data);
    };

    return es;
  }

  window.api = {
    getCsrfToken: getCsrfToken,
    get: get,
    post: post,
    put: put,
    del: del,
    logout: logout,
    streamLogs: streamLogs
  };
})();
