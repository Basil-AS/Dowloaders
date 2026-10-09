// E2E для GitHub и ограничений 4PDA: настоящий браузер, настоящий фон расширения, локальный HTTPS-сервер вместо сайтов.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanup, launchLocal, openPopup, optionsUrl } from './harness.mjs';

const results = [];
const check = async (name, fn) => {
  let r;
  try { await fn(); r = ['ok', name]; } catch (e) { r = ['FAIL', `${name}: ${String(e.message).split('\n')[0]}`]; }
  results.push(r);
  if (process.env.DEBUG_E2E) console.log(r[0] === 'ok' ? '  ✓' : '  ✗', r[1]);
};
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const { ctx, mock, close } = await launchLocal();
const st = mock.st;
const GH = 'https://github.com';

const saveBtn = pop => pop.getByRole('button', { name: /^(Сохранить как|Save as)/ });
/** Нажимает «Сохранить», ждёт файл и итог в popup. */
async function download(page, pop) {
  const dl = page.waitForEvent('download', { timeout: 20000 });
  dl.catch(() => {});
  await saveBtn(pop).click();
  const d = await dl;
  await pop.waitForSelector('.status p.ok, .status p.err', { timeout: 20000 });
  return { text: fs.readFileSync(await d.path(), 'utf8'), msg: (await pop.textContent('.status p')).trim() };
}
const statusWarn = pop => pop.waitForSelector('.status p.warn', { timeout: 40000 });
const resetCounters = () => { st.rawCalls.length = 0; st.apiCalls.length = 0; st.pdaCalls.length = 0; };

// ───── 1. настройки: формат txt, без токена ─────
const opt = await ctx.newPage();
await opt.goto(optionsUrl);
await opt.waitForSelector('.opt');
await opt.locator('#o-tpl').fill('{title}');
await opt.locator('#o-tpl').blur();

// ───── 2. дайджест репозитория (как gitingest) ─────
{
  const { page, pop } = await openPopup(ctx, `${GH}/o/r`);
  await check('репозиторий: определён, режим «Репозиторий целиком», подсказка про маски', async () => {
    assert.match(await pop.textContent('.where'), /GitHub.*репозиторий целиком/);
    assert.equal(await pop.locator('#mode option').count(), 4);
    assert.match(await pop.textContent('.popup'), /Маски и лимит размера/);
  });
  if (shots) await pop.screenshot({ path: `${shots}/gh-repo.png`, fullPage: true });
  let out;
  await check('дайджест: структура + файлы, мусор отфильтрован, токены оценены', async () => {
    out = await download(page, pop);
    assert.match(out.text, /^o\/r\nhttps:\/\/github\.com\/o\/r\nВетка: main \(abc1234\) \| Файлов: 4 \| Токенов \(оценка\): ~\d+\n\nr\/\n  docs\/\n    guide\.md\n  src\/\n    a\.ts\n    b\.ts\n  README\.md\n\n### README\.md\n# Демо/);
    assert.doesNotMatch(out.text, /node_modules|yarn\.lock|logo\.png|app\.min/);
    assert.match(out.msg, /Сохранено · 4 файла/);
  });
  await check('без токена заголовок Authorization не отправляется', async () => {
    assert.equal(st.auth.api.length + st.auth.raw.length, 0);
    assert.equal(st.rawCalls.length, 4);
  });
  await check('формат Markdown: блоки кода с языком', async () => {
    await pop.getByLabel('Markdown').check({ force: true });
    const md = await download(page, pop);
    assert.match(md.text, /## src\/a\.ts\n```ts\nexport const a = 1;\n```/);
    await pop.getByLabel('TXT').check({ force: true });
  });
}

// ───── 3. токен: уходит только на api.github.com и raw, только из фона ─────
await check('токен в настройках: Authorization на api.github.com (Bearer) и raw (token)', async () => {
  await opt.reload();
  await opt.waitForSelector('#o-ghtoken');
  await opt.locator('#o-ghtoken').fill('ghp_test123');
  await opt.locator('#o-ghtoken').blur();
  await opt.waitForTimeout(300);
  resetCounters(); st.auth.api.length = 0; st.auth.raw.length = 0;
  const { page, pop } = await openPopup(ctx, `${GH}/o/r`);
  await download(page, pop);
  assert.ok(st.auth.api.length >= 3 && st.auth.api.every(a => a === 'Bearer ghp_test123'), st.auth.api.join());
  assert.ok(st.auth.raw.length === 4 && st.auth.raw.every(a => a === 'token ghp_test123'));
});

// ───── 4. issue, список issues, обсуждения ─────
{
  const { page, pop } = await openPopup(ctx, `${GH}/o/r/issues/5`);
  await check('issue: режим «Эта страница», описание и комментарии', async () => {
    assert.match(await pop.textContent('.where'), /GitHub.*эта страница/);
    const out = await download(page, pop);
    assert.match(out.text, /^Падает при старте\nhttps:\/\/github\.com\/o\/r\/issues\/5\nСостояние: closed \| Автор: ann \| Дата: 2024-05-01 10:00 \| Метки: bug\n\nОписание проблемы\n\nКомментарии 2\n\nbob 2024-05-01 11:00\nВоспроизвёл\n\ncat 12:00\nИсправлено в main\n$/);
  });
  await check('все issues: переключение режима и фильтр состояния', async () => {
    await pop.locator('#mode').selectOption('issues');
    assert.equal(await pop.locator('#ghstate').isVisible(), true);
    await pop.locator('#ghstate').selectOption('all');
    const out = await download(page, pop);
    assert.match(out.text, /^o\/r: Issues\nhttps:\/\/github\.com\/o\/r\/issues\nСостояние: все \| Всего: 2\n\nIssues 2\n\n5 ann 2024-05-01 10:00 \+1\nПадает при старте \[closed, bug\]\nОписание проблемы\n\n> bob 11:00\nВоспроизвёл\n\n6 bob 2024-05-02 10:00\nНужна тёмная тема\nХочу/);
    assert.match(out.msg, /2 элемента/);
  });
  if (shots) await pop.screenshot({ path: `${shots}/gh-issues.png`, fullPage: true });
}
{
  const { page, pop } = await openPopup(ctx, `${GH}/o/r/discussions`);
  await check('все обсуждения с токеном (GraphQL)', async () => {
    const out = await download(page, pop);
    assert.match(out.text, /^o\/r: Обсуждения\n.*\n\nОбсуждения 1\n\n4 ann 2024-05-01 10:00 \+2\nКак настроить\? \[Q&A\]\nВопрос\n\n> bob 11:00 \+1\n\[answer\] Попробуйте так\n$/s);
  });
}

// ───── 5. без токена ─────
await check('без токена: все обсуждения недоступны (подсказка, кнопка выключена)', async () => {
  await opt.reload();
  await opt.waitForSelector('#o-ghtoken');
  await opt.locator('#o-ghtoken').fill('');
  await opt.locator('#o-ghtoken').blur();
  await opt.waitForTimeout(300);
  const { pop } = await openPopup(ctx, `${GH}/o/r/discussions`);
  await pop.waitForSelector('.warn');
  assert.match(await pop.textContent('.popup'), /нужен токен GitHub/);
  assert.equal(await saveBtn(pop).isDisabled(), true);
  if (shots) await pop.screenshot({ path: `${shots}/gh-no-token.png`, fullPage: true });
});
await check('без токена: одно обсуждение читается со страницы (с предупреждением)', async () => {
  const { page, pop } = await openPopup(ctx, `${GH}/o/r/discussions/4`);
  const out = await download(page, pop);
  assert.match(out.text, /Вопрос со страницы/);
  assert.match(out.text, /без токена/);
});

// ───── 6. лимит GitHub: пауза → «Продолжить» ─────
{
  resetCounters();
  st.rawLimit = new Set(['src/b.ts', 'docs/guide.md']);
  const { page, pop } = await openPopup(ctx, `${GH}/o/r`);
  await pop.locator('#mode').selectOption('digest');
  await check('лимит raw (429): пауза, показаны «Продолжить» и «Сохранить, что есть»', async () => {
    await saveBtn(pop).click();
    await statusWarn(pop);
    assert.match(await pop.textContent('.status'), /GitHub ограничил запросы \(HTTP 429\)\. Скачано 2 из 4/);
    assert.ok(await pop.getByRole('button', { name: 'Продолжить' }).isVisible());
    assert.ok(await pop.getByRole('button', { name: 'Сохранить, что есть' }).isVisible());
    if (shots) await pop.screenshot({ path: `${shots}/gh-paused.png`, fullPage: true });
  });
  await check('«Сохранить, что есть»: файл из скачанного, без новых запросов к raw', async () => {
    const before = st.rawCalls.length;
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await pop.getByRole('button', { name: 'Сохранить, что есть' }).click();
    const text = fs.readFileSync(await (await dl).path(), 'utf8');
    assert.match(text, /### README\.md/);
    assert.doesNotMatch(text, /### src\/b\.ts/);
    assert.match(text, /частично: 2 из 4/);
    assert.equal(st.rawCalls.length, before);
  });
  await check('снятие лимита и «Продолжить»: докачаны только недостающие файлы', async () => {
    // после «сохранить, что есть» кэш остаётся: пользователь может продолжить
    await pop.waitForSelector('.status p.ok');
    st.rawLimit = new Set();
    st.rawCalls.length = 0;
    // новая пауза не нужна: просто запускаем сохранение ещё раз — скачанное берётся из кэша
    const out = await download(page, pop);
    assert.match(out.text, /### src\/b\.ts/);
    assert.match(out.text, /### docs\/guide\.md/);
    assert.deepEqual(st.rawCalls.sort(), ['docs/guide.md', 'src/b.ts']);
  });
}

// ───── 7. 4PDA: 429 → пауза → «Продолжить» ─────
{
  resetCounters();
  st.pdaOk = 0;
  st.pdaLimitAfter = 2;
  const { page, pop } = await openPopup(ctx, 'https://4pda.to/forum/index.php?showtopic=1');
  await check('4PDA 429: пул остановлен сразу, без проб, пауза с «Продолжить» и «Пропустить»', async () => {
    await saveBtn(pop).click();
    await statusWarn(pop);
    assert.match(await pop.textContent('.status'), /4PDA ограничил запросы \(HTTP 429\)\. Скачано 2 из 6/);
    // 2 успешных + 429; дальше тишина до ручного «Продолжить»
    assert.ok(st.pdaCalls.length <= 3 + 2, `запросов: ${st.pdaCalls.length}`);
    assert.ok(await pop.getByRole('button', { name: 'Пропустить заблокированное' }).isVisible());
    if (shots) await pop.screenshot({ path: `${shots}/pda-paused.png`, fullPage: true });
  });
  await check('4PDA: после снятия ограничения «Продолжить» скачивает только недостающие страницы', async () => {
    st.pdaLimitAfter = Infinity;
    st.pdaCalls.length = 0;
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await pop.getByRole('button', { name: 'Продолжить' }).click();
    const text = fs.readFileSync(await (await dl).path(), 'utf8');
    assert.equal((text.match(/^\d+ user\d+/gm) || []).length, 6);
    assert.deepEqual([...new Set(st.pdaCalls)].sort(), [2, 3, 4, 5]);
  });
  await check('4PDA: «Пропустить» исключает заблокированную страницу и скачивает остальные', async () => {
    resetCounters();
    st.pdaOk = 0;
    st.pdaLimitAfter = 2;
    await saveBtn(pop).click();
    await statusWarn(pop);
    st.pdaLimitAfter = Infinity;
    st.pdaCalls.length = 0;
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await pop.getByRole('button', { name: 'Пропустить заблокированное' }).click();
    const text = fs.readFileSync(await (await dl).path(), 'utf8');
    assert.equal((text.match(/^\d+ user\d+/gm) || []).length, 5);
    assert.match(text, /Пропущено страниц: 1 \(3\)/);
  });
}

await close();
cleanup();
for (const [s, n] of results) console.log(s === 'ok' ? '✓' : '✗', n);
const failed = results.filter(r => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
