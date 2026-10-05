import type { ExtractOptions, Format, Item, Lang, ParsedDoc } from './types';
import { t } from './i18n';

export const EXT: Record<Format, string> = { txt: 'txt', md: 'md', json: 'json' };
export const MIME: Record<Format, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

const SEP = '='.repeat(64);

export function fmtDate(iso: string, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB');
}

const score = (n: number | null) => (n == null ? '' : n > 0 ? `+${n}` : String(n));

function itemsLabel(doc: ParsedDoc, lang: Lang): string {
  return t(lang, doc.kind === 'topic' ? 'h_posts' : 'h_comments');
}

function head(doc: ParsedDoc, lang: Lang, now: Date): [string, string][] {
  return [
    [t(lang, 'h_url'), doc.url],
    ...doc.meta,
    [t(lang, 'h_exported'), fmtDate(now.toISOString(), lang)],
  ];
}

function itemHead(it: Item, lang: Lang, md: boolean): string {
  const parts = [md ? `#${it.id}` : `#${it.id}`, it.author || '—'];
  if (it.date) parts.push(fmtDate(it.date, lang));
  if (it.score != null) parts.push(score(it.score));
  if (it.replyTo) parts.push(`${t(lang, 'h_reply')} #${it.replyTo}`);
  return md ? `**${parts.join(' · ')}**` : `--- [ ${parts.join(' | ')} ] ---`;
}

const indent = (s: string, level: number, pad: string) => (level ? s.split('\n').map(l => pad.repeat(level) + l).join('\n') : s);

function toTxt(doc: ParsedDoc, o: ExtractOptions, now: Date, meta: boolean): string {
  const lang = o.lang;
  const out: string[] = [`${doc.title}`];
  if (meta) out.push(head(doc, lang, now).map(([k, v]) => `${k}: ${v}`).join('\n'));
  else out.push(`${t(lang, 'h_url')}: ${doc.url}`);
  out.push(SEP);
  if (doc.body) out.push(doc.body, SEP);
  if (doc.items.length || doc.kind !== 'topic') {
    const total = doc.totalItems != null && doc.totalItems !== doc.items.length ? ` — ${t(lang, 'h_collected', { n: doc.items.length, m: doc.totalItems })}` : '';
    out.push(`${itemsLabel(doc, lang).toUpperCase()} (${doc.items.length})${total}`, SEP);
  }
  for (const it of doc.items) out.push(indent(`${itemHead(it, lang, false)}\n${it.text}`, it.level, '    ') + '\n');
  if (doc.warnings.length) out.push(`${t(lang, 'h_warnings')}:\n${doc.warnings.map(w => '- ' + w).join('\n')}`);
  return out.join('\n\n').replace(/\n{3,}$/g, '\n') + '\n';
}

function toMd(doc: ParsedDoc, o: ExtractOptions, now: Date, meta: boolean): string {
  const lang = o.lang;
  const out: string[] = [`# ${doc.title}`];
  const h = meta ? head(doc, lang, now) : ([[t(lang, 'h_url'), doc.url]] as [string, string][]);
  out.push(h.map(([k, v]) => `- **${k}:** ${v}`).join('\n'), '---');
  if (doc.body) out.push(doc.body, '---');
  if (doc.items.length || doc.kind !== 'topic') out.push(`## ${itemsLabel(doc, lang)} (${doc.items.length})`);
  for (const it of doc.items) {
    const block = `${itemHead(it, lang, true)}\n\n${it.text}`;
    out.push(it.level ? block.split('\n').map(l => '>'.repeat(it.level) + ' ' + l).join('\n') : block);
  }
  if (doc.warnings.length) out.push(`> **${t(lang, 'h_warnings')}:** ${doc.warnings.join('; ')}`);
  return out.join('\n\n') + '\n';
}

export function formatDoc(doc: ParsedDoc, o: ExtractOptions, opts: { meta?: boolean; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const meta = opts.meta ?? true;
  switch (o.format) {
    case 'md':
      return toMd(doc, o, now, meta);
    case 'json':
      return JSON.stringify({ ...doc, exportedAt: now.toISOString() }, null, 2) + '\n';
    default:
      return toTxt(doc, o, now, meta);
  }
}

/** Фильтры, одинаковые для всех площадок: глубина и минимальный рейтинг (вместе с поддеревом). */
export function applyFilters(doc: ParsedDoc, o: Pick<ExtractOptions, 'maxDepth' | 'minScore'>): ParsedDoc {
  if (!o.maxDepth && o.minScore == null) return doc;
  const items: Item[] = [];
  let dropBelow: number | null = null;
  for (const it of doc.items) {
    if (dropBelow != null) {
      if (it.level > dropBelow) continue;
      dropBelow = null;
    }
    if (o.maxDepth && it.level >= o.maxDepth) continue;
    if (o.minScore != null && it.score != null && it.score < o.minScore) {
      dropBelow = it.level;
      continue;
    }
    items.push(it);
  }
  return { ...doc, items };
}
