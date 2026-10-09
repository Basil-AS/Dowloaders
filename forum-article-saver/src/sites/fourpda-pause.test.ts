import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PausedError } from '../core/http';
import { TtlCache } from '../core/cache';
import { DEFAULT_SETTINGS, toExtractOptions } from '../core/settings-model';
import { fourpda } from './fourpda';

const o = { ...toExtractOptions(DEFAULT_SETTINGS, { lang: 'ru' }), concurrency: 1, delayMs: 0 };
const noop = () => {};
const topicHtml = '<html><body><h1 itemprop="name">Тема</h1><span class="pagelink-menu">6 страниц</span></body></html>';
const pageHtml = (n: number) =>
  `<html><body><table class="ipbtable" data-post="${n}"><tr><td class="row2" id="ph-${n}-d2">01.01.24, 10:00</td><td><span class="normalname"><a>u${n}</a></span><a title="Ссылка на это сообщение">${n}</a></td><td><div class="postcolor">post ${n}</div></td></tr></table></body></html>`;

const ctxWith = (f: typeof fetch, cache = new TtlCache()) => ({ url: new URL('https://4pda.to/forum/index.php?showtopic=1'), doc: new DOMParser().parseFromString(topicHtml, 'text/html'), fetch: f, cache });

/** Сервер: первые okLimit запросов успешны, дальше — заданный статус, пока limited. */
function server(opts: { okLimit?: number; status?: number; limited?: boolean; bad?: (st: number) => boolean } = {}) {
  const st = { ok: 0, calls: 0, inflight: 0, maxInflight: 0, limited: opts.limited ?? true, urls: [] as number[] };
  const f = (async (u: string) => {
    st.calls++;
    st.inflight++;
    st.maxInflight = Math.max(st.maxInflight, st.inflight);
    await Promise.resolve();
    st.inflight--;
    const page = Number(new URL(u).searchParams.get('st')) / 20;
    st.urls.push(page);
    if (st.limited && st.ok >= (opts.okLimit ?? 0)) return new Response('', { status: opts.status ?? 429, headers: { 'retry-after': '1' } });
    st.ok++;
    return new Response(opts.bad?.(page * 20) ? '<html>captcha</html>' : pageHtml(page + 1));
  }) as unknown as typeof fetch;
  return { st, f };
}

describe('4PDA: ограничение запросов и докачка', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = async (p: Promise<unknown>) => {
    const settled = p.then(v => ({ v }), e => ({ e }));
    await vi.advanceTimersByTimeAsync(300_000);
    return settled as Promise<{ v?: any; e?: unknown }>;
  };

  it('429: пул останавливается, одна проба после паузы сайта, затем пауза с прогрессом', async () => {
    const { st, f } = server({ okLimit: 2 });
    const r = await run(fourpda.extract(ctxWith(f), o, noop));
    expect(r.e).toBeInstanceOf(PausedError);
    const e = r.e as PausedError;
    expect([e.done, e.total]).toEqual([2, 6]);
    // 2 успешных + первый 429 + одна проба после ожидания: никакого шквала запросов
    expect(st.calls).toBe(4);
    expect(e.message).toContain('4PDA');
    expect(e.message).toContain('429');
  });

  it('продолжение скачивает только недостающие страницы и собирает весь документ', async () => {
    const cache = new TtlCache();
    const a = server({ okLimit: 2 });
    await run(fourpda.extract(ctxWith(a.f, cache), o, noop));
    const b = server({ limited: false });
    const r = await run(fourpda.extract(ctxWith(b.f, cache), o, noop));
    expect(b.st.urls.sort()).toEqual([2, 3, 4, 5]); // страницы 0 и 1 уже в кэше
    expect(r.v.items.map((i: any) => i.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(r.v.warnings).toEqual([]);
    expect(cache.has('4pda:1:0')).toBe(false); // кэш очищен после успеха
  });

  it('«Сохранить, что есть»: документ из скачанного, без запросов', async () => {
    const cache = new TtlCache();
    await run(fourpda.extract(ctxWith(server({ okLimit: 3 }).f, cache), o, noop));
    const b = server({ limited: false });
    const r = await run(fourpda.extract(ctxWith(b.f, cache), { ...o, partial: true }, noop));
    expect(b.st.calls).toBe(0);
    expect(r.v.items).toHaveLength(3);
    expect(r.v.warnings.join(' ')).toContain('частично: 3 из 6');
    // скачанное остаётся: следующий обычный запуск докачивает только недостающее
    const c = server({ limited: false });
    const full = await run(fourpda.extract(ctxWith(c.f, cache), o, noop));
    expect(c.st.urls.sort()).toEqual([3, 4, 5]);
    expect(full.v.items).toHaveLength(6);
  });

  it('403 после нескольких успешных страниц — бан: пауза; 403 сразу — закрытая тема: понятная ошибка, без ожидания', async () => {
    const mid = server({ okLimit: 2, status: 403 });
    const r = await run(fourpda.extract(ctxWith(mid.f), o, noop));
    expect(r.e).toBeInstanceOf(PausedError);
    const first = server({ okLimit: 0, status: 403 });
    const d = await run(fourpda.extract(ctxWith(first.f), o, noop));
    expect(d.e).not.toBeInstanceOf(PausedError);
    expect((d.e as Error).message).toContain('отказал в доступе (HTTP 403)');
    expect(first.st.calls).toBe(1); // без «проб» и пауз
  });

  it('страница, упавшая не по лимиту, не задваивается в предупреждениях после повторного круга', async () => {
    let n = 0;
    const calls: number[] = [];
    const f = (async (u: string) => {
      const page = Number(new URL(u).searchParams.get('st')) / 20;
      calls.push(page);
      if (page === 1) return new Response('', { status: 500 });
      if (page === 3 && n++ === 0) return new Response('', { status: 429 });
      return new Response(pageHtml(page + 1));
    }) as unknown as typeof fetch;
    const r = await run(fourpda.extract(ctxWith(f), o, noop));
    expect(r.v.warnings).toHaveLength(1);
    expect(r.v.warnings[0]).toMatch(/Не загрузилось страниц: 1 \(стр\. 2:/);
  });

  it('защитная страница вместо темы не кэшируется и попадает в предупреждения', async () => {
    const { f } = server({ limited: false, bad: st => st === 40 });
    const cache = new TtlCache();
    const r = await run(fourpda.extract(ctxWith(f, cache), o, noop));
    expect(r.v.items).toHaveLength(5);
    expect(r.v.warnings.join(' ')).toContain('стр. 3');
    expect(cache.has('4pda:1:2')).toBe(false);
  });

  it('темп мягкий даже при высоком параллелизме в настройках', async () => {
    const { st, f } = server({ limited: false });
    await run(fourpda.extract(ctxWith(f), { ...o, concurrency: 8 }, noop));
    expect(st.maxInflight).toBeLessThanOrEqual(3);
  });
});
