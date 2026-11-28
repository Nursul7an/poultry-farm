/** On-device storage (IndexedDB). One database per signed-in user, so two people on one phone never mix data. */
import Dexie, { type Table } from 'dexie';
import type { Article, NormRow, FeedDelivery, FeedIssue, FeedLot, Handover, HealthEvent, HouseBatchInfo, LogRecord, MyHouse, OpKind, Weighing } from '../api/types';

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
  feedLots!: Table<FeedLot, string>;
  feedIssues!: Table<FeedIssue, string>;

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
    this.version(4).stores({ feedLots: 'id, feedType', feedIssues: 'id, houseBatchId, lotId' });
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
/** One local database per person AND farm (v4: a director may run several farms; their data never mixes). */
export function dbForUser(userId: string, farmId: string): LocalDb {
  const name = `farm-${userId}-${farmId}`;
  let db = dbs.get(name);
  if (!db) { db = new LocalDb(name); dbs.set(name, db); void adoptLegacyOutbox(userId, db); }
  return db;
}

/**
 * Before v4 the database was per person only (`farm-<user>`). Records still waiting to be sent there are moved into
 * the farm's database once, so an update never loses unsent work; then the old database is removed.
 */
async function adoptLegacyOutbox(userId: string, db: LocalDb) {
  const legacy = `farm-${userId}`;
  try {
    if (!(await Dexie.exists(legacy))) return;
    const old = new LocalDb(legacy);
    const items = await old.outbox.toArray();
    if (items.length) await db.outbox.bulkAdd(items.map(({ seq: _seq, ...rest }) => rest as typeof items[number]));
    old.close();
    await Dexie.delete(legacy);
  } catch { /* keep the old database; nothing is lost */ }
}
