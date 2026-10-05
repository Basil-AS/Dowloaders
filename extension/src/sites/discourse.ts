import type { Ctx, Item, ParsedDoc, SiteAdapter } from '../core/types';
import { getJSON, runPool } from '../core/http';
import { domToText } from '../core/html';

const topicId = (path: string) => (path.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/) ?? path.match(/\/t\/[^/]+\/(\d+)/))?.[1] ?? null;

/** Любой форум на движке Discourse (ntc.party, meta.discourse.org, …). */
export const isDiscourse = (doc: Document) =>
  !!doc.querySelector('meta[name="generator"][content^="Discourse"], #data-discourse-setup, meta[name="discourse_theme_id"], meta[name="discourse_current_homepage"]') ||
  doc.body.classList.contains('discourse-no-touch') ||
  doc.body.classList.contains('discourse-touch');

export function cookedToText(html: string, o: { quotes: boolean; links: boolean; images: boolean; format: string }, doc: Document = document): string {
  const d = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  d.querySelectorAll('aside.quote').forEach(q => {
    if (!o.quotes) return q.remove();
    const who = (q.querySelector('.title')?.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
    const bq = doc.createElement('blockquote');
    bq.textContent = (who ? who + ':\n' : '') + (q.querySelector('blockquote')?.textContent ?? '').trim();
    q.replaceWith(bq);
  });
  d.querySelectorAll('div.meta, .onebox-metadata, .badge-wrapper').forEach(e => e.remove());
  d.querySelectorAll('a.lightbox').forEach(a => {
    const img = a.querySelector('img');
    if (!img) return;
    a.replaceWith(o.images ? Object.assign(doc.createElement('span'), { textContent: `[img: ${a.getAttribute('href') || img.getAttribute('src')}]` }) : '');
  });
  return domToText(d.body, { mode: o.format === 'md' ? 'md' : 'text', links: o.links, images: o.images });
}

export const discourse: SiteAdapter = {
  id: 'discourse',
  name: 'Discourse',
  paged: true,
  hasComments: false,
  detect: ({ url, doc }: Ctx) => isDiscourse(doc) && !!topicId(url.pathname),

  async extract({ url, doc, fetch: f }, o, progress): Promise<ParsedDoc> {
    const id = topicId(url.pathname)!;
    const base = `${url.origin}/t/${id}`;
    progress({ done: 0, total: 1, text: 'topic' });
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
        } catch (e) {
          warnings.push(`блок постов не загружен: ${(e as Error).message}`);
        }
        progress({ done: ++done, total: chunks.length, text: `${done}/${chunks.length}` });
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
        text: p.hidden ? '[пост скрыт]' : cookedToText(p.cooked, o, doc),
      });
    }
    if (items.length < wanted.length) warnings.push(`Не удалось загрузить постов: ${wanted.length - items.length}`);

    const tags = (topic.tags ?? []).map((t: any) => (typeof t === 'string' ? t : t.name)).join(', ');
    const meta: [string, string][] = [
      ['ID', id],
      ['Создана', topic.created_at ?? ''],
      ['Просмотров', String(topic.views ?? '—')],
      ['Лайков', String(topic.like_count ?? '—')],
      ['Всего постов', String(stream.length)],
    ];
    if (o.percent < 100) meta.push(['Скачано', `последние ${o.percent}% (${items.length})`]);
    if (tags) meta.push(['Теги', tags]);
    return {
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
