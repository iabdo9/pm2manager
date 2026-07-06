/*
 * chart.js — dependency-free time-series area chart on <canvas>.
 *
 *   window.drawLineChart(canvas, points, options)
 *     points  : [{ x: epochMs, y: number }]  (ascending x)
 *     options : {
 *       color, fill, grid, axis, text,   // colours (fall back to CSS vars)
 *       yFormat(v)->string,              // y-axis / value labels
 *       xFormat(ms)->string,             // x-axis labels
 *       yMin, yMax,                      // fixed axis bounds (optional)
 *       empty                            // empty-state text
 *     }
 *
 * DevicePixelRatio-aware for crisp lines; draws light gridlines, y/x labels,
 * a subtle area fill, the line, and a marker on the latest point.
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

  function drawLineChart(canvas, points, options) {
    if (!canvas || !canvas.getContext) return;
    options = options || {};
    var ctx = canvas.getContext('2d');

    var color = options.color || cssVar(canvas, '--accent', '#3b5bd9');
    var fill = options.fill || cssVar(canvas, '--chart-fill', 'rgba(59,91,217,0.12)');
    var grid = options.grid || cssVar(canvas, '--chart-grid', 'rgba(128,128,128,0.16)');
    var axis = options.axis || cssVar(canvas, '--chart-axis', 'rgba(128,128,128,0.35)');
    var text = options.text || cssVar(canvas, '--chart-text', 'rgba(128,128,128,0.9)');
    var yFormat = options.yFormat || function (v) { return String(Math.round(v)); };
    var xFormat =
      options.xFormat ||
      function (ms) {
        var d = new Date(ms);
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      };

    // Size the backing store to the CSS box × devicePixelRatio.
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    var cssH = canvas.clientHeight || 160;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';

    var data = (points || []).filter(function (p) {
      return p && isFinite(p.x) && isFinite(p.y);
    });

    // Empty state.
    if (data.length === 0) {
      ctx.fillStyle = text;
      ctx.textAlign = 'center';
      ctx.fillText(options.empty || 'No data yet', cssW / 2, cssH / 2);
      return;
    }

    var padL = 44;
    var padR = 12;
    var padT = 10;
    var padB = 22;
    var plotW = Math.max(1, cssW - padL - padR);
    var plotH = Math.max(1, cssH - padT - padB);

    var xMin = data[0].x;
    var xMax = data[data.length - 1].x;
    var xSpan = xMax - xMin || 1;

    var yMax = options.yMax;
    if (yMax == null) {
      yMax = 0;
      for (var i = 0; i < data.length; i++) if (data[i].y > yMax) yMax = data[i].y;
      yMax = niceCeil(yMax * 1.1) || 1;
    }
    var yMin = options.yMin != null ? options.yMin : 0;
    var ySpan = yMax - yMin || 1;

    function sx(x) { return padL + ((x - xMin) / xSpan) * plotW; }
    function sy(y) { return padT + (1 - (y - yMin) / ySpan) * plotH; }

    // Horizontal gridlines + y labels.
    var rows = 4;
    ctx.textAlign = 'right';
    for (var r = 0; r <= rows; r++) {
      var yv = yMin + (ySpan * r) / rows;
      var py = sy(yv);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(py) + 0.5);
      ctx.lineTo(padL + plotW, Math.round(py) + 0.5);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(yFormat(yv), padL - 8, py);
    }

    // X labels (start, middle, end).
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.fillText(xFormat(xMin), padL, cssH - padB / 2);
    ctx.textAlign = 'center';
    ctx.fillText(xFormat(xMin + xSpan / 2), padL + plotW / 2, cssH - padB / 2);
    ctx.textAlign = 'right';
    ctx.fillText(xFormat(xMax), padL + plotW, cssH - padB / 2);

    function tracePath() {
      ctx.beginPath();
      for (var j = 0; j < data.length; j++) {
        var px = sx(data[j].x);
        var py2 = sy(data[j].y);
        if (j === 0) ctx.moveTo(px, py2);
        else ctx.lineTo(px, py2);
      }
    }

    // Area fill.
    tracePath();
    ctx.lineTo(sx(xMax), padT + plotH);
    ctx.lineTo(sx(xMin), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Baseline axis.
    ctx.strokeStyle = axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + plotH + 0.5);
    ctx.lineTo(padL + plotW, padT + plotH + 0.5);
    ctx.stroke();

    // Line.
    tracePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Latest-value marker.
    var last = data[data.length - 1];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx(last.x), sy(last.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  window.drawLineChart = drawLineChart;
})();
