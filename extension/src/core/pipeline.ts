import { browser } from 'wxt/browser';
import { runPool } from './http';
import { CONTENT_FILE, type Action, type DetectResult, type Msg, type RunResult } from './messages';
import { history, loadSettings, toExtractOptions } from './settings';
import type { ExtractOptions, Settings } from './types';

/** Страницу нельзя обработать: служебная, закрытая политикой или нет прав (activeTab не выдан). */
class InjectError extends Error {}

const NO_RECEIVER = /receiving end|establish connection|no (matching )?(receiver|listener)/i;

/** Шлёт сообщение content-скрипту; внедряет его, только если слушателя ещё нет. Любая другая ошибка пробрасывается как есть. */
async function send<T>(tabId: number, msg: Msg): Promise<T> {
  try {
    return (await browser.tabs.sendMessage(tabId, msg)) as T;
  } catch (e) {
    if (!NO_RECEIVER.test((e as Error).message ?? '')) throw e;
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
    } catch (inj) {
      throw new InjectError((inj as Error).message);
    }
    return (await browser.tabs.sendMessage(tabId, msg)) as T;
  }
}

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
  const tabs = (await browser.tabs.query({ currentWindow: true })).filter(t => t.id != null && /^https?:/.test(t.url ?? ''));
  const results = await runPool(tabs, concurrency, tab => runOnTab(tab.id!, 'download', settings, {}, false));
  const supported = results.filter(r => !r.unsupported);
  return { ok: supported.filter(r => r.ok).length, total: supported.length };
}
