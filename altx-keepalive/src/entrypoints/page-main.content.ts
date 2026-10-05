import { CLOCK_ATTR, createClockGuard } from '../core/clock';

/** Работает в мире страницы (MAIN): только здесь видна функция `updateClock` самого сайта. Команды приходят через атрибут <html>. */
export default defineContentScript({
  matches: ['https://update.altx-soft.ru/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const guard = createClockGuard(window as never);
    const read = () => document.documentElement?.getAttribute(CLOCK_ATTR) === '1';
    const sync = () => {
      guard.set(read());
      guard.tick();
    };

    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: [CLOCK_ATTR] });
    for (const ev of ['readystatechange', 'DOMContentLoaded', 'load'] as const) (ev === 'readystatechange' ? document : window).addEventListener(ev, sync, true);
    sync();

    // Функцию объявляет inline-скрипт уже после document_start (и может объявить заново), поэтому короткий опрос, затем редкий.
    let fast = 0;
    const id = window.setInterval(() => {
      sync();
      if (++fast === 50) {
        clearInterval(id);
        window.setInterval(sync, 2000);
      }
    }, 100);
  },
});
