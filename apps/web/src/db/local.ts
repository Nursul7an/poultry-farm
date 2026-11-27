/** On-device storage (IndexedDB). One database per signed-in user, so two people on one phone never mix data. */
import Dexie, { type Table } from 'dexie';
import type { Article, NormRow, FeedDelivery, Handover, HealthEvent, HouseBatchInfo, LogRecord, MyHouse, OpKind, Weighing } from '../api/types';

export interface OutboxItem {
  seq?: number;
  kind: OpKind;
  /** Record id (log, feed…), or `${kind}:${houseBatchId}` for placement/phase/catch. Newer saves of the same id replace older ones. */
  logId: string;
  payload: any;
  status: 'pending' | 'rejected';
  errorCode?: string;
  error?: string;
  attempts: number;
  createdAt: string;
}

export interface Draft { key: string; houseBatchId: string; productionDay: string; values: Record<string, unknown>; savedAt: string }

export class LocalDb extends Dexie {
  houseBatches!: Table<HouseBatchInfo, string>;
  logs!: Table<LogRecord, string>;
  outbox!: Table<OutboxItem, number>;
  drafts!: Table<Draft, string>;
  meta!: Table<{ key: string; value: unknown }, string>;
  feed!: Table<FeedDelivery, string>;
  health!: Table<HealthEvent, string>;
  weighings!: Table<Weighing, string>;
  handovers!: Table<Handover, string>;
  myHouses!: Table<MyHouse, string>;
  norms!: Table<NormRow & { key: string }, string>;
  articles!: Table<Article, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      houseBatches: 'houseBatchId',
      logs: 'id, [houseBatchId+productionDay], houseBatchId',
      outbox: '++seq, logId, status',
      drafts: 'key',
      meta: 'key',
    });
    this.version(2).stores({
      feed: 'id, houseBatchId',
      health: 'id, houseBatchId',
      weighings: 'id, houseBatchId',
      handovers: 'id, houseBatchId',
      myHouses: 'houseId',
    });
    this.version(3).stores({ norms: 'key, code', articles: 'id, section' });
  }

  logFor(houseBatchId: string, day: string) {
    return this.logs.where('[houseBatchId+productionDay]').equals([houseBatchId, day]).first();
  }
  async logsFor(houseBatchId: string): Promise<LogRecord[]> {
    const all = await this.logs.where('houseBatchId').equals(houseBatchId).toArray();
    return all.sort((a, b) => b.productionDay.localeCompare(a.productionDay));
  }
}

const dbs = new Map<string, LocalDb>();
export function dbForUser(userId: string): LocalDb {
  let db = dbs.get(userId);
  if (!db) { db = new LocalDb(`farm-${userId}`); dbs.set(userId, db); }
  return db;
}
