import { browser } from 'wxt/browser';
import { runPool } from './http';
import { createContentMessenger, InjectError } from './content-messaging';
import { CONTENT_FILE, type Action, type DetectResult, type Msg, type RunResult } from './messages';
import { history, loadSettings, toExtractOptions } from './settings';
import type { ExtractOptions, Settings } from './types';
import { resolveActiveWebTabId } from './tab-target';

/** Ping-проверка и внедрение без зависимости от текстов ошибок браузера. */
const send = createContentMessenger({
  sendMessage: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
  inject: tabId => browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] }),
}, CONTENT_FILE).send;

export const detect = (tabId: number, fallback = true) => send<DetectResult | null>(tabId, { type: 'fas/detect', fallback });

export async function runOnTab(tabId: number, action: Action, settings?: Settings, over: Partial<ExtractOptions> = {}, fallback?: boolean): Promise<RunResult> {
  const s = settings ?? (await loadSettings());
  try {
    const res = await send<RunResult>(tabId, {
      type: 'fas/run',
      action,
      opts: toExtractOptions(s, over),
      template: s.filenameTemplate,
      metaHeader: s.metaHeader,
      fallback: fallback ?? s.generic,
      theme: s.theme,
    });
    if (res.ok && s.history && res.filename) {
      await history.add({
        ts: Date.now(),
        title: res.title ?? '',
        url: res.url ?? '',
        site: res.site ?? '',
        filename: res.filename,
        count: res.count ?? 0,
        format: res.format ?? s.format,
      });
    }
    return res;
  } catch (e) {
    return { ok: false, unsupported: e instanceof InjectError, error: (e as Error).message ?? String(e) };
  }
}

/** Все вкладки окна с известными площадками (универсальный разбор статей не используется). */
export async function saveAllTabs(settings: Settings, concurrency = 2): Promise<{ ok: number; total: number }> {
  // Orion может считать popup отдельным окном: ищем последнее окно браузера.
  const currentTabs = await browser.tabs.query({ currentWindow: true });
  const activeId = await resolveActiveWebTabId(filter => browser.tabs.query(filter));
  const active = currentTabs.find(t => t.id === activeId);
  const tabsInWindow = active ? currentTabs : await browser.tabs.query({ lastFocusedWindow: true });
  const tabs = tabsInWindow.filter(t => t.id != null && /^https?:/.test(t.url ?? ''));
  const results = await runPool(tabs, concurrency, tab => runOnTab(tab.id!, 'download', settings, {}, false));
  const supported = results.filter(r => !r.unsupported);
  return { ok: supported.filter(r => r.ok).length, total: supported.length };
}
