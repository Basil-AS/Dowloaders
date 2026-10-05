import { describe, expect, it, vi } from 'vitest';
import { domToText, htmlToText } from './html';
import { applyFilters, formatDoc } from './format';
import { buildFilename, sanitize } from './filename';
import { DEFAULT_SETTINGS, sanitizeSettings, toExtractOptions } from './settings-model';
import { fetchRetry, runPool } from './http';
import { resolveLang, t } from './i18n';
import type { ParsedDoc } from './types';

const opts = toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' });
const doc: ParsedDoc = {
  site: 'x.test', kind: 'article', title: 'Заголовок', url: 'https://x.test/1', meta: [['Автор', 'vasya']], body: 'Тело',
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
    expect(htmlToText('<a href="https://e.x">l</a><img src="https://i/1.png">', { links: false, images: false })).toBe('l');
    expect(htmlToText('<img src="https://i/1.png">')).toBe('[img: https://i/1.png]');
    expect(htmlToText('<img class="emoji" alt=":)" src="e.png">')).toBe(':)');
  });
  it('пропускает script/style', () => {
    expect(domToText(new DOMParser().parseFromString('<body>a<script>x()</script><style>b{}</style>c</body>', 'text/html').body)).toBe('ac');
  });
});

describe('format', () => {
  it('txt: шапка, комментарии с отступом', () => {
    const out = formatDoc(doc, opts, { now: new Date('2024-02-02T10:00:00Z') });
    expect(out).toContain('Заголовок');
    expect(out).toContain('URL: https://x.test/1');
    expect(out).toContain('КОММЕНТАРИИ (4)');
    expect(out).toContain('--- [ #1 | a |');
    expect(out).toContain('    --- [ #2 | b | -3 | ответ на #1 ] ---\n    плохой');
  });
  it('md: заголовки и вложенные цитаты', () => {
    const out = formatDoc(doc, { ...opts, format: 'md' });
    expect(out.startsWith('# Заголовок')).toBe(true);
    expect(out).toContain('## Комментарии (4)');
    expect(out).toContain('>> **#3 · c');
  });
  it('json: валидный и содержит items', () => {
    const j = JSON.parse(formatDoc(doc, { ...opts, format: 'json' }));
    expect(j.items).toHaveLength(4);
    expect(j.exportedAt).toBeTruthy();
  });
  it('en-локаль', () => {
    expect(formatDoc(doc, { ...opts, lang: 'en' })).toContain('COMMENTS (4)');
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
