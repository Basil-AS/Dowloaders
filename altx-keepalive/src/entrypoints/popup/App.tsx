import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { BgMsg } from '../background';
import { statusKey, type Key } from '../../core/i18n';
import { fmtAgo, fmtCountdown, INTERVALS } from '../../core/schedule';
import type { Kind, Status, Theme } from '../../core/types';
import { useKeepAlive, useNow } from '../../ui/hooks';

const DOT: Record<Kind, string> = { none: '', ok: 'ok', error: 'bad', expired: 'bad', login: 'warn', 'no-tab': 'warn', disabled: '' };
const REASON: Record<Status['reason'], Key> = { timer: 'r_timer', manual: 'r_manual', startup: 'r_startup' };

export function App() {
  const { s, lang, patch, tr, status, log, next } = useKeepAlive();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  if (!s) return null;

  const hhmm = (t: number) => new Date(t).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const kind: Kind = !s.enabled ? 'disabled' : (status?.kind ?? 'none');

  const renew = async () => {
    setBusy(true);
    try {
      await browser.runtime.sendMessage({ type: 'run-now' } satisfies BgMsg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="popup">
      <header class="head">
        <div>
          <h1>ALT-X KeepAlive</h1>
          <p>{tr('site')}</p>
        </div>
        <label class="switch" title={tr('toggle')}>
          <input type="checkbox" role="switch" aria-label={tr('toggle')} checked={s.enabled} onChange={e => patch({ enabled: e.currentTarget.checked })} />
          <i />
        </label>
      </header>

      <section class="state" aria-live="polite">
        <div class="state-main">
          <span class={`dot ${DOT[kind]}`} aria-hidden="true" />
          <span>{tr(statusKey(kind))}</span>
        </div>
        {status?.kind === 'error' && status.error && s.enabled && <p class="err">{status.error}</p>}
        <dl class="kv small">
          <dt>{tr('last')}</dt>
          <dd class="num">{status && status.kind !== 'disabled' ? `${hhmm(status.at)} · ${fmtAgo(now - status.at, lang)}` : '—'}</dd>
          {status?.http != null && s.enabled && (
            <>
              <dt>{tr('http')}</dt>
              <dd class="num">{status.http}</dd>
            </>
          )}
          <dt>{tr('next')}</dt>
          <dd class="num">{s.enabled && next ? fmtCountdown(next - now) : tr('nextNone')}</dd>
        </dl>
      </section>

      <section class="controls">
        <div class="row">
          <label for="iv">{tr('interval')}</label>
          <select id="iv" class="field" value={s.intervalMinutes} onChange={e => patch({ intervalMinutes: Number(e.currentTarget.value) })}>
            {INTERVALS.map(n => (
              <option value={n}>{tr('minutes', { n })}</option>
            ))}
          </select>
        </div>
        <button class="btn" disabled={!s.enabled || busy} onClick={renew}>
          {busy ? tr('working') : tr('now')}
        </button>
      </section>

      <details>
        <summary>{tr('log')}</summary>
        {log.length ? (
          <ul class="log">
            {log.map(e => (
              <li>
                <span class={`dot ${DOT[e.kind]}`} aria-hidden="true" />
                <span>{tr(statusKey(e.kind))}</span>
                <span class="faint num">{hhmm(e.at)} · {tr(REASON[e.reason])}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="faint small">{tr('logEmpty')}</p>
        )}
      </details>

      <details>
        <summary>{tr('appearance')}</summary>
        <div class="controls">
          <div class="row">
            <span class="lbl" id="th-l">{tr('theme')}</span>
            <div class="seg" role="radiogroup" aria-labelledby="th-l" style="min-width:210px">
              {([['system', 'themeSystem'], ['light', 'themeLight'], ['dark', 'themeDark']] as [Theme, Key][]).map(([v, k]) => (
                <label>
                  <input type="radio" name="theme" value={v} checked={s.theme === v} onChange={() => patch({ theme: v })} />
                  {tr(k)}
                </label>
              ))}
            </div>
          </div>
          <div class="row">
            <label for="lg">{tr('language')}</label>
            <select id="lg" class="field" value={s.lang} onChange={e => patch({ lang: e.currentTarget.value as typeof s.lang })}>
              <option value="auto">{tr('langAuto')}</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </details>

      <p class="note">{tr('note')}</p>
    </main>
  );
}
