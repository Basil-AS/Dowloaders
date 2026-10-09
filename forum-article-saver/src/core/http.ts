export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.cause = url;
  }
}

/** Сайт ограничил запросы (429, а для некоторых площадок 403) или исчерпан лимит API. Повторять сразу нельзя. */
export class RateLimitError extends Error {
  constructor(
    public status: number,
    /** Сколько сайт просит подождать (Retry-After), если сказал. */
    public retryAfterMs: number | null = null,
    /** Когда лимит обнулится (метка времени, мс), если известно (GitHub). */
    public resetAt: number | null = null,
  ) {
    super(`HTTP ${status}`);
    this.name = 'RateLimitError';
  }
}

/** Адаптер остановился на паузе: что-то уже скачано и лежит в кэше, продолжить можно по кнопке. */
export class PausedError extends Error {
  constructor(message: string, public done: number, public total: number, public retryAt: number | null = null, public skippable = false) {
    super(message);
    this.name = 'PausedError';
  }
}

/** Retry-After: секунды или дата HTTP. */
export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export interface FetchOpts {
  tries?: number;
  baseDelay?: number;
  /** Дополнительные коды, которые на этой площадке означают блокировку (4PDA: 403). */
  blockStatuses?: readonly number[];
}

const retryable = (e: unknown) => !(e instanceof HttpError) || e.status >= 500;

/**
 * fetch с повторами для 5xx и сетевых ошибок. 429 (и блокирующие коды) не повторяются: это сигнал остановиться,
 * иначе каждая следующая попытка только затягивает бан. Бросается RateLimitError, решать, ждать ли, — адаптеру.
 */
export async function fetchRetry(f: typeof fetch, url: string, init: RequestInit = {}, opts: FetchOpts = {}): Promise<Response> {
  const { tries = 4, baseDelay = 800, blockStatuses = [] } = opts;
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await f(url, { credentials: 'include', ...init });
      if (res.status === 429 || blockStatuses.includes(res.status)) throw new RateLimitError(res.status, parseRetryAfter(res.headers?.get?.('retry-after')));
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (e) {
      last = e;
      if (e instanceof RateLimitError || i === tries || !retryable(e)) break;
      await sleep(baseDelay * i);
    }
  }
  throw last;
}

export async function getJSON<T = any>(f: typeof fetch, url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await fetchRetry(f, url, { headers: { Accept: 'application/json' } }, { tries: 3, baseDelay: 600, ...opts });
  return (await res.json()) as T;
}

export async function getText(f: typeof fetch, url: string, encoding = 'utf-8', opts: FetchOpts = {}): Promise<string> {
  const res = await fetchRetry(f, url, {}, opts);
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

/**
 * Параллельная обработка списка с ограничением числа воркеров; порядок результатов сохраняется.
 * stopOn: ошибка, после которой новые элементы не берутся (уже запущенные доканчиваются), затем она пробрасывается.
 * Так одна 429 останавливает весь пул, а не получает ещё десяток запросов.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  delayMs = 0,
  stopOn: (e: unknown) => boolean = () => false,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let stop: unknown = null;
  const run = async () => {
    while (next < items.length && stop == null) {
      const i = next++;
      try {
        out[i] = await worker(items[i] as T, i);
      } catch (e) {
        if (!stopOn(e)) throw e;
        stop ??= e;
        return;
      }
      if (delayMs && stop == null) await sleep(delayMs * (0.5 + Math.random()));
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, run));
  if (stop != null) throw stop;
  return out;
}
