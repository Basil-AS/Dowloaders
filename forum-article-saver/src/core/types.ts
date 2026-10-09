export type Format = 'txt' | 'md' | 'json';
export type Lang = 'ru' | 'en';
export type Theme = 'system' | 'light' | 'dark';
/** Картинки в тексте: ничего / только подпись / адрес. */
export type ImageMode = 'none' | 'alt' | 'url';

/** Один комментарий / пост форума. level — глубина вложенности (0 = корень). */
export interface RepoFile {
  path: string;
  content: string;
}

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

/** repo — дайджест репозитория, list — список (все issues / обсуждения): элементы нумерованы, ответы вложены. */
export type DocKind = 'article' | 'post' | 'topic' | 'repo' | 'list';

/** [название, значение, extra]: extra=true показывается только в подробной шапке. */
export type Meta = [label: string, value: string, extra?: true];

/** Единая модель результата для всех площадок. */
export interface ParsedDoc {
  /** ID материала на площадке (для шаблона имени файла). */
  id: string;
  site: string;
  kind: DocKind;
  title: string;
  url: string;
  meta: Meta[];
  /** Тело статьи/поста (для тем форумов — пусто). */
  body: string;
  items: Item[];
  /** Всего элементов на площадке (если известно) — для «собрано N из M». */
  totalItems: number | null;
  /** Заголовок списка элементов, если он не «Комментарии»/«Сообщения». */
  itemsTitle?: string;
  /** Только для kind='repo': структура каталогов и файлы. */
  tree?: string;
  files?: RepoFile[];
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
  images: ImageMode;
  code: boolean;
  quotes: boolean;
  concurrency: number;
  delayMs: number;
  /** Режим площадки (GitHub: item / digest / issues / pulls / discussions). */
  mode?: string;
  /** Не докачивать: собрать документ из уже скачанного (после паузы). */
  partial?: boolean;
  github: GithubOptions;
}

export interface GithubOptions {
  state: 'all' | 'open' | 'closed';
  include: string;
  exclude: string;
  maxFileKb: number;
  maxItems: number;
}

export interface Progress {
  done: number;
  total: number;
  /** Идёт вынужденная пауза (мс): сайт попросил подождать. */
  waitMs?: number;
}
export type ProgressFn = (p: Progress) => void;

/** Всё, что нужно адаптеру от окружения (удобно подменять в тестах). */
export interface Ctx {
  url: URL;
  doc: Document;
  fetch: typeof fetch;
  /** fetch через фоновую страницу (хост-права и токен GitHub); в тестах — тот же fetch. */
  bgFetch?: typeof fetch;
  /** Кэш докачки: то, что уже скачано, переживает паузу. */
  cache: ResumeCache;
}

export interface ResumeCache {
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  deletePrefix(prefix: string): void;
}

export interface SiteAdapter {
  id: string;
  name: string;
  kind: DocKind;
  /** Поддерживает «последние N %». */
  paged: boolean;
  hasComments: boolean;
  /** Режимы работы на этой странице (если их несколько) и режим по умолчанию. */
  modes?(ctx: Ctx): { list: string[]; def: string } | null;
  /** Заголовок для шапки popup и подсказки имени файла, если «заголовок вкладки» не подходит. */
  pageTitle?(ctx: Ctx): string | null;
  /** Запасной адаптер: используется, только если ни один конкретный не подошёл и это разрешено настройками. */
  fallback?: boolean;
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
  images: ImageMode;
  code: boolean;
  quotes: boolean;
  metaHeader: boolean;
  concurrency: number;
  delayMs: number;
  filenameTemplate: string;
  history: boolean;
  github: GithubOptions;
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
