import type { Ctx, ImageMode, Item, Meta, ParsedDoc, SiteAdapter } from '../core/types';
import { getJSON, runPool } from '../core/http';
import { domToText } from '../core/html';
import { t, tFor } from '../core/i18n';

const topicId = (path: string) => (path.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/) ?? path.match(/\/t\/[^/]+\/(\d+)/))?.[1] ?? null;

/** Любой форум на движке Discourse (ntc.party, meta.discourse.org, …). */
export const isDiscourse = (doc: Document) =>
  !!doc.querySelector('meta[name="generator"][content^="Discourse"], #data-discourse-setup, meta[name="discourse_theme_id"], meta[name="discourse_current_homepage"]') ||
  doc.body.classList.contains('discourse-no-touch') ||
  doc.body.classList.contains('discourse-touch');

export function cookedToText(html: string, o: { quotes: boolean; links: boolean; images: ImageMode; format: string }, doc: Document = document): string {
  const d = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  d.querySelectorAll('aside.quote').forEach(q => {
    // Без цитат остаётся только имя цитируемого: смысл «кому отвечают» сохраняется, текст не дублируется.
    const who = (q.querySelector('.title')?.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
    const bq = doc.createElement('blockquote');
    bq.textContent = o.quotes ? (who ? who + ':\n' : '') + (q.querySelector('blockquote')?.textContent ?? '').trim() : who;
    q.replaceWith(bq);
  });
  d.querySelectorAll('div.meta, .onebox-metadata, .badge-wrapper').forEach(e => e.remove());
  d.querySelectorAll('a.lightbox').forEach(a => {
    const img = a.querySelector('img');
    if (!img) return;
    // в режиме «адрес» берём ссылку на полноразмерный файл, иначе оставляем <img> — подпись/пропуск решает html.ts
    if (o.images === 'url') a.replaceWith(Object.assign(doc.createElement('span'), { textContent: `[img: ${a.getAttribute('href') || img.getAttribute('src')}]` }));
    else a.replaceWith(img);
  });
  return domToText(d.body, { mode: o.format === 'md' ? 'md' : 'text', links: o.links, images: o.images });
}

export const discourse: SiteAdapter = {
  id: 'discourse',
  name: 'Discourse',
  kind: 'topic',
  paged: true,
  hasComments: false,
  detect: ({ url, doc }: Ctx) => isDiscourse(doc) && !!topicId(url.pathname),

  async extract({ url, doc, fetch: f }, o, progress): Promise<ParsedDoc> {
    const L = tFor(o.lang);
    const id = topicId(url.pathname)!;
    const base = `${url.origin}/t/${id}`;
    progress({ done: 0, total: 1 });
    const topic = await getJSON(f, `${base}.json`);
    const stream: number[] = topic.post_stream?.stream ?? [];
    const take = o.percent >= 100 ? stream.length : Math.max(1, Math.ceil((stream.length * o.percent) / 100));
    const wanted = stream.slice(stream.length - take);

    const byId = new Map<number, any>();
    for (const p of topic.post_stream?.posts ?? []) byId.set(p.id, p);
    const missing = wanted.filter(i => !byId.has(i));
    const chunks: number[][] = [];
    for (let i = 0; i < missing.length; i += 20) chunks.push(missing.slice(i, i + 20));

    const warnings: string[] = [];
    let done = 0;
    await runPool(
      chunks,
      Math.min(o.concurrency, 4),
      async ch => {
        try {
          const j = await getJSON(f, `${base}/posts.json?${ch.map(i => `post_ids[]=${i}`).join('&')}&include_suggested=false`);
          for (const p of j.post_stream?.posts ?? []) byId.set(p.id, p);
        } catch {
          /* недостающие посты учтём ниже одним предупреждением */
        }
        progress({ done: ++done, total: chunks.length });
      },
      o.delayMs,
    );

    const items: Item[] = [];
    for (const pid of wanted) {
      const p = byId.get(pid);
      if (!p) continue;
      const likes = (p.actions_summary ?? []).find((a: any) => a.id === 2)?.count ?? 0;
      items.push({
        id: String(p.post_number),
        author: p.name && p.name !== p.username ? `${p.username} (${p.name})` : p.username,
        date: p.created_at ?? '',
        score: likes || null,
        level: 0,
        replyTo: p.reply_to_post_number ? String(p.reply_to_post_number) : null,
        text: p.hidden ? L('w_hidden_post') : cookedToText(p.cooked, o, doc),
      });
    }
    if (items.length < wanted.length) warnings.push(L('w_posts_failed', { n: wanted.length - items.length }));

    const tags = (topic.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)).join(', ');
    const meta: Meta[] = [
      [L('m_created'), topic.created_at ?? '', true],
      [L('m_views'), String(topic.views ?? '—'), true],
      [L('m_likes'), String(topic.like_count ?? '—'), true],
      [L('m_posts'), String(stream.length), true],
    ];
    if (o.percent < 100) meta.push([L('m_range'), L('range_last', { n: o.percent })]);
    if (tags) meta.push([L('m_tags'), tags]);
    return {
      id,
      site: url.hostname,
      kind: 'topic',
      title: topic.title ?? topic.fancy_title ?? doc.title,
      url: `${url.origin}/t/${topic.slug ?? ''}/${id}`,
      meta,
      body: '',
      items,
      totalItems: stream.length,
      warnings,
    };
  },
};
