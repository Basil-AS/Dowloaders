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

/** В popup некоторые браузеры возвращают вместо сайта внутреннюю страницу самого расширения.
 * Пробуем последовательно окно popup, последнее активное окно и (только при единственном
 * кандидате) активные вкладки всех окон. Никогда не используем произвольную первую вкладку.
 */
export async function resolveActiveWebTabId(
  query: (filter: { active: true; currentWindow?: boolean; lastFocusedWindow?: boolean }) => Promise<readonly TabCandidate[]>,
): Promise<number | undefined> {
  const read = async (filter: { active: true; currentWindow?: boolean; lastFocusedWindow?: boolean }) => {
    try { return await query(filter); } catch { return []; }
  };
  const current = await read({ active: true, currentWindow: true });
  const direct = current.map(webTabId).find((id): id is number => id !== undefined);
  if (direct !== undefined) return direct;

  const last = await read({ active: true, lastFocusedWindow: true });
  const focused = last.map(webTabId).find((id): id is number => id !== undefined);
  if (focused !== undefined) return focused;

  return uniqueWebTabId(await read({ active: true }));
}
