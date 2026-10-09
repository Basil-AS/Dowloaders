import type { ImageMode, Item, Meta, ParsedDoc, SiteAdapter } from '../core/types';
import { getText, PausedError, RateLimitError, runPool } from '../core/http';
import { domToText } from '../core/html';
import { t, tFor } from '../core/i18n';

const LINK_TITLE = 'Ссылка на это сообщение';
/** Предел параллелизма и пауза между запросами: выше этого 4PDA отвечает 429. */
const SAFE_CONCURRENCY = 3;
const SAFE_DELAY_MS = 400;

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

  async extract({ url, doc, fetch: f, cache }, o, progress): Promise<ParsedDoc> {
    const L = tFor(o.lang);
    const topicId = url.searchParams.get('showtopic')!;
    const base = `${url.origin}/forum/index.php?showtopic=${topicId}`;
    const title = (doc.querySelector('h1[itemprop="name"]')?.textContent || doc.title || '').trim();
    const { perPage, totalPages } = detectPagination(doc);

    const count = o.percent >= 100 ? totalPages : Math.max(1, Math.ceil((totalPages * o.percent) / 100));
    const start = totalPages - count;
    const pages = Array.from({ length: count }, (_, i) => start + i);
    const key = (p: number) => `4pda:${topicId}:${p}`;
    // «Пропустить»: страницы, на которых сайт ограничил запросы, исключаются из этого и следующих запусков
    const skipKey = `4pda:${topicId}:skip`;
    const hitKey = `4pda:${topicId}:hit`;
    const skipped = new Set<number>(cache.get<number[]>(skipKey) ?? []);
    if (o.skip) for (const p of cache.get<number[]>(hitKey) ?? []) skipped.add(p);
    cache.set(skipKey, [...skipped]);
    const hit = new Set<number>();
    cache.set(hitKey, []);

    const missing = () => pages.filter(p => !cache.has(key(p)) && !skipped.has(p));
    const done = () => pages.filter(p => cache.has(key(p))).length;
    const total = () => count - pages.filter(p => skipped.has(p)).length;
    const errors = new Map<number, string>(); // страница → причина; успешная повторная загрузка убирает запись

    // 4PDA быстро отвечает 429 и может надолго заблокировать IP, поэтому темп заведомо мягкий.
    const workers = Math.min(o.concurrency, SAFE_CONCURRENCY);
    const delay = Math.max(o.delayMs, SAFE_DELAY_MS);

    const fetchPage = async (page: number) => {
      try {
        const html = await getText(f, `${base}&st=${page * perPage}`, 'windows-1251', { blockStatuses: [403] });
        if (!/data-post=/.test(html)) throw new Error('нет сообщений'); // защитная страница вместо темы
        cache.set(key(page), html);
        errors.delete(page);
      } catch (e) {
        // 403 на самом первом запросе — это закрытая тема, а не бан: без смысла ждать и просить «продолжить»
        if (e instanceof RateLimitError && e.status === 403 && done() === 0) throw new Error(L('e_denied', { site: '4PDA', status: 403 }));
        if (e instanceof RateLimitError) {
          hit.add(page);
          cache.set(hitKey, [...hit]);
          throw e;
        }
        errors.set(page, (e as Error).message);
      }
      progress({ done: done(), total: total() });
    };

    if (!o.partial) {
      progress({ done: done(), total: total() });
      for (;;) {
        try {
          await runPool(missing(), workers, fetchPage, delay, e => e instanceof RateLimitError);
          break;
        } catch (e) {
          if (!(e instanceof RateLimitError)) throw e;
          throw new PausedError(L('w_paused', { site: '4PDA', status: e.status, done: done(), total: total() }), done(), total(), null, true);
        }
      }
    }

    const seen = new Set<string>();
    const items = pages.flatMap(p => {
      const html = cache.get<string>(key(p));
      return html ? parsePosts(new DOMParser().parseFromString(html, 'text/html'), o, seen) : [];
    });
    if (!items.length) throw new Error(L('e_nothing'));
    const warnings: string[] = [];
    const failed = pages.filter(p => errors.has(p) && !cache.has(key(p)));
    if (failed.length) warnings.push(`${L('w_pages_failed', { n: failed.length })} (${failed.slice(0, 5).map(p => `стр. ${p + 1}: ${errors.get(p)}`).join('; ')})`);
    if (skipped.size) warnings.push(L('w_skipped_pages', { n: skipped.size, list: [...skipped].map(p => p + 1).join(', ') }));
    if (o.partial && done() < total()) warnings.push(L('w_partial', { done: done(), total: total() }));
    if (!o.partial) cache.deletePrefix(`4pda:${topicId}:`); // после «сохранить, что есть» скачанное остаётся для докачки
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
      warnings,
    };
  },
};
