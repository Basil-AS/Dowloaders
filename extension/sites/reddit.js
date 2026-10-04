(() => {
  const DL = window.__DL;
  const siteLabel = () => location.hostname.replace(/^(www|old|new)\./, '');

  const viaJSON = async (ui) => {
    const id = location.pathname.match(/\/comments\/([a-z0-9]+)/i)[1];
    const origin = location.origin;
    ui.status('Пост...');
    const data = await DL.getJSON(`${origin}/comments/${id}.json?limit=500&depth=100&raw_json=1&sort=top`)
      .catch(() => DL.getJSON(`${origin}${location.pathname.replace(/\/$/, '')}.json?limit=500&raw_json=1`));
    const post = data[0].data.children[0].data;

    let out = `Пост: ${post.title}\nURL: ${location.href}\n`;
    out += `Сабреддит: r/${post.subreddit} | Автор: u/${post.author}\n`;
    out += `Дата: ${DL.fmtDate(post.created_utc)} | Рейтинг: ${post.score} | Комментариев: ${post.num_comments}\n`;
    if (post.url && !post.is_self) out += `Ссылка: ${post.url}\n`;
    out += `${DL.SEP}\n\n${post.selftext || '(без текста)'}\n\n${DL.SEP}\n\n`;

    const nodes = {}, order = [], pendingMore = [];
    const collect = children => {
      for (const ch of children || []) {
        if (ch.kind === 't1') {
          nodes[ch.data.name] = ch.data;
          order.push(ch.data.name);
          if (ch.data.replies && ch.data.replies.data) collect(ch.data.replies.data.children);
        } else if (ch.kind === 'more') pendingMore.push(ch.data);
      }
    };
    collect(data[1].data.children);

    for (let round = 0; pendingMore.length && round < 30; round++) {
      const ids = [...new Set(pendingMore.splice(0).flatMap(x => x.children || []))].filter(i => !nodes['t1_' + i]);
      if (!ids.length) break;
      ui.status(`Подгружаю ещё ${ids.length} комментариев...`);
      for (let i = 0; i < ids.length; i += 100) {
        try {
          const j = await DL.getJSON(`${origin}/api/morechildren.json?api_type=json&raw_json=1&link_id=t3_${id}&children=${ids.slice(i, i + 100).join(',')}`);
          collect((j.json?.data?.things || []).map(t => ({ kind: t.kind, data: t.data })));
        } catch (e) { console.warn('morechildren:', e.message); }
        await DL.sleep(400);
      }
    }

    const kids = {};
    for (const name of order) (kids[nodes[name].parent_id] ||= []).push(nodes[name]);
    let n = 0;
    const emit = (c, level) => {
      n++;
      const flair = c.author_flair_text ? ` [${c.author_flair_text}]` : '';
      out += DL.indent(`--- [ u/${c.author}${flair} | ${DL.fmtDate(c.created_utc)} | ${c.score} ] ---\n${(c.body || '').trim()}`, level) + '\n\n';
      (kids['t1_' + c.id] || []).forEach(ch => emit(ch, level + 1));
    };
    out += `КОММЕНТАРИИ\n${DL.SEP}\n\n`;
    (kids['t3_' + id] || []).forEach(c => emit(c, 0));
    Object.keys(kids).filter(k => k.startsWith('t1_') && !nodes[k]).forEach(k => kids[k].forEach(c => emit(c, 1)));
    out += `(собрано комментариев: ${n} из ${post.num_comments})\n`;
    return { title: post.title, text: out, count: n, siteLabel: siteLabel() };
  };

  // Reddit может отдавать 403 на .json — тогда разбираем уже отрисованную страницу (shreddit)
  const viaDOM = async (ui) => {
    const postEl = document.querySelector('shreddit-post');
    if (!postEl) throw new Error('Не нашёл пост на странице. Открой пост целиком и повтори.');
    const attr = (el, n) => el.getAttribute(n) || '';
    const MORE = /more repl|more comment|view more|ещ[её] \d*\s*(ответ|коммент)|больше (коммент|ответ)|посмотреть (ещ|больш)|показать ещ/i;
    for (let round = 0; round < 40; round++) {
      const btns = Array.from(document.querySelectorAll('shreddit-comment-tree button, shreddit-comment button, faceplate-partial button'))
        .filter(b => MORE.test(b.textContent || '') && !b.dataset.fasClicked);
      if (!btns.length) break;
      ui.status(`Раскрываю ветки: ${btns.length}`);
      btns.forEach(b => { b.dataset.fasClicked = '1'; b.click(); });
      await DL.sleep(1500);
    }
    const title = attr(postEl, 'post-title') || document.title;
    const body = postEl.querySelector('[slot="text-body"]');
    let out = `Пост: ${title}\nURL: ${location.href}\n`;
    out += `Сабреддит: ${attr(postEl, 'subreddit-prefixed-name')} | Автор: u/${attr(postEl, 'author')}\n`;
    out += `Дата: ${DL.fmtDate(attr(postEl, 'created-timestamp'))} | Рейтинг: ${attr(postEl, 'score')} | Комментариев: ${attr(postEl, 'comment-count')}\n`;
    out += `${DL.SEP}\n\n${body ? DL.domToText(body) : '(без текста)'}\n\n${DL.SEP}\n\nКОММЕНТАРИИ\n${DL.SEP}\n\n`;
    let n = 0;
    document.querySelectorAll('shreddit-comment').forEach(c => {
      const txt = c.querySelector(':scope > [slot="comment"]');
      if (!txt) return;
      n++;
      const date = c.querySelector(':scope > [slot="commentMeta"] time, time')?.getAttribute('datetime') || attr(c, 'created');
      out += DL.indent(`--- [ u/${attr(c, 'author') || 'удалён'} | ${DL.fmtDate(date)} | ${attr(c, 'score')} ] ---\n${DL.domToText(txt)}`, parseInt(attr(c, 'depth'), 10) || 0) + '\n\n';
    });
    out += `(собрано комментариев: ${n} из ${attr(postEl, 'comment-count')})\n`;
    return { title, text: out, count: n, siteLabel: siteLabel() };
  };

  DL.register({
    id: 'reddit', name: 'Reddit',
    detect: () => /(^|\.)reddit\.com$/.test(location.hostname) && /\/comments\/[a-z0-9]+/i.test(location.pathname),
    async run(opts, ui) {
      try { return await viaJSON(ui); }
      catch (e) { ui.status(`JSON недоступен (${e.message}), читаю страницу...`); return await viaDOM(ui); }
    }
  });
})();
