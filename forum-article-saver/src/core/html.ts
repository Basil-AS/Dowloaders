/**
 * HTML/DOM → текст (plain или Markdown).
 * innerText в «неотрисованных» документах (DOMParser, клоны) не ставит переносы между блоками,
 * поэтому дерево обходим сами.
 */
import type { ImageMode } from './types';

export interface TextOpts {
  mode: 'text' | 'md';
  links: boolean;
  images: ImageMode;
}
export const DEFAULT_TEXT_OPTS: TextOpts = { mode: 'text', links: true, images: 'url' };

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|yclid|mc_cid|mc_eid|ref|ref_src|_openstat)$/i;

/** Убирает трекинговые параметры (utm_*, fbclid…) — они длинные и ничего не значат. */
export function cleanUrl(href: string): string {
  if (!/^https?:\/\//i.test(href) || !/[?&]/.test(href)) return href;
  try {
    const u = new URL(href);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.href.replace(/\?$/, '');
  } catch {
    return href;
  }
}
const sameUrl = (text: string, href: string) => text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') === href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

const BLOCK = new Set(['DIV', 'P', 'UL', 'OL', 'TABLE', 'TR', 'FIGURE', 'FIGCAPTION', 'SECTION', 'ARTICLE', 'DL']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

function walk(n: Node, o: TextOpts, ctx: { list: ('ul' | 'ol')[]; ol: number[] }): string {
  if (n.nodeType === 3) return n.nodeValue ?? '';
  if (n.nodeType !== 1) return '';
  const el = n as Element;
  const tag = el.tagName;
  if (SKIP.has(tag)) return '';
  const md = o.mode === 'md';
  const inner = () => Array.from(el.childNodes).map(c => walk(c, o, ctx)).join('');

  switch (tag) {
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'IMG': {
      const alt = (el.getAttribute('alt') ?? '').trim();
      if (el.classList.contains('emoji')) return alt;
      if (o.images === 'none') return '';
      const src = el.getAttribute('data-src') || el.getAttribute('src') || '';
      if (o.images === 'url' && src && !src.startsWith('data:')) return md ? `![${alt}](${src})` : `[img: ${src}]`;
      return alt.length < 3 ? '' : `[img: ${alt}]`; // смайлы и декор без подписи: пользы нет, токены тратятся
    }
    case 'PRE': {
      const code = (el.textContent ?? '').replace(/\n$/, '');
      const lang = md ? (el.querySelector('code')?.className.match(/language-([\w+-]+)/)?.[1] ?? '') : '';
      return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    case 'CODE':
      return md ? `\`${el.textContent ?? ''}\`` : (el.textContent ?? '');
    case 'A': {
      const text = inner().trim();
      const href = cleanUrl(el.getAttribute('href') ?? '');
      if (!o.links || !href || href.startsWith('#') || href.startsWith('javascript:')) return text;
      if (!text || sameUrl(text, href)) return md ? `<${href}>` : href;
      return md ? `[${text}](${href})` : `${text} (${href})`;
    }
    case 'B':
    case 'STRONG': {
      const t = inner();
      return md && t.trim() ? `**${t.trim()}**` : t;
    }
    case 'I':
    case 'EM': {
      const t = inner();
      return md && t.trim() ? `*${t.trim()}*` : t;
    }
    case 'DEL':
    case 'S': {
      const t = inner();
      return md && t.trim() ? `~~${t.trim()}~~` : t;
    }
    case 'UL':
    case 'OL': {
      ctx.list.push(tag === 'UL' ? 'ul' : 'ol');
      ctx.ol.push(0);
      const body = inner();
      ctx.list.pop();
      ctx.ol.pop();
      return `\n${body}\n`;
    }
    case 'LI': {
      const depth = Math.max(0, ctx.list.length - 1);
      const kind = ctx.list[ctx.list.length - 1];
      let bullet = '•';
      if (kind === 'ol') {
        ctx.ol[ctx.ol.length - 1] = (ctx.ol[ctx.ol.length - 1] ?? 0) + 1;
        bullet = `${ctx.ol[ctx.ol.length - 1]}.`;
      } else if (md) bullet = '-';
      const text = inner().trim().replace(/\n/g, '\n' + '  '.repeat(depth + 1));
      return `\n${'  '.repeat(depth)}${bullet} ${text}`;
    }
    case 'BLOCKQUOTE':
      return '\n\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const lvl = Number(tag[1]);
      const t = inner().trim();
      return md ? `\n\n${'#'.repeat(lvl)} ${t}\n\n` : `\n\n${'#'.repeat(lvl)} ${t}\n`;
    }
    case 'TD':
    case 'TH':
      return inner().trim() + (md ? ' | ' : '\t');
    case 'TR':
      return md ? `\n| ${inner()}` : `\n${inner()}`;
    case 'P':
      return `\n\n${inner()}\n\n`;
    default:
      return BLOCK.has(tag) ? `\n${inner()}\n` : inner();
  }
}

export function tidy(t: string): string {
  return t
    .replace(/\r/g, '')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n[ \t]+(?=\S)/g, m => (m.length > 3 ? m : '\n'))
    .replace(/(\S)[ \t ]{2,}/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function domToText(node: Node, o: Partial<TextOpts> = {}): string {
  return tidy(walk(node, { ...DEFAULT_TEXT_OPTS, ...o }, { list: [], ol: [] }));
}

export function htmlToText(html: string, o: Partial<TextOpts> = {}): string {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  return domToText(doc.body, o);
}
