import type { Lang } from './types';

/** Интервалы, из которых выбирает пользователь. Серверный простой — 30 минут, поэтому верхняя граница 25. */
export const INTERVALS = [1, 2, 5, 10, 15, 20, 25] as const;
export const DEFAULT_INTERVAL = 10;

export function normalizeInterval(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL;
  return Math.min(25, Math.max(1, Math.round(n)));
}

export const isLoginPath = (url: string): boolean => {
  try {
    return /\/Login\.aspx$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** 6:05 / 0:09 */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** «только что», «3 мин назад», «2 ч назад» */
export function fmtAgo(ms: number, lang: Lang): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return lang === 'ru' ? 'только что' : 'just now';
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'always', style: 'short' });
  return m < 60 ? rtf.format(-m, 'minute') : rtf.format(-Math.floor(m / 60), 'hour');
}

/** Активная вкладка первой: она точно не заморожена браузером. */
export function orderTabs<T extends { active?: boolean; lastAccessed?: number }>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => Number(!!b.active) - Number(!!a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}
