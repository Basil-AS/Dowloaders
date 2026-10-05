import { useEffect, useMemo, useState } from 'preact/hooks';
import { loadSettings, saveSettings, watchSettings } from '../core/settings';
import { resolveLang, t, type Key } from '../core/i18n';
import { applyTheme } from '../core/theme';
import type { Lang, Settings } from '../core/types';

/** Настройки с автосохранением; тема и язык применяются сразу. */
export function useSettings() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setS);
    return watchSettings(setS);
  }, []);
  useEffect(() => {
    if (s) applyTheme(s.theme);
  }, [s?.theme]);
  const lang: Lang = useMemo(() => resolveLang(s?.lang ?? 'auto'), [s?.lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const patch = (p: Partial<Settings>) => {
    if (!s) return;
    const next = { ...s, ...p };
    setS(next);
    void saveSettings(next);
  };
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);
  return { s, lang, patch, tr, replace: (n: Settings) => { setS(n); void saveSettings(n); } };
}

/** «Сегодня 14:05», «Вчера», «3 окт.» — коротко и по-человечески. */
export function fmtWhen(ts: number, lang: Lang, now = Date.now()): string {
  const d = new Date(ts);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return time;
  if (days === 1) return `${new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-1, 'day')}, ${time}`;
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}
