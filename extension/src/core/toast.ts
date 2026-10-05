/** Небольшая плашка прогресса на странице (Shadow DOM — стили сайта не влияют). */
export interface Toast {
  update(done: number, total: number, text?: string): void;
  done(text: string): void;
  fail(text: string): void;
  close(): void;
}

const CSS = `
:host{all:initial}
.box{position:fixed;right:20px;bottom:20px;z-index:2147483647;min-width:260px;max-width:360px;padding:14px 18px;border-radius:12px;
 background:#1e1e2e;color:#cdd6f4;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.t{margin-bottom:8px;font-weight:600}.bar{height:6px;background:#313244;border-radius:3px;overflow:hidden}
.f{height:100%;width:0;background:linear-gradient(90deg,#cba6f7,#f5c2e7);transition:width .25s}
.s{margin-top:6px;font-size:12px;color:#a6adc8;word-break:break-word}.err .t{color:#f38ba8}
`;

export function createToast(title: string, doc: Document = document): Toast {
  doc.getElementById('fas-toast')?.remove();
  const host = doc.createElement('div');
  host.id = 'fas-toast';
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const mk = (cls: string, parent: Element) => {
    const e = doc.createElement('div');
    e.className = cls;
    parent.appendChild(e);
    return e;
  };
  const box = mk('box', root as unknown as Element);
  root.insertBefore(style, box);
  mk('t', box);
  mk('f', mk('bar', box));
  mk('s', box);
  (doc.body ?? doc.documentElement).appendChild(host);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const set = (t?: string, pct?: number, s?: string) => {
    if (t != null) $('.t').textContent = t;
    if (pct != null) $('.f').style.width = pct + '%';
    if (s != null) $('.s').textContent = s;
  };
  set('📥 ' + title, 0, '…');
  const close = () => host.remove();
  return {
    update: (done, total, text) => set(undefined, total ? Math.round((done / total) * 100) : 0, text ?? `${done} / ${total}`),
    done: text => {
      set('✅', 100, text);
      setTimeout(close, 5000);
    },
    fail: text => {
      $('.box').classList.add('err');
      set('❌', undefined, text);
      setTimeout(close, 8000);
    },
    close,
  };
}
