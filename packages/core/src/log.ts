/** Daily house log: shape, derived values and plausibility checks. */

export type CullReason = 'legs' | 'runt' | 'injury' | 'ascites' | 'other';

export interface FeedEntry {
  /** Either kilograms directly … */
  kg?: number;
  /** … or a number of bags of a known weight. */
  bags?: number;
  bagKg?: number;
}

export interface DailyLogInput {
  deaths: number;
  culls: number;
  cullReason?: CullReason | null;
  feedKg: number | null;
  /** Water meter reading in m³, as printed on the meter. */
  waterMeter: number | null;
  /** True when the reading starts a new meter series (meter replaced). */
  newMeter?: boolean;
  tMin: number | null;
  tMax: number | null;
  rh: number | null;
  note?: string | null;
}

export function feedKg(e: FeedEntry): number | null {
  if (e.kg != null) return e.kg;
  if (e.bags != null && e.bagKg != null) return e.bags * e.bagKg;
  return null;
}

export interface WaterResult {
  litres: number | null;
  /** Reading went backwards: the user must confirm a new meter. */
  needsNewMeterConfirm: boolean;
}

/** Litres used since the previous reading. Meter readings are m³; 1 m³ = 1000 L. */
export function waterLitres(previous: number | null, reading: number | null, newMeter = false): WaterResult {
  if (reading == null) return { litres: null, needsNewMeterConfirm: false };
  if (newMeter || previous == null) return { litres: null, needsNewMeterConfirm: false };
  if (reading < previous) return { litres: null, needsNewMeterConfirm: true };
  return { litres: Math.round((reading - previous) * 1000), needsNewMeterConfirm: false };
}

/** Working (effective) temperature: min + 2/3 × (max − min). AA Handbook, Appendix 2. */
export function workingTemperature(tMin: number, tMax: number): number {
  return tMin + ((tMax - tMin) * 2) / 3;
}

export interface HistoryDay { deaths: number; culls: number; feedKg: number | null; waterL: number | null }

export type IssueKind = 'spike' | 'range';
export interface PlausibilityIssue { field: 'deaths' | 'culls' | 'feedKg' | 'waterL' | 'tMin' | 'tMax' | 'rh'; kind: IssueKind; message: string }

const SPIKE_FACTOR = 5;

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

/**
 * Values that deserve an "Это верно?" confirmation. Nothing is blocked: the user can confirm and save.
 * `history` = up to the last 7 days, most recent first.
 */
export function plausibilityIssues(input: DailyLogInput, waterL: number | null, history: HistoryDay[]): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const last7 = history.slice(0, 7);
  const spike = (field: PlausibilityIssue['field'], value: number | null, series: (number | null)[], label: string) => {
    const a = avg(series);
    if (value == null || a == null || a <= 0) return;
    if (value > a * SPIKE_FACTOR) {
      issues.push({ field, kind: 'spike', message: `${label} ${fmt(value)} — в ${fmt(value / a)} раз больше среднего за 7 дней (${fmt(a)})` });
    }
  };
  spike('deaths', input.deaths, last7.map((h) => h.deaths), 'Падёж');
  spike('culls', input.culls, last7.map((h) => h.culls), 'Выбраковка');
  spike('feedKg', input.feedKg, last7.map((h) => h.feedKg), 'Корм');
  spike('waterL', waterL, last7.map((h) => h.waterL), 'Вода');

  const range = (field: PlausibilityIssue['field'], v: number | null, lo: number, hi: number, label: string) => {
    if (v != null && (v < lo || v > hi)) issues.push({ field, kind: 'range', message: `${label} ${fmt(v)} — вне диапазона ${lo}–${hi}` });
  };
  range('tMin', input.tMin, 0, 45, 't мин');
  range('tMax', input.tMax, 0, 45, 't макс');
  range('rh', input.rh, 0, 100, 'Влажность');
  if (input.tMin != null && input.tMax != null && input.tMin > input.tMax) {
    issues.push({ field: 'tMin', kind: 'range', message: 't мин больше t макс' });
  }
  return issues;
}

/** Hard validation: values that can never be saved. */
export function validationErrors(input: DailyLogInput): string[] {
  const errs: string[] = [];
  const nonNegInt = (v: number, label: string) => { if (!Number.isInteger(v) || v < 0) errs.push(`${label}: целое число ≥ 0`); };
  nonNegInt(input.deaths, 'Падёж');
  nonNegInt(input.culls, 'Выбраковка');
  if (input.culls > 0 && !input.cullReason) errs.push('Укажите причину выбраковки');
  if (input.feedKg != null && input.feedKg < 0) errs.push('Корм: не может быть меньше 0');
  if (input.waterMeter != null && input.waterMeter < 0) errs.push('Водосчётчик: не может быть меньше 0');
  return errs;
}

/** Live birds = placed − Σ deaths − Σ culls. */
export function liveBirds(placed: number, logs: { deaths: number; culls: number }[]): number {
  return placed - logs.reduce((s, l) => s + l.deaths + l.culls, 0);
}
