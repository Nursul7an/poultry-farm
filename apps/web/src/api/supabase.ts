/** Real backend: Supabase (Postgres + RLS). Server rules: supabase/migrations. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api, Article, AskAnswer, AskContext, BatchInfo, BlockInfo, FarmSettings, NormRow, StaffEvent, Cost, FarmEvent, FeedDelivery, Handover, HealthEvent, House, HouseBatchInfo, HouseToday, LogRecord, MyHouse, OpsBundle, Payment, Price, Session, Weighing, Worker } from './types';
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


const num = (v: unknown) => (v == null ? null : Number(v));
function toHb(r: Row): HouseBatchInfo {
  return {
    houseBatchId: r.id, houseId: r.house?.id ?? r.house_id, houseName: r.house?.name ?? '', placedOn: r.placed_on, placed: r.placed,
    hasWaterMeter: r.house?.has_water_meter ?? true, batchName: r.batch?.name ?? '', batchId: r.batch_id,
    feedPhase: r.feed_phase, feedPhaseSince: r.feed_phase_since, catchAt: r.catch_at, feedOffAt: r.feed_off_at,
    catchOverrideReason: r.catch_override_reason, hatchery: r.hatchery, waybillCount: r.waybill_count, transportDead: r.transport_dead,
    parentAgeWeeks: r.parent_age_weeks, day0WeightG: num(r.day0_weight_g), cloacalT: num(r.cloacal_t), cropFill: r.crop_fill ?? {}, createdAt: r.created_at,
  };
}
const toFeed = (r: Row): FeedDelivery => ({ id: r.id, houseBatchId: r.house_batch_id, deliveredOn: r.delivered_on, feedType: r.feed_type, tonnes: Number(r.tonnes), note: r.note, createdAt: r.created_at, createdBy: r.created_by });
const toHealth = (r: Row): HealthEvent => ({ id: r.id, houseBatchId: r.house_batch_id, kind: r.kind, eventOn: r.event_on, product: r.product, dose: r.dose, lot: r.lot, method: r.method, courseDays: r.course_days, withdrawalDays: r.withdrawal_days, birdsExamined: r.birds_examined, findings: r.findings, earliestSlaughter: r.earliest_slaughter, note: r.note, createdAt: r.created_at, createdBy: r.created_by });
const toWeighing = (r: Row): Weighing => ({ id: r.id, houseBatchId: r.house_batch_id, weighedOn: r.weighed_on, method: r.method, samplesG: (r.samples_g ?? []).map(Number), groupTotalG: num(r.group_total_g), groupBirds: r.group_birds, n: r.n, meanG: num(r.mean_g), sdG: num(r.sd_g), cv: num(r.cv), createdAt: r.created_at, createdBy: r.created_by });
const toHandover = (r: Row): Handover => ({ id: r.id, houseBatchId: r.house_batch_id, handedOn: r.handed_on, buyer: r.buyer, birds: r.birds, kg: Number(r.kg), transportDead: r.transport_dead, note: r.note, createdAt: r.created_at, createdBy: r.created_by });

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
    if (res.error && ((res.error as any).code === 'user_banned' || /banned/i.test(res.error.message))) throw new ApiError('FORBIDDEN', 'Доступ закрыт. Обратитесь к директору.');
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

  /** Signs out on this device without waiting for the network (a slow line must not block «Выйти»). */
  async signOut() {
    localStorage.removeItem(SESSION_CACHE);
    try { await Promise.race([this.sb.auth.signOut({ scope: 'local' }), new Promise((r) => setTimeout(r, 1500))]); } catch { /* cleared below */ }
    for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k);
  }

  async myHouseBatches(): Promise<HouseBatchInfo[]> {
    const rows = await this.call(() => this.sb.from('house_batch')
      .select('*, house:house_id (id, name, has_water_meter), batch:batch_id!inner (id, name, status)')
      .neq('batch.status', 'closed'));
    return (rows as Row[]).filter((r) => r.batch).map(toHb).sort((a, b) => a.houseName.localeCompare(b.houseName));
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

  async updateFarm(f: FarmSettings): Promise<Session['farm']> {
    const id = this.farmId();
    const r = await this.call(() => this.sb.from('farm').update({ name: f.name, tz: f.tz, day_start_hour: f.dayStartHour }).eq('id', id).select('id, name, tz, day_start_hour').single());
    const farm = { id: (r as Row).id, name: (r as Row).name, tz: (r as Row).tz, dayStartHour: (r as Row).day_start_hour };
    const cached = JSON.parse(localStorage.getItem(SESSION_CACHE) ?? 'null') as Session | null;
    if (cached) localStorage.setItem(SESSION_CACHE, JSON.stringify({ ...cached, farm }));
    return farm;
  }

  async listHouses(): Promise<House[]> {
    const rows = await this.call(() => this.sb.from('house').select('*').order('name'));
    return (rows as Row[]).map((r) => ({ id: r.id, name: r.name, code: r.code, areaM2: Number(r.area_m2), hasWaterMeter: r.has_water_meter, drinkerType: r.drinker_type, feederType: r.feeder_type, active: r.active }));
  }

  async createHouse(h: Omit<House, 'id'>) {
    const r = await this.call(() => this.sb.from('house').insert({ farm_id: this.farmId(), name: h.name, area_m2: h.areaM2, has_water_meter: h.hasWaterMeter, drinker_type: h.drinkerType, feeder_type: h.feederType }).select().single());
    return { id: (r as Row).id, ...h, active: true };
  }
  async updateHouse(id: string, p: Partial<Omit<House, 'id'>>) {
    const row: Row = {};
    if (p.name !== undefined) row.name = p.name;
    if (p.areaM2 !== undefined) row.area_m2 = p.areaM2;
    if (p.hasWaterMeter !== undefined) row.has_water_meter = p.hasWaterMeter;
    if (p.active !== undefined) row.active = p.active;
    await this.call(() => this.sb.from('house').update(row).eq('id', id));
  }
  async deleteHouse(id: string) {
    const rows = await this.call(() => this.sb.from('house').delete().eq('id', id).select('id'));
    if (!(rows as Row[]).length) throw new ApiError('VALIDATION', 'У блока есть история партий — его можно только отключить');
  }

  async listWorkers(): Promise<Worker[]> {
    const users = await this.call(() => this.sb.from('app_user').select('id, display_name, phone, active').eq('role', 'worker').order('display_name'));
    const links = await this.call(() => this.sb.from('house_worker').select('house_id, user_id'));
    return (users as Row[]).map((u) => ({ id: u.id, displayName: u.display_name, phone: u.phone, active: u.active, houseIds: (links as Row[]).filter((l) => l.user_id === u.id).map((l) => l.house_id) }));
  }

  /** Account actions run on the server (manage-worker): they change Supabase Auth, which the browser cannot. */
  private async manage(body: Record<string, unknown>): Promise<any> {
    let res;
    try { res = await this.sb.functions.invoke('manage-worker', { body }); } catch (e: any) { throw new ApiError('NETWORK', e?.message); }
    if (res.error) {
      let msg: string | undefined;
      try { msg = (await (res.error as any).context?.json?.())?.message; } catch { /* not JSON */ }
      if (!msg && /fetch|network/i.test(res.error.message)) throw new ApiError('NETWORK');
      throw new ApiError('VALIDATION', msg ?? 'Ошибка сервера');
    }
    return res.data;
  }
  async inviteWorker(w: { displayName: string; phone: string; pin: string; houseIds: string[] }) {
    const r = await this.manage({ action: 'create', display_name: w.displayName, phone: normalizePhone(w.phone), pin: w.pin, house_ids: w.houseIds });
    return { id: r.id as string };
  }
  async resetWorkerPin(workerId: string, pin: string) { await this.manage({ action: 'reset_pin', user_id: workerId, pin }); }
  async setWorkerActive(workerId: string, active: boolean) { await this.manage({ action: 'set_active', user_id: workerId, active }); }
  async setWorkerPhone(workerId: string, phone: string) { await this.manage({ action: 'set_phone', user_id: workerId, phone: normalizePhone(phone) }); }
  async renameWorker(workerId: string, displayName: string) {
    await this.call(() => this.sb.from('app_user').update({ display_name: displayName }).eq('id', workerId));
  }
  async staffEvents(): Promise<StaffEvent[]> {
    const rows = await this.call(() => this.sb.from('staff_event').select('at, kind, user:user_id (display_name), actor:actor_id (display_name)').order('at', { ascending: false }).limit(200));
    return (rows as Row[]).map((r) => ({ at: r.at, kind: r.kind, userName: r.user?.display_name ?? '', actorName: r.actor?.display_name ?? '' }));
  }

  async setWorkerHouses(workerId: string, houseIds: string[]) {
    await this.call(() => this.sb.from('house_worker').delete().eq('user_id', workerId));
    if (houseIds.length) await this.call(() => this.sb.from('house_worker').insert(houseIds.map((house_id) => ({ house_id, user_id: workerId }))));
  }
  async changePin(newPin: string) {
    let res;
    try { res = await this.sb.auth.updateUser({ password: newPin }); } catch (e: any) { throw new ApiError('NETWORK', e?.message); }
    if (res.error) throw new ApiError('UNKNOWN', res.error.message);
  }

  // ------------------------------------------------------------ operations
  async myHouses(): Promise<MyHouse[]> {
    const rows = await this.call(() => this.sb.from('house').select('id, name, has_water_meter').eq('active', true).order('name'));
    return (rows as Row[]).map((r) => ({ houseId: r.id, houseName: r.name, hasWaterMeter: r.has_water_meter }));
  }
  async ops(ids: string[]): Promise<OpsBundle> {
    if (!ids.length) return { feed: [], health: [], weighings: [], handovers: [] };
    const [f, h, w, ho] = await Promise.all(['feed_delivery', 'health_event', 'weighing', 'handover'].map((t) => this.call(() => this.sb.from(t).select('*').in('house_batch_id', ids))));
    return { feed: f.map(toFeed), health: h.map(toHealth), weighings: w.map(toWeighing), handovers: ho.map(toHandover) };
  }
  async push(kind: 'feed' | 'health' | 'weighing' | 'handover' | 'placement' | 'phase' | 'catch', p: any): Promise<any> {
    const up = async (table: string, row: Row, map: (r: Row) => unknown) => map(await this.call(() => this.sb.from(table).upsert(row, { onConflict: 'id' }).select().single()));
    switch (kind) {
      case 'feed': return up('feed_delivery', { id: p.id, house_batch_id: p.houseBatchId, delivered_on: p.deliveredOn, feed_type: p.feedType, tonnes: p.tonnes, note: p.note ?? null, edit_reason: p.editReason ?? null }, toFeed);
      case 'health': return up('health_event', { id: p.id, house_batch_id: p.houseBatchId, kind: p.kind, event_on: p.eventOn, product: p.product ?? null, dose: p.dose ?? null, lot: p.lot ?? null, method: p.method ?? null, course_days: p.courseDays ?? null, withdrawal_days: p.withdrawalDays ?? null, birds_examined: p.birdsExamined ?? null, findings: p.findings ?? null, note: p.note ?? null, edit_reason: p.editReason ?? null }, toHealth);
      case 'weighing': return up('weighing', { id: p.id, house_batch_id: p.houseBatchId, weighed_on: p.weighedOn, method: p.method, samples_g: p.samplesG, group_total_g: p.groupTotalG ?? null, group_birds: p.groupBirds ?? null, edit_reason: p.editReason ?? null }, toWeighing);
      case 'handover': return up('handover', { id: p.id, house_batch_id: p.houseBatchId, handed_on: p.handedOn, buyer: p.buyer, birds: p.birds, kg: p.kg, transport_dead: p.transportDead ?? 0, note: p.note ?? null, edit_reason: p.editReason ?? null }, toHandover);
      case 'placement': return toHb(await this.call(() => this.sb.rpc('record_placement', { p: { id: p.id, house_id: p.houseId, placed_on: p.placedOn, hatchery: p.hatchery, waybill_count: p.waybillCount, transport_dead: p.transportDead, placed: p.placed, parent_age_weeks: p.parentAgeWeeks, day0_weight_g: p.day0WeightG, cloacal_t: p.cloacalT, crop_fill: p.cropFill, edit_reason: p.editReason ?? null, batch_number: p.batchNumber ?? null } }).single()));
      case 'phase': return toHb(await this.call(() => this.sb.rpc('set_feed_phase', { p_house_batch: p.houseBatchId, p_phase: p.phase, p_since: p.since }).single()));
      case 'catch': return toHb(await this.call(() => this.sb.rpc('set_catch_plan', { p_house_batch: p.houseBatchId, p_catch_at: p.catchAt, p_feed_off_at: p.feedOffAt, p_reason: p.reason }).single()));
    }
  }
  async events(sinceIso: string): Promise<FarmEvent[]> {
    const rows = await this.call(() => this.sb.from('farm_event').select('*').gte('at', sinceIso).order('at', { ascending: false }).limit(500));
    const hbs = await this.call(() => this.sb.from('house_batch').select('id, house:house_id (name)'));
    const users = await this.call(() => this.sb.from('app_user').select('id, display_name'));
    const hn = new Map((hbs as Row[]).map((h) => [h.id, h.house?.name ?? '']));
    const un = new Map((users as Row[]).map((u) => [u.id, u.display_name]));
    return (rows as Row[]).map((r) => ({ at: r.at, houseBatchId: r.house_batch_id, houseName: hn.get(r.house_batch_id) ?? '', who: un.get(r.user_id) ?? null, kind: r.kind, refId: r.ref_id, data: r.data ?? {} }));
  }
  // ------------------------------------------------------------ finance (RLS returns nothing to workers)
  async blocks(): Promise<BlockInfo[]> {
    const [houses, batches] = await Promise.all([
      this.call(() => this.sb.from('house').select('id, name, code, area_m2, active, has_water_meter').order('name')),
      this.call(() => this.sb.from('batch').select('id, name, seq, status, closed_at, house_id, house_batch (id, placed_on, placed)')),
    ]);
    const year = new Date().getFullYear();
    return (houses as Row[]).map((h) => {
      const mine = (batches as Row[]).filter((b) => b.house_id === h.id && b.house_batch?.length);
      const open = mine.find((b) => b.status !== 'closed');
      const last = mine.filter((b) => b.status === 'closed').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))[0];
      const seq = Math.max(0, ...mine.filter((b) => String(b.house_batch[0].placed_on).startsWith(String(year))).map((b) => b.seq ?? 0)) + 1;
      return {
        houseId: h.id, name: h.name, code: h.code, areaM2: Number(h.area_m2), active: h.active, hasWaterMeter: h.has_water_meter,
        open: open ? { batchId: open.id, number: open.name, houseBatchId: open.house_batch[0].id, placedOn: open.house_batch[0].placed_on, placed: open.house_batch[0].placed } : null,
        last: last ? { batchId: last.id, number: last.name, closedAt: last.closed_at, houseBatchId: last.house_batch[0].id } : null,
        nextNumber: `${h.code}-${year}-${String(seq).padStart(2, '0')}`,
      };
    });
  }
  async closeBatch(batchId: string) {
    await this.call(() => this.sb.rpc('close_batch', { p_batch: batchId }));
  }
  async currentBatch(): Promise<BatchInfo | null> {
    const rows = await this.call(() => this.sb.from('batch').select('id, name, status').neq('status', 'closed').limit(1));
    return ((rows as Row[])[0] ?? null) as BatchInfo | null;
  }
  async prices(): Promise<Price[]> {
    const rows = await this.call(() => this.sb.from('price').select('kind, ref_id, unit_price'));
    return (rows as Row[]).map((r) => ({ kind: r.kind, refId: r.ref_id, unitPrice: Number(r.unit_price) }));
  }
  async setPrice(p: Price) {
    await this.call(() => this.sb.from('price').upsert({ kind: p.kind, ref_id: p.refId, unit_price: p.unitPrice }, { onConflict: 'kind,ref_id' }));
  }
  async costs(batchId: string): Promise<Cost[]> {
    const rows = await this.call(() => this.sb.from('cost').select('*').eq('batch_id', batchId).order('spent_on'));
    return (rows as Row[]).map((r) => ({ id: r.id, batchId: r.batch_id, category: r.category, amount: Number(r.amount), spentOn: r.spent_on, comment: r.comment }));
  }
  async addCost(c: Omit<Cost, 'id'>) {
    await this.call(() => this.sb.from('cost').insert({ batch_id: c.batchId, category: c.category, amount: c.amount, spent_on: c.spentOn, comment: c.comment }));
  }
  async payments(): Promise<Payment[]> {
    const rows = await this.call(() => this.sb.from('payment').select('*').order('paid_on'));
    return (rows as Row[]).map((r) => ({ id: r.id, handoverId: r.handover_id, amount: Number(r.amount), paidOn: r.paid_on, comment: r.comment }));
  }
  async addPayment(p: Omit<Payment, 'id'>) {
    await this.call(() => this.sb.from('payment').insert({ handover_id: p.handoverId, amount: p.amount, paid_on: p.paidOn, comment: p.comment }));
  }
  // ------------------------------------------------------------ knowledge
  async norms(): Promise<NormRow[]> {
    const rows = await this.call(() => this.sb.from('norm').select('code, data, farm_id'));
    return (rows as Row[]).map((r) => ({ code: r.code, data: r.data, farm: r.farm_id != null }));
  }
  async articles(): Promise<Article[]> {
    const rows = await this.call(() => this.sb.from('knowledge_article').select('id, section, title, body_md, source, sort, farm_id').order('sort'));
    return (rows as Row[]).map((r) => ({ id: r.id, section: r.section, title: r.title, bodyMd: r.body_md, source: r.source, sort: r.sort, farm: r.farm_id != null }));
  }
  private farmId() { return (JSON.parse(localStorage.getItem(SESSION_CACHE) ?? '{}') as Partial<Session>).farm?.id; }
  async setNorm(code: string, data: unknown) {
    await this.call(() => this.sb.from('norm').upsert({ farm_id: this.farmId(), code, data, updated_at: new Date().toISOString() }, { onConflict: 'farm_id,code' }));
  }
  async resetNorm(code: string) {
    await this.call(() => this.sb.from('norm').delete().eq('farm_id', this.farmId()).eq('code', code));
  }
  async ask(question: string, context: AskContext | null): Promise<AskAnswer> {
    let res;
    try { res = await this.sb.functions.invoke('ask', { body: { question, context } }); }
    catch (e: any) { throw new ApiError('NETWORK', e?.message); }
    if (res.error) {
      let msg: string | undefined;
      try { msg = (await (res.error as any).context?.json?.())?.error; } catch { /* not JSON */ }
      throw new ApiError(/fetch|network/i.test(res.error.message) ? 'NETWORK' : 'UNKNOWN', msg);
    }
    return res.data as AskAnswer;
  }
}
