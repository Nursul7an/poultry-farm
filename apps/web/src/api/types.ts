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

export interface House { id: string; name: string; areaM2: number; hasWaterMeter: boolean; drinkerType: string | null; feederType: string | null }
export interface Worker { id: string; displayName: string; phone: string; houseIds: string[]; active: boolean }

/** Error codes the server can return (see supabase/migrations). */
export type ApiErrorCode =
  | 'NETWORK' | 'AUTH' | 'FORBIDDEN' | 'EDIT_WINDOW' | 'REASON_REQUIRED' | 'BATCH_CLOSED'
  | 'DAY_IN_FUTURE' | 'DAY_TOO_OLD' | 'METER_BACKWARDS' | 'VALIDATION' | 'UNKNOWN';

export const ERROR_TEXT: Record<ApiErrorCode, string> = {
  NETWORK: 'Нет связи с сервером',
  AUTH: 'Неверный номер или PIN',
  FORBIDDEN: 'Нет доступа к этому птичнику',
  EDIT_WINDOW: 'Прошло больше 48 часов — исправить может только руководитель',
  REASON_REQUIRED: 'Укажите причину исправления',
  BATCH_CLOSED: 'Партия закрыта — сообщите руководителю',
  DAY_IN_FUTURE: 'Дата ещё не наступила',
  DAY_TOO_OLD: 'Старые дни заполняет руководитель',
  METER_BACKWARDS: 'Показание меньше прошлого — отметьте «новый счётчик»',
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
  listHouses(): Promise<House[]>;
  createHouse(h: Omit<House, 'id'>): Promise<House>;
  listWorkers(): Promise<Worker[]>;
  inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }): Promise<void>;
  setWorkerHouses(workerId: string, houseIds: string[]): Promise<void>;
}

/** Map a raw server error message to a code. */
export function errorCodeFrom(message: string | undefined): ApiErrorCode {
  const m = message ?? '';
  for (const c of ['EDIT_WINDOW', 'REASON_REQUIRED', 'BATCH_CLOSED', 'DAY_IN_FUTURE', 'DAY_TOO_OLD', 'METER_BACKWARDS', 'FORBIDDEN'] as const) {
    if (m.includes(c)) return c;
  }
  if (/row-level security|permission denied/i.test(m)) return 'FORBIDDEN';
  if (/violates check constraint/i.test(m)) return 'VALIDATION';
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return 'NETWORK';
  return 'UNKNOWN';
}
