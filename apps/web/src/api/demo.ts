/**
 * Demo backend: runs entirely in this browser (localStorage) so the app can be tried without a Supabase project,
 * and so E2E tests run without a server. It mirrors the server rules in supabase/migrations
 * (access per house, future/old days, 48-hour edit window, water litres, one log per house per day).
 * The real rules live in SQL; keep the two in step when changing either.
 */
import { AA_NORMS, addDays, earliestSlaughter, localParts, productionDay, weighingStats, withinWorkerEditWindow } from '@farm/core';
import type { Api, Article, AskAnswer, AskContext, BatchInfo, BatchResultJson, BatchRow, BlockInfo, FarmSummary, FarmSettings, NormRow, StaffEvent, Cost, FarmEvent, FeedDelivery, Handover, HealthEvent, House, HouseBatchInfo, HouseToday, LogRecord, MyHouse, OpsBundle, Payment, Price, Session, Weighing, Worker } from './types';
import { ApiError } from './types';
import { normalizePhone } from './phone';
import { searchArticles } from './search';
import { blockCode } from './blocks';

interface DemoUser { id: string; role: 'head' | 'worker'; displayName: string; phone: string; pin: string; houseIds: string[]; active: boolean }
type DemoHB = Omit<HouseBatchInfo, 'houseBatchId' | 'houseName' | 'hasWaterMeter' | 'batchName'> & { id: string; createdBy?: string };
interface DemoBatch { id: string; houseId: string; name: string; seq: number; status: 'open' | 'closed'; openedAt: string; closedAt: string | null; result?: BatchResultJson | null }
interface DemoState {
  v: 2;
  farm: Session['farm'];
  users: DemoUser[];
  houses: House[];
  /** One batch per block (v3): its number, e.g. "B-2026-07". */
  batches: DemoBatch[];
  hbs: DemoHB[];
  logs: LogRecord[];
  feed: FeedDelivery[];
  health: HealthEvent[];
  weighings: Weighing[];
  handovers: Handover[];
  prices: Price[];
  costs: Cost[];
  payments: Payment[];
  overrides: { at: string; houseBatchId: string; by: string; reason: string; catchAt: string; earliest: string }[];
  /** The director's changes to the Arbor Acres norms (code -> data). */
  normOverrides?: Record<string, unknown>;
  staffEvents?: { at: string; kind: StaffEvent['kind']; userId: string; actorId: string }[];
}

const KEY = 'farm-demo-v3';
const SESSION_KEY = 'farm-demo-session';

export const DEMO_ACCOUNTS = [
  { label: 'Директор', phone: '+996 700 000 001', pin: '111111' },
  { label: 'Айгуль Т. (П-1, П-2)', phone: '+996 700 000 002', pin: '222222' },
  { label: 'Нурлан Ж. (П-3, П-4)', phone: '+996 700 000 003', pin: '333333' },
];

function seed(now = new Date()): DemoState {
  const farm = { id: 'farm-1', name: 'Бройлерная ферма (демо)', tz: 'Asia/Bishkek', dayStartHour: 8 };
  const today = productionDay(now, farm.tz, farm.dayStartHour);
  const placedOn = addDays(today, -23);
  const houses: House[] = ['A', 'B', 'C', 'D', 'E'].map((code, i) => ({
    id: `house-${i + 1}`, name: `Блок ${code}`, code, areaM2: 1000, hasWaterMeter: i !== 3, drinkerType: 'ниппели', feederType: i < 2 ? 'чашки' : 'цепной',
  }));
  const year = placedOn.slice(0, 4);
  const placed = [17050, 16980, 17020, 16950];
  const created0 = new Date(Date.parse(placedOn + 'T03:00:00Z')).toISOString();
  // Blocks A–D are on day 23, each with its own batch; Block E is empty (no batch yet).
  const batches: DemoBatch[] = houses.slice(0, 4).map((h, i) => ({ id: `batch-${i + 1}`, houseId: h.id, name: `${h.code}-${year}-01`, seq: 1, status: 'open', openedAt: new Date(Date.parse(placedOn + 'T03:00:00Z')).toISOString(), closedAt: null }));
  const hbs: DemoHB[] = houses.slice(0, 4).map((h, i) => ({ id: `hb-${i + 1}`, houseId: h.id, placedOn, placed: placed[i]!, batchId: `batch-${i + 1}`,
    waybillCount: placed[i]! + 10, transportDead: 10, hatchery: 'Инкубаторий', parentAgeWeeks: i < 2 ? 34 : 48, day0WeightG: 41 + i * 0.6,
    cropFill: { '24': [96, 97, 95, 93][i]! }, feedPhase: 'grower', feedPhaseSince: addDays(placedOn, 10), catchAt: null, feedOffAt: null,
    catchOverrideReason: null, createdAt: created0, createdBy: i < 2 ? 'u-aigul' : 'u-nurlan' }));
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
  const by = (i: number) => (i < 2 ? 'u-aigul' : 'u-nurlan');
  const feed: FeedDelivery[] = [], health: HealthEvent[] = [], weighings: Weighing[] = [], prices: Price[] = batches.map((b) => ({ kind: 'chick' as const, refId: b.id, unitPrice: 70 }));
  hbs.forEach((hb, i) => {
    ([[0, 'starter', 6.5], [8, 'grower', 7.5], [15, 'grower', 8], [21, 'grower', 8]] as const).forEach(([d, t, tn]) => {
      const id = `feed-${hb.id}-${d}`;
      feed.push({ id, houseBatchId: hb.id, deliveredOn: addDays(placedOn, d), feedType: t, tonnes: tn, createdAt: created, createdBy: by(i) });
      if (!(i === 2 && d === 21)) prices.push({ kind: 'feed', refId: id, unitPrice: t === 'starter' ? 42000 : 38000 });
    });
    health.push({ id: `vac-${hb.id}-0`, houseBatchId: hb.id, kind: 'vaccination', eventOn: placedOn, product: 'Ньюкасл + ИБ', method: 'спрей', createdAt: created, createdBy: by(i) });
    health.push({ id: `vac-${hb.id}-14`, houseBatchId: hb.id, kind: 'vaccination', eventOn: addDays(placedOn, 14), product: 'Гамборо', method: 'с водой', createdAt: created, createdBy: by(i) });
    const spread = i === 2 ? 0.2 : 0.15;
    const samples = Array.from({ length: 120 }, (_, k) => Math.round(1000 * (1 + spread * Math.sin(k * 12.9898 + i) * 0.85)));
    const st = weighingStats(samples);
    weighings.push({ id: `w-${hb.id}-21`, houseBatchId: hb.id, weighedOn: addDays(placedOn, 21), method: 'individual', samplesG: samples, n: st.n, meanG: Math.round(st.mean), sdG: st.sd, cv: st.cv, createdAt: created, createdBy: by(i) });
  });
  return {
    v: 2, farm, houses, hbs, logs, feed, health, weighings, prices, handovers: [], costs: [
      { id: 'c1', batchId: null, category: 'energy', amount: 620000, spentOn: addDays(placedOn, 10), comment: 'газ, уголь' },
      { id: 'c2', batchId: null, category: 'wages', amount: 450000, spentOn: addDays(placedOn, 15), comment: null },
      { id: 'c3', batchId: null, category: 'litter', amount: 180000, spentOn: addDays(placedOn, -2), comment: 'опилки' },
    ], payments: [], overrides: [],
    batches,
    users: [
      { id: 'u-head', role: 'head', displayName: 'Директор', phone: '+996700000001', pin: '111111', houseIds: [], active: true },
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
  private batchOfHb(hbId: string) { const hb = this.s.hbs.find((h) => h.id === hbId); return this.s.batches.find((b) => b.id === hb?.batchId); }
  private hbOpen(hb: DemoHB) { return this.s.batches.find((b) => b.id === hb.batchId)?.status !== 'closed'; }

  signIn(phone: string, pin: string) {
    return this.net(() => {
      const u = this.s.users.find((x) => x.phone === normalizePhone(phone) && x.pin === pin);
      if (!u) throw new ApiError('AUTH');
      if (!u.active) throw new ApiError('FORBIDDEN', 'Доступ закрыт. Обратитесь к директору.');
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
      return this.visibleHbs(u).filter((hb) => this.hbOpen(hb)).map((hb) => {
        const h = this.s.houses.find((x) => x.id === hb.houseId)!;
        return this.hbInfo(hb, h);
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
      if (this.batchOfHb(rec.houseBatchId)?.status === 'closed') throw new ApiError('BATCH_CLOSED');
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
      return this.visibleHbs(u).filter((hb) => this.hbOpen(hb)).map((hb) => {
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
  // ------------------------------------------------------------ farm and people (mirror manage-worker + 20261128000001_people.sql)
  updateFarm(f: FarmSettings) {
    return this.net(() => { this.head(); this.s.farm = { ...this.s.farm, ...f }; this.save(); return { ...this.s.farm }; });
  }
  // ------------------------------------------------------------ several farms: other farms' data is kept under KEY:<farmId>
  private farmIds(): string[] {
    try { const ids = JSON.parse(localStorage.getItem(`${KEY}:farms`) ?? '[]') as string[]; return ids.includes(this.s.farm.id) ? ids : [this.s.farm.id, ...ids]; }
    catch { return [this.s.farm.id]; }
  }
  private stash() { localStorage.setItem(`${KEY}:${this.s.farm.id}`, JSON.stringify(this.s)); }
  private summary(st: DemoState, current: boolean): FarmSummary {
    const active = st.houses.filter((h) => h.active !== false);
    return { id: st.farm.id, name: st.farm.name, region: st.farm.region ?? null, address: st.farm.address ?? null, blocks: active.length,
      areaM2: active.reduce((a, h) => a + h.areaM2, 0), birdsPerM2: st.farm.birdsPerM2 ?? 17, isCurrent: current };
  }
  myFarms() {
    return this.net((): FarmSummary[] => {
      this.head();
      return this.farmIds().map((id) => {
        if (id === this.s.farm.id) return this.summary(this.s, true);
        const raw = localStorage.getItem(`${KEY}:${id}`);
        return raw ? this.summary(JSON.parse(raw) as DemoState, false) : null;
      }).filter((x): x is FarmSummary => !!x).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name));
    });
  }
  createFarm(f: FarmSettings) {
    return this.net(() => {
      const me = this.head();
      if (!f.name?.trim()) throw new ApiError('VALIDATION', 'Укажите название фермы');
      const ids = this.farmIds();
      this.stash();
      const farm = { ...this.s.farm, ...f, id: `farm-${Date.now()}`, name: f.name.trim() };
      this.s = { ...this.s, farm, users: [{ ...me, houseIds: [] }], houses: [], batches: [], hbs: [], logs: [], feed: [], health: [], weighings: [], handovers: [],
        prices: [], costs: [], payments: [], overrides: [], normOverrides: {}, staffEvents: [] };
      localStorage.setItem(`${KEY}:farms`, JSON.stringify([...ids, farm.id]));
      this.save();
      return this.session(this.me());
    });
  }
  switchFarm(farmId: string) {
    return this.net(() => {
      const me = this.head();
      if (farmId !== this.s.farm.id) {
        const raw = localStorage.getItem(`${KEY}:${farmId}`);
        if (!raw || !this.farmIds().includes(farmId)) throw new ApiError('FORBIDDEN');
        const ids = this.farmIds();
        this.stash();
        this.s = JSON.parse(raw) as DemoState;
        if (!this.s.users.some((u) => u.id === me.id)) this.s.users.push({ ...me, houseIds: [] });
        localStorage.setItem(`${KEY}:farms`, JSON.stringify(ids));
        this.save();
      }
      return this.session(this.me());
    });
  }
  listHouses() { return this.net(() => { this.head(); return this.s.houses.map((h) => ({ ...h, active: h.active !== false })); }); }
  createHouse(h: Omit<House, 'id'>) {
    return this.net(() => {
      this.head();
      if (this.s.houses.some((x) => x.name === h.name.trim())) throw new ApiError('VALIDATION', `${h.name.trim()} уже есть`);
      const house = { ...h, name: h.name.trim(), code: h.code ?? blockCode(h.name), id: `house-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, active: true };
      this.s.houses.push(house); this.save();
      return house;
    });
  }
  updateHouse(id: string, p: Partial<Omit<House, 'id'>>) {
    return this.net(() => {
      this.head();
      const h = this.s.houses.find((x) => x.id === id);
      if (!h) throw new ApiError('VALIDATION', 'Блок не найден');
      if (p.name && this.s.houses.some((x) => x.id !== id && x.name === p.name)) throw new ApiError('VALIDATION', `${p.name} уже есть`);
      Object.assign(h, p); if (p.name) h.code = blockCode(p.name); this.save();
    });
  }
  deleteHouse(id: string) {
    return this.net(() => {
      this.head();
      if (this.s.hbs.some((hb) => hb.houseId === id)) throw new ApiError('VALIDATION', 'У блока есть история партий — его можно только отключить');
      this.s.houses = this.s.houses.filter((h) => h.id !== id);
      this.s.users.forEach((u) => { u.houseIds = u.houseIds.filter((x) => x !== id); });
      this.save();
    });
  }
  listWorkers() {
    return this.net((): Worker[] => { this.head(); return this.s.users.filter((u) => u.role === 'worker').map(({ id, displayName, phone, houseIds, active }) => ({ id, displayName, phone, houseIds: [...houseIds], active })); });
  }
  private worker(id: string) {
    const u = this.s.users.find((x) => x.id === id && x.role === 'worker');
    if (!u) throw new ApiError('VALIDATION', 'Работник не найден');
    return u;
  }
  private phoneFree(phone: string, except?: string) {
    const other = this.s.users.find((u) => u.phone === phone && u.id !== except);
    if (other) throw new ApiError('VALIDATION', `Этот номер уже есть у ${other.displayName}`);
  }
  private logStaff(userId: string, kind: StaffEvent['kind']) {
    (this.s.staffEvents ??= []).push({ at: new Date().toISOString(), kind, userId, actorId: this.me().id });
  }
  inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }) {
    return this.net(() => {
      this.head();
      const phone = normalizePhone(w.phone);
      if (!/^\+996\d{9}$/.test(phone)) throw new ApiError('VALIDATION', 'Телефон: +996 и 9 цифр');
      if (!/^\d{6}$/.test(w.pin)) throw new ApiError('VALIDATION', 'PIN — 6 цифр');
      if (!w.displayName.trim()) throw new ApiError('VALIDATION', 'Укажите имя работника');
      this.phoneFree(phone);
      const id = `u-${Date.now()}`;
      this.s.users.push({ id, role: 'worker', displayName: w.displayName.trim(), phone, pin: w.pin, houseIds: w.houseIds, active: true });
      this.logStaff(id, 'created');
      this.save();
      return { id };
    });
  }
  setWorkerHouses(workerId: string, houseIds: string[]) {
    return this.net(() => { this.head(); this.worker(workerId).houseIds = houseIds; this.save(); });
  }
  renameWorker(workerId: string, displayName: string) {
    return this.net(() => { this.head(); this.worker(workerId).displayName = displayName.trim(); this.save(); });
  }
  resetWorkerPin(workerId: string, pin: string) {
    return this.net(() => {
      this.head();
      if (!/^\d{6}$/.test(pin)) throw new ApiError('VALIDATION', 'PIN — 6 цифр');
      this.worker(workerId).pin = pin; this.logStaff(workerId, 'pin_reset'); this.save();
    });
  }
  setWorkerActive(workerId: string, active: boolean) {
    return this.net(() => { this.head(); this.worker(workerId).active = active; this.logStaff(workerId, active ? 'reactivated' : 'deactivated'); this.save(); });
  }
  setWorkerPhone(workerId: string, phone: string) {
    return this.net(() => {
      this.head();
      const p = normalizePhone(phone);
      if (!/^\+996\d{9}$/.test(p)) throw new ApiError('VALIDATION', 'Телефон: +996 и 9 цифр');
      this.phoneFree(p, workerId);
      this.worker(workerId).phone = p; this.logStaff(workerId, 'phone_changed'); this.save();
    });
  }
  staffEvents() {
    return this.net((): StaffEvent[] => {
      this.head();
      const name = (id: string) => this.s.users.find((u) => u.id === id)?.displayName ?? '';
      return [...(this.s.staffEvents ?? [])].reverse().map((e) => ({ at: e.at, kind: e.kind, userName: name(e.userId), actorName: name(e.actorId) }));
    });
  }
  changePin(newPin: string) {
    return this.net(() => { const u = this.me(); u.pin = newPin; this.save(); });
  }

  // ------------------------------------------------------------ operations (mirror supabase/migrations/*operations*)
  private hbInfo(hb: DemoHB, h = this.s.houses.find((x) => x.id === hb.houseId)!): HouseBatchInfo {
    const { id, createdBy: _c, ...rest } = hb;
    return { ...rest, houseBatchId: id, houseName: h.name, hasWaterMeter: h.hasWaterMeter, batchName: this.s.batches.find((b) => b.id === hb.batchId)?.name ?? '' };
  }
  private canHb(u: DemoUser, hbId: string) { return this.visibleHbs(u).some((h) => h.id === hbId); }
  private checkWindow(u: DemoUser, existing: { createdAt?: string } | undefined, reason?: string | null) {
    if (!existing?.createdAt || withinWorkerEditWindow(new Date(existing.createdAt), new Date())) return;
    if (u.role !== 'head') throw new ApiError('EDIT_WINDOW');
    if (!reason?.trim()) throw new ApiError('REASON_REQUIRED');
  }
  myHouses() {
    return this.net((): MyHouse[] => {
      const u = this.me();
      return this.s.houses.filter((h) => h.active !== false && (u.role === 'head' || u.houseIds.includes(h.id))).map((h) => ({ houseId: h.id, houseName: h.name, hasWaterMeter: h.hasWaterMeter }));
    });
  }
  ops(ids: string[]) {
    return this.net((): OpsBundle => {
      const ok = (r: { houseBatchId: string }) => ids.includes(r.houseBatchId) && this.canHb(this.me(), r.houseBatchId);
      const c = <T,>(xs: T[]) => xs.map((x) => ({ ...x }));
      return { feed: c(this.s.feed.filter(ok)), health: c(this.s.health.filter(ok)), weighings: c(this.s.weighings.filter(ok)), handovers: c(this.s.handovers.filter(ok)) };
    });
  }
  push(kind: 'feed' | 'health' | 'weighing' | 'handover' | 'placement' | 'phase' | 'catch', p: any) {
    return this.net(() => {
      const u = this.me();
      if (kind !== 'placement' && p?.houseBatchId && this.batchOfHb(p.houseBatchId)?.status === 'closed') throw new ApiError('BATCH_CLOSED');
      const now = new Date().toISOString();
      const upsert = <T extends { id: string; houseBatchId: string; createdAt?: string; createdBy?: string | null; editReason?: string | null }>(list: T[], rec: T, fix: (r: T) => T = (r) => r) => {
        if (!this.canHb(u, rec.houseBatchId)) throw new ApiError('FORBIDDEN');
        const ex = list.find((x) => x.id === rec.id);
        this.checkWindow(u, ex, rec.editReason);
        const stored = fix({ ...rec, createdAt: ex?.createdAt ?? now, createdBy: ex?.createdBy ?? u.id });
        const i = list.findIndex((x) => x.id === rec.id);
        if (i >= 0) list[i] = stored; else list.push(stored);
        this.save();
        return { ...stored };
      };
      switch (kind) {
        case 'feed': return upsert(this.s.feed, p as FeedDelivery);
        case 'handover': return upsert(this.s.handovers, p as Handover);
        case 'health': return upsert(this.s.health, p as HealthEvent, (r) => ({ ...r, earliestSlaughter: r.kind === 'treatment' ? earliestSlaughter(r.eventOn, r.courseDays ?? 1, r.withdrawalDays ?? 0) : null }));
        case 'weighing': return upsert(this.s.weighings, p as Weighing, (r) => {
          if (r.method === 'group') return { ...r, n: r.groupBirds, meanG: r.groupTotalG! / r.groupBirds!, sdG: null, cv: null };
          const st = weighingStats(r.samplesG); return { ...r, n: st.n, meanG: st.mean, sdG: st.sd, cv: st.cv };
        });
        case 'placement': {
          if (!(u.role === 'head' || u.houseIds.includes(p.houseId))) throw new ApiError('FORBIDDEN');
          const ex = this.s.hbs.find((h) => h.id === p.id);
          if (ex && ex.houseId !== p.houseId) throw new ApiError('FORBIDDEN');
          if (ex && u.role !== 'head' && ex.createdAt && !withinWorkerEditWindow(new Date(ex.createdAt), new Date())) throw new ApiError('EDIT_WINDOW');
          const fields = { placedOn: p.placedOn, hatchery: p.hatchery, waybillCount: p.waybillCount, transportDead: p.transportDead ?? 0, placed: p.placed,
            parentAgeWeeks: p.parentAgeWeeks, day0WeightG: p.day0WeightG, cloacalT: p.cloacalT, cropFill: p.cropFill ?? {} };
          let hb: DemoHB;
          if (ex) { Object.assign(ex, fields); hb = ex; }
          else {
            // A new batch: only in an empty block, numbered <code>-<year>-<seq> unless the director typed a number.
            if (this.s.batches.some((b) => b.houseId === p.houseId && b.status !== 'closed')) throw new ApiError('BLOCK_BUSY');
            const house = this.s.houses.find((h) => h.id === p.houseId)!;
            const name = (u.role === 'head' && p.batchNumber?.trim()) || this.nextNumber(house, p.placedOn);
            if (this.s.batches.some((b) => b.name === name)) throw new ApiError('BATCH_NUMBER_TAKEN');
            const yr = p.placedOn.slice(0, 4);
            const seq = Math.max(0, ...this.s.batches.filter((b) => b.houseId === house.id && this.s.hbs.find((h) => h.batchId === b.id)?.placedOn.startsWith(yr)).map((b) => b.seq)) + 1;
            const batch: DemoBatch = { id: `batch-${Date.now()}`, houseId: house.id, name, seq, status: 'open', openedAt: now, closedAt: null };
            this.s.batches.push(batch);
            hb = { id: p.id, houseId: p.houseId, batchId: batch.id, feedPhase: 'starter', feedPhaseSince: p.placedOn, catchAt: null, feedOffAt: null, catchOverrideReason: null, createdAt: now, createdBy: u.id, ...fields }; this.s.hbs.push(hb);
          }
          this.save(); return this.hbInfo(hb);
        }
        case 'phase': {
          if (!this.canHb(u, p.houseBatchId)) throw new ApiError('FORBIDDEN');
          const hb = this.s.hbs.find((h) => h.id === p.houseBatchId)!; hb.feedPhase = p.phase; hb.feedPhaseSince = p.since; this.save(); return this.hbInfo(hb);
        }
        case 'catch': {
          if (!this.canHb(u, p.houseBatchId)) throw new ApiError('FORBIDDEN');
          const hb = this.s.hbs.find((h) => h.id === p.houseBatchId)!;
          const until = this.s.health.filter((e) => e.houseBatchId === hb.id && e.kind === 'treatment').map((e) => e.earliestSlaughter!).sort().pop();
          const lp = localParts(new Date(p.catchAt), this.s.farm.tz);
          const catchDay = `${lp.y}-${String(lp.m).padStart(2, '0')}-${String(lp.d).padStart(2, '0')}`; // calendar day at the farm, as in SQL
          const inside = !!until && catchDay < until;
          if (inside && !p.reason?.trim()) throw new ApiError('WITHDRAWAL');
          if (inside) this.s.overrides.push({ at: now, houseBatchId: hb.id, by: u.id, reason: p.reason, catchAt: p.catchAt, earliest: until! });
          hb.catchAt = p.catchAt; hb.feedOffAt = p.feedOffAt; hb.catchOverrideReason = inside ? p.reason : null; this.save(); return this.hbInfo(hb);
        }
      }
    });
  }
  events(sinceIso: string) {
    return this.net((): FarmEvent[] => {
      const u = this.me();
      const vis = new Set(this.visibleHbs(u).map((h) => h.id));
      const name = (hbId: string) => this.s.houses.find((h) => h.id === this.s.hbs.find((x) => x.id === hbId)?.houseId)?.name ?? '';
      const who = (id?: string | null) => this.s.users.find((x) => x.id === id)?.displayName ?? null;
      const ev: FarmEvent[] = [];
      const push = (at: string | undefined, hb: string, kind: string, refId: string, by: string | null | undefined, data: Record<string, any>) => {
        if (at && at >= sinceIso && vis.has(hb)) ev.push({ at, houseBatchId: hb, houseName: name(hb), who: who(by), kind, refId, data });
      };
      this.s.logs.forEach((l) => push(l.updatedAt, l.houseBatchId, 'log', l.id, l.createdBy, { day: l.productionDay, deaths: l.deaths, culls: l.culls, feed_kg: l.feedKg, water_l: l.waterL }));
      this.s.feed.forEach((f) => push(f.createdAt, f.houseBatchId, 'feed', f.id, f.createdBy, { feed_type: f.feedType, tonnes: f.tonnes, on: f.deliveredOn }));
      this.s.health.forEach((e) => push(e.createdAt, e.houseBatchId, 'health_' + e.kind, e.id, e.createdBy, { product: e.product, course_days: e.courseDays, withdrawal_days: e.withdrawalDays, earliest_slaughter: e.earliestSlaughter, findings: e.findings, on: e.eventOn }));
      this.s.weighings.forEach((w) => push(w.createdAt, w.houseBatchId, 'weighing', w.id, w.createdBy, { n: w.n, mean_g: w.meanG, cv: w.cv, on: w.weighedOn }));
      this.s.handovers.forEach((h) => push(h.createdAt, h.houseBatchId, 'handover', h.id, h.createdBy, { buyer: h.buyer, birds: h.birds, kg: h.kg, on: h.handedOn }));
      this.s.hbs.forEach((h) => push(h.createdAt, h.id, 'placement', h.id, h.createdBy, { placed: h.placed, transport_dead: h.transportDead, on: h.placedOn }));
      if (u.role === 'head') this.s.overrides.forEach((o) => push(o.at, o.houseBatchId, 'catch_override', o.houseBatchId, o.by, { reason: o.reason, catch_at: o.catchAt, earliest_slaughter: o.earliest }));
      return ev.sort((a, b) => b.at.localeCompare(a.at));
    });
  }
  // ------------------------------------------------------------ finance: director only; workers get nothing (FR-23)
  private isHead() { return this.me().role === 'head'; }
  currentBatch() {
    return this.net((): BatchInfo | null => { const b = this.s.batches.find((x) => x.status !== 'closed'); return b ? { id: b.id, name: b.name, status: b.status, houseId: b.houseId } : null; });
  }
  // ------------------------------------------------------------ blocks and their batches (mirror 20261128000002_blocks.sql)
  private nextNumber(house: House, onDay: string) {
    const yr = onDay.slice(0, 4);
    const seq = Math.max(0, ...this.s.batches.filter((b) => b.houseId === house.id && this.s.hbs.find((h) => h.batchId === b.id)?.placedOn.startsWith(yr)).map((b) => b.seq)) + 1;
    return `${house.code ?? house.name}-${yr}-${String(seq).padStart(2, '0')}`;
  }
  blocks() {
    return this.net((): BlockInfo[] => {
      const u = this.me();
      return this.s.houses.filter((h) => u.role === 'head' || u.houseIds.includes(h.id)).map((h) => {
        const mine = this.s.batches.filter((b) => b.houseId === h.id);
        const open = mine.find((b) => b.status !== 'closed');
        const last = mine.filter((b) => b.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
        const hbOf = (b: DemoBatch) => this.s.hbs.find((x) => x.batchId === b.id)!;
        return {
          houseId: h.id, name: h.name, code: h.code ?? h.name, areaM2: h.areaM2, active: h.active !== false, hasWaterMeter: h.hasWaterMeter,
          open: open ? { batchId: open.id, number: open.name, houseBatchId: hbOf(open).id, placedOn: hbOf(open).placedOn, placed: hbOf(open).placed } : null,
          last: last ? { batchId: last.id, number: last.name, closedAt: last.closedAt, houseBatchId: hbOf(last).id, result: last.result ?? null } : null,
          nextNumber: this.nextNumber(h, this.today()),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    });
  }
  closeBatch(batchId: string, result?: BatchResultJson) {
    return this.net(() => {
      this.head();
      const b = this.s.batches.find((x) => x.id === batchId);
      if (!b || b.status === 'closed') throw new ApiError('BATCH_CLOSED');
      b.status = 'closed'; b.closedAt = new Date().toISOString(); b.result = result ?? null; this.save();
    });
  }
  batches() {
    return this.net((): BatchRow[] => {
      this.head();
      return this.s.batches.map((b) => {
        const hb = this.s.hbs.find((h) => h.batchId === b.id)!;
        const h = this.s.houses.find((x) => x.id === b.houseId)!;
        return { id: b.id, number: b.name, houseId: b.houseId, houseName: h.name, status: b.status, houseBatchId: hb.id, placedOn: hb.placedOn, placed: hb.placed, waybill: hb.waybillCount ?? hb.placed, closedAt: b.closedAt, result: b.result ?? null };
      }).sort((a, b) => b.placedOn.localeCompare(a.placedOn) || a.houseName.localeCompare(b.houseName));
    });
  }
  prices() { return this.net(() => (this.isHead() ? this.s.prices.map((p) => ({ ...p })) : [])); }
  setPrice(p: Price) {
    return this.net(() => { this.head(); this.s.prices = this.s.prices.filter((x) => !(x.kind === p.kind && x.refId === p.refId)).concat(p); this.save(); });
  }
  costs() { return this.net(() => (this.isHead() ? this.s.costs.map((c) => ({ ...c })) : [])); }
  addCost(c: Omit<Cost, 'id'>) { return this.net(() => { this.head(); this.s.costs.push({ ...c, id: `c-${Date.now()}` }); this.save(); }); }
  payments() { return this.net(() => (this.isHead() ? this.s.payments.map((p) => ({ ...p })) : [])); }
  addPayment(p: Omit<Payment, 'id'>) { return this.net(() => { this.head(); this.s.payments.push({ ...p, id: `pay-${Date.now()}` }); this.save(); }); }
  // ------------------------------------------------------------ knowledge
  norms() {
    return this.net((): NormRow[] => {
      this.me();
      const aa: NormRow[] = Object.entries(AA_NORMS).filter(([k]) => k !== '_source').map(([code, data]) => ({ code, data, farm: false }));
      return aa.concat(Object.entries(this.s.normOverrides ?? {}).map(([code, data]) => ({ code, data, farm: true })));
    });
  }
  async articles(): Promise<Article[]> {
    this.me();
    // Loaded on demand so the Supabase build does not carry the handbook in its main bundle.
    const raw = (await import('./knowledge.generated.json')).default as { id: string; section: string; title: string; body_md: string; source: string | null; sort: number }[];
    return this.net(() => raw.map((a) => ({ id: a.id, section: a.section, title: a.title, bodyMd: a.body_md, source: a.source, sort: a.sort })));
  }
  setNorm(code: string, data: unknown) {
    return this.net(() => { this.head(); this.s.normOverrides = { ...this.s.normOverrides, [code]: data }; this.save(); });
  }
  resetNorm(code: string) {
    return this.net(() => { this.head(); const o = { ...this.s.normOverrides }; delete o[code]; this.s.normOverrides = o; this.save(); });
  }
  /** Demo has no AI: it answers with the best-matching handbook articles. */
  async ask(question: string, _context: AskContext | null): Promise<AskAnswer> {
    const hits = searchArticles(await this.articles(), question).slice(0, 3);
    return this.net(() => ({
      answer: hits.length
        ? `Демо-режим: ИИ-помощник работает только с сервером. Вот что есть в справочнике:\n\n${hits.map((a, i) => `[${i + 1}] ${a.title}`).join('\n')}`
        : 'Демо-режим: в справочнике ничего не нашлось. Попробуйте другие слова.',
      sources: hits.map((a) => ({ id: a.id, title: a.title })),
    }));
  }
}
