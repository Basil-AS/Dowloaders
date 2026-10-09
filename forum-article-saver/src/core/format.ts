import type { ExtractOptions, Format, Item, Lang, Meta, ParsedDoc } from './types';
import { t } from './i18n';

/** Форматы в порядке показа в интерфейсе. */
export const FORMATS: [Format, string][] = [
  ['txt', 'TXT'],
  ['md', 'Markdown'],
  ['json', 'JSON'],
];
export const FORMAT_LABEL = Object.fromEntries(FORMATS) as Record<Format, string>;

export const EXT: Record<Format, string> = { txt: 'txt', md: 'md', json: 'json' };
export const MIME: Record<Format, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

const p2 = (n: number) => String(n).padStart(2, '0');
const ISO = /^\d{4}-\d\d-\d\dT/;

/** «2024-05-01 10:00» вместо длинной локализованной даты; внутри одного дня повторно — только «10:00». */
export function stamp(iso: string, prevDay = ''): { text: string; day: string } {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return { text: iso, day: '' };
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return { text: day === prevDay ? time : `${day} ${time}`, day };
}

const shortValue = (v: string) => (ISO.test(v) ? stamp(v).text : v);
const score = (n: number | null) => (n == null || n === 0 ? '' : n > 0 ? `+${n}` : String(n));

/** Шапка: адрес и одна строка основных полей; в подробном режиме — все поля. */
function headLines(doc: ParsedDoc, detailed: boolean, lang: Lang, now: Date): string[] {
  const rows = doc.meta.filter((m): m is Meta => detailed || !m[2]).map(([k, v]) => `${k}: ${shortValue(v)}`);
  if (detailed) rows.push(`${t(lang, 'h_exported')}: ${stamp(now.toISOString()).text}`);
  return [doc.url, ...(rows.length ? [rows.join(' | ')] : [])];
}

function listTitle(doc: ParsedDoc, lang: Lang): string {
  const name = doc.itemsTitle ?? t(lang, doc.kind === 'topic' ? 'h_posts' : 'h_comments');
  // в списках (issues, обсуждения) считаем сами записи, а не вложенные в них комментарии
  const n = doc.kind === 'list' ? doc.items.filter(i => i.level === 0).length : doc.items.length;
  const partial = doc.totalItems != null && doc.totalItems !== n;
  return partial ? `${name} ${t(lang, 'h_collected', { n, m: doc.totalItems! })}` : `${name} ${n}`;
}

/** Строка-заголовок элемента. Номер печатаем только у тем форумов (на него ссылаются «→N»); в деревьях вложенность — это «>». */
function itemHead(it: Item, numbered: boolean, prevDay: { v: string }): string {
  const parts: string[] = [];
  if (numbered && it.id) parts.push(it.id);
  parts.push(it.author || '—');
  if (it.date) {
    const st = stamp(it.date, prevDay.v);
    if (st.day) prevDay.v = st.day;
    parts.push(st.text);
  }
  const sc = score(it.score);
  if (sc) parts.push(sc);
  if (numbered && it.replyTo) parts.push(`→${it.replyTo}`);
  return `${'>'.repeat(it.level)}${it.level ? ' ' : ''}${parts.join(' ')}`;
}

/** Внутри комментариев пустые строки между абзацами — лишние токены. */
const tight = (s: string) => s.replace(/\n{2,}/g, '\n');

/** Адрес своего сайта в ссылках заменяем на «/путь» — база объявляется один раз в шапке. */
export function relativize(text: string, pageUrl: string): { text: string; base: string | null } {
  let host: string;
  let origin: string;
  try {
    const u = new URL(pageUrl);
    host = u.hostname.replace(/^www\./, '');
    origin = u.origin;
  } catch {
    return { text, base: null };
  }
  const re = new RegExp(`https?://(?:www\\.)?${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/)`, 'g');
  let n = 0;
  const out = text.replace(re, () => (n++, ''));
  return n > 1 ? { text: out, base: origin } : { text, base: null }; // одна ссылка — выигрыша нет
}

/** Забор длиннее любой серии обратных кавычек внутри текста, чтобы блок кода не «закрылся» раньше времени. */
const fence = (s: string) => '`'.repeat(Math.max(3, ...(s.match(/`+/g) ?? []).map(x => x.length + 1)));
const LANG: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', rb: 'ruby', php: 'php', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', html: 'html', css: 'css', sql: 'sql', swift: 'swift' };

function repoBlocks(doc: ParsedDoc, lang: Lang, md: boolean): string[] {
  const out: string[] = [];
  if (doc.tree) out.push(md ? `## ${t(lang, 'h_structure')}\n${fence(doc.tree)}\n${doc.tree}\n${fence(doc.tree)}` : doc.tree);
  for (const f of doc.files ?? []) {
    if (md) {
      const fc = fence(f.content);
      out.push(`## ${f.path}\n${fc}${LANG[f.path.split('.').pop()?.toLowerCase() ?? ''] ?? ''}\n${f.content}\n${fc}`);
    } else out.push(`### ${f.path}\n${f.content}`);
  }
  return out;
}

function render(doc: ParsedDoc, o: ExtractOptions, detailed: boolean, now: Date, md: boolean): string {
  const numbered = doc.kind === 'topic' || doc.kind === 'list';
  const rest: string[] = [];
  if (doc.body) rest.push(doc.body);
  if (doc.kind === 'repo') rest.push(...repoBlocks(doc, o.lang, md));
  else if (doc.items.length || doc.kind !== 'topic') rest.push(md ? `## ${listTitle(doc, o.lang)}` : listTitle(doc, o.lang));
  const day = { v: '' };
  for (const it of doc.items) {
    const h = itemHead(it, numbered, day);
    rest.push(`${md ? `**${h}**` : h}\n${tight(it.text)}`);
  }
  // в дайджесте репозитория содержимое файлов остаётся дословным: ссылки внутри кода и документации менять нельзя
  const joined = rest.join('\n\n');
  const { text: body, base } = doc.kind === 'repo' ? { text: joined, base: null } : relativize(joined, doc.url);
  const head = [md ? `# ${doc.title}` : doc.title, ...headLines(doc, detailed, o.lang, now)];
  if (base) head.push(t(o.lang, 'h_base', { base }));
  const out = [head.join('\n'), body];
  if (doc.warnings.length) out.push(`${t(o.lang, 'h_warnings')}: ${doc.warnings.join('; ')}`);
  return out.filter(Boolean).join('\n\n') + '\n';
}

/** JSON без отступов и без пустых полей: те же данные, заметно меньше токенов. */
function toJson(doc: ParsedDoc, now: Date): string {
  const items = doc.items.map(({ id, author, date, score, level, replyTo, text }) => ({
    id, author, ...(date && { date }), ...(score != null && score !== 0 && { score }), ...(level && { level }), ...(replyTo && { replyTo }), text,
  }));
  const meta = Object.fromEntries(doc.meta.map(([k, v]) => [k, v]));
  return JSON.stringify({ title: doc.title, url: doc.url, kind: doc.kind, meta, ...(doc.body && { body: doc.body }), ...(doc.tree && { tree: doc.tree }), ...(doc.files && { files: doc.files }), items, ...(doc.warnings.length && { warnings: doc.warnings }), exportedAt: now.toISOString() });
}

export function formatDoc(doc: ParsedDoc, o: ExtractOptions, opts: { detailed?: boolean; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const detailed = opts.detailed ?? false;
  return o.format === 'json' ? toJson(doc, now) : render(doc, o, detailed, now, o.format === 'md');
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
