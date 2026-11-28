import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDb } from '../db/local';
import { SyncEngine } from './engine';
import { ApiError, type Api, type LogRecord } from '../api/types';

const today = '2026-11-24';

class FakeApi implements Partial<Api> {
  online = true;
  server = new Map<string, LogRecord>();
  calls = 0;
  rejectWith: ApiError | null = null;
  async upsertLog(r: LogRecord) {
    this.calls++;
    if (!this.online) throw new ApiError('NETWORK');
    if (this.rejectWith) throw this.rejectWith;
    const existing = [...this.server.values()].find((x) => x.houseBatchId === r.houseBatchId && x.productionDay === r.productionDay);
    const stored = { ...r, id: existing?.id ?? r.id, waterL: 2780 };
    this.server.set(stored.id, stored);
    return stored;
  }
  async myHouseBatches() { return [{ houseBatchId: 'hb-2', houseId: 'h2', houseName: 'П-2', placedOn: '2026-11-01', placed: 16980, hasWaterMeter: true, batchName: '06/2026' }]; }
  async recentLogs() { return [...this.server.values()]; }
  async myHouses() { return [{ houseId: 'h2', houseName: 'П-2', hasWaterMeter: true }]; }
  feedServer = new Map<string, any>();
  async ops() { return { feed: [...this.feedServer.values()], health: [], weighings: [], handovers: [], issues: [] }; }
  async feedLots() { return []; }
  async push(kind: string, p: any) {
    this.calls++;
    if (!this.online) throw new ApiError('NETWORK');
    if (this.rejectWith) throw this.rejectWith;
    if (kind === 'feed') { const stored = { ...p, createdBy: 'u1' }; this.feedServer.set(p.id, stored); return stored; }
    if (kind === 'phase') return { houseBatchId: p.houseBatchId, feedPhase: p.phase, feedPhaseSince: p.since };
    return p;
  }
}

const rec = (o: Partial<LogRecord> = {}): LogRecord => ({
  id: crypto.randomUUID(), houseBatchId: 'hb-2', productionDay: today, deaths: 38, culls: 2, cullReason: 'legs',
  feedKg: 1970, waterMeter: 1039.2, newMeter: false, waterL: null, tMin: 21.6, tMax: 23, rh: 62, note: null, ...o,
});

let db: LocalDb, api: FakeApi, sync: SyncEngine;
beforeEach(async () => {
  db = new LocalDb(`t-${crypto.randomUUID()}`);
  api = new FakeApi();
  sync = new SyncEngine(db, api as unknown as Api, () => today);
});

describe('SyncEngine', () => {
  it('offline save stays on the device, then arrives exactly once', async () => {
    api.online = false;
    const r = rec();
    await sync.saveLog(r);
    await sync.syncNow();
    expect(await db.logs.get(r.id)).toBeTruthy();
    expect(sync.getStatus().pending).toBe(1);
    expect(api.server.size).toBe(0);

    api.online = true;
    await sync.syncNow();
    await sync.syncNow();
    expect(api.server.size).toBe(1);
    expect(sync.getStatus().pending).toBe(0);
    expect((await db.logs.get(r.id))!.waterL).toBe(2780); // server-computed value replaces the local copy
  });

  it('saving the same day twice offline sends only the newest version', async () => {
    api.online = false;
    const r = rec({ deaths: 30 });
    await sync.saveLog(r);
    await sync.saveLog({ ...r, deaths: 38 });
    expect(await db.outbox.count()).toBe(1);
    api.online = true;
    await sync.syncNow();
    expect(api.server.size).toBe(1);
    expect([...api.server.values()][0]!.deaths).toBe(38);
  });

  it('server already has this house+day under another id → local id is replaced', async () => {
    api.server.set('server-id', { ...rec(), id: 'server-id' });
    const r = rec();
    await sync.saveLog(r);
    await sync.syncNow();
    expect(await db.logs.get(r.id)).toBeUndefined();
    expect(await db.logs.get('server-id')).toBeTruthy();
  });

  it('business-rule refusal → "не принято" with reason; record kept; nothing retried', async () => {
    api.rejectWith = new ApiError('EDIT_WINDOW');
    const r = rec();
    await sync.saveLog(r);
    await sync.syncNow();
    const rej = await sync.rejected();
    expect(rej).toHaveLength(1);
    expect(rej[0]!.error).toContain('48 часов');
    expect(await db.logs.get(r.id)).toBeTruthy();
    expect(sync.getStatus()).toMatchObject({ pending: 0, rejected: 1 });
  });

  it('refresh downloads logs but never overwrites unsent local edits', async () => {
    api.server.set('s1', { ...rec(), id: 's1', productionDay: '2026-11-23', deaths: 12 });
    api.online = false;
    const mine = rec({ productionDay: '2026-11-23', deaths: 99 });
    await sync.saveLog(mine);
    api.online = true;
    // refresh before the push: local pending copy must survive
    const saved = api.upsertLog.bind(api);
    api.upsertLog = async () => { throw new ApiError('NETWORK'); };
    await sync.refresh();
    expect((await db.logFor('hb-2', '2026-11-23'))!.deaths).toBe(99);
    api.upsertLog = saved;
    expect(await db.houseBatches.count()).toBe(1);
  });

  it('feed delivery saved offline is queued, then sent once and replaced by the server copy', async () => {
    api.online = false;
    const fd = { id: crypto.randomUUID(), houseBatchId: 'hb-2', deliveredOn: today, feedType: 'grower' as const, tonnes: 8 };
    await sync.saveOp('feed', fd);
    await sync.syncNow();
    expect(await db.feed.get(fd.id)).toBeTruthy();
    expect(api.feedServer.size).toBe(0);
    api.online = true;
    await sync.syncNow();
    expect(api.feedServer.size).toBe(1);
    expect((await db.feed.get(fd.id))!.createdBy).toBe('u1');
    await sync.refresh();
    expect(await db.feed.count()).toBe(1);
  });

  it('feed phase change updates the house locally at once and survives refresh until sent', async () => {
    await db.houseBatches.put({ houseBatchId: 'hb-2', houseId: 'h2', houseName: 'П-2', placedOn: '2026-11-01', placed: 16980, hasWaterMeter: true, batchName: '06/2026', feedPhase: 'grower' });
    api.online = false;
    await sync.saveOp('phase', { houseBatchId: 'hb-2', phase: 'finisher', since: today });
    expect((await db.houseBatches.get('hb-2'))!.feedPhase).toBe('finisher');
    api.online = true;
    const push = api.push.bind(api);
    api.push = async () => { throw new ApiError('NETWORK'); };
    await sync.refresh(); // server still says grower; local pending change must win
    expect((await db.houseBatches.get('hb-2'))!.feedPhase).toBe('finisher');
    api.push = push;
  });

  it('placement for a house without a batch creates the house locally at once (offline)', async () => {
    await db.myHouses.put({ houseId: 'h9', houseName: 'П-9', hasWaterMeter: false });
    api.online = false;
    await sync.saveOp('placement', { id: 'hb-9', houseId: 'h9', placedOn: today, transportDead: 0, placed: 1000, cropFill: {} });
    const hb = await db.houseBatches.get('hb-9');
    expect([hb!.houseName, hb!.placed, hb!.feedPhase]).toEqual(['П-9', 1000, 'starter']);
  });
});
