(async () => {
  console.clear();
  const log = (...a) => console.log('[4pda-scraper]', ...a);

  // ── утилиты ──
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const decode1251 = async res => new TextDecoder('windows-1251').decode(await res.arrayBuffer());
  const nowYMD = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const sanitize = s => (s || '').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();

  // ── проверка: мы на странице темы? ──
  const url = new URL(location.href);
  if (!url.searchParams.has('showtopic')) {
    alert('Открой страницу темы (showtopic=...)');
    return;
  }
  const topicId = url.searchParams.get('showtopic');
  const baseUrl = `https://4pda.to/forum/index.php?showtopic=${topicId}`;
  const topicTitle = (document.querySelector('h1[itemprop="name"]')?.textContent || document.title || '').trim();

  // ── определение пагинации (улучшенное) ──
  const detectPagination = () => {
    let perPage = 20;
    let totalPages = 1;

    // 1) ipb_pages_array — самый надёжный источник
    const html = document.documentElement.outerHTML;
    const m = html.match(/ipb_pages_array\[\d+]\s*=\s*\["[^"]+",\s*(\d+),\s*(\d+)\]/);
    if (m) {
      perPage = parseInt(m[1], 10) || 20;
      const lastStart = parseInt(m[2], 10) || 0;
      if (lastStart > 0 && perPage > 0) {
        totalPages = Math.floor(lastStart / perPage) + 1;
      }
    }

    // 2) все ссылки с &st= — собираем максимальный st
    const allStLinks = [...document.querySelectorAll('a[href*="&st="]')];
    const allSt = allStLinks
      .map(a => parseInt((a.href.match(/[?&]st=(\d+)/) || [])[1], 10))
      .filter(Number.isFinite);
    if (allSt.length) {
      const maxSt = Math.max(...allSt);
      const pagesFromLinks = Math.floor(maxSt / perPage) + 1;
      totalPages = Math.max(totalPages, pagesFromLinks);
    }

    // 3) текст «Страниц: N» или «из N» в пагинаторе
    const pagTexts = [...document.querySelectorAll('.pagination, .pagelinks, .pagelink-menu, .topic-pagination')];
    for (const el of pagTexts) {
      const t = el.textContent || '';
      // «N страниц»
      let pm = t.match(/(\d+)\s*страниц/i);
      if (pm) { totalPages = Math.max(totalPages, parseInt(pm[1], 10)); continue; }
      // «из N»
      pm = t.match(/из\s+(\d+)/i);
      if (pm) { totalPages = Math.max(totalPages, parseInt(pm[1], 10)); }
    }

    // 4) числовые ссылки-страницы в пагинаторе (1, 2, … 87)
    const numericPageLinks = [...document.querySelectorAll('.pagination a, .pagelinks a')]
      .map(a => parseInt(a.textContent.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);
    if (numericPageLinks.length) {
      totalPages = Math.max(totalPages, Math.max(...numericPageLinks));
    }

    // 5) sanity
    if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
    totalPages = Math.min(totalPages, 5000);

    return { perPage, totalPages };
  };

  const { perPage, totalPages } = detectPagination();
  log(`Тема: ${topicTitle}`);
  log(`Страниц: ${totalPages}, perPage: ${perPage}`);

  // ── UI: диалог выбора параметров ──
  const userChoice = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = '4pda-scraper-overlay';
    overlay.innerHTML = `
      <style>
        #4pda-scraper-overlay {
          position: fixed; inset: 0; z-index: 999999;
          background: rgba(0,0,0,.55); display: flex;
          align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .scraper-dialog {
          background: #1e1e2e; color: #cdd6f4; border-radius: 14px;
          padding: 28px 32px; width: 420px; max-width: 92vw;
          box-shadow: 0 20px 60px rgba(0,0,0,.5);
        }
        .scraper-dialog h2 { margin: 0 0 6px; font-size: 18px; color: #f5c2e7; }
        .scraper-dialog .subtitle {
          font-size: 13px; color: #a6adc8; margin-bottom: 20px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .scraper-dialog .info-row {
          display: flex; gap: 16px; margin-bottom: 18px;
          font-size: 13px; color: #bac2de;
        }
        .scraper-dialog .info-row span { background: #313244; padding: 4px 10px; border-radius: 6px; }
        .scraper-dialog label { display: block; margin-bottom: 8px; font-size: 14px; cursor: pointer; }
        .scraper-dialog input[type=radio] { margin-right: 8px; accent-color: #cba6f7; }
        .scraper-dialog .range-row {
          display: flex; align-items: center; gap: 12px;
          margin: 12px 0 4px 26px; opacity: .4; transition: opacity .2s;
        }
        .scraper-dialog .range-row.active { opacity: 1; }
        .scraper-dialog input[type=range] { flex: 1; accent-color: #cba6f7; }
        .scraper-dialog .range-val {
          min-width: 60px; text-align: right; font-variant-numeric: tabular-nums;
          font-size: 14px; font-weight: 600; color: #cba6f7;
        }
        .scraper-dialog .hint {
          font-size: 12px; color: #7f849c; margin: 2px 0 16px 26px;
        }
        .scraper-dialog .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 22px; }
        .scraper-dialog button {
          padding: 9px 22px; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; transition: .15s;
        }
        .scraper-dialog .btn-go { background: #cba6f7; color: #1e1e2e; }
        .scraper-dialog .btn-go:hover { background: #b4befe; }
        .scraper-dialog .btn-cancel { background: #45475a; color: #cdd6f4; }
        .scraper-dialog .btn-cancel:hover { background: #585b70; }
      </style>
      <div class="scraper-dialog">
        <h2>📥 4PDA Scraper</h2>
        <div class="subtitle" title="${topicTitle}">${topicTitle}</div>
        <div class="info-row">
          <span>📄 Страниц: <b>${totalPages}</b></span>
          <span>💬 ~${totalPages * perPage} сообщ.</span>
        </div>

        <label><input type="radio" name="mode" value="all" checked> Скачать всё</label>
        <label><input type="radio" name="mode" value="percent"> Часть (% от новых)</label>

        <div class="range-row" id="scraper-range-row">
          <input type="range" id="scraper-pct" min="1" max="100" value="25" step="1">
          <span class="range-val" id="scraper-pct-val">25%</span>
        </div>
        <div class="hint" id="scraper-hint">≈ ${Math.max(1, Math.ceil(totalPages * 0.25))} стр. с конца</div>

        <div class="actions">
          <button class="btn-cancel" id="scraper-cancel">Отмена</button>
          <button class="btn-go" id="scraper-go">Скачать</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const rangeRow = overlay.querySelector('#scraper-range-row');
    const slider = overlay.querySelector('#scraper-pct');
    const pctVal = overlay.querySelector('#scraper-pct-val');
    const hint = overlay.querySelector('#scraper-hint');
    const radios = overlay.querySelectorAll('input[name=mode]');

    const updateUI = () => {
      const isPercent = overlay.querySelector('input[name=mode]:checked').value === 'percent';
      rangeRow.classList.toggle('active', isPercent);
      slider.disabled = !isPercent;
      const pct = parseInt(slider.value, 10);
      const pages = Math.max(1, Math.ceil(totalPages * pct / 100));
      pctVal.textContent = `${pct}%`;
      hint.textContent = `≈ ${pages} стр. с конца (${pages * perPage} сообщ.)`;
      hint.style.opacity = isPercent ? '1' : '.3';
    };
    radios.forEach(r => r.addEventListener('change', updateUI));
    slider.addEventListener('input', updateUI);
    updateUI();

    overlay.querySelector('#scraper-cancel').onclick = () => { overlay.remove(); resolve(null); };
    overlay.querySelector('#scraper-go').onclick = () => {
      const mode = overlay.querySelector('input[name=mode]:checked').value;
      const pct = parseInt(slider.value, 10);
      overlay.remove();
      resolve({ mode, pct });
    };
  });

  if (!userChoice) { log('Отменено'); return; }

  // ── вычисляем диапазон страниц ──
  let startPage, endPage;
  if (userChoice.mode === 'all') {
    startPage = 0;
    endPage = totalPages - 1;
  } else {
    const count = Math.max(1, Math.ceil(totalPages * userChoice.pct / 100));
    startPage = totalPages - count;
    endPage = totalPages - 1;
  }
  const pagesToFetch = endPage - startPage + 1;
  log(`Качаем страницы ${startPage + 1}–${endPage + 1} (${pagesToFetch} шт.)`);

  // ── прогресс-бар ──
  const progress = (() => {
    const bar = document.createElement('div');
    bar.id = '4pda-scraper-progress';
    bar.innerHTML = `
      <style>
        #4pda-scraper-progress {
          position: fixed; bottom: 20px; right: 20px; z-index: 999999;
          background: #1e1e2e; border-radius: 12px; padding: 16px 22px;
          box-shadow: 0 8px 30px rgba(0,0,0,.4); min-width: 280px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #cdd6f4;
        }
        #scraper-prog-title { font-size: 13px; margin-bottom: 8px; }
        #scraper-prog-track {
          height: 6px; background: #313244; border-radius: 3px; overflow: hidden;
        }
        #scraper-prog-fill {
          height: 100%; width: 0%; background: linear-gradient(90deg, #cba6f7, #f5c2e7);
          border-radius: 3px; transition: width .3s;
        }
        #scraper-prog-stats { font-size: 12px; color: #a6adc8; margin-top: 6px; }
      </style>
      <div id="scraper-prog-title">Загрузка...</div>
      <div id="scraper-prog-track"><div id="scraper-prog-fill"></div></div>
      <div id="scraper-prog-stats"></div>
    `;
    document.body.appendChild(bar);

    return {
      update(current, total, posts) {
        const pct = Math.round(current / total * 100);
        bar.querySelector('#scraper-prog-fill').style.width = pct + '%';
        bar.querySelector('#scraper-prog-title').textContent =
          `📥 Страница ${current} / ${total}`;
        bar.querySelector('#scraper-prog-stats').textContent =
          `${pct}% · собрано ${posts} сообщений`;
      },
      done(posts) {
        bar.querySelector('#scraper-prog-fill').style.width = '100%';
        bar.querySelector('#scraper-prog-title').textContent = `✅ Готово!`;
        bar.querySelector('#scraper-prog-stats').textContent = `Сохранено ${posts} сообщений`;
        setTimeout(() => bar.remove(), 4000);
      },
      error(msg) {
        bar.querySelector('#scraper-prog-title').textContent = `❌ ${msg}`;
        setTimeout(() => bar.remove(), 5000);
      }
    };
  })();

  // ── извлечение постов ──
  const extractPosts = doc => {
    const blocks = doc.querySelectorAll('table.ipbtable[data-post]');
    const out = [];
    blocks.forEach(tab => {
      const num = tab.querySelector('a[title="Ссылка на это сообщение"]')?.textContent?.trim() || '#?';
      const author = tab.querySelector('.normalname a')?.textContent?.trim()
        || tab.querySelector('.normalname')?.textContent?.trim() || 'Гость';
      const rawDate = tab.querySelector('td.row2[id^="ph-"][id$="-d2"]')?.textContent || '';
      const date = rawDate.replace(/\s+Сообщение.*$/, '').replace(/\s+/g, ' ').trim();

      const body = tab.querySelector('.postcolor');
      if (!body) return;

      const temp = body.cloneNode(true);
      temp.querySelectorAll('.post-block.quote, .quote').forEach(q => q.remove());
      temp.querySelectorAll('.post-block.spoil .block-body, .spoil .block-body')
        .forEach(b => b.replaceWith(b.innerText || b.textContent || ''));
      temp.querySelectorAll(
        'script, style, .post-block.code, .attach, .signature, .edit, .post-edit-reason'
      ).forEach(el => el.remove());
      temp.querySelectorAll('img, video, iframe, br').forEach(el => {
        el.tagName === 'BR' ? el.replaceWith('\n') : el.remove();
      });

      let text = (temp.innerText || temp.textContent || '')
        .replace(/\r/g, '')
        .replace(/\t+/g, ' ')
        .replace(/\u00A0/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!text) return;
      out.push(`[${num} | ${author} | ${date}] ${text}`);
    });
    return out;
  };

  // ── основной цикл ──
  const all = [];
  let errors = 0;

  for (let i = startPage; i <= endPage; i++) {
    const st = i * perPage;
    const pageUrl = `${baseUrl}&st=${st}`;
    const idx = i - startPage + 1;

    progress.update(idx, pagesToFetch, all.length);

    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (!res.ok) { log(`⚠ ${res.status} — ${pageUrl}`); errors++; continue; }
      const html = await decode1251(res);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      all.push(...extractPosts(doc));
    } catch (e) {
      log('err:', e?.message || e);
      errors++;
    }
    await sleep(200 + Math.random() * 150);
  }

  if (all.length === 0) {
    progress.error('Ничего не найдено. Залогинься на 4PDA.');
    return;
  }

  // ── сохранение ──
  const rangeLabel = userChoice.mode === 'all'
    ? `Все страницы (${totalPages})`
    : `Последние ${userChoice.pct}% (стр. ${startPage + 1}–${endPage + 1})`;

  const header = [
    `Источник: ${topicTitle}`,
    `URL: ${baseUrl}`,
    `Страниц всего: ${totalPages}`,
    `Скачано: ${rangeLabel}`,
    `Сообщений: ${all.length}`,
    errors > 0 ? `Ошибок: ${errors}` : '',
    `Дата выгрузки: ${nowYMD()}`,
    '====================',
  ].filter(Boolean).join('\n') + '\n';

  const content = header + all.join('\n\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${nowYMD()} - [4pda.to] - ${sanitize(topicTitle)}.txt`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);

  progress.done(all.length);
  log(`✔ Готово. Сообщений: ${all.length}, ошибок: ${errors}`);
})();
