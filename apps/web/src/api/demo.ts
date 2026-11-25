/**
 * Demo backend: runs entirely in this browser (localStorage) so the app can be tried without a Supabase project,
 * and so E2E tests run without a server. It mirrors the server rules in supabase/migrations
 * (access per house, future/old days, 48-hour edit window, water litres, one log per house per day).
 * The real rules live in SQL; keep the two in step when changing either.
 */
import { addDays, productionDay, withinWorkerEditWindow } from '@farm/core';
import type { Api, House, HouseBatchInfo, HouseToday, LogRecord, Session, Worker } from './types';
import { ApiError } from './types';
import { normalizePhone } from './phone';

interface DemoUser { id: string; role: 'head' | 'worker'; displayName: string; phone: string; pin: string; houseIds: string[]; active: boolean }
interface DemoHB { id: string; houseId: string; placedOn: string; placed: number }
interface DemoState {
  v: 1;
  farm: Session['farm'];
  users: DemoUser[];
  houses: House[];
  batch: { id: string; name: string; status: 'open' | 'closed' };
  hbs: DemoHB[];
  logs: LogRecord[];
}

const KEY = 'farm-demo-v1';
const SESSION_KEY = 'farm-demo-session';

export const DEMO_ACCOUNTS = [
  { label: 'Руководитель', phone: '+996 700 000 001', pin: '111111' },
  { label: 'Айгуль Т. (П-1, П-2)', phone: '+996 700 000 002', pin: '222222' },
  { label: 'Нурлан Ж. (П-3, П-4)', phone: '+996 700 000 003', pin: '333333' },
];

function seed(now = new Date()): DemoState {
  const farm = { id: 'farm-1', name: 'Бройлерная ферма (демо)', tz: 'Asia/Bishkek', dayStartHour: 8 };
  const today = productionDay(now, farm.tz, farm.dayStartHour);
  const placedOn = addDays(today, -23);
  const houses: House[] = ['П-1', 'П-2', 'П-3', 'П-4'].map((name, i) => ({
    id: `house-${i + 1}`, name, areaM2: 1000, hasWaterMeter: i !== 3, drinkerType: 'ниппели', feederType: i < 2 ? 'чашки' : 'цепной',
  }));
  const placed = [17050, 16980, 17020, 16950];
  const hbs = houses.map((h, i) => ({ id: `hb-${i + 1}`, houseId: h.id, placedOn, placed: placed[i]! }));
  const mort = [0, 22, 18, 15, 12, 10, 9, 8, 8, 7, 7, 8, 9, 8, 9, 10, 9, 10, 11, 12, 11, 12, 13];
  const logs: LogRecord[] = [];
  const created = new Date(now.getTime() - 60 * 3_600_000).toISOString();
  hbs.forEach((hb, hi) => {
    let meter = 950 + hi * 40;
    for (let d = 1; d <= 22; d++) {
      const feed = Math.round(17000 * (13 + 4.6 * d) / 1000 / 10) * 10;
      const water = Math.round(feed * 1.74);
      meter = Math.round((meter + water / 1000) * 100) / 100;
      const deaths = Math.max(0, mort[d]! + ((d + hi) % 3) - 1);
      logs.push({
        id: `seed-${hb.id}-${d}`, houseBatchId: hb.id, productionDay: addDays(placedOn, d),
        deaths, culls: d % 4 === 0 ? 2 : 0, cullReason: d % 4 === 0 ? 'legs' : null,
        feedKg: feed, waterMeter: houses[hi]!.hasWaterMeter ? meter : null, newMeter: false,
        waterL: houses[hi]!.hasWaterMeter && d > 1 ? water : null,
        tMin: 21.4 + (d % 3) * 0.2, tMax: 23 + (d % 2) * 0.3, rh: 60 + (d % 5), note: null,
        createdAt: created, updatedAt: created, createdBy: hi < 2 ? 'u-aigul' : 'u-nurlan',
      });
    }
  });
  return {
    v: 1, farm, houses, hbs, logs,
    batch: { id: 'batch-6', name: '06/2026', status: 'open' },
    users: [
      { id: 'u-head', role: 'head', displayName: 'Руководитель', phone: '+996700000001', pin: '111111', houseIds: [], active: true },
      { id: 'u-aigul', role: 'worker', displayName: 'Айгуль Т.', phone: '+996700000002', pin: '222222', houseIds: ['house-1', 'house-2'], active: true },
      { id: 'u-nurlan', role: 'worker', displayName: 'Нурлан Ж.', phone: '+996700000003', pin: '333333', houseIds: ['house-3', 'house-4'], active: true },
    ],
  };
}

export class DemoApi implements Api {
  readonly mode = 'demo' as const;
  private s: DemoState;
  constructor(private latencyMs = 120) {
    const raw = localStorage.getItem(KEY);
    this.s = raw ? (JSON.parse(raw) as DemoState) : seed();
    this.save();
  }
  static reset() { localStorage.removeItem(KEY); localStorage.removeItem(SESSION_KEY); }
  private save() { localStorage.setItem(KEY, JSON.stringify(this.s)); }

  private async net<T>(fn: () => T): Promise<T> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError('NETWORK');
    return fn();
  }
  private me(): DemoUser {
    const id = localStorage.getItem(SESSION_KEY);
    const u = this.s.users.find((x) => x.id === id && x.active);
    if (!u) throw new ApiError('AUTH');
    return u;
  }
  private session(u: DemoUser): Session {
    return { userId: u.id, role: u.role, displayName: u.displayName, phone: u.phone, farm: this.s.farm };
  }
  private visibleHbs(u: DemoUser): DemoHB[] {
    return this.s.hbs.filter((hb) => u.role === 'head' || u.houseIds.includes(hb.houseId));
  }
  private today() { return productionDay(new Date(), this.s.farm.tz, this.s.farm.dayStartHour); }

  signIn(phone: string, pin: string) {
    return this.net(() => {
      const u = this.s.users.find((x) => x.phone === normalizePhone(phone) && x.pin === pin && x.active);
      if (!u) throw new ApiError('AUTH');
      localStorage.setItem(SESSION_KEY, u.id);
      return this.session(u);
    });
  }
  async restore() {
    const id = localStorage.getItem(SESSION_KEY);
    const u = this.s.users.find((x) => x.id === id && x.active);
    return u ? this.session(u) : null;
  }
  async signOut() { localStorage.removeItem(SESSION_KEY); }

  myHouseBatches() {
    return this.net((): HouseBatchInfo[] => {
      const u = this.me();
      return this.visibleHbs(u).map((hb) => {
        const h = this.s.houses.find((x) => x.id === hb.houseId)!;
        return { houseBatchId: hb.id, houseId: h.id, houseName: h.name, placedOn: hb.placedOn, placed: hb.placed, hasWaterMeter: h.hasWaterMeter, batchName: this.s.batch.name };
      }).sort((a, b) => a.houseName.localeCompare(b.houseName));
    });
  }
  recentLogs(ids: string[], sinceDay: string) {
    return this.net(() => {
      const allowed = new Set(this.visibleHbs(this.me()).map((h) => h.id));
      return this.s.logs.filter((l) => ids.includes(l.houseBatchId) && allowed.has(l.houseBatchId) && l.productionDay >= sinceDay).map((l) => ({ ...l }));
    });
  }

  upsertLog(rec: LogRecord) {
    return this.net(() => {
      const u = this.me();
      if (!this.visibleHbs(u).some((h) => h.id === rec.houseBatchId)) throw new ApiError('FORBIDDEN');
      if (this.s.batch.status === 'closed') throw new ApiError('BATCH_CLOSED');
      const existing = this.s.logs.find((l) => l.id === rec.id) ?? this.s.logs.find((l) => l.houseBatchId === rec.houseBatchId && l.productionDay === rec.productionDay);
      const now = new Date();
      if (!existing) {
        const today = this.today();
        if (rec.productionDay > today) throw new ApiError('DAY_IN_FUTURE');
        if (u.role !== 'head' && rec.productionDay < addDays(today, -2)) throw new ApiError('DAY_TOO_OLD');
      } else if (!withinWorkerEditWindow(new Date(existing.createdAt!), now)) {
        if (u.role !== 'head') throw new ApiError('EDIT_WINDOW');
        if (!rec.editReason?.trim()) throw new ApiError('REASON_REQUIRED');
      }
      if (rec.culls > 0 && !rec.cullReason) throw new ApiError('VALIDATION');
      let waterL: number | null = null;
      if (rec.waterMeter != null && !rec.newMeter) {
        const prev = this.s.logs
          .filter((l) => l.houseBatchId === rec.houseBatchId && l.productionDay < rec.productionDay && l.waterMeter != null)
          .sort((a, b) => b.productionDay.localeCompare(a.productionDay))[0];
        if (prev?.waterMeter != null) {
          if (rec.waterMeter < prev.waterMeter) throw new ApiError('METER_BACKWARDS');
          waterL = Math.round((rec.waterMeter - prev.waterMeter) * 1000);
        }
      }
      const stored: LogRecord = {
        ...rec, waterL,
        id: existing?.id ?? rec.id,
        createdAt: existing?.createdAt ?? now.toISOString(),
        createdBy: existing?.createdBy ?? u.id,
        updatedAt: now.toISOString(),
      };
      this.s.logs = this.s.logs.filter((l) => l.id !== stored.id).concat(stored);
      this.save();
      return { ...stored };
    });
  }

  houseToday() {
    return this.net((): HouseToday[] => {
      const u = this.me();
      const today = this.today();
      return this.visibleHbs(u).map((hb) => {
        const h = this.s.houses.find((x) => x.id === hb.houseId)!;
        const logs = this.s.logs.filter((l) => l.houseBatchId === hb.id);
        const t = logs.find((l) => l.productionDay === today);
        const y = logs.find((l) => l.productionDay === addDays(today, -1));
        const workers = this.s.users.filter((x) => x.role === 'worker' && x.houseIds.includes(h.id)).map((x) => x.displayName).join(', ') || null;
        return {
          houseBatchId: hb.id, houseName: h.name, workers, areaM2: h.areaM2, placed: hb.placed,
          dayOfAge: Math.round((Date.parse(today) - Date.parse(hb.placedOn)) / 86_400_000),
          liveBirds: hb.placed - logs.reduce((s, l) => s + l.deaths + l.culls, 0),
          today: t ? { deaths: t.deaths, culls: t.culls, feedKg: t.feedKg, waterL: t.waterL, tMin: t.tMin, tMax: t.tMax, rh: t.rh, loggedAt: t.updatedAt! } : null,
          yesterdayDeaths: y ? y.deaths + y.culls : null,
        };
      }).sort((a, b) => a.houseName.localeCompare(b.houseName));
    });
  }

  private head(): DemoUser { const u = this.me(); if (u.role !== 'head') throw new ApiError('FORBIDDEN'); return u; }
  listHouses() { return this.net(() => { this.head(); return this.s.houses.map((h) => ({ ...h })); }); }
  createHouse(h: Omit<House, 'id'>) {
    return this.net(() => {
      this.head();
      if (this.s.houses.some((x) => x.name === h.name)) throw new ApiError('VALIDATION', 'Птичник с таким названием уже есть');
      const house = { ...h, id: `house-${Date.now()}` };
      this.s.houses.push(house); this.save();
      return house;
    });
  }
  listWorkers() {
    return this.net((): Worker[] => { this.head(); return this.s.users.filter((u) => u.role === 'worker').map(({ id, displayName, phone, houseIds, active }) => ({ id, displayName, phone, houseIds: [...houseIds], active })); });
  }
  inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }) {
    return this.net(() => {
      this.head();
      const phone = normalizePhone(w.phone);
      if (this.s.users.some((u) => u.phone === phone)) throw new ApiError('VALIDATION', 'Этот номер уже есть');
      this.s.users.push({ id: `u-${Date.now()}`, role: 'worker', displayName: w.displayName, phone, pin: w.pin, houseIds: w.houseIds, active: true });
      this.save();
    });
  }
  setWorkerHouses(workerId: string, houseIds: string[]) {
    return this.net(() => { this.head(); const u = this.s.users.find((x) => x.id === workerId); if (u) u.houseIds = houseIds; this.save(); });
  }
  changePin(newPin: string) {
    return this.net(() => { const u = this.me(); u.pin = newPin; this.save(); });
  }
}
