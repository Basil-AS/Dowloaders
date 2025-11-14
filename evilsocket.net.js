(async () => {
  console.clear();
  const log = (...a) => console.log(...a);

  // ---- Утилиты ----
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nowYMD = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const sanitize = s => (s || '').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();

  // ---- Конфигурация для evilsocket.net ----
  const BASE_URL = 'https://www.evilsocket.net';
  const TOTAL_PAGES = 5; // Как указано на сайте: "Page 1 of 5"

  log(`Запускаем сборщик для ${BASE_URL}`);
  log(`Всего страниц для сканирования: ${TOTAL_PAGES}`);

  // ---- ШАГ 1: Сбор всех ссылок на статьи ----
  const articleUrls = new Set(); // Используем Set для автоматической дедупликации
  try {
    for (let i = 1; i <= TOTAL_PAGES; i++) {
      const pageUrl = (i === 1) ? BASE_URL : `${BASE_URL}/page/${i}/`;
      log(`→ Сканируем страницу ${i}/${TOTAL_PAGES}: ${pageUrl}`);

      const response = await fetch(pageUrl);
      if (!response.ok) {
        log(`! Ошибка ${response.status} на странице ${pageUrl}`);
        continue;
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const links = doc.querySelectorAll('li.post-item a');
      if (links.length === 0) {
        log(`! Не найдено ссылок на статьи на странице ${i}`);
      } else {
        links.forEach(a => {
          // Убедимся, что ссылка не ведет на другую страницу пагинации
          if (a.href && !a.href.includes('/page/')) {
            // URL уже абсолютный
            articleUrls.add(a.href);
          }
        });
      }
      await sleep(200); // Небольшая пауза, чтобы не нагружать сервер
    }
  } catch (e) {
    log('! Произошла критическая ошибка при сборе ссылок:', e.message);
    alert('Произошла ошибка при сборе ссылок. Проверьте консоль.');
    return;
  }

  const urlsToFetch = Array.from(articleUrls);
  if (urlsToFetch.length === 0) {
    alert('Не удалось найти ни одной ссылки на статьи. Скрипт остановлен.');
    return;
  }

  log(`✔ Найдено ${urlsToFetch.length} уникальных статей. Начинаем сбор текста...`);


  // ---- ШАГ 2: Сбор текста каждой статьи ----
  let allArticlesContent = [];
  for (let i = 0; i < urlsToFetch.length; i++) {
    const url = urlsToFetch[i];
    log(`→ Загружаем статью ${i + 1}/${urlsToFetch.length}: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        log(`! Ошибка ${response.status} при загрузке статьи ${url}`);
        allArticlesContent.push(`[ОШИБКА ЗАГРУЗКИ: ${response.status}]\nURL: ${url}`);
        continue;
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // Извлекаем заголовок и основной текст
      const title = doc.querySelector('h1.post-title')?.textContent.trim() || 'Без заголовка';
      const body = doc.querySelector('div.post-entry');
      
      let text = 'Не удалось извлечь текст.';
      if (body) {
        // Клонируем, чтобы не изменять оригинальный документ
        const temp = body.cloneNode(true);
        // Удаляем ненужные элементы, если они есть (например, блоки "поделиться")
        temp.querySelectorAll('.social-share, script, style').forEach(el => el.remove());
        // Используем innerText для сохранения абзацев
        text = temp.innerText.trim();
      }
      
      const articleBlock = `[ЗАГОЛОВОК: ${title}]\n[ИСТОЧНИК: ${url}]\n\n${text}`;
      allArticlesContent.push(articleBlock);

    } catch (e) {
      log(`! Критическая ошибка при обработке статьи ${url}:`, e.message);
      allArticlesContent.push(`[КРИТИЧЕСКАЯ ОШИБКА]\nURL: ${url}\nСообщение: ${e.message}`);
    }
    await sleep(250); // Пауза между запросами
  }

  if (allArticlesContent.length === 0) {
    alert('Не удалось собрать текст ни одной статьи.');
    return;
  }

  // ---- ШАГ 3: Сохранение в файл ----
  log('✔ Сбор текста завершен. Подготовка файла для скачивания...');

  const fullText = allArticlesContent.join('\n\n============================================================\n\n');
  const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${nowYMD()} - ${sanitize('evilsocket.net articles')}.txt`
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);

  log(`✔ Готово! Сохранено статей: ${allArticlesContent.length}.`);
})();
