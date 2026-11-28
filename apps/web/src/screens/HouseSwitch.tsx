import type { HouseBatchInfo } from '../api/types';

/** Segmented switch between the user's houses (workers: own houses; director: all). */
export function HouseSwitch({ houses, current, select }: { houses: HouseBatchInfo[]; current: HouseBatchInfo | null; select: (id: string) => void }) {
  if (houses.length < 2 || !current) return null;
  return (
    <div className="seg pad" role="group" aria-label="Блок">
      {houses.map((h) => (
        <button key={h.houseBatchId} className={h.houseBatchId === current.houseBatchId ? 'on' : ''} aria-pressed={h.houseBatchId === current.houseBatchId} onClick={() => select(h.houseBatchId)}>{h.houseName}</button>
      ))}
    </div>
  );
}
