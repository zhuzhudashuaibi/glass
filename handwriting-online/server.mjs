#!/usr/bin/env node
/* ============================================================
   手写识别 · 本机转发服务
   - 解决浏览器直连识别接口的跨域限制
   - 识别密钥只保存在本机，不写进网页
   - 默认接入「百度智能云 · 手写文字识别」
   ------------------------------------------------------------
   启动：
     BAIDU_API_KEY=你的AK  BAIDU_SECRET_KEY=你的SK  node server.mjs
   或把这些写进同目录的 config.json：
     { "BAIDU_API_KEY": "...", "BAIDU_SECRET_KEY": "..." }
   然后浏览器打开  http://localhost:8787/
   ============================================================ */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY = 8 * 1024 * 1024; // 8MB

/* ---------- 配置：环境变量优先，其次 config.json ---------- */
let fileConfig = {};
try {
  fileConfig = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
} catch { /* 没有 config.json 就用环境变量 */ }

const cfg = (key) => process.env[key] ?? fileConfig[key] ?? '';

const PROVIDER = (cfg('OCR_PROVIDER') || 'baidu').toLowerCase();
const BAIDU_BASE = cfg('BAIDU_BASE_URL') || 'https://aip.baidubce.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/* ============================================================
   识别提供方：百度手写文字识别
   ============================================================ */
let tokenCache = { value: '', expiresAt: 0 };

async function baiduToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const id = cfg('BAIDU_API_KEY');
  const secret = cfg('BAIDU_SECRET_KEY');
  if (!id || !secret) throw new Error('服务端未配置 BAIDU_API_KEY / BAIDU_SECRET_KEY');

  const url = `${BAIDU_BASE}/oauth/2.0/token?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(`获取 token 失败：${data.error ?? ''} ${data.error_description ?? JSON.stringify(data)}`);
  }
  // 百度 token 默认有效期 30 天，留 5 分钟余量
  tokenCache = { value: data.access_token, expiresAt: Date.now() + ((data.expires_in || 2592000) - 300) * 1000 };
  return tokenCache.value;
}

async function baiduRecognize(imageBase64) {
  const token = await baiduToken();
  const body = new URLSearchParams({ image: imageBase64 });
  const res = await fetch(`${BAIDU_BASE}/rest/2.0/ocr/v1/handwriting?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));

  if (data.error_code === 110 || data.error_code === 111) {
    tokenCache = { value: '', expiresAt: 0 }; // token 失效，清掉缓存下次重取
  }
  if (data.error_code) {
    throw new Error(`百度接口错误 ${data.error_code}: ${data.error_msg || ''}`);
  }
  const lines = (data.words_result || []).map((r) => (r && r.words) || '').filter(Boolean);
  return { text: lines.join('\n') };
}

const providers = {
  baidu: {
    label: '百度手写识别',
    configured: () => !!(cfg('BAIDU_API_KEY') && cfg('BAIDU_SECRET_KEY')),
    recognize: baiduRecognize,
  },
};

function activeProvider() {
  const p = providers[PROVIDER];
  if (!p) throw new Error(`未知的识别提供方：${PROVIDER}（可选：${Object.keys(providers).join(', ')}）`);
  return p;
}

/* ============================================================
   HTTP 服务
   ============================================================ */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（图片超过 8MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);
  const target = resolve(join(ROOT, rel));
  if (!target.startsWith(resolve(ROOT) + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const buf = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (pathname === '/api/handwriting' || pathname === '/api/health') {
    let provider;
    try { provider = activeProvider(); } catch (err) { sendJson(res, 500, { ok: false, error: err.message }); return; }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        provider: provider.label,
        configured: provider.configured(),
      });
      return;
    }

    if (req.method === 'POST') {
      const t0 = Date.now();
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || '{}');
        if (!payload.image || typeof payload.image !== 'string') {
          sendJson(res, 400, { ok: false, error: '缺少 image 字段（应为 base64 图片）' });
          return;
        }
        const base64 = payload.image.replace(/^data:image\/\w+;base64,/, '');
        const out = await provider.recognize(base64, payload);
        sendJson(res, 200, { ok: true, text: out.text, provider: provider.label, ms: Date.now() - t0 });
      } catch (err) {
        sendJson(res, 502, { ok: false, error: err.message || String(err) });
      }
      return;
    }

    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  const provider = providers[PROVIDER];
  const ready = provider && provider.configured();
  console.log(`\n  手写识别转发服务已启动`);
  console.log(`  地址：http://localhost:${PORT}/`);
  console.log(`  提供方：${provider ? provider.label : PROVIDER}`);
  console.log(`  密钥：${ready ? '已配置 ✓' : '未配置 ✗  （请在环境变量或 config.json 里填写密钥）'}`);
  console.log(`  接口：POST /api/handwriting   GET /api/handwriting（健康检查）\n`);
});
