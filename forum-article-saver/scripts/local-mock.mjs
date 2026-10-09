// Локальный HTTPS-сервер, изображающий GitHub (github.com, api.github.com, raw.githubusercontent.com) и 4PDA.
// Браузеру эти хосты сопоставляются с сервером (host-resolver-rules), поэтому фон расширения ходит в настоящую сеть:
// проверяются токен в заголовках, лимиты 429, пагинация и т.д.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

export const HOSTS = ['github.com', 'api.github.com', 'raw.githubusercontent.com', '4pda.to'];
const SHA = 'abc1234deadbeef';
export const FILES = {
  'README.md': '# Демо\nОписание проекта\n',
  'src/a.ts': 'export const a = 1;\n',
  'src/b.ts': 'export const b = 2;\n',
  'docs/guide.md': 'Руководство пользователя\n',
  'src/app.min.js': 'minified',
  'node_modules/x/index.js': 'x',
  'img/logo.png': 'PNG',
  'yarn.lock': 'lock',
};
const user = login => ({ login });
const ISSUE = { number: 5, title: 'Падает при старте', state: 'closed', body: 'Описание проблемы', user: user('ann'), created_at: '2024-05-01T10:00:00Z', labels: [{ name: 'bug' }], assignees: [], comments: 2, html_url: 'https://github.com/o/r/issues/5', reactions: { total_count: 1 } };
const ISSUE2 = { number: 6, title: 'Нужна тёмная тема', state: 'open', body: 'Хочу', user: user('bob'), created_at: '2024-05-02T10:00:00Z', labels: [], comments: 0, reactions: { total_count: 0 } };
const comment = (id, login, at, body, extra = {}) => ({ id, user: user(login), created_at: at, body, reactions: { total_count: 0 }, ...extra });
const DISC = { number: 4, title: 'Как настроить?', body: 'Вопрос', createdAt: '2024-05-01T10:00:00Z', upvoteCount: 2, closed: false, url: 'https://github.com/o/r/discussions/4', author: user('ann'), category: { name: 'Q&A' }, answer: null, labels: { nodes: [] }, comments: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'c1', body: 'Попробуйте так', createdAt: '2024-05-01T11:00:00Z', upvoteCount: 1, isAnswer: true, author: user('bob'), replies: { totalCount: 0, nodes: [] } }] } };

const enc1251 = s => Buffer.from([...s].map(c => { const n = c.charCodeAt(0); return n >= 0x410 && n <= 0x44f ? n - 0x410 + 0xc0 : n < 128 ? n : 63; }));
const pdaPage = n => `<html><body><table class="ipbtable" data-post="${n}"><tr><td class="row2" id="ph-${n}-d2">01.01.24, 10:00</td><td><span class="normalname"><a>user${n}</a></span><a title="Ссылка на это сообщение">${n}</a></td><td><div class="postcolor">message ${n}</div></td></tr></table></body></html>`;

export async function startMock(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const san = HOSTS.map(h => `DNS:${h}`).join(',');
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${path.join(dir, 'k.pem')} -out ${path.join(dir, 'c.pem')} -days 2 -subj "/CN=mock" -addext "subjectAltName=${san}" 2>/dev/null`);

  /** Всё, чем тесты управляют и что проверяют. */
  const st = { rawLimit: new Set(), rawCalls: [], apiCalls: [], auth: { api: [], raw: [] }, pdaLimitAfter: Infinity, pdaCalls: [], pdaOk: 0, graphqlNeedsToken: true };

  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const u = new URL(req.url, `https://${host}`);
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    const text = (code, body, ct = 'text/plain; charset=utf-8', headers = {}) => send(code, body, { 'content-type': ct, ...headers });
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      if (host === 'github.com') {
        const disc = /\/discussions\/4/.test(u.pathname);
        return text(200, `<!doctype html><html><head><meta charset="utf-8"><title>${u.pathname} · o/r</title></head><body>${disc ? '<h1><bdi>Как настроить?</bdi></h1><div class="item"><a data-hovercard-type="user">ann</a><relative-time datetime="2024-05-01T10:00:00Z"></relative-time><div class="markdown-body"><p>Вопрос со страницы</p></div></div>' : '<h1>GitHub mock</h1>'}</body></html>`, 'text/html; charset=utf-8');
      }
      if (host === '4pda.to') {
        const stp = Number(u.searchParams.get('st') ?? 0);
        if (u.searchParams.has('st')) {
          st.pdaCalls.push(stp / 20);
          if (st.pdaOk >= st.pdaLimitAfter) return text(429, '', 'text/plain', { 'retry-after': '1' });
          st.pdaOk++;
          return text(200, enc1251(pdaPage(stp / 20 + 1)), 'text/html; charset=windows-1251');
        }
        return text(200, '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 itemprop="name">Тема 4pda</h1><span class="pagelink-menu">6 страниц</span></body></html>', 'text/html; charset=utf-8');
      }
      if (host === 'raw.githubusercontent.com') {
        const p = decodeURIComponent(u.pathname.replace(`/o/r/${SHA}/`, ''));
        st.rawCalls.push(p);
        if (req.headers.authorization) st.auth.raw.push(req.headers.authorization);
        if (st.rawLimit.has(p)) return text(429, 'slow down', 'text/plain', { 'retry-after': '1' });
        return p in FILES ? text(200, FILES[p]) : text(404, 'not found');
      }
      if (host === 'api.github.com') {
        const p = u.pathname;
        st.apiCalls.push(`${req.method} ${p}`);
        if (req.headers.authorization) st.auth.api.push(req.headers.authorization);
        if (p === '/graphql') {
          if (st.graphqlNeedsToken && !req.headers.authorization) return send(401, { message: 'This endpoint requires you to be authenticated.' });
          const { query } = JSON.parse(body);
          const many = query.includes('discussions(first');
          return send(200, { data: { repository: many ? { discussions: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [DISC] } } : { discussion: DISC } } });
        }
        if (p === '/repos/o/r') return send(200, { default_branch: 'main', size: 300, description: 'Демо', private: false });
        if (p === '/repos/o/r/commits/main') return text(200, SHA);
        if (p === `/repos/o/r/git/trees/${SHA}`) return send(200, { truncated: false, tree: Object.entries(FILES).map(([path, c]) => ({ path, type: 'blob', mode: '100644', sha: `s-${path}`, size: c.length })) });
        if (p === '/repos/o/r/issues') return send(200, [ISSUE2, ISSUE]);
        if (p === '/repos/o/r/issues/5') return send(200, ISSUE);
        if (p === '/repos/o/r/issues/5/comments') return send(200, [comment(1, 'bob', '2024-05-01T11:00:00Z', 'Воспроизвёл'), comment(2, 'cat', '2024-05-01T12:00:00Z', 'Исправлено в main')]);
        if (p === '/repos/o/r/issues/comments') return send(200, [comment(1, 'bob', '2024-05-01T11:00:00Z', 'Воспроизвёл', { issue_url: 'https://api.github.com/repos/o/r/issues/5' })]);
        return send(404, { message: 'Not Found' });
      }
      send(404, { message: 'unknown host' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { st, port, resolverRules: HOSTS.map(h => `MAP ${h} 127.0.0.1:${port}`).join(', '), close: () => server.close() };
}
