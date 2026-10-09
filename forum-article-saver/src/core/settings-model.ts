import type { ExtractOptions, GithubOptions, Settings } from './types';
import { resolveLang } from './i18n';

export const DEFAULT_SETTINGS: Settings = {
  format: 'txt',
  lang: 'auto',
  theme: 'system',
  generic: true,
  comments: true,
  maxDepth: 0,
  minScore: null,
  percent: 100,
  links: true,
  images: 'alt',
  code: true,
  quotes: false,
  metaHeader: false,
  concurrency: 5,
  delayMs: 150,
  filenameTemplate: '{date} - [{site}] - {title}',
  history: true,
  github: { state: 'all', include: '', exclude: '', maxFileKb: 100, maxItems: 1000 },
};

export const MAX_HISTORY = 50;

/** Раньше настройка была true/false: true → адрес, false → подпись. */
function imageMode(v: unknown): Settings['images'] {
  if (v === true) return 'url';
  if (v === false) return 'alt';
  return v === 'none' || v === 'alt' || v === 'url' ? v : DEFAULT_SETTINGS.images;
}

function sanitizeGithub(g: Partial<GithubOptions> | undefined): GithubOptions {
  const d = DEFAULT_SETTINGS.github;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  return {
    state: g?.state === 'open' || g?.state === 'closed' ? g.state : 'all',
    include: String(g?.include ?? d.include).slice(0, 4000),
    exclude: String(g?.exclude ?? d.exclude).slice(0, 4000),
    maxFileKb: num(g?.maxFileKb, d.maxFileKb, 1, 5000),
    maxItems: num(g?.maxItems, d.maxItems, 10, 5000),
  };
}

/** Приводит значения к допустимым диапазонам (защита от кривого импорта / ручной правки). */
export function sanitizeSettings(s: Partial<Settings>): Settings {
  const d = DEFAULT_SETTINGS;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
  };
  return {
    ...d,
    ...s,
    format: (['txt', 'md', 'json'] as const).includes(s.format as never) ? (s.format as Settings['format']) : d.format,
    lang: (['auto', 'ru', 'en'] as const).includes(s.lang as never) ? (s.lang as Settings['lang']) : d.lang,
    theme: (['system', 'light', 'dark'] as const).includes(s.theme as never) ? (s.theme as Settings['theme']) : d.theme,
    generic: s.generic ?? d.generic,
    // раньше было true/false: true → адрес, false → подпись
    images: imageMode(s.images),
    maxDepth: num(s.maxDepth, d.maxDepth, 0, 50),
    minScore: s.minScore == null || (s.minScore as unknown) === '' ? null : num(s.minScore, 0, -100000, 100000),
    percent: num(s.percent, d.percent, 1, 100),
    concurrency: num(s.concurrency, d.concurrency, 1, 8),
    delayMs: num(s.delayMs, d.delayMs, 0, 5000),
    filenameTemplate: (s.filenameTemplate ?? '').trim() || d.filenameTemplate,
    github: sanitizeGithub(s.github),
  };
}

export function toExtractOptions(s: Settings, over: Partial<ExtractOptions> = {}): ExtractOptions {
  return {
    format: s.format,
    lang: resolveLang(s.lang),
    percent: s.percent,
    comments: s.comments,
    maxDepth: s.maxDepth,
    minScore: s.minScore,
    links: s.links,
    images: s.images,
    code: s.code,
    quotes: s.quotes,
    concurrency: s.concurrency,
    delayMs: s.delayMs,
    github: s.github,
    ...over,
  };
}

