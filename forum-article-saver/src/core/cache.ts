import type { ResumeCache } from './types';

/** Кэш докачки в памяти вкладки. Записи живут ограниченное время: устаревшие страницы живой темы нам не нужны. */
export class TtlCache implements ResumeCache {
  private m = new Map<string, { t: number; v: unknown }>();
  constructor(private ttlMs = 30 * 60_000, private now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (this.now() - e.t > this.ttlMs) {
      this.m.delete(key);
      return undefined;
    }
    return e.v as T;
  }
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  set(key: string, value: unknown): void {
    this.m.set(key, { t: this.now(), v: value });
  }
  delete(key: string): void {
    this.m.delete(key);
  }
  deletePrefix(prefix: string): void {
    for (const k of [...this.m.keys()]) if (k.startsWith(prefix)) this.m.delete(k);
  }
}
