import type { Item, ParsedDoc, SiteAdapter } from '../core/types';
import { getJSON } from '../core/http';
import { htmlToText } from '../core/html';
import { t } from '../core/i18n';

interface HabrComment {
  id: number | string;
  parentId?: number | string | null;
  author?: { alias?: string } | null;
  timePublished?: string;
  score?: number | null;
  message?: string;
  isSuspended?: boolean;
}

const ID_RE = /\/(?:articles|news|post|blog|companies\/[^/]+\/articles)\/(\d+)/;

export const habr: SiteAdapter = {
  id: 'habr',
  name: 'Хабр',
  kind: 'article',
  paged: false,
  hasComments: true,
  detect: ({ url }) => /(^|\.)habr\.com$/.test(url.hostname) && (ID_RE.test(url.pathname) || /\/\d+\/?$/.test(url.pathname)),

  async extract({ url, fetch: f }, o, progress): Promise<ParsedDoc> {
    const id = (url.pathname.match(ID_RE) ?? url.pathname.match(/\/(\d+)\/?$/))?.[1];
    if (!id) throw new Error(t(o.lang, 'e_no_id'));
    const L = (k: Parameters<typeof t>[1]) => t(o.lang, k);
    const lang = url.pathname.split('/')[1] === 'en' ? 'en' : 'ru';
    const base = `${url.origin}/kek/v2/articles/${id}/`;
    const q = `?fl=${lang}&hl=${lang}`;
    const mode = o.format === 'md' ? 'md' : 'text';
    const text = (html: string) => htmlToText(html, { mode, links: o.links, images: o.images });

    progress({ done: 0, total: 2, text: 'article' });
    const art = await getJSON(f, base + q);
    const title = text(art.titleHtml ?? art.title ?? '');
    const s = art.statistics ?? {};
    const meta: [string, string][] = [
      [L('m_author'), art.author?.alias ?? art.author?.login ?? '—'],
      [L('m_date'), art.timePublished ?? ''],
    ];
    if (art.statistics) {
      meta.push([L('m_score'), String(s.score ?? '—')], [L('m_views'), String(s.readingCount ?? '—')], [L('m_bookmarks'), String(s.favoritesCount ?? '—')]);
    }
    const hubs = (art.hubs ?? []).map((h: any) => h.title);
    const tags = (art.tags ?? []).map((x: any) => x.titleHtml ?? x.title);
    if (hubs.length) meta.push([L('m_hubs'), hubs.join(', ')]);
    if (tags.length) meta.push([L('m_tags'), tags.join(', ')]);

    const items: Item[] = [];
    const warnings: string[] = [];
    let total: number | null = null;

    if (o.comments) {
      progress({ done: 1, total: 2, text: 'comments' });
      try {
        const c = await getJSON<{ comments?: Record<string, HabrComment>; threads?: (number | string)[] }>(f, base + 'comments/' + q);
        const map = c.comments ?? {};
        const list = Object.values(map);
        total = list.length;
        const kids = new Map<string, HabrComment[]>();
        for (const x of list) {
          const k = String(x.parentId || 0);
          (kids.get(k) ?? kids.set(k, []).get(k)!).push(x);
        }
        for (const arr of kids.values())
          arr.sort((a, b) => Date.parse(a.timePublished ?? '') - Date.parse(b.timePublished ?? '') || Number(a.id) - Number(b.id));
        const roots = c.threads?.length ? c.threads.map(i => map[String(i)]).filter((x): x is HabrComment => !!x) : kids.get('0') ?? [];
        const seen = new Set<string>();
        const emit = (x: HabrComment, level: number) => {
          if (seen.has(String(x.id))) return;
          seen.add(String(x.id));
          items.push({
            id: String(x.id),
            author: x.author?.alias ?? L('w_deleted'),
            date: x.timePublished ?? '',
            score: x.score ?? null,
            level,
            replyTo: x.parentId ? String(x.parentId) : null,
            text: x.isSuspended ? L('w_hidden_comment') : text(x.message ?? ''),
          });
          for (const ch of kids.get(String(x.id)) ?? []) emit(ch, level + 1);
        };
        roots.forEach(r => emit(r, 0));
        list.filter(x => x.parentId && !map[String(x.parentId)]).forEach(x => emit(x, 1)); // «осиротевшие»
      } catch (e) {
        warnings.push(t(o.lang, 'w_comments_failed', { msg: (e as Error).message }));
      }
    }
    progress({ done: 2, total: 2 });
    return { id, site: 'habr.com', kind: 'article', title, url: url.href, meta, body: text(art.textHtml ?? ''), items, totalItems: total, warnings };
  },
};
