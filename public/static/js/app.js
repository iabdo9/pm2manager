/*
 * app.js — controller for the PM2 Manager application shell.
 *
 * Talks to the REST API via window.api (api.js) and renders charts via
 * window.drawLineChart (chart.js). Theme switching is handled by theme.js;
 * this module only redraws charts on the `themechange` event.
 *
 * All values coming from the API (process names, env values, log lines,
 * activity messages, usernames) are inserted with textContent — never innerHTML
 * — so untrusted data cannot inject markup.
 */
(function () {
  'use strict';

  var api = window.api;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- state -------------------------------------------------------------
  var currentUser = null;
  var isAdmin = false;
  var currentView = null;
  var pollTimer = null;

  var processes = [];
  var procLoaded = false;
  var procSort = { key: 'name', dir: 'asc' };
  var procFilter = { search: '', status: 'all' };

  var logStream = null;
  var logLines = 0;

  var activityOffset = 0;
  var activityType = '';
  var lastHistory = [];
  var daemonVersion = null; // last known PM2 version, kept across views
  var lastFocus = null;     // element to restore focus to when drawer/modal close

  var VIEW_TITLES = {
    dashboard: 'Dashboard', processes: 'Processes',
    logs: 'Logs', activity: 'Activity', settings: 'Settings'
  };
  var ACTIVITY_TYPES = [
    'login_success', 'login_failed', 'logout', 'twofa_enabled', 'twofa_disabled',
    'password_changed', 'user_created', 'user_deleted', 'settings_changed',
    'process_start', 'process_stop', 'process_restart', 'process_reload',
    'process_delete', 'process_start_all', 'process_stop_all',
    'process_restart_all', 'process_reload_all', 'process_event'
  ];

  // ---- tiny DOM helpers --------------------------------------------------
  function byId(id) { return document.getElementById(id); }
  function qs(s, r) { return (r || document).querySelector(s); }
  function qsa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      }
    }
    if (kids != null) {
      if (!Array.isArray(kids)) kids = [kids];
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c == null) continue;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return n;
  }

  function icon(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function enc(v) { return encodeURIComponent(String(v)); }

  // ---- formatting --------------------------------------------------------
  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
  }
  function fmtUptime(ms) {
    if (!ms || ms <= 0) return '—';
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s %= 86400;
    var h = Math.floor(s / 3600); s %= 3600;
    var m = Math.floor(s / 60); s %= 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }
  function fmtPct(v) { return (v == null || isNaN(v) ? 0 : v).toFixed(1) + '%'; }
  function fmtDate(v) {
    if (v == null) return '—';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
  function timeAgo(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function typeLabel(t) { return String(t || '').replace(/_/g, ' '); }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }

  // ---- toasts ------------------------------------------------------------
  function toast(message, type) {
    type = type || 'info';
    var ico = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
    var node = el('div', { class: 'toast ' + type }, [
      icon(ico),
      el('span', { class: 'msg', text: message }),
      el('button', { class: 'close', 'aria-label': 'Dismiss', onclick: function () { remove(); } }, [icon('close')])
    ]);
    byId('toasts').appendChild(node);
    var timer = setTimeout(remove, 4200);
    function remove() { clearTimeout(timer); if (node.parentNode) node.parentNode.removeChild(node); }
  }
  function reportError(err) { toast((err && err.message) || 'Something went wrong', 'error'); }

  // ---- buttons -----------------------------------------------------------
  function setLoading(btn, on) {
    if (!btn) return;
    if (on) { btn.classList.add('is-loading'); btn.disabled = true; }
    else { btn.classList.remove('is-loading'); btn.disabled = false; }
  }

  // ---- confirm modal -----------------------------------------------------
  var modalResolve = null;
  var modalPrevFocus = null;
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      modalResolve = resolve;
      modalPrevFocus = document.activeElement;
      byId('modal-title').textContent = opts.title || 'Confirm';
      var body = byId('modal-body'); clear(body);
      body.appendChild(opts.bodyNode || document.createTextNode(opts.body || ''));
      var cb = byId('modal-confirm');
      cb.textContent = opts.confirmLabel || 'Confirm';
      cb.className = 'btn ' + (opts.variant === 'danger' ? 'danger' : 'primary');
      byId('modal-icon').className = 'modal-icon ' + (opts.variant === 'danger' ? 'danger' : 'warn');
      byId('modal-overlay').classList.add('open');
      cb.focus();
    });
  }
  function closeModal(result) {
    byId('modal-overlay').classList.remove('open');
    if (modalResolve) { var r = modalResolve; modalResolve = null; r(result); }
    if (modalPrevFocus && modalPrevFocus.focus) { modalPrevFocus.focus(); modalPrevFocus = null; }
  }

  // ---- dropdown menus ----------------------------------------------------
  function closeMenus() { qsa('.menu.open').forEach(function (m) { m.classList.remove('open'); }); }

  // ---- status helpers ----------------------------------------------------
  function statusClass(status) {
    if (status === 'online') return 'online';
    if (status === 'errored') return 'errored';
    if (status === 'launching' || status === 'stopping' || status === 'one-launch-status') return 'launching';
    return 'stopped';
  }
  function statusPill(status) {
    return el('span', { class: 'status ' + statusClass(status) }, [el('span', { class: 'dot' }), status || 'unknown']);
  }

  // ---- daemon pill -------------------------------------------------------
  function updateDaemon(connected, version, count) {
    if (version != null) daemonVersion = version;
    var v = version != null ? version : daemonVersion;
    var pill = byId('daemon-status');
    var label = qs('.label-text', pill);
    if (connected) {
      pill.className = 'daemon-pill online';
      label.textContent = (v ? 'PM2 v' + v : 'PM2') + ' · ' + count;
    } else {
      pill.className = 'daemon-pill offline';
      label.textContent = 'PM2 offline';
    }
  }

  // ======================================================================
  // Dashboard
  // ======================================================================
  function loadDashboard() {
    return api.get('/api/dashboard').then(function (d) {
      renderKpis(d);
      renderSystem(d.system);
      renderFeed('dash-restarts', d.recentRestarts);
      renderFeed('dash-activity', d.recentActivity);
      updateDaemon(d.daemon && d.daemon.connected, d.daemon && d.daemon.version, d.totalProcesses);
      byId('dash-sub').textContent = d.system ? d.system.hostname : '';

      var errBox = byId('dash-error'); clear(errBox);
      if (!(d.daemon && d.daemon.connected)) {
        errBox.appendChild(el('div', { class: 'error-banner' }, [
          icon('alert'),
          el('span', { class: 'spacer', text: 'The PM2 daemon is not reachable. Process data is unavailable until it is running.' })
        ]));
      }
      return api.get('/api/history?range=6h').then(function (h) {
        lastHistory = (h && h.points) || [];
        redrawCharts();
      }).catch(function () { lastHistory = []; redrawCharts(); });
    });
  }

  function kpiTile(label, value, unit, iconName, variant) {
    return el('div', { class: 'kpi' + (variant ? ' ' + variant : '') }, [
      el('div', { class: 'kpi-top' }, [
        el('span', { class: 'kpi-label', text: label }),
        el('span', { class: 'kpi-ico' }, [icon(iconName)])
      ]),
      el('div', { class: 'kpi-value' }, [String(value), unit ? el('span', { class: 'unit', text: unit }) : null])
    ]);
  }
  function renderKpis(d) {
    var wrap = byId('dash-kpis'); clear(wrap);
    wrap.appendChild(kpiTile('Online', d.onlineProcesses, '', 'check', 'ok'));
    wrap.appendChild(kpiTile('Stopped', d.stoppedProcesses, '', 'stop'));
    wrap.appendChild(kpiTile('Errored', d.erroredProcesses, '', 'alert', d.erroredProcesses > 0 ? 'danger' : ''));
    wrap.appendChild(kpiTile('CPU', (d.totalCpu || 0).toFixed(1), '%', 'cpu', 'accent'));
    wrap.appendChild(kpiTile('Memory', fmtBytes(d.totalMemory), '', 'mem'));
    wrap.appendChild(kpiTile('Restarts', d.totalRestarts || 0, '', 'restart'));
  }
  function renderSystem(sys) {
    var dl = byId('dash-system'); clear(dl);
    if (!sys) return;
    var load = Array.isArray(sys.loadAverage) ? sys.loadAverage.map(function (n) { return Number(n).toFixed(2); }).join('  ') : '—';
    var rows = [
      ['Hostname', sys.hostname],
      ['Platform', sys.platform + ' ' + sys.release],
      ['Architecture', sys.arch],
      ['CPU', sys.cpuModel + '  ×' + sys.cpuCount],
      ['Memory', fmtBytes(sys.totalMemory - sys.freeMemory) + ' / ' + fmtBytes(sys.totalMemory)],
      ['Load average', load],
      ['System uptime', fmtUptime(sys.uptime * 1000)],
      ['App uptime', fmtUptime(sys.appUptime * 1000)],
      ['Node.js', sys.nodeVersion]
    ];
    rows.forEach(function (r) {
      dl.appendChild(el('dt', { text: r[0] }));
      dl.appendChild(el('dd', { text: r[1] == null ? '—' : String(r[1]) }));
    });
  }
  function renderFeed(id, records) {
    var ul = byId(id); clear(ul);
    if (!records || !records.length) {
      ul.appendChild(el('li', { class: 'feed-empty', text: 'Nothing recent.' }));
      return;
    }
    records.forEach(function (r) {
      ul.appendChild(el('li', { class: 'feed-item' }, [
        activityPill(r.type),
        el('span', { class: 'feed-msg', text: r.message }),
        el('span', { class: 'feed-time', text: timeAgo(r.created_at) })
      ]));
    });
  }

  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    return {
      accent: cs.getPropertyValue('--accent').trim(),
      accent2: cs.getPropertyValue('--accent-2').trim(),
      fill: cs.getPropertyValue('--chart-fill').trim(),
      fill2: cs.getPropertyValue('--chart-fill-2').trim(),
      grid: cs.getPropertyValue('--chart-grid').trim(),
      axis: cs.getPropertyValue('--chart-axis').trim(),
      text: cs.getPropertyValue('--chart-text').trim()
    };
  }
  function redrawCharts() {
    if (!window.drawLineChart) return;
    var c = themeColors();
    var pts = lastHistory || [];
    window.drawLineChart(byId('chart-cpu'), pts.map(function (p) { return { x: p.timestamp, y: p.cpu }; }),
      { color: c.accent, fill: c.fill, grid: c.grid, axis: c.axis, text: c.text, yFormat: function (v) { return Math.round(v) + '%'; } });
    window.drawLineChart(byId('chart-mem'), pts.map(function (p) { return { x: p.timestamp, y: p.memory / 1048576 }; }),
      { color: c.accent2, fill: c.fill2, grid: c.grid, axis: c.axis, text: c.text, yFormat: function (v) { return Math.round(v) + ' MB'; } });
  }

  // ======================================================================
  // Processes
  // ======================================================================
  function loadProcesses() {
    if (!procLoaded) showTableLoading();
    return api.get('/api/processes').then(function (data) {
      processes = data.processes || [];
      procLoaded = true;
      updateDaemon(true, null, processes.length);
      renderProcesses();
    });
  }
  function showTableLoading() {
    var tb = byId('process-tbody'); clear(tb);
    tb.appendChild(el('tr', {}, [el('td', { colspan: '7' }, [
      el('div', { class: 'loading-row' }, [el('span', { class: 'spinner' }), 'Loading processes…'])
    ])]));
  }

  function sortedFiltered() {
    var s = procFilter.search.toLowerCase();
    var list = processes.filter(function (p) {
      if (procFilter.status !== 'all' && statusClass(p.status) !== procFilter.status) return false;
      if (s && p.name.toLowerCase().indexOf(s) === -1) return false;
      return true;
    });
    var key = procSort.key, dir = procSort.dir === 'asc' ? 1 : -1;
    list.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'name' || key === 'status') { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); return av < bv ? -dir : av > bv ? dir : 0; }
      return ((av || 0) - (bv || 0)) * dir;
    });
    return list;
  }

  function meter(pct, kind) {
    var c = 'meter-fill' + (kind === 'mem' ? ' mem' : '') + (pct >= 90 ? ' crit' : pct >= 70 ? ' high' : '');
    var fill = el('span', { class: c });
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    return el('span', { class: 'meter' }, [fill]);
  }

  function actionBtn(iconName, tip, cls, handler) {
    return el('button', { type: 'button', class: 'icon-btn' + (cls ? ' ' + cls : ''), 'data-tip': tip, 'aria-label': tip, onclick: handler }, [icon(iconName)]);
  }

  function renderProcesses() {
    var tb = byId('process-tbody');
    var list = sortedFiltered();
    byId('proc-count').textContent = processes.length
      ? (list.length === processes.length ? processes.length + ' total' : list.length + ' of ' + processes.length)
      : '';

    // reflect sort state on headers
    qsa('#process-table th.sortable').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.getAttribute('data-sort') === procSort.key) th.classList.add(procSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    });

    clear(tb);
    if (!list.length) {
      tb.appendChild(el('tr', {}, [el('td', { colspan: '7' }, [emptyState(
        processes.length ? 'No matching processes' : 'No processes',
        processes.length ? 'Try a different filter or search term.' : 'Start an app with PM2 and it will appear here.'
      )])]));
      return;
    }

    var maxMem = list.reduce(function (m, p) { return Math.max(m, p.memory || 0); }, 1);
    list.forEach(function (p) { tb.appendChild(procRow(p, maxMem)); });
  }

  function procRow(p, maxMem) {
    var online = p.status === 'online';

    var nameCell = el('td', { 'data-label': 'Process' }, [
      el('div', { class: 'proc-name' }, [
        el('span', { class: 'name' }, [el('button', { type: 'button', text: p.name, onclick: function () { openDetail(p.pmId); } })]),
        el('span', { class: 'meta', text: '#' + p.pmId + ' · ' + p.execMode + (p.instances > 1 ? ' · ' + p.instances + '×' : '') })
      ])
    ]);

    var cpuCell = el('td', { class: 'col-num', 'data-label': 'CPU' }, [
      el('div', { class: 'metric' }, [el('span', { class: 'val', text: fmtPct(p.cpu) }), meter(p.cpu || 0, 'cpu')])
    ]);
    var memCell = el('td', { class: 'col-num', 'data-label': 'Memory' }, [
      el('div', { class: 'metric' }, [el('span', { class: 'val', text: fmtBytes(p.memory) }), meter(((p.memory || 0) / maxMem) * 100, 'mem')])
    ]);

    var toggle = online
      ? actionBtn('stop', 'Stop', '', function (e) { procAction(p, 'stop', e.currentTarget); })
      : actionBtn('play', 'Start', '', function (e) { procAction(p, 'start', e.currentTarget); });

    var menu = el('div', { class: 'menu' }, [
      el('button', { type: 'button', class: 'icon-btn js-menu-trigger', 'data-tip': 'More', 'aria-label': 'More actions' }, [icon('more')]),
      el('div', { class: 'menu-list' }, [
        el('button', { type: 'button', class: 'menu-item', onclick: function () { closeMenus(); procAction(p, 'reload', null); } }, [icon('reload'), 'Reload']),
        el('button', { type: 'button', class: 'menu-item', onclick: function () { closeMenus(); openLogsFor(p.pmId, p.name); } }, [icon('terminal'), 'View logs']),
        el('button', { type: 'button', class: 'menu-item', onclick: function () { closeMenus(); openDetail(p.pmId); } }, [icon('info'), 'Details']),
        el('div', { class: 'menu-sep' }),
        el('button', { type: 'button', class: 'menu-item danger', onclick: function () { closeMenus(); deleteProcess(p); } }, [icon('trash'), 'Delete'])
      ])
    ]);

    return el('tr', {}, [
      el('td', { 'data-label': 'Status' }, [statusPill(p.status)]),
      nameCell,
      cpuCell,
      memCell,
      el('td', { class: 'col-num', 'data-label': 'Uptime', text: fmtUptime(p.uptime) }),
      el('td', { class: 'col-num', 'data-label': 'Restarts', text: String(p.restartCount) }),
      el('td', { class: 'col-actions', 'data-label': '' }, [
        el('div', { class: 'row-actions' }, [
          actionBtn('restart', 'Restart', '', function (e) { procAction(p, 'restart', e.currentTarget); }),
          toggle,
          menu
        ])
      ])
    ]);
  }

  function procAction(p, action, btn) {
    setLoading(btn, true);
    api.post('/api/processes/' + enc(p.pmId) + '/' + action, {})
      .then(function () { toast(cap(action) + ' requested for ' + p.name, 'success'); return loadProcesses(); })
      .catch(reportError)
      .then(function () { setLoading(btn, false); });
  }
  function deleteProcess(p) {
    confirmModal({
      title: 'Delete process',
      bodyNode: el('span', {}, ['Delete ', el('strong', { text: p.name }), '? It will be removed from PM2 management. This cannot be undone.']),
      confirmLabel: 'Delete', variant: 'danger'
    }).then(function (ok) {
      if (!ok) return;
      api.del('/api/processes/' + enc(p.pmId))
        .then(function () { toast('Deleted ' + p.name, 'success'); return loadProcesses(); })
        .catch(reportError);
    });
  }
  function bulkAction(action) {
    var run = function () {
      api.post('/api/processes/actions/' + action, {})
        .then(function () { toast(typeLabel(action.replace('-', ' ')) + ' requested', 'success'); return loadProcesses(); })
        .catch(reportError);
    };
    if (action === 'stop-all') {
      confirmModal({ title: 'Stop all processes', body: 'This will stop every process managed by PM2.', confirmLabel: 'Stop all', variant: 'danger' })
        .then(function (ok) { if (ok) run(); });
    } else { run(); }
  }

  // ---- process detail drawer --------------------------------------------
  function openDetail(id) {
    api.get('/api/processes/' + enc(id)).then(function (data) { renderDetail(data.process); openDrawer(); }).catch(reportError);
  }
  function openDrawer() {
    lastFocus = document.activeElement;
    byId('drawer').classList.add('open');
    byId('drawer-overlay').classList.add('open');
    byId('drawer-close').focus();
  }
  function closeDrawer() {
    if (!byId('drawer').classList.contains('open')) return;
    byId('drawer').classList.remove('open');
    byId('drawer-overlay').classList.remove('open');
    if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
  }

  /** Keep Tab focus inside `container` while a modal/drawer is open. */
  function trapTab(e, container) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(
      container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (x) { return !x.disabled && x.offsetParent !== null; }
    );
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function detailSection(title, rows) {
    var dl = el('dl', { class: 'detail-kv' });
    rows.forEach(function (r) {
      if (r[1] == null || r[1] === '') return;
      dl.appendChild(el('dt', { text: r[0] }));
      dl.appendChild(el('dd', typeof r[1] === 'string' ? { text: r[1] } : null, typeof r[1] === 'string' ? null : r[1]));
    });
    return el('div', { class: 'detail-section' }, [el('h4', { text: title }), dl]);
  }
  function renderDetail(p) {
    byId('drawer-title').textContent = p.name;
    var body = byId('drawer-body'); clear(body);

    var online = p.status === 'online';
    body.appendChild(el('div', { class: 'drawer-actions' }, [
      el('button', { type: 'button', class: 'btn sm', onclick: function (e) { procAction(p, 'restart', e.currentTarget); } }, [icon('restart'), 'Restart']),
      el('button', { type: 'button', class: 'btn sm', onclick: function (e) { procAction(p, 'reload', e.currentTarget); } }, [icon('reload'), 'Reload']),
      el('button', { type: 'button', class: 'btn sm', onclick: function (e) { procAction(p, online ? 'stop' : 'start', e.currentTarget); } }, [icon(online ? 'stop' : 'play'), online ? 'Stop' : 'Start']),
      el('button', { type: 'button', class: 'btn sm', onclick: function () { closeDrawer(); openLogsFor(p.pmId, p.name); } }, [icon('terminal'), 'Logs']),
      el('button', { type: 'button', class: 'btn sm danger', onclick: function () { closeDrawer(); deleteProcess(p); } }, [icon('trash'), 'Delete'])
    ]));

    body.appendChild(detailSection('Overview', [
      ['Status', statusPill(p.status)],
      ['PID', p.pid != null ? String(p.pid) : '—'],
      ['Namespace', p.namespace],
      ['Version', p.version],
      ['Exec mode', p.execMode],
      ['Instances', String(p.instances)],
      ['User', p.user],
      ['Watching', p.watching ? 'yes' : 'no'],
      ['Autorestart', p.autorestart ? 'yes' : 'no']
    ]));
    body.appendChild(detailSection('Resources', [
      ['CPU', fmtPct(p.cpu)],
      ['Memory', fmtBytes(p.memory)],
      ['Uptime', fmtUptime(p.uptime)],
      ['Restarts', p.restartCount + ' (' + p.unstableRestarts + ' unstable)']
    ]));
    body.appendChild(detailSection('Configuration', [
      ['Script', p.script],
      ['Interpreter', p.interpreter],
      ['CWD', p.cwd],
      ['Args', (p.args && p.args.length) ? p.args.join(' ') : ''],
      ['Node args', (p.nodeArgs && p.nodeArgs.length) ? p.nodeArgs.join(' ') : ''],
      ['Out log', p.outLogPath],
      ['Error log', p.errorLogPath],
      ['Created', p.createdAt ? fmtDate(p.createdAt) : '']
    ]));

    var keys = p.env ? Object.keys(p.env).sort() : [];
    var envSec = el('div', { class: 'detail-section' }, [el('h4', { text: 'Environment (' + keys.length + ')' })]);
    if (!keys.length) {
      envSec.appendChild(el('p', { class: 'subtle', text: 'No environment variables.' }));
    } else {
      var tbody = el('tbody');
      keys.forEach(function (k) { tbody.appendChild(el('tr', {}, [el('td', { text: k }), el('td', { text: p.env[k] })])); });
      envSec.appendChild(el('table', { class: 'env-table' }, [tbody]));
    }
    body.appendChild(envSec);
  }

  // ======================================================================
  // Logs
  // ======================================================================
  function loadLogs() {
    return api.get('/api/processes').then(function (data) {
      var sel = byId('log-process'); var prev = sel.value; clear(sel);
      var list = data.processes || [];
      if (!list.length) { sel.appendChild(el('option', { value: '', text: 'No processes' })); return; }
      list.forEach(function (p) { sel.appendChild(el('option', { value: String(p.pmId), text: p.name })); });
      if (prev) sel.value = prev;
    });
  }
  function appendLog(line) {
    var out = byId('log-output');
    var cls = 'log-line' + (line.channel === 'err' ? ' err' : line.channel === 'sys' ? ' sys' : '');
    var ts = line.timestamp ? new Date(line.timestamp).toLocaleTimeString() : '';
    out.appendChild(el('span', { class: cls }, [ts ? el('span', { class: 'ts', text: ts }) : null, (line.message != null ? line.message : '') + '\n']));
    logLines++;
    while (out.childNodes.length > 1000) { out.removeChild(out.firstChild); logLines--; }
    byId('log-count').textContent = logLines ? logLines + ' lines' : '';
    if (byId('log-autoscroll').checked) out.scrollTop = out.scrollHeight;
  }
  function startLogs() {
    var sel = byId('log-process'); var id = sel.value;
    if (!id) { toast('Select a process first', 'error'); return; }
    stopLogs();
    var label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : id;
    appendLog({ channel: 'sys', message: '— streaming ' + label + ' —' });
    logStream = api.streamLogs(id, appendLog, null);
    logStream.onerror = function () { appendLog({ channel: 'err', message: '— stream disconnected —' }); };
    byId('log-start').disabled = true; byId('log-stop').disabled = false;
  }
  function stopLogs() {
    if (logStream) { logStream.close(); logStream = null; }
    byId('log-start').disabled = false; byId('log-stop').disabled = true;
  }
  function clearLogs() { clear(byId('log-output')); logLines = 0; byId('log-count').textContent = ''; }
  function openLogsFor(id) {
    showView('logs');
    // Ensure the process list is populated before selecting + streaming.
    loadLogs().then(function () {
      var sel = byId('log-process');
      sel.value = String(id);
      if (sel.value === String(id)) startLogs();
    }).catch(reportError);
  }

  // ======================================================================
  // Activity
  // ======================================================================
  function activityStatusClass(type) {
    if (/_failed$/.test(type)) return 'errored';
    if (type === 'login_success' || type === 'twofa_enabled' || type === 'user_created') return 'online';
    if (type === 'twofa_disabled' || type === 'user_deleted' || type === 'process_delete' ||
      type === 'process_stop' || type === 'process_stop_all' || type === 'logout') return 'stopped';
    return 'launching';
  }
  function activityPill(type) {
    return el('span', { class: 'status ' + activityStatusClass(type) }, [el('span', { class: 'dot' }), typeLabel(type)]);
  }
  function loadActivity() {
    var url = '/api/activity?limit=25&offset=' + activityOffset + (activityType ? '&type=' + enc(activityType) : '');
    return api.get(url).then(function (data) {
      var tb = byId('activity-tbody'); clear(tb);
      var items = data.items || [];
      if (!items.length) {
        tb.appendChild(el('tr', {}, [el('td', { colspan: '4' }, [emptyState('No activity', 'Events will appear here as they happen.')])]));
      } else {
        items.forEach(function (r) {
          tb.appendChild(el('tr', {}, [
            el('td', { class: 'nowrap muted', 'data-label': 'Time', text: fmtDate(r.created_at) }),
            el('td', { 'data-label': 'Event' }, [activityPill(r.type)]),
            el('td', { 'data-label': 'Details', text: r.message }),
            el('td', { 'data-label': 'User', text: r.username || '—' })
          ]));
        });
      }
      var limit = data.limit || 25, offset = data.offset || 0, total = data.total || 0;
      var pages = Math.max(1, Math.ceil(total / limit));
      byId('activity-page').textContent = 'Page ' + (Math.floor(offset / limit) + 1) + ' / ' + pages;
      byId('activity-prev').disabled = offset <= 0;
      byId('activity-next').disabled = offset + limit >= total;
    });
  }

  // ======================================================================
  // Settings
  // ======================================================================
  function refreshMe() {
    return api.get('/api/auth/me').then(function (me) { currentUser = me.user; render2fa(); });
  }
  function loadSettings() {
    return refreshMe().then(function () {
      if (!isAdmin) return;
      return api.get('/api/settings').then(function (s) {
        byId('metrics-interval').value = s.metricsIntervalSeconds;
        byId('metrics-retention').value = s.metricsRetentionDays;
        return loadUsers();
      });
    });
  }
  function render2fa() {
    var enabled = !!(currentUser && currentUser.totpEnabled);
    byId('twofa-status').textContent = enabled
      ? 'Two-factor authentication is enabled for your account.'
      : 'Add a second layer of security with an authenticator app.';
    byId('twofa-setup-btn').classList.toggle('hidden', enabled);
    byId('twofa-setup').classList.add('hidden');
    byId('form-disable-2fa').classList.toggle('hidden', !enabled);
  }
  function loadUsers() {
    return api.get('/api/users').then(function (data) {
      var tb = byId('users-tbody'); clear(tb);
      (data.users || []).forEach(function (u) {
        var actions = el('td', { class: 'col-actions' });
        if (currentUser && u.id !== currentUser.id) {
          actions.appendChild(actionBtn('trash', 'Delete user', 'danger', function () { deleteUser(u); }));
        } else {
          actions.appendChild(el('span', { class: 'subtle', text: 'you' }));
        }
        tb.appendChild(el('tr', {}, [
          el('td', { text: u.username }),
          el('td', {}, [u.isAdmin ? el('span', { class: 'badge', text: 'Admin' }) : el('span', { class: 'muted', text: 'User' })]),
          el('td', { text: u.totpEnabled ? 'on' : 'off' }),
          actions
        ]));
      });
    });
  }
  function deleteUser(u) {
    confirmModal({
      title: 'Delete user',
      bodyNode: el('span', {}, ['Delete user ', el('strong', { text: u.username }), '? Their sessions will be revoked immediately.']),
      confirmLabel: 'Delete', variant: 'danger'
    }).then(function (ok) {
      if (!ok) return;
      api.del('/api/users/' + enc(u.id)).then(function () { toast('User deleted', 'success'); return loadUsers(); }).catch(reportError);
    });
  }

  // ======================================================================
  // View routing + polling
  // ======================================================================
  function loadView(name) {
    switch (name) {
      case 'dashboard': return loadDashboard();
      case 'processes': return loadProcesses();
      case 'logs': return loadLogs();
      case 'activity': return loadActivity();
      case 'settings': return loadSettings();
      default: return Promise.resolve();
    }
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function showView(name) {
    if (currentView === 'logs' && name !== 'logs') stopLogs();
    stopPolling();
    currentView = name;
    qsa('.view').forEach(function (s) { s.classList.add('hidden'); });
    var sec = byId('view-' + name); if (sec) sec.classList.remove('hidden');
    qsa('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === name); });
    byId('view-title').textContent = VIEW_TITLES[name] || '';
    byId('shell').classList.remove('nav-open');

    Promise.resolve().then(function () { return loadView(name); }).catch(reportError);

    if (name === 'dashboard' || name === 'processes') {
      pollTimer = setInterval(function () {
        if (qs('.menu.open') || byId('modal-overlay').classList.contains('open')) return; // don't disrupt interactions
        Promise.resolve().then(function () { return loadView(name); }).catch(function () { });
      }, 5000);
    }
  }

  function emptyState(title, text) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty-ico' }, [icon('box')]),
      el('h3', { text: title }),
      el('p', { text: text })
    ]);
  }

  // ======================================================================
  // Event wiring
  // ======================================================================
  function wire() {
    // sidebar nav
    byId('main-nav').addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-btn');
      if (btn && btn.getAttribute('data-view')) showView(btn.getAttribute('data-view'));
    });
    byId('nav-toggle').addEventListener('click', function () { byId('shell').classList.toggle('nav-open'); });
    byId('nav-scrim').addEventListener('click', function () { byId('shell').classList.remove('nav-open'); });
    byId('logout-btn').addEventListener('click', function () { api.logout(); });

    // dashboard
    byId('dash-refresh').addEventListener('click', function () { loadDashboard().catch(reportError); });

    // processes: sorting
    qsa('#process-table th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (procSort.key === key) procSort.dir = procSort.dir === 'asc' ? 'desc' : 'asc';
        else { procSort.key = key; procSort.dir = (key === 'name' || key === 'status') ? 'asc' : 'desc'; }
        renderProcesses();
      });
    });
    byId('proc-search').addEventListener('input', debounce(function (e) { procFilter.search = e.target.value.trim(); renderProcesses(); }, 160));
    byId('proc-filter').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      procFilter.status = b.getAttribute('data-status');
      qsa('#proc-filter button').forEach(function (x) { x.classList.toggle('active', x === b); });
      renderProcesses();
    });
    byId('refresh-processes').addEventListener('click', function () { loadProcesses().catch(reportError); });
    byId('bulk-menu-btn').classList.add('js-menu-trigger');
    qsa('#bulk-menu [data-bulk]').forEach(function (b) {
      b.addEventListener('click', function () { closeMenus(); bulkAction(b.getAttribute('data-bulk')); });
    });

    // logs
    byId('log-start').addEventListener('click', startLogs);
    byId('log-stop').addEventListener('click', stopLogs);
    byId('log-clear').addEventListener('click', clearLogs);

    // activity
    var filter = byId('activity-filter');
    ACTIVITY_TYPES.forEach(function (t) { filter.appendChild(el('option', { value: t, text: typeLabel(t) })); });
    filter.addEventListener('change', function () { activityType = filter.value; activityOffset = 0; loadActivity().catch(reportError); });
    byId('activity-prev').addEventListener('click', function () { if (activityOffset > 0) { activityOffset = Math.max(0, activityOffset - 25); loadActivity().catch(reportError); } });
    byId('activity-next').addEventListener('click', function () { activityOffset += 25; loadActivity().catch(reportError); });

    // settings: change password
    byId('form-change-password').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target; var btn = qs('button[type=submit]', f); setLoading(btn, true);
      api.post('/api/auth/change-password', { currentPassword: byId('cp-current').value, newPassword: byId('cp-new').value })
        .then(function () { toast('Password updated', 'success'); f.reset(); })
        .catch(reportError).then(function () { setLoading(btn, false); });
    });
    // settings: 2FA
    byId('twofa-setup-btn').addEventListener('click', function (e) {
      var btn = e.currentTarget; setLoading(btn, true);
      api.post('/api/auth/2fa/setup', {}).then(function (d) {
        byId('twofa-qr').src = d.qrDataUrl; byId('twofa-secret').textContent = d.secret;
        byId('twofa-setup').classList.remove('hidden');
      }).catch(reportError).then(function () { setLoading(btn, false); });
    });
    byId('form-enable-2fa').addEventListener('submit', function (e) {
      e.preventDefault(); var btn = qs('button[type=submit]', e.target); setLoading(btn, true);
      api.post('/api/auth/2fa/enable', { token: byId('enable-code').value.trim() })
        .then(function () { toast('Two-factor authentication enabled', 'success'); e.target.reset(); return refreshMe(); })
        .catch(reportError).then(function () { setLoading(btn, false); });
    });
    byId('form-disable-2fa').addEventListener('submit', function (e) {
      e.preventDefault(); var btn = qs('button[type=submit]', e.target); setLoading(btn, true);
      api.post('/api/auth/2fa/disable', { password: byId('disable-pass').value })
        .then(function () { toast('Two-factor authentication disabled', 'success'); e.target.reset(); return refreshMe(); })
        .catch(reportError).then(function () { setLoading(btn, false); });
    });
    // settings: metrics
    byId('form-settings').addEventListener('submit', function (e) {
      e.preventDefault(); var btn = qs('button[type=submit]', e.target); setLoading(btn, true);
      api.put('/api/settings', { metricsIntervalSeconds: Number(byId('metrics-interval').value), metricsRetentionDays: Number(byId('metrics-retention').value) })
        .then(function () { toast('Settings saved', 'success'); })
        .catch(reportError).then(function () { setLoading(btn, false); });
    });
    // settings: create user
    byId('form-create-user').addEventListener('submit', function (e) {
      e.preventDefault(); var f = e.target; var btn = qs('button[type=submit]', f); setLoading(btn, true);
      api.post('/api/users', { username: byId('nu-username').value.trim(), password: byId('nu-password').value, isAdmin: byId('nu-admin').checked })
        .then(function () { toast('User created', 'success'); f.reset(); return loadUsers(); })
        .catch(reportError).then(function () { setLoading(btn, false); });
    });

    // drawer + modal
    byId('drawer-close').addEventListener('click', closeDrawer);
    byId('drawer-overlay').addEventListener('click', closeDrawer);
    byId('modal-cancel').addEventListener('click', function () { closeModal(false); });
    byId('modal-confirm').addEventListener('click', function () { closeModal(true); });
    byId('modal-overlay').addEventListener('click', function (e) { if (e.target === byId('modal-overlay')) closeModal(false); });

    // dropdown menus (global)
    document.addEventListener('click', function (e) {
      var trig = e.target.closest('.js-menu-trigger');
      if (trig) { e.stopPropagation(); var m = trig.closest('.menu'); var open = m.classList.contains('open'); closeMenus(); if (!open) m.classList.add('open'); return; }
      if (!e.target.closest('.menu-list')) closeMenus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (byId('modal-overlay').classList.contains('open')) { closeModal(false); return; }
        closeMenus();
        if (byId('drawer').classList.contains('open')) closeDrawer();
        return;
      }
      if (e.key === 'Tab') {
        if (byId('modal-overlay').classList.contains('open')) trapTab(e, byId('modal-overlay'));
        else if (byId('drawer').classList.contains('open')) trapTab(e, byId('drawer'));
      }
    });

    // charts react to theme + resize
    document.addEventListener('themechange', function () { if (currentView === 'dashboard') redrawCharts(); });
    window.addEventListener('resize', debounce(function () { if (currentView === 'dashboard') redrawCharts(); }, 180));
  }

  function applyAdminVisibility() {
    qsa('.admin-only').forEach(function (n) { n.classList.toggle('hidden', !isAdmin); });
  }

  // ---- bootstrap ---------------------------------------------------------
  function init() {
    api.get('/api/auth/me').then(function (me) {
      currentUser = me.user;
      isAdmin = !!me.user.isAdmin;
      byId('current-user').textContent = me.user.username;
      byId('user-role').textContent = isAdmin ? 'Administrator' : 'User';
      byId('user-avatar').textContent = (me.user.username[0] || '·').toUpperCase();
      applyAdminVisibility();
      wire();
      showView('dashboard');
    }).catch(function (err) {
      // A 401 already redirected via api.js; surface anything else.
      if (err && err.code !== 'ERROR' && err.code !== 'NETWORK_ERROR') reportError(err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
