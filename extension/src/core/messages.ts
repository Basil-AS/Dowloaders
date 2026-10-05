import type { ExtractOptions, Format, Progress } from './types';

export type Action = 'download' | 'copy';

export type Msg =
  | { type: 'fas/detect' }
  | { type: 'fas/run'; action: Action; opts: ExtractOptions; template: string; metaHeader: boolean }
  | { type: 'fas/progress'; progress: Progress };

export interface DetectResult {
  id: string;
  name: string;
  paged: boolean;
  hasComments: boolean;
}

export interface RunResult {
  ok: boolean;
  error?: string;
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
