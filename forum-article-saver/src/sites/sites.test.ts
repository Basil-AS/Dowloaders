import { describe, expect, it } from 'vitest';
import { habr } from './habr';
import { reddit } from './reddit';
import { fourpda, parsePosts } from './fourpda';
import { discourse, cookedToText } from './discourse';
import { generic } from './generic';
import { ADAPTERS } from './index';
import { pickAdapter } from '../core/run';
import { toExtractOptions, DEFAULT_SETTINGS } from '../core/settings-model';
import { TtlCache } from '../core/cache';
import { RateLimitError } from '../core/http';
import type { Ctx } from '../core/types';

const o = toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' });
const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
const mkCtx = (href: string, html = '<html><body></body></html>', f: typeof fetch = (() => { throw new Error('no fetch'); }) as never): Ctx => ({
  url: new URL(href),
  doc: new DOMParser().parseFromString(html, 'text/html'),
  fetch: f,
  cache: new TtlCache(),
});
const noop = () => {};

describe('определение площадки', () => {
  it('выбирает нужный адаптер', () => {
    const id = (h: string, html?: string) => pickAdapter(ADAPTERS, mkCtx(h, html))?.id;
    expect(id('https://habr.com/ru/news/806591/')).toBe('habr');
    expect(id('https://habr.com/ru/articles/1021392/')).toBe('habr');
    expect(id('https://www.reddit.com/r/K/comments/abc/x/')).toBe('reddit');
    expect(id('https://4pda.to/forum/index.php?showtopic=1')).toBe('4pda');
    expect(id('https://ntc.party/t/slug/18333/178', '<html><head><meta name="generator" content="Discourse 3.3"></head><body></body></html>')).toBe('discourse');
    expect(id('https://ntc.party/t/slug/18333')).toBeUndefined(); // нет признаков Discourse
    expect(id('https://example.com/')).toBeUndefined();
  });
});

describe('habr', () => {
  const f = (async (u: string) => {
    if (u.includes('/comments/')) return json({ threads: [1], comments: { 1: { id: 1, parentId: 0, author: { alias: 'a' }, timePublished: '2024-04-01T11:00:00Z', score: 5, message: '<p>корень</p>' }, 2: { id: 2, parentId: 1, author: { alias: 'b' }, timePublished: '2024-04-01T12:00:00Z', score: -1, message: 'ответ<br>2' }, 9: { id: 9, parentId: 77, author: null, timePublished: '2024-04-01T13:00:00Z', message: 'сирота' } } });
    return json({ titleHtml: 'Т &amp; <b>x</b>', author: { alias: 'v' }, timePublished: '2024-04-01T10:00:00Z', statistics: { score: 3 }, hubs: [{ title: 'Python' }], textHtml: '<p>текст</p>' });
  }) as never;
  it('статья + дерево комментариев', async () => {
    const d = await habr.extract(mkCtx('https://habr.com/ru/news/1/', undefined, f), o, noop);
    expect(d.title).toBe('Т & x');
    expect(d.body).toBe('текст');
    expect(d.items.map(i => [i.id, i.level])).toEqual([['1', 0], ['2', 1], ['9', 1]]);
    expect(d.items[1]).toMatchObject({ author: 'b', score: -1, replyTo: '1', text: 'ответ\n2' });
    expect(d.meta.find(([k]) => k === 'Хабы')?.[1]).toContain('Python');
  });
  it('comments=false не запрашивает комментарии', async () => {
    let hit = false;
    const g = (async (u: string) => { if (u.includes('/comments/')) hit = true; return json({ titleHtml: 'T', textHtml: '' }); }) as never;
    const d = await habr.extract(mkCtx('https://habr.com/ru/articles/5/', undefined, g), { ...o, comments: false }, noop);
    expect(hit).toBe(false);
    expect(d.items).toHaveLength(0);
  });
  it('ошибка комментариев → предупреждение, статья остаётся', async () => {
    const g = (async (u: string) => (u.includes('/comments/') ? new Response('', { status: 404 }) : json({ titleHtml: 'T', textHtml: 'b' }))) as never;
    const d = await habr.extract(mkCtx('https://habr.com/ru/articles/5/', undefined, g), o, noop);
    expect(d.warnings[0]).toContain('Комментарии не загрузились');
    expect(d.body).toBe('b');
  });
});

describe('reddit', () => {
  const t1 = (id: string, parent: string, body: string, replies: unknown = '') => ({ kind: 't1', data: { id, name: 't1_' + id, parent_id: parent, author: 'u' + id, body, score: 3, created_utc: 1712000000, replies } });
  const post = [{ data: { children: [{ data: { title: 'Заголовок', selftext: 'Текст', author: 'op', subreddit: 'K', score: 10, num_comments: 4, created_utc: 1712000000, is_self: true } }] } },
    { data: { children: [t1('a', 't3_p', 'A', { data: { children: [t1('b', 't1_a', 'B'), { kind: 'more', data: { children: ['d'] } }] } }), { kind: 'more', data: { children: ['e'] } }] } }];
  it('JSON + подгрузка «more»', async () => {
    const f = (async (u: string) => (u.includes('morechildren') ? json({ json: { data: { things: [t1('d', 't1_b', 'D'), t1('e', 't3_p', 'E')] } } }) : json(post))) as never;
    const d = await reddit.extract(mkCtx('https://www.reddit.com/r/K/comments/p/slug/', undefined, f), { ...o, delayMs: 0 }, noop);
    expect(d.items.map(i => [i.id, i.level])).toEqual([['a', 0], ['b', 1], ['d', 2], ['e', 0]]);
    expect(d.title).toBe('Заголовок');
    expect(d.totalItems).toBe(4);
  });
  it('403 → разбор DOM', async () => {
    const html = `<shreddit-post post-title="DOM" author="op" score="1" comment-count="2" subreddit-prefixed-name="r/K" created-timestamp="2024-04-01T10:00:00Z"><div slot="text-body"><p>тело</p></div></shreddit-post>
      <shreddit-comment author="a" depth="0" score="5" thingid="t1_aa"><div slot="comment"><p>корень</p></div></shreddit-comment>
      <shreddit-comment author="b" depth="1" score="2"><div slot="comment"><p>вложенный</p></div></shreddit-comment>`;
    const f = (async () => new Response('', { status: 403 })) as never;
    const d = await reddit.extract(mkCtx('https://www.reddit.com/r/K/comments/p/slug/', html, f), o, noop);
    expect(d.title).toBe('DOM');
    expect(d.body).toBe('тело');
    expect(d.items.map(i => [i.author, i.level, i.text])).toEqual([['a', 0, 'корень'], ['b', 1, 'вложенный']]);
    expect(d.warnings[0]).toContain('403');
  });
});

describe('4pda', () => {
  const page = `<table class="ipbtable" data-post="7"><tr><td class="row2" id="ph-7-d2">01.01.24, 10:00 Сообщение #1</td><td><span class="normalname"><a>Вася</a></span><a title="Ссылка на это сообщение">#5</a></td>
    <td><div class="postcolor"><div class="post-block quote"><div class="block-title">Цитата: Петя</div><div class="block-body">старое</div></div>привет<br>мир<div>блок</div><div class="post-block code"><div class="block-title">КОД</div><div class="block-body">ls -la</div></div><img src="x.png"></div></td></tr></table>`;
  it('цитаты: по умолчанию только имя, при желании полностью; код — по опции', () => {
    const parse = (opts: object) => parsePosts(new DOMParser().parseFromString(page, 'text/html'), { ...o, ...opts }, new Set());
    const short = parse({})[0]!;
    expect(short).toMatchObject({ id: '5', author: 'Вася', date: '01.01.24, 10:00' });
    expect(short.text.replace(/\n{2,}/g, '\n')).toBe('> Петя\nпривет\nмир\nблок\n```\nls -la\n```');
    const full = parse({ quotes: true })[0]!;
    expect(full.text).toContain('> Цитата: Петя:\n> старое');
    expect(parse({ code: false })[0]!.text).not.toContain('ls -la');
  });
  it('номер — только цифры, дата без «Сообщение #N»', () => {
    const html = '<table class="ipbtable" data-post="9"><tr><td class="row2" id="ph-9-d2">Сегодня, 14:05 Сообщение #123</td><td><span class="normalname"><a>u</a></span><a title="Ссылка на это сообщение">Сообщение #123</a></td><td><div class="postcolor">текст</div></td></tr></table>';
    const [it] = parsePosts(new DOMParser().parseFromString(html, 'text/html'), o, new Set());
    expect(it).toMatchObject({ id: '123', date: 'Сегодня, 14:05' });
  });
  it('дедупликация по data-post', () => {
    const seen = new Set<string>();
    const d = new DOMParser().parseFromString(page, 'text/html');
    expect(parsePosts(d, o, seen)).toHaveLength(1);
    expect(parsePosts(d, o, seen)).toHaveLength(0);
  });
  it('постранично, последние N%, ретрай, порядок', async () => {
    const enc = (s: string) => new Uint8Array([...s].map(c => { const n = c.charCodeAt(0); return n >= 0x410 && n <= 0x44f ? n - 0x410 + 0xc0 : n < 128 ? n : 63; }));
    const mk = (id: number, txt: string) => `<table class="ipbtable" data-post="${id}"><tr><td class="row2" id="ph-${id}-d2">d</td><td><span class="normalname"><a>u</a></span><a title="Ссылка на это сообщение">${id}</a></td><td><div class="postcolor">${txt}</div></td></tr></table>`;
    const pages: Record<number, string> = { 0: mk(1, 'один'), 20: mk(2, 'два'), 40: mk(3, 'три') + mk(2, 'два') };
    let hits503 = 0;
    const urls: string[] = [];
    const f = (async (u: string) => {
      const st = Number(new URL(u).searchParams.get('st'));
      urls.push(u);
      if (st === 20 && hits503++ < 1) return new Response('', { status: 503 });
      return new Response(enc(`<html><body>${pages[st] ?? ''}</body></html>`));
    }) as never;
    const html = '<html><body><h1 itemprop="name">Тема</h1><span class="pagelink-menu">3 страниц</span></body></html>';
    const all = await fourpda.extract(mkCtx('https://4pda.to/forum/index.php?showtopic=1', html, f), { ...o, delayMs: 0, concurrency: 1 }, noop);
    expect(all.items.map(i => i.id)).toEqual(['1', '2', '3']);
    const part = await fourpda.extract(mkCtx('https://4pda.to/forum/index.php?showtopic=1', html, f), { ...o, delayMs: 0, concurrency: 1, percent: 34 }, noop);
    expect(part.items.map(i => i.id)).toEqual(['2', '3']);
    expect(part.meta.find(([k]) => k === 'Загружено')?.[1]).toContain('последние 34%');
  });
});

describe('discourse: домен в имени файла целиком', () => {
  it('поддомен сохраняется', async () => {
    const f = (async (u: string) => json({ title: 'T', slug: 's', post_stream: { stream: [], posts: [] } })) as never;
    const html = '<html><head><meta name="generator" content="Discourse 3.3"></head><body></body></html>';
    const d = await discourse.extract(mkCtx('https://forum.sub.example.co.uk/t/s/5', html, f), o, noop);
    expect(d.site).toBe('forum.sub.example.co.uk');
  });
});

describe('discourse', () => {
  const mkPost = (n: number) => ({ id: 1000 + n, post_number: n, username: 'u' + n, name: n % 2 ? 'Имя' + n : 'u' + n, created_at: '2024-05-01T10:00:00Z', reply_to_post_number: n > 1 ? n - 1 : null, actions_summary: [{ id: 2, count: n % 3 }], cooked: `<p>пост ${n}</p>` });
  const N = 45;
  const stream = Array.from({ length: N }, (_, i) => 1001 + i);
  const html = '<html><head><meta name="generator" content="Discourse 3.3"></head><body></body></html>';
  const chunks: number[] = [];
  const f = (async (u: string) => {
    const url = new URL(u);
    if (url.pathname === '/t/18333.json') return json({ title: 'Тема', slug: 's', tags: ['a', { name: 'b' }], post_stream: { stream, posts: stream.slice(0, 20).map(i => mkPost(i - 1000)) } });
    const ids = url.searchParams.getAll('post_ids[]').map(Number);
    chunks.push(ids.length);
    return json({ post_stream: { posts: ids.map(i => mkPost(i - 1000)) } });
  }) as never;
  it('вся тема чанками по 20', async () => {
    chunks.length = 0;
    const d = await discourse.extract(mkCtx('https://ntc.party/t/s/18333/178', html, f), { ...o, delayMs: 0 }, noop);
    expect(d.items).toHaveLength(45);
    expect(d.items.map(i => i.id).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(chunks.sort((a, b) => a - b)).toEqual([5, 20]);
    expect(d.items[1]).toMatchObject({ replyTo: '1', score: 2 });
    expect(d.meta.find(([k]) => k === 'Теги')?.[1]).toBe('a, b');
    expect(d.site).toBe('ntc.party'); // домен целиком, без отсечения уровней
  });
  it('последние N%', async () => {
    const d = await discourse.extract(mkCtx('https://ntc.party/t/s/18333', html, f), { ...o, delayMs: 0, percent: 20 }, noop);
    expect(d.items.map(i => i.id)).toEqual(['37', '38', '39', '40', '41', '42', '43', '44', '45']);
  });
  it('cooked: цитаты, смайлы, lightbox', () => {
    const cooked = '<aside class="quote"><div class="title">user1:</div><blockquote><p>цит</p></blockquote></aside><p>да <img class="emoji" alt=":smile:"> <a class="lightbox" href="https://f/1.png"><img src="https://f/1_t.png"></a></p>';
    expect(cookedToText(cooked, { ...o, quotes: true, images: 'url' })).toBe('> user1:\n> цит\n\nда :smile: [img: https://f/1.png]');
    expect(cookedToText(cooked, o)).toBe('> user1\n\nда :smile:');
    expect(cookedToText(cooked, { ...o, images: 'none' })).toBe('> user1\n\nда :smile:');
  });
});

describe('en: метки документа локализуются', () => {
  it('habr с lang=en', async () => {
    const f = (async () => json({ titleHtml: 'T', author: { alias: 'v' }, statistics: { score: 3 }, textHtml: '' })) as never;
    const d = await habr.extract(mkCtx('https://habr.com/ru/articles/5/', undefined, f), { ...o, lang: 'en', comments: false }, noop);
    expect(d.meta.map(([k]) => k)).toEqual(['Author', 'Date', 'Score', 'Views', 'Bookmarks']);
    expect(d.id).toBe('5');
  });
});

describe('generic (статьи на любых сайтах)', () => {
  const para = 'Это длинный абзац обычного текста статьи, в котором достаточно слов, запятых, и смысла для того, чтобы алгоритм выделения основного содержимого признал его частью материала. ';
  const html = `<html><head><title>Моя статья | Блог</title></head><body><nav><a href="/">Главная</a><a href="/about">О нас</a></nav>
    <article><h1>Моя статья</h1><p class="byline">Иван Петров</p>${`<p>${para}<a href="https://example.org/x">источник</a></p>`.repeat(8)}</article>
    <footer>Подвал сайта</footer></body></html>`;
  it('определяет читаемую страницу и достаёт основной текст', async () => {
    const ctx = mkCtx('https://blog.example.com/posts/my-article', html);
    expect(generic.detect(ctx)).toBe(true);
    const d = await generic.extract(ctx, o, noop);
    expect(d.title).toContain('Моя статья');
    expect(d.id).toBe('my-article');
    expect(d.site).toBe('blog.example.com');
    expect(d.body).toContain('Это длинный абзац');
    expect(d.body).toContain('источник (https://example.org/x)');
    expect(d.body).not.toContain('Подвал сайта');
    expect(d.items).toHaveLength(0);
  });
  it('пустая страница не считается статьёй', () => {
    expect(generic.detect(mkCtx('https://example.com/'))).toBe(false);
  });
  it('переключатель generic отключает адаптер', () => {
    const ctx = mkCtx('https://blog.example.com/posts/x', html);
    expect(pickAdapter(ADAPTERS, ctx)?.id).toBe('generic');
    expect(pickAdapter(ADAPTERS, ctx, { fallback: false })).toBeUndefined();
  });
});

describe('429 у остальных площадок: пауза вместо тихой потери', () => {
  const limited = (async () => new Response('', { status: 429, headers: { 'retry-after': '7' } })) as never;
  it('Хабр: статья', async () => {
    const e = await habr.extract(mkCtx('https://habr.com/ru/articles/5/', undefined, limited), o, noop).catch(x => x);
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.retryAfterMs).toBe(7000);
  });
  it('Хабр: комментарии не превращаются в «предупреждение», а останавливают сохранение', async () => {
    const f = (async (u: string) => (u.includes('/comments/') ? new Response('', { status: 429 }) : json({ titleHtml: 'T', textHtml: 'b' }))) as never;
    await expect(habr.extract(mkCtx('https://habr.com/ru/articles/5/', undefined, f), o, noop)).rejects.toBeInstanceOf(RateLimitError);
  });
  it('Discourse: докачка берёт уже скачанные посты из кэша', async () => {
    const mkPost = (n: number) => ({ id: 1000 + n, post_number: n, username: 'u' + n, created_at: '2024-05-01T10:00:00Z', cooked: `<p>p${n}</p>`, actions_summary: [] });
    const stream = Array.from({ length: 45 }, (_, i) => 1001 + i);
    const html = '<html><head><meta name="generator" content="Discourse 3.3"></head><body></body></html>';
    const cache = new TtlCache();
    let limit = true;
    const chunks: number[] = [];
    const f = (async (u: string) => {
      const url = new URL(u);
      if (url.pathname === '/t/1.json') return json({ title: 'T', slug: 's', post_stream: { stream, posts: stream.slice(0, 20).map(i => mkPost(i - 1000)) } });
      const ids = url.searchParams.getAll('post_ids[]').map(Number);
      if (limit && chunks.length >= 1) return new Response('', { status: 429 });
      chunks.push(ids.length);
      return json({ post_stream: { posts: ids.map(i => mkPost(i - 1000)) } });
    }) as never;
    const ctx = () => ({ ...mkCtx('https://ntc.party/t/s/1', html, f), cache });
    const err = await discourse.extract(ctx(), { ...o, concurrency: 1, delayMs: 0 }, noop).catch(e => e);
    expect(err.name).toBe('PausedError');
    expect([err.done, err.total]).toEqual([40, 45]);
    limit = false;
    chunks.length = 0;
    const d = await discourse.extract(ctx(), { ...o, concurrency: 1, delayMs: 0 }, noop);
    expect(chunks).toEqual([5]); // только недостающий блок
    expect(d.items).toHaveLength(45);
  });
});
