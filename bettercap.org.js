/**
 * Скрипт для рекурсивного сбора всей документации с сайта bettercap.org в один текстовый файл.
 * Он находит все уникальные ссылки в навигационном меню, загружает каждую страницу,
 * извлекает основной контент и объединяет его для загрузки.
 */
async function scrapeDocumentation() {
  console.log("🚀 Начинаю сбор документации...");

  // --- Шаг 1: Сбор всех уникальных ссылок из сайдбара ---
  const sidebarSelector = 'nav.sidebar';
  const linkSelector = 'a[href]'; // Находим все ссылки внутри навигации
  const mainContentSelector = 'div.sl-markdown-content'; // Селектор для основного контента на странице

  const sidebar = document.querySelector(sidebarSelector);
  if (!sidebar) {
    console.error("❌ Не удалось найти сайдбар с навигацией. Убедитесь, что вы на правильном сайте.");
    return;
  }

  const links = sidebar.querySelectorAll(linkSelector);
  const pageUrls = new Set(); // Используем Set для автоматического удаления дубликатов

  links.forEach(link => {
    // Преобразуем относительные ссылки в абсолютные
    const fullUrl = new URL(link.getAttribute('href'), window.location.origin).href;
    // Добавляем только внутренние ссылки на документацию
    if (fullUrl.startsWith(window.location.origin)) {
      pageUrls.add(fullUrl);
    }
  });

  console.log(`🔍 Найдено ${pageUrls.size} уникальных страниц для обработки.`);
  if (pageUrls.size === 0) {
      console.warn("⚠️ Ссылки не найдены. Скрипт завершает работу.");
      return;
  }

  // --- Шаг 2: Последовательная загрузка и парсинг каждой страницы ---
  let fullTextContent = `Сгенерировано ${new Date().toLocaleString()}\n`;
  fullTextContent += `Источник: ${window.location.hostname}\n\n`;
  
  const parser = new DOMParser();
  let count = 0;

  for (const url of Array.from(pageUrls)) {
    count++;
    console.log(`[${count}/${pageUrls.size}] 📥 Загружаю: ${url}`);
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`⚠️ Не удалось загрузить страницу ${url}. Статус: ${response.status}`);
        continue;
      }

      const html = await response.text();
      const doc = parser.parseFromString(html, 'text/html');

      const title = doc.querySelector('h1')?.innerText || "Без заголовка";
      const mainContent = doc.querySelector(mainContentSelector);

      // --- Шаг 3: Извлечение и добавление текста в общий файл ---
      if (mainContent) {
        fullTextContent += `\n\n============================================================\n`;
        fullTextContent += `## ${title}\n`;
        fullTextContent += `(Источник: ${url})\n`;
        fullTextContent += `============================================================\n\n`;
        fullTextContent += mainContent.innerText.trim();
      } else {
        console.warn(`⚠️ Не найден контент ('${mainContentSelector}') на странице: ${url}`);
      }

    } catch (error) {
      console.error(`❌ Ошибка при обработке ${url}:`, error);
    }
  }

  // --- Шаг 4: Создание и загрузка файла ---
  console.log("✅ Сбор данных завершен. Подготовка файла для загрузки...");

  const blob = new Blob([fullTextContent], { type: 'text/plain;charset=utf-8' });
  const downloadLink = document.createElement('a');
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.download = 'bettercap-documentation.txt';

  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  URL.revokeObjectURL(downloadLink.href); // Очистка памяти

  console.log("🎉 Файл успешно сформирован и загрузка начата!");
}

// Запускаем основную функцию
scrapeDocumentation();
