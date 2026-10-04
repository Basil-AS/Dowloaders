(() => {
  const DL = window.__DL;
  const decode1251 = async res => new TextDecoder('windows-1251').decode(await res.arrayBuffer());

  const detectPagination = () => {
    let perPage = 20, totalPages = 1;
    const m = document.body.innerHTML.match(/ipb_pages_array\[.*?\]\s*=\s*\[.*?,(\d+),(\d+)\]/);
    if (m) {
      perPage = parseInt(m[1], 10) || 20;
      const maxSt = parseInt(m[2], 10) || 0;
      if (maxSt > 0) totalPages = Math.floor(maxSt / perPage) + 1;
    }
    for (const span of document.querySelectorAll('.pagelink-menu')) {
      const t = span.textContent.trim().match(/^(\d+)\s*страниц/i);
      if (t) { totalPages = parseInt(t[1], 10); break; }
    }
    if (totalPages <= 1) {
      const last = document.querySelector('.pagelinklast a[href*="&st="]');
      const s = last && last.href.match(/&st=(\d+)/);
      if (s) totalPages = Math.floor(parseInt(s[1], 10) / perPage) + 1;
    }
    return { perPage, totalPages: Math.max(1, totalPages) };
  };

  const extractPosts = (doc, seen) => {
    const out = [];
    doc.querySelectorAll('table.ipbtable[data-post]').forEach(tab => {
      const id = tab.getAttribute('data-post');
      if (id && seen.has(id)) return; // страницы «съезжают», если в теме появились новые сообщения
      const num = tab.querySelector('a[title="Ссылка на это сообщение"]')?.textContent?.trim() || '#?';
      const author = tab.querySelector('.normalname a')?.textContent?.trim() || tab.querySelector('.normalname')?.textContent?.trim() || 'Гость';
      const date = (tab.querySelector('td.row2[id^="ph-"][id$="-d2"]')?.textContent || '').replace(/\s+Сообщение.*$/, '').replace(/\s+/g, ' ').trim();
      const body = tab.querySelector('.postcolor');
      if (!body) return;
      const temp = body.cloneNode(true);
      temp.querySelectorAll('script, style, .quote, .post-block.code, .attach, .signature, .edit, .post-edit-reason, img, video, iframe').forEach(el => el.remove());
      const text = DL.domToText(temp);
      if (!text) return;
      if (id) seen.add(id);
      out.push(`[${num} | ${author} | ${date}] ${text}`);
    });
    return out;
  };

  DL.register({
    id: '4pda', name: '4PDA', paged: true,
    detect: () => /(^|\.)4pda\.(to|ru)$/.test(location.hostname) && new URL(location.href).searchParams.has('showtopic'),
    async run(opts, ui) {
      const topicId = new URL(location.href).searchParams.get('showtopic');
      const baseUrl = `${location.origin}/forum/index.php?showtopic=${topicId}`;
      const title = (document.querySelector('h1[itemprop="name"]')?.textContent || document.title || '').trim();
      const { perPage, totalPages } = detectPagination();

      const pct = Math.min(100, Math.max(1, parseInt(opts.percent, 10) || 100));
      const count = pct >= 100 ? totalPages : Math.max(1, Math.ceil(totalPages * pct / 100));
      const startPage = totalPages - count, endPage = totalPages - 1;

      const results = new Array(count);
      const seen = new Set();
      let next = startPage, completed = 0, fetched = 0, errors = 0;

      const worker = async () => {
        while (next <= endPage) {
          const page = next++;
          const url = `${baseUrl}&st=${page * perPage}`;
          let ok = false;
          for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
            try {
              const res = await fetch(url, { credentials: 'include' });
              if (res.status === 429 || res.status >= 500) throw new Error('Status ' + res.status);
              if (!res.ok) throw new Error('Status ' + res.status);
              const doc = new DOMParser().parseFromString(await decode1251(res), 'text/html');
              const posts = extractPosts(doc, seen);
              results[page - startPage] = posts;
              fetched += posts.length;
              ok = true;
            } catch (e) {
              console.warn(`4pda: стр. ${page + 1}, попытка ${attempt}/4:`, e.message);
              if (attempt < 4) await DL.sleep(1500 * attempt);
            }
          }
          if (!ok) { errors++; results[page - startPage] = []; }
          completed++;
          ui.update(completed, count, `страниц ${completed}/${count} · сообщений ${fetched}`);
          await DL.sleep(100 + Math.random() * 200);
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));

      const all = results.flat();
      if (!all.length) throw new Error('Ничего не найдено (возможно, нужна авторизация или сработала защита).');
      const header = [
        `Источник: ${title}`, `URL: ${baseUrl}`, `Страниц всего: ${totalPages}`,
        `Скачано: ${pct >= 100 ? 'Все страницы' : `Последние ${pct}% (стр. ${startPage + 1}–${endPage + 1})`}`,
        `Сообщений: ${all.length}`, errors ? `Ошибок: ${errors}` : '', `Дата выгрузки: ${DL.nowYMD()}`, '===================='
      ].filter(Boolean).join('\n') + '\n';
      return { title, text: header + all.join('\n\n') + '\n', count: all.length, siteLabel: '4pda.to' };
    }
  });
})();
