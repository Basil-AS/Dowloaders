(async () => {
  console.clear();
  const log = (...a) => console.log('[habr-reddit-parser]', ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const p2 = n => String(n).padStart(2, '0');
  const nowYMD = () => {
    const d = new Date();
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };
  const sanitize = s => (s || '').replace(/[<>:"/\\|?*\n\r]/g, '-').replace(/\s+/g, ' ').trim() || 'untitled';
  const fmtDate = v => {
    if (v == null || v === '') return '';
    const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleString('ru-RU');
  };
  const SEP = '================================================================';

  // ── HTML → текст (ссылки, код, списки, цитаты, картинки сохраняются) ──
  const htmlToText = html => {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const walk = node => {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'noscript'].includes(tag)) return '';
      if (tag === 'br') return '\n';
      if (tag === 'img') {
        const src = node.getAttribute('data-src') || node.getAttribute('src') || '';
        return src ? `[img: ${src}]` : '';
      }
      if (tag === 'pre') return `\n\`\`\`\n${node.textContent.replace(/\n$/, '')}\n\`\`\`\n`;
      const inner = () => Array.from(node.childNodes).map(walk).join('');
      if (tag === 'a') {
        const t = inner().trim();
        const h = node.getAttribute('href') || '';
        return !h || h.startsWith('#') || t === h ? t : `${t} (${h})`;
      }
      if (tag === 'li') return `\n• ${inner().trim()}`;
      if (tag === 'blockquote') return '\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n';
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(+tag[1])} ${inner().trim()}\n`;
      if (['p', 'div', 'ul', 'ol', 'table', 'tr', 'figure', 'figcaption'].includes(tag)) return `\n${inner()}\n`;
      if (tag === 'td' || tag === 'th') return inner().trim() + '\t';
      return inner();
    };
    return walk(doc.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  const getJSON = async (url, tries = 3) => {
    for (let i = 1; i <= tries; i++) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (res.status === 429 && i < tries) { await sleep(2000 * i); continue; }
        if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
        return await res.json();
      } catch (e) {
        if (i === tries || (e.status >= 400 && e.status < 500 && e.status !== 429)) throw e;
        await sleep(500 * i);
      }
    }
  };

  const indent = (text, level) => {
    const pad = '    '.repeat(level);
    return text.split('\n').map(l => pad + l).join('\n');
  };

  // ── HABR ──
  const parseHabr = async () => {
    const m = location.pathname.match(/\/(?:articles|news|companies\/[^/]+\/articles|post|blog)\/(\d+)/)
      || location.pathname.match(/\/(\d+)\/?$/);
    if (!m) throw new Error('Не удалось определить ID статьи Хабра');
    const id = m[1];
    const lang = location.pathname.split('/')[1] === 'en' ? 'en' : 'ru';
    const base = `${location.origin}/kek/v2/articles/${id}/`;
    const q = `?fl=${lang}&hl=${lang}`;

    log('📥 Загружаю статью', id);
    const art = await getJSON(base + q);
    const title = htmlToText(art.titleHtml || art.title || '');

    let out = `Статья: ${title}\nURL: ${location.href}\n`;
    out += `Автор: ${art.author?.alias || art.author?.login || '—'}\n`;
    out += `Дата: ${fmtDate(art.timePublished)}\n`;
    if (art.statistics) {
      const s = art.statistics;
      out += `Рейтинг: ${s.score ?? '—'} | Просмотры: ${s.readingCount ?? '—'} | В закладках: ${s.favoritesCount ?? '—'} | Комментариев: ${s.commentsCount ?? '—'}\n`;
    }
    const tags = [...(art.hubs || []).map(h => 'хаб:' + h.title), ...(art.tags || []).map(t => t.titleHtml || t.title)];
    if (tags.length) out += `Теги/хабы: ${tags.join(', ')}\n`;
    out += `${SEP}\n\n${htmlToText(art.textHtml || '')}\n\n${SEP}\n\n`;

    log('📥 Загружаю комментарии...');
    let comments = {}, threads = [];
    try {
      const c = await getJSON(base + 'comments/' + q);
      comments = c.comments || {};
      threads = c.threads || [];
    } catch (e) {
      log('⚠️ Комментарии не загружены:', e.message);
    }

    const list = Object.values(comments);
    const children = {};
    for (const c of list) (children[c.parentId || 0] ||= []).push(c);
    Object.values(children).forEach(a => a.sort((x, y) => new Date(x.timePublished) - new Date(y.timePublished) || x.id - y.id));
    const roots = threads.length ? threads.map(i => comments[i]).filter(Boolean) : (children[0] || []);

    out += `КОММЕНТАРИИ (${list.length})\n${SEP}\n\n`;
    let n = 0;
    const emit = (c, level) => {
      n++;
      const score = c.score != null ? ` | ${c.score > 0 ? '+' : ''}${c.score}` : '';
      const head = `--- [ #${c.id} | ${c.author?.alias || 'удалён'} | ${fmtDate(c.timePublished)}${score} ] ---`;
      const body = c.isSuspended ? '[комментарий скрыт]' : htmlToText(c.message || c.messageHtml || '');
      out += indent(`${head}\n${body}`, level) + '\n\n';
      (children[c.id] || []).forEach(ch => emit(ch, level + 1));
    };
    roots.forEach(r => emit(r, 0));
    // осиротевшие (если родитель не пришёл)
    list.filter(c => c.parentId && !comments[c.parentId]).forEach(c => emit(c, 1));

    log(`✅ Habr: комментариев ${n}`);
    return { title, text: out, site: 'habr.com' };
  };

  // ── REDDIT ──
  const parseRedditJSON = async () => {
    const m = location.pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (!m) throw new Error('Не удалось определить ID поста Reddit');
    const id = m[1];
    const sub = (location.pathname.match(/\/r\/([^/]+)/) || [])[1] || '';
    const origin = location.origin;

    log('📥 Загружаю пост', id);
    const data = await getJSON(`${origin}/comments/${id}.json?limit=500&depth=100&raw_json=1&sort=top`)
      .catch(() => getJSON(`${origin}${location.pathname.replace(/\/$/, '')}.json?limit=500&raw_json=1`));
    const post = data[0].data.children[0].data;
    const title = post.title;

    let out = `Пост: ${title}\nURL: ${location.href}\n`;
    out += `Сабреддит: r/${post.subreddit || sub} | Автор: u/${post.author}\n`;
    out += `Дата: ${fmtDate(post.created_utc)} | Рейтинг: ${post.score} | Комментариев: ${post.num_comments}\n`;
    if (post.url && !post.is_self) out += `Ссылка: ${post.url}\n`;
    out += `${SEP}\n\n${post.selftext || '(без текста)'}\n\n${SEP}\n\n`;

    // раскрываем "more": сначала в корне, потом внутри веток
    const fetchMore = async ids => {
      const res = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
          const j = await getJSON(`${origin}/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${id}&children=${chunk.join(',')}`);
          res.push(...(j.json?.data?.things || []));
        } catch (e) { log('⚠️ morechildren:', e.message); }
        await sleep(400);
      }
      return res;
    };

    // плоский словарь: name -> node, дерево по parent_id
    const nodes = {};
    const order = [];
    const pendingMore = [];
    const collect = children => {
      for (const ch of children || []) {
        if (ch.kind === 't1') {
          nodes[ch.data.name] = ch.data;
          order.push(ch.data.name);
          const r = ch.data.replies;
          if (r && r.data) collect(r.data.children);
        } else if (ch.kind === 'more') {
          pendingMore.push(ch.data);
        }
      }
    };
    collect(data[1].data.children);

    let rounds = 0;
    while (pendingMore.length && rounds++ < 30) {
      const ids = [...new Set(pendingMore.splice(0).flatMap(x => x.children || []))].filter(i => !nodes['t1_' + i]);
      if (!ids.length) break;
      log(`📥 Подгружаю ещё ${ids.length} комментариев...`);
      const things = await fetchMore(ids);
      collect(things.map(t => ({ kind: t.kind, data: t.data })));
    }

    const kids = {};
    for (const name of order) {
      const c = nodes[name];
      (kids[c.parent_id] ||= []).push(c);
    }
    let n = 0;
    const emit = (c, level) => {
      n++;
      const flair = c.author_flair_text ? ` [${c.author_flair_text}]` : '';
      const head = `--- [ u/${c.author}${flair} | ${fmtDate(c.created_utc)} | ${c.score} ] ---`;
      out += indent(`${head}\n${(c.body || '').trim()}`, level) + '\n\n';
      (kids['t1_' + c.id] || []).forEach(ch => emit(ch, level + 1));
    };
    out += `КОММЕНТАРИИ\n${SEP}\n\n`;
    (kids['t3_' + id] || []).forEach(c => emit(c, 0));
    // осиротевшие
    Object.keys(kids).filter(k => k.startsWith('t1_') && !nodes[k]).forEach(k => kids[k].forEach(c => emit(c, 1)));

    out += `(собрано комментариев: ${n} из ${post.num_comments})\n`;
    log(`✅ Reddit: комментариев ${n} из ${post.num_comments}`);
    return { title, text: out, site: location.hostname.replace(/^(www|old|new)\./, '') };
  };


  // Запасной вариант: Reddit режет .json (403) — разбираем уже отрисованную страницу (shreddit).
  const parseRedditDOM = async () => {
    const postEl = document.querySelector('shreddit-post');
    if (!postEl) throw new Error('На странице нет поста (shreddit-post). Открой пост целиком и повтори.');
    const attr = (el, n) => el.getAttribute(n) || '';

    // раскрываем «ещё комментарии / ответы»
    const MORE = /more repl|more comment|view more|ещ[её] \d*\s*(ответ|коммент)|больше (коммент|ответ)|посмотреть (ещ|больш)|показать ещ/i;
    for (let round = 0; round < 40; round++) {
      const btns = Array.from(document.querySelectorAll('shreddit-comment-tree button, shreddit-comment button, faceplate-partial button'))
        .filter(b => MORE.test(b.textContent || '') && !b.dataset.__clicked);
      if (!btns.length) break;
      log(`📥 Раскрываю ещё ветки: ${btns.length}`);
      btns.forEach(b => { b.dataset.__clicked = '1'; b.click(); });
      await sleep(1500);
    }

    const title = attr(postEl, 'post-title') || document.title;
    const body = postEl.querySelector('[slot="text-body"]');
    let out = `Пост: ${title}\nURL: ${location.href}\n`;
    out += `Сабреддит: ${attr(postEl, 'subreddit-prefixed-name')} | Автор: u/${attr(postEl, 'author')}\n`;
    out += `Дата: ${fmtDate(attr(postEl, 'created-timestamp'))} | Рейтинг: ${attr(postEl, 'score')} | Комментариев: ${attr(postEl, 'comment-count')}\n`;
    out += `${SEP}\n\n${body ? htmlToText(body.innerHTML) : '(без текста)'}\n\n${SEP}\n\nКОММЕНТАРИИ\n${SEP}\n\n`;

    let n = 0;
    document.querySelectorAll('shreddit-comment').forEach(c => {
      const txt = c.querySelector(':scope > [slot="comment"]');
      if (!txt) return;
      n++;
      const level = parseInt(attr(c, 'depth'), 10) || 0;
      const date = c.querySelector(':scope > [slot="commentMeta"] time, time')?.getAttribute('datetime') || attr(c, 'created');
      const head = `--- [ u/${attr(c, 'author') || 'удалён'} | ${fmtDate(date)} | ${attr(c, 'score')} ] ---`;
      out += indent(`${head}\n${htmlToText(txt.innerHTML)}`, level) + '\n\n';
    });
    out += `(собрано комментариев: ${n} из ${attr(postEl, 'comment-count')})\n`;
    log(`✅ Reddit (DOM): комментариев ${n}`);
    return { title, text: out, site: location.hostname.replace(/^(www|old|new)\./, '') };
  };

  const parseReddit = async () => {
    try {
      return await parseRedditJSON();
    } catch (e) {
      log(`⚠️ JSON недоступен (${e.message}), разбираю страницу напрямую...`);
      return await parseRedditDOM();
    }
  };

  // ── запуск ──
  let result;
  try {
    if (/(^|\.)habr\.com$/.test(location.hostname)) result = await parseHabr();
    else if (/(^|\.)reddit\.com$/.test(location.hostname)) result = await parseReddit();
    else { alert('Открой страницу статьи на habr.com или поста на reddit.com'); return; }
  } catch (e) {
    console.error('❌ Ошибка:', e);
    return;
  }

  const filename = `${nowYMD()} - [${result.site}] - ${sanitize(result.title).slice(0, 120)}.txt`;
  try {
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    log(`✅ Файл '${filename}' создан`);
  } catch (e) {
    console.error('❌ Не удалось создать файл:', e);
  }
  window.__lastParse = { filename, text: result.text };
  try { copy(result.text); log('📋 Скопировано в буфер обмена'); } catch (e) {}
})();
