import type { CullReason } from '@farm/core';

export type Role = 'head' | 'worker';

export interface Farm { id: string; name: string; tz: string; dayStartHour: number }
export interface Session { userId: string; role: Role; displayName: string; phone: string; farm: Farm }

/** A house within the current open batch, as the app needs it. */
export interface HouseBatchInfo {
  houseBatchId: string;
  houseId: string;
  houseName: string;
  placedOn: string;   // YYYY-MM-DD
  placed: number;
  hasWaterMeter: boolean;
  batchName: string;
  batchId?: string;
  feedPhase?: 'starter' | 'grower' | 'finisher';
  feedPhaseSince?: string | null;
  catchAt?: string | null;
  feedOffAt?: string | null;
  catchOverrideReason?: string | null;
  hatchery?: string | null;
  waybillCount?: number | null;
  transportDead?: number;
  parentAgeWeeks?: number | null;
  day0WeightG?: number | null;
  cloacalT?: number | null;
  cropFill?: Record<string, number>;
  createdAt?: string;
}

/** A house the user may work in (also when it has no current batch: needed for placement). */
export interface MyHouse { houseId: string; houseName: string; hasWaterMeter: boolean }

export interface FeedDelivery { id: string; houseBatchId: string; deliveredOn: string; feedType: 'starter' | 'grower' | 'finisher'; tonnes: number; note?: string | null; editReason?: string | null; createdAt?: string; createdBy?: string | null }
export interface HealthEvent {
  id: string; houseBatchId: string; kind: 'vaccination' | 'treatment' | 'post_mortem'; eventOn: string;
  product?: string | null; dose?: string | null; lot?: string | null; method?: string | null;
  courseDays?: number | null; withdrawalDays?: number | null; birdsExamined?: number | null; findings?: string | null;
  earliestSlaughter?: string | null; note?: string | null; editReason?: string | null; createdAt?: string; createdBy?: string | null;
}
export interface Weighing { id: string; houseBatchId: string; weighedOn: string; method: 'individual' | 'group'; samplesG: number[]; groupTotalG?: number | null; groupBirds?: number | null; n?: number | null; meanG?: number | null; sdG?: number | null; cv?: number | null; editReason?: string | null; createdAt?: string; createdBy?: string | null }
export interface Handover { id: string; houseBatchId: string; handedOn: string; buyer: string; birds: number; kg: number; transportDead: number; note?: string | null; editReason?: string | null; createdAt?: string; createdBy?: string | null }
export interface Placement {
  id: string; houseId: string; placedOn: string; hatchery?: string | null; waybillCount?: number | null; transportDead: number; placed: number;
  parentAgeWeeks?: number | null; day0WeightG?: number | null; cloacalT?: number | null; cropFill: Record<string, number>; editReason?: string | null;
  /** Only for a new batch, director only: own number instead of the automatic one. */
  batchNumber?: string | null;
}
export interface PhaseChange { houseBatchId: string; phase: 'starter' | 'grower' | 'finisher'; since: string }
export interface CatchPlan { houseBatchId: string; catchAt: string; feedOffAt: string | null; reason: string | null }

/** Operation kinds that go through the offline outbox. */
export type OpKind = 'log' | 'feed' | 'health' | 'weighing' | 'handover' | 'placement' | 'phase' | 'catch';
export interface OpsBundle { feed: FeedDelivery[]; health: HealthEvent[]; weighings: Weighing[]; handovers: Handover[] }

export interface FarmEvent { at: string; houseBatchId: string; houseName: string; who: string | null; kind: string; refId: string; data: Record<string, any> }

/** Finance (director only; the server returns nothing to workers). */
export interface Price { kind: 'chick' | 'feed' | 'medicine' | 'sale'; refId: string; unitPrice: number }
/** `batchId` null = a shared farm cost (light, gas, wages…), split between batches by chicks placed. */
export interface Cost { id: string; batchId: string | null; category: 'energy' | 'wages' | 'litter' | 'vet' | 'transport' | 'other'; amount: number; spentOn: string; comment: string | null }
export interface Payment { id: string; handoverId: string; amount: number; paidOn: string; comment: string | null }
/** Knowledge: norm rows (defaults + farm overrides) and handbook articles. */
export interface NormRow { code: string; data: unknown; farm: boolean }
export interface Article { id: string; section: string; title: string; bodyMd: string; source: string | null; sort: number; farm?: boolean }

export interface BatchInfo { id: string; name: string; status: 'open' | 'catching' | 'closed'; houseId?: string }
/** A block (кашар) with its current batch, if any, and the last closed one. */
export interface BlockInfo {
  houseId: string; name: string; code: string; areaM2: number; active: boolean; hasWaterMeter: boolean;
  open: { batchId: string; number: string; houseBatchId: string; placedOn: string; placed: number } | null;
  last: { batchId: string; number: string; closedAt: string | null; houseBatchId: string } | null;
  /** Number the next batch will get, e.g. "B-2026-08". */
  nextNumber: string;
}

/** One daily log, in the app's shape. */
export interface LogRecord {
  id: string;
  houseBatchId: string;
  productionDay: string;
  deaths: number;
  culls: number;
  cullReason: CullReason | null;
  feedKg: number | null;
  waterMeter: number | null;
  newMeter: boolean;
  waterL: number | null;
  tMin: number | null;
  tMax: number | null;
  rh: number | null;
  note: string | null;
  editReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string | null;
}

export interface HouseToday {
  houseBatchId: string;
  houseName: string;
  workers: string | null;
  dayOfAge: number;
  placed: number;
  liveBirds: number;
  areaM2: number;
  today: { deaths: number; culls: number; feedKg: number | null; waterL: number | null; tMin: number | null; tMax: number | null; rh: number | null; loggedAt: string } | null;
  yesterdayDeaths: number | null;
}

export interface House { id: string; name: string; code?: string; areaM2: number; hasWaterMeter: boolean; drinkerType: string | null; feederType: string | null; active?: boolean }
/** What the director did with accounts (no PINs). */
export interface StaffEvent { at: string; kind: 'created' | 'pin_reset' | 'deactivated' | 'reactivated' | 'phone_changed'; userName: string; actorName: string }
export type FarmSettings = Pick<Session['farm'], 'name' | 'tz' | 'dayStartHour'>;
export interface Worker { id: string; displayName: string; phone: string; houseIds: string[]; active: boolean }

/** Error codes the server can return (see supabase/migrations). */
export type ApiErrorCode =
  | 'NETWORK' | 'AUTH' | 'FORBIDDEN' | 'EDIT_WINDOW' | 'REASON_REQUIRED' | 'BATCH_CLOSED' | 'BLOCK_BUSY' | 'BATCH_NUMBER_TAKEN'
  | 'DAY_IN_FUTURE' | 'DAY_TOO_OLD' | 'METER_BACKWARDS' | 'WITHDRAWAL' | 'VALIDATION' | 'UNKNOWN';

export const ERROR_TEXT: Record<ApiErrorCode, string> = {
  NETWORK: 'Нет связи с сервером',
  AUTH: 'Неверный номер или PIN',
  FORBIDDEN: 'Нет доступа к этому блоку',
  EDIT_WINDOW: 'Прошло больше 48 часов — исправить может только директор',
  REASON_REQUIRED: 'Укажите причину исправления',
  BATCH_CLOSED: 'Партия закрыта — сообщите директору',
  BLOCK_BUSY: 'В этом блоке уже идёт партия — сначала директор закрывает её',
  BATCH_NUMBER_TAKEN: 'Такой номер партии уже есть',
  DAY_IN_FUTURE: 'Дата ещё не наступила',
  DAY_TOO_OLD: 'Старые дни заполняет директор',
  METER_BACKWARDS: 'Показание меньше прошлого — отметьте «новый счётчик»',
  WITHDRAWAL: 'Отлов раньше конца срока ожидания — укажите причину',
  VALIDATION: 'Проверьте значения',
  UNKNOWN: 'Ошибка сервера',
};

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message?: string) { super(message ?? ERROR_TEXT[code]); }
  /** Network and unknown server errors are retried later; business-rule errors are not. */
  get retryable(): boolean { return this.code === 'NETWORK' || this.code === 'UNKNOWN'; }
}

export interface Api {
  readonly mode: 'demo' | 'supabase';
  signIn(phone: string, pin: string): Promise<Session>;
  restore(): Promise<Session | null>;
  signOut(): Promise<void>;
  myHouseBatches(): Promise<HouseBatchInfo[]>;
  recentLogs(houseBatchIds: string[], sinceDay: string): Promise<LogRecord[]>;
  upsertLog(rec: LogRecord): Promise<LogRecord>;
  houseToday(): Promise<HouseToday[]>;
  // Farm and people (director; online only)
  updateFarm(f: FarmSettings): Promise<Session['farm']>;
  /** All houses of the farm, including deactivated ones (`active: false`). */
  listHouses(): Promise<House[]>;
  createHouse(h: Omit<House, 'id'>): Promise<House>;
  updateHouse(id: string, patch: Partial<Omit<House, 'id'>>): Promise<void>;
  /** Deletes a house with no batch history; throws VALIDATION otherwise (deactivate it instead). */
  deleteHouse(id: string): Promise<void>;
  listWorkers(): Promise<Worker[]>;
  inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }): Promise<{ id: string }>;
  setWorkerHouses(workerId: string, houseIds: string[]): Promise<void>;
  renameWorker(workerId: string, displayName: string): Promise<void>;
  resetWorkerPin(workerId: string, pin: string): Promise<void>;
  setWorkerActive(workerId: string, active: boolean): Promise<void>;
  setWorkerPhone(workerId: string, phone: string): Promise<void>;
  staffEvents(): Promise<StaffEvent[]>;
  /** Blocks with their batches: the director sees all, a worker own blocks. */
  blocks(): Promise<BlockInfo[]>;
  /** Director: the batch is over (after the catch); the block becomes empty. */
  closeBatch(batchId: string): Promise<void>;
  changePin(newPin: string): Promise<void>;
  // Operations (worker on own houses, director on all)
  myHouses(): Promise<MyHouse[]>;
  ops(houseBatchIds: string[]): Promise<OpsBundle>;
  /** Saves one queued operation; idempotent by id. Returns the stored record (placement/phase/catch: the house batch). */
  push(kind: Exclude<OpKind, 'log'>, payload: any): Promise<any>;
  events(sinceIso: string): Promise<FarmEvent[]>;
  // Finance (director only)
  currentBatch(): Promise<BatchInfo | null>;
  prices(): Promise<Price[]>;
  setPrice(p: Price): Promise<void>;
  costs(batchId: string): Promise<Cost[]>;
  addCost(c: Omit<Cost, 'id'>): Promise<void>;
  payments(): Promise<Payment[]>;
  addPayment(p: Omit<Payment, 'id'>): Promise<void>;
  // Knowledge (everyone reads; the director edits the farm's norms)
  norms(): Promise<NormRow[]>;
  articles(): Promise<Article[]>;
  setNorm(code: string, data: unknown): Promise<void>;
  resetNorm(code: string): Promise<void>;
  /** Ask the knowledge assistant (needs a connection). */
  ask(question: string, context: AskContext | null): Promise<AskAnswer>;
}

export interface AskContext { houseName: string; dayOfAge: number; liveBirds: number; recent: string }
export interface AskAnswer { answer: string; sources: { id: string; title: string }[] }

/** Map a raw server error message to a code. */
export function errorCodeFrom(message: string | undefined): ApiErrorCode {
  const m = message ?? '';
  for (const c of ['EDIT_WINDOW', 'REASON_REQUIRED', 'BATCH_CLOSED', 'BLOCK_BUSY', 'BATCH_NUMBER_TAKEN', 'DAY_IN_FUTURE', 'DAY_TOO_OLD', 'METER_BACKWARDS', 'WITHDRAWAL', 'FORBIDDEN'] as const) {
    if (m.includes(c)) return c;
  }
  if (/row-level security|permission denied/i.test(m)) return 'FORBIDDEN';
  if (/violates check constraint/i.test(m)) return 'VALIDATION';
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return 'NETWORK';
  return 'UNKNOWN';
}
