export type Format = 'txt' | 'md' | 'json';
export type Lang = 'ru' | 'en';
export type Theme = 'system' | 'light' | 'dark';

/** Один комментарий / пост форума. level — глубина вложенности (0 = корень). */
export interface Item {
  id: string;
  author: string;
  /** ISO-строка или '' */
  date: string;
  score: number | null;
  level: number;
  replyTo: string | null;
  text: string;
}

export type DocKind = 'article' | 'post' | 'topic';

/** Единая модель результата для всех площадок. */
export interface ParsedDoc {
  /** ID материала на площадке (для шаблона имени файла). */
  id: string;
  site: string;
  kind: DocKind;
  title: string;
  url: string;
  meta: [string, string][];
  /** Тело статьи/поста (для тем форумов — пусто). */
  body: string;
  items: Item[];
  /** Всего элементов на площадке (если известно) — для «собрано N из M». */
  totalItems: number | null;
  warnings: string[];
}

export interface ExtractOptions {
  format: Format;
  lang: Lang;
  /** Для постраничных площадок: скачать последние N % (100 = всё). */
  percent: number;
  /** Скачивать комментарии (для статей/постов). */
  comments: boolean;
  /** 0 = без ограничения; иначе максимум уровней вложенности. */
  maxDepth: number;
  /** null = без фильтра. */
  minScore: number | null;
  links: boolean;
  images: boolean;
  code: boolean;
  quotes: boolean;
  concurrency: number;
  delayMs: number;
}

export interface Progress {
  done: number;
  total: number;
  text?: string;
}
export type ProgressFn = (p: Progress) => void;

/** Всё, что нужно адаптеру от окружения (удобно подменять в тестах). */
export interface Ctx {
  url: URL;
  doc: Document;
  fetch: typeof fetch;
}

export interface SiteAdapter {
  id: string;
  name: string;
  kind: DocKind;
  /** Поддерживает «последние N %». */
  paged: boolean;
  hasComments: boolean;
  detect(ctx: Ctx): boolean;
  extract(ctx: Ctx, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc>;
}

export interface Settings {
  format: Format;
  lang: Lang | 'auto';
  theme: Theme;
  /** На незнакомых сайтах выделять основной текст статьи. */
  generic: boolean;
  comments: boolean;
  maxDepth: number;
  minScore: number | null;
  percent: number;
  links: boolean;
  images: boolean;
  code: boolean;
  quotes: boolean;
  metaHeader: boolean;
  concurrency: number;
  delayMs: number;
  filenameTemplate: string;
  history: boolean;
}

export interface HistoryEntry {
  ts: number;
  title: string;
  url: string;
  site: string;
  filename: string;
  count: number;
  format: Format;
}
