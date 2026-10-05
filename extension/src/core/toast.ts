import type { Lang, Theme } from './types';
import { t } from './i18n';

/** Плашка прогресса на странице. Shadow DOM: стили сайта на неё не влияют, её стили — на сайт. */
export interface Toast {
  update(done: number, total: number): void;
  done(name: string): void;
  fail(message: string): void;
  close(): void;
}

const CSS = `
:host{all:initial}
.box{--bg:#ffffff;--fg:#182022;--mute:#5d6b6e;--line:#d5dddf;--accent:#0b7a6f;--track:#e4eaeb;--bad:#b3261e;
 position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;padding:12px 14px;border-radius:6px;
 background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:0 2px 12px rgba(0,0,0,.14);
 font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:host([data-theme="dark"]) .box{--bg:#1b2123;--fg:#e4eaeb;--mute:#97a6a9;--line:#323c3f;--accent:#4cc2b3;--track:#2a3335;--bad:#f2a49e}
@media (prefers-color-scheme:dark){:host(:not([data-theme="light"])) .box{--bg:#1b2123;--fg:#e4eaeb;--mute:#97a6a9;--line:#323c3f;--accent:#4cc2b3;--track:#2a3335;--bad:#f2a49e}}
.t{font-weight:600}.s{margin-top:2px;color:var(--mute);overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.bar{margin-top:10px;height:3px;border-radius:2px;background:var(--track);overflow:hidden}
.f{height:100%;width:0;background:var(--accent);transition:width .2s}
.err .t{color:var(--bad)}.err .bar{display:none}
@media (prefers-reduced-motion:reduce){.f{transition:none}}
`;

export function createToast(opts: { site: string; lang: Lang; theme: Theme }, doc: Document = document): Toast {
  doc.getElementById('fas-toast')?.remove();
  const host = doc.createElement('div');
  host.id = 'fas-toast';
  if (opts.theme !== 'system') host.setAttribute('data-theme', opts.theme);
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const mk = (cls: string, parent: Node, tag = 'div') => {
    const e = doc.createElement(tag);
    e.className = cls;
    parent.appendChild(e);
    return e;
  };
  root.appendChild(style);
  const box = mk('box', root);
  box.setAttribute('role', 'status');
  const title = mk('t', box);
  const sub = mk('s', box);
  const fill = mk('f', mk('bar', box));
  (doc.body ?? doc.documentElement).appendChild(host);

  title.textContent = t(opts.lang, 'p_savingSite', { site: opts.site });
  const close = () => host.remove();
  return {
    update: (done, total) => {
      sub.textContent = t(opts.lang, 'p_progress', { done, total });
      fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    },
    done: name => {
      title.textContent = t(opts.lang, 'p_saved');
      sub.textContent = name;
      fill.style.width = '100%';
      setTimeout(close, 4500);
    },
    fail: message => {
      box.classList.add('err');
      title.textContent = t(opts.lang, 'p_failedTitle');
      sub.textContent = message;
      setTimeout(close, 8000);
    },
    close,
  };
}
