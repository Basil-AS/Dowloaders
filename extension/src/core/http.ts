export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.cause = url;
  }
}

const retryable = (e: unknown) => !(e instanceof HttpError) || e.status === 429 || e.status >= 500;

/** fetch с повторами: 429/5xx/сетевые ошибки ретраятся с нарастающей паузой, прочие 4xx — нет. */
export async function fetchRetry(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  tries = 4,
  baseDelay = 800,
): Promise<Response> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await f(url, { credentials: 'include', ...init });
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      last = e;
      if (i === tries || !retryable(e)) break;
      await sleep(baseDelay * i);
    }
  }
  throw last;
}

export async function getJSON<T = any>(f: typeof fetch, url: string, tries = 3): Promise<T> {
  const res = await fetchRetry(f, url, { headers: { Accept: 'application/json' } }, tries, 600);
  return (await res.json()) as T;
}

export async function getText(f: typeof fetch, url: string, encoding = 'utf-8'): Promise<string> {
  const res = await fetchRetry(f, url);
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

/** Параллельная обработка списка с ограничением числа воркеров; порядок результатов сохраняется. */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  delayMs = 0,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i] as T, i);
      if (delayMs) await sleep(delayMs * (0.5 + Math.random()));
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  return out;
}
