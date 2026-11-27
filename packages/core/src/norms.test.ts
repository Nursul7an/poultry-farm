import { describe, it, expect } from 'vitest';
import { AA_NORMS, checkLog, feedPhaseFor, mergeNorms, targetTemp, waterFeedRange } from './index';

describe('AA norms', () => {
  it('Table 2: day 0 = 30 °C, day 23 between 22 and 21, after day 27 stays 20', () => {
    expect(targetTemp(AA_NORMS, 0)).toBe(30);
    expect(targetTemp(AA_NORMS, 23)).toBeCloseTo(21.333, 2);
    expect(targetTemp(AA_NORMS, 40)).toBe(20);
  });
  it('Table 3 with humidity: day 0 at 60% = 30.8; at 62% interpolates; day 21 at 50% = 24.7', () => {
    expect(targetTemp(AA_NORMS, 0, 60)).toBeCloseTo(30.8, 5);
    expect(targetTemp(AA_NORMS, 0, 62)).toBeCloseTo(30.48, 5);
    expect(targetTemp(AA_NORMS, 21, 50)).toBeCloseTo(24.7, 5);
    expect(targetTemp(AA_NORMS, 21, 95)).toBeCloseTo(20.0, 5); // clamped to 80%
  });
  it('water:feed grows +6.5% per °C above 21', () => {
    expect(waterFeedRange(AA_NORMS, 20)).toEqual([1.6, 1.8]);
    const [lo] = waterFeedRange(AA_NORMS, 23);
    expect(lo).toBeCloseTo(1.6 * 1.13, 5);
  });
  it('feed phase by day', () => {
    expect([feedPhaseFor(AA_NORMS, 5), feedPhaseFor(AA_NORMS, 11), feedPhaseFor(AA_NORMS, 25)]).toEqual(['starter', 'grower', 'finisher']);
  });
  it('a farm override replaces one code only', () => {
    const n = mergeNorms({ mortality: { ...AA_NORMS.mortality, daily_max_pct: 0.2 } });
    expect(n.mortality.daily_max_pct).toBe(0.2);
    expect(n.temp_by_age).toBe(AA_NORMS.temp_by_age);
  });
  it('checkLog: the design case П-2 day 23 — mortality critical, water:feed low', () => {
    const c = checkLog(AA_NORMS, { day: 23, liveBirdsStart: 16701, placed: 16980, deaths: 38, culls: 2, lossesToDate: 319, feedKg: 1970, waterL: 2780, tMin: 21.6, tMax: 23, rh: 62 });
    const by = Object.fromEntries(c.map((x) => [x.code, x.level]));
    expect(by).toEqual({ mortality: 'crit', temp: 'ok', water_feed: 'warn', rh: 'ok' });
  });
  it('checkLog: week-1 losses over 1% are critical', () => {
    const c = checkLog(AA_NORMS, { day: 5, liveBirdsStart: 16900, placed: 17000, deaths: 20, culls: 0, lossesToDate: 180, feedKg: null, waterL: null, tMin: null, tMax: null, rh: null });
    expect(c.find((x) => x.code === 'week1')!.level).toBe('crit');
  });
});
