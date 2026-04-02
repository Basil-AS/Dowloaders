(async () => {
  console.clear();

  // --- Создаем и показываем оверлей (экран загрузки) ---
  const overlay = document.createElement('div');
  overlay.id = 'github-scraper-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
  overlay.style.zIndex = '9999';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.color = 'white';
  overlay.style.fontSize = '24px';
  overlay.style.fontFamily = 'sans-serif';
  overlay.innerHTML = '🚀 Идет скачивание обсуждения...<br>Пожалуйста, не закрывайте вкладку.<br>Следите за прогрессом в консоли (F12).';
  overlay.style.textAlign = 'center';
  overlay.style.lineHeight = '1.5';
  document.body.appendChild(overlay);

  // Скрываем основной контейнер, чтобы уменьшить нагрузку на рендеринг
  const mainContainer = document.querySelector('#js-repo-pjax-container') || document.querySelector('main');
  if(mainContainer) mainContainer.style.display = 'none';
  
  // Добавляем стили для лучшей работы скрипта
  const style = document.createElement('style');
  style.textContent = `
    .github-scraper-hidden { display: none !important; }
    .github-scraper-processing { opacity: 0.5; }
  `;
  document.head.appendChild(style);

  try {
    console.log("🚀 Начинаю скачивание обсуждения с GitHub...");

    // --- Вспомогательные функции ---
    function sanitizeFilename(name) {
      return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled-discussion';
    }

    function getFormattedDate() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // --- Шаг 1: Раскрываем ОСНОВНУЮ ленту комментариев ("Load more...") ---
    async function loadMoreItems() {
      console.log("🔍 Ищу и раскрываю основную ленту комментариев (кнопки 'Load more…')...");
      let loadMoreButton;
      let attempts = 0;
      const maxAttempts = 100; // Увеличили лимит попыток
      let totalFound = 0;
      
      // Расширенные селекторы для кнопок "Load more"
      const selectors = [
        'form.ajax-pagination-form button[type="submit"]',
        'button[data-testid="load-more-button"]',
        '.js-discussion-expandable button',
        '.timeline-progressive-focus button',
        'button.btn-link',
        '.load-more-comments button',
        '.js-progressive-loader button',
        '.ajax-pagination-form button',
        'button.Button--link',
        '.paginate-container button'
      ];
      
      while (attempts < maxAttempts) {
        // Сначала прокрутим вниз для активации ленивой загрузки
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        loadMoreButton = null;
        
        // Ищем кнопки более агрессивно
        const allButtons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
        
        for (const btn of allButtons) {
          const text = btn.textContent.toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          
          // Расширенные ключевые слова для поиска
          const keywords = [
            'load more', 'show more', 'more comments', 'view more', 
            'expand', 'see more', 'load additional', 'next',
            'more replies', 'show replies', 'view replies',
            'load older', 'previous', 'continue'
          ];
          
          const hasKeyword = keywords.some(keyword => 
            text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)
          );
          
          // Также ищем кнопки с числами (например "Show 25 more")
          const hasNumber = text.match(/\d+.*more|more.*\d+|show.*\d+|load.*\d+/i);
          
          if ((hasKeyword || hasNumber) && btn.offsetParent !== null && !btn.disabled) {
            loadMoreButton = btn;
            break;
          }
        }
        
        // Если не нашли обычным способом, попробуем селекторы
        if (!loadMoreButton) {
          for (const selector of selectors) {
            try {
              const btn = document.querySelector(selector);
              if (btn && btn.offsetParent !== null && !btn.disabled) {
                loadMoreButton = btn;
                break;
              }
            } catch (e) {
              // Игнорируем ошибки селекторов
            }
          }
        }
        
        if (!loadMoreButton) {
          console.log(`🔍 Кнопки загрузки больше не найдены после ${attempts} попыток. Найдено всего: ${totalFound}`);
          break;
        }
        
        totalFound++;
        overlay.innerHTML = `Загружаю основную ленту...<br>"${loadMoreButton.textContent.trim()}"<br>Попытка ${attempts + 1}/${maxAttempts}<br>Найдено кнопок: ${totalFound}`;
        console.log(`⏳ Нажимаю кнопку "${loadMoreButton.textContent.trim()}" (попытка ${attempts + 1}, всего найдено: ${totalFound})...`);
        
        // Прокручиваем к кнопке перед нажатием
        loadMoreButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 500));
        
        loadMoreButton.click();
        await new Promise(resolve => setTimeout(resolve, 3000)); // Увеличили задержку
        attempts++;
      }
      console.log(`✅ Загрузка основной ленты завершена. Всего кнопок обработано: ${totalFound}`);
    }

    // --- Шаг 2: Раскрываем все скрытые ВЛОЖЕННЫЕ ветки комментариев ---
    async function expandAllReplies() {
      console.log("🔍 Ищу и раскрываю вложенные ветки ответов ('Show replies')...");
      let hiddenRepliesButton;
      let attempts = 0;
      const maxAttempts = 300; // Значительно увеличили лимит
      let totalRepliesFound = 0;
      
      const replySelectors = [
        '.discussion-nested-comment-paging-form button',
        'button[data-testid="show-replies-button"]',
        '.js-show-more-replies',
        '.timeline-comment-group .btn-link',
        '.reply-group button',
        '.js-toggle-replies',
        '.js-show-more-timeline-items button',
        'button[aria-label*="replies"]',
        'button[title*="replies"]'
      ];
      
      while (attempts < maxAttempts) {
        // Прокручиваем всю страницу для поиска новых кнопок
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 800));
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 800));
        
        hiddenRepliesButton = null;
        
        // Агрессивный поиск кнопок ответов
        const allButtons = document.querySelectorAll('button, a[role="button"]');
        
        for (const btn of allButtons) {
          if (!btn.offsetParent || btn.disabled) continue;
          
          const text = btn.textContent.toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          const className = (btn.className || '').toLowerCase();
          
          // Расширенные паттерны для поиска кнопок ответов
          const replyPatterns = [
            /show.*\d+.*repl/i,
            /\d+.*repl/i,
            /show.*repl/i,
            /view.*repl/i,
            /expand.*repl/i,
            /load.*repl/i,
            /more.*repl/i,
            /see.*repl/i,
            /hide.*repl/i,
            /collapse.*repl/i,
            /show.*previous/i,
            /show.*hidden/i,
            /show.*\d+.*more/i,
            /\d+.*hidden/i,
            /\d+.*previous/i
          ];
          
          const keywords = [
            'replies', 'reply', 'responses', 'response',
            'show more', 'view more', 'load more',
            'expand', 'collapse', 'toggle',
            'hidden', 'previous', 'older'
          ];
          
          const hasPattern = replyPatterns.some(pattern => 
            pattern.test(text) || pattern.test(ariaLabel) || pattern.test(title)
          );
          
          const hasKeyword = keywords.some(keyword => 
            text.includes(keyword) || ariaLabel.includes(keyword) || title.includes(keyword)
          );
          
          const hasReplyClass = className.includes('reply') || className.includes('expand') || className.includes('toggle');
          
          if (hasPattern || (hasKeyword && text.length < 50) || hasReplyClass) {
            hiddenRepliesButton = btn;
            break;
          }
        }
        
        // Если не нашли агрессивным поиском, попробуем селекторы
        if (!hiddenRepliesButton) {
          for (const selector of replySelectors) {
            try {
              const btn = document.querySelector(selector);
              if (btn && btn.offsetParent !== null && !btn.disabled) {
                hiddenRepliesButton = btn;
                break;
              }
            } catch (e) {
              // Игнорируем ошибки селекторов
            }
          }
        }
        
        if (!hiddenRepliesButton) {
          console.log(`🔍 Кнопки ответов больше не найдены после ${attempts} попыток. Всего раскрыто: ${totalRepliesFound}`);
          break;
        }
        
        totalRepliesFound++;
        overlay.innerHTML = `Раскрываю вложенные ответы...<br>"${hiddenRepliesButton.textContent.trim()}"<br>Попытка ${attempts + 1}/${maxAttempts}<br>Раскрыто: ${totalRepliesFound}`;
        console.log(`⏳ Нажимаю кнопку "${hiddenRepliesButton.textContent.trim()}" (попытка ${attempts + 1}, всего раскрыто: ${totalRepliesFound})...`);
        
        // Прокручиваем к кнопке и нажимаем
        hiddenRepliesButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 300));
        
        hiddenRepliesButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Увеличили задержку
        attempts++;
      }
      console.log(`✅ Раскрытие вложенных веток завершено. Всего кнопок обработано: ${totalRepliesFound}`);
    }

    // Функция для прокрутки страницы (активирует ленивую загрузку)
    async function scrollToLoadContent() {
      console.log("📜 Прокручиваю страницу для активации ленивой загрузки...");
      const scrollStep = 1500;
      const scrollDelay = 800;
      let lastHeight = 0;
      let currentHeight = document.body.scrollHeight;
      let attempts = 0;
      const maxAttempts = 20;
      
      while (lastHeight !== currentHeight && attempts < maxAttempts) {
        lastHeight = currentHeight;
        
        // Медленная прокрутка для активации всего ленивого контента
        for (let i = 0; i < currentHeight; i += scrollStep) {
          window.scrollTo(0, i);
          await new Promise(resolve => setTimeout(resolve, scrollDelay / 5));
          
          // Проверяем, появились ли новые кнопки "Load more"
          const newButtons = document.querySelectorAll('button');
          for (const btn of newButtons) {
            const text = btn.textContent.toLowerCase();
            if ((text.includes('load') && text.includes('more')) || 
                text.includes('show more') || 
                text.includes('more comments') ||
                text.match(/\d+.*more/i)) {
              overlay.innerHTML = `📜 Найдена новая кнопка: ${btn.textContent.trim()}`;
              console.log(`📜 Обнаружена кнопка: ${btn.textContent.trim()}`);
            }
          }
        }
        
        window.scrollTo(0, currentHeight);
        await new Promise(resolve => setTimeout(resolve, scrollDelay * 3));
        currentHeight = document.body.scrollHeight;
        attempts++;
        overlay.innerHTML = `📜 Прокручиваю страницу...<br>Высота: ${currentHeight}px<br>Попытка: ${attempts}/${maxAttempts}`;
      }
      
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("✅ Прокрутка завершена.");
    }

    // Функция финальной проверки и досбора комментариев
    async function finalSweep() {
      console.log("🧹 Выполняю финальную проверку на пропущенные элементы...");
      
      // Последний цикл прокрутки с активацией всех элементов
      for (let i = 0; i < 3; i++) {
        overlay.innerHTML = `🧹 Финальная проверка ${i + 1}/3...`;
        
        // Полная прокрутка
        window.scrollTo(0, 0);
        await new Promise(resolve => setTimeout(resolve, 1000));
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Ищем оставшиеся кнопки
        const remainingButtons = document.querySelectorAll('button, a[role="button"]');
        let foundNew = 0;
        
        for (const btn of remainingButtons) {
          if (!btn.offsetParent || btn.disabled) continue;
          
          const text = btn.textContent.toLowerCase().trim();
          if ((text.includes('show') || text.includes('load') || text.includes('more') || text.includes('expand')) &&
              (text.includes('repl') || text.includes('comment') || text.includes('more') || text.length < 30)) {
            
            console.log(`🧹 Найдена пропущенная кнопка: "${btn.textContent.trim()}"`);
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(resolve => setTimeout(resolve, 300));
            btn.click();
            await new Promise(resolve => setTimeout(resolve, 1500));
            foundNew++;
            
            if (foundNew > 20) break; // Ограничиваем количество за один проход
          }
        }
        
        console.log(`🧹 Проход ${i + 1}: найдено и обработано ${foundNew} дополнительных кнопок`);
        
        if (foundNew === 0) break; // Если ничего нового не нашли, выходим
      }
      
      console.log("✅ Финальная проверка завершена.");
    }

    // Даем странице время для полной загрузки
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await scrollToLoadContent();
    await loadMoreItems();
    await expandAllReplies();
    await finalSweep(); // Добавили финальную проверку
    
    // Даем время для загрузки всех раскрытых комментариев
    overlay.innerHTML = '⏳ Ожидаю загрузки всех комментариев...';
    await new Promise(resolve => setTimeout(resolve, 8000)); // Увеличили время ожидания
    
    overlay.innerHTML = '✍️ Собираю и форматирую все сообщения...';

    // --- Шаг 3: Сбор и форматирование данных ---
    console.log("✍️ Собираю и форматирую все сообщения...");
    let allPostsText = "";
    
    // Пытаемся найти заголовок обсуждения разными способами
    const titleSelectors = [
      'h1 .js-issue-title',
      'h1[data-testid="discussion-title"]',
      '.discussion-header h1',
      '[data-view-component="true"] h1',
      'h1 .js-navigation-open',
      '.gh-header-title h1'
    ];
    
    let threadTitle = 'Без названия';
    for (const selector of titleSelectors) {
      const titleEl = document.querySelector(selector);
      if (titleEl?.innerText?.trim()) {
        threadTitle = titleEl.innerText.trim();
        break;
      }
    }
    
    allPostsText += `Тема: ${threadTitle}\nURL: ${window.location.href}\nДата скачивания: ${new Date().toLocaleString()}\n================================================================\n\n`;
    console.log(`Тема: '${threadTitle}'`);

    // Ищем контейнер с обсуждением разными способами (Обновлено для React)
    const timelineSelectors = [
      '[data-testid="issue-history"]',
      '[data-testid="comment-viewer-outer"]',
      'main',
      '.js-discussion.discussion',
      '.js-discussion',
      '.discussion-timeline',
      '[data-testid="discussion-timeline"]',
      '.timeline-comment-wrapper',
      '.js-discussion-timeline'
    ];
    
    let timeline = null;
    for (const selector of timelineSelectors) {
      timeline = document.querySelector(selector);
      if (timeline) break;
    }
    
    // Новая логика фолбэка для React-верстки
    if (!timeline) {
      const hasComments = document.querySelector('[data-testid="comment"], .timeline-comment-group, .markdown-body');
      timeline = hasComments ? document : null;
      if (!timeline) throw new Error("Не удалось найти контейнер с сообщениями.");
    }
    
    // Расширенный поиск элементов комментариев
    const itemSelectors = [
      '#js-progressive-timeline-item-container > .TimelineItem',
      '.TimelineItem',
      '.timeline-comment-wrapper',
      '.discussion-comment',
      '[data-testid="comment"]',
      '.js-targetable-element',
      '.timeline-comment-group',
      '.discussion-comment-body',
      '.comment-body',
      '[class*="comment"]',
      '[id*="comment"]',
      '[data-testid*="comment"]'
    ];
    
    let items = [];
    let allFoundItems = new Set();
    
    // Собираем элементы из всех селекторов
    for (const selector of itemSelectors) {
      try {
        const foundElements = timeline?.querySelectorAll(selector) || document.querySelectorAll(selector);
        for (const element of foundElements) {
          allFoundItems.add(element);
        }
        console.log(`Селектор "${selector}": найдено ${foundElements.length} элементов`);
      } catch (e) {
        console.log(`Ошибка с селектором "${selector}":`, e.message);
      }
    }
    
    items = Array.from(allFoundItems);
    console.log(`Найдено ${items.length} уникальных элементов для обработки`);
    
    // Если всё ещё мало элементов, применяем агрессивный поиск
    if (items.length < 200) {
      console.log("⚠️ Найдено мало элементов, применяю агрессивный поиск...");
      
      // Ищем все элементы, которые могут содержать комментарии
      const aggressiveSelectors = [
        'div[id]', 'div[class]', 'article', 'section',
        '[data-testid]', '[data-component]', '[data-view-component]',
        'li', 'dl', 'dd', 'dt'
      ];
      
      const candidateElements = new Set();
      
      for (const selector of aggressiveSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim();
            const hasAuthor = el.querySelector('.author, [data-testid*="author"], a[data-hovercard-type="user"]');
            const hasTimestamp = el.querySelector('relative-time, time, [datetime]');
            const hasContent = text && text.length > 50;
            
            // Элемент похож на комментарий, если содержит автора, время или достаточно текста
            if (hasAuthor || hasTimestamp || (hasContent && text.length < 10000)) {
              candidateElements.add(el);
            }
          }
        } catch (e) {
          // Игнорируем ошибки селекторов
        }
      }
      
      // Объединяем с уже найденными
      for (const element of candidateElements) {
        allFoundItems.add(element);
      }
      
      items = Array.from(allFoundItems);
      console.log(`После агрессивного поиска найдено ${items.length} элементов`);
      
      // Фильтруем дубликаты и нерелевантные элементы
      items = items.filter((el, index, self) => {
        // Убираем дубликаты
        if (self.indexOf(el) !== index) return false;
        
        const text = el.textContent?.trim();
        if (!text || text.length < 20) return false;
        
        // Убираем элементы навигации и служебные
        const excludeTexts = [
          'skip to content', 'navigation menu', 'footer', 'sidebar',
          'search', 'notifications', 'settings', 'privacy', 'terms',
          'github homepage', 'manage cookies'
        ];
        
        const textLower = text.toLowerCase();
        if (excludeTexts.some(exclude => textLower.includes(exclude) && text.length < 200)) {
          return false;
        }
        
        return true;
      });
      
      console.log(`После фильтрации осталось ${items.length} элементов`);
    }

    const processComment = (commentElement, depth = 0) => {
      if (!commentElement) return false;
      
      // Ищем автора разными способами (Обновлено для React)
      const authorSelectors = [
        '[data-testid="avatar-icon-link"]',
        '[data-testid="comment-header-author"]',
        '.author',
        '[data-testid="author-name"]',
        '.timeline-comment-header .author',
        'a[data-hovercard-type="user"]',
        '.discussion-comment-header .author',
        '.timeline-comment-header a',
        'h3 a', 'h4 a',
        '.author-link'
      ];
      
      let author = 'unknown';
      for (const selector of authorSelectors) {
        const authorEl = commentElement.querySelector(selector);
        if (authorEl?.textContent?.trim()) {
          author = authorEl.textContent.trim();
          break;
        }
      }
      
      // Если не нашли автора в дочерних элементах, проверим атрибуты самого элемента
      if (author === 'unknown') {
        const dataAuthor = commentElement.getAttribute('data-author') || 
                          commentElement.getAttribute('data-user') ||
                          commentElement.getAttribute('data-username');
        if (dataAuthor) author = dataAuthor;
      }
      
      // Ищем timestamp
      const timestampSelectors = [
        'relative-time',
        'time',
        '[datetime]',
        '.timestamp',
        '.js-timestamp',
        '[data-testid*="time"]'
      ];
      
      let timestamp = '...';
      for (const selector of timestampSelectors) {
        const timestampEl = commentElement.querySelector(selector);
        if (timestampEl) {
          const datetime = timestampEl.getAttribute('datetime') || 
                          timestampEl.getAttribute('title') ||
                          timestampEl.getAttribute('data-datetime');
          if (datetime) {
            try {
              timestamp = new Date(datetime).toLocaleString('ru-RU');
            } catch (e) {
              timestamp = datetime;
            }
            break;
          }
        }
      }
      
      // Ищем тело комментария
      const bodySelectors = [
        '.markdown-body',
        '.comment-body',
        '.discussion-comment-body',
        '[data-testid="comment-body"]',
        '.timeline-comment-body',
        '.js-comment-body',
        '.issue-comment-body',
        '.edit-comment-hide'
      ];
      
      let commentBodyEl = null;
      for (const selector of bodySelectors) {
        commentBodyEl = commentElement.querySelector(selector);
        if (commentBodyEl) break;
      }
      
      // Если не нашли специфичное тело комментария, используем весь элемент как тело
      if (!commentBodyEl) {
        const text = commentElement.textContent?.trim();
        // Проверяем, что элемент содержит достаточно текста и не является служебным
        if (text && text.length > 30 && text.length < 50000) {
          // Исключаем служебные элементы
          const excludeTexts = ['navigation', 'footer', 'header', 'menu', 'search', 'login', 'sign up'];
          const textLower = text.toLowerCase();
          const isServiceElement = excludeTexts.some(exclude => textLower.includes(exclude) && text.length < 200);
          
          if (!isServiceElement) {
            commentBodyEl = commentElement;
          }
        }
      }
      
      if (!commentBodyEl) return false;

      const indent = '  '.repeat(depth);
      const tempDiv = commentBodyEl.cloneNode(true);
      
      // Убираем служебные элементы
      tempDiv.querySelectorAll('nav, .navigation, .footer, .header, .sidebar, script, style, .sr-only').forEach(el => el.remove());
      
      // Обрабатываем специальные элементы
      tempDiv.querySelectorAll('blockquote').forEach(q => {
        const quotedText = q.innerText.trim().replace(/\n/g, `\n${indent}> `);
        q.replaceWith(`\n${indent}> ${quotedText}\n`);
      });
      
      tempDiv.querySelectorAll('pre, code').forEach(p => {
        const codeText = p.innerText.trim().replace(/\n/g, `\n${indent}`);
        p.replaceWith(`\n${indent}[КОД]\n${indent}--------------------------------\n${indent}${codeText}\n${indent}--------------------------------\n`);
      });

      const cleanText = (tempDiv.textContent || tempDiv.innerText || "").trim();
      if (cleanText && cleanText.length > 10) {
        allPostsText += `${indent}--- [ Автор: ${author} | ${timestamp} ] ---\n\n${indent}${cleanText.replace(/\n/g, `\n${indent}`)}\n\n${indent}================================================================\n\n`;
        
        // Ищем вложенные комментари
        const nestedSelectors = [
          '.timeline-comment-group',
          '.discussion-comment',
          '.reply-comment',
          '[data-testid="nested-comment"]',
          '.js-targetable-element'
        ];
        
        const parentItem = commentElement.closest('.TimelineItem, .timeline-comment-wrapper, .discussion-comment, .js-discussion-item');
        if (parentItem) {
          for (const selector of nestedSelectors) {
            const nestedComments = parentItem.querySelectorAll(selector);
            nestedComments.forEach(nested => {
              if (nested !== commentElement && !commentElement.contains(nested) && !nested.contains(commentElement)) {
                processComment(nested, depth + 1);
              }
            });
          }
        }
        
        return true; // Успешно обработали комментарий
      }
      
      return false; // Не удалось обработать
    };

    // Обрабатываем все найденные элементы
    let processedCount = 0;
    const processedElements = new Set();
    
    for (const item of items) {
      // Избегаем обработки одного элемента дважды
      if (processedElements.has(item)) continue;
      processedElements.add(item);
      
      // Пытаемся найти внутри элемента группы комментариев
      const commentGroups = item.querySelectorAll('.timeline-comment-group, .discussion-comment, .comment, .js-targetable-element');
      
      if (commentGroups.length === 0) {
        // Если не нашли группы комментариев, обрабатываем сам элемент
        const result = processComment(item);
        if (result) processedCount++;
      } else {
        // Обрабатываем каждую группу
        for (const group of commentGroups) {
          if (!processedElements.has(group)) {
            processedElements.add(group);
            const result = processComment(group);
            if (result) processedCount++;
          }
        }
      }
      
      // Также ищем прямые дочерние элементы, которые могут быть комментариями
      const directChildren = item.children;
      for (const child of directChildren) {
        if (!processedElements.has(child)) {
          const text = child.textContent?.trim();
          if (text && text.length > 30) {
            const hasAuthor = child.querySelector('.author, [data-testid*="author"], a[data-hovercard-type="user"]');
            const hasContent = child.querySelector('.markdown-body, .comment-body, .discussion-comment-body');
            
            if (hasAuthor || hasContent) {
              processedElements.add(child);
              const result = processComment(child);
              if (result) processedCount++;
            }
          }
        }
      }
    }
    
    console.log(`✅ Обработано ${processedCount} уникальных комментариев из ${items.length} элементов`);
    
    // Дополнительная проверка на пропущенные комментарии в документе
    console.log("🔍 Проверяю документ на пропущенные комментарии...");
    const additionalComments = document.querySelectorAll('[data-testid*="comment"], .js-comment, .timeline-comment, .discussion-item');
    let additionalCount = 0;
    
    for (const comment of additionalComments) {
      if (!processedElements.has(comment)) {
        const text = comment.textContent?.trim();
        if (text && text.length > 30) {
          processedElements.add(comment);
          const result = processComment(comment);
          if (result) additionalCount++;
        }
      }
    }
    
    console.log(`✅ Найдено и обработано ${additionalCount} дополнительных комментариев`);
    console.log(`📊 Итого обработано комментариев: ${processedCount + additionalCount}`);

    // --- Шаг 4: Скачивание файла ---
    console.log("✅✅✅ ГОТОВО! Все сообщения собраны. ✅✅✅");
    overlay.innerHTML = '✅ Готово! Создаю файл для скачивания...';
    
    console.log("⚙️ Создаю файл для скачивания...");
    const filename = `${getFormattedDate()} - [${window.location.hostname}] - ${sanitizeFilename(threadTitle)}.txt`;
    const blob = new Blob([allPostsText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log(`✅ Файл '${filename}' успешно создан и скачивание должно было начаться.`);

    // Статистика
    const lines = allPostsText.split('\n').length;
    const words = allPostsText.split(/\s+/).length;
    const chars = allPostsText.length;
    
    console.log(`📊 Статистика обработки:`);
    console.log(`- Строк: ${lines}`);
    console.log(`- Слов: ${words}`);  
    console.log(`- Символов: ${chars}`);
    console.log(`- Размер файла: ${(chars / 1024).toFixed(2)} КБ`);

    // Копирование в буфер обмена с несколькими попытками
    console.log("📋 Копирую содержимое в буфер обмена...");
    let clipboardSuccess = false;
    
    // Метод 1: copy() (если доступен в консоли)
    if (typeof copy === 'function') {
      try {
        copy(allPostsText);
        clipboardSuccess = true;
        console.log('✅ Текст скопирован в буфер обмена (метод copy()).');
      } catch (err) {
        console.log('⚠️ Метод copy() не сработал:', err.message);
      }
    }
    
    // Метод 2: navigator.clipboard
    if (!clipboardSuccess) {
      try {
        await navigator.clipboard.writeText(allPostsText);
        clipboardSuccess = true;
        console.log('✅ Текст скопирован в буфер обмена (Clipboard API).');
      } catch (err) {
        console.log('⚠️ Clipboard API не сработал:', err.message);
      }
    }
    
    // Метод 3: создание скрытого текстового поля
    if (!clipboardSuccess) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = allPostsText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        clipboardSuccess = true;
        console.log('✅ Текст скопирован в буфер обмена (execCommand).');
      } catch (err) {
        console.log('⚠️ execCommand не сработал:', err.message);
      }
    }
    
    if (!clipboardSuccess) {
      console.log('⚠️ Не удалось скопировать в буфер обмена. Текст доступен в консоли ниже.');
    }
    
    console.log("📄 Полный текст для ручного копирования:");
    console.log("================================");
    console.log(allPostsText);
    console.log("================================");

  } catch (error) {
    console.error("❌ Произошла ошибка во время выполнения скрипта:", error);
    console.error("Stack trace:", error.stack);
    console.log("📊 Диагностическая информация:");
    console.log("- URL:", window.location.href);
    console.log("- User Agent:", navigator.userAgent);
    console.log("- Доступные селекторы на странице:");
    
    const diagnosticSelectors = [
      '.js-discussion', '.discussion', '.timeline-comment-group', 
      '.TimelineItem', '.discussion-comment', 'relative-time',
      '.author', '.markdown-body'
    ];
    
    diagnosticSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      console.log(`  ${selector}: ${elements.length} элементов`);
    });
    
    overlay.innerHTML = `❌ Ошибка: ${error.message}<br>Подробности в консоли (F12).<br>Обновите страницу и попробуйте снова.<br><br>Возможные причины:<br>• Изменения в структуре GitHub<br>• Слишком быстрое выполнение<br>• Блокировка скрипта`;
    overlay.style.color = '#ff8a8a';
  } finally {
    // --- Убираем оверлей и возвращаем видимость контейнера в любом случае ---
    if(mainContainer) mainContainer.style.display = ''; // Возвращаем как было
    setTimeout(() => { // Даем время пользователю увидеть финальное сообщение
        if (document.body.contains(overlay)) {
          document.body.removeChild(overlay);
        }
    }, 6000); // Увеличили время показа финального сообщения
  }

})();
