import { storage } from 'wxt/utils/storage';
import type { HistoryEntry, Settings } from './types';
import { DEFAULT_SETTINGS, MAX_HISTORY, sanitizeSettings } from './settings-model';

export { DEFAULT_SETTINGS, MAX_HISTORY, sanitizeSettings, toExtractOptions } from './settings-model';

const settingsItem = storage.defineItem<Settings>('sync:settings', { fallback: DEFAULT_SETTINGS });
const historyItem = storage.defineItem<HistoryEntry[]>('local:history', { fallback: [] });

export async function loadSettings(): Promise<Settings> {
  return sanitizeSettings(await settingsItem.getValue());
}
export async function saveSettings(s: Settings): Promise<void> {
  await settingsItem.setValue(sanitizeSettings(s));
}
export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch(v => cb(sanitizeSettings(v)));
}

/** Запись истории — «прочитать, изменить, записать»; очередь не даёт параллельным сохранениям затереть друг друга. */
let writeQueue: Promise<unknown> = Promise.resolve();

export const history = {
  list: () => historyItem.getValue(),
  add(e: HistoryEntry): Promise<void> {
    const job = writeQueue.then(async () => {
      const list = (await historyItem.getValue()).filter(x => !(x.url === e.url && x.format === e.format));
      await historyItem.setValue([e, ...list].slice(0, MAX_HISTORY));
    });
    writeQueue = job.catch(() => {});
    return job;
  },
  clear: () => historyItem.setValue([]),
  watch: (cb: (v: HistoryEntry[]) => void) => historyItem.watch(cb),
};
