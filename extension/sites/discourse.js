// Любой форум на движке Discourse (ntc.party, meta.discourse.org, и т.д.).
(() => {
  const DL = window.__DL;

  const isDiscourse = () =>
    !!document.querySelector('meta[name="generator"][content^="Discourse"]') ||
    !!document.querySelector('#data-discourse-setup, meta[name="discourse_theme_id"], meta[name="discourse_current_homepage"]') ||
    document.body.classList.contains('discourse-no-touch') || document.body.classList.contains('discourse-touch');

  const topicIdFromPath = () => {
    const m = location.pathname.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?\/?$/) || location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return m ? m[1] : null;
  };

  // цитаты Discourse: <aside class="quote"> → "> Автор:" + текст
  const cookedToText = html => {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    doc.querySelectorAll('aside.quote').forEach(q => {
      const who = (q.querySelector('.title')?.textContent || '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
      const bq = document.createElement('blockquote');
      bq.textContent = (who ? who + ':\n' : '') + (q.querySelector('blockquote')?.textContent || '').trim();
      q.replaceWith(bq);
    });
    doc.querySelectorAll('div.meta, .lightbox-wrapper .meta, .onebox-metadata').forEach(e => e.remove());
    doc.querySelectorAll('a.lightbox').forEach(a => {
      const img = a.querySelector('img');
      if (img) a.replaceWith(Object.assign(document.createElement('span'), { textContent: `[img: ${a.getAttribute('href') || img.src}]` }));
    });
    return DL.domToText(doc.body);
  };

  DL.register({
    id: 'discourse', name: 'Discourse-форум', paged: true,
    detect: () => isDiscourse() && !!topicIdFromPath(),
    async run(opts, ui) {
      const id = topicIdFromPath();
      const base = `${location.origin}/t/${id}`;
      ui.status('Тема...');
      const topic = await DL.getJSON(`${base}.json`);
      const stream = topic.post_stream?.stream || [];
      const title = topic.title || topic.fancy_title || document.title;

      const pct = Math.min(100, Math.max(1, parseInt(opts.percent, 10) || 100));
      const wanted = pct >= 100 ? stream : stream.slice(stream.length - Math.max(1, Math.ceil(stream.length * pct / 100)));

      const byId = {};
      (topic.post_stream.posts || []).forEach(p => { byId[p.id] = p; });
      const missing = wanted.filter(i => !byId[i]);
      const chunks = [];
      for (let i = 0; i < missing.length; i += 20) chunks.push(missing.slice(i, i + 20));

      let done = 0, next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const ch = chunks[next++];
          try {
            const j = await DL.getJSON(`${base}/posts.json?${ch.map(i => 'post_ids[]=' + i).join('&')}&include_suggested=false`);
            (j.post_stream?.posts || []).forEach(p => { byId[p.id] = p; });
          } catch (e) { console.warn('Discourse: чанк не загружен:', e.message); }
          ui.update(++done, chunks.length, `загружено блоков ${done}/${chunks.length}`);
          await DL.sleep(150);
        }
      };
      await Promise.all(Array.from({ length: 3 }, worker));

      const posts = wanted.map(i => byId[i]).filter(Boolean);
      const lost = wanted.length - posts.length;
      const tags = (topic.tags || []).map(t => (typeof t === 'string' ? t : t.name)).join(', ');
      let out = `Тема: ${title}\nURL: ${location.origin}/t/${topic.slug || ''}/${id}\n`;
      out += `Всего постов: ${stream.length}${pct < 100 ? ` | Скачано: последние ${pct}% (${posts.length})` : ''}\n`;
      out += `Создана: ${DL.fmtDate(topic.created_at)} | Просмотров: ${topic.views ?? '—'} | Лайков: ${topic.like_count ?? '—'}\n`;
      if (tags) out += `Теги: ${tags}\n`;
      if (lost) out += `Не удалось загрузить постов: ${lost}\n`;
      out += `${DL.SEP}\n\n`;

      for (const p of posts) {
        const likes = (p.actions_summary || []).find(a => a.id === 2)?.count || 0;
        const reply = p.reply_to_post_number ? ` | ответ на #${p.reply_to_post_number}` : '';
        const name = p.name && p.name !== p.username ? ` (${p.name})` : '';
        const text = p.hidden ? '[пост скрыт]' : cookedToText(p.cooked);
        out += `--- [ Пост #${p.post_number} | ${p.username}${name} | ${DL.fmtDate(p.created_at)}${reply}${likes ? ` | ♥ ${likes}` : ''} ] ---\n\n${text}\n\n${DL.SEP}\n\n`;
      }
      return { title, text: out, count: posts.length, siteLabel: location.hostname };
    }
  });
})();
