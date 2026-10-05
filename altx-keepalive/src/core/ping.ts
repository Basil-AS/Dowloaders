import { PING_PATH, type PingResult } from './types';
import { isLoginPath } from './schedule';

/**
 * Один запрос продления сессии. Выполняется в контексте вкладки сайта: тот же origin, куки сайта,
 * ничего из форм и страницы не читается. Окружение передаётся явно, чтобы функцию можно было проверить без браузера.
 */
export async function pingOnce(env: { origin: string; href: string; fetch: typeof fetch; now?: () => number }): Promise<PingResult> {
  if (isLoginPath(env.href)) return { kind: 'login' };
  const target = new URL(PING_PATH, env.origin);
  target.searchParams.set('__altx_keepalive', String((env.now ?? Date.now)()));
  try {
    const res = await env.fetch(target.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'follow' });
    await res.text(); // дочитываем тело, чтобы запрос завершился штатно
    if (isLoginPath(res.url)) return { kind: 'expired', http: res.status };
    if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}`, http: res.status };
    return { kind: 'ok', http: res.status };
  } catch (e) {
    return { kind: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}
