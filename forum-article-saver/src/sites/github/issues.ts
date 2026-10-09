import { RateLimitError } from '../../core/http';
import { tFor } from '../../core/i18n';
import type { Ctx, ExtractOptions, Item, Meta, ParsedDoc, ProgressFn } from '../../core/types';
import { GitHubApi, limitPause } from './api';
import type { GhRef } from './url';

interface User {
  login?: string;
}
interface Reactions {
  total_count?: number;
}
interface GhComment {
  user?: User | null;
  created_at: string;
  body?: string | null;
  reactions?: Reactions;
  issue_url?: string;
  pull_request_url?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  state?: string;
  submitted_at?: string;
}

const reactions = (r?: Reactions) => (r?.total_count ? r.total_count : null);
const body = (s?: string | null) => (s ?? '').replace(/\r\n/g, '\n').trim();
const numberOf = (url?: string) => Number(url?.match(/\/(\d+)$/)?.[1]);

const comment = (c: GhComment, level: number, prefix = ''): Item => ({
  id: '',
  author: c.user?.login ?? 'ghost',
  date: c.created_at ?? c.submitted_at ?? '',
  score: reactions(c.reactions),
  level,
  replyTo: null,
  text: `${prefix}${body(c.body)}`.trim(),
});

/** Ревью-комментарий к строке кода: сначала где он, потом текст. */
const inline = (c: GhComment, level: number): Item => comment(c, level, c.path ? `(${c.path}${c.line ?? c.original_line ? `:${c.line ?? c.original_line}` : ''}) ` : '');
const review = (c: GhComment, level: number): Item | null => {
  const text = body(c.body);
  if (!text && (c.state === 'COMMENTED' || c.state === 'DISMISSED')) return null; // пустые «просмотрено» не нужны
  return { ...comment({ ...c, created_at: c.submitted_at ?? c.created_at }, level, `[${c.state ?? 'REVIEW'}] `), text: `[${c.state ?? 'REVIEW'}]${text ? ` ${text}` : ''}` };
};

const stateOf = (i: any, pr?: any) => (pr?.merged ? 'merged' : i.draft || pr?.draft ? 'draft' : i.state);
const labelsOf = (i: any) => ((i.labels ?? []) as any[]).map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean);

/** Одна страница issue или pull request: описание + все комментарии (у PR ещё ревью и комментарии к коду). */
export async function extractIssue(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const api = new GitHubApi(ctx.bgFetch ?? ctx.fetch, ctx.cache);
  const base = `/repos/${g.owner}/${g.repo}`;
  const n = g.number!;
  progress({ done: 0, total: 1 });

  const issue = (await api.get<any>(`${base}/issues/${n}`)).data;
  const isPr = !!issue.pull_request;
  const pr = isPr ? (await api.get<any>(`${base}/pulls/${n}`)).data : null;

  const items: Item[] = [];
  if (o.comments) {
    const onPage = (page: number, last: number | null) => progress({ done: page, total: Math.max(last ?? page, page) });
    const lists = await Promise.all([
      api.paginate<GhComment>(`${base}/issues/${n}/comments`, { onPage }),
      isPr ? api.paginate<GhComment>(`${base}/pulls/${n}/comments`) : Promise.resolve([] as GhComment[]),
      isPr ? api.paginate<GhComment>(`${base}/pulls/${n}/reviews`) : Promise.resolve([] as GhComment[]),
    ]);
    const merged: Item[] = [
      ...lists[0].map(c => comment(c, 0)),
      ...lists[1].map(c => inline(c, 0)),
      ...lists[2].map(c => review(c, 0)).filter((x): x is Item => !!x),
    ];
    merged.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    items.push(...merged);
  }

  const labels = labelsOf(issue);
  const assignees = ((issue.assignees ?? []) as User[]).map(u => u.login).filter(Boolean);
  const meta: Meta[] = [[L('m_state'), stateOf(issue, pr)], [L('m_author'), issue.user?.login ?? 'ghost'], [L('m_date'), issue.created_at]];
  if (labels.length) meta.push([L('m_labels'), labels.join(', ')]);
  if (pr) meta.push([L('m_branches'), `${pr.head?.ref} → ${pr.base?.ref}`], [L('m_changes'), `+${pr.additions} −${pr.deletions}, ${pr.changed_files} ${L('m_files').toLowerCase()}`, true]);
  if (assignees.length) meta.push([L('m_assignees'), assignees.join(', '), true]);
  if (issue.milestone?.title) meta.push([L('m_milestone'), issue.milestone.title, true]);
  if (issue.closed_at) meta.push([L('m_closed'), issue.closed_at, true]);

  return {
    id: String(n),
    site: 'github.com',
    kind: 'post',
    title: issue.title,
    url: issue.html_url ?? `https://github.com/${g.owner}/${g.repo}/${isPr ? 'pull' : 'issues'}/${n}`,
    meta,
    body: body(issue.body),
    items,
    totalItems: null, // комментарии у PR складываются из трёх источников: «собрано N из M» тут не сойдётся
    warnings: [],
  };
}

/** Все issues (или pull requests) репозитория с комментариями: пара десятков запросов на сотни обсуждений. */
export async function extractIssueList(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn, kind: 'issues' | 'pulls'): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const api = new GitHubApi(ctx.bgFetch ?? ctx.fetch, ctx.cache, { cachedOnly: o.partial });
  const base = `/repos/${g.owner}/${g.repo}`;
  const { state, maxItems } = o.github;
  const warnings: string[] = [];
  const pages = { done: 0, total: 0 };
  // Страниц заранее не знаем: оценка «список + столько же страниц комментариев», уточняется по заголовку Link.
  const onPage = () => progress({ done: ++pages.done, total: Math.max(pages.total, pages.done + 1) });

  try {
    // Эндпоинт issues отдаёт и PR: для режима «issues» их отбрасываем, поэтому читаем, пока не наберём maxItems.
    const listPath = kind === 'pulls' ? `${base}/pulls?state=${state}&sort=created&direction=desc&per_page=100` : `${base}/issues?state=${state}&sort=created&direction=desc&per_page=100`;
    const fetched = await api.paginate<any>(listPath, {
      max: kind === 'issues' ? maxItems * 3 : maxItems,
      onPage: (p, last) => {
        pages.total = Math.max(pages.total, (last ?? p) * 2);
        onPage();
      },
    });
    let list = kind === 'issues' ? fetched.filter(i => !i.pull_request) : fetched;
    if (!list.length && o.partial) throw new Error(L('e_nothing'));
    if (list.length > maxItems) {
      list = list.slice(0, maxItems);
      warnings.push(L('w_limited', { n: maxItems }));
    }
    list.reverse(); // читать удобнее по возрастанию номера
    const byNumber = new Map<number, Item[]>();
    const total = list.length;

    if (o.comments && list.length) {
      const since = list.reduce((m, i) => (i.created_at < m ? i.created_at : m), list[0].created_at);
      const wanted = new Set<number>(list.map(i => i.number));
      const push = (num: number, it: Item) => (byNumber.get(num) ?? byNumber.set(num, []).get(num)!).push(it);
      for (const c of await api.paginate<GhComment>(`${base}/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=100`, { onPage })) {
        const num = numberOf(c.issue_url);
        if (wanted.has(num)) push(num, comment(c, 1));
      }
      if (kind === 'pulls') {
        for (const c of await api.paginate<GhComment>(`${base}/pulls/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=100`, { onPage })) {
          const num = numberOf(c.pull_request_url);
          if (wanted.has(num)) push(num, inline(c, 1));
        }
        for (const arr of byNumber.values()) arr.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      }
    }

    if (api.truncated) warnings.push(L('w_page_cap', { n: 100 * 100 }));
    if (o.partial) warnings.push(L('w_partial_gh'));
    const items: Item[] = [];
    for (const i of list) {
      const tags = [i.merged_at ? 'merged' : i.draft ? 'draft' : i.state !== 'open' ? i.state : '', ...labelsOf(i)].filter(Boolean).join(', ');
      items.push({
        id: String(i.number),
        author: i.user?.login ?? 'ghost',
        date: i.created_at,
        score: reactions(i.reactions),
        level: 0,
        replyTo: null,
        text: `${i.title}${tags ? ` [${tags}]` : ''}${body(i.body) ? `\n${body(i.body)}` : ''}`,
      });
      items.push(...(byNumber.get(i.number) ?? []));
    }
    progress({ done: pages.total, total: pages.total });

    const label = L(kind === 'pulls' ? 'h_pulls' : 'h_issues');
    return {
      id: `${g.owner}-${g.repo}-${kind}`,
      site: 'github.com',
      kind: 'list',
      title: `${g.owner}/${g.repo}: ${label}`,
      url: `https://github.com/${g.owner}/${g.repo}/${kind}`,
      meta: [[L('m_state'), L(`state_${state}` as 'state_all')], [L('m_count'), String(total)]],
      body: '',
      items,
      itemsTitle: label,
      totalItems: null,
      warnings,
    };
  } catch (e) {
    if (e instanceof RateLimitError) throw limitPause(e, L, o.lang, pages.done, pages.total);
    throw e;
  }
}
