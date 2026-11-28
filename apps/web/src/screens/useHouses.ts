import { useEffect, useState } from 'react';
import { dayOfAge, liveBirds } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { FeedDelivery, Handover, HealthEvent, HouseBatchInfo, LogRecord, Weighing } from '../api/types';

export const SELECTED_HOUSE_KEY = 'farm-selected-house';
const KEY = SELECTED_HOUSE_KEY;

/** The user's houses from the local cache, plus the remembered selection. */
export function useHouses() {
  const { db } = useSignedIn();
  const houses = useLive(() => db.houseBatches.toArray().then((x) => x.sort((a, b) => a.houseName.localeCompare(b.houseName))), [db], [] as HouseBatchInfo[]);
  const [selected, setSelected] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  useEffect(() => {
    if (houses.length && !houses.some((h) => h.houseBatchId === selected)) setSelected(houses[0]!.houseBatchId);
  }, [houses, selected]);
  const select = (id: string) => { setSelected(id); try { localStorage.setItem(KEY, id); } catch { /* private mode */ } };
  return { houses, current: houses.find((h) => h.houseBatchId === selected) ?? houses[0] ?? null, select };
}

export function useHouseLogs(houseBatchId: string | undefined) {
  const { db } = useSignedIn();
  return useLive(() => (houseBatchId ? db.logsFor(houseBatchId) : Promise.resolve([])), [db, houseBatchId], [] as LogRecord[]);
}

export function houseFigures(h: HouseBatchInfo, logs: LogRecord[], today: string) {
  return { day: dayOfAge(h.placedOn, today), live: liveBirds(h.placed, logs) };
}

export function useHouseOps(houseBatchId: string | undefined) {
  const { db } = useSignedIn();
  const q = <T,>(t: { where(k: string): { equals(v: string): { toArray(): Promise<T[]> } } }) =>
    () => (houseBatchId ? t.where('houseBatchId').equals(houseBatchId).toArray() : Promise.resolve([] as T[]));
  const feed = useLive(q(db.feed as any) as () => Promise<FeedDelivery[]>, [db, houseBatchId], [] as FeedDelivery[]);
  const health = useLive(q(db.health as any) as () => Promise<HealthEvent[]>, [db, houseBatchId], [] as HealthEvent[]);
  const weighings = useLive(q(db.weighings as any) as () => Promise<Weighing[]>, [db, houseBatchId], [] as Weighing[]);
  const handovers = useLive(q(db.handovers as any) as () => Promise<Handover[]>, [db, houseBatchId], [] as Handover[]);
  return { feed, health, weighings, handovers };
}
