/** Real backend: Supabase (Postgres + RLS). Server rules: supabase/migrations. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, House, HouseBatchInfo, HouseToday, LogRecord, Session, Worker } from './types';
import { ApiError, errorCodeFrom } from './types';
import { normalizePhone, phoneToEmail } from './phone';

const SESSION_CACHE = 'farm-session-cache';

type Row = Record<string, any>;

function toLog(r: Row): LogRecord {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: r.id, houseBatchId: r.house_batch_id, productionDay: r.production_day,
    deaths: r.deaths, culls: r.culls, cullReason: r.cull_reason, feedKg: n(r.feed_kg),
    waterMeter: n(r.water_meter), newMeter: r.new_meter, waterL: r.water_l,
    tMin: n(r.t_min), tMax: n(r.t_max), rh: n(r.rh), note: r.note, editReason: r.edit_reason,
    createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by,
  };
}

function fail(e: { message?: string } | null | undefined): never {
  throw new ApiError(errorCodeFrom(e?.message), undefined);
}

export class SupabaseApi implements Api {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;
  constructor(url: string, anonKey: string) {
    // persistSession keeps the refresh token in localStorage, so a worker stays signed in offline (FR-2 AC-2.2).
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  // Untyped rows: no generated DB types yet (TODO: `supabase gen types` once the project exists).
  private async call(fn: () => PromiseLike<{ data: any; error: any }>): Promise<any> {
    let res;
    try { res = await fn(); } catch (e: any) { throw new ApiError('NETWORK', e?.message); }
    if (res.error) fail(res.error);
    return res.data;
  }

  private async loadSession(userId: string): Promise<Session> {
    const u = await this.call(() => this.sb.from('app_user').select('id, role, display_name, phone, farm:farm_id (id, name, tz, day_start_hour)').eq('id', userId).single());
    const f = (u as Row).farm;
    const s: Session = { userId, role: (u as Row).role, displayName: (u as Row).display_name, phone: (u as Row).phone, farm: { id: f.id, name: f.name, tz: f.tz, dayStartHour: f.day_start_hour } };
    localStorage.setItem(SESSION_CACHE, JSON.stringify(s));
    return s;
  }

  async signIn(phone: string, pin: string) {
    let res;
    try { res = await this.sb.auth.signInWithPassword({ email: phoneToEmail(phone), password: pin }); }
    catch (e: any) { throw new ApiError('NETWORK', e?.message); }
    if (res.error || !res.data.user) throw new ApiError(res.error && /fetch/i.test(res.error.message) ? 'NETWORK' : 'AUTH');
    return this.loadSession(res.data.user.id);
  }

  /** Works offline: uses the locally stored auth session plus the cached profile. */
  async restore() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) return null;
    const cached = localStorage.getItem(SESSION_CACHE);
    if (cached) {
      const s = JSON.parse(cached) as Session;
      if (s.userId === data.session.user.id) return s;
    }
    try { return await this.loadSession(data.session.user.id); } catch { return null; }
  }

  async signOut() { localStorage.removeItem(SESSION_CACHE); await this.sb.auth.signOut(); }

  async myHouseBatches(): Promise<HouseBatchInfo[]> {
    const rows = await this.call(() => this.sb.from('house_batch')
      .select('id, placed_on, placed, house:house_id (id, name, has_water_meter), batch:batch_id!inner (name, status)')
      .neq('batch.status', 'closed'));
    return (rows as Row[]).filter((r) => r.batch).map((r) => ({
      houseBatchId: r.id, houseId: r.house.id, houseName: r.house.name, placedOn: r.placed_on, placed: r.placed,
      hasWaterMeter: r.house.has_water_meter, batchName: r.batch.name,
    })).sort((a, b) => a.houseName.localeCompare(b.houseName));
  }

  async recentLogs(ids: string[], sinceDay: string) {
    if (!ids.length) return [];
    const rows = await this.call(() => this.sb.from('daily_log').select('*').in('house_batch_id', ids).gte('production_day', sinceDay));
    return (rows as Row[]).map(toLog);
  }

  async upsertLog(r: LogRecord) {
    const row = await this.call(() => this.sb.rpc('upsert_daily_log', {
      p: {
        id: r.id, house_batch_id: r.houseBatchId, production_day: r.productionDay, deaths: r.deaths, culls: r.culls,
        cull_reason: r.cullReason, feed_kg: r.feedKg, water_meter: r.waterMeter, new_meter: r.newMeter,
        t_min: r.tMin, t_max: r.tMax, rh: r.rh, note: r.note, edit_reason: r.editReason ?? null,
      },
    }));
    return toLog(row as Row);
  }

  async houseToday(): Promise<HouseToday[]> {
    const rows = await this.call(() => this.sb.from('house_today').select('*').order('house_name'));
    return (rows as Row[]).map((r) => ({
      houseBatchId: r.house_batch_id, houseName: r.house_name, workers: r.workers, dayOfAge: r.day_of_age,
      placed: r.placed, liveBirds: r.live_birds, areaM2: Number(r.area_m2),
      today: r.today_log_id ? { deaths: r.today_deaths, culls: r.today_culls, feedKg: r.today_feed_kg == null ? null : Number(r.today_feed_kg), waterL: r.today_water_l, tMin: r.today_t_min == null ? null : Number(r.today_t_min), tMax: r.today_t_max == null ? null : Number(r.today_t_max), rh: r.today_rh == null ? null : Number(r.today_rh), loggedAt: r.today_logged_at } : null,
      yesterdayDeaths: r.yesterday_deaths == null ? null : r.yesterday_deaths + r.yesterday_culls,
    }));
  }

  async listHouses(): Promise<House[]> {
    const rows = await this.call(() => this.sb.from('house').select('*').eq('active', true).order('name'));
    return (rows as Row[]).map((r) => ({ id: r.id, name: r.name, areaM2: Number(r.area_m2), hasWaterMeter: r.has_water_meter, drinkerType: r.drinker_type, feederType: r.feeder_type }));
  }

  async createHouse(h: Omit<House, 'id'>) {
    const farmId = JSON.parse(localStorage.getItem(SESSION_CACHE) ?? '{}')?.farm?.id;
    const r = await this.call(() => this.sb.from('house').insert({ farm_id: farmId, name: h.name, area_m2: h.areaM2, has_water_meter: h.hasWaterMeter, drinker_type: h.drinkerType, feeder_type: h.feederType }).select().single());
    return { id: (r as Row).id, ...h };
  }

  async listWorkers(): Promise<Worker[]> {
    const users = await this.call(() => this.sb.from('app_user').select('id, display_name, phone, active').eq('role', 'worker').order('display_name'));
    const links = await this.call(() => this.sb.from('house_worker').select('house_id, user_id'));
    return (users as Row[]).map((u) => ({ id: u.id, displayName: u.display_name, phone: u.phone, active: u.active, houseIds: (links as Row[]).filter((l) => l.user_id === u.id).map((l) => l.house_id) }));
  }

  async inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }) {
    const { error } = await this.sb.functions.invoke('invite-worker', { body: { display_name: w.displayName, phone: normalizePhone(w.phone), pin: w.pin, house_ids: w.houseIds } });
    if (error) throw new ApiError('UNKNOWN', error.message);
  }

  async setWorkerHouses(workerId: string, houseIds: string[]) {
    await this.call(() => this.sb.from('house_worker').delete().eq('user_id', workerId));
    if (houseIds.length) await this.call(() => this.sb.from('house_worker').insert(houseIds.map((house_id) => ({ house_id, user_id: workerId }))));
  }
}
