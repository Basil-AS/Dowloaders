(async () => {
  console.clear();
  const log = (...a)=>console.log(...a);

  // ---- утилиты ----
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const decode1251 = async (res) => new TextDecoder('windows-1251').decode(await res.arrayBuffer());
  const nowYMD = () => {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  };
  const sanitize = s => (s||'').replace(/[<>:"/\\|?*]/g,'-').replace(/\s+/g,' ').trim();

  // ---- проверка страницы темы ----
  const url = new URL(location.href);
  if (!url.searchParams.has('showtopic')) { alert('Открой страницу темы (showtopic=...)'); return; }
  const topicId = url.searchParams.get('showtopic');
  const baseUrl = `https://4pda.to/forum/index.php?showtopic=${topicId}`;
  const topicTitle = (document.querySelector('h1[itemprop="name"]')?.textContent || document.title || '').trim();

  // ---- надёжное вычисление пагинации ----
  let perPage = 20, lastStart = 0;

  // 1) ipb_pages_array[...] = ["<url>", PER_PAGE, LAST_START]
  {
    const html = document.documentElement.outerHTML;
    const m = html.match(/ipb_pages_array\[\d+]\=\["[^"]+",\s*(\d+),\s*(\d+)\]/);
    if (m) { perPage = parseInt(m[1],10)||20; lastStart = parseInt(m[2],10)||0; }
  }

  // 2) ссылка "на последнюю"
  const lastLink = document.querySelector('.pagelinklast a[href*="&st="], a[title*="последнюю"][href*="&st="], a[title*="На последнюю"][href*="&st="]');
  if (lastLink) {
    const st = parseInt((lastLink.href.match(/[?&]st=(\d+)/)||[])[1],10);
    if (Number.isFinite(st)) lastStart = Math.max(lastStart, st);
  }

  // 3) fallback по "N страниц"
  let totalPages = (lastStart>0 && perPage>0) ? Math.floor(lastStart/perPage)+1 : 1;
  const domCount = (() => {
    const t = (document.querySelector('.pagelink-menu, .pagination')?.textContent||'');
    const m = t.match(/(\d+)\s*страниц/i); return m ? parseInt(m[1],10) : null;
  })();
  if (domCount) totalPages = domCount;

  // 4) sanity + доп.пересчёт по видимым ссылкам, если что-то странное
  if (!Number.isFinite(totalPages) || totalPages<1) totalPages=1;
  if (totalPages>2000) {
    const maxSt = [...document.querySelectorAll('a[href*="&st="]')]
      .map(a=>parseInt((a.href.match(/[?&]st=(\d+)/)||[])[1],10))
      .filter(Number.isFinite)
      .reduce((mx,v)=>Math.max(mx,v),0);
    if (maxSt && perPage) totalPages = Math.floor(maxSt/perPage)+1;
    totalPages = Math.min(totalPages||1, 2000);
  }

  log(`Тема: ${topicTitle}`);
  log(`Страниц: ${totalPages} (perPage=${perPage}, lastStart=${lastStart})`);

  // ---- сборщик "сущности" поста с минимизацией символов ----
  const extractCompactPosts = (doc) => {
    const blocks = doc.querySelectorAll('table.ipbtable[data-post]');
    const out = [];
    blocks.forEach(tab => {
      // номер
      const num = tab.querySelector('a[title="Ссылка на это сообщение"]')?.textContent?.trim() || '#?';
      // автор
      const author = tab.querySelector('.normalname a')?.textContent?.trim() ||
                     tab.querySelector('.normalname')?.textContent?.trim() || 'Гость';
      // дата
      const rawDateCell = tab.querySelector('td.row2[id^="ph-"][id$="-d2"]')?.textContent || '';
      const date = rawDateCell.replace(/\s+Сообщение.*$/,'').replace(/\s+/g,' ').trim() || '';

      // текст поста
      const body = tab.querySelector('.postcolor');
      if (!body) return;

      const temp = body.cloneNode(true);

      // выкинуть цитаты чтобы не дублировать чужой текст и экономить размер
      temp.querySelectorAll('.post-block.quote, .quote').forEach(q => q.remove());
      // из спойлеров оставить только текст
      temp.querySelectorAll('.post-block.spoil .block-body, .spoil .block-body').forEach(b => {
        b.replaceWith(b.innerText || b.textContent || '');
      });
      // убрать скрипты, код-блоки и мусор
      temp.querySelectorAll('script, style, .post-block.code, .attach, .signature, .edit, .post-edit-reason').forEach(el => el.remove());
      temp.querySelectorAll('img, video, iframe, br').forEach(el => { if (el.tagName==='BR') el.replaceWith('\n'); else el.remove(); });

      // плоский текст + чистки
      let text = (temp.innerText || temp.textContent || '').trim();

      // компактирование: убрать лишние пробелы/переводы
      text = text
        .replace(/\r/g,'')
        .replace(/\t+/g,' ')
        .replace(/\u00A0/g,' ')
        .replace(/[ ]{2,}/g,' ')
        .replace(/\n{3,}/g,'\n\n')
        .replace(/^\s+|\s+$/g,'')
        .trim();

      // если совсем пусто — пропускаем
      if (!text) return;

      // финальная строка: [# | автор | дата] текст
      const line = `[${num} | ${author} | ${date}] ${text}`;
      out.push(line);
    });
    return out;
  };

  // ---- сбор всех страниц ----
  let all = [];
  for (let i=0; i<totalPages; i++) {
    const st = i*perPage;
    const pageUrl = `${baseUrl}&st=${st}`;
    log(`→ ${i+1}/${totalPages}: ${pageUrl}`);

    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (!res.ok) { log(`! ${res.status} на ${pageUrl}`); continue; }
      const html = await decode1251(res);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const lines = extractCompactPosts(doc);
      all.push(...lines);
    } catch(e) {
      log('err:', e?.message || e);
    }
    // небольшая пауза, чтобы не долбить сервер
    await sleep(250);
  }

  if (all.length===0) { alert('Ничего не нашли. Возможно, залогинься на 4PDA'); return; }

  // ---- сохранение ----
  const header = `Источник: ${topicTitle}\nURL: ${baseUrl}\nСтраниц: ${totalPages}\n====================\n`;
  const content = header + all.join('\n\n') + '\n';
  const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${nowYMD()} - [4pda.to] - ${sanitize(topicTitle)}.txt`
  });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);

  log(`✔ Готово. Сообщений: ${all.length}`);
})();
