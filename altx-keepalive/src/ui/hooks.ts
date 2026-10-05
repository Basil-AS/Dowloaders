import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { loadSettings, loadState, saveSettings } from '../core/settings';
import { resolveLang, t, type Key } from '../core/i18n';
import { applyTheme } from '../core/theme';
import type { Lang, Settings, Status } from '../core/types';

/** Настройки и состояние из storage.local: обновляются «вживую» при любой записи (в том числе фоновой). */
export function useKeepAlive() {
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [log, setLog] = useState<Status[]>([]);
  const [next, setNext] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setS(await loadSettings());
      const st = await loadState();
      setStatus(st.status);
      setLog(st.log);
      setNext(st.nextAt);
    };
    void load();
    const on = (_c: unknown, area: string) => area === 'local' && void load();
    browser.storage.onChanged.addListener(on);
    return () => browser.storage.onChanged.removeListener(on);
  }, []);

  useEffect(() => {
    if (s) applyTheme(s.theme);
  }, [s?.theme]);

  const lang: Lang = useMemo(() => resolveLang(s?.lang ?? 'auto'), [s?.lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const patch = (p: Partial<Settings>) => {
    if (s) setS({ ...s, ...p });
    void saveSettings(p);
  };
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);
  return { s, lang, patch, tr, status, log, next };
}

/** Перерисовка раз в секунду для обратного отсчёта. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
