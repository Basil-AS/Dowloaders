import { browser } from 'wxt/browser';
import { DEFAULT_INTERVAL, normalizeInterval } from './schedule';
import type { Settings, Status } from './types';

export const DEFAULTS: Settings = { enabled: true, intervalMinutes: DEFAULT_INTERVAL, theme: 'system', lang: 'auto' };

export function sanitize(s: Partial<Settings> & Record<string, unknown>): Settings {
  return {
    enabled: s.enabled !== false,
    intervalMinutes: normalizeInterval(s.intervalMinutes ?? DEFAULTS.intervalMinutes),
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system',
    lang: s.lang === 'ru' || s.lang === 'en' ? s.lang : 'auto',
  };
}

/** Версия 1.x хранила `enabled` и `intervalMinutes` прямо в storage.local — они подхватываются как есть. */
export async function loadSettings(): Promise<Settings> {
  const raw = (await browser.storage.local.get(['enabled', 'intervalMinutes', 'theme', 'lang'])) as Record<string, unknown>;
  return sanitize(raw);
}

export async function saveSettings(p: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(p);
}

export async function loadState(): Promise<{ status: Status | null; log: Status[]; nextAt: number | null }> {
  const r = (await browser.storage.local.get(['status', 'log', 'nextAt'])) as { status?: Status; log?: Status[]; nextAt?: number };
  return { status: r.status ?? null, log: r.log ?? [], nextAt: r.nextAt ?? null };
}

export const LOG_LIMIT = 12;
