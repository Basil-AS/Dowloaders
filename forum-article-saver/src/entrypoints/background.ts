import { browser } from 'wxt/browser';
import { runOnTab } from '../core/pipeline';
import { loadSettings } from '../core/settings';
import { resolveLang, t } from '../core/i18n';
import type { Msg } from '../core/messages';

const MENU_ID = 'fas-save';

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
  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    const msg = raw as Msg;
    if (msg.type === 'fas/progress' && sender.tab?.id != null && msg.progress.total) {
      void setBadge(sender.tab.id, `${Math.round((msg.progress.done / msg.progress.total) * 100)}%`, '#0b7a6f');
    }
  });
});
