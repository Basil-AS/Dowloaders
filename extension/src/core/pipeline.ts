import { browser } from 'wxt/browser';
import { CONTENT_FILE, type Action, type DetectResult, type Msg, type RunResult } from './messages';
import { history, loadSettings, toExtractOptions } from './settings';
import type { ExtractOptions, Settings } from './types';

/** Внедряет content-скрипт (activeTab / host-права) и возвращает результат определения площадки. */
export async function detect(tabId: number, generic = true): Promise<DetectResult | null> {
  await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  return (await browser.tabs.sendMessage(tabId, { type: 'fas/detect', generic } satisfies Msg)) as DetectResult | null;
}

export async function runOnTab(
  tabId: number,
  action: Action,
  settings?: Settings,
  over: Partial<ExtractOptions> = {},
): Promise<RunResult> {
  const s = settings ?? (await loadSettings());
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
    const res = (await browser.tabs.sendMessage(tabId, {
      type: 'fas/run',
      action,
      opts: toExtractOptions(s, over),
      template: s.filenameTemplate,
      metaHeader: s.metaHeader,
      generic: s.generic,
      theme: s.theme,
    } satisfies Msg)) as RunResult;
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
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
}
