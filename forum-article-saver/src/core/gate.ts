/**
 * Общие для всех вкладок и окон правила обращения к одному сайту: расширение может работать в нескольких вкладках сразу,
 * а бан приходит на IP, а не на вкладку. Живёт в фоне: там один экземпляр на весь браузер.
 */
export const GATE_GAP_MS = 250;
/** Сколько считать сайт «в бане» после 429, если он не сказал сам (Retry-After). */
export const BAN_DEFAULT_MS = 5 * 60_000;
export const BAN_MAX_MS = 30 * 60_000;

export interface Ban {
  until: number;
  status: number;
}

export class HostGate {
  private next = new Map<string, number>();
  private bans = new Map<string, Ban>();

  /** Сколько ждать этому запросу: запросы к одному хосту из всех вкладок идут не чаще одного за gap мс. */
  slot(host: string, now = Date.now(), gap = GATE_GAP_MS): number {
    const at = Math.max(now, this.next.get(host) ?? 0);
    this.next.set(host, at + gap);
    return at - now;
  }

  ban(host: string, status: number, retryAfterMs: number | null, now = Date.now()): Ban {
    const ms = Math.min(Math.max(retryAfterMs ?? BAN_DEFAULT_MS, 60_000), BAN_MAX_MS);
    const b = { until: now + ms, status };
    this.bans.set(host, b);
    return b;
  }

  banned(host: string, now = Date.now()): Ban | null {
    const b = this.bans.get(host);
    if (!b) return null;
    if (b.until <= now) {
      this.bans.delete(host);
      return null;
    }
    return b;
  }

  /** Пользователь сам нажал «Продолжить»: он решает, что бан снят. */
  clear(host: string): void {
    this.bans.delete(host);
  }

  dump(): Record<string, Ban> {
    return Object.fromEntries(this.bans);
  }

  load(o: Record<string, Ban> | undefined): void {
    this.bans = new Map(Object.entries(o ?? {}));
  }
}
