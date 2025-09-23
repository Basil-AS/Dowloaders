(async () => {
  console.clear();
  console.log("🚀 Начинаю скачивание темы...");

  // Функция для очистки имени файла от недопустимых символов
  function sanitizeFilename(name) {
    return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled-topic';
  }

  // Автоматически определяем ID темы из текущего URL
  const match = window.location.pathname.match(/\/t\/.*?\/(\d+)/);
  if (!match) {
    console.error("❌ Не удалось определить ID темы. Убедитесь, что вы находитесь на странице темы.");
    return;
  }
  const topicId = match[1];
  const baseUrl = `https://ntc.party/t/${topicId}.json`;
  
  let allPostsText = "";
  let page = 1;
  let totalPosts = 0;
  let threadTitle = "untitled-topic"; 

  // Получаем заголовок темы и общее кол-во постов
  try {
    const initialResponse = await fetch(baseUrl);
    const initialData = await initialResponse.json();
    threadTitle = initialData.title;
    totalPosts = initialData.posts_count;
    allPostsText += `Тема: ${threadTitle}\n`;
    allPostsText += `URL: ${window.location.href}\n`;
    allPostsText += `Всего постов: ${totalPosts}\n`;
    allPostsText += "================================================================\n\n";
    console.log(`Тема: '${threadTitle}' (Всего постов: ${totalPosts})`);
  } catch (e) {
    console.error("❌ Ошибка при получении информации о теме:", e);
    return;
  }

  while (true) {
    try {
      console.log(`📥 Загружаю страницу ${page}...`);
      const response = await fetch(`${baseUrl}?page=${page}`);
      if (!response.ok) {
        console.log(`❗️ Ответ сервера ${response.status} на странице ${page}. Вероятно, это конец.`);
        break;
      }
      
      const data = await response.json();
      const posts = data.post_stream.posts;

      if (posts.length === 0) {
        console.log("✅ Больше постов не найдено. Завершаю сбор.");
        break;
      }

      for (const post of posts) {
        const username = post.username;
        const postNumber = post.post_number;
        const createdAt = new Date(post.created_at).toLocaleString();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = post.cooked;
        tempDiv.querySelectorAll('aside.quote').forEach(quote => {
            const title = quote.querySelector('.title')?.textContent.trim() || 'Цитата';
            const blockquote = quote.querySelector('blockquote')?.textContent.trim();
            quote.replaceWith(`\n>> ${title}\n---\n${blockquote}\n---\n`);
        });
        const cleanText = tempDiv.textContent || tempDiv.innerText || "";

        allPostsText += `--- [ Пост #${postNumber} | Автор: ${username} | ${createdAt} ] ---\n\n`;
        allPostsText += cleanText.trim() + "\n\n";
        allPostsText += "================================================================\n\n";
      }
      
      page++;
      await new Promise(resolve => setTimeout(resolve, 200)); 
      
    } catch (error) {
      console.error(`❌ Ошибка на странице ${page}:`, error);
      break;
    }
  }

  console.log("✅✅✅ ГОТОВО! Все сообщения собраны. ✅✅✅");
  
  // --- БЛОК ДЛЯ СКАЧИВАНИЯ ФАЙЛА ---
  try {
    console.log("⚙️ Создаю файл для скачивания...");

    // --- НОВОЕ: Генерируем имя файла с датой и сайтом ---
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // Месяцы 0-11, добавляем 1 и 0 спереди
    const day = String(now.getDate()).padStart(2, '0');      // Добавляем 0 спереди
    const dateString = `${year}-${month}-${day}`;
    const siteName = window.location.hostname; // e.g., "ntc.party"
    
    const filename = `${dateString} - [${siteName}] - ${sanitizeFilename(threadTitle)}.txt`;
    // --- КОНЕЦ НОВОГО БЛОКА ---

    const blob = new Blob([allPostsText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    console.log(`✅ Файл '${filename}' успешно создан и скачивание должно было начаться.`);
  } catch(e) {
    console.error("❌ Не удалось создать файл для скачивания:", e);
  }
  // --- КОНЕЦ БЛОКА СКАЧИВАНИЯ ---

  console.log("Содержимое также скопировано в буфер обмена.");
  console.log("Ниже вы можете увидеть весь текст для ручного копирования:");
  
  console.log(allPostsText);
  copy(allPostsText);

})();
