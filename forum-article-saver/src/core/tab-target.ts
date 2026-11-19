/** Вкладка с обычной веб-страницей, где допускается внедрение content script. */
export interface TabCandidate {
  id?: number;
  url?: string;
  pendingUrl?: string;
}

/** URL может отсутствовать без activeTab/host permission — не подменяем вкладку догадкой. */
export function webTabId(tab: TabCandidate | undefined): number | undefined {
  if (!tab || !Number.isSafeInteger(tab.id) || (tab.id ?? -1) < 0) return undefined;
  const url = tab.url ?? tab.pendingUrl ?? '';
  return /^https?:\/\//i.test(url) ? tab.id : undefined;
}

/** Запасной вариант для браузеров, считающих окно popup отдельным окном.
 * Используется лишь когда среди активных вкладок существует ровно один веб-кандидат.
 */
export function uniqueWebTabId(tabs: readonly TabCandidate[]): number | undefined {
  const ids = [...new Set(tabs.map(webTabId).filter((id): id is number => id !== undefined))];
  return ids.length === 1 ? ids[0] : undefined;
}
