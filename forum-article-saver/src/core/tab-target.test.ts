import { describe, expect, it } from 'vitest';
import { uniqueWebTabId, webTabId } from './tab-target';

describe('active web tab selection', () => {
  it('accepts regular HTTPS/HTTP tabs, including a pending URL', () => {
    expect(webTabId({ id: 42, url: 'https://habr.com/ru/articles/123/' })).toBe(42);
    expect(webTabId({ id: 7, pendingUrl: 'http://localhost:3000/' })).toBe(7);
  });
  it('rejects internal pages and extension popups before injecting', () => {
    for (const url of ['about:blank', 'orion://settings', 'chrome://extensions', 'chrome-extension://abc/popup.html', 'moz-extension://abc/popup.html', 'file:///tmp/a.html']) {
      expect(webTabId({ id: 1, url })).toBeUndefined();
    }
    expect(webTabId({ id: 1 })).toBeUndefined();
    expect(webTabId({ id: -1, url: 'https://example.com' })).toBeUndefined();
  });
  it('uses a cross-window fallback only if the web candidate is unambiguous', () => {
    expect(uniqueWebTabId([{ id: 1, url: 'chrome-extension://id/popup.html' }, { id: 2, url: 'https://4pda.to' }])).toBe(2);
    expect(uniqueWebTabId([{ id: 2, url: 'https://4pda.to' }, { id: 3, url: 'https://habr.com' }])).toBeUndefined();
    expect(uniqueWebTabId([])).toBeUndefined();
  });
});
