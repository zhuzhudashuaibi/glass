import { AnalyzedCharacter, Matcher, data, decodeCompact } from './vendor/hanzilookup.esm.js';

/* ============================================================
   手写汉字识别 · 前端逻辑
   - 画板：鼠标 / 触屏 / 手写笔，压感与笔速控制笔画粗细
   - 识别：HanziLookup 引擎，字与字之间按横向间隙自动切分
   - 全程在浏览器本地运行，手写内容不上传
   ============================================================ */

/* 模型数据来源：优先本地，失败时回退到 CDN */
const DATA_SOURCES = [
  './data/mmah.json',
  'https://cdn.jsdelivr.net/gh/gugray/HanziLookupJS@master/dist/mmah.json',
];

const SAMPLES_URL = './data/samples.json';

const MAX_CANDIDATES = 8;      // 每个字返回的候选数
const IDLE_DELAY = 650;        // 停笔多久后自动识别
const BASE_WIDTH = 3.4;        // 基础笔画宽度（px）
const INK_COLOR = '#1b1a18';

/* ---------- DOM ---------- */
const els = {
  board: document.getElementById('board'),
  canvas: document.getElementById('canvas'),
  hint: document.getElementById('boardHint'),
  overlay: document.getElementById('overlay'),
  overlayText: document.getElementById('overlayText'),
  btnRetry: document.getElementById('btnRetry'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  btnDemo: document.getElementById('btnDemo'),
  btnUndo: document.getElementById('btnUndo'),
  btnClear: document.getElementById('btnClear'),
  btnRecognize: document.getElementById('btnRecognize'),
  btnCopy: document.getElementById('btnCopy'),
  resultText: document.getElementById('resultText'),
  resultMeta: document.getElementById('resultMeta'),
  candidates: document.getElementById('candidates'),
  correctHint: document.getElementById('correctHint'),
};

const ctx = els.canvas.getContext('2d');

/* ---------- 状态 ---------- */
const STATE = {
  strokes: [],        // [{ points: [{x, y, w}] }]
  clusters: [],       // [{ strokeIdx: number[], matches: CharacterMatch[], selected: number }]
  drawing: null,      // 当前正在书写的笔画
  pointerId: null,
  ready: false,
  idleTimer: 0,
  width: 0,
  height: 0,
  dpr: 1,
  lastPointTime: 0,
};

let matcher = null;
let samples = null;

/* ============================================================
   1. 画板尺寸与重绘
   ============================================================ */

function setupCanvas() {
  const rect = els.board.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);

  // 尺寸变化时按比例缩放已有笔迹
  if (STATE.width > 0 && STATE.height > 0) {
    const sx = width / STATE.width;
    const sy = height / STATE.height;
    for (const stroke of STATE.strokes) {
      for (const p of stroke.points) { p.x *= sx; p.y *= sy; }
    }
  }

  STATE.width = width;
  STATE.height = height;
  STATE.dpr = dpr;
  els.canvas.width = Math.round(width * dpr);
  els.canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK_COLOR;
  redraw();
}

function clearCanvas() {
  ctx.clearRect(0, 0, STATE.width, STATE.height);
}

function redraw() {
  clearCanvas();
  for (const stroke of STATE.strokes) paintStroke(stroke.points);
  if (STATE.drawing && STATE.drawing.points.length) paintStroke(STATE.drawing.points);
  els.hint.hidden = STATE.strokes.length > 0 || !!STATE.drawing;
}

/* 绘制整条笔迹（用于重绘） */
function paintStroke(points) {
  const n = points.length;
  if (!n) return;
  if (n === 1) { dot(points[0]); return; }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
  ctx.lineWidth = points[0].w;
  ctx.stroke();

  for (let i = 1; i < n - 1; i++) {
    quadratic(points[i - 1], points[i], points[i + 1], points[i].w);
  }

  const last = points[n - 1];
  const prev = points[n - 2];
  ctx.beginPath();
  ctx.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2);
  ctx.lineTo(last.x, last.y);
  ctx.lineWidth = last.w;
  ctx.stroke();
}

/* 增量绘制最新一段（书写过程中调用，避免整板重绘） */
function paintHead(points) {
  const n = points.length;
  if (n === 1) { dot(points[0]); return; }
  if (n === 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineWidth = (points[0].w + points[1].w) / 2;
    ctx.stroke();
    return;
  }
  const [a, b, c] = [points[n - 3], points[n - 2], points[n - 1]];
  quadratic(a, b, c, b.w);
}

function quadratic(a, b, c, width) {
  ctx.beginPath();
  ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
  ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
  ctx.lineWidth = width;
  ctx.stroke();
}

function dot(p) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
  ctx.fillStyle = INK_COLOR;
  ctx.fill();
}

/* ============================================================
   2. 书写交互
   ============================================================ */

function pointFromEvent(e) {
  const rect = els.board.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const prev = STATE.drawing && STATE.drawing.points.length
    ? STATE.drawing.points[STATE.drawing.points.length - 1]
    : null;

  const now = e.timeStamp || performance.now();
  const dt = prev ? Math.max(now - STATE.lastPointTime, 1) : 16;
  const dist = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;

  // 笔速越快笔画越细；手写笔按住时按压力度调整
  let w = BASE_WIDTH * (1.28 - 0.62 * Math.min(dist / dt / 1.5, 1));
  if (e.pointerType === 'pen' && e.pressure > 0 && e.pressure < 1) {
    w *= 0.55 + 1.35 * e.pressure;
  }
  w = Math.max(1.15, Math.min(w, BASE_WIDTH * 1.5));

  STATE.lastPointTime = now;
  return { x, y, w };
}

function onPointerDown(e) {
  if (!STATE.ready) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.pointerType === 'pen' && e.button === 5) return; // 笔上的橡皮键

  STATE.pointerId = e.pointerId;
  STATE.drawing = { points: [] };
  STATE.lastPointTime = e.timeStamp || performance.now();
  els.canvas.setPointerCapture?.(e.pointerId);

  const p = pointFromEvent(e);
  STATE.drawing.points.push(p);
  dot(p);
  els.hint.hidden = true;
  e.preventDefault();
}

function onPointerMove(e) {
  if (!STATE.drawing || e.pointerId !== STATE.pointerId) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const p = pointFromEvent(ev);
    const prev = STATE.drawing.points[STATE.drawing.points.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.4) continue;
    STATE.drawing.points.push(p);
    paintHead(STATE.drawing.points);
  }
  e.preventDefault();
}

function onPointerUp(e) {
  if (!STATE.drawing || e.pointerId !== STATE.pointerId) return;
  STATE.pointerId = null;
  const stroke = STATE.drawing;
  STATE.drawing = null;
  if (stroke.points.length) {
    STATE.strokes.push(stroke);
    paintStroke(stroke.points);           // 补上收笔的最后半段
    scheduleRecognize();
  }
  els.hint.hidden = STATE.strokes.length > 0;
}

function undo() {
  if (STATE.drawing) return;
  if (!STATE.strokes.length) return;
  STATE.strokes.pop();
  redraw();
  if (STATE.strokes.length) scheduleRecognize(0);
  else clearResults();
}

function clearAll() {
  STATE.strokes = [];
  STATE.drawing = null;
  redraw();
  clearResults();
  setStatus('ready', '就绪 · 可以开始写字了');
}

/* ============================================================
   3. 笔画切分 + 识别
   ============================================================ */

/** 按横向间隙把笔画分组成一个个汉字 */
function segmentStrokes(strokes) {
  const boxes = strokes.map((s) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, x1, y0, y1 };
  });

  const inkHeight = Math.max(...boxes.map((b) => b.y1 - b.y0), 1);
  // 字间距阈值：约合字高的 30%，低于此值视为同一个字的笔画
  const threshold = Math.max(14, inkHeight * 0.3);
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0);

  const clusters = [];
  let current = null;
  for (const i of order) {
    const b = boxes[i];
    if (current && b.x0 - current.right <= threshold) {
      current.strokeIdx.push(i);
      current.right = Math.max(current.right, b.x1);
      current.left = Math.min(current.left, b.x0);
    } else {
      current = { strokeIdx: [i], left: b.x0, right: b.x1 };
      clusters.push(current);
    }
  }
  // 簇内必须保持书写顺序：识别引擎按笔顺对齐，打乱顺序会显著降低准确率
  for (const c of clusters) c.strokeIdx.sort((a, b) => a - b);
  return clusters.sort((a, b) => a.left - b.left);
}

function scheduleRecognize(delay = IDLE_DELAY) {
  clearTimeout(STATE.idleTimer);
  STATE.idleTimer = setTimeout(recognize, delay);
}

function recognize() {
  clearTimeout(STATE.idleTimer);
  if (!STATE.ready || !matcher) return;

  const strokes = STATE.strokes.filter((s) => s.points.length > 0);
  if (!strokes.length) { clearResults(); return; }

  setStatus('busy', '识别中…');
  const t0 = performance.now();

  STATE.clusters = segmentStrokes(strokes).map((cluster) => {
    const raw = cluster.strokeIdx.map((i) => {
      const pts = strokes[i].points.map((p) => [p.x, p.y]);
      // 单点笔画（点）补一个重复点，避免引擎内部越界
      return pts.length === 1 ? [pts[0].slice(), pts[0].slice()] : pts;
    });
    let matches = [];
    try {
      matcher.match(new AnalyzedCharacter(raw), MAX_CANDIDATES, (m) => { matches = m; });
    } catch (err) {
      console.warn('[手写识别] 匹配失败：', err);
    }
    return { strokeIdx: cluster.strokeIdx, matches, selected: 0 };
  });

  renderResults(performance.now() - t0);
  if (STATE.clusters.length) {
    setStatus('ready', `就绪 · 识别到 ${STATE.clusters.length} 个字`);
  }
}

/* ============================================================
   4. 结果渲染
   ============================================================ */

function clearResults() {
  STATE.clusters = [];
  els.resultText.innerHTML = '<span class="placeholder">写几个字试试，结果会显示在这里</span>';
  els.resultMeta.textContent = '';
  els.candidates.innerHTML = '';
  els.btnCopy.disabled = true;
  els.correctHint.hidden = true;
}

function currentText() {
  return STATE.clusters
    .map((c) => (c.matches[c.selected] ? c.matches[c.selected].character : ''))
    .join('');
}

function renderResults(ms) {
  els.candidates.innerHTML = '';
  els.resultText.textContent = currentText();
  els.btnCopy.disabled = STATE.clusters.length === 0;

  const hasAlternatives = STATE.clusters.some((c) => c.matches.length > 1);
  els.correctHint.hidden = !hasAlternatives;

  STATE.clusters.forEach((cluster, index) => {
    const card = document.createElement('div');
    card.className = 'charcard';

    const idx = document.createElement('span');
    idx.className = 'index';
    idx.textContent = String(index + 1);
    card.appendChild(idx);

    const thumb = document.createElement('canvas');
    thumb.className = 'thumb';
    drawThumb(thumb, cluster);
    card.appendChild(thumb);

    const cands = document.createElement('div');
    cands.className = 'cands';
    cluster.matches.forEach((match, mi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cand';
      btn.textContent = match.character;
      btn.title = `候选「${match.character}」`;
      btn.setAttribute('aria-pressed', String(mi === cluster.selected));
      btn.addEventListener('click', () => {
        cluster.selected = mi;
        [...cands.children].forEach((el, i) => el.setAttribute('aria-pressed', String(i === mi)));
        els.resultText.textContent = currentText();
      });
      cands.appendChild(btn);
    });
    card.appendChild(cands);
    els.candidates.appendChild(card);
  });

  els.resultMeta.textContent = `共 ${STATE.clusters.length} 个字 · 用时 ${ms.toFixed(0)} ms`;
}

/** 画一个字所对应的笔迹缩略图 */
function drawThumb(canvas, cluster) {
  const size = 58;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = INK_COLOR;

  const strokes = cluster.strokeIdx.map((i) => STATE.strokes[i]).filter(Boolean);
  if (!strokes.length) return;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
  }
  const pad = 7;
  const scale = Math.min((size - pad * 2) / Math.max(x1 - x0, 1), (size - pad * 2) / Math.max(y1 - y0, 1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  for (const s of strokes) {
    const pts = s.points.length === 1 ? [s.points[0], s.points[0]] : s.points;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = size / 2 + (pts[i].x - cx) * scale;
      const py = size / 2 + (pts[i].y - cy) * scale;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.lineWidth = 2;
    c.stroke();
  }
}

async function copyResult() {
  const text = currentText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* 忽略 */ }
    ta.remove();
  }
  const label = els.btnCopy.textContent;
  els.btnCopy.textContent = '已复制 ✓';
  setTimeout(() => { els.btnCopy.textContent = label; }, 1400);
}

/* ============================================================
   5. 状态显示
   ============================================================ */

function setStatus(state, text) {
  els.status.dataset.state = state;
  els.statusText.textContent = text;
}

function setOverlay(show, text, isError = false) {
  els.overlay.hidden = !show;
  els.overlay.dataset.error = isError ? '1' : '0';
  els.btnRetry.hidden = !isError;
  if (text) els.overlayText.textContent = text;
}

/* ============================================================
   6. 模型加载
   ============================================================ */

async function fetchText(url, onProgress) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.text();

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(buffer);
}

/** 把 JSON 文本装载成可用的识别引擎 */
function installModel(text) {
  const parsed = JSON.parse(text);
  parsed.substrokes = decodeCompact(parsed.substrokes);
  data['mmah'] = parsed;
  matcher = new Matcher('mmah');
  STATE.ready = true;
  setOverlay(false);
  setStatus('ready', '就绪 · 可以开始写字了');
  return true;
}

async function loadModel() {
  setStatus('loading', '正在加载识别模型…');
  setOverlay(true, '加载识别模型…');

  // 单文件版本：字符数据直接内嵌在页面中，无需任何网络请求
  const bundled = document.getElementById('mmahData');
  if (bundled && bundled.textContent.trim().length > 8) {
    try {
      installModel(bundled.textContent);
      return;
    } catch (err) {
      console.warn('[手写识别] 内嵌数据解析失败：', err);
    }
  }

  for (const url of DATA_SOURCES) {
    try {
      const text = await fetchText(url, (pct) => setOverlay(true, `加载识别模型 ${pct}%`));
      installModel(text);
      return;
    } catch (err) {
      console.warn('[手写识别] 模型数据加载失败：', url, err);
    }
  }

  setOverlay(true, '识别模型加载失败，请检查网络后重试。', true);
  setStatus('error', '模型加载失败');
}

/* ============================================================
   7. 示例笔迹（演示用）
   ============================================================ */

function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** 用参考字形数据生成一段"手写"笔迹，并与真实书写走同一套识别流程 */
async function drawSample(text = '你好世界') {
  if (!STATE.ready) return false;
  if (!samples) {
    const bundled = document.getElementById('samplesData');
    if (bundled && bundled.textContent.trim().length > 8) {
      try { samples = JSON.parse(bundled.textContent); } catch { samples = {}; }
    } else {
      try {
        samples = await (await fetch(SAMPLES_URL)).json();
      } catch (err) {
        console.warn('[手写识别] 示例数据加载失败：', err);
        samples = {};
      }
    }
  }

  const chars = [...text].filter((ch) => samples[ch]);
  if (!chars.length) return false;

  const W = STATE.width;
  const H = STATE.height;
  const cell = Math.min(H * 0.66, (W - 36) / chars.length);
  const startX = (W - cell * chars.length) / 2;
  const topY = (H - cell) / 2;

  const strokes = [];
  chars.forEach((ch, i) => {
    const medians = samples[ch];
    const b = bbox(medians.flat());
    const scale = Math.min((cell * 0.76) / Math.max(b.w, 1), (cell * 0.76) / Math.max(b.h, 1));
    const cx = startX + i * cell + cell / 2;
    const cy = topY + cell / 2;
    for (const median of medians) {
      // 直接使用参考字形的原始折线顶点：引擎在这类"拐点采样"下判别最准
      const mapped = median.map(([x, y]) => [(x - b.cx) * scale + cx, -(y - b.cy) * scale + cy]);
      strokes.push({ points: mapped.map(([x, y]) => ({ x, y, w: BASE_WIDTH * 0.95 })) });
    }
  });

  STATE.strokes = strokes;
  redraw();
  recognize();
  return true;
}

/* ============================================================
   8. 事件绑定与初始化
   ============================================================ */

els.canvas.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

els.btnUndo.addEventListener('click', undo);
els.btnClear.addEventListener('click', clearAll);
els.btnRecognize.addEventListener('click', () => recognize());
els.btnCopy.addEventListener('click', copyResult);
els.btnDemo.addEventListener('click', () => drawSample('你好世界'));
els.btnRetry.addEventListener('click', () => { loadModel(); });

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => setupCanvas()).observe(els.board);
} else {
  window.addEventListener('resize', setupCanvas);
}

setupCanvas();
loadModel();

/* 供自动化测试使用的调试接口 */
window.__hw = {
  isReady: () => STATE.ready,
  drawSample,
  recognize,
  getResultText: () => currentText(),
  getClusters: () => STATE.clusters.map((c) => ({
    selected: c.selected,
    candidates: c.matches.map((m) => m.character),
  })),
  setStrokes: (strokes) => { STATE.strokes = strokes; redraw(); recognize(); },
  dump: () => ({
    size: { w: STATE.width, h: STATE.height },
    strokes: STATE.strokes.map((s) => s.points.map((p) => [p.x, p.y])),
    clusters: STATE.clusters.map((c) => ({ strokeIdx: c.strokeIdx, selected: c.selected })),
  }),
  sampleChars: () => Object.keys(samples || {}),
};
