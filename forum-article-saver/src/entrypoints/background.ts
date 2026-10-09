import { browser } from 'wxt/browser';
import { runOnTab } from '../core/pipeline';
import { loadSettings } from '../core/settings';
import { resolveLang, t } from '../core/i18n';
import { HostGate } from '../core/gate';
import type { BgFetchResult, GateReply, Msg, TabPhase } from '../core/messages';

const MENU_ID = 'fas-save';

/** Фон ходит только на эти хосты: хост-права и токен GitHub есть только у него, страница их не видит. */
const GH_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);
const PASS_HEADERS = ['accept', 'content-type', 'x-github-api-version'];
const KEEP_HEADERS = ['link', 'content-type', 'retry-after', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

async function proxyFetch(m: Extract<Msg, { type: 'fas/fetch' }>): Promise<BgFetchResult> {
  let u: URL;
  try {
    u = new URL(m.url);
  } catch {
    return { status: 400, headers: {}, body: 'bad url' };
  }
  if (u.protocol !== 'https:' || !GH_HOSTS.has(u.hostname)) return { status: 400, headers: {}, body: 'host not allowed' };
  // записывающий запрос только один — GraphQL (чтение обсуждений); токен пользователя не должен годиться ни для чего другого
  if (m.method === 'POST' && !(u.hostname === 'api.github.com' && u.pathname === '/graphql')) return { status: 400, headers: {}, body: 'method not allowed' };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.headers ?? {})) if (PASS_HEADERS.includes(k.toLowerCase())) headers[k] = v;
  const { ghToken } = (await browser.storage.local.get('ghToken')) as { ghToken?: string };
  if (ghToken) headers.Authorization = u.hostname === 'api.github.com' ? `Bearer ${ghToken}` : `token ${ghToken}`;
  try {
    const res = await fetch(u.href, { method: m.method === 'POST' ? 'POST' : m.method === 'HEAD' ? 'HEAD' : 'GET', headers, body: m.method === 'POST' ? m.body : undefined, credentials: 'omit', cache: 'no-store' });
    const out: Record<string, string> = {};
    for (const k of KEEP_HEADERS) {
      const v = res.headers.get(k);
      if (v != null) out[k] = v;
    }
    return { status: res.status, headers: out, body: await res.text() };
  } catch (e) {
    return { status: 599, headers: {}, body: (e as Error).message };
  }
}

/** Общие для всех вкладок: очередь запросов и бан по сайту; переживает сон фона через storage.session. */
const gate = new HostGate();
const phases = new Map<number, TabPhase>();
const store = (browser.storage as unknown as { session?: typeof browser.storage.local }).session;
const ready = (async () => {
  try {
    const r = (await store?.get(['fasBans', 'fasPhases'])) as { fasBans?: ReturnType<HostGate['dump']>; fasPhases?: Record<string, TabPhase> } | undefined;
    gate.load(r?.fasBans);
    for (const [k, v] of Object.entries(r?.fasPhases ?? {})) phases.set(Number(k), v);
  } catch {
    /* storage.session недоступен — работаем из памяти */
  }
})();
const persist = () => void store?.set({ fasBans: gate.dump(), fasPhases: Object.fromEntries(phases) }).catch(() => {});

async function setBadge(tabId: number, text: string, color: string, clearAfter = 0) {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color });
    await browser.action.setBadgeText({ tabId, text });
    if (clearAfter) setTimeout(() => browser.action.setBadgeText({ tabId, text: '' }).catch(() => {}), clearAfter);
  } catch {
    /* вкладка закрыта */
  }
}

async function saveTab(tabId: number | undefined) {
  if (tabId == null) return;
  await setBadge(tabId, '…', '#0b7a6f');
  const res = await runOnTab(tabId, 'download');
  await setBadge(tabId, res.ok ? '✓' : '!', res.ok ? '#2f7d32' : '#b3261e', 4000);
}

export default defineBackground(() => {
  const createMenu = async () => {
    const s = await loadSettings();
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({ id: MENU_ID, title: t(resolveLang(s.lang), 'menu'), contexts: ['page', 'action'] });
  };
  browser.runtime.onInstalled.addListener(createMenu);
  browser.runtime.onStartup.addListener(createMenu);

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) void saveTab(tab?.id);
  });

  browser.commands.onCommand.addListener(async cmd => {
    if (cmd !== 'save-page') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    void saveTab(tab?.id);
  });

  const drop = (id: number) => {
    if (phases.delete(id)) persist();
  };
  browser.tabs.onRemoved.addListener(drop);
  browser.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'loading') drop(id); // страница загружается заново — content-скрипт и его кэш пропали
  });

  // прогресс из content-скрипта → бейдж иконки
  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as Msg;
    if (msg.type === 'fas/progress' && sender.tab?.id != null && msg.progress.total) {
      void setBadge(sender.tab.id, `${Math.round((msg.progress.done / msg.progress.total) * 100)}%`, '#0b7a6f');
    }
    if (msg.type === 'fas/gate') {
      void ready.then(() => {
        if (msg.clear) gate.clear(msg.host);
        const ban = gate.banned(msg.host);
        persist();
        sendResponse({ waitMs: ban ? 0 : gate.slot(msg.host), ban } satisfies GateReply);
      });
      return true;
    }
    if (msg.type === 'fas/ban') {
      void ready.then(() => {
        gate.ban(msg.host, msg.status, msg.retryAfterMs);
        persist();
        sendResponse(true);
      });
      return true;
    }
    if (msg.type === 'fas/phase' && sender.tab?.id != null) {
      if (msg.phase.kind === 'done') phases.delete(sender.tab.id);
      else phases.set(sender.tab.id, msg.phase);
      persist();
    }
    if (msg.type === 'fas/state') {
      void ready.then(() => sendResponse(phases.get(msg.tabId) ?? null));
      return true;
    }
    if (msg.type === 'fas/fetch') {
      void proxyFetch(msg).then(sendResponse);
      return true; // ответ асинхронный
    }
  });
});
