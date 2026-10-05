// E2E: грузит собранное расширение (dist/chrome-mv3) в Chromium и гоняет popup/настройки на моках площадок.
// Запуск: npm run build && npm run e2e
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dist = path.resolve('dist/chrome-mv3');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fas-e2e-'));
const extPath = path.join(tmp, 'ext');
fs.cpSync(dist, extPath, { recursive: true });
// activeTab нельзя получить без реального клика по иконке → в тестовой копии даём host_permissions
const mf = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
mf.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify(mf));
const extId = [...crypto.createHash('sha256').update(extPath).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

const enc = s => Buffer.from([...s].map(c => { const n = c.charCodeAt(0); return n >= 0x410 && n <= 0x44f ? n - 0x410 + 0xc0 : n < 128 ? n : 63; }));
const mkPost = n => ({ id: 1000 + n, post_number: n, username: 'user' + n, name: n % 2 ? 'Имя ' + n : 'user' + n, created_at: '2024-05-01T10:00:00Z', reply_to_post_number: n > 1 ? n - 1 : null, actions_summary: [{ id: 2, count: n % 3 }],
  cooked: n === 2 ? '<aside class="quote"><div class="title">user1:</div><blockquote><p>цитата 1</p></blockquote></aside><p>ответ <a href="https://x.io">ссылка</a></p><pre><code>ls -la</code></pre>' : `<p>пост номер ${n}</p>` });
const stream = Array.from({ length: 45 }, (_, i) => 1001 + i);
const topic = { title: 'Блокировка Telegram', slug: 'slug', created_at: '2024-05-01T10:00:00Z', tags: ['a'], post_stream: { stream, posts: stream.slice(0, 20).map(i => mkPost(i - 1000)) } };
const t1 = (id, parent, body) => ({ kind: 't1', data: { id, name: 't1_' + id, parent_id: parent, author: 'u' + id, body, score: 3, created_utc: 1712000000, replies: '' } });
const pda = '<table class="ipbtable" data-post="1"><tr><td class="row2" id="ph-1-d2">01.01.24 Сообщение #1</td><td><span class="normalname"><a>Вася</a></span><a title="Ссылка на это сообщение">1</a></td><td><div class="postcolor">привет<div>блок</div></div></td></tr></table>';
const SITES = {
  discourse: { url: 'https://ntc.party/t/slug/18333/178', html: '<html><head><meta name="generator" content="Discourse 3.3"></head><body>x</body></html>', paged: true },
  habr: { url: 'https://habr.com/ru/news/806591/', html: '<html><body>x</body></html>', comments: true },
  reddit: { url: 'https://www.reddit.com/r/K/comments/p/slug/', html: '<html><body>x</body></html>', comments: true },
  '4pda': { url: 'https://4pda.to/forum/index.php?showtopic=1', html: '<html><body><h1 itemprop="name">Тема 4pda</h1><span class="pagelink-menu">1 страниц</span></body></html>', paged: true },
  unsupported: { url: 'https://example.com/', html: '<html><body>x</body></html>' },
};

const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', headless: false, acceptDownloads: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
await ctx.route('**/*', r => {
  const u = new URL(r.request().url());
  const j = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (u.protocol === 'chrome-extension:') return r.continue();
  if (u.host === 'ntc.party') {
    if (u.pathname === '/t/18333.json') return j(topic);
    if (u.pathname === '/t/18333/posts.json') return j({ post_stream: { posts: u.searchParams.getAll('post_ids[]').map(Number).map(i => mkPost(i - 1000)) } });
  }
  if (u.host === 'habr.com') {
    if (u.pathname.endsWith('/comments/')) return j({ threads: [1], comments: { 1: { id: 1, parentId: 0, author: { alias: 'a' }, timePublished: '2024-04-01T11:00:00Z', score: 5, message: '<p>корень</p>' } } });
    if (u.pathname.includes('/kek/v2/')) return j({ titleHtml: 'Habr тест', author: { alias: 'v' }, timePublished: '2024-04-01T10:00:00Z', textHtml: '<p>текст</p>' });
  }
  if (u.host === 'www.reddit.com' && u.pathname.includes('.json')) return j([{ data: { children: [{ data: { title: 'Reddit тест', selftext: 'т', author: 'op', subreddit: 'K', score: 1, num_comments: 1, created_utc: 1712000000, is_self: true } }] } }, { data: { children: [t1('a', 't3_p', 'коммент')] } }]);
  if (u.host === '4pda.to' && u.searchParams.has('st')) return r.fulfill({ status: 200, contentType: 'text/html; charset=windows-1251', body: enc(`<html><body>${pda}</body></html>`) });
  const s = Object.values(SITES).find(s => new URL(s.url).host === u.host);
  return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: s?.html ?? 'x' });
});

const closeAll = async (...ps) => { for (const p of ps) await p.close().catch(() => {}); };
const popupUrl = `chrome-extension://${extId}/popup.html`;
const results = [];
const check = async (name, fn) => { let r; try { await fn(); r = ['ok', name]; } catch (e) { r = ['FAIL', name + ': ' + e.message.split('\n')[0]]; } results.push(r); if (process.env.DEBUG_E2E) console.log(r[0] === 'ok' ? '  ✓' : '  ✗', r[1]); };

async function openPopup(siteUrl) {
  const page = await ctx.newPage();
  await page.goto(siteUrl);
  const pop = await ctx.newPage();
  await pop.goto(popupUrl);
  const tabId = await pop.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u).id, siteUrl);
  await pop.goto(`${popupUrl}?tabId=${tabId}`);
  await pop.waitForSelector('.badge');
  await pop.waitForFunction(() => document.querySelector('.badge').textContent !== '…');
  return { page, pop };
}
async function runDownload(page, pop, btnText = 'Скачать') {
  pop.on('console', m => process.env.DEBUG_E2E && console.log('  [popup]', m.text()));
  page.on('console', m => process.env.DEBUG_E2E && console.log('  [page]', m.text()));
  const dl = page.waitForEvent('download', { timeout: 15000 });
  dl.catch(() => {});
  await pop.getByRole('button', { name: btnText, exact: true }).click();
  const d = await dl;
  await pop.waitForSelector('.msg.ok, .msg.err', { timeout: 15000 });
  const msg = await pop.textContent('.msg');
  return { name: msg.split('\n')[1] ?? '', text: fs.readFileSync(await d.path(), 'utf8'), msg };
}


const anchor = await ctx.newPage(); // держит окно открытым
await anchor.goto('about:blank');
// --- 1. настройки: формат Markdown сохраняется ---
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${extId}/options.html`);
await opt.waitForSelector('select');
await opt.locator('select').nth(1).selectOption('ru'); // язык браузера в headless — en
await opt.waitForTimeout(300);
await opt.locator('select').first().selectOption('md');
await opt.waitForTimeout(300);
await check('настройки: превью имени файла получило .md', async () => assert.ok((await opt.textContent('code')).endsWith('.md')));
await opt.reload();
await opt.waitForSelector('select');
await check('настройки: значение пережило перезагрузку', async () => assert.equal(await opt.locator('select').first().inputValue(), 'md'));

// --- 2. все площадки: определение + скачивание в Markdown ---
for (const [name, s] of Object.entries(SITES)) {
  if (process.env.DEBUG_E2E) console.log('>>', name);
  const { page, pop } = await openPopup(s.url);
  const badge = await pop.textContent('.badge');
  if (name === 'unsupported') { await check('unsupported: сообщение', () => assert.match(badge, /не поддерживается/)); await closeAll(pop, page); continue; }
  await check(`${name}: определён`, () => assert.match(badge, /Определено/));
  await check(`${name}: ползунок объёма ${s.paged ? 'есть' : 'скрыт'}`, async () => assert.equal(await pop.locator('input[type=range]').count(), s.paged ? 1 : 0));
  await check(`${name}: переключатель комментариев ${s.comments ? 'есть' : 'скрыт'}`, async () => assert.equal(await pop.locator('input[type=checkbox]').count(), s.comments ? 1 : 0));
  let out;
  await check(`${name}: скачивание .md`, async () => {
    out = await runDownload(page, pop);
    assert.ok(out.name.endsWith('.md'), out.name);
    assert.match(out.text, /^# /);
  });
  if (!out) continue;
  if (name === 'discourse') {
    await check('discourse: 45 постов, цитата и код', () => {
      assert.equal((out.text.match(/^\*\*#\d+ /gm) || []).length, 45);
      assert.match(out.text, /> user1:/);
      assert.match(out.text, /```\nls -la\n```/);
      assert.match(out.name, /ntc\.party/);
    });
    await check('discourse: «последние 20%» → 9 постов', async () => {
      await pop.locator('input[type=range]').fill('20');
      const o2 = await runDownload(page, pop);
      assert.equal((o2.text.match(/^\*\*#\d+ /gm) || []).length, 9);
    });
    await check('discourse: копирование возвращает текст', async () => {
      await pop.locator('select').selectOption('json');
      const dl = await runDownload(page, pop);
      assert.equal(JSON.parse(dl.text).items.length, 9);
      await pop.locator('select').selectOption('md'); // настройка глобальная — вернуть для следующих сайтов
    });
  }
  if (name === 'habr') {
    await check('habr: комментарии выключаются', async () => {
      await pop.locator('input[type=checkbox]').uncheck();
      const o2 = await runDownload(page, pop);
      assert.doesNotMatch(o2.text, /корень/);
      assert.match(o2.text, /текст/);
    });
  }
  await closeAll(pop, page);
}

// --- 3. история ---
const { pop: hp } = await openPopup(SITES.habr.url);
await check('история: записи видны в popup', async () => assert.ok((await hp.locator('.hist li').count()) >= 3));
await check('история: очистка', async () => { await hp.getByRole('button', { name: 'Очистить' }).click(); await hp.waitForTimeout(300); assert.equal(await hp.locator('.hist li').count(), 0); });

// --- 4. «Все вкладки» (host-права в тестовой копии уже выданы) ---
for (const k of ['discourse', 'reddit', '4pda']) await (await ctx.newPage()).goto(SITES[k].url);
await check('все вкладки: сохраняет поддерживаемые', async () => {
  await hp.getByRole('button', { name: 'Все вкладки', exact: true }).click();
  await hp.waitForFunction(() => /Все вкладки: \d+\/\d+/.test(document.querySelector('.msg')?.textContent ?? ''), null, { timeout: 30000 });
  const m = (await hp.textContent('.msg')).match(/(\d+)\/(\d+)/);
  assert.ok(Number(m[1]) >= 4 && m[1] === m[2], m[0]);
});

await ctx.close();
fs.rmSync(tmp, { recursive: true, force: true });
for (const [st, n] of results) console.log(st === 'ok' ? '✓' : '✗', n);
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
