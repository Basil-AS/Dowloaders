/**
 * Отключает клиентский 30-минутный таймер простоя на странице сайта (`updateClock`) и возвращает его при выключении.
 * Работает с переданным window, поэтому проверяется без браузера. Сайт объявляет функцию inline-скриптом уже после
 * document_start, потому `tick()` нужно звать повторно: он ничего не делает, пока подмена актуальна.
 */
export const NOOP_MARK = Symbol.for('altx-keepalive.noop');

type Win = Window & { timerID?: unknown; updateClock?: ((...a: unknown[]) => unknown) & { [NOOP_MARK]?: true }; startClock?: () => unknown };

export function createClockGuard(win: Win) {
  let enabled = false;
  let original: Win['updateClock'] = undefined;
  let patched: Win['updateClock'] = undefined;

  const clearTimer = () => {
    try {
      if (win.timerID != null) win.clearTimeout(win.timerID as number);
      win.timerID = null;
    } catch {
      /* таймер ещё не создан */
    }
  };

  const patch = () => {
    clearTimer();
    if (typeof win.updateClock !== 'function' || win.updateClock[NOOP_MARK]) return;
    original = win.updateClock;
    const noop = function altxKeepAliveDisabledClock() {
      clearTimer();
    } as NonNullable<Win['updateClock']>;
    Object.defineProperty(noop, NOOP_MARK, { value: true });
    patched = noop;
    win.updateClock = noop;
  };

  const restore = () => {
    clearTimer();
    if (original && win.updateClock === patched) win.updateClock = original;
    original = patched = undefined;
    try {
      // сразу запускаем штатный 30-минутный отсчёт сайта
      win.startClock?.();
      win.updateClock?.(30 * 60);
    } catch {
      /* на странице без таймера восстанавливать нечего */
    }
  };

  return {
    get enabled() {
      return enabled;
    },
    set(next: boolean) {
      if (next === enabled) return next ? patch() : undefined;
      enabled = next;
      if (enabled) patch();
      else restore();
    },
    tick() {
      if (enabled) patch();
    },
  };
}

export const CLOCK_ATTR = 'data-altx-keepalive-enabled';
