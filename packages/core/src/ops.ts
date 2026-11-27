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
