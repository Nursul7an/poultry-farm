/** Feed warehouse arithmetic, shared by the warehouse screen, the issue form, blocks and money. */
import { daysBetween } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { FeedIssue, FeedKind, FeedLot, LogRecord } from '../api/types';

export const FEED_KIND_RU: Record<FeedKind, string> = { starter: 'Старт', grower: 'Рост', finisher: 'Финиш', other: 'Другой' };
export const EXPIRY_WARN_DAYS = 14;

/**
 * Stock left in a lot as this phone knows it: the server's count (all blocks) minus issues still waiting to be sent.
 * A lot recorded offline has no server count yet: its kg minus local issues.
 */
export function lotLeft(lot: FeedLot, localIssues: FeedIssue[], pendingIds: Set<string>): number {
  const pending = localIssues.filter((i) => i.lotId === lot.id && pendingIds.has(i.id)).reduce((a, i) => a + i.kg, 0);
  if (lot.leftKg != null) return lot.leftKg - pending;
  return lot.kg - localIssues.filter((i) => i.lotId === lot.id).reduce((a, i) => a + i.kg, 0);
}

export type ExpiryState = 'ok' | 'soon' | 'expired' | 'unknown';
export function expiryState(lot: FeedLot, today: string): ExpiryState {
  if (!lot.expiresOn) return 'unknown';
  const d = daysBetween(today, lot.expiresOn);
  return d < 0 ? 'expired' : d <= EXPIRY_WARN_DAYS ? 'soon' : 'ok';
}

/** First expires, first out; lots without a date go last, then by arrival. */
export function fifo<T extends FeedLot>(lots: T[]): T[] {
  return [...lots].sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999') || a.receivedOn.localeCompare(b.receivedOn));
}

/** Feed in a block's bin: issued to it minus what the daily logs say was fed; per-day use from the last 3 days. */
export function binOfBlock(issues: FeedIssue[], logs: LogRecord[], today: string) {
  const issued = issues.reduce((a, i) => a + i.kg, 0);
  const fed = logs.reduce((a, l) => a + (l.feedKg ?? 0), 0);
  const last3 = logs.filter((l) => l.productionDay < today).sort((a, b) => b.productionDay.localeCompare(a.productionDay)).slice(0, 3).map((l) => l.feedKg ?? 0);
  const perDay = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null;
  const left = issued - fed;
  return { issued, fed, left, perDay, daysLeft: perDay ? left / perDay : null };
}

/** Warehouse lots with what is left, as this phone knows it (works offline). */
export function useWarehouse() {
  const { db } = useSignedIn();
  const lots = useLive(() => db.feedLots.toArray(), [db], [] as FeedLot[]);
  const issues = useLive(() => db.feedIssues.toArray(), [db], [] as FeedIssue[]);
  const pending = useLive(() => db.outbox.toArray().then((o) => new Set(o.map((x) => x.logId))), [db], new Set<string>());
  const withLeft = lots.map((l) => ({ ...l, left: Math.max(0, lotLeft(l, issues, pending)), pending: pending.has(l.id) }));
  return { lots: withLeft, issues, pending };
}
