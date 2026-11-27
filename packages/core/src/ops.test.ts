import { describe, it, expect } from 'vitest';
import { earliestSlaughter, withdrawalUntil, weighingStats, sampleTarget, binStock, batchMoney } from './index';

describe('operations', () => {
  it('earliest slaughter: 24.11 + 5 days + 7 days → 06.12 (same as the database)', () => {
    expect(earliestSlaughter('2026-11-24', 5, 7)).toBe('2026-12-06');
    expect(withdrawalUntil([{ startOn: '2026-11-24', courseDays: 5, withdrawalDays: 7 }, { startOn: '2026-11-10', courseDays: 3, withdrawalDays: 5 }])).toBe('2026-12-06');
    expect(withdrawalUntil([])).toBeNull();
  });
  it('weighing stats match the database example and the handbook CV definition', () => {
    const s = weighingStats([900, 1000, 1100]);
    expect([s.n, s.mean, s.sd, s.cv]).toEqual([3, 1000, 100, 10]);
    expect(weighingStats([]).n).toBe(0);
    expect(sampleTarget(16661)).toBe(167);
    expect(sampleTarget(5000)).toBe(100);
  });
  it('bin stock and days left', () => {
    const b = binStock([8, 8, 12.5], [1970, 1965, 23_865], [1970, 1965, 1920]);
    expect(b.stockT).toBeCloseTo(0.7, 5);
    expect(b.daysLeft).toBeCloseTo(0.7 / 1.951666, 3);
  });
  it('money: unpriced items are counted, not guessed', () => {
    const m = batchMoney({
      chicks: [{ waybill: 68045, price: 70 }], feed: [{ tonnes: 8, pricePerT: 38000 }, { tonnes: 8.5, pricePerT: null }],
      medicine: [{ price: null }], costs: [{ category: 'energy', amount: 620000 }],
      sales: [{ kg: 40546, pricePerKg: 140, paid: 4_000_000 }], placed: 68000,
    });
    expect(m.byCategory).toEqual({ chicks: 4_763_150, feed: 304_000, energy: 620_000 });
    expect(m.unpriced).toBe(2);
    expect(m.revenue).toBe(5_676_440);
    expect(m.owed).toBe(1_676_440);
    expect(m.profit).toBe(5_676_440 - 5_687_150);
  });
});
