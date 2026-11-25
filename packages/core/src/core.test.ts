import { describe, it, expect } from 'vitest';
import { productionDay, addDays, dayOfAge, withinWorkerEditWindow, waterLitres, workingTemperature, plausibilityIssues, validationErrors, liveBirds, feedKg } from './index';

describe('productionDay (Asia/Bishkek, UTC+6, day starts 08:00)', () => {
  it('07:59 local belongs to the previous day', () => {
    expect(productionDay(new Date('2026-11-25T01:59:00Z'))).toBe('2026-11-24'); // 07:59 local
  });
  it('08:00 local starts a new day', () => {
    expect(productionDay(new Date('2026-11-25T02:00:00Z'))).toBe('2026-11-25');
  });
  it('honours a calendar-day setting', () => {
    expect(productionDay(new Date('2026-11-25T01:59:00Z'), 'Asia/Bishkek', 0)).toBe('2026-11-25');
  });
  it('crosses month boundaries', () => {
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
  });
});

describe('dayOfAge', () => {
  it('placement day is day 0; 24.11 is day 23 for placement on 01.11', () => {
    expect(dayOfAge('2026-11-01', '2026-11-01')).toBe(0);
    expect(dayOfAge('2026-11-01', '2026-11-24')).toBe(23);
  });
});

describe('edit window', () => {
  const c = new Date('2026-11-24T03:00:00Z');
  it('48 h exactly is allowed, 48 h + 1 s is not', () => {
    expect(withinWorkerEditWindow(c, new Date('2026-11-26T03:00:00Z'))).toBe(true);
    expect(withinWorkerEditWindow(c, new Date('2026-11-26T03:00:01Z'))).toBe(false);
  });
});

describe('water', () => {
  it('1036.42 → 1039.20 m³ = 2780 L (design example)', () => {
    expect(waterLitres(1036.42, 1039.2)).toEqual({ litres: 2780, needsNewMeterConfirm: false });
  });
  it('a backwards reading asks for new-meter confirmation', () => {
    expect(waterLitres(1036.42, 12.5).needsNewMeterConfirm).toBe(true);
  });
  it('a new meter gives no litres for that day', () => {
    expect(waterLitres(1036.42, 0.1, true).litres).toBeNull();
  });
});

describe('workingTemperature', () => {
  it('handbook example: min 16, max 28 → 24 °C', () => {
    expect(workingTemperature(16, 28)).toBe(24);
  });
});

describe('plausibility', () => {
  const hist = Array.from({ length: 7 }, () => ({ deaths: 11, culls: 2, feedKg: 1960, waterL: 3400 }));
  const base = { deaths: 9, culls: 2, cullReason: 'legs' as const, feedKg: 1970, waterMeter: 1039.2, tMin: 21.6, tMax: 23, rh: 62 };
  it('normal values raise nothing', () => {
    expect(plausibilityIssues(base, 3450, hist)).toEqual([]);
  });
  it('deaths 90 with an average of 11 asks for confirmation', () => {
    const r = plausibilityIssues({ ...base, deaths: 90 }, 3450, hist);
    expect(r).toHaveLength(1);
    expect(r[0]!.field).toBe('deaths');
  });
  it('38 deaths (design alert case) is below 5× and does not ask', () => {
    expect(plausibilityIssues({ ...base, deaths: 38 }, 2780, hist)).toEqual([]);
  });
  it('out-of-range temperature and min > max', () => {
    expect(plausibilityIssues({ ...base, tMax: 50 }, 3450, hist).map((x) => x.field)).toEqual(['tMax']);
    expect(plausibilityIssues({ ...base, tMin: 30, tMax: 20 }, 3450, hist).map((x) => x.field)).toEqual(['tMin']);
  });
  it('no history → no spike check', () => {
    expect(plausibilityIssues({ ...base, deaths: 500 }, null, [])).toEqual([]);
  });
});

describe('validation and totals', () => {
  it('culls need a reason; negatives are rejected', () => {
    expect(validationErrors({ deaths: -1, culls: 2, feedKg: 1, waterMeter: 1, tMin: 1, tMax: 2, rh: 50 })).toHaveLength(2);
  });
  it('live birds', () => {
    expect(liveBirds(16980, [{ deaths: 38, culls: 2 }, { deaths: 12, culls: 3 }])).toBe(16925);
  });
  it('feed from bags', () => {
    expect(feedKg({ bags: 40, bagKg: 40 })).toBe(1600);
    expect(feedKg({ kg: 1970 })).toBe(1970);
  });
});
