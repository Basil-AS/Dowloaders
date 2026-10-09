import { RateLimitError, sleep } from '../../core/http';
import { domToText } from '../../core/html';
import { tFor } from '../../core/i18n';
import type { Ctx, ExtractOptions, Item, Meta, ParsedDoc, ProgressFn } from '../../core/types';
import { AuthRequiredError, GitHubApi, limitPause, NotCachedError, NotFoundError } from './api';
import type { GhRef } from './url';

const DISC = 'number title body createdAt upvoteCount closed url author{login} category{name} answer{id} labels(first:15){nodes{name}}';
const COMMENT = 'id body createdAt upvoteCount isAnswer author{login} replies(first:50){totalCount nodes{body createdAt upvoteCount author{login}}}';

const ONE = `query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){discussion(number:$n){${DISC} comments(first:50,after:$after){totalCount pageInfo{hasNextPage endCursor} nodes{${COMMENT}}}}}}`;
const MANY = `query($o:String!,$r:String!,$after:String){repository(owner:$o,name:$r){discussions(first:15,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){totalCount pageInfo{hasNextPage endCursor} nodes{${DISC} comments(first:30){totalCount pageInfo{hasNextPage endCursor} nodes{${COMMENT}}}}}}}`;

interface GqlComment {
  body?: string;
  createdAt: string;
  upvoteCount?: number;
  isAnswer?: boolean;
  author?: { login?: string } | null;
  replies?: { totalCount: number; nodes: GqlComment[] };
}

const text = (s?: string | null) => (s ?? '').replace(/\r\n/g, '\n').trim();

function commentItems(nodes: GqlComment[], level: number, warnings: string[], L: ReturnType<typeof tFor>): Item[] {
  const out: Item[] = [];
  for (const c of nodes) {
    out.push({ id: '', author: c.author?.login ?? 'ghost', date: c.createdAt, score: c.upvoteCount || null, level, replyTo: null, text: `${c.isAnswer ? '[answer] ' : ''}${text(c.body)}` });
    const r = c.replies;
    if (r?.nodes.length) out.push(...commentItems(r.nodes, level + 1, warnings, L));
    if (r && r.totalCount > r.nodes.length) warnings.push(L('w_replies_cut', { n: r.totalCount - r.nodes.length }));
  }
  return out;
}

async function allComments(api: GitHubApi, g: GhRef, num: number, first: { nodes: GqlComment[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }, onMore?: () => void): Promise<GqlComment[]> {
  const nodes = [...first.nodes];
  let { hasNextPage, endCursor } = first.pageInfo;
  while (hasNextPage && endCursor) {
    const d = await api.graphql<any>(ONE, { o: g.owner, r: g.repo, n: num, after: endCursor });
    const c = d.repository.discussion.comments;
    nodes.push(...c.nodes);
    ({ hasNextPage, endCursor } = c.pageInfo);
    onMore?.();
  }
  return nodes;
}

const discMeta = (d: any, L: ReturnType<typeof tFor>): Meta[] => {
  const labels = (d.labels?.nodes ?? []).map((l: any) => l.name);
  const m: Meta[] = [[L('m_author'), d.author?.login ?? 'ghost'], [L('m_date'), d.createdAt]];
  if (d.category?.name) m.push([L('m_category'), d.category.name]);
  m.push([L('m_state'), `${d.closed ? 'closed' : 'open'}${d.answer ? ', answered' : ''}`]);
  if (labels.length) m.push([L('m_labels'), labels.join(', ')]);
  return m;
};

/** Одно обсуждение. С токеном — через GraphQL (полно и быстро); без токена — разбор уже открытой страницы. */
export async function extractDiscussion(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const api = new GitHubApi(ctx.bgFetch ?? ctx.fetch, ctx.cache);
  const n = g.number!;
  progress({ done: 0, total: 1 });
  try {
    const d = (await api.graphql<any>(ONE, { o: g.owner, r: g.repo, n, after: null })).repository?.discussion;
    if (!d) throw new NotFoundError(`${g.owner}/${g.repo}#${n}`);
    const warnings: string[] = [];
    const items = o.comments ? commentItems(await allComments(api, g, n, d.comments, () => progress({ done: 1, total: 2 })), 0, warnings, L) : [];
    return { id: String(n), site: 'github.com', kind: 'post', title: d.title, url: d.url, meta: discMeta(d, L), body: text(d.body), items, totalItems: null, warnings };
  } catch (e) {
    if (e instanceof AuthRequiredError) return scrapeDiscussion(ctx, g, o, progress);
    throw e;
  }
}

/** Все обсуждения репозитория с комментариями и ответами. GraphQL GitHub доступен только с токеном. */
export async function extractDiscussionList(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const api = new GitHubApi(ctx.bgFetch ?? ctx.fetch, ctx.cache, { cachedOnly: o.partial });
  const { maxItems, state } = o.github;
  const warnings: string[] = [];
  const items: Item[] = [];
  let after: string | null = null;
  let taken = 0;
  let total = 0;
  try {
    while (taken < maxItems) {
      const page: any = (await api.graphql<any>(MANY, { o: g.owner, r: g.repo, after })).repository?.discussions;
      if (!page) throw new Error(L('e_gh_nodisc'));
      total = page.totalCount;
      for (const d of page.nodes as any[]) {
        if (taken >= maxItems) break;
        if ((state === 'open' && d.closed) || (state === 'closed' && !d.closed)) continue;
        taken++;
        const tags = [d.category?.name, d.closed ? 'closed' : '', d.answer ? 'answered' : '', ...(d.labels?.nodes ?? []).map((l: any) => l.name)].filter(Boolean).join(', ');
        items.push({ id: String(d.number), author: d.author?.login ?? 'ghost', date: d.createdAt, score: d.upvoteCount || null, level: 0, replyTo: null, text: `${d.title}${tags ? ` [${tags}]` : ''}${text(d.body) ? `\n${text(d.body)}` : ''}` });
        if (o.comments) {
          const nodes = await allComments(api, g, d.number, d.comments);
          items.push(...commentItems(nodes, 1, warnings, L));
        }
        progress({ done: taken, total: Math.min(total, maxItems) });
      }
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
  } catch (e) {
    if (e instanceof AuthRequiredError) throw new Error(L('e_token_needed'));
    if (e instanceof NotFoundError) throw new Error(L('e_gh_nodisc'));
    if (e instanceof NotCachedError) warnings.push(L('w_partial_gh')); // «сохранить, что есть»: берём скачанное
    else if (e instanceof RateLimitError) throw limitPause(e, L, o.lang, taken, Math.min(total, maxItems));
    else throw e;
  }
  if (!items.length && o.partial) throw new Error(L('e_nothing'));
  if (taken >= maxItems && total > maxItems) warnings.push(L('w_limited', { n: maxItems }));
  const label = L('h_discussions');
  return {
    id: `${g.owner}-${g.repo}-discussions`,
    site: 'github.com',
    kind: 'list',
    title: `${g.owner}/${g.repo}: ${label}`,
    url: `https://github.com/${g.owner}/${g.repo}/discussions`,
    meta: [[L('m_state'), L(`state_${state}` as 'state_all')], [L('m_count'), String(taken)]],
    body: '',
    items,
    itemsTitle: label,
    totalItems: null,
    warnings,
  };
}

const MORE = /load more|show (\d+ )?(more|previous|hidden)|view more|ещё|ещe|загрузить|показать/i;

/**
 * Без токена: читаем уже отрисованную страницу обсуждения. Вёрстка GitHub меняется, поэтому опираемся не на классы, а на
 * устойчивые признаки: тело (.markdown-body), ссылка на автора и <relative-time>. Это запасной путь; с токеном надёжнее.
 */
export async function scrapeDiscussion(ctx: Ctx, g: GhRef, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const L = tFor(o.lang);
  const doc = ctx.doc;
  const warnings = [L('w_dom_discussion')];
  if (o.comments) {
    for (let round = 0; round < 25; round++) {
      const btns = [...doc.querySelectorAll<HTMLButtonElement>('button')].filter(b => MORE.test(b.textContent ?? '') && !b.dataset.fasClicked && !b.disabled);
      if (!btns.length) break;
      progress({ done: round, total: round + 2 });
      btns.forEach(b => {
        b.dataset.fasClicked = '1';
        b.click();
      });
      await sleep(1400);
    }
  }
  const textOpts = { mode: o.format === 'md' ? ('md' as const) : ('text' as const), links: o.links, images: o.images };
  const bodies = [...doc.querySelectorAll('.markdown-body, [data-testid="markdown-body"]')].filter(b => !b.parentElement?.closest('.markdown-body, [data-testid="markdown-body"]'));
  const authorSel = 'a[data-hovercard-type="user"], [data-testid="author-link"], a.author, .author';
  const container = (b: Element): Element => {
    let c: Element = b;
    while (c.parentElement && c.parentElement !== doc.body && !(c.querySelector(authorSel) && c.querySelector('relative-time, time[datetime]') && c !== b)) c = c.parentElement;
    return c;
  };
  const rows = bodies.map(b => {
    const c = container(b);
    const author = c.querySelector(authorSel)?.textContent?.trim() ?? 'ghost';
    const date = c.querySelector('relative-time, time[datetime]')?.getAttribute('datetime') ?? '';
    const nested = !!c.parentElement?.closest('[data-testid*="nested"], [class*="replies"], [class*="reply"], [data-testid*="replies"]');
    return { author, date, level: nested ? 1 : 0, text: domToText(b, textOpts) };
  });
  const title = (doc.querySelector('h1 bdi, h1[data-testid="discussion-title"], h1')?.textContent ?? doc.title).trim();
  const head = rows[0];
  if (!head) throw new Error(L('e_nothing'));
  const items: Item[] = o.comments ? rows.slice(1).map(r => ({ id: '', author: r.author, date: r.date, score: null, level: r.level, replyTo: null, text: r.text })) : [];
  return {
    id: String(g.number),
    site: 'github.com',
    kind: 'post',
    title,
    url: ctx.url.href.split('#')[0]!,
    meta: [[L('m_author'), head.author], ...(head.date ? ([[L('m_date'), head.date]] as Meta[]) : [])],
    body: head.text,
    items,
    totalItems: null,
    warnings,
  };
}
