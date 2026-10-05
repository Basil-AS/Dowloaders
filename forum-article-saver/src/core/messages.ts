import type { DocKind, ExtractOptions, Format, Progress, Theme } from './types';

export type Action = 'download' | 'copy';

export type Msg =
  | { type: 'fas/detect'; fallback: boolean }
  | { type: 'fas/run'; action: Action; opts: ExtractOptions; template: string; metaHeader: boolean; fallback: boolean; theme: Theme }
  | { type: 'fas/progress'; progress: Progress };

export interface DetectResult {
  id: string;
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
  site?: string;
  title?: string;
  url?: string;
  filename?: string;
  format?: Format;
  count?: number;
  /** Только для action=copy */
  text?: string;
}

export const CONTENT_FILE = '/content-scripts/extract.js';
