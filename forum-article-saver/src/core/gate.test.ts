import { describe, expect, it } from 'vitest';
import { BAN_DEFAULT_MS, BAN_MAX_MS, HostGate } from './gate';

describe('HostGate: общие правила для всех вкладок', () => {
  it('запросы к одному хосту из разных вкладок идут по очереди, разные хосты не мешают', () => {
    const g = new HostGate();
    expect([g.slot('a', 1000), g.slot('a', 1000), g.slot('a', 1000)]).toEqual([0, 250, 500]);
    expect(g.slot('b', 1000)).toBe(0);
    expect(g.slot('a', 5000)).toBe(0); // очередь рассосалась
  });

  it('бан общий, зажат в разумные границы и истекает', () => {
    const g = new HostGate();
    expect(g.ban('a', 429, null, 0).until).toBe(BAN_DEFAULT_MS);
    expect(g.ban('a', 429, 1000, 0).until).toBe(60_000);
    expect(g.ban('a', 429, 9e9, 0).until).toBe(BAN_MAX_MS);
    expect(g.banned('a', 1)?.status).toBe(429);
    expect(g.banned('b', 1)).toBeNull();
    expect(g.banned('a', BAN_MAX_MS + 1)).toBeNull();
  });

  it('«Продолжить» снимает бан; состояние сохраняется и восстанавливается', () => {
    const g = new HostGate();
    g.ban('a', 429, null, Date.now());
    const h = new HostGate();
    h.load(g.dump());
    expect(h.banned('a')).not.toBeNull();
    h.clear('a');
    expect(h.banned('a')).toBeNull();
  });
});
