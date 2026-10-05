// Рисует иконки расширения из одного SVG: node scripts/icons.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="26" fill="#0b7a6f"/>
  <path d="M38 22h36l18 18v58a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" fill="#f4faf9"/>
  <path d="M74 22v14a4 4 0 0 0 4 4h14z" fill="#9fd3cb"/>
  <path d="M62 52v30M48 70l14 14 14-14" fill="none" stroke="#0b7a6f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M46 98h32" stroke="#0b7a6f" stroke-width="7" stroke-linecap="round"/>
</svg>`;
fs.writeFileSync('public/icons/icon.svg', svg);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await b.newPage({ deviceScaleFactor: 1 });
for (const n of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: n, height: n });
  await page.setContent(`<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${n}" height="${n}"></body>`);
  await page.screenshot({ path: `public/icons/${n}.png`, omitBackground: true });
}
await b.close();
