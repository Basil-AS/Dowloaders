import { describe, expect, it, vi } from 'vitest';
import { cleanUrl, domToText, htmlToText } from './html';
import { applyFilters, formatDoc, relativize } from './format';
import { buildFilename, sanitize } from './filename';
import { DEFAULT_SETTINGS, sanitizeSettings, toExtractOptions } from './settings-model';
import { fetchRetry, runPool } from './http';
import { count, plural, resolveLang, t } from './i18n';
import type { ParsedDoc } from './types';

const opts = toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' });
const doc: ParsedDoc = {
  id: '1', site: 'x.test', kind: 'article', title: 'Заголовок', url: 'https://x.test/1', meta: [['Автор', 'vasya']], body: 'Тело',
  items: [
    { id: '1', author: 'a', date: '2024-01-01T00:00:00Z', score: 5, level: 0, replyTo: null, text: 'корень' },
    { id: '2', author: 'b', date: '', score: -3, level: 1, replyTo: '1', text: 'плохой' },
    { id: '3', author: 'c', date: '', score: 1, level: 2, replyTo: '2', text: 'внук плохого' },
    { id: '4', author: 'd', date: '', score: 2, level: 1, replyTo: '1', text: 'хороший' },
  ],
  totalItems: 4, warnings: [],
};

describe('html', () => {
  it('сохраняет переносы блоков, списки, код, ссылки', () => {
    const t = htmlToText('a<div>b</div><p>c</p>x<br>y<ul><li>1</li><li>2</li></ul><pre><code>q\nw</code></pre><a href="https://e.x">l</a>');
    expect(t).toBe('a\nb\n\nc\n\nx\ny\n\n• 1\n• 2\n\n```\nq\nw\n```\n\nl (https://e.x)');
  });
  it('markdown-режим', () => {
    const t = htmlToText('<b>жир</b> <i>курсив</i> <a href="https://e.x">l</a><ol><li>a</li><li>b</li></ol>', { mode: 'md' });
    expect(t).toBe('**жир** *курсив* [l](https://e.x)\n\n1. a\n2. b');
  });
  it('опции links/images', () => {
    expect(htmlToText('<a href="https://e.x">l</a><img src="https://i/1.png">', { links: false, images: 'alt' })).toBe('l');
    expect(htmlToText('<img src="https://i/1.png">')).toBe('[img: https://i/1.png]');
    expect(htmlToText('<img class="emoji" alt=":)" src="e.png">')).toBe(':)');
  });
  it('пропускает script/style', () => {
    expect(domToText(new DOMParser().parseFromString('<body>a<script>x()</script><style>b{}</style>c</body>', 'text/html').body)).toBe('ac');
  });
});

describe('html: экономия', () => {
  it('картинки: без адреса остаётся подпись, декор и смайлы отбрасываются', () => {
    const h = '<img src="https://i/x.png" alt="График роста"><img src="https://i/s.png" alt=":)"><img src="https://i/y.png">';
    expect(htmlToText(h, { images: 'alt' })).toBe('[img: График роста]');
    expect(htmlToText(h, { images: 'url' })).toContain('[img: https://i/x.png]');
    expect(htmlToText(h, { images: 'none' })).toBe('');
  });
  it('ссылки: трекинг убирается, ссылка-текст не дублируется', () => {
    expect(cleanUrl('https://a.b/p?utm_source=x&id=5&fbclid=z#h')).toBe('https://a.b/p?id=5#h');
    expect(cleanUrl('https://a.b/p?utm_medium=x')).toBe('https://a.b/p');
    expect(htmlToText('<a href="https://www.a.b/p/">a.b/p</a>')).toBe('https://www.a.b/p/');
  });
});

describe('format (экономный вывод)', () => {
  const now = new Date('2024-02-02T10:00:00Z');
  const topic: ParsedDoc = {
    ...doc, kind: 'topic', meta: [['Теги', 'a'], ['Просмотров', '99', true]], body: '',
    items: [
      { id: '12', author: 'ann', date: '2024-05-01T10:00:00', score: 3, level: 0, replyTo: null, text: 'один\n\n\nдва' },
      { id: '13', author: 'bob', date: '2024-05-01T10:05:00', score: 0, level: 0, replyTo: '12', text: 'ответ' },
      { id: '14', author: 'cat', date: '2024-05-02T09:00:00', score: null, level: 0, replyTo: null, text: 'новый день' },
    ],
    totalItems: 3,
  };
  it('txt: без разделителей и служебных полей, вложенность через «>»', () => {
    const out = formatDoc(doc, opts, { now });
    expect(out).not.toMatch(/={3,}|-{3,}|\[ ?#/);
    expect(out).toContain('Заголовок\nhttps://x.test/1\nАвтор: vasya');
    expect(out).not.toContain('Выгружено');
    expect(out).toContain('Комментарии 4');
    expect(out).toMatch(/^a 2024-01-01 \d\d:\d\d \+5\nкорень$/m);
    expect(out).toContain('\n> b -3\nплохой');
    expect(out).toContain('\n>> c +1\nвнук плохого');
  });
  it('номер сообщения печатается один раз и только у тем форумов', () => {
    const out = formatDoc(topic, opts, { now });
    expect(out).toMatch(/^12 ann 2024-05-01 10:00 \+3$/m);
    expect(out).toMatch(/^13 bob 10:05 →12$/m); // тот же день → только время; 0 рейтинга не печатаем
    expect(out).toMatch(/^14 cat 2024-05-02 09:00$/m);
    expect((out.match(/#12|\b12\b.*\b12\b/g) ?? []).length).toBe(0);
    expect(out).toContain('один\nдва'); // пустые строки внутри сообщения схлопнуты
    expect(formatDoc(doc, opts, { now })).not.toMatch(/#1\b/); // в деревьях номеров нет вовсе
  });
  it('ссылки на свой сайт: база объявлена в шапке, дальше относительные', () => {
    const d: ParsedDoc = { ...doc, url: 'https://habr.com/ru/articles/1/', body: 'см. https://habr.com/ru/articles/2/ и (https://www.habr.com/ru/users/x/) и https://other.org/p', items: [] };
    const out = formatDoc(d, opts, { now });
    expect(out).toContain('относятся к https://habr.com');
    expect(out).toContain('см. /ru/articles/2/ и (/ru/users/x/) и https://other.org/p');
    expect(formatDoc({ ...d, body: 'один https://habr.com/ru/a/' }, opts, { now })).toContain('https://habr.com/ru/a/'); // одна ссылка — не сжимаем
    expect(relativize('x', 'не url').base).toBeNull();
    expect(formatDoc(d, { ...opts, format: 'json' }, { now })).toContain('https://habr.com/ru/articles/2/'); // JSON не трогаем
  });
  it('подробная шапка добавляет extra-поля и время выгрузки', () => {
    expect(formatDoc(topic, opts, { now })).not.toContain('Просмотров');
    const d = formatDoc(topic, opts, { now, detailed: true });
    expect(d).toContain('Просмотров: 99');
    expect(d).toContain('Выгружено:');
  });
  it('md и en-локаль', () => {
    const md = formatDoc(doc, { ...opts, format: 'md' }, { now });
    expect(md.startsWith('# Заголовок')).toBe(true);
    expect(md).toContain('## Комментарии 4');
    expect(md).toContain('**>> c +1**');
    expect(formatDoc(doc, { ...opts, lang: 'en' }, { now })).toContain('Comments 4');
  });
  it('json: компактный, без пустых полей', () => {
    const raw = formatDoc(topic, { ...opts, format: 'json' }, { now });
    expect(raw).not.toContain('\n  ');
    const j = JSON.parse(raw);
    expect(j.items).toHaveLength(3);
    expect(j.items[1]).toEqual({ id: '13', author: 'bob', date: '2024-05-01T10:05:00', replyTo: '12', text: 'ответ' });
    expect(j.exportedAt).toBeTruthy();
  });
  it('экономия: вывод заметно короче прежнего формата', () => {
    const many: ParsedDoc = { ...doc, items: Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), author: 'user' + i, date: '2024-05-01T10:00:00', score: 1, level: i % 3, replyTo: String(i), text: 'короткий комментарий' })), totalItems: 50 };
    const out = formatDoc(many, opts, { now });
    const oldStyle = many.items.map(it => `--- [ #${it.id} | ${it.author} | 01.05.2024, 10:00:00 | +1 | ответ на #${Number(it.id) - 1} ] ---\n${'    '.repeat(it.level)}${it.text}`).join('\n\n');
    expect(out.length).toBeLessThan(oldStyle.length * 0.7);
  });
});

describe('applyFilters', () => {
  it('minScore убирает комментарий вместе с поддеревом', () => {
    const r = applyFilters(doc, { maxDepth: 0, minScore: 0 });
    expect(r.items.map(i => i.id)).toEqual(['1', '4']);
  });
  it('maxDepth ограничивает вложенность', () => {
    expect(applyFilters(doc, { maxDepth: 2, minScore: null }).items.map(i => i.id)).toEqual(['1', '2', '4']);
    expect(applyFilters(doc, { maxDepth: 1, minScore: null }).items.map(i => i.id)).toEqual(['1']);
  });
  it('без фильтров — тот же объект', () => {
    expect(applyFilters(doc, { maxDepth: 0, minScore: null })).toBe(doc);
  });
});

describe('filename', () => {
  it('шаблон и очистка', () => {
    const n = buildFilename('{date} - [{site}] - {title}', { title: 'a/b:c?"d"', site: 'habr.com', now: new Date(2024, 0, 5, 7, 8) }, 'md');
    expect(n).toBe('2024-01-05 - [habr.com] - a-b-c--d-.md');
  });
  it('длина ограничена, неизвестные поля остаются', () => {
    expect(buildFilename('{title}', { title: 'я'.repeat(500), site: 's' }, 'txt').length).toBeLessThanOrEqual(154);
    expect(sanitize('')).toBe('untitled');
    expect(buildFilename('{nope}-{count}', { title: 't', site: 's', count: 3 }, 'txt')).toBe('{nope}-3.txt');
  });
});

describe('settings', () => {
  it('sanitize: границы и дефолты', () => {
    const s = sanitizeSettings({ percent: 999, concurrency: 0, maxDepth: -5, format: 'pdf' as never, minScore: '' as never, filenameTemplate: '  ' });
    expect(s.percent).toBe(100);
    expect(s.concurrency).toBe(1);
    expect(s.maxDepth).toBe(0);
    expect(s.format).toBe('txt');
    expect(s.minScore).toBeNull();
    expect(s.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
  });
  it('i18n', () => {
    expect(resolveLang('auto', 'ru-RU')).toBe('ru');
    expect(resolveLang('auto', 'de')).toBe('en');
    expect(t('ru', 'h_collected', { n: 1, m: 2 })).toBe('собрано 1 из 2');
  });
  it('склонения', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(n => count('ru', n, 'comments'))).toEqual([
      '1 комментарий', '2 комментария', '5 комментариев', '11 комментариев', '12 комментариев', '21 комментарий', '22 комментария', '25 комментариев', '111 комментариев',
    ]);
    expect(count('en', 1, 'posts')).toBe('1 post');
    expect(plural('en', 0, ['a', 'b'])).toBe('b');
  });
  it('картинки: миграция со старого true/false', () => {
    expect(sanitizeSettings({ images: true as never }).images).toBe('url');
    expect(sanitizeSettings({ images: false as never }).images).toBe('alt');
    expect(sanitizeSettings({ images: 'none' }).images).toBe('none');
    expect(sanitizeSettings({ images: 'x' as never }).images).toBe('alt');
    expect(DEFAULT_SETTINGS.images).toBe('alt');
  });
  it('тема и generic: допустимые значения', () => {
    expect(sanitizeSettings({ theme: 'neon' as never }).theme).toBe('system');
    expect(sanitizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeSettings({}).generic).toBe(true);
    expect(sanitizeSettings({ generic: false }).generic).toBe(false);
  });
});

describe('http', () => {
  it('fetchRetry: повторяет 503, не повторяет 404', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('ok'));
    expect(await (await fetchRetry(f as never, 'u', {}, 3, 1)).text()).toBe('ok');
    const g = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchRetry(g as never, 'u', {}, 3, 1)).rejects.toThrow('HTTP 404');
    expect(g).toHaveBeenCalledTimes(1);
  });
  it('runPool: порядок и лимит параллелизма', async () => {
    let cur = 0, max = 0;
    const r = await runPool([1, 2, 3, 4, 5, 6], 2, async x => { max = Math.max(max, ++cur); await new Promise(r => setTimeout(r, 5)); cur--; return x * 2; });
    expect(r).toEqual([2, 4, 6, 8, 10, 12]);
    expect(max).toBeLessThanOrEqual(2);
  });
});
