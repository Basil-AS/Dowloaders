import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../core/cache';
import { formatDoc } from '../../core/format';
import { PausedError } from '../../core/http';
import { DEFAULT_SETTINGS, toExtractOptions } from '../../core/settings-model';
import type { Ctx } from '../../core/types';
import { github } from './index';
import { globToRegExp, makeMatcher, parsePatterns, DEFAULT_IGNORE } from './ignore';
import { estimateTokens, fmtTokens, renderTree } from './tree';
import { modesFor, parseGithub } from './url';
import { looksBinary } from './repo';
import { GitHubApi, limitPause } from './api';
import { RateLimitError } from '../../core/http';
import { tFor } from '../../core/i18n';

const base = toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' });
const o = { ...base, concurrency: 2, delayMs: 0 };
const noop = () => {};
const json = (x: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json', ...headers } });
const text = (s: string) => new Response(s, { headers: { 'content-type': 'text/plain' } });

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;
/** Мини-«GitHub»: маршрут → ответ. Любой незнакомый запрос — 404. */
const server = (...hs: Handler[]) => {
  const calls: string[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    calls.push(`${init?.method ?? 'GET'} ${url.hostname}${url.pathname}${url.search}`);
    for (const h of hs) {
      const r = await h(url, init);
      if (r) return r;
    }
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const ctxFor = (href: string, f: typeof fetch, cache = new TtlCache(), html = '<html><body></body></html>'): Ctx => ({ url: new URL(href), doc: new DOMParser().parseFromString(html, 'text/html'), fetch: f, bgFetch: f, cache });

describe('маски путей', () => {
  const m = (pats: string[], path: string) => makeMatcher(pats)(path);
  it('имя на любой глубине, каталоги, расширения', () => {
    expect(m(['*.min.js'], 'a/b/app.min.js')).toBe(true);
    expect(m(['*.min.js'], 'app.js')).toBe(false);
    expect(m(['node_modules/'], 'x/node_modules/y/z.js')).toBe(true);
    expect(m(['dist/'], 'distant/a.js')).toBe(false);
    expect(m(['package-lock.json'], 'sub/package-lock.json')).toBe(true);
  });
  it('якорь от корня и **', () => {
    expect(m(['/docs/'], 'docs/a.md')).toBe(true);
    expect(m(['/docs/'], 'x/docs/a.md')).toBe(false);
    expect(m(['src/**/*.test.ts'], 'src/a/b/c.test.ts')).toBe(true);
    expect(m(['src/**/*.test.ts'], 'lib/c.test.ts')).toBe(false);
    expect(m(['**/*.md'], 'README.md')).toBe(true);
    expect(m(['a?c.txt'], 'abc.txt')).toBe(true);
  });
  it('комментарии и пустые строки игнорируются; отрицания не поддерживаются', () => {
    expect(parsePatterns('# c\n\n*.a\r\n  *.b  ')).toEqual(['*.a', '*.b']);
    expect(globToRegExp('!x')).toBeNull();
    expect(globToRegExp('# x')).toBeNull();
  });
  it('служебное и бинарное исключено по умолчанию, исходники — нет', () => {
    const ign = makeMatcher(DEFAULT_IGNORE);
    for (const p of ['.git/config', 'node_modules/a/b.js', 'yarn.lock', 'img/logo.png', 'a/b.min.js', 'dist/x.js', '.env', '.env.local', 'fonts/a.woff2']) expect(ign(p), p).toBe(true);
    for (const p of ['src/index.ts', 'README.md', 'docs/guide.md', 'Dockerfile', 'build.gradle', 'a/vendorish.go']) expect(ign(p), p).toBe(false);
  });
});

describe('дерево и токены', () => {
  it('компактное дерево: каталоги первыми, отступ в два пробела', () => {
    expect(renderTree(['b.txt', 'src/z.ts', 'src/a.ts', 'src/lib/x.ts', 'a.txt'], 'repo')).toBe('repo/\n  src/\n    lib/\n      x.ts\n    a.ts\n    z.ts\n  a.txt\n  b.txt');
  });
  it('оценка токенов', () => {
    expect(estimateTokens(1000)).toBe(250);
    expect([fmtTokens(800), fmtTokens(2500), fmtTokens(34_000), fmtTokens(2_400_000)]).toEqual(['~800', '~2.5k', '~34k', '~2.4M']);
  });
  it('бинарные данные распознаются', () => {
    expect(looksBinary('abc\u0000def')).toBe(true);
    expect(looksBinary('�'.repeat(100))).toBe(true);
    expect(looksBinary('обычный текст with unicode — ок')).toBe(false);
  });
});

describe('адреса GitHub', () => {
  const p = (path: string) => parseGithub(new URL('https://github.com' + path));
  it('типы страниц', () => {
    expect(p('/o/r')).toMatchObject({ page: 'repo', owner: 'o', repo: 'r' });
    expect(p('/o/r/issues/12')).toMatchObject({ page: 'issue', number: 12 });
    expect(p('/o/r/issues')).toMatchObject({ page: 'issues' });
    expect(p('/o/r/pull/7')).toMatchObject({ page: 'pull', number: 7 });
    expect(p('/o/r/pulls')).toMatchObject({ page: 'pulls' });
    expect(p('/o/r/discussions/3')).toMatchObject({ page: 'discussion', number: 3 });
    expect(p('/o/r/discussions')).toMatchObject({ page: 'discussions' });
    expect(p('/o/r/tree/feature/x/src')).toMatchObject({ page: 'repo', refPath: ['feature', 'x', 'src'], blob: false });
    expect(p('/o/r/blob/main/a.ts')).toMatchObject({ page: 'repo', blob: true });
  });
  it('не репозитории', () => {
    for (const x of ['/', '/o', '/settings/profile', '/orgs/x/people', '/marketplace/foo', '/topics/js']) expect(p(x), x).toBeNull();
    expect(parseGithub(new URL('https://gist.github.com/o/r'))).toBeNull();
  });
  it('режимы по странице', () => {
    expect(modesFor(p('/o/r/issues/1')!)).toEqual({ list: ['item', 'digest', 'issues', 'pulls', 'discussions'], def: 'item' });
    expect(modesFor(p('/o/r')!).def).toBe('digest');
    expect(modesFor(p('/o/r/discussions')!).def).toBe('discussions');
  });
});

// ───────────── дайджест репозитория ─────────────
const SHA = 'abc1234deadbeef';
const repoRoutes = (files: Record<string, string | null>, extra: { rawStatus?: (p: string) => number | undefined; sizes?: Record<string, number> } = {}): Handler[] => {
  const entries = Object.keys(files).map(path => ({ path, type: 'blob', sha: `sha-${path}`, size: extra.sizes?.[path] ?? ((files[path] ?? '').length || 1), mode: '100644' }));
  return [
    u => (u.pathname === '/repos/o/r' ? json({ default_branch: 'main', size: 500, description: 'Демо', private: false }) : undefined),
    u => (u.pathname === '/repos/o/r/commits/main' || u.pathname === '/repos/o/r/commits/feature%2Fx' ? text(SHA) : undefined),
    u => (u.pathname === `/repos/o/r/git/trees/${SHA}` ? json({ tree: [{ path: 'src', type: 'tree', sha: 't' }, ...entries], truncated: false }) : undefined),
    u => {
      if (u.hostname !== 'raw.githubusercontent.com') return undefined;
      const path = decodeURIComponent(u.pathname.replace(`/o/r/${SHA}/`, ''));
      const st = extra.rawStatus?.(path);
      if (st) return new Response('', { status: st, headers: { 'retry-after': '1' } });
      return path in files ? text(files[path] ?? '') : undefined;
    },
  ];
};
const FILES = {
  'README.md': '# Демо\nОписание\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  'docs/guide.md': 'Руководство',
  'src/app.min.js': 'x'.repeat(50),
  'node_modules/x/index.js': 'x',
  'img/logo.png': 'PNG',
  'yarn.lock': 'lock',
  'big.txt': 'z'.repeat(300),
  'blob.dat2': 'ab\u0000cd',
};

describe('дайджест репозитория', () => {
  it('структура + файлы: README первым, мусор, бинарные и крупные файлы отфильтрованы', async () => {
    const { f, calls } = server(...repoRoutes(FILES, { sizes: { 'big.txt': 300 * 1024 } }));
    const d = await github.extract(ctxFor('https://github.com/o/r', f), { ...o, mode: 'digest' }, noop);
    expect(d.kind).toBe('repo');
    expect(d.title).toBe('o/r');
    expect(d.files!.map(x => x.path)).toEqual(['README.md', 'docs/guide.md', 'src/a.ts', 'src/b.ts']);
    expect(d.tree).toBe('r/\n  docs/\n    guide.md\n  src/\n    a.ts\n    b.ts\n  README.md');
    expect(d.meta.find(([k]) => k === 'Ветка')![1]).toBe('main (abc1234)');
    expect(d.meta.find(([k]) => k === 'Файлов')![1]).toBe('4');
    expect(d.warnings.join(' ')).toMatch(/Пропущено.*1 файлов больше 100 КБ.*1 бинарных/);
    // всего три обращения к API (репо, коммит, дерево) и по запросу на нужный файл — ничего лишнего
    expect(calls.filter(c => c.includes('api.github.com'))).toHaveLength(3);
    expect(calls.filter(c => c.includes('raw.githubusercontent.com'))).toHaveLength(5); // 4 текстовых + 1 бинарный, обнаруженный по содержимому
  });
  it('форматы: txt компактный, md с блоками кода, json с массивом файлов', async () => {
    const { f } = server(...repoRoutes({ 'README.md': 'hi', 'src/a.ts': 'const x = "```";\n' }));
    const d = await github.extract(ctxFor('https://github.com/o/r', f), { ...o, mode: 'digest' }, noop);
    const txt = formatDoc(d, { ...o, format: 'txt' });
    expect(txt).toMatch(/Токенов \(оценка\): ~\d+\n/);
    expect(txt.replace(/~\d+/, '~N')).toBe(`o/r\nhttps://github.com/o/r\nВетка: main (abc1234) | Файлов: 2 | Токенов (оценка): ~N\n\nr/\n  src/\n    a.ts\n  README.md\n\n### README.md\nhi\n\n### src/a.ts\nconst x = "\`\`\`";\n`);
    const md = formatDoc(d, { ...o, format: 'md' });
    expect(md).toContain('## src/a.ts\n````ts\nconst x = "```";\n````'); // забор длиннее кавычек внутри
    const js = JSON.parse(formatDoc(d, { ...o, format: 'json' }));
    expect(js.files).toEqual([{ path: 'README.md', content: 'hi' }, { path: 'src/a.ts', content: 'const x = "```";' }]);
    expect(js.tree).toContain('src/');
  });
  it('маски из настроек: include и exclude', async () => {
    const mk = () => server(...repoRoutes(FILES));
    const inc = await github.extract(ctxFor('https://github.com/o/r', mk().f), { ...o, mode: 'digest', github: { ...o.github, include: '*.ts' } }, noop);
    expect(inc.files!.map(x => x.path)).toEqual(['src/a.ts', 'src/b.ts']);
    const exc = await github.extract(ctxFor('https://github.com/o/r', mk().f), { ...o, mode: 'digest', github: { ...o.github, exclude: 'docs/\nsrc/b.ts' } }, noop);
    expect(exc.files!.map(x => x.path)).toEqual(['README.md', 'big.txt', 'src/a.ts']);
  });
  it('каталог из адреса /tree/…: только его файлы; ветка со слэшем определяется по API', async () => {
    const { f } = server(...repoRoutes(FILES));
    const d = await github.extract(ctxFor('https://github.com/o/r/tree/feature/x/src', f), { ...o, mode: 'digest' }, noop);
    expect(d.files!.map(x => x.path)).toEqual(['a.ts', 'b.ts']); // пути относительно каталога
    expect(d.title).toBe('o/r/src');
    expect(d.meta[0]![1]).toContain('feature/x');
    expect(d.url).toBe('https://github.com/o/r/tree/feature/x/src');
  });
  it('страница файла (/blob/): дайджест по всему репозиторию', async () => {
    const { f } = server(...repoRoutes({ 'README.md': 'x', 'src/a.ts': 'y' }));
    const d = await github.extract(ctxFor('https://github.com/o/r/blob/main/src/a.ts', f), { ...o, mode: 'digest' }, noop);
    expect(d.files).toHaveLength(2);
  });
  it('лимит запросов raw → пауза с прогрессом; продолжение берёт недостающее из кэша', async () => {
    const cache = new TtlCache();
    const files = { 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c', 'd.ts': 'd' };
    let limited = true;
    const s1 = server(...repoRoutes(files, { rawStatus: p => (limited && (p === 'c.ts' || p === 'd.ts') ? 429 : undefined) }));
    const err = await github.extract(ctxFor('https://github.com/o/r', s1.f, cache), { ...o, mode: 'digest', concurrency: 1 }, noop).catch(e => e);
    expect(err).toBeInstanceOf(PausedError);
    expect(err.done).toBe(2);
    limited = false;
    const s2 = server(...repoRoutes(files));
    const d = await github.extract(ctxFor('https://github.com/o/r', s2.f, cache), { ...o, mode: 'digest', concurrency: 1 }, noop);
    expect(d.files).toHaveLength(4);
    expect(s2.calls.filter(c => c.includes('raw.githubusercontent.com'))).toHaveLength(2); // скачаны только c и d
  });
  it('«сохранить, что есть» после паузы', async () => {
    const cache = new TtlCache();
    const s1 = server(...repoRoutes({ 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' }, { rawStatus: p => (p === 'c.ts' ? 429 : undefined) }));
    await github.extract(ctxFor('https://github.com/o/r', s1.f, cache), { ...o, mode: 'digest', concurrency: 1 }, noop).catch(() => {});
    const s2 = server(...repoRoutes({ 'a.ts': 'a', 'b.ts': 'b', 'c.ts': 'c' }));
    const d = await github.extract(ctxFor('https://github.com/o/r', s2.f, cache), { ...o, mode: 'digest', partial: true }, noop);
    expect(d.files!.map(x => x.path)).toEqual(['a.ts', 'b.ts']);
    expect(s2.calls.filter(c => c.includes('raw.'))).toHaveLength(0);
    expect(d.warnings.join(' ')).toContain('частично');
  });
  it('понятные ошибки: нет страницы, лимит API, слишком большой репозиторий, нет файлов', async () => {
    const notFound = server();
    await expect(github.extract(ctxFor('https://github.com/o/r', notFound.f), { ...o, mode: 'digest' }, noop)).rejects.toThrow(/не нашёл страницу/);
    const limit = server(() => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } }));
    const lim = await github.extract(ctxFor('https://github.com/o/r', limit.f), { ...o, mode: 'digest' }, noop).catch(e => e);
    expect(lim).toBeInstanceOf(PausedError);
    expect(lim.message).toMatch(/Лимит запросов GitHub/);
    expect(lim.retryAt).toBeGreaterThan(Date.now());
    const forbidden = server(() => new Response('{"message":"Resource not accessible by personal access token"}', { status: 403 }));
    await expect(github.extract(ctxFor('https://github.com/o/r', forbidden.f), { ...o, mode: 'digest' }, noop)).rejects.toThrow(/отказал в доступе: Resource not accessible/);
    const big = server(u => (u.pathname === '/repos/o/r' ? json({ default_branch: 'main', size: 900_000 }) : undefined));
    await expect(github.extract(ctxFor('https://github.com/o/r', big.f), { ...o, mode: 'digest' }, noop)).rejects.toThrow(/слишком большой \(879 МБ\)/);
    const empty = server(...repoRoutes({ 'yarn.lock': 'x' }));
    await expect(github.extract(ctxFor('https://github.com/o/r', empty.f), { ...o, mode: 'digest' }, noop)).rejects.toThrow(/Нет файлов/);
  });
});

// ───────────── issues и pull requests ─────────────
const user = (login: string) => ({ login });
const ISSUE = { number: 5, title: 'Падает при старте', state: 'closed', body: 'Описание\r\nпроблемы', user: user('ann'), created_at: '2024-05-01T10:00:00Z', closed_at: '2024-05-03T10:00:00Z', labels: [{ name: 'bug' }, { name: 'ui' }], assignees: [user('bob')], milestone: { title: 'v1' }, comments: 3, html_url: 'https://github.com/o/r/issues/5', reactions: { total_count: 2 } };
const C = (id: number, login: string, at: string, body: string, extra: object = {}) => ({ id, user: user(login), created_at: at, body, reactions: { total_count: 0 }, ...extra });

describe('issue и pull request (страница)', () => {
  it('issue: описание, метки, комментарии с пагинацией по Link', async () => {
    const { f, calls } = server(
      u => (u.pathname === '/repos/o/r/issues/5' ? json(ISSUE) : undefined),
      u => {
        if (u.pathname !== '/repos/o/r/issues/5/comments') return undefined;
        return u.searchParams.get('page') === '2'
          ? json([C(3, 'dan', '2024-05-02T12:00:00Z', 'Исправлено')])
          : json([C(1, 'bob', '2024-05-01T11:00:00Z', 'Воспроизвёл'), C(2, 'cat', '2024-05-01T12:00:00Z', 'Тоже', { reactions: { total_count: 4 } })], { link: '<https://api.github.com/repos/o/r/issues/5/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repos/o/r/issues/5/comments?per_page=100&page=2>; rel="last"' });
      },
    );
    const d = await github.extract(ctxFor('https://github.com/o/r/issues/5', f), { ...o, mode: 'item' }, noop);
    expect(d.title).toBe('Падает при старте');
    expect(d.body).toBe('Описание\nпроблемы');
    expect(d.meta.map(([k, v]) => `${k}=${v}`).slice(0, 4)).toEqual(['Состояние=closed', 'Автор=ann', 'Дата=2024-05-01T10:00:00Z', 'Метки=bug, ui']);
    expect(d.items.map(i => [i.author, i.score])).toEqual([['bob', null], ['cat', 4], ['dan', null]]);
    expect(calls.filter(c => c.includes('/comments'))).toHaveLength(2);
    const out = formatDoc(d, { ...o, format: 'txt' });
    expect(out).toMatch(/^Падает при старте\nhttps:\/\/github.com\/o\/r\/issues\/5\nСостояние: closed \| Автор: ann/);
    expect(out).toMatch(/\ncat 12:00 \+4\nТоже\n/); // тот же день → только время
  });
  it('без комментариев — один запрос', async () => {
    const { f, calls } = server(u => (u.pathname === '/repos/o/r/issues/5' ? json(ISSUE) : undefined));
    const d = await github.extract(ctxFor('https://github.com/o/r/issues/5', f), { ...o, mode: 'item', comments: false }, noop);
    expect(d.items).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it('pull request: ветки, ревью и комментарии к коду по времени', async () => {
    const { f } = server(
      u => (u.pathname === '/repos/o/r/issues/7' ? json({ ...ISSUE, number: 7, title: 'Фикс', state: 'open', pull_request: {}, html_url: 'https://github.com/o/r/pull/7' }) : undefined),
      u => (u.pathname === '/repos/o/r/pulls/7' ? json({ merged: true, head: { ref: 'fix' }, base: { ref: 'main' }, additions: 10, deletions: 2, changed_files: 3 }) : undefined),
      u => (u.pathname === '/repos/o/r/issues/7/comments' ? json([C(1, 'bob', '2024-05-01T13:00:00Z', 'Общий комментарий')]) : undefined),
      u => (u.pathname === '/repos/o/r/pulls/7/comments' ? json([C(2, 'cat', '2024-05-01T12:00:00Z', 'Тут лучше const', { path: 'src/a.ts', line: 12 })]) : undefined),
      u => (u.pathname === '/repos/o/r/pulls/7/reviews' ? json([{ user: user('dan'), submitted_at: '2024-05-01T14:00:00Z', state: 'APPROVED', body: '' }, { user: user('eve'), submitted_at: '2024-05-01T11:00:00Z', state: 'COMMENTED', body: '' }]) : undefined),
    );
    const d = await github.extract(ctxFor('https://github.com/o/r/pull/7', f), { ...o, mode: 'item' }, noop);
    expect(d.meta.find(([k]) => k === 'Состояние')![1]).toBe('merged');
    expect(d.meta.find(([k]) => k === 'Ветки')![1]).toBe('fix → main');
    expect(d.items.map(i => i.text)).toEqual(['(src/a.ts:12) Тут лучше const', 'Общий комментарий', '[APPROVED]']); // пустое «просмотрено» отброшено
  });
});

describe('все issues и pull requests', () => {
  const issueRows = [
    { number: 3, title: 'Свежий', state: 'open', body: 'b3', user: user('a'), created_at: '2024-05-03T00:00:00Z', labels: [{ name: 'bug' }], reactions: { total_count: 1 } },
    { number: 2, title: 'PR в списке issues', state: 'open', body: 'x', user: user('b'), created_at: '2024-05-02T00:00:00Z', labels: [], pull_request: {} },
    { number: 1, title: 'Старый', state: 'closed', body: '', user: user('c'), created_at: '2024-05-01T00:00:00Z', labels: [] },
  ];
  const comments = [
    C(1, 'x', '2024-05-01T05:00:00Z', 'к старому', { issue_url: 'https://api.github.com/repos/o/r/issues/1' }),
    C(2, 'y', '2024-05-03T05:00:00Z', 'к свежему', { issue_url: 'https://api.github.com/repos/o/r/issues/3' }),
    C(3, 'z', '2024-05-02T05:00:00Z', 'к PR (не нужен)', { issue_url: 'https://api.github.com/repos/o/r/issues/2' }),
    C(4, 'w', '2024-05-03T06:00:00Z', 'к постороннему', { issue_url: 'https://api.github.com/repos/o/r/issues/99' }),
  ];
  const routes: Handler[] = [
    u => (u.pathname === '/repos/o/r/issues' ? json(issueRows, { link: '<https://api.github.com/repos/o/r/issues?page=1>; rel="last"' }) : undefined),
    u => (u.pathname === '/repos/o/r/issues/comments' ? json(comments) : undefined),
  ];
  it('issues: без PR, по возрастанию номера, комментарии вложены, один запрос на все комментарии', async () => {
    const { f, calls } = server(...routes);
    const d = await github.extract(ctxFor('https://github.com/o/r/issues', f), { ...o, mode: 'issues' }, noop);
    expect(d.kind).toBe('list');
    expect(d.title).toBe('o/r: Issues');
    expect(d.items.map(i => `${i.level}:${i.id || '-'}:${i.author}`)).toEqual(['0:1:c', '1:-:x', '0:3:a', '1:-:y']);
    expect(d.items[0]!.text).toBe('Старый [closed]');
    expect(d.items[2]!.text).toBe('Свежий [bug]\nb3');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('since=2024-05-01T00%3A00%3A00Z');
    const out = formatDoc(d, { ...o, format: 'txt' });
    expect(out).toContain('Issues 2\n\n1 c 2024-05-01 00:00\nСтарый [closed]\n\n> x 05:00\nк старому\n\n3 a 2024-05-03 00:00 +1\nСвежий [bug]\nb3');
  });
  it('состояние и лимит из настроек, без комментариев — без второго запроса', async () => {
    const s = server(...routes);
    const d = await github.extract(ctxFor('https://github.com/o/r/issues', s.f), { ...o, mode: 'issues', comments: false, github: { ...o.github, state: 'open', maxItems: 10 } }, noop);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toContain('state=open');
    expect(d.items).toHaveLength(2);
    const lim = await github.extract(ctxFor('https://github.com/o/r/issues', server(...routes).f), { ...o, mode: 'issues', comments: false, github: { ...o.github, maxItems: 10 } }, noop);
    expect(lim.warnings).toEqual([]);
  });
  it('pull requests: свои эндпоинты, комментарии к коду', async () => {
    const s = server(
      u => (u.pathname === '/repos/o/r/pulls' ? json([{ number: 9, title: 'Фича', state: 'open', merged_at: null, draft: true, body: 'pr', user: user('a'), created_at: '2024-05-03T00:00:00Z', labels: [] }]) : undefined),
      u => (u.pathname === '/repos/o/r/issues/comments' ? json([C(1, 'x', '2024-05-03T05:00:00Z', 'общее', { issue_url: 'https://api.github.com/repos/o/r/issues/9' })]) : undefined),
      u => (u.pathname === '/repos/o/r/pulls/comments' ? json([C(2, 'y', '2024-05-03T04:00:00Z', 'тут', { pull_request_url: 'https://api.github.com/repos/o/r/pulls/9', path: 'a.ts', line: 3 })]) : undefined),
    );
    const d = await github.extract(ctxFor('https://github.com/o/r/pulls', s.f), { ...o, mode: 'pulls' }, noop);
    expect(d.items.map(i => i.text)).toEqual(['Фича [draft]\npr', '(a.ts:3) тут', 'общее']);
  });
  it('лимит GitHub посреди списка → пауза; продолжение не повторяет скачанные страницы', async () => {
    const cache = new TtlCache();
    let limited = true;
    const rl = () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) } });
    const s1 = server(routes[0]!, u => (u.pathname === '/repos/o/r/issues/comments' ? (limited ? rl() : json(comments)) : undefined));
    const err = await github.extract(ctxFor('https://github.com/o/r/issues', s1.f, cache), { ...o, mode: 'issues' }, noop).catch(e => e);
    expect(err).toBeInstanceOf(PausedError);
    limited = false;
    const s2 = server(routes[0]!, routes[1]!);
    const d = await github.extract(ctxFor('https://github.com/o/r/issues', s2.f, cache), { ...o, mode: 'issues' }, noop);
    expect(d.items).toHaveLength(4);
    expect(s2.calls).toHaveLength(1); // страница списка уже в кэше, докачаны только комментарии
    expect(s2.calls[0]).toContain('/issues/comments');
  });
});

// ───────────── обсуждения ─────────────
const gql = (handler: (query: string, vars: any) => object | number) => (u: URL, init?: RequestInit) => {
  if (u.pathname !== '/graphql') return undefined;
  const { query, variables } = JSON.parse(String(init?.body));
  const r = handler(query, variables);
  return typeof r === 'number' ? new Response('{"message":"Requires authentication"}', { status: r }) : json({ data: r });
};
const DISC = { number: 4, title: 'Как настроить?', body: 'Вопрос', createdAt: '2024-05-01T10:00:00Z', upvoteCount: 2, closed: false, url: 'https://github.com/o/r/discussions/4', author: user('ann'), category: { name: 'Q&A' }, answer: { id: 'x' }, labels: { nodes: [{ name: 'help' }] } };
const comment = (login: string, body: string, extra: object = {}) => ({ id: login, body, createdAt: '2024-05-01T11:00:00Z', upvoteCount: 0, isAnswer: false, author: user(login), replies: { totalCount: 0, nodes: [] }, ...extra });

describe('обсуждения', () => {
  it('одно обсуждение через GraphQL: ответ-решение отмечен, ответы вложены', async () => {
    const { f } = server(gql(() => ({ repository: { discussion: { ...DISC, comments: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment('bob', 'Попробуйте так', { isAnswer: true, upvoteCount: 3, replies: { totalCount: 1, nodes: [{ body: 'Помогло', createdAt: '2024-05-01T12:00:00Z', upvoteCount: 0, author: user('ann') }] } }), comment('cat', 'Или так')] } } } })));
    const d = await github.extract(ctxFor('https://github.com/o/r/discussions/4', f), { ...o, mode: 'item' }, noop);
    expect(d.title).toBe('Как настроить?');
    expect(d.body).toBe('Вопрос');
    expect(d.meta.map(([k, v]) => `${k}=${v}`)).toContain('Категория=Q&A');
    expect(d.items.map(i => `${i.level}:${i.author}:${i.text}`)).toEqual(['0:bob:[answer] Попробуйте так', '1:ann:Помогло', '0:cat:Или так']);
    const out = formatDoc(d, { ...o, format: 'txt' });
    expect(out).toContain('Комментарии 3\n\nbob 2024-05-01 11:00 +3\n[answer] Попробуйте так\n\n> ann 12:00\nПомогло');
  });
  it('комментарии постранично: курсор', async () => {
    let calls = 0;
    const { f } = server(gql((_q, v) => {
      calls++;
      const second = v.after === 'c1';
      return { repository: { discussion: { ...DISC, comments: { totalCount: 2, pageInfo: { hasNextPage: !second, endCursor: second ? null : 'c1' }, nodes: [comment(second ? 'p2' : 'p1', second ? 'вторая' : 'первая')] } } } };
    }));
    const d = await github.extract(ctxFor('https://github.com/o/r/discussions/4', f), { ...o, mode: 'item' }, noop);
    expect(calls).toBe(2);
    expect(d.items.map(i => i.author)).toEqual(['p1', 'p2']);
  });
  it('все обсуждения: фильтр состояния, лимит, комментарии вложены на уровень глубже', async () => {
    const page = (nodes: any[], more: boolean) => ({ repository: { discussions: { totalCount: 3, pageInfo: { hasNextPage: more, endCursor: more ? 'p' : null }, nodes } } });
    const mk = (n: number, closed: boolean) => ({ ...DISC, number: n, title: `Т${n}`, closed, comments: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment(`u${n}`, `к${n}`, { replies: { totalCount: 1, nodes: [{ body: `о${n}`, createdAt: '2024-05-01T12:00:00Z', author: user('r') }] } })] } });
    const { f } = server(gql((_q, v) => (v.after ? page([mk(1, true)], false) : page([mk(3, false), mk(2, true)], true))));
    const all = await github.extract(ctxFor('https://github.com/o/r/discussions', f), { ...o, mode: 'discussions' }, noop);
    expect(all.items.filter(i => i.id).map(i => i.id)).toEqual(['3', '2', '1']);
    expect(all.items.map(i => i.level)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(all.items[0]!.text).toBe('Т3 [Q&A, answered, help]\nВопрос');
    const open = await github.extract(ctxFor('https://github.com/o/r/discussions', server(gql((_q, v) => (v.after ? page([mk(1, true)], false) : page([mk(3, false), mk(2, true)], true)))).f), { ...o, mode: 'discussions', github: { ...o.github, state: 'open' } }, noop);
    expect(open.items.filter(i => i.id).map(i => i.id)).toEqual(['3']);
    const limited = await github.extract(ctxFor('https://github.com/o/r/discussions', server(gql(() => page([mk(3, false), mk(2, true)], true))).f), { ...o, mode: 'discussions', github: { ...o.github, maxItems: 10 } }, noop);
    expect(limited.warnings).toEqual([]);
  });
  it('без токена: список обсуждений недоступен с понятным сообщением', async () => {
    const { f } = server(gql(() => 401));
    await expect(github.extract(ctxFor('https://github.com/o/r/discussions', f), { ...o, mode: 'discussions' }, noop)).rejects.toThrow(/нужен токен GitHub/);
  });
  it('без токена: одно обсуждение читается со страницы', async () => {
    const html = `<html><body><h1><bdi>Как настроить?</bdi></h1>
      <div class="timeline"><div class="item"><a data-hovercard-type="user">ann</a><relative-time datetime="2024-05-01T10:00:00Z"></relative-time><div class="markdown-body"><p>Вопрос</p></div></div>
      <div class="item"><a data-hovercard-type="user">bob</a><relative-time datetime="2024-05-01T11:00:00Z"></relative-time><div class="markdown-body"><p>Ответ</p></div>
        <div class="replies"><div class="item"><a data-hovercard-type="user">ann</a><relative-time datetime="2024-05-01T12:00:00Z"></relative-time><div class="markdown-body"><p>Спасибо</p></div></div></div></div></div></body></html>`;
    const { f } = server(gql(() => 401));
    const d = await github.extract(ctxFor('https://github.com/o/r/discussions/4', f, new TtlCache(), html), { ...o, mode: 'item' }, noop);
    expect(d.title).toBe('Как настроить?');
    expect(d.body).toBe('Вопрос');
    expect(d.items.map(i => `${i.level}:${i.author}:${i.text}`)).toEqual(['0:bob:Ответ', '1:ann:Спасибо']);
    expect(d.warnings[0]).toContain('без токена');
  });
});

describe('адаптер GitHub: определение', () => {
  it('режимы и порядок: GitHub раньше универсального разбора', () => {
    const c = ctxFor('https://github.com/o/r/issues/5', vi.fn() as never);
    expect(github.detect(c)).toBe(true);
    expect(github.modes!(c)).toEqual({ list: ['item', 'digest', 'issues', 'pulls', 'discussions'], def: 'item' });
    expect(github.detect(ctxFor('https://github.com/settings/profile', vi.fn() as never))).toBe(false);
  });
});

describe('исправления по ревью', () => {
  it('дайджест: ссылки внутри файлов остаются дословными (relativize не трогает репозиторий)', async () => {
    const files = { 'README.md': 'См. https://github.com/o/r/issues и https://github.com/o/r/pulls', 'a.md': 'https://github.com/x/y/z' };
    const { f } = server(...repoRoutes(files));
    const d = await github.extract(ctxFor('https://github.com/o/r', f), { ...o, mode: 'digest' }, noop);
    const out = formatDoc(d, { ...o, format: 'txt' });
    expect(out).toContain('См. https://github.com/o/r/issues и https://github.com/o/r/pulls');
    expect(out).not.toContain('начинающиеся с «/»');
  });

  it('кэш ответов API очищается после успешного запуска (устаревшее не подмешивается)', async () => {
    const cache = new TtlCache();
    let title = 'Первый';
    const { f } = server(u => (u.pathname === '/repos/o/r/issues/5' ? json({ ...ISSUE, title }) : undefined), u => (u.pathname === '/repos/o/r/issues/5/comments' ? json([]) : undefined));
    const a = await github.extract(ctxFor('https://github.com/o/r/issues/5', f, cache), { ...o, mode: 'item' }, noop);
    title = 'Второй';
    const b = await github.extract(ctxFor('https://github.com/o/r/issues/5', f, cache), { ...o, mode: 'item' }, noop);
    expect([a.title, b.title]).toEqual(['Первый', 'Второй']);
  });

  it('«Сохранить, что есть» для списка issues: не докачивает, берёт скачанные страницы и сохраняет кэш', async () => {
    const cache = new TtlCache();
    const rl = () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const issue = (n: number) => ({ number: n, title: `И${n}`, state: 'open', body: '', user: user('a'), created_at: `2024-05-0${n}T00:00:00Z`, labels: [] });
    const link = (p: number) => ({ link: `<https://api.github.com/repos/o/r/issues?page=${p + 1}&per_page=100>; rel="next", <https://api.github.com/repos/o/r/issues?page=2&per_page=100>; rel="last"` });
    let limited = true;
    const s1 = server(u => {
      if (u.pathname !== '/repos/o/r/issues') return undefined;
      return u.searchParams.get('page') === '2' ? (limited ? rl() : json([issue(1)])) : json([issue(2)], link(1));
    });
    const err = await github.extract(ctxFor('https://github.com/o/r/issues', s1.f, cache), { ...o, mode: 'issues', comments: false }, noop).catch(e => e);
    expect(err).toBeInstanceOf(PausedError);
    expect(err.done).toBeGreaterThan(0);
    const s2 = server();
    const part = await github.extract(ctxFor('https://github.com/o/r/issues', s2.f, cache), { ...o, mode: 'issues', comments: false, partial: true }, noop);
    expect(s2.calls).toHaveLength(0);
    expect(part.items.map(i => i.id)).toEqual(['2']);
    expect(part.warnings.join(' ')).toContain('GitHub ограничил запросы');
    limited = false;
    const s3 = server(u => (u.pathname === '/repos/o/r/issues' && u.searchParams.get('page') === '2' ? json([issue(1)]) : undefined));
    const full = await github.extract(ctxFor('https://github.com/o/r/issues', s3.f, cache), { ...o, mode: 'issues', comments: false }, noop);
    expect(full.items.map(i => i.id)).toEqual(['1', '2']);
    expect(s3.calls).toHaveLength(1); // страница 1 из кэша, докачана только вторая
  });

  it('список обсуждений: ответы GraphQL кэшируются, «продолжить» не повторяет оплаченное, partial берёт готовое', async () => {
    const cache = new TtlCache();
    const mk = (n: number) => ({ ...DISC, number: n, title: `Т${n}`, comments: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } });
    const page = (nodes: any[], more: boolean) => ({ repository: { discussions: { totalCount: 2, pageInfo: { hasNextPage: more, endCursor: more ? 'p' : null }, nodes } } });
    let calls = 0;
    let limited = true;
    const f = server((u, init) => {
      if (u.pathname !== '/graphql') return undefined;
      calls++;
      const v = JSON.parse(String(init!.body)).variables;
      if (v.after && limited) return new Response('{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}', { headers: { 'content-type': 'application/json' } });
      return json({ data: v.after ? page([mk(1)], false) : page([mk(2)], true) });
    }).f;
    const err = await github.extract(ctxFor('https://github.com/o/r/discussions', f, cache), { ...o, mode: 'discussions' }, noop).catch(e => e);
    expect(err).toBeInstanceOf(PausedError);
    limited = false;
    calls = 0;
    const part = await github.extract(ctxFor('https://github.com/o/r/discussions', f, cache), { ...o, mode: 'discussions', partial: true }, noop);
    expect(calls).toBe(0);
    expect(part.items.map(i => i.id)).toEqual(['2']);
    const full = await github.extract(ctxFor('https://github.com/o/r/discussions', f, cache), { ...o, mode: 'discussions' }, noop);
    expect(calls).toBe(1); // первая страница из кэша
    expect(full.items.map(i => i.id)).toEqual(['2', '1']);
  });

  it('GraphQL: пустой repository/discussion → понятное «не найдено», а не TypeError', async () => {
    const nf = server(gql(() => ({ repository: { discussion: null } })));
    await expect(github.extract(ctxFor('https://github.com/o/r/discussions/9', nf.f), { ...o, mode: 'item' }, noop)).rejects.toThrow(/не нашёл страницу/);
    const off = server(gql(() => ({ repository: { discussions: null } })));
    await expect(github.extract(ctxFor('https://github.com/o/r/discussions', off.f), { ...o, mode: 'discussions' }, noop)).rejects.toThrow(/нет обсуждений/);
    const missing = server((u, init) => (u.pathname === '/graphql' ? new Response(JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository" }] }), { headers: { 'content-type': 'application/json' } }) : undefined));
    await expect(github.extract(ctxFor('https://github.com/o/r/discussions/9', missing.f), { ...o, mode: 'item' }, noop)).rejects.toThrow(/не нашёл страницу/);
  });

  it('обрезание списка по числу страниц помечается', async () => {
    const f = (async (u: string) => new Response(JSON.stringify([1]), { headers: { 'content-type': 'application/json', link: `<${u}&x=1>; rel="next"` } })) as never;
    const api = new GitHubApi(f);
    const out = await api.paginate('/x?per_page=1', { maxPages: 3 });
    expect(out).toHaveLength(3);
    expect(api.truncated).toBe(true);
  });

  it('лимит с Retry-After, но без времени сброса: сообщение с подсказкой подождать, а не «…»', () => {
    const L = tFor('ru');
    const withTime = limitPause(new RateLimitError(403, null, Date.now() + 120_000), L, 'ru');
    expect(withTime.message).toMatch(/снимется около \d/);
    const retry = limitPause(new RateLimitError(429, 90_000, null), L, 'ru');
    expect(retry.message).toMatch(/снимется около \d/);
    expect(retry.retryAt).toBeGreaterThan(Date.now());
    const none = limitPause(new RateLimitError(403, null, null), L, 'ru');
    expect(none.message).toMatch(/Подождите несколько минут/);
    expect(none.message).not.toContain('…');
  });

  it('не-репозитории GitHub не перехватываются адаптером', () => {
    for (const x of ['/copilot/agents', '/models/foo', '/enterprises/acme/settings', '/solutions/ci', '/resources/articles']) expect(parseGithub(new URL('https://github.com' + x)), x).toBeNull();
  });
});
