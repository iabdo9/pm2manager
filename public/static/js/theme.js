/*
 * theme.js — light/dark theme manager.
 *
 * Loaded in <head> WITHOUT `defer` so it runs before first paint and sets the
 * initial theme (avoiding a flash). The chosen theme is stored in
 * localStorage; on first visit the OS preference is used. Any element with a
 * `data-theme-toggle` attribute becomes a toggle button. A `themechange`
 * CustomEvent is dispatched on `document` whenever the theme changes so other
 * scripts (e.g. charts) can react.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'pm2m-theme';
  var root = document.documentElement;

  function systemPref() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function stored() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function apply(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {
        /* storage unavailable — theme still applies for this session */
      }
    }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  // Apply the initial theme immediately (runs during <head> parse).
  apply(stored() || systemPref(), false);

  function toggle() {
    apply(current() === 'dark' ? 'light' : 'dark', true);
  }

  window.PM2Theme = {
    get: current,
    set: function (t) {
      apply(t === 'dark' ? 'dark' : 'light', true);
    },
    toggle: toggle,
  };

  // Wire up toggle buttons once the DOM is ready.
  function wire() {
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', toggle);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
