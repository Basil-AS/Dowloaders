import { ALARM, type PingResult, type Reason, type Settings, type Status } from './types';

/** Результат запроса вкладки → запись состояния. */
export const toStatus = (r: PingResult, reason: Reason, now: number): Status => ({
  kind: r.kind,
  at: now,
  reason,
  ...('http' in r && r.http != null ? { http: r.http } : {}),
  ...(r.kind === 'error' ? { error: r.error } : {}),
});

/**
 * Один цикл: перебираем вкладки сайта (активная первой) и берём первый содержательный ответ.
 * ok/expired/error — итог; login — запоминаем и пробуем другие вкладки; если нет вкладок или ни одна не ответила — no-tab.
 */
export async function runCycle(
  tabs: number[],
  ping: (tabId: number) => Promise<PingResult | undefined>,
  reason: Reason,
  now: () => number = Date.now,
): Promise<Status> {
  let sawLogin = false;
  for (const id of tabs) {
    let r: PingResult | undefined;
    try {
      r = await ping(id);
    } catch {
      continue; // вкладка заморожена, выгружена или ещё не загрузила скрипт
    }
    if (!r) continue;
    if (r.kind === 'login') {
      sawLogin = true;
      continue;
    }
    return toStatus(r, reason, now());
  }
  return { kind: sawLogin ? 'login' : 'no-tab', at: now(), reason };
}

/** Что менять в расписании при смене настроек. */
export const alarmPlan = (s: Pick<Settings, 'enabled' | 'intervalMinutes'>) =>
  s.enabled ? ({ name: ALARM, info: { delayInMinutes: s.intervalMinutes, periodInMinutes: s.intervalMinutes } } as const) : null;
