import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { detect, runOnTab } from '../../core/pipeline';
import { history as historyStore } from '../../core/settings';
import { buildFilename } from '../../core/filename';
import { EXT } from '../../core/format';
import { count, type Key } from '../../core/i18n';
import type { DetectResult, Msg, RunResult } from '../../core/messages';
import type { Format, HistoryEntry } from '../../core/types';
import { IconCopy, IconDownload, IconGear } from '../../ui/icons';
import { fmtWhen, useSettings } from '../../ui/hooks';

type Status = { kind: 'idle' | 'run' | 'ok' | 'err'; text: string };

const FORMATS: { id: Format; label: string }[] = [
  { id: 'txt', label: 'TXT' },
  { id: 'md', label: 'Markdown' },
  { id: 'json', label: 'JSON' },
];
const SITES: [string, Key][] = [
  ['Хабр', 'p_site_habr'],
  ['Reddit', 'p_site_reddit'],
  ['4PDA', 'p_site_4pda'],
  ['Discourse', 'p_site_discourse'],
];

export function App() {
  const { s, lang, patch, tr } = useSettings();
  const [tabId, setTabId] = useState<number | null>(null);
  const [site, setSite] = useState<DetectResult | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (!s || started.current) return;
    started.current = true;
    (async () => {
      setHist((await historyStore.list()).slice(0, 3));
      const q = new URLSearchParams(location.search).get('tabId'); // для автотестов
      const id = q ? Number(q) : (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (id == null) return setSite(null);
      setTabId(id);
      try {
        setSite(await detect(id, s.generic));
      } catch (e) {
        setSite(null);
        setStatus({ kind: 'err', text: tr('p_cantInject') });
      }
    })();
  }, [s]);

  useEffect(() => {
    const onMsg = (raw: unknown) => {
      const m = raw as Msg;
      if (m.type === 'fas/progress' && m.progress.total) setProg({ done: m.progress.done, total: m.progress.total });
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);

  if (!s) return null;
  const running = status.kind === 'run';
  const unit = site?.kind === 'topic' ? 'posts' : 'comments';
  const refreshHist = async () => setHist((await historyStore.list()).slice(0, 3));

  const finish = async (res: RunResult, action: 'download' | 'copy') => {
    setProg(null);
    if (!res.ok) return setStatus({ kind: 'err', text: tr('p_failed', { msg: res.error ?? '' }) });
    if (action === 'copy' && res.text != null) {
      try {
        await navigator.clipboard.writeText(res.text);
      } catch {
        return setStatus({ kind: 'err', text: tr('p_failed', { msg: 'clipboard' }) });
      }
      setStatus({ kind: 'ok', text: tr('p_copied') });
    } else {
      const n = res.count ? ` · ${count(lang, res.count, unit)}` : '';
      setStatus({ kind: 'ok', text: `${tr('p_saved')}${n}` });
    }
    void refreshHist();
  };

  const go = async (action: 'download' | 'copy') => {
    if (tabId == null) return;
    setStatus({ kind: 'run', text: tr('p_saving') });
    setProg({ done: 0, total: 0 });
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
        const d = await detect(tab.id!, false); // «все вкладки» берёт только известные площадки
        if (!d) continue;
      } catch {
        continue;
      }
      total++;
      setStatus({ kind: 'run', text: `${tr('p_saving')} · ${total}` });
      if ((await runOnTab(tab.id!, 'download', { ...s, generic: false })).ok) ok++;
    }
    setProg(null);
    setStatus(total ? { kind: ok ? 'ok' : 'err', text: tr('p_allTabsDone', { ok, total }) } : { kind: 'err', text: tr('p_allTabsNone') });
    void refreshHist();
  };

  const host = site?.host ?? '';
  const fileHint = site ? buildFilename(s.filenameTemplate, { title: site.title, site: host, count: undefined }, EXT[s.format]) : '';
  const kindLabel = site ? tr(`p_kind_${site.kind}` as Key) : '';
  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const amountText = s.percent >= 100 ? tr('p_amountAll') : tr('p_amountLast', { n: s.percent });

  return (
    <main class="popup">
      <header class="head">
        <div class="head-top">
          <div class="where">
            {site ? (
              <>
                <b>{site.id === 'generic' ? host : site.name}</b>
                <span aria-hidden="true">·</span>
                <span>{kindLabel}</span>
              </>
            ) : (
              <span>{site === undefined ? '' : tr('p_unsupported')}</span>
            )}
          </div>
          <button class="icon-btn" title={tr('p_settings')} aria-label={tr('p_settings')} onClick={() => browser.runtime.openOptionsPage()}>
            <IconGear />
          </button>
        </div>
        {site && <h1 class="page-title">{site.title || host}</h1>}
      </header>

      {site === null && (
        <section>
          <p class="muted">{tr('p_unsupportedBody')}</p>
          <ul class="sites">
            {SITES.map(([n, d]) => (
              <li>
                <span>{n}</span>
                <span>{tr(d)}</span>
              </li>
            ))}
            {s.generic && (
              <li>
                <span>{tr('p_otherSites')}</span>
                <span>{tr('p_site_generic')}</span>
              </li>
            )}
          </ul>
          {status.kind === 'err' && <p class="err" style="margin-top:10px;color:var(--danger)">{status.text}</p>}
        </section>
      )}

      {site && (
        <>
          <section class="controls" aria-label={tr('p_format')}>
            <div class="row">
              <span class="lbl" id="fmt-l">{tr('p_format')}</span>
              <div class="seg grow" role="radiogroup" aria-labelledby="fmt-l">
                {FORMATS.map(f => (
                  <label>
                    <input type="radio" name="format" value={f.id} checked={s.format === f.id} onChange={() => patch({ format: f.id })} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            {site.hasComments && (
              <div class="row">
                <label for="cm">{tr('p_comments')}</label>
                <span class="switch">
                  <input id="cm" type="checkbox" role="switch" checked={s.comments} onChange={e => patch({ comments: e.currentTarget.checked })} />
                  <i />
                </span>
              </div>
            )}
            {site.paged && (
              <div class="amount">
                <label for="amt" class="muted">{tr('p_amount')}</label>
                <output for="amt" class="num">{amountText}</output>
                <input id="amt" type="range" min="1" max="100" value={s.percent} onInput={e => patch({ percent: Number(e.currentTarget.value) })} />
              </div>
            )}
          </section>

          <section>
            <div class="actions">
              <button class="btn primary" disabled={running} onClick={() => go('download')}>
                <IconDownload />
                {tr('p_save', { fmt: FORMATS.find(f => f.id === s.format)!.label })}
              </button>
              <button class="btn icon" disabled={running} onClick={() => go('copy')} title={tr('p_copy')} aria-label={tr('p_copy')}>
                <IconCopy />
              </button>
            </div>
            <p class="fname mono" title={fileHint} style="margin-top:8px">{fileHint}</p>
          </section>
        </>
      )}

      <div class="status" aria-live="polite" hidden={!running && !status.text}>
        {running && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        {status.text && site !== null && (
          <p class={status.kind === 'ok' ? 'ok' : status.kind === 'err' ? 'err' : ''}>
            {status.text}
            {running && prog && prog.total > 0 && <span class="num"> · {tr('p_progress', { done: prog.done, total: prog.total })}</span>}
          </p>
        )}
      </div>

      <section class="recent">
        <header>
          <h2>{tr('p_recent')}</h2>
          {hist.length > 0 && (
            <button class="link" style="font-size:12px" onClick={async () => { await historyStore.clear(); setHist([]); }}>
              {tr('p_clear')}
            </button>
          )}
        </header>
        {hist.length ? (
          <ul>
            {hist.map(h => (
              <li>
                <a href={h.url} target="_blank" rel="noreferrer" title={h.filename}>{h.title || h.url}</a>
                <small>{h.site} · {h.format.toUpperCase()} · {fmtWhen(h.ts, lang)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p class="faint" style="padding-top:6px">{tr('p_none')}</p>
        )}
      </section>

      <footer class="foot">
        <button class="link" disabled={running} onClick={allTabs} title={tr('p_allTabsHint')}>{tr('p_allTabs')}</button>
      </footer>
    </main>
  );
}
