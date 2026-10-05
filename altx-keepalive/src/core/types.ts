export type Lang = 'ru' | 'en';
export type Theme = 'system' | 'light' | 'dark';

/** Состояние последнего цикла. login: вкладка открыта на странице входа; expired: сервер сам перекинул на вход. */
export type Kind = 'none' | 'ok' | 'error' | 'login' | 'expired' | 'no-tab' | 'disabled';
export type Reason = 'timer' | 'manual' | 'startup';

export interface Status {
  kind: Kind;
  at: number;
  reason: Reason;
  http?: number;
  error?: string;
}

export interface Settings {
  enabled: boolean;
  intervalMinutes: number;
  theme: Theme;
  lang: Lang | 'auto';
}

export type PingResult = { kind: 'ok'; http: number } | { kind: 'login' } | { kind: 'expired'; http: number } | { kind: 'error'; error: string; http?: number };

/** Сообщение фоновой страницы вкладке сайта. */
export type TabMsg = { type: 'ping' };

export const SITE_ORIGIN = 'https://update.altx-soft.ru';
export const SITE_PATTERN = `${SITE_ORIGIN}/*`;
export const PING_PATH = '/default.aspx';
export const ALARM = 'keepalive';
