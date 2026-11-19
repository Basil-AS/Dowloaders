import type { Msg } from './messages';

/** Ошибка внедрения (права на сайт, служебная страница, сбой WebExtensions API). */
export class InjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InjectError';
  }
}

export interface ContentMessagingApi {
  tabs: { sendMessage(tabId: number, message: Msg): Promise<unknown> };
  scripting: { executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown> };
}

/** Не полагаемся на текст ошибки sendMessage: Chromium, Firefox и Orion формируют его по-разному.
 * Ping не имеет побочных эффектов; саму операцию сохранения никогда не отправляем повторно.
 */
export function createContentMessenger(api: ContentMessagingApi, contentFile: string) {
  const injecting = new Map<number, Promise<void>>();

  const ping = async (tabId: number): Promise<boolean> => {
    try {
      return (await api.tabs.sendMessage(tabId, { type: 'fas/ping' })) === true;
    } catch {
      return false;
    }
  };

  const ensure = async (tabId: number): Promise<void> => {
    if (await ping(tabId)) return;
    const pending = injecting.get(tabId);
    if (pending) return pending;

    const job = (async () => {
      try {
        await api.scripting.executeScript({ target: { tabId }, files: [contentFile] });
      } catch (e) {
        throw new InjectError((e as Error).message ?? String(e));
      }
      if (!(await ping(tabId))) {
        throw new InjectError('Content script did not respond after injection (check extension site permissions)');
      }
    })();
    injecting.set(tabId, job);
    try {
      await job;
    } finally {
      if (injecting.get(tabId) === job) injecting.delete(tabId);
    }
  };

  return {
    async send<T>(tabId: number, msg: Msg): Promise<T> {
      await ensure(tabId);
      const result = await api.tabs.sendMessage(tabId, msg);
      if (result === undefined) throw new Error('No response from content script (browser messaging API)');
      return result as T;
    },
  };
}
