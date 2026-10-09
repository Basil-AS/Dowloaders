import { HttpError, PausedError, parseRetryAfter, RateLimitError, sleep } from '../../core/http';
import type { tFor } from '../../core/i18n';
import type { Lang, ResumeCache } from '../../core/types';

export const API = 'https://api.github.com';

/** Токен нужен, а его нет (или он недействителен). */
export class AuthRequiredError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = 'AuthRequiredError';
  }
}
/** Доступ запрещён (не лимит): закрытый репозиторий без токена, нет прав у токена. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
/** Страницы нет в кэше, а режим «сохранить, что есть» ничего не докачивает. */
export class NotCachedError extends Error {
  constructor() {
    super('not cached');
    this.name = 'NotCachedError';
  }
}
export class NotFoundError extends Error {
  constructor(public url: string) {
    super('HTTP 404');
    this.name = 'NotFoundError';
  }
}

export interface Page<T> {
  data: T;
  /** Номер последней страницы из заголовка Link, если он есть. */
  last: number | null;
  next: string | null;
}

const parseLink = (h: string | null): { next: string | null; last: number | null } => {
  const next = h?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  const lastUrl = h?.match(/<([^>]+)>;\s*rel="last"/)?.[1];
  const last = lastUrl ? Number(new URL(lastUrl).searchParams.get('page')) || null : null;
  return { next, last };
};

/** Тонкий клиент GitHub API поверх переданного fetch (в расширении это запрос через фоновую страницу). */
export class GitHubApi {
  /** true, если список оборван по maxPages и конец остался нескачанным. */
  truncated = false;

  constructor(private f: typeof fetch, private cache?: ResumeCache, private opts: { cachedOnly?: boolean } = {}) {}

  /** Один запрос с повтором 5xx. Лимиты (429, 403 с исчерпанным лимитом) → RateLimitError, а не повтор. */
  private async raw(url: string, init: RequestInit = {}): Promise<Response> {
    for (let i = 1; ; i++) {
      const res = await this.f(url, { credentials: 'omit', ...init });
      if (res.ok) return res;
      if (res.status === 401) throw new AuthRequiredError(401);
      if (res.status === 404) throw new NotFoundError(url);
      if (res.status === 429 || res.status === 403) {
        const body = await res.text().catch(() => '');
        const limited = res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse/i.test(body);
        if (limited) throw new RateLimitError(res.status, parseRetryAfter(res.headers.get('retry-after')), Number(res.headers.get('x-ratelimit-reset')) * 1000 || null);
        throw new ForbiddenError(body.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? 'HTTP 403');
      }
      if (res.status === 599) throw new Error(`network: ${await res.text().catch(() => '')}`); // фон не достучался до сети
      if (res.status < 500 || i >= 3) throw new HttpError(res.status, url);
      await sleep(700 * i);
    }
  }

  async get<T = any>(path: string, headers: Record<string, string> = {}): Promise<Page<T>> {
    const url = path.startsWith('http') ? path : API + path;
    const ck = `gh:api:${url}:${JSON.stringify(headers)}`;
    const hit = this.cache?.get<Page<T>>(ck);
    if (hit) return hit;
    if (this.opts.cachedOnly) throw new NotCachedError();
    const res = await this.raw(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...headers } });
    const ct = res.headers.get('content-type') ?? '';
    const data = (ct.includes('json') ? await res.json() : await res.text()) as T;
    const page = { data, ...parseLink(res.headers.get('link')) };
    this.cache?.set(ck, page);
    return page;
  }

  /** Все страницы списка (до max элементов); уже скачанные страницы берутся из кэша, поэтому докачка после паузы дёшева. */
  async paginate<T = any>(path: string, opts: { max?: number; maxPages?: number; onPage?: (page: number, last: number | null) => void; pick?: (d: any) => T[] } = {}): Promise<T[]> {
    const { max = Infinity, maxPages = 100, onPage, pick = (d: any) => d as T[] } = opts;
    const out: T[] = [];
    let next: string | null = path.includes('per_page') ? path : `${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    let n = 0;
    let last: number | null = null;
    while (next && out.length < max && n < maxPages) {
      let p: Page<any>;
      try {
        p = await this.get(next);
      } catch (e) {
        if (e instanceof NotCachedError) break; // «сохранить, что есть»: берём скачанное и не докачиваем
        throw e;
      }
      out.push(...pick(p.data));
      last = p.last ?? last;
      onPage?.(++n, last ?? n);
      next = p.next;
    }
    if (next && n >= maxPages) this.truncated = true;
    return out.slice(0, max);
  }

  /** GraphQL-запрос; ответы кэшируются так же, как страницы REST (докачка после паузы не повторяет оплаченное). */
  async graphql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
    const ck = `gh:gql:${JSON.stringify([query, variables])}`;
    const hit = this.cache?.get<T>(ck);
    if (hit) return hit;
    if (this.opts.cachedOnly) throw new NotCachedError();
    const res = await this.raw(`${API}/graphql`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
    const j = (await res.json()) as { data?: T | null; errors?: { message: string; type?: string }[] };
    const e = j.errors?.[0];
    if (e && (/rate limit/i.test(e.message) || e.type === 'RATE_LIMITED')) throw new RateLimitError(403, null, null);
    if (e && (!j.data || e.type === 'NOT_FOUND')) {
      if (e.type === 'NOT_FOUND' || /could not resolve/i.test(e.message)) throw new NotFoundError(`${API}/graphql`);
      if (!j.data) throw new Error(e.message);
    }
    this.cache?.set(ck, j.data);
    return j.data as T;
  }
}

/** Пауза из-за лимита GitHub: с временем снятия, если оно известно (по x-ratelimit-reset или Retry-After). */
export function limitPause(e: RateLimitError, L: ReturnType<typeof tFor>, lang: Lang, done = 0, total = 0): PausedError {
  const at = e.resetAt ?? (e.retryAfterMs != null ? Date.now() + e.retryAfterMs : null);
  return new PausedError(at ? L('w_gh_limit', { time: new Date(at).toLocaleTimeString(lang) }) : L('w_gh_limit_soon'), done, total, at);
}
