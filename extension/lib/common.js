// Общие утилиты. Инжектится в страницу перед скриптами площадок.
(() => {
  const DL = (window.__DL = { sites: [] });

  DL.sleep = ms => new Promise(r => setTimeout(r, ms));
  DL.SEP = '================================================================';
  const p2 = n => String(n).padStart(2, '0');
  DL.nowYMD = () => {
    const d = new Date();
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  };
  DL.sanitize = s => (s || '').replace(/[<>:"/\\|?*\n\r]/g, '-').replace(/\s+/g, ' ').trim() || 'untitled';
  DL.fmtDate = v => {
    if (v == null || v === '') return '';
    const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleString('ru-RU');
  };
  DL.indent = (text, level) => {
    const pad = '    '.repeat(level);
    return text.split('\n').map(l => pad + l).join('\n');
  };

  // ── DOM → текст. innerText в «неотрисованных» документах не ставит переносы, поэтому обходим сами ──
  const BLOCK = new Set(['DIV', 'P', 'UL', 'OL', 'TABLE', 'TR', 'FIGURE', 'FIGCAPTION', 'SECTION', 'ARTICLE']);
  const domToText = n => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    const tag = n.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return '';
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') {
      if (n.classList.contains('emoji')) return n.getAttribute('alt') || '';
      const src = n.getAttribute('data-src') || n.getAttribute('src') || '';
      return src ? `[img: ${src}]` : '';
    }
    if (tag === 'PRE') return `\n\`\`\`\n${n.textContent.replace(/\n$/, '')}\n\`\`\`\n`;
    const inner = () => Array.from(n.childNodes).map(domToText).join('');
    if (tag === 'A') {
      const t = inner().trim();
      const h = n.getAttribute('href') || '';
      return !h || h.startsWith('#') || h.startsWith('javascript:') || t === h ? t : `${t} (${h})`;
    }
    if (tag === 'LI') return `\n• ${inner().trim()}`;
    if (tag === 'BLOCKQUOTE') return '\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n';
    if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(+tag[1])} ${inner().trim()}\n`;
    if (tag === 'TD' || tag === 'TH') return inner().trim() + '\t';
    return BLOCK.has(tag) ? `\n${inner()}\n` : inner();
  };
  const tidy = t => t.replace(/\r/g, '').replace(/[ \t ]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  DL.domToText = n => tidy(domToText(n));
  DL.htmlToText = html => {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return DL.domToText(doc.body);
  };

  DL.getJSON = async (url, tries = 3) => {
    for (let i = 1; i <= tries; i++) {
      try {
        const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (res.status === 429 && i < tries) { await DL.sleep(2000 * i); continue; }
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
        return await res.json();
      } catch (e) {
        if (i === tries || (e.status >= 400 && e.status < 500 && e.status !== 429)) throw e;
        await DL.sleep(500 * i);
      }
    }
  };

  // ── плашка прогресса ──
  DL.createUI = title => {
    document.querySelector('.fas-progress')?.remove();
    const el = document.createElement('div');
    el.className = 'fas-progress';
    Object.assign(el.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
      background: '#1e1e2e', color: '#cdd6f4', borderRadius: '12px', padding: '14px 20px',
      boxShadow: '0 8px 30px rgba(0,0,0,.4)', minWidth: '260px', maxWidth: '360px',
      font: '13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    });
    el.innerHTML = '<div class="t" style="margin-bottom:8px"></div>' +
      '<div style="height:6px;background:#313244;border-radius:3px;overflow:hidden"><div class="f" style="height:100%;width:0;background:linear-gradient(90deg,#cba6f7,#f5c2e7);transition:width .3s"></div></div>' +
      '<div class="s" style="font-size:12px;color:#a6adc8;margin-top:6px"></div>';
    document.body.appendChild(el);
    const set = (t, pct, s) => {
      if (t != null) el.querySelector('.t').textContent = t;
      if (pct != null) el.querySelector('.f').style.width = pct + '%';
      if (s != null) el.querySelector('.s').textContent = s;
    };
    set('\u{1F4E5} ' + title, 0, 'Подготовка...');
    return {
      update: (done, total, text) => set(null, total ? Math.round(done / total * 100) : 0, text || `${done} / ${total}`),
      status: s => set(null, null, s),
      done: msg => { set('✅ Готово', 100, msg); setTimeout(() => el.remove(), 5000); },
      error: msg => { set('❌ Ошибка', null, msg); setTimeout(() => el.remove(), 8000); }
    };
  };

  DL.download = (filename, text) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  // site: { id, name, paged, detect(), run(opts, ui) -> { title, text, count, siteLabel } }
  DL.register = site => DL.sites.push(site);
  DL.detect = () => {
    const s = DL.sites.find(x => { try { return x.detect(); } catch (e) { return false; } });
    return s ? { id: s.id, name: s.name, paged: !!s.paged } : null;
  };
  DL.run = async (opts = {}) => {
    const site = DL.sites.find(x => { try { return x.detect(); } catch (e) { return false; } });
    if (!site) return { ok: false, error: 'Эта страница не поддерживается' };
    const ui = DL.createUI(site.name);
    try {
      const r = await site.run(opts, ui);
      const filename = `${DL.nowYMD()} - [${r.siteLabel || location.hostname}] - ${DL.sanitize(r.title).slice(0, 120)}.txt`;
      DL.download(filename, r.text);
      window.__lastParse = { filename, text: r.text };
      ui.done(`${r.count} шт. → ${filename}`);
      return { ok: true, site: site.name, filename, count: r.count };
    } catch (e) {
      console.error('[forum-article-saver]', e);
      ui.error(e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  };
})();
