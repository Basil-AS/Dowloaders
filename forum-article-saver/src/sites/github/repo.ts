import { getText, HttpError, PausedError, RateLimitError, runPool } from '../../core/http';
import { tFor } from '../../core/i18n';
import type { Ctx, ExtractOptions, Meta, ParsedDoc, ProgressFn, RepoFile } from '../../core/types';
import { GitHubApi, NotFoundError } from './api';
import { DEFAULT_IGNORE, isReadme, makeMatcher, parsePatterns } from './ignore';
import { estimateTokens, fmtTokens, renderTree } from './tree';
import type { GhRef } from './url';

/** Репозитории тяжелее этого (по данным GitHub, КБ) не разбираем: это сотни мегабайт текста. */
export const MAX_REPO_KB = 400_000;
export const MAX_FILES = 1500;
const RAW = 'https://raw.githubusercontent.com';

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
  sha: string;
  mode?: string;
}

/** Не текст: в начале встречаются нулевые байты или много символов замены. */
export const looksBinary = (text: string): boolean => {
  const head = text.slice(0, 4000);
  if (head.includes('\u0000')) return true;
  let bad = 0;
  for (const ch of head) if (ch === '�') bad++;
  return head.length > 0 && bad / head.length > 0.02;
};

/** Дайджест репозитория в духе gitingest: структура каталогов + содержимое файлов, готовое для LLM. */
export async function extractRepo(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const f = ctx.bgFetch ?? ctx.fetch;
  const api = new GitHubApi(f, ctx.cache);
  const { owner, repo } = g;
  progress({ done: 0, total: 1 });

  const info = (await api.get<any>(`/repos/${owner}/${repo}`)).data;
  if (info.size > MAX_REPO_KB) throw new Error(L('e_repo_big', { mb: Math.round(info.size / 1024) }));

  // Ветка в адресе может содержать «/»: перебираем возможные границы «ветка | путь» и проверяем по API.
  const cands = g.refPath.length ? Array.from({ length: Math.min(4, g.refPath.length) }, (_, i) => g.refPath.slice(0, i + 1).join('/')) : [info.default_branch as string];
  let sha = '';
  let ref = '';
  let sub = '';
  for (const [i, c] of cands.entries()) {
    try {
      sha = String((await api.get<string>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(c)}`, { Accept: 'application/vnd.github.sha' })).data).trim();
      ref = c;
      sub = g.blob ? '' : g.refPath.slice(i + 1).join('/');
      break;
    } catch (e) {
      if (e instanceof NotFoundError || (e instanceof HttpError && e.status === 422)) continue;
      throw e;
    }
  }
  if (!sha) throw new NotFoundError(`${owner}/${repo}@${g.refPath.join('/')}`);

  const tree = (await api.get<{ tree: TreeEntry[]; truncated?: boolean }>(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`)).data;
  const warnings: string[] = [];
  if (tree.truncated) warnings.push(L('w_tree_truncated'));

  const ignored = makeMatcher([...DEFAULT_IGNORE, ...parsePatterns(o.github.exclude)]);
  const includeList = parsePatterns(o.github.include);
  const included = includeList.length ? makeMatcher(includeList) : null;
  const maxBytes = o.github.maxFileKb * 1024;
  const prefix = sub ? `${sub}/` : '';

  let tooLarge = 0;
  let candidates = tree.tree.filter(e => e.type === 'blob' && e.mode !== '120000' && (e.size ?? 0) > 0 && e.path.startsWith(prefix) && !ignored(e.path) && (!included || included(e.path)));
  candidates = candidates.filter(e => (e.size ?? 0) <= maxBytes || (tooLarge++, false));
  candidates.sort((a, b) => Number(isReadme(b.path)) - Number(isReadme(a.path)) || a.path.localeCompare(b.path));
  let overLimit = 0;
  if (candidates.length > MAX_FILES) {
    overLimit = candidates.length - MAX_FILES;
    candidates = candidates.slice(0, MAX_FILES);
  }
  if (!candidates.length) throw new Error(L('e_no_files'));

  const key = (e: TreeEntry) => `gh:file:${owner}/${repo}:${e.sha}`;
  const rel = (p: string) => (prefix ? p.slice(prefix.length) : p);
  const url = (p: string) => `${RAW}/${owner}/${repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`;
  const total = candidates.length;
  let done = candidates.filter(e => ctx.cache.has(key(e))).length; // уже скачанное с прошлой попытки
  const doneCount = () => done;

  if (!o.partial) {
    try {
      await runPool(
        candidates.filter(e => !ctx.cache.has(key(e))),
        Math.min(o.concurrency, 6),
        async e => {
          try {
            const text = await getText(f, url(e.path));
            ctx.cache.set(key(e), looksBinary(text) ? { skip: 'binary' } : { text });
          } catch (err) {
            if (err instanceof RateLimitError) throw err;
            ctx.cache.set(key(e), { skip: 'failed' });
          }
          done++;
          progress({ done, total });
        },
        Math.min(o.delayMs, 100),
        e => e instanceof RateLimitError,
      );
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
      throw new PausedError(L('w_paused', { site: 'GitHub', status: e.status, done: doneCount(), total }), doneCount(), total, e.resetAt);
    }
  }

  const files: RepoFile[] = [];
  let binary = 0;
  let failed = 0;
  let missing = 0;
  for (const e of candidates) {
    const c = ctx.cache.get<{ text?: string; skip?: string }>(key(e));
    if (!c) missing++;
    else if (c.skip === 'binary') binary++;
    else if (c.skip) failed++;
    else if (c.text && c.text.trim()) files.push({ path: rel(e.path), content: c.text.replace(/\r\n/g, '\n').replace(/\s+$/, '') });
  }
  if (!files.length) throw new Error(L('e_no_files'));

  const skipped = [
    tooLarge && L('w_skip_large', { n: tooLarge, kb: o.github.maxFileKb }),
    binary && L('w_skip_binary', { n: binary }),
    overLimit && L('w_skip_over', { n: overLimit, max: MAX_FILES }),
    failed && L('w_skip_failed', { n: failed }),
    missing && L('w_partial', { done: total - missing, total }),
  ].filter(Boolean) as string[];
  if (skipped.length) warnings.push(`${L('w_skipped')}: ${skipped.join('; ')}`);

  const treeText = renderTree(files.map(x => x.path), sub ? `${repo}/${sub}` : repo);
  const tokens = estimateTokens(files.reduce((n, x) => n + x.content.length + x.path.length + 8, 0) + treeText.length);
  const meta: Meta[] = [
    [L('m_ref'), `${ref} (${sha.slice(0, 7)})`],
    [L('m_files'), String(files.length)],
    [L('m_tokens'), fmtTokens(tokens)],
  ];
  if (info.description) meta.push([L('m_desc'), String(info.description), true]);
  if (info.private) meta.push([L('m_private'), '✓', true]);

  return {
    id: `${owner}-${repo}`,
    site: 'github.com',
    kind: 'repo',
    title: sub ? `${owner}/${repo}/${sub}` : `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}${sub ? `/tree/${ref}/${sub}` : ''}`,
    meta,
    body: '',
    items: [],
    totalItems: null,
    tree: treeText,
    files,
    warnings,
  };
}
