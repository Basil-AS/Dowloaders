import { useEffect, useMemo, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, history as historyStore, loadSettings, saveSettings } from '../../core/settings';
import { resolveLang, t, type Key } from '../../core/i18n';
import { buildFilename } from '../../core/filename';
import type { Format, HistoryEntry, Settings } from '../../core/types';

export function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then(setS);
    void historyStore.list().then(setHist);
  }, []);

  const lang = useMemo(() => resolveLang(s?.lang ?? 'auto'), [s?.lang]);
  if (!s) return null;
  const tr = (k: Key) => t(lang, k);

  const patch = (p: Partial<Settings>) => {
    const next = { ...s, ...p };
    setS(next);
    void saveSettings(next).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  };
  const chk = (k: 'comments' | 'links' | 'images' | 'code' | 'quotes' | 'metaHeader' | 'history', label: Key) => (
    <label class="chk">
      <input type="checkbox" checked={s[k]} onChange={e => patch({ [k]: e.currentTarget.checked })} />
      {tr(label)}
    </label>
  );
  const num = (k: 'percent' | 'maxDepth' | 'concurrency' | 'delayMs', label: Key, min: number, max: number) => (
    <label class="f">
      <span>{tr(label)}</span>
      <input type="number" min={min} max={max} value={s[k]} onChange={e => patch({ [k]: Number(e.currentTarget.value) })} />
    </label>
  );
  const preview = buildFilename(s.filenameTemplate, { title: 'Заголовок статьи', site: 'habr.com', id: '123', count: 42 }, s.format);

  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(hist, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'forum-article-saver-history.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div class="opt">
      <h1>⚙ Forum &amp; Article Saver — {tr('settings')} {saved && <small style="color:var(--ok)">✓ {tr('s_saved')}</small>}</h1>

      <h2>{tr('s_general')}</h2>
      <label class="f">
        <span>{tr('format')}</span>
        <select value={s.format} onChange={e => patch({ format: e.currentTarget.value as Format })}>
          <option value="txt">TXT</option>
          <option value="md">Markdown</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <label class="f">
        <span>{tr('s_language')}</span>
        <select value={s.lang} onChange={e => patch({ lang: e.currentTarget.value as Settings['lang'] })}>
          <option value="auto">{tr('s_auto')}</option>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
      {num('percent', 's_defaultPct', 1, 100)}
      {chk('history', 's_history')}
      <p class="msg">{tr('s_shortcut')}</p>

      <h2>{tr('s_content')}</h2>
      {chk('comments', 'comments')}
      {chk('links', 's_links')}
      {chk('images', 's_images')}
      {chk('code', 's_code')}
      {chk('quotes', 's_quotes')}
      {chk('metaHeader', 'h_exported')}
      {num('maxDepth', 's_maxDepth', 0, 50)}
      <label class="f">
        <span>{tr('s_minScore')}</span>
        <input type="number" value={s.minScore ?? ''} onChange={e => patch({ minScore: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} />
      </label>

      <h2>{tr('s_network')}</h2>
      {num('concurrency', 's_concurrency', 1, 8)}
      {num('delayMs', 's_delay', 0, 5000)}

      <h2>{tr('s_files')}</h2>
      <label class="f">
        <span>{tr('s_template')}</span>
        <input type="text" value={s.filenameTemplate} onChange={e => patch({ filenameTemplate: e.currentTarget.value })} />
      </label>
      <p class="msg">{tr('s_templateHint')}<br />{tr('s_preview')}: <code>{preview}</code></p>

      <h2>{tr('history')} ({hist.length})</h2>
      <div class="btns">
        <button class="sec" onClick={exportHistory} disabled={!hist.length}>{tr('s_export')}</button>
        <button class="sec" onClick={async () => { await historyStore.clear(); setHist([]); }} disabled={!hist.length}>{tr('clear')}</button>
      </div>
      <div class="btns">
        <button class="sec" onClick={() => patch({ ...DEFAULT_SETTINGS })}>{tr('s_reset')}</button>
      </div>
    </div>
  );
}
