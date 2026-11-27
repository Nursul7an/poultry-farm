/**
 * Arbor Acres norms (single source: norms/aa-norms.json) and the checks built on them.
 * The database seeds the same JSON as farm-independent defaults; the director can override any code per farm.
 */
import AA from './norms/aa-norms.json';
import { workingTemperature } from './log';

export type Norms = typeof AA;
export type NormCode = Exclude<keyof Norms, '_source'>;
export const AA_NORMS: Norms = AA;
export const NORM_CODES = Object.keys(AA).filter((k) => k !== '_source') as NormCode[];

/** Defaults with the farm's overrides on top (one object per code, replaced whole). */
export function mergeNorms(overrides: Partial<Record<NormCode, unknown>>): Norms {
  return { ...AA_NORMS, ...(overrides as Partial<Norms>) };
}

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => (x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
function interp<T extends { day: number }>(rows: T[], day: number, pick: (r: T) => number): number {
  if (day <= rows[0]!.day) return pick(rows[0]!);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!, b = rows[i + 1]!;
    if (day <= b.day) return lerp(day, a.day, b.day, pick(a), pick(b));
  }
  return pick(rows[rows.length - 1]!);
}

/**
 * Target air temperature for the day of age. With a humidity reading, uses Table 3 (same effective
 * temperature at that RH); without it, Table 2 for whole-house brooding.
 */
export function targetTemp(n: Norms, day: number, rh?: number | null): number {
  if (rh == null || Number.isNaN(rh)) return interp(n.temp_by_age.rows, day, (r) => r.whole);
  const cols = n.rh_adjust.rh;
  const r = Math.min(Math.max(rh, cols[0]!), cols[cols.length - 1]!);
  let j = 0;
  while (j < cols.length - 2 && r > cols[j + 1]!) j++;
  return interp(n.rh_adjust.rows, day, (row) => lerp(r, cols[j]!, cols[j + 1]!, row.t[j]!, row.t[j + 1]!));
}

/** Expected water:feed range at the working temperature (low = nipples, high = bell drinkers). */
export function waterFeedRange(n: Norms, workingT: number | null): [number, number] {
  const k = workingT != null && workingT > n.water_feed.ref_temp ? 1 + n.water_feed.per_degree * (workingT - n.water_feed.ref_temp) : 1;
  return [n.water_feed.nipple * k, n.water_feed.bell * k];
}

export function feedPhaseFor(n: Norms, day: number): 'starter' | 'grower' | 'finisher' {
  const row = n.feed_phases.rows.find((r) => day >= r.from_day && (r.to_day == null || day <= r.to_day));
  return (row?.phase ?? 'finisher') as 'starter' | 'grower' | 'finisher';
}

export interface LogCheckInput {
  day: number;
  liveBirdsStart: number;
  placed: number;
  deaths: number;
  culls: number;
  /** Deaths + culls since placement, including today. */
  lossesToDate: number;
  feedKg: number | null;
  waterL: number | null;
  tMin: number | null;
  tMax: number | null;
  rh: number | null;
}
export interface Check { code: string; level: 'ok' | 'warn' | 'crit'; title: string; detail: string }

const f1 = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Norm check of one daily log (shown to the worker on save, works offline). */
export function checkLog(n: Norms, x: LogCheckInput): Check[] {
  const out: Check[] = [];
  const dayPct = ((x.deaths + x.culls) / Math.max(1, x.liveBirdsStart)) * 100;
  out.push({ code: 'mortality', level: dayPct > n.mortality.daily_max_pct * 2 ? 'crit' : dayPct > n.mortality.daily_max_pct ? 'warn' : 'ok', title: 'Падёж и брак',
    detail: `${x.deaths + x.culls} гол. = ${f2(dayPct)}% · норма до ${f2(n.mortality.daily_max_pct)}% в день` });
  if (x.day <= 7) {
    const cum = (x.lossesToDate / Math.max(1, x.placed)) * 100;
    out.push({ code: 'week1', level: cum > n.mortality.week1_crit_pct ? 'crit' : cum > n.mortality.week1_warn_pct ? 'warn' : 'ok', title: 'Отход первой недели',
      detail: `${f2(cum)}% с посадки · норма к 7 дню ≤ ${f1(n.mortality.week1_warn_pct)}%` });
  }
  const wt = x.tMin != null && x.tMax != null ? workingTemperature(x.tMin, x.tMax) : null;
  if (wt != null) {
    const target = targetTemp(n, x.day, x.rh);
    const d = wt - target;
    out.push({ code: 'temp', level: Math.abs(d) > n.temp_by_age.tolerance ? 'warn' : 'ok', title: 'Температура',
      detail: `Рабочая ${f1(wt)} °C · цель AA ${f1(target)} °C${x.rh != null ? ` при ОВ ${Math.round(x.rh)}%` : ''} (±${f1(n.temp_by_age.tolerance)})${Math.abs(d) > n.temp_by_age.tolerance ? (d > 0 ? ' — жарко' : ' — холодно') : ''}` });
  }
  if (x.waterL != null && x.feedKg) {
    const ratio = x.waterL / x.feedKg;
    const [lo, hi] = waterFeedRange(n, wt);
    out.push({ code: 'water_feed', level: ratio < lo * 0.95 || ratio > hi * 1.05 ? 'warn' : 'ok', title: 'Вода : корм',
      detail: `${f2(ratio)} · норма ${f2(lo)}–${f2(hi)}${ratio < lo * 0.95 ? ' — проверьте ниппели, напор, здоровье' : ''}` });
  }
  if (x.rh != null) {
    const low = x.day < n.humidity.min_until_day && x.rh < n.humidity.min_pct;
    const high = x.day >= n.humidity.max_from_day && x.rh > n.humidity.max_pct;
    out.push({ code: 'rh', level: low || high ? 'warn' : 'ok', title: 'Влажность',
      detail: `${Math.round(x.rh)}%${low ? ` — ниже ${n.humidity.min_pct}% в первые ${n.humidity.min_until_day} дней` : high ? ` — выше ${n.humidity.max_pct}%: риск мокрой подстилки` : ''}` });
  }
  return out;
}
