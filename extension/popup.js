const api = globalThis.browser ?? globalThis.chrome;
const $ = id => document.getElementById(id);
const FILES = ['lib/common.js', 'sites/habr.js', 'sites/reddit.js', 'sites/4pda.js', 'sites/discourse.js'];

const say = (t, err) => { $('msg').textContent = t; $('msg').className = err ? 'err' : ''; };

(async () => {
  const params = new URLSearchParams(location.search);
  let tabId = params.has('tabId') ? +params.get('tabId') : null; // для автотестов
  if (tabId == null) {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  let det;
  try {
    await api.scripting.executeScript({ target: { tabId }, files: FILES });
    [{ result: det }] = await api.scripting.executeScript({ target: { tabId }, func: () => window.__DL.detect() });
  } catch (e) {
    $('site').textContent = 'Эту страницу нельзя обработать';
    say(String(e.message || e), true);
    return;
  }
  if (!det) {
    $('site').textContent = 'Страница не поддерживается';
    say('Открой статью на Хабре, пост на Reddit, тему на 4PDA или тему на форуме Discourse (например ntc.party).', true);
    return;
  }
  $('site').textContent = 'Определено: ' + det.name;
  if (det.paged) $('opts').hidden = false;
  $('go').disabled = false;

  $('pct').addEventListener('input', () => { $('pctLabel').textContent = $('pct').value >= 100 ? 'всё' : `последние ${$('pct').value}%`; });
  $('go').addEventListener('click', async () => {
    $('go').disabled = true;
    say('Скачиваю… прогресс виден на странице.');
    const percent = +$('pct').value;
    const [{ result }] = await api.scripting.executeScript({ target: { tabId }, func: o => window.__DL.run(o), args: [{ percent }] });
    say(result?.ok ? `Готово: ${result.count} шт.\n${result.filename}` : 'Ошибка: ' + (result?.error || 'неизвестно'), !result?.ok);
    $('go').disabled = false;
  });
})();
