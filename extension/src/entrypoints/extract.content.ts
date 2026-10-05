import { browser } from 'wxt/browser';
import { ADAPTERS } from '../sites';
import { pickAdapter, runAdapter, saveBlob } from '../core/run';
import { createToast } from '../core/toast';
import { t } from '../core/i18n';
import type { DetectResult, Msg, RunResult } from '../core/messages';
import type { Ctx } from '../core/types';

const GUARD = '__fasInstalled';

/** Runtime-скрипт: внедряется по требованию (activeTab), поэтому расширению не нужен доступ ко всем сайтам. */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const g = globalThis as Record<string, unknown>;
    if (g[GUARD]) return; // повторная инъекция: слушатель уже стоит
    g[GUARD] = true;

    const ctx = (): Ctx => ({ url: new URL(location.href), doc: document, fetch: globalThis.fetch.bind(globalThis) });

    browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
      const msg = raw as Msg;

      if (msg.type === 'fas/detect') {
        const c = ctx();
        const a = pickAdapter(ADAPTERS, c, { generic: msg.generic });
        sendResponse(
          a
            ? ({ id: a.id, name: a.name, kind: a.kind, title: document.title.trim(), host: location.hostname.replace(/^www\./, ''), paged: a.paged, hasComments: a.hasComments } satisfies DetectResult)
            : null,
        );
        return;
      }
      if (msg.type !== 'fas/run') return;

      (async (): Promise<RunResult> => {
        const c = ctx();
        const adapter = pickAdapter(ADAPTERS, c, { generic: msg.generic });
        if (!adapter) return { ok: false, error: t(msg.opts.lang, 'e_unsupported') };
        const toast = createToast({ site: adapter.id === 'generic' ? c.url.hostname.replace(/^www\./, '') : adapter.name, lang: msg.opts.lang, theme: msg.theme });
        let last = 0;
        try {
          const out = await runAdapter(
            adapter,
            c,
            msg.opts,
            p => {
              toast.update(p.done, p.total);
              const now = Date.now();
              if (now - last > 200) {
                last = now;
                browser.runtime.sendMessage({ type: 'fas/progress', progress: p } satisfies Msg).catch(() => {});
              }
            },
            msg.template,
            msg.metaHeader,
          );
          if (msg.action === 'download') saveBlob(out.text, out.filename, msg.opts.format);
          toast.done(out.filename);
          return {
            ok: true,
            site: out.doc.site,
            title: out.doc.title,
            url: out.doc.url,
            filename: out.filename,
            format: msg.opts.format,
            count: out.doc.items.length,
            text: msg.action === 'copy' ? out.text : undefined,
          };
        } catch (e) {
          const error = (e as Error).message ?? String(e);
          toast.fail(error);
          return { ok: false, error };
        }
      })().then(sendResponse);
      return true; // ответ асинхронный
    });
  },
});
