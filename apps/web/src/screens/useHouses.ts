import { useEffect, useState } from 'react';
import { dayOfAge, liveBirds } from '@farm/core';
import { useLive, useSignedIn } from '../app';
import type { HouseBatchInfo, LogRecord } from '../api/types';

const KEY = 'farm-selected-house';

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
