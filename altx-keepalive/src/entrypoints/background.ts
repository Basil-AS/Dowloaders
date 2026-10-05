import { browser } from 'wxt/browser';
import { alarmPlan, runCycle } from '../core/cycle';
import { orderTabs } from '../core/schedule';
import { LOG_LIMIT, loadSettings, loadState } from '../core/settings';
import { ALARM, SITE_PATTERN, type PingResult, type Reason, type Status, type TabMsg } from '../core/types';

export type BgMsg = { type: 'run-now' };

/** Если успешный запрос был совсем недавно, при открытии вкладки новый не нужен. */
const RECENT_MS = 2 * 60_000;

async function setBadge(kind: Status['kind']) {
  const bad = kind === 'error' || kind === 'expired';
  const warn = kind === 'login' || kind === 'no-tab';
  try {
    await browser.action.setBadgeText({ text: bad || warn ? '!' : '' });
    if (bad || warn) await browser.action.setBadgeBackgroundColor({ color: bad ? '#b3261e' : '#a15c00' });
  } catch {
    /* окно закрыто */
  }
}

async function record(status: Status) {
  const { log } = await loadState();
  const keep = status.kind === 'none' ? log : [status, ...log].slice(0, LOG_LIMIT);
  await browser.storage.local.set({ status, log: keep });
  await setBadge(status.kind);
}

async function cycle(reason: Reason): Promise<Status> {
  // «startup» (вкладка сайта открылась) — тихая проверка: без записи в журнал и значка, если запрос не нужен или ничего не вышло
  const quiet = reason === 'startup';
  if (quiet) {
    const { status } = await loadState();
    if (status?.kind === 'ok' && Date.now() - status.at < RECENT_MS) return status;
  }
  const s = await loadSettings();
  if (!s.enabled) {
    const status: Status = { kind: 'disabled', at: Date.now(), reason };
    await browser.storage.local.set({ status });
    await setBadge('disabled');
    return status;
  }
  const tabs = orderTabs(await browser.tabs.query({ url: SITE_PATTERN })).flatMap(t => (t.id != null ? [t.id] : []));
  const status = await runCycle(tabs, id => browser.tabs.sendMessage(id, { type: 'ping' } satisfies TabMsg) as Promise<PingResult | undefined>, reason);
  if (!(quiet && (status.kind === 'login' || status.kind === 'no-tab'))) await record(status);
  return status;
}

/** Время следующего запроса пишем в storage: popup получает его тем же событием, что и остальное состояние, без гонки с будильником. */
async function publishNext() {
  const at = (await browser.alarms.get(ALARM))?.scheduledTime;
  if (at) await browser.storage.local.set({ nextAt: at });
  else await browser.storage.local.remove('nextAt');
}

async function reschedule() {
  await browser.alarms.clear(ALARM);
  const plan = alarmPlan(await loadSettings());
  if (plan) await browser.alarms.create(plan.name, plan.info);
  await publishNext();
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void reschedule());
  browser.runtime.onStartup.addListener(() => void reschedule());

  browser.alarms.onAlarm.addListener(a => {
    if (a.name === ALARM) void cycle('timer').then(publishNext);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.enabled || changes.intervalMinutes)) return;
    void reschedule().then(() => (changes.enabled ? cycle('manual') : undefined));
  });

  browser.runtime.onMessage.addListener((raw: unknown) => ((raw as BgMsg)?.type === 'run-now' ? cycle('manual') : undefined));

  // Страница сайта открылась (или перезагрузилась): если последний успешный запрос не свежий, продлеваем сразу.
  const opened = new Set<number>();
  browser.tabs.onUpdated.addListener((id, info, tab) => {
    if (info.status !== 'complete' || !tab.url?.startsWith('https://update.altx-soft.ru/') || opened.has(id)) return;
    opened.add(id);
    setTimeout(() => opened.delete(id), 30_000);
    setTimeout(() => void cycle('startup'), 3000);
  });
});
