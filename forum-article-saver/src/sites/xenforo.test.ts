import { afterEach, describe, expect, it, vi } from 'vitest';
import { xenforo, parsePosts, parseThreadUrl } from './xenforo';
import { ADAPTERS } from './index';
import { pickAdapter } from '../core/run';
import { PausedError } from '../core/http';
import { TtlCache } from '../core/cache';
import { toExtractOptions, DEFAULT_SETTINGS } from '../core/settings-model';
import type { Ctx } from '../core/types';

const o = toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' });
const noop = () => {};
const post = (id: number, author: string, body: string, extra = '') =>
  `<article class="message message--post" data-author="${author}" data-content="post-${id}" id="js-post-${id}"><div class="message-inner"><header class="message-attribution"><time class="u-dt" datetime="2024-05-0${id % 9}T10:00:00+0000"></time><ul class="message-attribution-opposite"><li><a href="/t/x.9/post-${id}">#${id}</a></li></ul></header><div class="message-body"><div class="bbWrapper">${body}</div></div>${extra}</div></article>`;
const page = (posts: string, last = 3) => `<html id="XF" data-xf="2.3"><body><h1 class="p-title-value"><span class="label">App</span>Projectivy Launcher</h1><div class="pageNav" data-page="1" data-last="${last}"></div>${posts}</body></html>`;
const ctx = (href: string, html: string, f: typeof fetch, cache = new TtlCache()): Ctx => ({ url: new URL(href), doc: new DOMParser().parseFromString(html, 'text/html'), fetch: f, cache });
const U = 'https://xdaforums.com/t/app-android-tv-projectivy-launcher.4436549/';

describe('XenForo (XDA)', () => {
  afterEach(() => vi.useRealTimers());
  it('адреса и определение', () => {
    expect(parseThreadUrl(new URL(U + 'page-3'))).toEqual({ base: U, id: '4436549' });
    expect(parseThreadUrl(new URL('https://x.org/threads/title.77/post-5'))?.id).toBe('77');
    expect(parseThreadUrl(new URL('https://xdaforums.com/forums/android-tv.1/'))).toBeNull();
    expect(pickAdapter(ADAPTERS, ctx(U, page(post(1, 'a', 'x')), (() => {}) as never))?.id).toBe('xenforo');
    expect(pickAdapter(ADAPTERS, ctx(U, '<html><body>x</body></html>', (() => {}) as never))?.id).not.toBe('xenforo');
  });

  it('сообщение: автор, дата, номер, цитата только именем, код, спойлер, ленивая картинка', () => {
    const body = `<div class="bbCodeBlock bbCodeBlock--quote"><div class="bbCodeBlock-title">Петя said:</div><div class="bbCodeBlock-content">старое</div></div>привет<div class="bbCodeBlock bbCodeBlock--code"><div class="bbCodeBlock-content"><pre class="bbCodeCode"><code>ls -la</code></pre></div></div><img src="data:image/gif;base64,R0" data-src="https://x/a.png">`;
    const d = new DOMParser().parseFromString(page(post(5, 'Вася', body)), 'text/html');
    const [it] = parsePosts(d, { ...o, images: 'url' }, new Set());
    expect(it).toMatchObject({ id: '5', author: 'Вася' });
    expect(it!.date).toContain('2024-05-05');
    expect(it!.text).toContain('> Петя');
    expect(it!.text).not.toContain('старое');
    expect(it!.text).toContain('ls -la');
    expect(it!.text).toContain('https://x/a.png');
    expect(parsePosts(d, { ...o, quotes: true }, new Set())[0]!.text).toContain('старое');
    expect(parsePosts(d, { ...o, code: false }, new Set())[0]!.text).not.toContain('ls -la');
  });

  it('постранично с последней страницы; открытая страница не скачивается повторно; дубли убираются', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      const n = Number(u.match(/page-(\d+)/)?.[1] ?? 1);
      return new Response(page(post(n * 10, 'u', `т${n}`) + post(10, 'u', 'дубль')));
    }) as never;
    const d = await xenforo.extract(ctx(U + 'page-3', page(post(30, 'u', 'т3')), f), { ...o, delayMs: 0, concurrency: 1 }, noop);
    expect(urls).toEqual([U, U + 'page-2']);
    expect(d.title).toBe('Projectivy Launcher');
    expect(d.items.map(i => i.id)).toEqual(['10', '20', '30']);
    urls.length = 0;
    const part = await xenforo.extract(ctx(U, page(post(1, 'u', 'x')), f), { ...o, delayMs: 0, concurrency: 1, percent: 30 }, noop);
    expect(urls).toEqual([U + 'page-3']);
    expect(part.meta.length).toBe(1);
  });

  it('ссылка на сообщение (/post-N): страница неизвестна, открытый документ в кэш не кладётся', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(page(post(1, 'u', 'a'), 1)); }) as never;
    await xenforo.extract(ctx(U + 'post-99', page(post(99, 'u', 'z'), 1), f), { ...o, delayMs: 0, concurrency: 1 }, noop);
    expect(urls).toEqual([U]);
  });

  it('403 сразу — закрытая тема; 429 — пауза, докачка берёт скачанное из кэша', async () => {
    vi.useFakeTimers();
    const f403 = (async () => new Response('', { status: 403 })) as never;
    const denied = xenforo.extract(ctx(U + 'post-30', page(post(30, 'u', 'x')), f403), { ...o, delayMs: 0, concurrency: 1, percent: 100 }, noop).catch(e => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(String(await denied)).toMatch(/доступ/);
    const cache = new TtlCache();
    let limited = true;
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      return limited && u.endsWith('page-2') ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : new Response(page(post(7, 'u', 'ok'), 3));
    }) as never;
    const opts = { ...o, delayMs: 0, concurrency: 1 };
    const run = xenforo.extract(ctx(U, page(post(1, 'u', 'x')), f, cache), opts, noop).catch(e => e);
    await vi.advanceTimersByTimeAsync(300_000);
    const err = await run;
    expect(err).toBeInstanceOf(PausedError);
    limited = false;
    calls.length = 0;
    const resumed = xenforo.extract(ctx(U, page(post(1, 'u', 'x')), f, cache), opts, noop);
    await vi.advanceTimersByTimeAsync(300_000);
    const d = await resumed;
    expect(calls.every(c => !c.endsWith('page-1') && c !== U)).toBe(true);
    expect(d.items.length).toBeGreaterThan(0);
  });
});

describe('XenForo: ручное продолжение и пропуск', () => {
  afterEach(() => vi.useRealTimers());
  const U2 = U;
  it('429 → сразу пауза, «Пропустить» исключает заблокированную страницу', async () => {
    vi.useFakeTimers();
    const cache = new TtlCache();
    const calls: string[] = [];
    let limited = true;
    const f = (async (u: string) => {
      calls.push(u);
      const n = Number(u.match(/page-(\d+)/)?.[1] ?? 1);
      if (limited && n === 2) return new Response('', { status: 429 });
      return new Response(page(post(n * 10, 'u', `т${n}`), 3));
    }) as never;
    const opts = { ...o, delayMs: 0, concurrency: 1 };
    const run = (p: Promise<unknown>) => { const s = p.then(v => ({ v }), e => ({ e })); return vi.advanceTimersByTimeAsync(300_000).then(() => s) as Promise<{ v?: any; e?: any }>; };
    const first = await run(xenforo.extract(ctx(U2 + 'page-3', page(post(30, 'u', 'x')), f, cache), opts, noop));
    expect(first.e).toBeInstanceOf(PausedError);
    expect(first.e.skippable).toBe(true);
    expect(calls).toEqual([U2, U2 + 'page-2']); // после 429 ни одной пробы
    limited = false;
    calls.length = 0;
    const r = await run(xenforo.extract(ctx(U2 + 'page-3', page(post(30, 'u', 'x')), f, cache), { ...opts, skip: true }, noop));
    expect(calls).toEqual([]); // 1 и 3 уже есть, 2 пропущена
    expect(r.v.items.map((i: any) => i.id)).toEqual(['10', '30']);
    expect(r.v.warnings.join(' ')).toContain('Пропущено страниц: 1 (2)');
  });
});
