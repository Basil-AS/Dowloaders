(async () => {
  console.clear();
  const log = (...a) => console.log('[4pda-scraper]', ...a);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const decode1251 = async res => new TextDecoder('windows-1251').decode(await res.arrayBuffer());
  const nowYMD = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const sanitize = s => (s || '').replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim();

  // ── проверка ──
  const url = new URL(location.href);
  if (!url.searchParams.has('showtopic')) {
    alert('Открой страницу темы (showtopic=...)');
    return;
  }
  const topicId = url.searchParams.get('showtopic');
  const baseUrl = 'https://4pda.to/forum/index.php?showtopic=' + topicId;
  const topicTitle = (document.querySelector('h1[itemprop="name"]')?.textContent || document.title || '').trim();

  // ── пагинация (ИСПРАВЛЕНО) ──
  const detectPagination = () => {
    let perPage = 20; // по умолчанию на 4pda
    let totalPages = 1;

    // 1. Попытка достать системные переменные форума (исправлена регулярка под [ipb_pages_shown])
    try {
      const html = document.documentElement.outerHTML;
      const m = html.match(/ipb_pages_array\[.*?\]\s*=\s*\[\s*["'][^"']+["']\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
      if (m) {
        perPage = parseInt(m[1], 10) || 20;
      }
    } catch (e) { log('ipb_pages_array parse error', e); }

    // 2. Надежный поиск по тексту вида "3059 страниц" в кнопке меню
    const pageJumpSpan = document.querySelector('span[id^="page-jump"]');
    if (pageJumpSpan) {
      const m = pageJumpSpan.textContent.match(/(\d+)\s*страниц/i);
      if (m) {
        totalPages = Math.max(totalPages, parseInt(m[1], 10));
      }
    }

    // 3. Запасной вариант (Fallback) - анализ ссылок пагинации по параметру &st=
    const allSt = [];
    document.querySelectorAll('a[href*="&st="], a[href*="?st="]').forEach(a => {
      const m = a.href.match(/[?&]st=(\d+)/);
      if (m) allSt.push(parseInt(m[1], 10));
    });
    
    const validSt = allSt.filter(Number.isFinite);
    if (validSt.length) {
      const maxSt = Math.max(...validSt);
      totalPages = Math.max(totalPages, Math.floor(maxSt / perPage) + 1);
    }

    if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = 1;
    totalPages = Math.min(totalPages, 50000); // Увеличен лимит для гигантских тем на 4PDA
    return { perPage, totalPages };
  };

  const { perPage, totalPages } = detectPagination();
  log('Тема:', topicTitle);
  log('Страниц:', totalPages, 'perPage:', perPage);

  // ── UI диалог ──
  document.querySelector('.scraper-overlay')?.remove();

  const userChoice = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'scraper-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      zIndex: '2147483647', background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    });

    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
      background: '#1e1e2e', color: '#cdd6f4', borderRadius: '14px',
      padding: '28px 32px', width: '420px', maxWidth: '92vw',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
    });

    const escTitle = topicTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    dialog.innerHTML = [
      '<div style="margin:0 0 6px;font-size:18px;font-weight:700;color:#f5c2e7">\u{1F4E5} 4PDA Scraper</div>',
      '<div style="font-size:13px;color:#a6adc8;margin-bottom:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escTitle + '">' + escTitle + '</div>',
      '<div style="display:flex;gap:16px;margin-bottom:18px;font-size:13px;color:#bac2de">',
        '<span style="background:#313244;padding:4px 10px;border-radius:6px">\u{1F4C4} Страниц: <b>' + totalPages + '</b></span>',
        '<span style="background:#313244;padding:4px 10px;border-radius:6px">\u{1F4AC} ~' + (totalPages * perPage) + ' сообщ.</span>',
      '</div>',

      '<label style="display:block;margin-bottom:8px;font-size:14px;cursor:pointer">',
        '<input type="radio" name="scr-mode" value="all" checked style="margin-right:8px;accent-color:#cba6f7"> Скачать всё',
      '</label>',
      '<label style="display:block;margin-bottom:8px;font-size:14px;cursor:pointer">',
        '<input type="radio" name="scr-mode" value="percent" style="margin-right:8px;accent-color:#cba6f7"> Часть (% от новых)',
      '</label>',

      '<div class="scr-range-row" style="display:flex;align-items:center;gap:12px;margin:12px 0 4px 26px;opacity:0.4">',
        '<input type="range" class="scr-pct" min="1" max="100" value="25" step="1" disabled style="flex:1;accent-color:#cba6f7">',
        '<span class="scr-pct-val" style="min-width:60px;text-align:right;font-size:14px;font-weight:600;color:#cba6f7">25%</span>',
      '</div>',
      '<div class="scr-hint" style="font-size:12px;color:#7f849c;margin:2px 0 16px 26px;opacity:0.3">\u2248 ' + Math.max(1, Math.ceil(totalPages * 0.25)) + ' стр. с конца</div>',

      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px">',
        '<button class="scr-cancel" style="padding:9px 22px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#45475a;color:#cdd6f4">Отмена</button>',
        '<button class="scr-go" style="padding:9px 22px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#cba6f7;color:#1e1e2e">Скачать</button>',
      '</div>',
    ].join('');

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const rangeRow = dialog.querySelector('.scr-range-row');
    const slider = dialog.querySelector('.scr-pct');
    const pctVal = dialog.querySelector('.scr-pct-val');
    const hint = dialog.querySelector('.scr-hint');

    const updateUI = () => {
      const isPercent = dialog.querySelector('input[name="scr-mode"]:checked').value === 'percent';
      rangeRow.style.opacity = isPercent ? '1' : '0.4';
      hint.style.opacity = isPercent ? '1' : '0.3';
      slider.disabled = !isPercent;
      const pct = parseInt(slider.value, 10);
      const pages = Math.max(1, Math.ceil(totalPages * pct / 100));
      pctVal.textContent = pct + '%';
      hint.textContent = '\u2248 ' + pages + ' стр. с конца (' + (pages * perPage) + ' сообщ.)';
    };

    dialog.querySelectorAll('input[name="scr-mode"]').forEach(r => {
      r.addEventListener('change', updateUI);
    });
    slider.addEventListener('input', updateUI);

    dialog.querySelector('.scr-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    dialog.querySelector('.scr-go').addEventListener('click', () => {
      const mode = dialog.querySelector('input[name="scr-mode"]:checked').value;
      const pct = parseInt(slider.value, 10);
      overlay.remove();
      resolve({ mode, pct });
    });
  });

  if (!userChoice) { log('Отменено'); return; }

  // ── диапазон страниц ──
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
  log('Качаем стр. ' + (startPage + 1) + '\u2013' + (endPage + 1) + ' (' + pagesToFetch + ' шт.)');

  // ── прогресс-бар ──
  document.querySelector('.scraper-progress')?.remove();

  const progEl = document.createElement('div');
  progEl.className = 'scraper-progress';
  Object.assign(progEl.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
    background: '#1e1e2e', borderRadius: '12px', padding: '16px 22px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)', minWidth: '280px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#cdd6f4'
  });
  progEl.innerHTML = [
    '<div class="scr-p-title" style="font-size:13px;margin-bottom:8px">Загрузка...</div>',
    '<div style="height:6px;background:#313244;border-radius:3px;overflow:hidden">',
      '<div class="scr-p-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#cba6f7,#f5c2e7);border-radius:3px;transition:width .3s"></div>',
    '</div>',
    '<div class="scr-p-stats" style="font-size:12px;color:#a6adc8;margin-top:6px"></div>',
  ].join('');
  document.body.appendChild(progEl);

  const progress = {
    update(cur, total, posts) {
      const pct = Math.round(cur / total * 100);
      progEl.querySelector('.scr-p-fill').style.width = pct + '%';
      progEl.querySelector('.scr-p-title').textContent = '\u{1F4E5} Страница ' + cur + ' / ' + total;
      progEl.querySelector('.scr-p-stats').textContent = pct + '% \u00B7 собрано ' + posts + ' сообщений';
    },
    done(posts) {
      progEl.querySelector('.scr-p-fill').style.width = '100%';
      progEl.querySelector('.scr-p-title').textContent = '\u2705 Готово!';
      progEl.querySelector('.scr-p-stats').textContent = 'Сохранено ' + posts + ' сообщений';
      setTimeout(() => progEl.remove(), 4000);
    },
    error(msg) {
      progEl.querySelector('.scr-p-title').textContent = '\u274C ' + msg;
      setTimeout(() => progEl.remove(), 5000);
    }
  };

  // ── извлечение постов ──
  const extractPosts = doc => {
    const blocks = doc.querySelectorAll('table.ipbtable[data-post]');
    const out = [];
    blocks.forEach(tab => {
      const num = tab.querySelector('a[title="\u0421\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u044D\u0442\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435"]')?.textContent?.trim() || '#?';
      const author = tab.querySelector('.normalname a')?.textContent?.trim()
        || tab.querySelector('.normalname')?.textContent?.trim() || '\u0413\u043E\u0441\u0442\u044C';
      const rawDate = tab.querySelector('td.row2[id^="ph-"][id$="-d2"]')?.textContent || '';
      const date = rawDate.replace(/\s+\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435.*$/, '').replace(/\s+/g, ' ').trim();

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
      out.push('[' + num + ' | ' + author + ' | ' + date + '] ' + text);
    });
    return out;
  };

  // ── основной цикл ──
  const all = [];
  let errors = 0;

  for (let i = startPage; i <= endPage; i++) {
    const st = i * perPage;
    const pageUrl = baseUrl + '&st=' + st;
    const idx = i - startPage + 1;

    progress.update(idx, pagesToFetch, all.length);

    try {
      const res = await fetch(pageUrl, { credentials: 'include' });
      if (!res.ok) { log('\u26A0 ' + res.status + ' \u2014 ' + pageUrl); errors++; continue; }
      const html = await decode1251(res);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      all.push(...extractPosts(doc));
    } catch (e) {
      log('err:', e?.message || e);
      errors++;
    }
    // Немного увеличил таймаут загрузки, чтобы защита от ддоса 4PDA не резала запросы
    await sleep(300 + Math.random() * 300);
  }

  if (all.length === 0) {
    progress.error('\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E. \u0417\u0430\u043B\u043E\u0433\u0438\u043D\u044C\u0441\u044F \u043D\u0430 4PDA.');
    return;
  }

  // ── сохранение ──
  const rangeLabel = userChoice.mode === 'all'
    ? '\u0412\u0441\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B (' + totalPages + ')'
    : '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 ' + userChoice.pct + '% (\u0441\u0442\u0440. ' + (startPage + 1) + '\u2013' + (endPage + 1) + ')';

  const header = [
    '\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ' + topicTitle,
    'URL: ' + baseUrl,
    '\u0421\u0442\u0440\u0430\u043D\u0438\u0446 \u0432\u0441\u0435\u0433\u043E: ' + totalPages,
    '\u0421\u043A\u0430\u0447\u0430\u043D\u043E: ' + rangeLabel,
    '\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: ' + all.length,
    errors > 0 ? '\u041E\u0448\u0438\u0431\u043E\u043A: ' + errors : '',
    '\u0414\u0430\u0442\u0430 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438: ' + nowYMD(),
    '====================',
  ].filter(Boolean).join('\n') + '\n';

  const content = header + all.join('\n\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: nowYMD() + ' - [4pda.to] - ' + sanitize(topicTitle) + '.txt',
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);

  progress.done(all.length);
  log('\u2714 \u0413\u043E\u0442\u043E\u0432\u043E. \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439: ' + all.length + ', \u043E\u0448\u0438\u0431\u043E\u043A: ' + errors);
})();
