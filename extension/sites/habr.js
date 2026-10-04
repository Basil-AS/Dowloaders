(() => {
  const DL = window.__DL;
  DL.register({
    id: 'habr', name: 'Хабр',
    detect: () => /(^|\.)habr\.com$/.test(location.hostname) && /\/(articles|news|post|blog)\/\d+|\/\d+\/?$/.test(location.pathname),
    async run(opts, ui) {
      const m = location.pathname.match(/\/(?:articles|news|companies\/[^/]+\/articles|post|blog)\/(\d+)/) || location.pathname.match(/\/(\d+)\/?$/);
      const id = m[1];
      const lang = location.pathname.split('/')[1] === 'en' ? 'en' : 'ru';
      const base = `${location.origin}/kek/v2/articles/${id}/`;
      const q = `?fl=${lang}&hl=${lang}`;

      ui.status('Статья...');
      const art = await DL.getJSON(base + q);
      const title = DL.htmlToText(art.titleHtml || art.title || '');
      let out = `Статья: ${title}\nURL: ${location.href}\n`;
      out += `Автор: ${art.author?.alias || art.author?.login || '—'}\nДата: ${DL.fmtDate(art.timePublished)}\n`;
      if (art.statistics) {
        const s = art.statistics;
        out += `Рейтинг: ${s.score ?? '—'} | Просмотры: ${s.readingCount ?? '—'} | В закладках: ${s.favoritesCount ?? '—'} | Комментариев: ${s.commentsCount ?? '—'}\n`;
      }
      const tags = [...(art.hubs || []).map(h => 'хаб:' + h.title), ...(art.tags || []).map(t => t.titleHtml || t.title)];
      if (tags.length) out += `Теги/хабы: ${tags.join(', ')}\n`;
      out += `${DL.SEP}\n\n${DL.htmlToText(art.textHtml || '')}\n\n${DL.SEP}\n\n`;

      ui.status('Комментарии...');
      let comments = {}, threads = [];
      try {
        const c = await DL.getJSON(base + 'comments/' + q);
        comments = c.comments || {};
        threads = c.threads || [];
      } catch (e) { console.warn('Комментарии не загружены:', e.message); }

      const list = Object.values(comments);
      const kids = {};
      for (const c of list) (kids[c.parentId || 0] ||= []).push(c);
      Object.values(kids).forEach(a => a.sort((x, y) => new Date(x.timePublished) - new Date(y.timePublished) || x.id - y.id));
      const roots = threads.length ? threads.map(i => comments[i]).filter(Boolean) : (kids[0] || []);

      out += `КОММЕНТАРИИ (${list.length})\n${DL.SEP}\n\n`;
      let n = 0;
      const emit = (c, level) => {
        n++;
        const score = c.score != null ? ` | ${c.score > 0 ? '+' : ''}${c.score}` : '';
        const head = `--- [ #${c.id} | ${c.author?.alias || 'удалён'} | ${DL.fmtDate(c.timePublished)}${score} ] ---`;
        const body = c.isSuspended ? '[комментарий скрыт]' : DL.htmlToText(c.message || c.messageHtml || '');
        out += DL.indent(`${head}\n${body}`, level) + '\n\n';
        (kids[c.id] || []).forEach(ch => emit(ch, level + 1));
      };
      roots.forEach(r => emit(r, 0));
      list.filter(c => c.parentId && !comments[c.parentId]).forEach(c => emit(c, 1));
      return { title, text: out, count: n, siteLabel: 'habr.com' };
    }
  });
})();
