import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from './cache';
import { fetchRetry, parseRetryAfter, PausedError, RateLimitError, runPool } from './http';

const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 200 ? 'ok' : '', { status, headers });

describe('fetchRetry: лимиты', () => {
  it('429 не повторяется и несёт Retry-After', async () => {
    const f = vi.fn().mockResolvedValue(res(429, { 'retry-after': '30' }));
    const err = await fetchRetry(f as never, 'u', {}, { tries: 4, baseDelay: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterMs).toBe(30_000);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('blockStatuses (403 на 4PDA) трактуется как ограничение', async () => {
    const f = vi.fn().mockResolvedValue(res(403));
    await expect(fetchRetry(f as never, 'u', {}, { blockStatuses: [403] })).rejects.toBeInstanceOf(RateLimitError);
    const g = vi.fn().mockResolvedValue(res(403));
    await expect(fetchRetry(g as never, 'u', {}, { tries: 2, baseDelay: 1 })).rejects.toThrow('HTTP 403');
  });
  it('5xx по-прежнему повторяется', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200));
    expect((await fetchRetry(f as never, 'u', {}, { tries: 3, baseDelay: 1 })).status).toBe(200);
  });
  it('Retry-After: секунды и дата', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))).toBe(10_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('мусор')).toBeNull();
  });
});

describe('runPool: остановка', () => {
  it('после ошибки-стопа новые элементы не берутся, запущенные доканчиваются, ошибка пробрасывается', async () => {
    const started: number[] = [];
    const pool = runPool(
      [1, 2, 3, 4, 5, 6, 7, 8],
      2,
      async x => {
        started.push(x);
        await new Promise(r => setTimeout(r, 5));
        if (x === 2) throw new RateLimitError(429);
        return x;
      },
      0,
      e => e instanceof RateLimitError,
    );
    await expect(pool).rejects.toBeInstanceOf(RateLimitError);
    expect(started.length).toBeLessThanOrEqual(4); // 1,2 в работе; максимум ещё по одному, пока шёл второй
    expect(started).not.toContain(8);
  });
  it('обычная ошибка не глотается и тоже останавливает', async () => {
    await expect(runPool([1, 2], 1, async () => { throw new Error('x'); })).rejects.toThrow('x');
  });
});

describe('TtlCache', () => {
  it('значения живут ограниченное время; deletePrefix', () => {
    let t = 0;
    const c = new TtlCache(1000, () => t);
    c.set('a:1', 1);
    c.set('a:2', 2);
    c.set('b:1', 3);
    expect(c.get('a:1')).toBe(1);
    c.deletePrefix('a:');
    expect(c.has('a:2')).toBe(false);
    expect(c.get('b:1')).toBe(3);
    t = 1500;
    expect(c.has('b:1')).toBe(false);
  });
  it('PausedError хранит прогресс', () => {
    const e = new PausedError('m', 3, 10, 123);
    expect([e.done, e.total, e.retryAt]).toEqual([3, 10, 123]);
  });
});
