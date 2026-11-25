/**
 * Outbox sync (FR-4, T-09).
 * - Every save goes to the local DB and the outbox first, so nothing is lost without signal.
 * - The outbox is pushed in order with an idempotent server upsert (client UUID + house/day key).
 * - Network and server errors leave the item pending for the next attempt; business-rule refusals
 *   (edit window, closed batch…) mark it "не принято" with the reason, and the record stays on the phone.
 */
import { addDays } from '@farm/core';
import type { Api, LogRecord } from '../api/types';
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
    const hbs = await this.api.myHouseBatches();
    // The whole current batch is small (≤ ~45 days × 4 houses), so cache all of it: live birds need every day.
    const since = hbs.length ? hbs.map((h) => h.placedOn).sort()[0]! : addDays(this.today(), -CACHE_DAYS);
    const logs = await this.api.recentLogs(hbs.map((h) => h.houseBatchId), since);
    const pendingIds = new Set((await this.db.outbox.toArray()).map((o) => o.logId));
    await this.db.transaction('rw', this.db.houseBatches, this.db.logs, async () => {
      await this.db.houseBatches.clear();
      await this.db.houseBatches.bulkPut(hbs);
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
