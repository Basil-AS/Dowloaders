import { useEffect, useMemo, useState } from 'preact/hooks';
import { history as historyStore, loadSettings, saveSettings, watchSettings } from '../core/settings';
import { resolveLang, t, type Key } from '../core/i18n';
import { applyTheme } from '../core/theme';
import type { HistoryEntry, Lang, Settings } from '../core/types';

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
  const replace = (next: Settings) => {
    setS(next);
    void saveSettings(next);
  };
  const patch = (p: Partial<Settings>) => s && replace({ ...s, ...p });
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);
  return { s, lang, patch, replace, tr };
}

/** История сохранений: живая, обновляется при любой записи (в том числе из другой вкладки). */
export function useHistory(limit = Infinity): HistoryEntry[] {
  const [list, setList] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    void historyStore.list().then(setList);
    return historyStore.watch(setList);
  }, []);
  return limit === Infinity ? list : list.slice(0, limit);
}

/** Кнопка с подтверждением: первое нажатие «взводит» её на 3 секунды. */
export function useConfirm(ms = 3000): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(id);
  }, [armed]);
  return [armed, () => {
    if (!armed) {
      setArmed(true);
      return false;
    }
    setArmed(false);
    return true;
  }];
}

/** «14:05», «Вчера, 14:05», «3 окт.» — коротко и по-человечески. */
export function fmtWhen(ts: number, lang: Lang, now = Date.now()): string {
  const d = new Date(ts);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return time;
  if (days === 1) return `${new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-1, 'day')}, ${time}`;
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}
