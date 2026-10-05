import type { Ctx, ExtractOptions, Item, ParsedDoc, ProgressFn, SiteAdapter } from '../core/types';
import { getJSON, sleep } from '../core/http';
import { domToText } from '../core/html';
import { t } from '../core/i18n';

const siteLabel = (u: URL) => u.hostname.replace(/^(www|old|new)\./, '');
const iso = (utc: number) => new Date(utc * 1000).toISOString();

async function viaJSON({ url, fetch: f }: Ctx, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const id = url.pathname.match(/\/comments\/([a-z0-9]+)/i)![1]!;
  progress({ done: 0, total: 1, text: 'post' });
  const data = await getJSON(f, `${url.origin}/comments/${id}.json?limit=500&depth=100&raw_json=1&sort=top`).catch(() =>
    getJSON(f, `${url.origin}${url.pathname.replace(/\/$/, '')}.json?limit=500&raw_json=1`),
  );
  const p = data[0].data.children[0].data;
  const L = (k: Parameters<typeof t>[1]) => t(o.lang, k);
  const meta: [string, string][] = [
    [L('m_subreddit'), `r/${p.subreddit}`],
    [L('m_author'), `u/${p.author}`],
    [L('m_date'), iso(p.created_utc)],
    [L('m_score'), String(p.score)],
    [L('m_comments'), String(p.num_comments)],
  ];
  if (p.url && !p.is_self) meta.push([L('m_link'), p.url]);

  const items: Item[] = [];
  const warnings: string[] = [];
  if (o.comments) {
    const nodes = new Map<string, any>();
    const order: string[] = [];
    const more: any[] = [];
    const collect = (children: any[] = []) => {
      for (const ch of children) {
        if (ch.kind === 't1') {
          nodes.set(ch.data.name, ch.data);
          order.push(ch.data.name);
          if (ch.data.replies?.data) collect(ch.data.replies.data.children);
        } else if (ch.kind === 'more') more.push(ch.data);
      }
    };
    collect(data[1].data.children);

    for (let round = 0; more.length && round < 30; round++) {
      const ids = [...new Set(more.splice(0).flatMap(x => x.children ?? []))].filter((i: string) => !nodes.has('t1_' + i));
      if (!ids.length) break;
      progress({ done: round, total: round + 2, text: `+${ids.length}` });
      for (let i = 0; i < ids.length; i += 100) {
        try {
          const j = await getJSON(f, `${url.origin}/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${id}&children=${ids.slice(i, i + 100).join(',')}`);
          collect((j.json?.data?.things ?? []).map((t: any) => ({ kind: t.kind, data: t.data })));
        } catch (e) {
          warnings.push(`morechildren: ${(e as Error).message}`);
        }
        await sleep(o.delayMs + 250);
      }
    }
    const kids = new Map<string, any[]>();
    for (const name of order) {
      const c = nodes.get(name);
      (kids.get(c.parent_id) ?? kids.set(c.parent_id, []).get(c.parent_id)!).push(c);
    }
    const emit = (c: any, level: number) => {
      const flair = c.author_flair_text ? ` [${c.author_flair_text}]` : '';
      items.push({
        id: c.id,
        author: `u/${c.author}${flair}`,
        date: iso(c.created_utc),
        score: c.score ?? null,
        level,
        replyTo: c.parent_id?.startsWith('t1_') ? c.parent_id.slice(3) : null,
        text: String(c.body ?? '').trim(),
      });
      for (const ch of kids.get('t1_' + c.id) ?? []) emit(ch, level + 1);
    };
    (kids.get('t3_' + id) ?? []).forEach(c => emit(c, 0));
    for (const [k, v] of kids) if (k.startsWith('t1_') && !nodes.has(k)) v.forEach(c => emit(c, 1));
  }
  return { id, site: siteLabel(url), kind: 'post', title: p.title, url: url.href, meta, body: p.selftext || '', items, totalItems: p.num_comments ?? null, warnings };
}

/** Reddit может отдавать 403 на .json — тогда читаем уже отрисованную страницу (shreddit). */
async function viaDOM({ url, doc }: Ctx, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  const post = doc.querySelector('shreddit-post');
  if (!post) throw new Error(t(o.lang, 'e_no_post'));
  const L = (k: Parameters<typeof t>[1]) => t(o.lang, k);
  const attr = (el: Element, n: string) => el.getAttribute(n) ?? '';
  const mode = o.format === 'md' ? 'md' : 'text';

  if (o.comments) {
    const MORE = /more repl|more comment|view more|ещ[её] \d*\s*(ответ|коммент)|больше (коммент|ответ)|посмотреть (ещ|больш)|показать ещ/i;
    for (let round = 0; round < 40; round++) {
      const btns = Array.from(doc.querySelectorAll<HTMLButtonElement>('shreddit-comment-tree button, shreddit-comment button, faceplate-partial button')).filter(
        b => MORE.test(b.textContent ?? '') && !b.dataset.fasClicked,
      );
      if (!btns.length) break;
      progress({ done: round, total: round + 2, text: `+${btns.length}` });
      btns.forEach(b => {
        b.dataset.fasClicked = '1';
        b.click();
      });
      await sleep(1500);
    }
  }
  const body = post.querySelector('[slot="text-body"]');
  const items: Item[] = [];
  if (o.comments) {
    doc.querySelectorAll('shreddit-comment').forEach(c => {
      const txt = c.querySelector(':scope > [slot="comment"]');
      if (!txt) return;
      items.push({
        id: attr(c, 'thingid').replace(/^t1_/, '') || String(items.length + 1),
        author: `u/${attr(c, 'author') || 'deleted'}`,
        date: c.querySelector('time')?.getAttribute('datetime') ?? '',
        score: Number.isFinite(Number(attr(c, 'score'))) && attr(c, 'score') !== '' ? Number(attr(c, 'score')) : null,
        level: parseInt(attr(c, 'depth'), 10) || 0,
        replyTo: null,
        text: domToText(txt, { mode, links: o.links, images: o.images }),
      });
    });
  }
  return {
    id: url.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? '',
    site: siteLabel(url),
    kind: 'post',
    title: attr(post, 'post-title') || doc.title,
    url: url.href,
    meta: [
      [L('m_subreddit'), attr(post, 'subreddit-prefixed-name')],
      [L('m_author'), `u/${attr(post, 'author')}`],
      [L('m_date'), attr(post, 'created-timestamp')],
      [L('m_score'), attr(post, 'score')],
      [L('m_comments'), attr(post, 'comment-count')],
    ],
    body: body ? domToText(body, { mode, links: o.links, images: o.images }) : '',
    items,
    totalItems: Number(attr(post, 'comment-count')) || null,
    warnings: [L('w_json_blocked')],
  };
}

export const reddit: SiteAdapter = {
  id: 'reddit',
  name: 'Reddit',
  kind: 'post',
  paged: false,
  hasComments: true,
  detect: ({ url }) => /(^|\.)reddit\.com$/.test(url.hostname) && /\/comments\/[a-z0-9]+/i.test(url.pathname),
  async extract(ctx, o, progress) {
    try {
      return await viaJSON(ctx, o, progress);
    } catch {
      return await viaDOM(ctx, o, progress);
    }
  },
};
