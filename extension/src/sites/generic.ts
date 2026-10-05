import { Readability, isProbablyReaderable } from '@mozilla/readability';
import type { ParsedDoc, SiteAdapter } from '../core/types';
import { htmlToText } from '../core/html';
import { t } from '../core/i18n';

/** Запасной вариант для любого сайта: выделяет основной текст страницы (как режим чтения). */
export const generic: SiteAdapter = {
  id: 'generic',
  name: 'Web',
  kind: 'article',
  paged: false,
  hasComments: false,
  detect: ({ doc }) => {
    try {
      return isProbablyReaderable(doc);
    } catch {
      return false;
    }
  },

  async extract({ url, doc }, o, progress): Promise<ParsedDoc> {
    progress({ done: 0, total: 1 });
    const article = new Readability(doc.cloneNode(true) as Document, { keepClasses: false }).parse();
    if (!article?.content) throw new Error(t(o.lang, 'e_no_article'));
    const L = (k: Parameters<typeof t>[1]) => t(o.lang, k);
    const meta: [string, string][] = [];
    if (article.byline) meta.push([L('m_author'), article.byline.trim()]);
    if (article.publishedTime) meta.push([L('m_date'), article.publishedTime]);
    if (article.siteName) meta.push([L('m_site'), article.siteName]);
    if (article.excerpt) meta.push([L('m_excerpt'), article.excerpt.replace(/\s+/g, ' ').trim()]);
    progress({ done: 1, total: 1 });
    return {
      id: url.pathname.split('/').filter(Boolean).pop() ?? '',
      site: url.hostname.replace(/^www\./, ''),
      kind: 'article',
      title: (article.title || doc.title || url.hostname).trim(),
      url: url.href,
      meta,
      body: htmlToText(article.content, { mode: o.format === 'md' ? 'md' : 'text', links: o.links, images: o.images }),
      items: [],
      totalItems: null,
      warnings: [],
    };
  },
};
