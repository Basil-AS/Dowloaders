// Стенд для e2e: собранное расширение (dist/chrome-mv3) в Chromium + макет update.altx-soft.ru.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';

const extPath = path.resolve('dist/chrome-mv3');
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'altx-e2e-'));
export const extId = [...crypto.createHash('sha256').update(extPath).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
export const popupUrl = `chrome-extension://${extId}/popup.html`;
export const SITE = 'https://update.altx-soft.ru';

const PAGE = `<!doctype html><meta charset="utf-8"><title>ALT-X</title>
<script>
var timerID = null;
window.__clockCalls = 0; window.__startClock = 0;
function startClock() { window.__startClock++; updateClock(1800); }
function updateClock(s) { window.__clockCalls++; timerID = setTimeout(function () { updateClock(s - 1); }, 1000); }
</script><body onload="startClock()"><h1>Обновления</h1></body>`;

/**
 * Настоящий локальный HTTPS-сервер вместо подмены ответов: реальные куки и редиректы 302, как у боевого сайта.
 * Браузеру сопоставляем update.altx-soft.ru с этим сервером (host-resolver-rules), адрес для расширения не меняется.
 */
export async function startSite() {
  const dir = path.join(tmp, 'tls');
  fs.mkdirSync(dir, { recursive: true });
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj "/CN=update.altx-soft.ru" -addext "subjectAltName=DNS:update.altx-soft.ru" 2>/dev/null`);
  const state = { pings: [], expired: false };
  const server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const u = new URL(req.url, SITE);
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
    if (u.pathname === '/Login.aspx') return send(200, '<!doctype html><meta charset="utf-8"><title>Вход</title><h1>Вход</h1>');
    if (u.pathname.toLowerCase() === '/default.aspx' && u.searchParams.has('__altx_keepalive')) {
      state.pings.push({ cookie: req.headers.cookie ?? '', mode: req.headers['sec-fetch-site'] });
      return state.expired ? send(302, '', { location: '/Login.aspx' }) : send(200, '<!doctype html><title>ok</title>ok');
    }
    return send(200, PAGE, { 'set-cookie': 'ASP.NET_SessionId=abc123; Path=/; Secure; HttpOnly' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { state, port: server.address().port, close: () => server.close() };
}

export async function launch({ colorScheme = 'light', locale = 'ru-RU' } = {}) {
  const site = await startSite();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, `profile-${colorScheme}-${locale}-${site.port}`), {
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    headless: false,
    colorScheme,
    locale,
    args: ['--headless=new', '--no-sandbox', '--no-proxy-server', '--ignore-certificate-errors', `--host-resolver-rules=MAP update.altx-soft.ru 127.0.0.1:${site.port}`, `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  return { ctx, site, close: async () => { await ctx.close(); site.close(); } };
}

export const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
