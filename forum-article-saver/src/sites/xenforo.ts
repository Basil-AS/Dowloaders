import type { ImageMode, Item, Meta, ParsedDoc, SiteAdapter } from '../core/types';
import { getText, PausedError, RateLimitError, runPool, sleep } from '../core/http';
import { domToText } from '../core/html';
import { tFor } from '../core/i18n';

/** Одновременно не больше трёх запросов и пауза между ними: XDA стоит за Cloudflare и банит быстро. */
const SAFE_CONCURRENCY = 3;
const SAFE_DELAY_MS = 400;

/** /t/slug.123/ и /threads/slug.123/, с хвостами /page-N и /post-N. */
const THREAD_RE = /^(\/(?:t|threads)\/[^/]+\.(\d+))(?:\/|$)/;

/** Любой форум на XenForo 2 (xdaforums.com и др.). */
export const isXenForo = (doc: Document) => doc.documentElement.id === 'XF' || !!doc.querySelector('html[data-xf], article.message--post[data-author]');

export function parseThreadUrl(url: URL): { base: string; id: string } | null {
  const m = url.pathname.match(THREAD_RE);
  return m ? { base: `${url.origin}${m[1]}/`, id: m[2]! } : null;
}

const lastPage = (doc: Document): number => {
  const nav = doc.querySelector('.pageNav');
  const fromData = Number(nav?.getAttribute('data-last'));
  if (fromData > 0) return fromData;
  let max = 1;
  doc.querySelectorAll('.pageNav-page a, .pageNav-main a').forEach(a => {
    const n = parseInt(a.textContent ?? '', 10);
    if (n > max) max = n;
  });
  return max;
};

/** Сообщения одной страницы темы. */
export function parsePosts(doc: Document, o: { quotes: boolean; code: boolean; links: boolean; images: ImageMode; format: string }, seen: Set<string>): Item[] {
  const out: Item[] = [];
  const mode = o.format === 'md' ? 'md' : 'text';
  doc.querySelectorAll('article.message--post, article.message[data-author]').forEach(post => {
    const uid = post.getAttribute('data-content') || post.id || '';
    if (uid && seen.has(uid)) return; // страницы «съезжают», когда в теме появляются новые сообщения
    const body = post.querySelector('.message-body .bbWrapper') ?? post.querySelector('.bbWrapper');
    if (!body) return;

    const author = post.getAttribute('data-author') || post.querySelector('.message-name')?.textContent?.trim() || 'Guest';
    const date = post.querySelector('.message-attribution time, time.u-dt')?.getAttribute('datetime') ?? '';
    const num = (post.querySelector('.message-attribution-opposite a[href*="/post-"], .message-attribution-opposite a[href*="/posts/"]')?.textContent ?? '').replace(/\D/g, '') || uid.replace(/\D/g, '') || '?';

    const temp = body.cloneNode(true) as Element;
    temp.querySelectorAll('script, style, video, iframe, .bbCodeBlock-expandLink, .bbCodeBlock-shadow, .js-selectToQuoteEnd').forEach(e => e.remove());
    temp.querySelectorAll('img').forEach(img => {
      // ленивые картинки: настоящий адрес в data-src / data-url, а src — заглушка
      const real = img.getAttribute('data-src') || img.getAttribute('data-url');
      if (real) img.setAttribute('src', real);
    });
    temp.querySelectorAll('.bbCodeBlock--quote').forEach(q => {
      // Без цитат остаётся только имя цитируемого: «Петя said:» → «Петя».
      const title = (q.querySelector('.bbCodeBlock-title')?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const who = title.replace(/\s*(said|сказал\(а\)|писал\(а\)|wrote)?:\s*$/i, '');
      const bq = doc.createElement('blockquote');
      bq.textContent = o.quotes ? (title ? title + '\n' : '') + (q.querySelector('.bbCodeBlock-content')?.textContent ?? '').trim() : who;
      q.replaceWith(bq);
    });
    temp.querySelectorAll('.bbCodeBlock--code').forEach(c => {
      if (!o.code) return c.remove();
      const pre = doc.createElement('pre');
      pre.textContent = c.querySelector('.bbCodeCode code, code, .bbCodeBlock-content')?.textContent ?? c.textContent ?? '';
      c.replaceWith(pre);
    });
    temp.querySelectorAll('.bbCodeBlock--spoiler, .bbCodeSpoiler').forEach(s => {
      const title = s.querySelector('.bbCodeSpoiler-button-title, .bbCodeBlock-title')?.textContent?.trim() || 'spoiler';
      const p = doc.createElement('div');
      p.textContent = `▸ ${title}:\n${(s.querySelector('.bbCodeBlock-content') ?? s).textContent?.replace(title, '').trim() ?? ''}`;
      s.replaceWith(p);
    });

    const text = domToText(temp, { mode, links: o.links, images: o.images });
    if (!text) return;
    if (uid) seen.add(uid);
    out.push({ id: num, author, date, score: null, level: 0, replyTo: null, text });
  });
  return out;
}

export const xenforo: SiteAdapter = {
  id: 'xenforo',
  name: 'XenForo',
  kind: 'topic',
  paged: true,
  hasComments: false,
  detect: ({ url, doc }) => !!parseThreadUrl(url) && isXenForo(doc),

  async extract({ url, doc, fetch: f, cache }, o, progress): Promise<ParsedDoc> {
    const L = tFor(o.lang);
    const { base, id: threadId } = parseThreadUrl(url)!;
    const title = (doc.querySelector('h1.p-title-value')?.cloneNode(true) as Element | null);
    title?.querySelectorAll('.label, .labelLink').forEach(e => e.remove());
    const name = (title?.textContent || doc.title || '').replace(/\s+/g, ' ').trim();
    const totalPages = lastPage(doc);

    const count = o.percent >= 100 ? totalPages : Math.max(1, Math.ceil((totalPages * o.percent) / 100));
    const start = totalPages - count;
    const pages = Array.from({ length: count }, (_, i) => start + i + 1); // номера страниц с 1
    const key = (p: number) => `xf:${url.host}:${threadId}:${p}`;
    const missing = () => pages.filter(p => !cache.has(key(p)));
    const done = () => count - missing().length;
    const errors = new Map<number, string>();

    let workers = Math.min(o.concurrency, SAFE_CONCURRENCY);
    const delay = Math.max(o.delayMs, SAFE_DELAY_MS);
    const here = /\/post-\d+|\/posts\//.test(url.pathname) ? 0 : Number(url.pathname.match(/\/page-(\d+)/)?.[1] ?? 1); // 0: ссылка на сообщение, страница неизвестна

    const fetchPage = async (p: number) => {
      try {
        const html = await getText(f, p === 1 ? base : `${base}page-${p}`, 'utf-8', { blockStatuses: [403] });
        if (!/message--post|bbWrapper/.test(html)) throw new Error('no posts'); // защитная страница вместо темы
        cache.set(key(p), html);
        errors.delete(p);
      } catch (e) {
        if (e instanceof RateLimitError && e.status === 403 && done() === 0) throw new Error(L('e_denied', { site: url.hostname, status: 403 }));
        if (e instanceof RateLimitError) throw e;
        errors.set(p, (e as Error).message);
      }
      progress({ done: done(), total: count });
    };

    // страница, открытая сейчас, уже есть — лишний запрос не нужен
    if (pages.includes(here)) cache.set(key(here), doc.documentElement.outerHTML);

    if (!o.partial) {
      let probed = false;
      progress({ done: done(), total: count });
      for (;;) {
        try {
          await runPool(missing(), workers, fetchPage, delay, e => e instanceof RateLimitError);
          break;
        } catch (e) {
          if (!(e instanceof RateLimitError)) throw e;
          if (!probed) {
            probed = true;
            workers = 1;
            const wait = Math.min(Math.max(e.retryAfterMs ?? 20_000, 10_000), 60_000);
            progress({ done: done(), total: count, waitMs: wait });
            await sleep(wait);
            continue;
          }
          throw new PausedError(L('w_paused', { site: url.hostname, status: e.status, done: done(), total: count }), done(), count);
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
    if (failed.length) warnings.push(`${L('w_pages_failed', { n: failed.length })} (${failed.slice(0, 5).map(p => `p.${p}: ${errors.get(p)}`).join('; ')})`);
    if (o.partial && done() < count) warnings.push(L('w_partial', { done: done(), total: count }));
    if (!o.partial) cache.deletePrefix(`xf:${url.host}:${threadId}:`);
    return {
      id: threadId,
      site: url.hostname,
      kind: 'topic',
      title: name,
      url: base,
      meta: o.percent >= 100 ? [] : ([[L('m_range'), L('range_pages', { n: o.percent, from: start + 1, to: totalPages })]] as Meta[]),
      body: '',
      items,
      totalItems: null,
      warnings,
    };
  },
};
