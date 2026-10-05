import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { detect, runOnTab, saveAllTabs } from '../../core/pipeline';
import { history as historyStore } from '../../core/settings';
import { buildFilename } from '../../core/filename';
import { EXT, FORMAT_LABEL, FORMATS } from '../../core/format';
import { count, type Key } from '../../core/i18n';
import type { DetectResult, Msg, RunResult } from '../../core/messages';
import type { DocKind } from '../../core/types';
import { IconCopy, IconDownload, IconGear } from '../../ui/icons';
import { Radios } from '../../ui/Radios';
import { fmtWhen, useHistory, useSettings } from '../../ui/hooks';

type Status = { kind: 'idle' | 'run' | 'ok' | 'err'; text: string };

const SITES: [string, Key][] = [
  ['Хабр', 'p_site_habr'],
  ['Reddit', 'p_site_reddit'],
  ['4PDA', 'p_site_4pda'],
  ['Discourse', 'p_site_discourse'],
];
const KIND: Record<DocKind, Key> = { article: 'p_kind_article', post: 'p_kind_post', topic: 'p_kind_topic' };

async function currentTabId(): Promise<number | undefined> {
  const q = new URLSearchParams(location.search).get('tabId'); // для автотестов
  return q ? Number(q) : (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

export function App() {
  const { s, lang, patch, tr } = useSettings();
  const hist = useHistory(3);
  const [tabId, setTabId] = useState<number | null | undefined>(undefined);
  const [site, setSite] = useState<DetectResult | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: '' });
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  // Вкладку ищем сразу, параллельно с загрузкой настроек; определение страницы ждёт только флаг generic.
  useEffect(() => {
    void currentTabId().then(id => setTabId(id ?? null));
    const onMsg = (raw: unknown) => {
      const m = raw as Msg;
      if (m.type === 'fas/progress' && m.progress.total) setProg(m.progress);
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);

  const generic = s?.generic;
  useEffect(() => {
    if (generic === undefined || tabId === undefined) return;
    if (tabId === null) return setSite(null);
    detect(tabId, generic).then(setSite, () => {
      setSite(null);
      setStatus({ kind: 'err', text: tr('p_cantInject') });
    });
  }, [generic, tabId]);

  if (!s) return null;
  const running = status.kind === 'run';
  const unit = site?.kind === 'topic' ? 'posts' : 'comments';

  const finish = async (res: RunResult, action: 'download' | 'copy') => {
    setProg(null);
    if (!res.ok) return setStatus({ kind: 'err', text: tr('p_failed', { msg: res.error ?? '' }) });
    if (action === 'copy' && res.text != null) {
      try {
        await navigator.clipboard.writeText(res.text);
      } catch (e) {
        return setStatus({ kind: 'err', text: tr('p_failed', { msg: (e as Error).message }) });
      }
      setStatus({ kind: 'ok', text: tr('p_copied') });
    } else {
      setStatus({ kind: 'ok', text: `${tr('p_saved')}${res.count ? ` · ${count(lang, res.count, unit)}` : ''}` });
    }
  };

  const go = async (action: 'download' | 'copy') => {
    if (typeof tabId !== 'number') return;
    setStatus({ kind: 'run', text: tr('p_saving') });
    setProg({ done: 0, total: 0 });
    await finish(await runOnTab(tabId, action, s), action);
  };

  const allTabs = async () => {
    const origins = ['<all_urls>'];
    if (!(await browser.permissions.contains({ origins })) && !(await browser.permissions.request({ origins }))) return;
    setStatus({ kind: 'run', text: tr('p_saving') });
    const { ok, total } = await saveAllTabs(s);
    setProg(null);
    setStatus(total ? { kind: ok ? 'ok' : 'err', text: tr('p_allTabsDone', { ok, total }) } : { kind: 'err', text: tr('p_allTabsNone') });
  };

  const fileHint = site ? buildFilename(s.filenameTemplate, { title: site.title, site: site.label }, EXT[s.format]) : '';
  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const amountText = s.percent >= 100 ? tr('p_amountAll') : tr('p_amountLast', { n: s.percent });

  return (
    <main class="popup">
      <header class="head">
        <div class="head-top">
          <div class="where">
            {site ? (
              <>
                <b>{site.label}</b>
                <span aria-hidden="true">·</span>
                <span>{tr(KIND[site.kind])}</span>
              </>
            ) : (
              <span>{site === null ? tr('p_unsupported') : ''}</span>
            )}
          </div>
          <button class="icon-btn" title={tr('p_settings')} aria-label={tr('p_settings')} onClick={() => browser.runtime.openOptionsPage()}>
            <IconGear />
          </button>
        </div>
        {site && <h1 class="page-title">{site.title || site.label}</h1>}
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
        </section>
      )}

      {site && (
        <>
          <section class="controls" aria-label={tr('p_format')}>
            <div class="row">
              <span class="lbl" id="fmt-l">{tr('p_format')}</span>
              <Radios class="grow" name="format" labelledBy="fmt-l" value={s.format} options={FORMATS} onChange={v => patch({ format: v })} />
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

          <section class="save">
            <div class="actions">
              <button class="btn primary" disabled={running} onClick={() => go('download')}>
                <IconDownload />
                {tr('p_save', { fmt: FORMAT_LABEL[s.format] })}
              </button>
              <button class="btn icon" disabled={running} onClick={() => go('copy')} title={tr('p_copy')} aria-label={tr('p_copy')}>
                <IconCopy />
              </button>
            </div>
            <p class="fname mono" title={fileHint}>{fileHint}</p>
          </section>
        </>
      )}

      <div class="status" aria-live="polite" hidden={!running && !status.text}>
        {running && (
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        {status.text && (
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
            <button class="link small" onClick={() => historyStore.clear()}>{tr('p_clear')}</button>
          )}
        </header>
        {hist.length ? (
          <ul>
            {hist.map(h => (
              <li>
                <a href={h.url} target="_blank" rel="noreferrer" title={h.filename}>{h.title || h.url}</a>
                <small>{h.site} · {FORMAT_LABEL[h.format]} · {fmtWhen(h.ts, lang)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p class="faint empty">{tr('p_none')}</p>
        )}
      </section>

      <footer class="foot">
        <button class="link" disabled={running} onClick={allTabs} title={tr('p_allTabsHint')}>{tr('p_allTabs')}</button>
      </footer>
    </main>
  );
}
