// E2E: собранное расширение в настоящем Chromium. Запуск: npm run build && npm run e2e
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, openPopup, optionsUrl, cleanup, SITES } from './harness.mjs';
const results = [];
const check = async (name, fn) => {
  let r;
  try { await fn(); r = ['ok', name]; } catch (e) { r = ['FAIL', `${name}: ${String(e.message).split('\n')[0]}`]; }
  results.push(r);
  if (process.env.DEBUG_E2E) console.log(r[0] === 'ok' ? '  ✓' : '  ✗', r[1]);
};

const saveBtn = pop => pop.getByRole('button', { name: /^(Сохранить как|Save as)/ });
async function runDownload(page, pop) {
  const dl = page.waitForEvent('download', { timeout: 15000 });
  dl.catch(() => {});
  await saveBtn(pop).click();
  const d = await dl;
  await pop.waitForSelector('.status p.ok, .status p.err', { timeout: 15000 });
  return { text: fs.readFileSync(await d.path(), 'utf8'), msg: await pop.textContent('.status p') };
}
const bg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// ───── 1. Тема и язык «как в браузере» ─────
{
  const dark = await launch({ colorScheme: 'dark', locale: 'en-US' });
  const { pop } = await openPopup(dark, SITES.habr.url);
  await check('браузер dark + en-US → popup тёмный и на английском', async () => {
    assert.equal(await bg(pop), 'rgb(19, 24, 25)');
    assert.match(await pop.textContent('.where'), /article/);
    assert.ok(await saveBtn(pop).isVisible());
  });
  const opt = await dark.newPage();
  await opt.goto(optionsUrl);
  await opt.waitForSelector('.opt');
  await check('настройки: явная светлая тема перекрывает тёмную ОС', async () => {
    await opt.getByLabel('Light').check({ force: true });
    await opt.waitForTimeout(300);
    assert.equal(await opt.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await bg(opt), 'rgb(244, 246, 246)');
  });
  await check('popup подхватывает явную тему из настроек', async () => {
    const { pop: p2 } = await openPopup(dark, SITES.habr.url);
    assert.equal(await bg(p2), 'rgb(244, 246, 246)');
  });
  await dark.close();
}

// ───── 2. Основной сценарий (ru, светлая) ─────
const ctx = await launch({ colorScheme: 'light', locale: 'ru-RU' });
const anchor = await ctx.newPage();
await anchor.goto('about:blank');

const opt = await ctx.newPage();
await opt.goto(optionsUrl);
await opt.waitForSelector('.opt');
await check('браузер ru-RU → настройки на русском, светлая тема', async () => {
  assert.match(await opt.textContent('h1'), /Настройки/);
  assert.equal(await bg(opt), 'rgb(244, 246, 246)');
});
await opt.getByLabel('Markdown').check({ force: true });
await opt.waitForTimeout(300);
await check('настройки: превью имени получило .md', async () => assert.ok((await opt.textContent('.preview .mono')).endsWith('.md')));
await opt.reload();
await opt.waitForSelector('.opt');
await check('настройки: значение пережило перезагрузку', async () => assert.equal(await opt.getByLabel('Markdown').isChecked(), true));
await check('настройки: шаблон имени — вставка поля кликом', async () => {
  await opt.getByRole('button', { name: '{id}' }).click();
  await opt.waitForTimeout(200);
  assert.match(await opt.locator('#o-tpl').inputValue(), /\{id\}$/);
  await opt.locator('#o-tpl').fill('{date} - [{site}] - {title}');
  await opt.locator('#o-tpl').blur();
});

for (const [name, s] of Object.entries(SITES)) {
  const { page, pop } = await openPopup(ctx, s.url);
  if (name === 'unsupported') {
    await check('unsupported: пояснение и список сайтов', async () => {
      assert.match(await pop.textContent('.popup'), /нельзя/);
      assert.equal(await pop.locator('.sites li').count(), 5);
    });
    continue;
  }
  const expectAmount = ['discourse', '4pda'].includes(name);
  const expectComments = ['habr', 'reddit'].includes(name);
  await check(`${name}: определён`, async () => assert.ok(await saveBtn(pop).isVisible()));
  await check(`${name}: «Объём» ${expectAmount ? 'есть' : 'скрыт'}, «Комментарии» ${expectComments ? 'есть' : 'скрыты'}`, async () => {
    assert.equal(await pop.locator('input[type=range]').count(), expectAmount ? 1 : 0);
    assert.equal(await pop.locator('input[role=switch]').count(), expectComments ? 1 : 0);
  });
  let out;
  await check(`${name}: скачивание .md`, async () => {
    out = await runDownload(page, pop);
    assert.match(out.text, /^# /);
    assert.match(out.msg, /Сохранено/);
  });
  if (!out) continue;
  if (name === 'article') {
    await check('article (любой сайт): основной текст без меню и подвала', () => {
      assert.match(out.text, /Это длинный абзац/);
      assert.match(out.text, /\[источник\]\(https:\/\/example\.org\/x\)/);
      assert.doesNotMatch(out.text, /Подвал сайта|Главная/);
    });
  }
  if (name === 'discourse') {
    await check('discourse: 45 постов, цитата и код', () => {
      assert.equal((out.text.match(/^\*\*\d+ /gm) || []).length, 45);
      assert.match(out.text, /> user1\n/);
      assert.match(out.text, /```\nls -la\n```/);
      assert.match(out.msg, /45 сообщений/);
    });
    await check('discourse: «последние 20%» → 9 постов', async () => {
      await pop.locator('input[type=range]').fill('20');
      const o2 = await runDownload(page, pop);
      assert.equal((o2.text.match(/^\*\*\d+ /gm) || []).length, 9);
    });
    await check('discourse: JSON валиден', async () => {
      await pop.getByLabel('JSON').check({ force: true });
      const dl = await runDownload(page, pop);
      assert.equal(JSON.parse(dl.text).items.length, 9);
      await pop.getByLabel('Markdown').check({ force: true });
    });
  }
  if (name === 'habr') {
    await check('habr: комментарии выключаются', async () => {
      await pop.locator('input[role=switch]').uncheck({ force: true });
      const o2 = await runDownload(page, pop);
      assert.doesNotMatch(o2.text, /корень/);
      assert.match(o2.text, /текст/);
    });
  }
}

// ───── 3. История и «Все вкладки» ─────
const { pop: hp } = await openPopup(ctx, SITES.habr.url);
await check('история: записи видны в popup', async () => assert.ok((await hp.locator('.recent li').count()) >= 3));
await check('история: очистка', async () => {
  await hp.getByRole('button', { name: 'Очистить', exact: true }).click();
  await hp.waitForTimeout(300);
  assert.equal(await hp.locator('.recent li').count(), 0);
});
for (const k of ['discourse', 'reddit', '4pda']) await (await ctx.newPage()).goto(SITES[k].url);
await check('все вкладки: сохраняет известные площадки', async () => {
  await hp.getByRole('button', { name: 'Сохранить все вкладки' }).click();
  await hp.waitForFunction(() => /Сохранено вкладок: \d+ из \d+/.test(document.querySelector('.status p')?.textContent ?? ''), null, { timeout: 30000 });
  const m = (await hp.textContent('.status p')).match(/(\d+) из (\d+)/);
  assert.ok(Number(m[1]) >= 4 && m[1] === m[2], m[0]);
});

await ctx.close();
cleanup();
for (const [st, n] of results) console.log(st === 'ok' ? '✓' : '✗', n);
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
