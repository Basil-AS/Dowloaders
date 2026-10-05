// Скриншоты интерфейса для визуальной проверки: node scripts/shots.mjs <папка>
import fs from 'node:fs';
import { launch, extId, tmp, SITES } from './harness.mjs';

const out = process.argv[2] ?? 'shots';
fs.mkdirSync(out, { recursive: true });
const popupUrl = `chrome-extension://${extId}/popup.html`;

for (const [scheme, locale] of [['light', 'ru-RU'], ['dark', 'ru-RU'], ['light', 'en-US'], ['dark', 'en-US']]) {
  const ctx = await launch({ colorScheme: scheme, locale });
  const tag = `${scheme}-${locale.slice(0, 2)}`;
  for (const name of ['habr', 'discourse', 'unsupported']) {
    const page = await ctx.newPage();
    await page.goto(SITES[name].url);
    const pop = await ctx.newPage({ viewport: { width: 380, height: 640 } });
    await pop.goto(popupUrl);
    const tabId = await pop.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u).id, SITES[name].url);
    await pop.goto(`${popupUrl}?tabId=${tabId}`);
    await pop.waitForSelector('.popup');
    await pop.waitForTimeout(500);
    if (name === 'habr') {
      await pop.getByRole('button').filter({ hasText: /Сохранить как|Save as/ }).click().catch(() => {});
      await pop.waitForSelector('.status p', { timeout: 8000 }).catch(() => {});
      await pop.waitForTimeout(400);
    }
    await pop.locator('.popup').screenshot({ path: `${out}/popup-${name}-${tag}.png` });
  }
  const opt = await ctx.newPage({ viewport: { width: 1000, height: 900 } });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector('.opt');
  await opt.waitForTimeout(300);
  await opt.screenshot({ path: `${out}/options-${tag}.png`, fullPage: true });
  await ctx.close();
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok');
