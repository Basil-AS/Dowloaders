(async () => {
  console.clear();

  // --- Создаем и показываем оверлей (экран загрузки) ---
  const overlay = document.createElement('div');
  overlay.id = 'pda-scraper-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.9)', zIndex: '9999',
    display: 'flex', justifyContent: 'center', alignItems: 'center',
    color: 'white', fontSize: '22px', fontFamily: 'sans-serif',
    textAlign: 'center', lineHeight: '1.5', flexDirection: 'column'
  });
  
  const progressText = document.createElement('div');
  overlay.appendChild(progressText);
  document.body.appendChild(overlay);
  
  const mainContent = document.querySelector('body > div[style*="min-width"]');
  if(mainContent) mainContent.style.display = 'none';

  try {
    progressText.innerHTML = '🚀 Анализирую страницу 4PDA...';
    console.log("🚀 Начинаю скачивание с 4PDA...");

    // --- Вспомогательные функции ---
    function sanitizeFilename(name) {
      return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || '4pda-download';
    }

    function getFormattedDate() {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    // --- Определяем режим работы (Тема или Поиск) ---
    const urlParams = new URLSearchParams(window.location.search);
    const isTopicPage = urlParams.has('showtopic');
    const isSearchPage = urlParams.get('act') === 'search';

    let title, totalPages = 1, baseUrl;

    if (isTopicPage) {
        console.log("Режим: Скачивание темы.");
        title = document.querySelector('h1[itemprop="name"]')?.textContent.trim() || document.title;
        const topicId = urlParams.get('showtopic');
        baseUrl = `https://4pda.to/forum/index.php?showtopic=${topicId}`;
    } else if (isSearchPage) {
        console.log("Режим: Скачивание результатов поиска.");
        const query = urlParams.get('query');
        title = query ? `Результаты поиска по '${query}'` : 'Результаты поиска';
        // Копируем все параметры текущего URL для сохранения контекста поиска
        baseUrl = window.location.href.split('&st=')[0];
    } else {
        throw new Error("Не удалось определить режим работы. Скрипт работает только на страницах тем ('showtopic=...') или результатов поиска ('act=search...').");
    }

    const pageMenu = document.querySelector('.pagelink-menu');
    if (pageMenu) {
      const match = pageMenu.textContent.match(/(\d+)\s+страниц/);
      if (match) totalPages = parseInt(match[1], 10);
    }
    
    console.log(`Заголовок: '${title}'`);
    console.log(`Всего страниц для скачивания: ${totalPages}`);
    
    let allPostsText = `Источник: ${title}\n`;
    allPostsText += `URL: ${window.location.href}\n`;
    allPostsText += `Всего страниц: ${totalPages}\n`;
    allPostsText += "================================================================\n\n";

    // --- Проходим по всем страницам ---
    for (let i = 0; i < totalPages; i++) {
      const pageNum = i + 1;
      const start = i * 20; // на 4pda 20 постов на странице
      const pageUrl = `${baseUrl}&st=${start}`;
      
      progressText.innerHTML = `📥 Загружаю страницу ${pageNum} из ${totalPages}...`;
      console.log(`📥 Загружаю страницу ${pageNum} из ${totalPages} (${pageUrl})`);

      const response = await fetch(pageUrl);
      if (!response.ok) {
        console.warn(`❗️ Не удалось загрузить страницу ${pageNum}. Код ответа: ${response.status}. Пропускаю.`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      const decoder = new TextDecoder('windows-1251');
      const html = decoder.decode(buffer);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const posts = doc.querySelectorAll('div.borderwrap[data-post]');
      
      for (const post of posts) {
        const author = post.querySelector('.normalname a')?.textContent.trim() || 'Гость';
        const postLink = post.querySelector('a[title="Ссылка на это сообщение"]');
        const postNumber = postLink ? postLink.textContent.trim() : '#?';
        const dateString = post.querySelector('td.row2[width="99%"]')?.textContent.split('Сообщение')[0].trim() || '...';
        
        const postBody = post.querySelector('.postcolor');
        if (!postBody) continue;
        
        const tempDiv = postBody.cloneNode(true);
        
        // Обработка цитат
        tempDiv.querySelectorAll('.quote').forEach(quote => {
          const authorQuote = quote.querySelector('.block-title')?.textContent.trim() || 'Цитата';
          const bodyQuote = quote.querySelector('.block-body');
          if(bodyQuote) quote.replaceWith(`\n>> [Цитата: ${authorQuote}]\n---\n${bodyQuote.innerText.trim()}\n---\n`);
        });

        // Раскрытие спойлеров
        tempDiv.querySelectorAll('.spoil').forEach(spoil => {
          const titleSpoil = spoil.querySelector('.block-title')?.textContent.trim() || 'Спойлер';
          const bodySpoil = spoil.querySelector('.block-body');
          if(bodySpoil) spoil.replaceWith(`\n>> [СПОЙЛЕР: ${titleSpoil}]\n---\n${bodySpoil.innerText.trim()}\n---\n`);
        });
        
        const cleanText = tempDiv.innerText.trim();

        allPostsText += `--- [ ${postNumber} | Автор: ${author} | ${dateString} ] ---\n\n`;
        allPostsText += cleanText + "\n\n";
        allPostsText += "================================================================\n\n";
      }
      
      await new Promise(resolve => setTimeout(resolve, 350)); // Пауза
    }

    // --- Скачивание файла ---
    console.log("✅✅✅ ГОТОВО! Все сообщения собраны. ✅✅✅");
    progressText.innerHTML = '✅ Готово! Создаю файл для скачивания...';
    
    const filename = `${getFormattedDate()} - [4pda.to] - ${sanitizeFilename(title)}.txt`;
    const blob = new Blob([allPostsText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log(`✅ Файл '${filename}' успешно создан и скачивание должно было начаться.`);

    console.log("Ниже вы можете увидеть весь текст для ручного копирования:");
    console.log(allPostsText);

  } catch (error) {
    console.error("❌ Произошла ошибка во время выполнения скрипта:", error);
    progressText.innerHTML = `❌ Ошибка!<br>${error.message}<br>Подробности в консоли (F12).`;
    progressText.style.color = '#ff8a8a';
  } finally {
    if(mainContent) mainContent.style.display = '';
    setTimeout(() => {
      if (document.getElementById('pda-scraper-overlay')) {
        document.body.removeChild(overlay);
      }
    }, 5000);
  }

})();
