/* ============================================================
   手写识别 · 在线版前端逻辑
   - 画板：鼠标 / 触屏 / 手写笔
   - 识别：把笔迹导成干净的黑白图片，POST 到本机转发服务，
           由转发服务调用在线手写识别接口（解决浏览器跨域限制）
   ============================================================ */
(function () {
  'use strict';

  var MAX_SIDE = 900;          // 导出图片最长边上限（px）
  var TARGET_SIDE = 480;       // 目标最长边（px）
  var DEFAULT_ENDPOINT = 'http://localhost:8787/api/handwriting';
  var LS_KEY = 'hw-online-endpoint';

  /* ---------- DOM ---------- */
  var canvas = document.getElementById('board');
  var ctx = canvas.getContext('2d');
  var resText = document.getElementById('resText');
  var badge = document.getElementById('badge');
  var confEl = document.getElementById('conf');
  var prog = document.getElementById('prog');
  var progLabel = document.getElementById('progLabel');
  var progBar = document.getElementById('progBar');
  var recognizeBtn = document.getElementById('recognizeBtn');
  var copyBtn = document.getElementById('copyBtn');
  var undoBtn = document.getElementById('undoBtn');
  var clearBtn = document.getElementById('clearBtn');
  var demoBtn = document.getElementById('demoBtn');
  var canvasHint = document.getElementById('canvasHint');
  var endpointInput = document.getElementById('endpointInput');
  var saveEndpointBtn = document.getElementById('saveEndpoint');
  var testServerBtn = document.getElementById('testServer');
  var serverState = document.getElementById('serverState');
  var serverStateText = document.getElementById('serverStateText');

  /* ---------- 状态 ---------- */
  var inkColor = '#23232a';
  var inkWidth = 6;
  var isDrawing = false;
  var strokes = [];            // [{ c, w, pts: [{x, y}] }]
  var current = null;
  var recognizing = false;
  var boardW = 0, boardH = 0;  // CSS 像素尺寸

  /* ============================================================
     1. 画板
     ============================================================ */
  function fit() {
    var box = document.querySelector('.canvas-box');
    var w = Math.max(box.clientWidth, 1);
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var h = Math.max(300, Math.min(440, w * 0.72));

    // 尺寸变化时按比例缩放已有笔迹
    if (boardW > 0 && boardH > 0) {
      var sx = w / boardW, sy = h / boardH;
      for (var i = 0; i < strokes.length; i++) {
        var pts = strokes[i].pts;
        for (var j = 0; j < pts.length; j++) { pts[j].x *= sx; pts[j].y *= sy; }
      }
    }
    boardW = w; boardH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function redraw() {
    ctx.clearRect(0, 0, boardW, boardH);
    for (var i = 0; i < strokes.length; i++) paintStroke(strokes[i]);
    canvasHint.hidden = strokes.length > 0 || isDrawing;
  }

  function paintStroke(s) {
    var pts = s.pts;
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, s.w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* ============================================================
     2. 书写交互
     ============================================================ */
  function pointFromEvent(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen' && e.button === 5) return;
    isDrawing = true;
    current = { c: inkColor, w: inkWidth, pts: [pointFromEvent(e)] };
    strokes.push(current);
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    canvasHint.hidden = true;
    e.preventDefault();
  }

  function onMove(e) {
    if (!isDrawing || !current) return;
    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    var moved = false;
    for (var i = 0; i < events.length; i++) {
      var p = pointFromEvent(events[i]);
      var last = current.pts[current.pts.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.6) continue;
      current.pts.push(p);
      moved = true;
    }
    if (moved) paintStroke(current);
    e.preventDefault();
  }

  function onUp() {
    if (!isDrawing) return;
    isDrawing = false;
    current = null;
    canvasHint.hidden = strokes.length > 0;
  }

  function undo() {
    if (isDrawing || !strokes.length) return;
    strokes.pop();
    redraw();
  }

  function clearAll() {
    strokes.length = 0;
    current = null;
    isDrawing = false;
    redraw();
    setResult('', { empty: true, placeholder: '在上面纸上写完字，点击「识别文字」。' });
    confEl.textContent = '';
  }

  /* ============================================================
     3. 把笔迹导成干净的黑白图片
     ============================================================ */
  function inkBounds() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < strokes.length; i++) {
      var pts = strokes[i].pts;
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j];
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * 导出识别用的 PNG（白底黑字、按笔迹裁边、留白、放大到合适分辨率）。
   * 返回 { dataUrl, base64, width, height }，没有笔迹时返回 null。
   */
  function exportInkImage() {
    var live = strokes.filter(function (s) { return s.pts.length; });
    if (!live.length) return null;

    var b = inkBounds();
    var pad = Math.max(10, Math.max(b.w, b.h) * 0.09);
    var bw = b.w + pad * 2;
    var bh = b.h + pad * 2;

    var scale = TARGET_SIDE / Math.max(bw, bh);
    scale = Math.max(1, Math.min(3, scale));
    if (Math.max(bw, bh) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(bw, bh);

    var outW = Math.max(1, Math.round(bw * scale));
    var outH = Math.max(1, Math.round(bh * scale));

    var cv = document.createElement('canvas');
    cv.width = outW;
    cv.height = outH;
    var c = cv.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, outW, outH);
    c.strokeStyle = '#000000';
    c.fillStyle = '#000000';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    for (var i = 0; i < live.length; i++) {
      var s = live[i];
      var map = s.pts.map(function (p) {
        return { x: (p.x - b.x0 + pad) * scale, y: (p.y - b.y0 + pad) * scale };
      });
      var lw = Math.max(2, s.w * scale);
      if (map.length === 1) {
        c.beginPath();
        c.arc(map[0].x, map[0].y, lw / 2, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(map[0].x, map[0].y);
      for (var k = 1; k < map.length; k++) c.lineTo(map[k].x, map[k].y);
      c.stroke();
    }

    var dataUrl = cv.toDataURL('image/png');
    return {
      dataUrl: dataUrl,
      base64: dataUrl.replace(/^data:image\/\w+;base64,/, ''),
      width: outW,
      height: outH,
    };
  }

  /* ============================================================
     4. 在线识别
     ============================================================ */
  function getEndpoint() {
    return (localStorage.getItem(LS_KEY) || endpointInput.value || DEFAULT_ENDPOINT).trim();
  }

  function setProgress(status, frac) {
    prog.classList.add('show');
    progLabel.textContent = status;
    progBar.style.width = Math.round((frac || 0) * 100) + '%';
  }

  function setBadge(text, kind) {
    badge.textContent = text;
    badge.style.background = kind === 'ok' ? '#eef2ec' : kind === 'err' ? '#f7e4df' : 'var(--paper-2)';
    badge.style.color = kind === 'ok' ? 'var(--ok)' : kind === 'err' ? 'var(--err)' : 'var(--ink-soft)';
  }

  function setResult(text, opts) {
    opts = opts || {};
    if (opts.empty) {
      resText.textContent = opts.placeholder || '没有识别出文字。';
      resText.classList.add('empty');
    } else {
      resText.textContent = text;
      resText.classList.remove('empty');
    }
  }

  function setServerState(state, text) {
    serverState.dataset.state = state;
    serverStateText.textContent = text;
  }

  async function recognize() {
    if (recognizing) return;
    if (!strokes.some(function (s) { return s.pts.length; })) {
      setResult('', { empty: true, placeholder: '纸面上还没有字，先在上面写点内容。' });
      return;
    }
    recognizing = true;
    recognizeBtn.disabled = true;
    recognizeBtn.textContent = '识别中…';
    setBadge('识别中');
    setProgress('正在发送识别…', 0.15);

    try {
      var img = exportInkImage();
      var endpoint = getEndpoint();
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img.base64, width: img.width, height: img.height }),
      });
      var data = await res.json().catch(function () { return {}; });
      setProgress('正在识别…', 0.7);

      if (!res.ok || !data || !data.ok) {
        throw new Error((data && data.error) || ('服务返回 HTTP ' + res.status));
      }
      var text = (data.text || '').trim();
      if (text) {
        setResult(text);
        setBadge('完成', 'ok');
        confEl.textContent = '用时 ' + Math.round(data.ms || 0) + ' ms' + (data.provider ? ' · ' + data.provider : '');
      } else {
        setResult('', { empty: true, placeholder: '没有识别出文字，可能是字迹太潦草，请清空后写得更工整再试。' });
        setBadge('未识别');
        confEl.textContent = '';
      }
      prog.classList.remove('show');
    } catch (err) {
      setResult('识别失败：' + err.message + '\n\n请确认已经运行 `node server.mjs`，且「识别服务设置」里的地址正确。', { empty: true });
      setBadge('失败', 'err');
      confEl.textContent = '';
      prog.classList.remove('show');
    } finally {
      recognizing = false;
      recognizeBtn.disabled = false;
      recognizeBtn.textContent = '识别文字';
    }
  }

  async function testServer() {
    setServerState('busy', '连接中…');
    try {
      var res = await fetch(getEndpoint(), { method: 'GET' });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data && data.ok) {
        if (data.configured) setServerState('ok', '已连接 · 接口已配置（' + (data.provider || '在线') + '）');
        else setServerState('err', '已连接，但服务端还没填识别密钥');
      } else {
        setServerState('err', '服务返回异常：HTTP ' + res.status);
      }
    } catch (err) {
      setServerState('err', '连不上转发服务，请先运行 node server.mjs');
    }
  }

  /* ============================================================
     5. 示例笔迹（用参考字形顶点生成，方便快速试识别接口）
     ============================================================ */
  var samples = null;

  function loadSamples() {
    if (samples) return samples;
    var tag = document.getElementById('samplesData');
    try { samples = tag ? JSON.parse(tag.textContent) : {}; } catch (e) { samples = {}; }
    return samples;
  }

  function bbox(points) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < points.length; i++) {
      var x = points[i][0], y = points[i][1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  function drawSample(text) {
    var data = loadSamples();
    var chars = Array.from(text || '你好世界').filter(function (ch) { return data[ch]; });
    if (!chars.length) return false;

    var W = boardW, H = boardH;
    var cell = Math.min(H * 0.62, (W - 36) / chars.length);
    var startX = (W - cell * chars.length) / 2;
    var topY = (H - cell) / 2;

    strokes.length = 0;
    chars.forEach(function (ch, i) {
      var medians = data[ch];
      var all = [];
      medians.forEach(function (m) { all = all.concat(m); });
      var b = bbox(all);
      var scale = Math.min((cell * 0.74) / Math.max(b.w, 1), (cell * 0.74) / Math.max(b.h, 1));
      var cx = startX + i * cell + cell / 2;
      var cy = topY + cell / 2;
      medians.forEach(function (median) {
        var pts = median.map(function (p) {
          return { x: (p[0] - b.cx) * scale + cx, y: -(p[1] - b.cy) * scale + cy };
        });
        strokes.push({ c: inkColor, w: inkWidth, pts: pts });
      });
    });
    redraw();
    return true;
  }

  /* ============================================================
     6. 事件绑定与初始化
     ============================================================ */
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  undoBtn.addEventListener('click', undo);
  clearBtn.addEventListener('click', clearAll);
  demoBtn.addEventListener('click', function () { drawSample('你好世界'); });
  recognizeBtn.addEventListener('click', recognize);
  testServerBtn.addEventListener('click', testServer);

  saveEndpointBtn.addEventListener('click', function () {
    var v = endpointInput.value.trim() || DEFAULT_ENDPOINT;
    endpointInput.value = v;
    localStorage.setItem(LS_KEY, v);
    saveEndpointBtn.textContent = '已保存';
    setTimeout(function () { saveEndpointBtn.textContent = '保存'; }, 1200);
    testServer();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.sw'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.sw'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      inkColor = b.dataset.c;
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.wseg button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.wseg button'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      inkWidth = +b.dataset.w;
    });
  });

  copyBtn.addEventListener('click', function () {
    var t = resText.textContent.trim();
    if (!t || resText.classList.contains('empty')) return;
    function done() {
      copyBtn.textContent = '已复制 ✓';
      setTimeout(function () { copyBtn.textContent = '复制'; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(fallbackCopy);
    } else fallbackCopy();
    function fallbackCopy() {
      var ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
      document.body.removeChild(ta);
      done();
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(fit).observe(document.querySelector('.canvas-box'));
  } else {
    window.addEventListener('resize', fit);
  }

  endpointInput.value = localStorage.getItem(LS_KEY) || DEFAULT_ENDPOINT;
  fit();

  /* 供自动化测试使用 */
  window.__hw = {
    exportInkImage: exportInkImage,
    recognize: recognize,
    testServer: testServer,
    setStrokes: function (s) { strokes.length = 0; Array.prototype.push.apply(strokes, s); redraw(); },
    drawSample: drawSample,
    getResult: function () { return resText.textContent; },
    isConfigured: function () { return serverState.dataset.state; },
  };
})();
