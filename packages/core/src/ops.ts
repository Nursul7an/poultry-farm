/** Operations recorded by workers (feed, health, weighing, catch) and the director's money view. */
import { addDays } from './time';

export type FeedType = 'starter' | 'grower' | 'finisher';
export const FEED_TYPE_RU: Record<FeedType, string> = { starter: 'Старт', grower: 'Рост', finisher: 'Финиш' };

/** Earliest slaughter after a treatment: last dose (start + course − 1) + withdrawal days + 1. Matches the DB column. */
export function earliestSlaughter(startOn: string, courseDays: number, withdrawalDays: number): string {
  return addDays(startOn, courseDays + withdrawalDays);
}

/** Latest earliest-slaughter date among treatments, or null. Catch before it needs a reason. */
export function withdrawalUntil(treatments: { startOn: string; courseDays: number; withdrawalDays: number }[]): string | null {
  const ds = treatments.map((t) => earliestSlaughter(t.startOn, t.courseDays, t.withdrawalDays)).sort();
  return ds.length ? ds[ds.length - 1]! : null;
}

export interface WeighingStats { n: number; mean: number; sd: number | null; cv: number | null }
/** Individual sample weights in grams → n, mean, sample SD, CV%. AA Appendix 3 example: mean 2550, SD 250 → CV 9.8. */
export function weighingStats(samples: number[]): WeighingStats {
  const n = samples.length;
  if (!n) return { n: 0, mean: 0, sd: null, cv: null };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null, cv: null };
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, cv: (sd / mean) * 100 };
}
/** Weighing sample target: max(100 birds, 1% of live birds). */
export const sampleTarget = (liveBirds: number) => Math.max(100, Math.ceil(liveBirds * 0.01));

/** Feed in the bin = delivered tonnes − feed logged as given (kg). Days left use the last 3 logged days. */
export function binStock(deliveredT: number[], loggedKg: (number | null)[], last3Kg: (number | null)[]) {
  const stockT = deliveredT.reduce((a, b) => a + b, 0) - loggedKg.reduce<number>((a, b) => a + (b ?? 0), 0) / 1000;
  const used = last3Kg.filter((x): x is number => x != null);
  const perDayT = used.length ? used.reduce((a, b) => a + b, 0) / used.length / 1000 : null;
  return { stockT, perDayT, daysLeft: perDayT ? stockT / perDayT : null };
}

export type CostCategory = 'energy' | 'wages' | 'litter' | 'vet' | 'transport' | 'other';
export const COST_RU: Record<CostCategory | 'chicks' | 'feed' | 'medicine', string> = {
  chicks: 'Цыплята', feed: 'Корм', medicine: 'Ветпрепараты', energy: 'Газ, уголь, свет', wages: 'Зарплата',
  litter: 'Подстилка', vet: 'Ветврач', transport: 'Транспорт, отлов', other: 'Прочее',
};

export interface MoneyInput {
  chicks: { waybill: number; price: number | null }[];
  feed: { tonnes: number; pricePerT: number | null }[];
  medicine: { price: number | null }[];
  costs: { category: CostCategory; amount: number }[];
  sales: { kg: number; pricePerKg: number | null; paid: number }[];
  placed: number;
}
/** The director's money summary. Items without a price are counted, never guessed. */
export function batchMoney(m: MoneyInput) {
  const byCat: Record<string, number> = {};
  const add = (k: string, v: number) => { byCat[k] = (byCat[k] ?? 0) + v; };
  let unpriced = 0;
  for (const c of m.chicks) c.price == null ? unpriced++ : add('chicks', c.waybill * c.price);
  for (const f of m.feed) f.pricePerT == null ? unpriced++ : add('feed', f.tonnes * f.pricePerT);
  for (const x of m.medicine) x.price == null ? unpriced++ : add('medicine', x.price);
  for (const c of m.costs) add(c.category, c.amount);
  const totalCost = Object.values(byCat).reduce((a, b) => a + b, 0);
  let revenue = 0, paid = 0, kgSold = 0;
  for (const s of m.sales) { kgSold += s.kg; paid += s.paid; if (s.pricePerKg == null) unpriced++; else revenue += s.kg * s.pricePerKg; }
  return {
    byCategory: byCat, totalCost, perBirdPlaced: m.placed ? totalCost / m.placed : null,
    revenue, paid, owed: revenue - paid, profit: revenue - totalCost,
    profitPerKg: kgSold ? (revenue - totalCost) / kgSold : null, unpriced,
  };
}

// ---------------------------------------------------------------- batch result and shared costs (v3: one batch per block)

export interface BatchResultInput {
  placedOn: string;
  placed: number;
  logs: { deaths: number; culls: number; feedKg: number | null }[];
  handovers: { handedOn: string; birds: number; kg: number; transportDead?: number | null }[];
}
/**
 * Result of one batch (block cycle). Survival and weight come from what was handed over; FCR = feed given / kg handed;
 * EPEF (European production efficiency factor) = survival % × live weight kg ÷ (age days × FCR) × 100.
 */
export function batchResult(x: BatchResultInput) {
  const losses = x.logs.reduce((a, l) => a + l.deaths + l.culls, 0);
  const feedKg = x.logs.reduce((a, l) => a + (l.feedKg ?? 0), 0);
  const handedBirds = x.handovers.reduce((a, h) => a + h.birds, 0);
  const handedKg = x.handovers.reduce((a, h) => a + h.kg, 0);
  const lastDay = x.handovers.map((h) => h.handedOn).sort().pop() ?? null;
  const days = lastDay ? Math.round((Date.parse(lastDay) - Date.parse(x.placedOn)) / 86_400_000) : null;
  const survivalPct = x.placed ? ((handedBirds || x.placed - losses) / x.placed) * 100 : null;
  const avgWeightKg = handedBirds ? handedKg / handedBirds : null;
  const fcr = handedKg ? feedKg / handedKg : null;
  const epef = survivalPct != null && avgWeightKg != null && fcr && days ? (survivalPct * avgWeightKg) / (days * fcr) * 100 : null;
  return { placed: x.placed, losses, alive: x.placed - losses, handedBirds, handedKg, feedKg, days, survivalPct, avgWeightKg, fcr, epef,
    /** Birds neither recorded as lost nor handed over: counting error or theft — the director should see it. */
    unaccounted: handedBirds ? x.placed - losses - handedBirds : null };
}

export interface BatchSpan { id: string; placed: number; from: string; to: string | null }
/**
 * Shared farm costs (light, gas, wages…) split between batches by chicks placed (owner's rule).
 * A cost goes to the batches running on its date; a cost in an empty period (cleaning, pre-heating) goes to the
 * batches that start within the next 14 days; otherwise it stays unallocated and is shown as such.
 */
export function splitSharedCosts<C extends { amount: number; spentOn: string }>(costs: C[], batches: BatchSpan[]) {
  const shares = new Map<string, { cost: C; amount: number }[]>();
  let unallocated = 0;
  const day = (s: string) => Date.parse(s.slice(0, 10));
  for (const c of costs) {
    const d = day(c.spentOn);
    let on = batches.filter((b) => day(b.from) <= d && (b.to == null || day(b.to) >= d));
    if (!on.length) on = batches.filter((b) => day(b.from) > d && day(b.from) - d <= 14 * 86_400_000);
    const total = on.reduce((a, b) => a + b.placed, 0);
    if (!total) { unallocated += c.amount; continue; }
    for (const b of on) {
      const list = shares.get(b.id) ?? [];
      list.push({ cost: c, amount: (c.amount * b.placed) / total });
      shares.set(b.id, list);
    }
  }
  return { shares, unallocated };
}
