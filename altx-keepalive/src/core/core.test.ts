import { describe, expect, it, vi } from 'vitest';
import { createClockGuard, NOOP_MARK } from './clock';
import { alarmPlan, runCycle, toStatus } from './cycle';
import { pingOnce } from './ping';
import { fmtAgo, fmtCountdown, isLoginPath, normalizeInterval, orderTabs } from './schedule';
import { resolveLang, statusKey, t } from './i18n';
import { sanitize } from './settings';
import type { PingResult } from './types';

describe('schedule', () => {
  it('интервал ограничен 1..25, мусор → 10', () => {
    expect([0, 1, 7.4, 25, 99, 'x', undefined].map(normalizeInterval)).toEqual([1, 1, 7, 25, 25, 10, 10]);
  });
  it('страница входа', () => {
    expect(isLoginPath('https://update.altx-soft.ru/Login.aspx')).toBe(true);
    expect(isLoginPath('https://update.altx-soft.ru/login.aspx')).toBe(true);
    expect(isLoginPath('https://update.altx-soft.ru/default.aspx')).toBe(false);
    expect(isLoginPath('мусор')).toBe(false);
  });
  it('обратный отсчёт и «назад»', () => {
    expect(fmtCountdown(392_000)).toBe('6:32');
    expect(fmtCountdown(9_000)).toBe('0:09');
    expect(fmtCountdown(-5)).toBe('0:00');
    expect(fmtAgo(10_000, 'ru')).toBe('только что');
    expect(fmtAgo(3 * 60_000, 'en')).toMatch(/3/);
  });
  it('активная вкладка первой, затем самая свежая', () => {
    const r = orderTabs([{ active: false, lastAccessed: 5 }, { active: true, lastAccessed: 1 }, { active: false, lastAccessed: 9 }]);
    expect(r.map(x => x.lastAccessed)).toEqual([1, 9, 5]);
  });
});

describe('pingOnce', () => {
  const base = { origin: 'https://update.altx-soft.ru', href: 'https://update.altx-soft.ru/default.aspx', now: () => 1234 };
  const res = (url: string, status = 200) => ({ ok: status < 400, status, url, text: async () => '' }) as unknown as Response;
  it('успех: GET /default.aspx с куками сайта', async () => {
    const f = vi.fn().mockResolvedValue(res('https://update.altx-soft.ru/default.aspx?__altx_keepalive=1234'));
    expect(await pingOnce({ ...base, fetch: f })).toEqual({ kind: 'ok', http: 200 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://update.altx-soft.ru/default.aspx?__altx_keepalive=1234');
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  });
  it('на странице входа запрос не отправляется', async () => {
    const f = vi.fn();
    expect(await pingOnce({ ...base, href: 'https://update.altx-soft.ru/Login.aspx', fetch: f })).toEqual({ kind: 'login' });
    expect(f).not.toHaveBeenCalled();
  });
  it('редирект на вход = сессия завершена; HTTP-ошибка и сбой сети = error', async () => {
    expect(await pingOnce({ ...base, fetch: vi.fn().mockResolvedValue(res('https://update.altx-soft.ru/Login.aspx')) })).toEqual({ kind: 'expired', http: 200 });
    expect(await pingOnce({ ...base, fetch: vi.fn().mockResolvedValue(res('https://update.altx-soft.ru/default.aspx', 503)) })).toEqual({ kind: 'error', error: 'HTTP 503', http: 503 });
    expect(await pingOnce({ ...base, fetch: vi.fn().mockRejectedValue(new Error('offline')) })).toEqual({ kind: 'error', error: 'offline' });
  });
});

describe('createClockGuard', () => {
  const mk = () => {
    const win: any = { timerID: 7, clearTimeout: vi.fn(), startClock: vi.fn(), updateClock: vi.fn() };
    win.updateClock.mockName('updateClock');
    return win;
  };
  it('включение: таймер снят, updateClock заменён; повторные tick ничего не ломают', () => {
    const win = mk();
    const orig = win.updateClock;
    const g = createClockGuard(win);
    g.set(true);
    expect(win.clearTimeout).toHaveBeenCalledWith(7);
    expect(win.timerID).toBeNull();
    expect(win.updateClock).not.toBe(orig);
    expect(win.updateClock[NOOP_MARK]).toBe(true);
    const patched = win.updateClock;
    g.tick();
    g.set(true);
    expect(win.updateClock).toBe(patched);
    win.updateClock(1800); // сайт зовёт свою функцию — она ничего не запускает
    expect(orig).not.toHaveBeenCalled();
  });
  it('сайт объявил функцию позже или заново — подмена повторяется', () => {
    const win = mk();
    const g = createClockGuard(win);
    win.updateClock = undefined;
    g.set(true);
    expect(win.updateClock).toBeUndefined();
    const late = vi.fn();
    win.updateClock = late;
    g.tick();
    expect(win.updateClock[NOOP_MARK]).toBe(true);
  });
  it('выключение: оригинал возвращён, штатный отсчёт на 30 минут запущен', () => {
    const win = mk();
    const orig = win.updateClock;
    const g = createClockGuard(win);
    g.set(true);
    g.set(false);
    expect(win.startClock).toHaveBeenCalled();
    expect(win.updateClock).toBe(orig);
    expect(orig).toHaveBeenCalledWith(1800);
  });
  it('выключенный guard ничего не трогает', () => {
    const win = mk();
    const orig = win.updateClock;
    const g = createClockGuard(win);
    g.tick();
    expect(win.updateClock).toBe(orig);
  });
});

describe('runCycle', () => {
  const ping = (m: Record<number, PingResult | 'throw' | undefined>) => async (id: number) => {
    const r = m[id];
    if (r === 'throw') throw new Error('frozen');
    return r;
  };
  it('берёт первую содержательную вкладку', async () => {
    const s = await runCycle([1, 2], ping({ 1: { kind: 'ok', http: 200 }, 2: { kind: 'error', error: 'x' } }), 'timer', () => 10);
    expect(s).toEqual({ kind: 'ok', at: 10, reason: 'timer', http: 200 });
  });
  it('вкладка на странице входа пропускается, заморожённая — тоже', async () => {
    expect((await runCycle([1, 2, 3], ping({ 1: { kind: 'login' }, 2: 'throw', 3: { kind: 'ok', http: 200 } }), 'manual', () => 1)).kind).toBe('ok');
    expect((await runCycle([1], ping({ 1: { kind: 'login' } }), 'timer', () => 1)).kind).toBe('login');
  });
  it('нет вкладок или никто не ответил → no-tab', async () => {
    expect((await runCycle([], ping({}), 'timer', () => 1)).kind).toBe('no-tab');
    expect((await runCycle([1], ping({ 1: 'throw' }), 'timer', () => 1)).kind).toBe('no-tab');
  });
  it('ошибка попадает в статус вместе с HTTP-кодом', () => {
    expect(toStatus({ kind: 'error', error: 'HTTP 500', http: 500 }, 'startup', 5)).toEqual({ kind: 'error', at: 5, reason: 'startup', http: 500, error: 'HTTP 500' });
  });
  it('расписание: выключено → нет будильника', () => {
    expect(alarmPlan({ enabled: false, intervalMinutes: 10 })).toBeNull();
    expect(alarmPlan({ enabled: true, intervalMinutes: 5 })?.info).toEqual({ delayInMinutes: 5, periodInMinutes: 5 });
  });
});

describe('настройки и локализация', () => {
  it('настройки версии 1.x подхватываются, мусор нормализуется', () => {
    expect(sanitize({ enabled: false, intervalMinutes: 15 })).toEqual({ enabled: false, intervalMinutes: 15, theme: 'system', lang: 'auto' });
    expect(sanitize({ intervalMinutes: 999, theme: 'neon' as never, lang: 'de' as never })).toEqual({ enabled: true, intervalMinutes: 25, theme: 'system', lang: 'auto' });
  });
  it('язык из браузера, подстановки', () => {
    expect(resolveLang('auto', 'ru-RU')).toBe('ru');
    expect(resolveLang('auto', 'de')).toBe('en');
    expect(resolveLang('en', 'ru')).toBe('en');
    expect(t('ru', 'minutes', { n: 10 })).toBe('10 мин');
    expect(t('en', statusKey('ok'))).toBe('Session renewed');
  });
});
