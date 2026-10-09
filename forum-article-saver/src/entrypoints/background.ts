import { browser } from 'wxt/browser';
import { runOnTab } from '../core/pipeline';
import { loadSettings } from '../core/settings';
import { resolveLang, t } from '../core/i18n';
import type { BgFetchResult, Msg } from '../core/messages';

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

  // прогресс из content-скрипта → бейдж иконки
  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as Msg;
    if (msg.type === 'fas/progress' && sender.tab?.id != null && msg.progress.total) {
      void setBadge(sender.tab.id, `${Math.round((msg.progress.done / msg.progress.total) * 100)}%`, '#0b7a6f');
    }
    if (msg.type === 'fas/fetch') {
      void proxyFetch(msg).then(sendResponse);
      return true; // ответ асинхронный
    }
  });
});
