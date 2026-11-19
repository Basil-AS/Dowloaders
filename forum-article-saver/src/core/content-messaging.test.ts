import { describe, expect, it, vi } from 'vitest';
import { createContentMessenger, InjectError, type ContentMessagingApi } from './content-messaging';

function mockedApi() {
  let loaded = false;
  const sendMessage = vi.fn(async (_tabId: number, msg: { type: string }) => {
    if (!loaded) throw new Error('Orion: custom, unrecognised missing-listener error');
    return msg.type === 'fas/ping' ? true : { id: 'habr' };
  });
  const executeScript = vi.fn(async () => { loaded = true; return []; });
  const api = { sendMessage, inject: executeScript } as ContentMessagingApi;
  return { api, sendMessage, executeScript };
}

describe('content messaging', () => {
  it('injects on an arbitrary browser error instead of matching its English message', async () => {
    const { api, executeScript } = mockedApi();
    const m = createContentMessenger(api, '/content-scripts/extract.js');
    expect(await m.send(3, { type: 'fas/detect', fallback: true })).toEqual({ id: 'habr' });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(await m.send(3, { type: 'fas/detect', fallback: true })).toEqual({ id: 'habr' });
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
  it('handles browsers returning undefined when the listener is missing', async () => {
    let ready = false;
    const sendMessage = vi.fn(async (_id: number, msg: { type: string }) => ready ? (msg.type === 'fas/ping' ? true : null) : undefined);
    const executeScript = vi.fn(async () => { ready = true; return []; });
    const m = createContentMessenger({ sendMessage, inject: executeScript }, '/extract.js');
    expect(await m.send(7, { type: 'fas/detect', fallback: true })).toBeNull();
    expect(executeScript).toHaveBeenCalledTimes(1);
  });
  it('does not retry a save message if the browser loses its response', async () => {
    const sendMessage = vi.fn(async (_id: number, msg: { type: string }) => msg.type === 'fas/ping' ? true : undefined);
    const executeScript = vi.fn();
    const m = createContentMessenger({ sendMessage, inject: executeScript }, '/extract.js');
    await expect(m.send(5, { type: 'fas/detect', fallback: true })).rejects.toThrow('No response');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('reports a real injection failure', async () => {
    const sendMessage = vi.fn(async () => { throw new Error('missing'); });
    const executeScript = vi.fn(async () => { throw new Error('Extensions don’t work on the browser’s internal pages.'); });
    const m = createContentMessenger({ sendMessage, inject: executeScript }, '/extract.js');
    await expect(m.send(1, { type: 'fas/detect', fallback: true })).rejects.toBeInstanceOf(InjectError);
  });
});
