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
  const mainContainer = document.querySelector('#js-repo-pjax-container');
  if(mainContainer) mainContainer.style.display = 'none';

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
      while ((loadMoreButton = document.querySelector('form.ajax-pagination-form button[type="submit"]'))) {
        overlay.innerHTML = `Загружаю основную ленту...<br>${loadMoreButton.textContent.trim()}`;
        console.log(`⏳ Нажимаю кнопку "${loadMoreButton.textContent.trim()}"...`);
        loadMoreButton.click();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      console.log("✅ Вся основная лента загружена.");
    }

    // --- Шаг 2: Раскрываем все скрытые ВЛОЖЕННЫЕ ветки комментариев ---
    async function expandAllReplies() {
      console.log("🔍 Ищу и раскрываю вложенные ветки ответов ('Show replies')...");
      let hiddenRepliesButton;
      while ((hiddenRepliesButton = document.querySelector('.discussion-nested-comment-paging-form button'))) {
        overlay.innerHTML = `Раскрываю вложенные ответы...<br>${hiddenRepliesButton.textContent.trim()}`;
        console.log(`⏳ Нажимаю кнопку "${hiddenRepliesButton.textContent.trim()}"...`);
        hiddenRepliesButton.click();
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      console.log("✅ Все вложенные ветки комментариев раскрыты.");
    }

    await loadMoreItems();
    await expandAllReplies();
    overlay.innerHTML = '✍️ Собираю и форматирую все сообщения...';

    // --- Шаг 3: Сбор и форматирование данных ---
    console.log("✍️ Собираю и форматирую все сообщения...");
    let allPostsText = "";
    const threadTitle = document.querySelector('h1 .js-issue-title')?.innerText.trim() || 'Без названия';
    allPostsText += `Тема: ${threadTitle}\nURL: ${window.location.href}\n================================================================\n\n`;
    console.log(`Тема: '${threadTitle}'`);

    const timeline = document.querySelector('.js-discussion.discussion');
    if (!timeline) throw new Error("Не удалось найти контейнер с сообщениями.");
    
    const items = timeline.querySelectorAll('#js-progressive-timeline-item-container > .TimelineItem');

    for (const item of items) {
        const mainCommentGroup = item.querySelector(':scope > .timeline-comment-group');
        if (!mainCommentGroup) continue;

        const processComment = (commentElement, depth = 0) => {
            const author = commentElement.querySelector('.author')?.textContent.trim() || 'unknown';
            const timestampEl = commentElement.querySelector('relative-time');
            const timestamp = timestampEl ? new Date(timestampEl.getAttribute('datetime')).toLocaleString() : '...';
            const commentBodyEl = commentElement.querySelector('.markdown-body');
            if (!commentBodyEl) return;

            const indent = '  '.repeat(depth);
            const tempDiv = commentBodyEl.cloneNode(true);
            
            tempDiv.querySelectorAll('blockquote').forEach(q => q.replaceWith(`\n${indent}> ${q.innerText.trim().replace(/\n/g, `\n${indent}> `)}\n`));
            tempDiv.querySelectorAll('pre').forEach(p => p.replaceWith(`\n${indent}[КОД]\n${indent}--------------------------------\n${indent}${p.innerText.trim().replace(/\n/g, `\n${indent}`)}\n${indent}--------------------------------\n`));

            const cleanText = (tempDiv.textContent || tempDiv.innerText || "").trim();
            allPostsText += `${indent}--- [ Автор: ${author} | ${timestamp} ] ---\n\n${indent}${cleanText.replace(/\n/g, `\n${indent}`)}\n\n${indent}================================================================\n\n`;
            
            const childContainerId = `child-comments-${commentElement.closest('.js-targetable-element').id}`;
            const childCommentsContainer = item.querySelector(`#${childContainerId}`);
            if (childCommentsContainer) {
                childCommentsContainer.querySelectorAll(':scope > .TimelineItem .timeline-comment-group').forEach(reply => processComment(reply, depth + 1));
            }
        };
        processComment(mainCommentGroup);
    }

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

    console.log("Содержимое также скопировано в буфер обмена.");
    console.log("Ниже вы можете увидеть весь текст для ручного копирования:");
    console.log(allPostsText);
    
    if (typeof copy === 'function') copy(allPostsText);
    else await navigator.clipboard.writeText(allPostsText).then(() => console.log('Текст скопирован в буфер обмена.')).catch(err => console.error('Не удалось скопировать текст:', err));

  } catch (error) {
    console.error("❌ Произошла ошибка во время выполнения скрипта:", error);
    overlay.innerHTML = `❌ Ошибка!<br>Подробности в консоли (F12).<br>Обновите страницу и попробуйте снова.`;
    overlay.style.color = '#ff8a8a';
  } finally {
    // --- Убираем оверлей и возвращаем видимость контейнера в любом случае ---
    if(mainContainer) mainContainer.style.display = ''; // Возвращаем как было
    setTimeout(() => { // Даем время пользователю увидеть финальное сообщение
        document.body.removeChild(overlay);
    }, 4000);
  }

})();
