import type { ImageMode, Item, Meta, ParsedDoc, SiteAdapter } from '../core/types';
import { getText, runPool } from '../core/http';
import { domToText } from '../core/html';
import { t, tFor } from '../core/i18n';

const LINK_TITLE = 'Ссылка на это сообщение';

function detectPagination(doc: Document): { perPage: number; totalPages: number } {
  let perPage = 20;
  let totalPages = 1;
  const m = doc.body.innerHTML.match(/ipb_pages_array\[.*?\]\s*=\s*\[.*?,(\d+),(\d+)\]/);
  if (m) {
    perPage = parseInt(m[1]!, 10) || 20;
    const maxSt = parseInt(m[2]!, 10) || 0;
    if (maxSt > 0) totalPages = Math.floor(maxSt / perPage) + 1;
  }
  for (const span of doc.querySelectorAll('.pagelink-menu')) {
    const t = span.textContent?.trim().match(/^(\d+)\s*страниц/i);
    if (t) {
      totalPages = parseInt(t[1]!, 10);
      break;
    }
  }
  if (totalPages <= 1) {
    const last = doc.querySelector<HTMLAnchorElement>('.pagelinklast a[href*="&st="]');
    const s = last?.href.match(/&st=(\d+)/);
    if (s) totalPages = Math.floor(parseInt(s[1]!, 10) / perPage) + 1;
  }
  return { perPage, totalPages: Math.max(1, totalPages) };
}

/** Разбор одной страницы темы. Цитаты / код / спойлеры — в зависимости от настроек. */
export function parsePosts(doc: Document, o: { quotes: boolean; code: boolean; links: boolean; images: ImageMode; format: string }, seen: Set<string>): Item[] {
  const out: Item[] = [];
  const mode = o.format === 'md' ? 'md' : 'text';
  doc.querySelectorAll('table.ipbtable[data-post]').forEach(tab => {
    const id = tab.getAttribute('data-post') ?? '';
    if (id && seen.has(id)) return; // страницы «съезжают», когда в теме появляются новые сообщения
    const body = tab.querySelector('.postcolor');
    if (!body) return;

    // номер — только цифры: в тексте ссылки он бывает как «#12», так и «Сообщение #12»
    const num = (tab.querySelector(`a[title="${LINK_TITLE}"]`)?.textContent ?? '').replace(/\D/g, '') || id || '?';
    const author = tab.querySelector('.normalname a')?.textContent?.trim() || tab.querySelector('.normalname')?.textContent?.trim() || 'Гость';
    const dateCell = (tab.querySelector('td.row2[id^="ph-"][id$="-d2"]')?.textContent ?? '').replace(/\s+/g, ' ');
    const date = dateCell.match(/(?:Сегодня|Вчера|\d{2}\.\d{2}\.\d{2,4}),?\s*\d{1,2}:\d{2}/)?.[0] ?? '';

    const temp = body.cloneNode(true) as Element;
    temp.querySelectorAll('script, style, .attach, .signature, .edit, .post-edit-reason, video, iframe').forEach(e => e.remove());
    temp.querySelectorAll('.post-block.quote, .quote').forEach(q => {
      // Без цитат остаётся только имя цитируемого: «Цитата(Петя @ 05.10.26, 14:05)» → «Петя».
      const title = (q.querySelector('.block-title')?.textContent ?? '').trim();
      const who = title.match(/\(([^@)]+?)\s*@/)?.[1] ?? title.replace(/^Цитата:?\s*/i, '');
      const bq = doc.createElement('blockquote');
      bq.textContent = o.quotes ? (title ? title + ':\n' : '') + (q.querySelector('.block-body')?.textContent ?? q.textContent ?? '').trim() : who;
      q.replaceWith(bq);
    });
    temp.querySelectorAll('.post-block.code').forEach(c => {
      if (!o.code) return c.remove();
      const pre = doc.createElement('pre');
      pre.textContent = c.querySelector('.block-body')?.textContent ?? c.textContent ?? '';
      c.replaceWith(pre);
    });
    temp.querySelectorAll('.post-block.spoil').forEach(s => {
      const title = s.querySelector('.block-title')?.textContent?.trim() || 'spoiler';
      const p = doc.createElement('div');
      p.textContent = `▸ ${title}:\n${s.querySelector('.block-body')?.textContent?.trim() ?? ''}`;
      s.replaceWith(p);
    });

    const text = domToText(temp, { mode, links: o.links, images: o.images });
    if (!text) return;
    if (id) seen.add(id);
    out.push({ id: String(num).replace(/^#/, ''), author, date, score: null, level: 0, replyTo: null, text });
  });
  return out;
}

export const fourpda: SiteAdapter = {
  id: '4pda',
  name: '4PDA',
  kind: 'topic',
  paged: true,
  hasComments: false,
  detect: ({ url }) => /(^|\.)4pda\.(to|ru)$/.test(url.hostname) && url.searchParams.has('showtopic'),

  async extract({ url, doc, fetch: f }, o, progress): Promise<ParsedDoc> {
    const L = tFor(o.lang);
    const topicId = url.searchParams.get('showtopic')!;
    const base = `${url.origin}/forum/index.php?showtopic=${topicId}`;
    const title = (doc.querySelector('h1[itemprop="name"]')?.textContent || doc.title || '').trim();
    const { perPage, totalPages } = detectPagination(doc);

    const count = o.percent >= 100 ? totalPages : Math.max(1, Math.ceil((totalPages * o.percent) / 100));
    const start = totalPages - count;
    const pages = Array.from({ length: count }, (_, i) => start + i);

    const seen = new Set<string>();
    const errors: string[] = [];
    let completed = 0;
    let fetched = 0;

    const results = await runPool(
      pages,
      o.concurrency,
      async page => {
        let posts: Item[] = [];
        try {
          const html = await getText(f, `${base}&st=${page * perPage}`, 'windows-1251');
          posts = parsePosts(new DOMParser().parseFromString(html, 'text/html'), o, seen);
          fetched += posts.length;
        } catch (e) {
          errors.push(`стр. ${page + 1}: ${(e as Error).message}`);
        }
        progress({ done: ++completed, total: count });
        return posts;
      },
      o.delayMs,
    );

    const items = results.flat();
    if (!items.length) throw new Error(L('e_nothing'));
    return {
      id: topicId,
      site: '4pda.to',
      kind: 'topic',
      title,
      url: base,
      meta: [
        ...(o.percent >= 100 ? [] : ([[L('m_range'), L('range_pages', { n: o.percent, from: start + 1, to: totalPages })]] as Meta[])),
      ],
      body: '',
      items,
      totalItems: null,
      warnings: errors.length ? [`${L('w_pages_failed', { n: errors.length })} (${errors.slice(0, 5).join('; ')})`] : [],
    };
  },
};
