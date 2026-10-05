// Общий стенд для e2e и скриншотов: собранное расширение (dist/chrome-mv3) в Chromium + моки площадок.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  article: { url: 'https://blog.example.com/posts/hello', html: `<html><head><title>Привет, мир | Блог</title></head><body><nav><a href="/">Главная</a></nav><article><h1>Привет, мир</h1>${'<p>Это длинный абзац обычного текста статьи, в котором достаточно слов, запятых, и смысла для того, чтобы алгоритм выделения основного содержимого признал его частью материала. <a href="https://example.org/x">источник</a></p>'.repeat(8)}</article><footer>Подвал сайта</footer></body></html>` },
  unsupported: { url: 'https://example.com/', html: '<html><body>x</body></html>' },
};

export async function launch({ colorScheme = 'light', locale = 'ru-RU' } = {}) {
const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile-' + colorScheme + locale), {
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', headless: false, acceptDownloads: true, colorScheme, locale,
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


return ctx;
}
export { extId, SITES };

export const popupUrl = `chrome-extension://${extId}/popup.html`;
export const optionsUrl = `chrome-extension://${extId}/options.html`;

/** Открывает страницу сайта и popup расширения, привязанный к её вкладке. */
export async function openPopup(ctx, siteUrl, viewport) {
  const page = await ctx.newPage();
  await page.goto(siteUrl);
  const pop = await ctx.newPage(viewport ? { viewport } : undefined);
  await pop.goto(popupUrl);
  const tabId = await pop.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u).id, siteUrl);
  await pop.goto(`${popupUrl}?tabId=${tabId}`);
  await pop.waitForSelector('.popup');
  await pop.waitForFunction(() => document.querySelector('.where')?.textContent !== '');
  return { page, pop };
}

export const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
