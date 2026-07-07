/*
 * chart.js — dependency-free time-series area chart on <canvas>.
 *
 *   window.drawLineChart(canvas, points, options)
 *     points  : [{ x: epochMs, y: number }]  (ascending x)
 *     options : {
 *       color, fill, grid, axis, text,   // colours (fall back to CSS vars)
 *       yFormat(v)->string,              // y-axis / tick labels
 *       xFormat(ms)->string,             // x-axis labels (range-aware)
 *       tipTime(ms)->string,             // full timestamp for the tooltip
 *       valueFormat(y)->string,          // value shown in the tooltip
 *       label,                           // series name shown in the tooltip
 *       yMin, yMax,                      // fixed axis bounds (optional)
 *       empty,                           // empty-state text
 *       interactive,                     // enable hover tooltip + crosshair
 *       onZoom(fromMs,toMs),             // brush-select to zoom (drag on chart)
 *       onReset()                        // double-click to reset zoom
 *     }
 *
 * DevicePixelRatio-aware; draws gridlines, range-aware x/y labels, a subtle
 * area fill, the line and the latest-point marker. When `interactive`, hovering
 * shows a crosshair + tooltip; when `onZoom` is set, dragging selects a time
 * window and double-click resets.
 */
(function () {
  'use strict';

  function cssVar(el, name, fallback) {
    var v = getComputedStyle(el).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function tipEl() {
    var t = document.getElementById('chart-tip');
    if (!t) {
      t = document.createElement('div');
      t.id = 'chart-tip';
      t.className = 'chart-tip hidden';
      document.body.appendChild(t);
    }
    return t;
  }
  function hideTip() { var t = document.getElementById('chart-tip'); if (t) t.classList.add('hidden'); }

  // Build the chart model (geometry + scales + data) and store it on the canvas.
  function computeChart(canvas, points, options) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    var cssH = canvas.clientHeight || 160;

    var data = (points || []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); });

    var c = {
      dpr: dpr, cssW: cssW, cssH: cssH,
      data: data,
      color: options.color || cssVar(canvas, '--accent', '#3b5bd9'),
      fill: options.fill || cssVar(canvas, '--chart-fill', 'rgba(59,91,217,0.12)'),
      grid: options.grid || cssVar(canvas, '--chart-grid', 'rgba(128,128,128,0.16)'),
      axis: options.axis || cssVar(canvas, '--chart-axis', 'rgba(128,128,128,0.35)'),
      text: options.text || cssVar(canvas, '--chart-text', 'rgba(128,128,128,0.9)'),
      empty: options.empty || 'No data for this range',
      label: options.label || '',
      yFormat: options.yFormat || function (v) { return String(Math.round(v)); },
      xFormat: options.xFormat || function (ms) {
        var d = new Date(ms);
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      },
      tipTime: options.tipTime || function (ms) { return new Date(ms).toLocaleString(); },
      valueFormat: options.valueFormat || (options.yFormat || function (v) { return String(Math.round(v)); }),
      interactive: !!options.interactive,
      onZoom: options.onZoom || null,
      onReset: options.onReset || null,
      isEmpty: data.length === 0,
    };

    c.padL = 46; c.padR = 14; c.padT = 12; c.padB = 24;
    c.plotW = Math.max(1, cssW - c.padL - c.padR);
    c.plotH = Math.max(1, cssH - c.padT - c.padB);

    if (!c.isEmpty) {
      c.xMin = data[0].x;
      c.xMax = data[data.length - 1].x;
      c.xSpan = c.xMax - c.xMin || 1;
      var yMax = options.yMax;
      if (yMax == null) {
        yMax = 0;
        for (var i = 0; i < data.length; i++) if (data[i].y > yMax) yMax = data[i].y;
        yMax = niceCeil(yMax * 1.1) || 1;
      }
      c.yMin = options.yMin != null ? options.yMin : 0;
      c.yMax = yMax;
      c.ySpan = c.yMax - c.yMin || 1;
      c.sx = function (x) { return c.padL + ((x - c.xMin) / c.xSpan) * c.plotW; };
      c.sy = function (y) { return c.padT + (1 - (y - c.yMin) / c.ySpan) * c.plotH; };
      c.xAt = function (px) { return c.xMin + ((px - c.padL) / c.plotW) * c.xSpan; };
    }
    return c;
  }

  // Draw the static chart from canvas._chart.
  function renderBase(canvas) {
    var c = canvas._chart; if (!c) return;
    var ctx = canvas.getContext('2d');
    canvas.width = Math.round(c.cssW * c.dpr);
    canvas.height = Math.round(c.cssH * c.dpr);
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.clearRect(0, 0, c.cssW, c.cssH);
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';

    if (c.isEmpty) {
      ctx.fillStyle = c.text; ctx.textAlign = 'center';
      ctx.fillText(c.empty, c.cssW / 2, c.cssH / 2);
      return;
    }

    // y gridlines + labels
    var rows = 4;
    ctx.textAlign = 'right';
    for (var r = 0; r <= rows; r++) {
      var yv = c.yMin + (c.ySpan * r) / rows;
      var py = c.sy(yv);
      ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c.padL, Math.round(py) + 0.5); ctx.lineTo(c.padL + c.plotW, Math.round(py) + 0.5); ctx.stroke();
      ctx.fillStyle = c.text; ctx.fillText(c.yFormat(yv), c.padL - 8, py);
    }

    // x labels — count scales with width, evenly spaced across the window
    var cols = Math.max(2, Math.min(7, Math.floor(c.plotW / 90)));
    ctx.fillStyle = c.text;
    for (var k = 0; k <= cols; k++) {
      var frac = k / cols;
      var xv = c.xMin + c.xSpan * frac;
      var pxl = c.padL + c.plotW * frac;
      ctx.textAlign = k === 0 ? 'left' : k === cols ? 'right' : 'center';
      ctx.fillText(c.xFormat(xv), pxl, c.cssH - c.padB / 2);
    }

    // area fill
    tracePath(ctx, c);
    ctx.lineTo(c.sx(c.xMax), c.padT + c.plotH);
    ctx.lineTo(c.sx(c.xMin), c.padT + c.plotH);
    ctx.closePath();
    ctx.fillStyle = c.fill; ctx.fill();

    // baseline
    ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(c.padL, c.padT + c.plotH + 0.5); ctx.lineTo(c.padL + c.plotW, c.padT + c.plotH + 0.5); ctx.stroke();

    // line
    tracePath(ctx, c);
    ctx.strokeStyle = c.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();

    // latest marker
    var last = c.data[c.data.length - 1];
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.arc(c.sx(last.x), c.sy(last.y), 3, 0, Math.PI * 2); ctx.fill();
  }

  function tracePath(ctx, c) {
    ctx.beginPath();
    for (var j = 0; j < c.data.length; j++) {
      var px = c.sx(c.data[j].x), py = c.sy(c.data[j].y);
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
  }

  // nearest data index to a CSS-pixel x position
  function nearestIndex(c, px) {
    var xv = c.xAt(px), lo = 0, hi = c.data.length - 1;
    if (xv <= c.data[0].x) return 0;
    if (xv >= c.data[hi].x) return hi;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (c.data[mid].x < xv) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(c.data[lo - 1].x - xv) <= Math.abs(c.data[lo].x - xv)) return lo - 1;
    return lo;
  }

  function drawCrosshair(canvas, idx) {
    var c = canvas._chart; if (!c || c.isEmpty) return;
    renderBase(canvas);
    var ctx = canvas.getContext('2d');
    var p = c.data[idx], x = c.sx(p.x), y = c.sy(p.y);
    ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, c.padT); ctx.lineTo(Math.round(x) + 0.5, c.padT + c.plotH); ctx.stroke();
    ctx.fillStyle = c.color; ctx.strokeStyle = cssVar(canvas, '--surface', '#fff'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    var tip = tipEl();
    tip.textContent = '';
    var line1 = document.createElement('div'); line1.className = 'chart-tip-v';
    line1.textContent = (c.label ? c.label + '  ' : '') + c.valueFormat(p.y);
    var line2 = document.createElement('div'); line2.className = 'chart-tip-t';
    line2.textContent = c.tipTime(p.x);
    tip.appendChild(line1); tip.appendChild(line2);
    tip.classList.remove('hidden');
    var rect = canvas.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = rect.left + window.scrollX + x - tw / 2;
    left = Math.max(rect.left + window.scrollX + 2, Math.min(left, rect.right + window.scrollX - tw - 2));
    var top = rect.top + window.scrollY + y - th - 12;
    if (top < rect.top + window.scrollY) top = rect.top + window.scrollY + y + 14;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function drawBrush(canvas, x0, x1) {
    var c = canvas._chart; if (!c) return;
    renderBase(canvas);
    var ctx = canvas.getContext('2d');
    var a = Math.max(c.padL, Math.min(x0, x1)), b = Math.min(c.padL + c.plotW, Math.max(x0, x1));
    ctx.fillStyle = cssVar(canvas, '--accent-weak', 'rgba(59,91,217,0.12)');
    ctx.fillRect(a, c.padT, b - a, c.plotH);
    ctx.strokeStyle = c.color; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(a) + 0.5, c.padT); ctx.lineTo(Math.round(a) + 0.5, c.padT + c.plotH);
    ctx.moveTo(Math.round(b) + 0.5, c.padT); ctx.lineTo(Math.round(b) + 0.5, c.padT + c.plotH);
    ctx.stroke();
  }

  function ensureInteractions(canvas) {
    if (canvas._hooked) return;
    canvas._hooked = true;
    var dragging = false, startX = null, movedX = null;

    function localX(e) { return e.clientX - canvas.getBoundingClientRect().left; }

    canvas.addEventListener('mousemove', function (e) {
      var c = canvas._chart; if (!c || c.isEmpty) return;
      var x = localX(e);
      if (dragging && c.onZoom) { movedX = x; drawBrush(canvas, startX, x); hideTip(); return; }
      if (!c.interactive) return;
      if (x < c.padL || x > c.padL + c.plotW) { hideTip(); renderBase(canvas); return; }
      drawCrosshair(canvas, nearestIndex(c, x));
    });
    canvas.addEventListener('mouseleave', function () {
      if (dragging) return;
      hideTip(); renderBase(canvas);
    });
    canvas.addEventListener('mousedown', function (e) {
      var c = canvas._chart; if (!c || c.isEmpty || !c.onZoom) return;
      var x = localX(e);
      if (x < c.padL || x > c.padL + c.plotW) return;
      dragging = true; startX = x; movedX = x; hideTip();
      e.preventDefault();
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      var c = canvas._chart;
      if (c && c.onZoom && movedX != null && Math.abs(movedX - startX) > 8) {
        var t0 = c.xAt(Math.min(startX, movedX)), t1 = c.xAt(Math.max(startX, movedX));
        c.onZoom(Math.round(t0), Math.round(t1));
      } else {
        renderBase(canvas);
      }
      startX = movedX = null;
    });
    canvas.addEventListener('dblclick', function () {
      var c = canvas._chart;
      if (c && c.onReset) c.onReset();
    });
  }

  function drawLineChart(canvas, points, options) {
    if (!canvas || !canvas.getContext) return;
    canvas._chart = computeChart(canvas, points, options || {});
    renderBase(canvas);
    ensureInteractions(canvas);
  }

  window.drawLineChart = drawLineChart;
})();
