import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, history as historyStore, sanitizeSettings } from '../../core/settings';
import { buildFilename } from '../../core/filename';
import { EXT, FORMAT_LABEL, FORMATS } from '../../core/format';
import { saveBlob } from '../../core/run';
import { count, type Key } from '../../core/i18n';
import type { ImageMode, Settings, Theme } from '../../core/types';
import { Radios } from '../../ui/Radios';
import { fmtWhen, useConfirm, useHistory, useSettings } from '../../ui/hooks';

type BoolKey = 'comments' | 'links' | 'code' | 'quotes' | 'metaHeader' | 'generic' | 'history';
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

export function Options() {
  const { s, lang, patch, tr, replace } = useSettings();
  const hist = useHistory();
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState('');
  const [resetArmed, confirmReset] = useConfirm();
  const [shortcut, setShortcut] = useState<string | null>(null);
  const tpl = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void browser.commands.getAll().then(cs => setShortcut(cs.find(c => c.name === 'save-page')?.shortcut || ''));
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

  const download = (name: string, data: unknown) => saveBlob(JSON.stringify(data, null, 2), name, 'json');
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
            <Radios name="format" value={s.format} onChange={v => set({ format: v })} options={FORMATS} />
          </Setting>
        </section>

        <section id="content">
          <h2>{tr('o_content')}</h2>
          <p class="muted">{tr('o_econ')}</p>
          {toggle('comments', 'o_comments', 'o_commentsHint')}
          {toggle('links', 'o_links', 'o_linksHint')}
          <Setting label={tr('o_images')} hint={tr('o_imagesHint')}>
            <Radios<ImageMode> name="images" value={s.images} onChange={v => set({ images: v })} options={[['none', tr('o_img_none')], ['alt', tr('o_img_alt')], ['url', tr('o_img_url')]]} />
          </Setting>
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
            <input id="o-tpl" ref={tpl} class="field mono wide" type="text" value={s.filenameTemplate} onChange={e => set({ filenameTemplate: e.currentTarget.value })} />
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
              <p class="faint mt">{tr('o_historyCount', { n: hist.length })}</p>
              <ul class="hist-list">
                {hist.slice(0, 20).map(h => (
                  <li>
                    <a href={h.url} target="_blank" rel="noreferrer">{h.title || h.url}</a>
                    <div class="faint small">{h.site} · {FORMAT_LABEL[h.format]} · {h.count ? count(lang, h.count, 'items') + ' · ' : ''}{fmtWhen(h.ts, lang)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div class="btn-row spaced">
            <button class="btn sm" onClick={() => download('forum-article-saver-settings.json', s)}>{tr('o_exportSettings')}</button>
            <label class="btn sm">
              {tr('o_importSettings')}
              <input type="file" accept="application/json,.json" class="sr" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void importSettings(f); e.currentTarget.value = ''; }} />
            </label>
            <button class={`btn sm${resetArmed ? ' danger' : ''}`} onClick={() => confirmReset() && replace({ ...DEFAULT_SETTINGS })}>
              {resetArmed ? tr('o_resetSure') : tr('o_reset')}
            </button>
          </div>
          {note && <p class="muted mt" role="status">{note}</p>}
        </section>

        <section id="about">
          <h2>{tr('o_about')}</h2>
          <dl class="kv">
            <dt>{tr('o_version')}</dt>
            <dd class="mono">{version}</dd>
            <dt>{tr('o_shortcut')}</dt>
            <dd>
              {shortcut ? <kbd>{shortcut}</kbd> : <span class="muted">{tr('o_shortcutNone')}</span>}
              <div class="faint small mt-s">{tr('o_shortcutHow')}</div>
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
