/** Date helpers that work in the farm's time zone, not the device's. */

export const DEFAULT_TZ = 'Asia/Bishkek';
export const DEFAULT_DAY_START_HOUR = 8;

/** Local calendar parts of `at` in time zone `tz`. */
export function localParts(at: Date, tz: string): { y: number; m: number; d: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) };
}

/** ISO date string (YYYY-MM-DD) shifted by `days`. Pure calendar arithmetic, no time zone. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * The production day an event at `at` belongs to.
 * With the default 08:00 start, 07:59 on 25.11 still belongs to 24.11 (night deaths count in the same day).
 */
export function productionDay(at: Date, tz = DEFAULT_TZ, dayStartHour = DEFAULT_DAY_START_HOUR): string {
  const p = localParts(at, tz);
  const iso = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return p.hour < dayStartHour ? addDays(iso, -1) : iso;
}

/** Whole days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Day of age of a house: placement day is day 0. Each house uses its own placement date. */
export function dayOfAge(placedOn: string, day: string): number {
  return daysBetween(placedOn, day);
}

export const WORKER_EDIT_WINDOW_HOURS = 48;

/** Whether a worker may still edit a record created at `createdAt` (server time is authoritative). */
export function withinWorkerEditWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= WORKER_EDIT_WINDOW_HOURS * 3_600_000;
}
