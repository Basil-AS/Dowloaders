/**
 * Скрипт для рекурсивного сбора всей документации с сайта bettercap.org в один текстовый файл.
 * Он находит все уникальные ссылки в навигационном меню, загружает каждую страницу,
 * извлекает и форматирует основной контент, а затем объединяет его для загрузки.
 * 
 * @version 2.0 - Улучшено извлечение текста для сохранения структуры (таблицы, списки, код).
 */
async function scrapeDocumentation() {
  console.log("🚀 Начинаю сбор документации v2.0...");

  // --- Утилиты ---
  
  /**
   * Интеллектуально извлекает и форматирует текст из родительского элемента.
   * Проблема с .innerText в том, что он теряет всю структуру. Эта функция
   * обходит дочерние узлы и применяет базовое форматирование.
   * @param {HTMLElement} element - DOM-элемент, содержащий контент.
   * @returns {string} - Отформатированный текст.
   */
  function extractAndFormatText(element) {
    if (!element) return '';

    let text = '';
    const children = Array.from(element.childNodes);

    for (const node of children) {
      // Текстовые узлы (пробелы между тегами и т.д.)
      if (node.nodeType === Node.TEXT_NODE) {
        const trimmedText = node.textContent.trim();
        if (trimmedText) text += trimmedText;
        continue;
      }

      // Элементы HTML
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toUpperCase();
        let nodeText = '';

        switch (tagName) {
          case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
            const level = parseInt(tagName.replace('H', ''), 10);
            nodeText = `\n${'#'.repeat(level)} ${node.textContent.trim()}\n`;
            break;
            
          case 'P':
            nodeText = `${node.textContent.trim()}\n\n`;
            break;

          case 'PRE': // Блоки кода
            nodeText = '```\n' + node.textContent + '\n```\n\n';
            break;

          case 'TABLE':
            const rows = Array.from(node.querySelectorAll('tr'));
            let tableContent = '';
            rows.forEach((row, index) => {
              const cells = Array.from(row.querySelectorAll('th, td'));
              tableContent += '| ' + cells.map(cell => cell.textContent.trim()).join(' | ') + ' |\n';
              if (index === 0 && row.parentElement.tagName.toUpperCase() === 'THEAD') {
                 tableContent += '|' + cells.map(cell => '---'.repeat(Math.max(1, Math.floor(cell.textContent.length / 3)))).join('|') + '|\n';
              }
            });
            nodeText = tableContent + '\n';
            break;
          
          case 'UL':
            const ulItems = Array.from(node.querySelectorAll('li'));
            nodeText = ulItems.map(li => `* ${li.textContent.trim()}`).join('\n') + '\n\n';
            break;

          case 'OL':
            const olItems = Array.from(node.querySelectorAll('li'));
            nodeText = olItems.map((li, i) => `${i + 1}. ${li.textContent.trim()}`).join('\n') + '\n\n';
            break;

          case 'A': // Обрабатываем ссылки, чтобы текст не терялся
            nodeText = node.textContent;
            break;

          default:
            // Для вложенных div и других контейнеров рекурсивно вызываем или просто берем текст
            nodeText = extractAndFormatText(node); 
            break;
        }
        text += nodeText;
      }
    }
    return text.replace(/\n{3,}/g, '\n\n'); // Убираем лишние пустые строки
  }


  // --- Шаг 1: Сбор всех уникальных ссылок из сайдбара ---
  const sidebarSelector = 'nav.sidebar';
  const linkSelector = 'a[href]'; // Находим все ссылки внутри навигации
  const mainContentSelector = 'div.sl-markdown-content'; // Селектор для основного контента

  const sidebar = document.querySelector(sidebarSelector);
  if (!sidebar) {
    console.error("❌ Не удалось найти сайдбар с навигацией. Убедитесь, что вы на правильном сайте (bettercap.org).");
    alert("Сайдбар не найден. Останавливаю скрипт.");
    return;
  }

  const links = sidebar.querySelectorAll(linkSelector);
  const pageUrls = new Set();

  links.forEach(link => {
    const fullUrl = new URL(link.getAttribute('href'), window.location.origin).href;
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
  let fullTextContent = `Сгенерировано ${new Date().toLocaleString('ru-RU')}\n`;
  fullTextContent += `Источник: ${window.location.hostname}\n\n`;
  
  const parser = new DOMParser();
  const urlArray = Array.from(pageUrls);
  
  for (let i = 0; i < urlArray.length; i++) {
    const url = urlArray[i];
    console.log(`[${i + 1}/${urlArray.length}] 📥 Загружаю: ${url}`);
    
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
        // Используем новую форматирующую функцию
        fullTextContent += extractAndFormatText(mainContent);
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
  URL.revokeObjectURL(downloadLink.href);

  console.log("🎉 Файл успешно сформирован и загрузка начата!");
}

// Запускаем основную функцию
scrapeDocumentation();
