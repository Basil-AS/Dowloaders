import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { detect, runOnTab } from '../../core/pipeline';
import { history as historyStore, loadSettings, saveSettings } from '../../core/settings';
import { resolveLang, t, type Key } from '../../core/i18n';
import type { DetectResult, Msg, RunResult } from '../../core/messages';
import type { Format, HistoryEntry, Settings } from '../../core/types';

type Status = { kind: 'idle' | 'run' | 'ok' | 'err'; text: string };

export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [site, setSite] = useState<DetectResult | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [pct, setPct] = useState(0);
  const [hist, setHist] = useState<HistoryEntry[]>([]);

  const lang = useMemo(() => resolveLang(s?.lang ?? 'auto'), [s?.lang]);
  const tr = (k: Key, v?: Record<string, string | number>) => t(lang, k, v);

  useEffect(() => {
    (async () => {
      const settings = await loadSettings();
      setS(settings);
      setHist((await historyStore.list()).slice(0, 5));
      const q = new URLSearchParams(location.search).get('tabId'); // для автотестов
      const id = q ? Number(q) : (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (id == null) return setSite(null);
      setTabId(id);
      try {
        setSite(await detect(id));
      } catch (e) {
        setSite(null);
        setStatus({ kind: 'err', text: `${t(resolveLang(settings.lang), 'cantInject')}\n${(e as Error).message}` });
      }
    })();
    const onMsg = (raw: unknown) => {
      const m = raw as Msg;
      if (m.type === 'fas/progress' && m.progress.total) setPct(Math.round((m.progress.done / m.progress.total) * 100));
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);

  if (!s) return null;
  const patch = (p: Partial<Settings>) => {
    const next = { ...s, ...p };
    setS(next);
    void saveSettings(next);
  };

  const finish = async (res: RunResult, action: 'download' | 'copy') => {
    if (!res.ok) return setStatus({ kind: 'err', text: `${tr('error')}: ${res.error}` });
    if (action === 'copy' && res.text != null) {
      await navigator.clipboard.writeText(res.text);
      setStatus({ kind: 'ok', text: `${tr('copied')} (${res.count} ${tr('items')})` });
    } else setStatus({ kind: 'ok', text: `${tr('done')}: ${res.count} ${tr('items')}\n${res.filename}` });
    setHist((await historyStore.list()).slice(0, 5));
  };

  const go = async (action: 'download' | 'copy') => {
    if (tabId == null) return;
    setStatus({ kind: 'run', text: tr('running') });
    setPct(0);
    await finish(await runOnTab(tabId, action, s), action);
  };

  const allTabs = async () => {
    const origins = ['<all_urls>'];
    if (!(await browser.permissions.contains({ origins })) && !(await browser.permissions.request({ origins }))) return;
    const tabs = (await browser.tabs.query({ currentWindow: true })).filter(x => x.id != null && /^https?:/.test(x.url ?? ''));
    let ok = 0;
    let total = 0;
    for (const tab of tabs) {
      try {
        if (!(await detect(tab.id!))) continue;
      } catch {
        continue;
      }
      total++;
      setStatus({ kind: 'run', text: `${tr('running')} ${total}` });
      if ((await runOnTab(tab.id!, 'download', s)).ok) ok++;
    }
    setStatus({ kind: ok ? 'ok' : 'err', text: `${tr('allTabsDone')}: ${ok}/${total}` });
    setHist((await historyStore.list()).slice(0, 5));
  };

  const running = status.kind === 'run';
  const ready = !!site && !running;

  return (
    <div class="pop">
      <h1>📥 {tr('title')}</h1>
      <div class="badge">{site === undefined ? '…' : site ? `${tr('detected')}: ${site.name}` : tr('unsupported')}</div>
      {site === null && status.kind !== 'err' && <div class="msg">{tr('unsupportedHint')}</div>}

      {site && (
        <>
          <div class="row">
            <label>{tr('format')}</label>
            <select value={s.format} onChange={e => patch({ format: (e.currentTarget.value as Format) })}>
              <option value="txt">TXT</option>
              <option value="md">Markdown</option>
              <option value="json">JSON</option>
            </select>
          </div>
          {site.hasComments && (
            <div class="row">
              <label>{tr('comments')}</label>
              <input type="checkbox" checked={s.comments} onChange={e => patch({ comments: e.currentTarget.checked })} />
            </div>
          )}
          {site.paged && (
            <div class="row">
              <label>{tr('portion')}</label>
              <input type="range" min="1" max="100" value={s.percent} onInput={e => patch({ percent: Number(e.currentTarget.value) })} />
              <b style="min-width:76px;text-align:right;font-size:12px">{s.percent >= 100 ? tr('all') : tr('lastPct', { n: s.percent })}</b>
            </div>
          )}
          <div class="btns">
            <button disabled={!ready} onClick={() => go('download')}>{tr('download')}</button>
            <button class="sec" disabled={!ready} onClick={() => go('copy')}>{tr('copy')}</button>
          </div>
        </>
      )}
      <div class="btns" style="margin-top:8px">
        <button class="sec" disabled={running} onClick={allTabs}>{tr('allTabs')}</button>
      </div>

      {running && <div class="bar"><i style={{ width: pct + '%' }} /></div>}
      {status.text && <div class={`msg ${status.kind === 'err' ? 'err' : status.kind === 'ok' ? 'ok' : ''}`}>{status.text}</div>}

      <h2 style="margin-top:16px">{tr('history')}</h2>
      {hist.length ? (
        <ul class="hist">
          {hist.map(h => (
            <li>
              <a href={h.url} target="_blank" title={h.filename}>{h.title || h.url}</a>
              <small>{h.site} · {h.count} {tr('items')} · {h.format.toUpperCase()} · {new Date(h.ts).toLocaleDateString(lang)}</small>
            </li>
          ))}
        </ul>
      ) : (
        <div class="msg">{tr('historyEmpty')}</div>
      )}
      <div class="foot">
        <button class="link" onClick={() => browser.runtime.openOptionsPage()}>⚙ {tr('settings')}</button>
        {hist.length > 0 && <button class="link" onClick={async () => { await historyStore.clear(); setHist([]); }}>{tr('clear')}</button>}
      </div>
    </div>
  );
}
