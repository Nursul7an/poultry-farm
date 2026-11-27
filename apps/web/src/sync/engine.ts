/**
 * Outbox sync (FR-4, T-09).
 * - Every save goes to the local DB and the outbox first, so nothing is lost without signal.
 * - The outbox is pushed in order with an idempotent server upsert (client UUID + house/day key).
 * - Network and server errors leave the item pending for the next attempt; business-rule refusals
 *   (edit window, closed batch…) mark it "не принято" with the reason, and the record stays on the phone.
 */
import { addDays } from '@farm/core';
import type { Api, CatchPlan, HouseBatchInfo, LogRecord, OpKind, PhaseChange, Placement } from '../api/types';
import { ApiError } from '../api/types';
import type { LocalDb, OutboxItem } from '../db/local';

export interface SyncStatus { pending: number; rejected: number; syncing: boolean; lastSyncAt: string | null; lastError: string | null }

export const CACHE_DAYS = 14;

export class SyncEngine {
  private running: Promise<void> | null = null;
  private rerun = false;
  private listeners = new Set<(s: SyncStatus) => void>();
  private status: SyncStatus = { pending: 0, rejected: 0, syncing: false, lastSyncAt: null, lastError: null };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private db: LocalDb, private api: Api, private today: () => string) {}

  subscribe(fn: (s: SyncStatus) => void) { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  getStatus() { return this.status; }
  private async emit(patch: Partial<SyncStatus> = {}) {
    const pending = await this.db.outbox.where('status').equals('pending').count();
    const rejected = await this.db.outbox.where('status').equals('rejected').count();
    this.status = { ...this.status, ...patch, pending, rejected };
    this.listeners.forEach((l) => l(this.status));
  }

  /** Save locally and queue for sending. Returns immediately; sending happens in the background. */
  async saveLog(rec: LogRecord): Promise<void> {
    await this.db.transaction('rw', this.db.logs, this.db.outbox, this.db.drafts, async () => {
      // Another local record for the same house+day (should not normally happen) is replaced.
      const same = await this.db.logFor(rec.houseBatchId, rec.productionDay);
      if (same && same.id !== rec.id) await this.db.logs.delete(same.id);
      await this.db.logs.put(rec);
      // Only the newest version of a record needs sending.
      await this.db.outbox.where('logId').equals(rec.id).delete();
      if (same && same.id !== rec.id) await this.db.outbox.where('logId').equals(same.id).delete();
      await this.db.outbox.add({ kind: 'log', logId: rec.id, payload: rec, status: 'pending', attempts: 0, createdAt: new Date().toISOString() });
      await this.db.drafts.delete(`${rec.houseBatchId}|${rec.productionDay}`);
    });
    await this.emit();
    void this.syncNow();
  }

  private table(kind: OpKind) {
    return ({ feed: this.db.feed, health: this.db.health, weighing: this.db.weighings, handover: this.db.handovers } as Record<string, any>)[kind];
  }

  /** Save any other operation locally (optimistically) and queue it. */
  async saveOp(kind: Exclude<OpKind, 'log'>, payload: any): Promise<void> {
    const key = kind === 'placement' || kind === 'phase' || kind === 'catch' ? `${kind}:${payload.houseBatchId ?? payload.id}` : payload.id;
    await this.db.transaction('rw', [this.db.outbox, this.db.houseBatches, this.db.myHouses, this.db.feed, this.db.health, this.db.weighings, this.db.handovers], async () => {
      const t = this.table(kind);
      if (t) await t.put(payload);
      else await this.applyToHouseBatch(kind, payload);
      await this.db.outbox.where('logId').equals(key).delete();
      await this.db.outbox.add({ kind, logId: key, payload, status: 'pending', attempts: 0, createdAt: new Date().toISOString() });
    });
    await this.emit();
    void this.syncNow();
  }

  /** Optimistic local update of the house batch for placement / phase / catch. */
  private async applyToHouseBatch(kind: OpKind, p: any) {
    if (kind === 'placement') {
      const pl = p as Placement;
      const house = await this.db.myHouses.get(pl.houseId);
      const cur = await this.db.houseBatches.get(pl.id);
      await this.db.houseBatches.put({
        ...(cur ?? { houseBatchId: pl.id, houseId: pl.houseId, houseName: house?.houseName ?? '', hasWaterMeter: house?.hasWaterMeter ?? true, batchName: 'новая партия', feedPhase: 'starter', feedPhaseSince: pl.placedOn }),
        placedOn: pl.placedOn, placed: pl.placed, hatchery: pl.hatchery, waybillCount: pl.waybillCount, transportDead: pl.transportDead,
        parentAgeWeeks: pl.parentAgeWeeks, day0WeightG: pl.day0WeightG, cloacalT: pl.cloacalT, cropFill: pl.cropFill,
      } as HouseBatchInfo);
    } else if (kind === 'phase') {
      const ph = p as PhaseChange;
      await this.db.houseBatches.update(ph.houseBatchId, { feedPhase: ph.phase, feedPhaseSince: ph.since });
    } else if (kind === 'catch') {
      const c = p as CatchPlan;
      await this.db.houseBatches.update(c.houseBatchId, { catchAt: c.catchAt, feedOffAt: c.feedOffAt, catchOverrideReason: c.reason });
    }
  }

  /** Push the outbox. Safe to call any time; concurrent calls share one run. */
  syncNow(): Promise<void> {
    if (this.running) { this.rerun = true; return this.running; }
    this.running = (async () => {
      do { this.rerun = false; await this.run(); } while (this.rerun);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async run() {
    await this.emit({ syncing: true });
    let lastError: string | null = null;
    const items = await this.db.outbox.where('status').equals('pending').sortBy('seq');
    for (const item of items) {
      try {
        if (item.kind !== 'log') {
          const stored = await this.api.push(item.kind, item.payload);
          await this.db.transaction('rw', [this.db.outbox, this.db.houseBatches, this.db.feed, this.db.health, this.db.weighings, this.db.handovers], async () => {
            const still = await this.db.outbox.get(item.seq!);
            if (!still) return;
            const newer = await this.db.outbox.where('logId').equals(item.logId).filter((o) => o.seq! > item.seq!).count();
            if (!newer && stored) {
              const t = this.table(item.kind);
              if (t) await t.put(stored);
              else if (stored.houseBatchId) {
                if (item.kind === 'placement' && stored.houseBatchId !== item.payload.id) await this.db.houseBatches.delete(item.payload.id);
                const cur = await this.db.houseBatches.get(stored.houseBatchId);
                await this.db.houseBatches.put({ ...(cur ?? {}), ...stored });
              }
            }
            await this.db.outbox.delete(item.seq!);
          });
          continue;
        }
        const stored = await this.api.upsertLog(item.payload);
        await this.db.transaction('rw', this.db.logs, this.db.outbox, async () => {
          const still = await this.db.outbox.get(item.seq!);
          if (!still) return; // superseded by a newer save while sending
          if (stored.id !== item.payload.id) await this.db.logs.delete(item.payload.id);
          // If the user saved again while this was in flight, keep their newer local copy.
          const newer = await this.db.outbox.where('logId').equals(item.logId).filter((o) => o.seq! > item.seq!).count();
          if (!newer) await this.db.logs.put(stored);
          await this.db.outbox.delete(item.seq!);
        });
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e));
        if (err.retryable) {
          await this.db.outbox.update(item.seq!, { attempts: item.attempts + 1 });
          lastError = err.message;
          break; // keep order: stop and retry later
        }
        await this.db.outbox.update(item.seq!, { status: 'rejected', errorCode: err.code, error: err.message, attempts: item.attempts + 1 });
      }
    }
    await this.emit({ syncing: false, lastError, lastSyncAt: lastError ? this.status.lastSyncAt : new Date().toISOString() });
  }

  /** Download houses and the current batch's logs. Local unsent edits always win over downloaded copies. */
  async refresh(): Promise<void> {
    const [hbs, mine] = await Promise.all([this.api.myHouseBatches(), this.api.myHouses()]);
    // The whole current batch is small (≤ ~45 days × 4 houses), so cache all of it: live birds need every day.
    const since = hbs.length ? hbs.map((h) => h.placedOn).sort()[0]! : addDays(this.today(), -CACHE_DAYS);
    const logs = await this.api.recentLogs(hbs.map((h) => h.houseBatchId), since);
    const ops = await this.api.ops(hbs.map((h) => h.houseBatchId));
    const outbox = await this.db.outbox.toArray();
    const pendingIds = new Set(outbox.map((o) => o.logId));
    const pendingHb = new Set(outbox.filter((o) => ['placement', 'phase', 'catch'].includes(o.kind)).map((o) => o.payload.houseBatchId ?? o.payload.id));
    await this.db.transaction('rw', [this.db.houseBatches, this.db.logs, this.db.myHouses, this.db.feed, this.db.health, this.db.weighings, this.db.handovers], async () => {
      await this.db.myHouses.clear();
      await this.db.myHouses.bulkPut(mine);
      const keep = (await this.db.houseBatches.toArray()).filter((h) => pendingHb.has(h.houseBatchId));
      await this.db.houseBatches.clear();
      await this.db.houseBatches.bulkPut(hbs.filter((h) => !pendingHb.has(h.houseBatchId)).concat(keep));
      for (const [t, rows] of [[this.db.feed, ops.feed], [this.db.health, ops.health], [this.db.weighings, ops.weighings], [this.db.handovers, ops.handovers]] as const) {
        const local = await (t as any).toArray();
        await (t as any).bulkDelete(local.filter((r: any) => !pendingIds.has(r.id)).map((r: any) => r.id));
        await (t as any).bulkPut((rows as any[]).filter((r) => !pendingIds.has(r.id)));
      }
      const visible = new Set(hbs.map((h) => h.houseBatchId));
      // Drop cached logs of houses no longer assigned (unless unsent).
      const stale = await this.db.logs.filter((l) => !visible.has(l.houseBatchId) && !pendingIds.has(l.id)).primaryKeys();
      await this.db.logs.bulkDelete(stale);
      for (const l of logs) {
        const local = await this.db.logFor(l.houseBatchId, l.productionDay);
        if (local && pendingIds.has(local.id)) continue;
        if (local && local.id !== l.id) await this.db.logs.delete(local.id);
        await this.db.logs.put(l);
      }
    });
    await this.emit();
    void this.refreshKnowledge().catch(() => {});
  }

  /** Norms and the handbook are cached on the phone so checks and «Справочник» work offline. */
  async refreshKnowledge(force = false): Promise<void> {
    // Norms are small and change when the director edits them: every refresh. The handbook (~160 KB): twice a day.
    const KEY = 'farm-articles-at';
    const stale = force || !(await this.db.articles.count()) || Date.now() - Number(localStorage.getItem(KEY) ?? 0) > 12 * 3_600_000;
    const [norms, articles] = await Promise.all([this.api.norms(), stale ? this.api.articles() : Promise.resolve(null)]);
    await this.db.transaction('rw', this.db.norms, this.db.articles, async () => {
      await this.db.norms.clear();
      await this.db.norms.bulkPut(norms.map((n) => ({ ...n, key: `${n.farm ? 'farm' : 'aa'}:${n.code}` })));
      if (articles) { await this.db.articles.clear(); await this.db.articles.bulkPut(articles); }
    });
    if (articles) localStorage.setItem(KEY, String(Date.now()));
  }

  async rejected(): Promise<OutboxItem[]> { return this.db.outbox.where('status').equals('rejected').toArray(); }
  async pendingItems(): Promise<OutboxItem[]> { return this.db.outbox.orderBy('seq').toArray(); }
  async retry(seq: number) { await this.db.outbox.update(seq, { status: 'pending', errorCode: undefined, error: undefined }); await this.emit(); return this.syncNow(); }
  async discard(seq: number) { await this.db.outbox.delete(seq); await this.emit(); }
  async isPending(logId: string) { return (await this.db.outbox.where('logId').equals(logId).count()) > 0; }

  /** Sync on reconnect, when the app comes to the foreground, and every 30 s while online. */
  private kick = () => { if (navigator.onLine) void this.syncNow().then(() => this.refresh()).catch(() => {}); };
  private onVisible = () => { if (document.visibilityState === 'visible') this.kick(); };
  start() {
    window.addEventListener('online', this.kick);
    document.addEventListener('visibilitychange', this.onVisible);
    this.timer = setInterval(() => { if (navigator.onLine && this.status.pending) void this.syncNow(); }, 30_000);
    void this.emit();
    this.kick();
  }
  stop() {
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.timer) clearInterval(this.timer);
  }
}
