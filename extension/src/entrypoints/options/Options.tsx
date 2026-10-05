import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, history as historyStore, sanitizeSettings } from '../../core/settings';
import { buildFilename } from '../../core/filename';
import { EXT } from '../../core/format';
import { count, type Key } from '../../core/i18n';
import type { Format, HistoryEntry, Settings, Theme } from '../../core/types';
import { fmtWhen, useSettings } from '../../ui/hooks';

type BoolKey = 'comments' | 'links' | 'images' | 'code' | 'quotes' | 'metaHeader' | 'generic' | 'history';
const TOKENS = ['{date}', '{time}', '{site}', '{title}', '{id}', '{count}'];
const SITE_ROWS = [['Хабр', 'habr.com'], ['Reddit', 'reddit.com'], ['4PDA', '4pda.to'], ['Discourse', 'ntc.party, meta.discourse.org …']];

function Setting(props: { label: string; hint?: string; stack?: boolean; children: ComponentChildren; for?: string }) {
  return (
    <div class={`setting${props.stack ? ' stack' : ''}`}>
      <label class="label" for={props.for}>{props.label}</label>
      {props.hint && <p class="hint">{props.hint}</p>}
      <div class="ctl">{props.children}</div>
    </div>
  );
}

function Radios<T extends string>(props: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="radiogroup">
      {props.options.map(([v, label]) => (
        <label>
          <input type="radio" name={props.name} value={v} checked={props.value === v} onChange={() => props.onChange(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}

export function Options() {
  const { s, lang, patch, tr, replace } = useSettings();
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const tpl = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void historyStore.list().then(setHist);
    void browser.commands.getAll().then(cs => setShortcut(cs.find(c => c.name === 'save-page')?.shortcut || ''));
    return historyStore.watch(setHist);
  }, []);

  if (!s) return null;
  const set = (p: Partial<Settings>) => {
    patch(p);
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1400);
  };
  const toggle = (k: BoolKey, label: Key, hint?: Key) => (
    <Setting label={tr(label)} hint={hint && tr(hint)} for={`o-${k}`}>
      <span class="switch">
        <input id={`o-${k}`} type="checkbox" role="switch" checked={s[k]} onChange={e => set({ [k]: e.currentTarget.checked })} />
        <i />
      </span>
    </Setting>
  );
  const number = (k: 'percent' | 'maxDepth' | 'concurrency' | 'delayMs', label: Key, hint: Key | undefined, min: number, max: number) => (
    <Setting label={tr(label)} hint={hint && tr(hint)} for={`o-${k}`}>
      <input id={`o-${k}`} class="field" type="number" min={min} max={max} value={s[k]} onChange={e => set({ [k]: Number(e.currentTarget.value) })} />
    </Setting>
  );

  const preview = buildFilename(s.filenameTemplate, { title: lang === 'ru' ? 'Заголовок статьи' : 'Article title', site: 'habr.com', id: '1021392', count: 249 }, EXT[s.format]);
  const addToken = (tok: string) => {
    const el = tpl.current;
    const at = el?.selectionStart ?? s.filenameTemplate.length;
    set({ filenameTemplate: s.filenameTemplate.slice(0, at) + tok + s.filenameTemplate.slice(el?.selectionEnd ?? at) });
  };

  const download = (name: string, data: unknown) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const importSettings = async (file: File) => {
    try {
      const j = JSON.parse(await file.text());
      if (typeof j !== 'object' || j === null || !('format' in j)) throw new Error('bad');
      replace(sanitizeSettings(j));
      setNote(tr('o_imported'));
    } catch {
      setNote(tr('o_importError'));
    }
  };

  const version = browser.runtime.getManifest().version;
  return (
    <div class="opt">
      <header class="opt-head">
        <h1>{tr('o_title')}</h1>
        <span class={`saved${saved ? ' on' : ''}`} role="status">{saved ? tr('o_saved') : ''}</span>
      </header>

      <nav aria-label={tr('o_title')}>
        {([['appearance', 'o_appearance'], ['content', 'o_content'], ['files', 'o_files'], ['network', 'o_network'], ['data', 'o_data'], ['about', 'o_about']] as [string, Key][]).map(([id, k]) => (
          <a href={`#${id}`}>{tr(k)}</a>
        ))}
      </nav>

      <div>
        <section id="appearance">
          <h2>{tr('o_appearance')}</h2>
          <Setting label={tr('o_theme')}>
            <Radios<Theme> name="theme" value={s.theme} onChange={v => set({ theme: v })} options={[['system', tr('o_theme_system')], ['light', tr('o_theme_light')], ['dark', tr('o_theme_dark')]]} />
          </Setting>
          <Setting label={tr('o_language')} for="o-lang">
            <select id="o-lang" class="field" value={s.lang} onChange={e => set({ lang: e.currentTarget.value as Settings['lang'] })}>
              <option value="auto">{tr('o_lang_auto')}</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </Setting>
          <Setting label={tr('o_format')}>
            <Radios<Format> name="format" value={s.format} onChange={v => set({ format: v })} options={[['txt', 'TXT'], ['md', 'Markdown'], ['json', 'JSON']]} />
          </Setting>
        </section>

        <section id="content">
          <h2>{tr('o_content')}</h2>
          {toggle('comments', 'o_comments', 'o_commentsHint')}
          {toggle('links', 'o_links', 'o_linksHint')}
          {toggle('images', 'o_images', 'o_imagesHint')}
          {toggle('code', 'o_code', 'o_codeHint')}
          {toggle('quotes', 'o_quotes', 'o_quotesHint')}
          {toggle('metaHeader', 'o_meta', 'o_metaHint')}
          {toggle('generic', 'o_generic', 'o_genericHint')}
          {number('percent', 'o_amount', 'o_amountHint', 1, 100)}
          {number('maxDepth', 'o_depth', 'o_depthHint', 0, 50)}
          <Setting label={tr('o_minScore')} hint={tr('o_minScoreHint')} for="o-minScore">
            <input id="o-minScore" class="field" type="number" value={s.minScore ?? ''} onChange={e => set({ minScore: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} />
          </Setting>
        </section>

        <section id="files">
          <h2>{tr('o_files')}</h2>
          <Setting label={tr('o_template')} hint={tr('o_templateHint')} stack for="o-tpl">
            <input id="o-tpl" ref={tpl} class="field mono" style="width:100%" type="text" value={s.filenameTemplate} onChange={e => set({ filenameTemplate: e.currentTarget.value })} />
            <div class="chips">
              {TOKENS.map(tok => (
                <button type="button" class="chip" onClick={() => addToken(tok)}>{tok}</button>
              ))}
            </div>
            <p class="preview"><span class="faint">{tr('o_preview')}: </span><span class="mono">{preview}</span></p>
          </Setting>
        </section>

        <section id="network">
          <h2>{tr('o_network')}</h2>
          {number('concurrency', 'o_concurrency', 'o_concurrencyHint', 1, 8)}
          {number('delayMs', 'o_delay', undefined, 0, 5000)}
        </section>

        <section id="data">
          <h2>{tr('o_data')}</h2>
          {toggle('history', 'o_history')}
          <div class="btn-row">
            <button class="btn sm" disabled={!hist.length} onClick={() => download('forum-article-saver-history.json', hist)}>{tr('o_exportHistory')}</button>
            <button class="btn sm" disabled={!hist.length} onClick={() => historyStore.clear()}>{tr('o_clearHistory')}</button>
          </div>
          {hist.length > 0 && (
            <>
              <p class="faint" style="margin-top:12px">{tr('o_historyCount', { n: hist.length })}</p>
              <ul class="hist-list">
                {hist.slice(0, 20).map(h => (
                  <li>
                    <a href={h.url} target="_blank" rel="noreferrer" style="color:inherit">{h.title || h.url}</a>
                    <div class="faint" style="font-size:12px">{h.site} · {h.format.toUpperCase()} · {h.count ? count(lang, h.count, 'items') + ' · ' : ''}{fmtWhen(h.ts, lang)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div class="btn-row" style="margin-top:20px">
            <button class="btn sm" onClick={() => download('forum-article-saver-settings.json', s)}>{tr('o_exportSettings')}</button>
            <label class="btn sm" style="cursor:pointer">
              {tr('o_importSettings')}
              <input type="file" accept="application/json,.json" class="sr" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void importSettings(f); e.currentTarget.value = ''; }} />
            </label>
            <button
              class={`btn sm${sure ? ' danger' : ''}`}
              onClick={() => {
                if (!sure) { setSure(true); setTimeout(() => setSure(false), 3000); return; }
                setSure(false);
                replace({ ...DEFAULT_SETTINGS });
              }}
            >
              {sure ? tr('o_resetSure') : tr('o_reset')}
            </button>
          </div>
          {note && <p class="muted" style="margin-top:10px" role="status">{note}</p>}
        </section>

        <section id="about">
          <h2>{tr('o_about')}</h2>
          <dl class="kv">
            <dt>{tr('o_version')}</dt>
            <dd class="mono">{version}</dd>
            <dt>{tr('o_shortcut')}</dt>
            <dd>
              {shortcut ? <kbd>{shortcut}</kbd> : <span class="muted">{tr('o_shortcutNone')}</span>}
              <div class="faint" style="font-size:12px;margin-top:4px">{tr('o_shortcutHow')}</div>
            </dd>
            <dt>{tr('o_sites')}</dt>
            <dd>
              {SITE_ROWS.map(([n, h]) => (
                <div>{n} <span class="faint">· {h}</span></div>
              ))}
            </dd>
            <dt>{tr('o_source')}</dt>
            <dd><a class="link" href="https://github.com/Basil-AS/Dowloaders" target="_blank" rel="noreferrer">github.com/Basil-AS/Dowloaders</a></dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
