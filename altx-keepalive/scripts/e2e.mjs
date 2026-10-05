// E2E: npm run build && npm run e2e
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanup, launch, popupUrl, SITE } from './harness.mjs';

const results = [];
const check = async (name, fn) => {
  let r;
  try { await fn(); r = ['ok', name]; } catch (e) { r = ['FAIL', `${name}: ${String(e.message).split('\n')[0]}`]; }
  results.push(r);
  if (process.env.DEBUG_E2E) console.log(r[0] === 'ok' ? '  ✓' : '  ✗', r[1]);
};
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const bg = p => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const statusText = p => p.locator('.state-main').textContent();
const mainWorld = (page, fn) => page.evaluate(fn);

// ───── 1. Русский, светлая тема ─────
const { ctx, site, close } = await launch({ colorScheme: 'light', locale: 'ru-RU' });
const tab = await ctx.newPage();
await tab.goto(`${SITE}/default.aspx`);
const pop = await ctx.newPage();
await pop.goto(popupUrl);
await pop.waitForSelector('.popup');

await check('часы сайта отключены (updateClock подменён, штатный таймер не тикает)', async () => {
  await tab.waitForFunction(() => window.updateClock?.[Symbol.for('altx-keepalive.noop')] === true, null, { timeout: 5000 });
  const before = await mainWorld(tab, () => window.__clockCalls);
  await tab.waitForTimeout(2500);
  assert.equal(await mainWorld(tab, () => window.__clockCalls), before);
});
await check('popup: язык и тема браузера (ru, светлая)', async () => {
  assert.match(await pop.textContent('h1 + p'), /altx-soft/);
  assert.ok(await pop.getByRole('button', { name: 'Продлить сейчас' }).isVisible());
  assert.equal(await bg(pop), 'rgb(245, 246, 249)');
});
await check('будильник создан с интервалом 10 минут', async () => {
  const a = await pop.evaluate(() => chrome.alarms.get('keepalive'));
  assert.equal(a.periodInMinutes, 10);
});
await check('«Продлить сейчас»: GET /default.aspx с куками сайта, статус «Сессия продлена»', async () => {
  const n = site.state.pings.length;
  await pop.getByRole('button', { name: 'Продлить сейчас' }).click();
  await pop.waitForFunction(() => /Сессия продлена/.test(document.querySelector('.state-main')?.textContent ?? ''), null, { timeout: 8000 });
  assert.equal(site.state.pings.length, n + 1);
  assert.match(site.state.pings.at(-1).cookie, /ASP\.NET_SessionId=abc123/);
  assert.equal(site.state.pings.at(-1).mode, 'same-origin');
  assert.match(await pop.locator('.kv').textContent(), /200/);
});
if (shots) await pop.screenshot({ path: `${shots}/ok-light-ru.png`, fullPage: true });
await check('интервал 5 минут перенастраивает будильник', async () => {
  await pop.locator('#iv').selectOption('5');
  await pop.waitForTimeout(500);
  assert.equal((await pop.evaluate(() => chrome.alarms.get('keepalive'))).periodInMinutes, 5);
});
await check('сервер завершил сессию (редирект на вход) → «Сессия завершена»', async () => {
  site.state.expired = true;
  await pop.getByRole('button', { name: 'Продлить сейчас' }).click();
  await pop.waitForFunction(() => /Сессия завершена/.test(document.querySelector('.state-main')?.textContent ?? ''), null, { timeout: 8000 });
  site.state.expired = false;
});
if (shots) await pop.screenshot({ path: `${shots}/expired-light-ru.png`, fullPage: true });
await check('журнал хранит последние запросы', async () => {
  await pop.locator('summary', { hasText: 'Журнал' }).click();
  assert.ok((await pop.locator('.log li').count()) >= 2);
});
await check('вкладка на странице входа: запрос не отправляется, «Нужно войти»', async () => {
  await tab.goto(`${SITE}/Login.aspx`);
  const n = site.state.pings.length;
  await pop.getByRole('button', { name: 'Продлить сейчас' }).click();
  await pop.waitForFunction(() => /Нужно войти/.test(document.querySelector('.state-main')?.textContent ?? ''), null, { timeout: 8000 });
  assert.equal(site.state.pings.length, n);
});
await check('выключение: оригинальная updateClock возвращена, штатный отсчёт запущен', async () => {
  await tab.goto(`${SITE}/default.aspx`);
  await tab.waitForFunction(() => window.updateClock?.[Symbol.for('altx-keepalive.noop')] === true, null, { timeout: 5000 });
  const startBefore = await mainWorld(tab, () => window.__startClock);
  await pop.locator('.switch').click();
  await tab.waitForFunction(() => !window.updateClock?.[Symbol.for('altx-keepalive.noop')], null, { timeout: 5000 });
  assert.ok((await mainWorld(tab, () => window.__startClock)) > startBefore);
  assert.match(await statusText(pop), /Выключено/);
  assert.equal(await pop.getByRole('button', { name: 'Продлить сейчас' }).isDisabled(), true);
  assert.equal(await pop.evaluate(() => chrome.alarms.get('keepalive')), undefined);
});
if (shots) await pop.screenshot({ path: `${shots}/off-light-ru.png`, fullPage: true });
await check('повторное включение: часы снова отключены, запрос выполнен сразу', async () => {
  const n = site.state.pings.length;
  await pop.locator('.switch').click();
  await tab.waitForFunction(() => window.updateClock?.[Symbol.for('altx-keepalive.noop')] === true, null, { timeout: 5000 });
  await pop.waitForFunction(() => /Сессия продлена/.test(document.querySelector('.state-main')?.textContent ?? ''), null, { timeout: 8000 });
  assert.ok(site.state.pings.length > n);
});
await check('нет вкладки сайта → «Откройте вкладку»', async () => {
  await tab.close();
  await pop.getByRole('button', { name: 'Продлить сейчас' }).click();
  await pop.waitForFunction(() => /Откройте вкладку/.test(document.querySelector('.state-main')?.textContent ?? ''), null, { timeout: 8000 });
});
await check('явная тёмная тема и английский язык из настроек popup', async () => {
  await pop.locator('summary', { hasText: 'Оформление' }).click();
  await pop.getByLabel('Тёмная').check({ force: true });
  await pop.waitForTimeout(300);
  assert.equal(await pop.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await bg(pop), 'rgb(20, 23, 31)');
  await pop.locator('#lg').selectOption('en');
  await pop.waitForTimeout(300);
  assert.ok(await pop.getByRole('button', { name: 'Renew now' }).isVisible());
  if (shots) await pop.screenshot({ path: `${shots}/dark-en.png`, fullPage: true });
});
await close();

// ───── 2. Браузер: тёмная тема + английский, настройки не трогаем ─────
{
  const { ctx: c2, close: close2 } = await launch({ colorScheme: 'dark', locale: 'en-US' });
  const p = await c2.newPage();
  await p.goto(popupUrl);
  await p.waitForSelector('.popup');
  await check('браузер dark + en-US → popup тёмный и на английском', async () => {
    assert.equal(await bg(p), 'rgb(20, 23, 31)');
    assert.ok(await p.getByRole('button', { name: 'Renew now' }).isVisible());
    assert.match(await statusText(p), /Waiting|Open a tab|Off|renewed/);
  });
  if (shots) await p.screenshot({ path: `${shots}/browser-dark-en.png`, fullPage: true });
  await close2();
}

cleanup();
for (const [st, n] of results) console.log(st === 'ok' ? '✓' : '✗', n);
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
