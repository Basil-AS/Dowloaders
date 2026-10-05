import { browser } from 'wxt/browser';
import { ADAPTERS } from '../sites';
import { hostLabel, pickAdapter, runAdapter, saveBlob } from '../core/run';
import { createToast } from '../core/toast';
import { t } from '../core/i18n';
import type { DetectResult, Msg, RunResult } from '../core/messages';
import type { Ctx, SiteAdapter } from '../core/types';

const HANDLER = '__fasHandler';
const label = (a: SiteAdapter, c: Ctx) => (a.fallback ? hostLabel(c.url) : a.name);

/** Runtime-скрипт: внедряется по требованию (activeTab), поэтому расширению не нужен доступ ко всем сайтам. */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    // Повторная инъекция (в том числе после обновления расширения) заменяет прежний слушатель, а не дублирует его.
    const g = globalThis as unknown as Record<string, ((...a: never[]) => unknown) | undefined>;
    if (g[HANDLER]) browser.runtime.onMessage.removeListener(g[HANDLER] as never);

    const ctx = (): Ctx => ({ url: new URL(location.href), doc: document, fetch: globalThis.fetch.bind(globalThis) });

    const onMessage = (raw: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      const msg = raw as Msg;

      if (msg.type === 'fas/detect') {
        const c = ctx();
        const a = pickAdapter(ADAPTERS, c, { fallback: msg.fallback });
        sendResponse(a ? ({ id: a.id, label: label(a, c), kind: a.kind, title: document.title.trim(), paged: a.paged, hasComments: a.hasComments } satisfies DetectResult) : null);
        return;
      }
      if (msg.type !== 'fas/run') return;

      (async (): Promise<RunResult> => {
        const c = ctx();
        const adapter = pickAdapter(ADAPTERS, c, { fallback: msg.fallback });
        if (!adapter) return { ok: false, unsupported: true, error: t(msg.opts.lang, 'e_unsupported') };
        const toast = createToast({ site: label(adapter, c), lang: msg.opts.lang, theme: msg.theme });
        let last = 0;
        try {
          const out = await runAdapter(
            adapter,
            c,
            msg.opts,
            p => {
              const now = Date.now();
              if (now - last < 200 && p.done < p.total) return; // не чаще 5 раз в секунду
              last = now;
              toast.update(p.done, p.total);
              browser.runtime.sendMessage({ type: 'fas/progress', progress: p } satisfies Msg).catch(() => {});
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
    };
    g[HANDLER] = onMessage as never;
    browser.runtime.onMessage.addListener(onMessage as never);
  },
});
