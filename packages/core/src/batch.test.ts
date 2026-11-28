import { describe, expect, it } from 'vitest';
import { batchResult, splitSharedCosts } from './ops';

describe('batch result', () => {
  it('survival, weight, FCR and EPEF from handovers and logs', () => {
    const r = batchResult({
      placedOn: '2026-10-01', placed: 17050,
      logs: [{ deaths: 300, culls: 50, feedKg: 30000 }, { deaths: 100, culls: 0, feedKg: 31000 }],
      handovers: [{ handedOn: '2026-11-05', birds: 8000, kg: 19600 }, { handedOn: '2026-11-06', birds: 8550, kg: 21375 }],
    });
    expect(r.losses).toBe(450);
    expect(r.handedBirds).toBe(16550);
    expect(r.unaccounted).toBe(50);
    expect(r.days).toBe(36);
    expect(r.survivalPct!).toBeCloseTo(97.07, 2);
    expect(r.avgWeightKg!).toBeCloseTo(2.476, 3);
    expect(r.fcr!).toBeCloseTo(1.489, 3);
    expect(Math.round(r.epef!)).toBe(448);
  });
  it('before any handover: survival from losses, no weight or FCR', () => {
    const r = batchResult({ placedOn: '2026-11-01', placed: 1000, logs: [{ deaths: 10, culls: 0, feedKg: 100 }], handovers: [] });
    expect([r.survivalPct, r.avgWeightKg, r.fcr, r.epef, r.unaccounted]).toEqual([99, null, null, null, null]);
  });
});

describe('shared costs split by chicks placed', () => {
  const batches = [
    { id: 'A', placed: 10000, from: '2026-10-01', to: '2026-11-05' },
    { id: 'B', placed: 30000, from: '2026-10-20', to: null },
  ];
  it('between the batches running on that day', () => {
    const { shares } = splitSharedCosts([{ amount: 400000, spentOn: '2026-10-25' }], batches);
    expect(shares.get('A')![0]!.amount).toBe(100000);
    expect(shares.get('B')![0]!.amount).toBe(300000);
  });
  it('only to the batch still running', () => {
    const { shares } = splitSharedCosts([{ amount: 50000, spentOn: '2026-11-20' }], batches);
    expect(shares.get('A')).toBeUndefined();
    expect(shares.get('B')![0]!.amount).toBe(50000);
  });
  it('empty period → the batch starting within 14 days; otherwise unallocated', () => {
    const r = splitSharedCosts([{ amount: 9000, spentOn: '2026-09-25' }, { amount: 7000, spentOn: '2026-08-01' }], batches);
    expect(r.shares.get('A')![0]!.amount).toBe(9000);
    expect(r.unallocated).toBe(7000);
  });
});
