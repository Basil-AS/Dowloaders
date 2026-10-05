// Иконки расширения из одного SVG: node scripts/icons.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="26" fill="#2557c7"/>
  <path d="M95 52a34 34 0 0 0-60-9" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
  <path d="M32 24v22h22" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M33 76a34 34 0 0 0 60 9" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
  <path d="M96 104V82H74" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="64" cy="64" r="8" fill="#9fc0ff"/>
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
