import type { DocKind, ExtractOptions, Format, Progress, Theme } from './types';

export type Action = 'download' | 'copy';

export type Msg =
  | { type: 'fas/detect'; fallback: boolean }
  | { type: 'fas/run'; action: Action; opts: ExtractOptions; template: string; metaHeader: boolean; fallback: boolean; theme: Theme }
  | { type: 'fas/progress'; progress: Progress }
  /** Запрос к API GitHub через фон: хост-права и токен есть только у фона. */
  /** Перед каждым запросом к сайту: общая очередь и общий бан для всех вкладок (clear — пользователь сам продолжил). */
  | { type: 'fas/gate'; host: string; clear?: boolean }
  | { type: 'fas/ban'; host: string; status: number; retryAfterMs: number | null }
  /** Состояние сохранения во вкладке: нужно, чтобы закрытый и снова открытый popup не терял паузу. */
  | { type: 'fas/phase'; phase: TabPhase }
  | { type: 'fas/state'; tabId: number }
  | { type: 'fas/fetch'; url: string; method?: string; headers?: Record<string, string>; body?: string };

export interface GateReply {
  waitMs: number;
  ban: { until: number; status: number } | null;
}

export type TabPhase =
  | { kind: 'run' }
  | { kind: 'paused'; action: Action; done: number; total: number; skippable: boolean; text: string }
  | { kind: 'done' }
  | { kind: 'failed'; text: string };

export interface BgFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface DetectResult {
  id: string;
  /** Режимы страницы (GitHub) и режим по умолчанию. */
  modes?: string[];
  defaultMode?: string;
  /** Как показывать площадку: для универсального адаптера это хост страницы. */
  label: string;
  kind: DocKind;
  title: string;
  paged: boolean;
  hasComments: boolean;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  /** Страница не поддерживается — не ошибка загрузки (нужно для «Все вкладки»). */
  unsupported?: boolean;
  /** Сайт ограничил запросы: скачанное сохранено, продолжить можно позже. */
  paused?: { done: number; total: number; skippable?: boolean };
  site?: string;
  title?: string;
  url?: string;
  filename?: string;
  format?: Format;
  count?: number;
  /** Чего «count» штук: файлов (репозиторий), сообщений, элементов списка или комментариев. */
  unit?: 'files' | 'posts' | 'items' | 'comments';
  /** Только для action=copy */
  text?: string;
}

export const CONTENT_FILE = '/content-scripts/extract.js';
