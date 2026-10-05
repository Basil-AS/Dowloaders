import { browser } from 'wxt/browser';
import { CLOCK_ATTR } from '../core/clock';
import { pingOnce } from '../core/ping';
import { loadSettings } from '../core/settings';
import type { TabMsg } from '../core/types';

/** Изолированный скрипт вкладки: передаёт странице «включено/выключено» и выполняет запрос продления от имени вкладки. */
export default defineContentScript({
  matches: ['https://update.altx-soft.ru/*'],
  runAt: 'document_start',
  async main() {
    const publish = (enabled: boolean) => document.documentElement?.setAttribute(CLOCK_ATTR, enabled ? '1' : '0');

    // Слушатель сообщений ставим первым и синхронно: ранний запрос не должен потеряться, пока читаются настройки.
    browser.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
      if ((raw as TabMsg)?.type !== 'ping') return;
      void pingOnce({ origin: location.origin, href: location.href, fetch: globalThis.fetch.bind(globalThis) }).then(sendResponse);
      return true; // ответ асинхронный
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.enabled) publish(changes.enabled.newValue !== false);
    });

    try {
      publish((await loadSettings()).enabled);
    } catch {
      publish(true); // настройки по умолчанию: включено
    }
  },
});
