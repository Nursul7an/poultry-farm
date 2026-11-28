// Database tests for supabase/migrations on a throwaway local Postgres.
// Usage: npm run test:db   (or DATABASE_URL=postgres://... to use an existing empty database)
// Covers FR-1, FR-4, FR-6 and NFR Security: RLS per role, idempotent upsert, edit window, water litres, closed batch.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

let stopCluster = () => {};
async function connect() {
  if (process.env.DATABASE_URL) return new pg.Client({ connectionString: process.env.DATABASE_URL });
  const bin = '/usr/lib/postgresql/16/bin';
  const dir = mkdtempSync(join(tmpdir(), 'farm-pg-'));
  chmodSync(dir, 0o777);
  const asPg = (cmd, args) => {
    const isRoot = process.getuid && process.getuid() === 0;
    return isRoot ? execFileSync('runuser', ['-u', 'postgres', '--', join(bin, cmd), ...args], { stdio: 'pipe' })
                  : execFileSync(join(bin, cmd), args, { stdio: 'pipe' });
  };
  asPg('initdb', ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8']); // UTF-8 like Supabase: needed for Russian search
  asPg('pg_ctl', ['-D', join(dir, 'data'), '-o', `-p 54329 -k ${dir} -c listen_addresses=''`, '-w', 'start', '-l', join(dir, 'log')]);
  stopCluster = () => { try { asPg('pg_ctl', ['-D', join(dir, 'data'), '-m', 'fast', 'stop']); } catch {} };
  return new pg.Client({ host: dir, port: 54329, user: 'postgres', database: 'postgres' });
}

const db = await connect();
await db.connect();

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await db.query('reset role'); await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
  finally { await db.query('reset role').catch(() => {}); }
}
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
async function as(userId, fn) {
  await db.query('set role authenticated');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  try { return await fn(); } finally { await db.query('reset role'); }
}
async function expectError(code, fn) {
  try { await fn(); } catch (e) { if (String(e.message).includes(code)) return; throw new Error(`expected ${code}, got ${e.message}`); }
  throw new Error(`expected ${code}, got success`);
}
const upsert = (p) => db.query('select * from public.upsert_daily_log($1)', [JSON.stringify(p)]).then((r) => r.rows[0]);
const uuid = () => crypto.randomUUID();

// ---- schema
await db.query(readFileSync(join(here, 'auth_shim.sql'), 'utf8'));
// Migrations before v3 (blocks) first; then old-style fixtures (one batch for the whole farm); then the rest,
// so the tests also check that the v3 migration splits existing data correctly.
const migrations = readdirSync(migrationsDir).sort();
const V3 = '20261128000002';
for (const f of migrations.filter((f) => f < V3)) await db.query(readFileSync(join(migrationsDir, f), 'utf8'));

// ---- fixtures (as superuser)
const F = uuid(), F2 = uuid(), H = uuid(), A = uuid(), N = uuid(), H2 = uuid();
const houses = { p1: uuid(), p2: uuid(), p3: uuid() };
const B = uuid();
const hb = { p1: uuid(), p2: uuid(), p3: uuid() };
await db.query(`insert into public.farm (id, name) values ($1, 'Ферма'), ($2, 'Чужая ферма')`, [F, F2]);
for (const [id, e] of [[H, 'h'], [A, 'a'], [N, 'n'], [H2, 'h2']]) await db.query('insert into auth.users values ($1, $2)', [id, e]);
await db.query(`insert into public.app_user (id, farm_id, role, display_name, phone) values
  ($1, $5, 'head', 'Директор', '+996700000001'), ($2, $5, 'worker', 'Айгуль Т.', '+996700000002'),
  ($3, $5, 'worker', 'Нурлан Ж.', '+996700000003'), ($4, $6, 'head', 'Чужой', '+996700000004')`, [H, A, N, H2, F, F2]);
await db.query(`insert into public.house (id, farm_id, name, area_m2) values ($1, $4, 'П-1', 1000), ($2, $4, 'П-2', 1000), ($3, $4, 'П-3', 1000)`, [houses.p1, houses.p2, houses.p3, F]);
await db.query(`insert into public.house_worker values ($1, $3), ($2, $3), ($4, $5)`, [houses.p1, houses.p2, A, houses.p3, N]);
await db.query(`insert into public.batch (id, farm_id, name) values ($1, $2, '06/2026')`, [B, F]);
const today = (await db.query('select public.current_production_day($1) d', [F])).rows[0].d.toISOString().slice(0, 10);
const day = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
await db.query(`insert into public.house_batch (id, batch_id, house_id, placed_on, placed) values
  ($1, $4, $5, $8, 17050), ($2, $4, $6, $8, 16980), ($3, $4, $7, $8, 17020)`,
  [hb.p1, hb.p2, hb.p3, B, houses.p1, houses.p2, houses.p3, day(-23)]);
await db.query(`insert into public.price (farm_id, kind, ref_id, unit_price) values ($1, 'chick', $2, 70)`, [F, B]);
await db.query(`insert into public.cost (farm_id, batch_id, category, amount) values ($1, $2, 'energy', 300000)`, [F, B]);
for (const f of migrations.filter((f) => f >= V3)) await db.query(readFileSync(join(migrationsDir, f), 'utf8'));
// After v3 each block has its own batch.
const batchOf = async (hbId) => (await db.query('select batch_id from public.house_batch where id = $1', [hbId])).rows[0].batch_id;
const Bp = { p1: await batchOf(hb.p1), p2: await batchOf(hb.p2), p3: await batchOf(hb.p3) };

const log = (o) => ({ id: uuid(), house_batch_id: hb.p2, production_day: today, deaths: 9, culls: 0, feed_kg: 1970, t_min: 21.6, t_max: 23, rh: 62, ...o });

console.log('RLS and visibility');
await test('worker sees only assigned houses; head sees all', async () => {
  eq((await as(A, () => db.query('select name from public.house order by name'))).rows.map((r) => r.name), ['П-1', 'П-2']);
  eq((await as(N, () => db.query('select name from public.house'))).rows.map((r) => r.name), ['П-3']);
  eq((await as(H, () => db.query('select count(*)::int c from public.house'))).rows[0].c, 3);
});
await test('another farm sees nothing of this farm', async () => {
  eq((await as(H2, () => db.query('select count(*)::int c from public.house'))).rows[0].c, 0);
  eq((await as(H2, () => db.query('select count(*)::int c from public.house_today'))).rows[0].c, 0);
});
await test('worker cannot create a house', async () => {
  await expectError('row-level security', () => as(A, () => db.query(`insert into public.house (farm_id, name, area_m2) values ($1, 'П-9', 900)`, [F])));
});
await test('worker cannot write to a house that is not theirs', async () => {
  await expectError('FORBIDDEN', () => as(A, () => upsert(log({ house_batch_id: hb.p3 }))));
});

console.log('Daily log save and sync');
await test('water litres from the previous reading: 1036.42 → 1039.20 = 2780 L', async () => {
  await as(A, () => upsert(log({ production_day: day(-1), water_meter: 1036.42, deaths: 12, culls: 3, cull_reason: 'legs' })));
  const r = await as(A, () => upsert(log({ water_meter: 1039.2, deaths: 38, culls: 2, cull_reason: 'legs' })));
  eq(r.water_l, 2780);
});
await test('same id sent twice → one row, last values kept (duplicate submit)', async () => {
  const p = log({ house_batch_id: hb.p1, deaths: 9 });
  await as(A, () => upsert(p));
  await as(A, () => upsert({ ...p, deaths: 10 }));
  const r = await db.query('select count(*)::int c, max(deaths) d from public.daily_log where house_batch_id = $1 and production_day = $2', [hb.p1, today]);
  eq([r.rows[0].c, r.rows[0].d], [1, 10]);
});
await test('second device, same house + day → updates existing row and keeps history', async () => {
  const first = (await db.query('select id from public.daily_log where house_batch_id = $1 and production_day = $2', [hb.p1, today])).rows[0].id;
  const r = await as(H, () => upsert(log({ house_batch_id: hb.p1, deaths: 11 })));
  eq(r.id, first, 'returned id');
  const h = await db.query(`select count(*)::int c from public.edit_history where entity_id = $1`, [first]);
  if (h.rows[0].c < 1) throw new Error('no history');
});
await test('meter reading lower than previous → METER_BACKWARDS; new meter accepted', async () => {
  await expectError('METER_BACKWARDS', () => as(A, () => upsert(log({ water_meter: 5 }))));
  const r = await as(A, () => upsert(log({ water_meter: 5, new_meter: true })));
  eq(r.water_l, null);
});
await test('future day is refused', async () => {
  await expectError('DAY_IN_FUTURE', () => as(A, () => upsert(log({ production_day: day(1) }))));
});
await test('worker cannot fill a day older than 2 days; head can', async () => {
  await expectError('DAY_TOO_OLD', () => as(A, () => upsert(log({ production_day: day(-3) }))));
  await as(H, () => upsert(log({ production_day: day(-3) })));
});
await test('culls without a reason are rejected', async () => {
  await expectError('check', () => as(A, () => upsert(log({ production_day: day(-2), culls: 3 }))));
});

console.log('Edit window (48 h)');
await test('worker edit after 48 h → EDIT_WINDOW; head needs a reason', async () => {
  const p = log({ house_batch_id: hb.p2, production_day: day(-2) });
  await as(A, () => upsert(p));
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.daily_log set created_at = now() - interval '49 hours' where id = $1`, [p.id]);
  await db.query(`set session_replication_role = origin`);
  await expectError('EDIT_WINDOW', () => as(A, () => upsert({ ...p, deaths: 1 })));
  await expectError('REASON_REQUIRED', () => as(H, () => upsert({ ...p, deaths: 1 })));
  const r = await as(H, () => upsert({ ...p, deaths: 1, edit_reason: 'ошибка в записи' }));
  eq(r.deaths, 1);
});
await test('worker edit within 48 h is allowed', async () => {
  const r = await as(A, () => upsert(log({ house_batch_id: hb.p1, deaths: 12 })));
  eq(r.deaths, 12);
});

console.log('Head overview and batch rules');
await test('house_today: head sees 3 houses, worker 2, with live birds', async () => {
  const hr = (await as(H, () => db.query('select house_name, live_birds, day_of_age from public.house_today order by house_name'))).rows;
  eq(hr.length, 3);
  eq(hr[0].day_of_age, 23);
  eq((await as(A, () => db.query('select count(*)::int c from public.house_today'))).rows[0].c, 2);
  const p2 = hr.find((r) => r.house_name === 'П-2');
  const sum = (await db.query('select sum(deaths + culls)::int s from public.daily_log where house_batch_id = $1', [hb.p2])).rows[0].s;
  eq(p2.live_birds, 16980 - sum);
});
console.log('Blocks: each block has its own batch (v3)');
await test('migration split the farm batch into one numbered batch per block, chick price copied, cost made shared', async () => {
  const rows = (await db.query(`select h.name, b.name num, b.status from public.batch b join public.house h on h.id = b.house_id where b.farm_id = $1 order by h.name`, [F])).rows;
  const y = today.slice(0, 4);
  eq(rows.map((r) => [r.name, r.num, r.status]), [['П-1', `П1-${y}-01`, 'open'], ['П-2', `П2-${y}-01`, 'open'], ['П-3', `П3-${y}-01`, 'open']]);
  eq(new Set(Object.values(Bp)).size, 3);
  eq((await db.query(`select count(*)::int c from public.price where kind = 'chick' and unit_price = 70 and ref_id = any($1)`, [Object.values(Bp)])).rows[0].c, 3);
  eq((await db.query(`select count(*)::int c from public.cost where batch_id is null and amount = 300000`)).rows[0].c, 1);
});
await test('only one open batch per block; other blocks are independent', async () => {
  await expectError('one_open_batch_per_block', () => db.query(`insert into public.batch (farm_id, house_id, name) values ($1, $2, 'X-1')`, [F, houses.p1]));
});
await test('closed batch refuses logs → BATCH_CLOSED; only the director closes a batch', async () => {
  await expectError('FORBIDDEN', () => as(A, () => db.query('select public.close_batch($1)', [Bp.p1])));
  await as(H, () => db.query('select public.close_batch($1)', [Bp.p1]));
  await expectError('BATCH_CLOSED', () => as(A, () => upsert(log({ house_batch_id: hb.p1, deaths: 1 }))));
  await expectError('BATCH_CLOSED', () => as(H, () => db.query('select public.close_batch($1)', [Bp.p1])));
  await db.query(`update public.batch set status = 'open', closed_at = null where id = $1`, [Bp.p1]);
});

console.log('Operations by workers (role model v2.1)');
const ins = (table, row) => db.query(`insert into public.${table} (${Object.keys(row).join(',')}) values (${Object.keys(row).map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(row)).then((r) => r.rows[0]);
await test('worker records a feed delivery for own house; not for another house', async () => {
  const r = await as(A, () => ins('feed_delivery', { id: uuid(), house_batch_id: hb.p2, delivered_on: today, feed_type: 'grower', tonnes: 8 }));
  eq(r.created_by, A);
  await expectError('row-level security', () => as(A, () => ins('feed_delivery', { id: uuid(), house_batch_id: hb.p3, delivered_on: today, feed_type: 'grower', tonnes: 8 })));
});
await test('treatment: earliest slaughter = start + course + withdrawal (24.11, 5, 7 → 06.12)', async () => {
  const r = await as(A, () => ins('health_event', { id: uuid(), house_batch_id: hb.p2, kind: 'treatment', event_on: '2026-11-24', product: 'Амоксициллин 10%', course_days: 5, withdrawal_days: 7 }));
  eq(r.earliest_slaughter.toISOString().slice(0, 10), '2026-12-06');
});
await test('weighing statistics computed on the server', async () => {
  const r = await as(A, () => ins('weighing', { id: uuid(), house_batch_id: hb.p1, weighed_on: today, method: 'individual', samples_g: [900, 1000, 1100] }));
  eq([r.n, Number(r.mean_g), Number(r.sd_g), Number(r.cv)], [3, 1000, 100, 10]);
});
await test('catch inside withdrawal: refused without reason, saved with reason and logged', async () => {
  const p2 = uuid(); // separate treatment on П-2 with a long withdrawal
  await as(A, () => ins('health_event', { id: p2, house_batch_id: hb.p2, kind: 'treatment', event_on: today, product: 'X', course_days: 5, withdrawal_days: 30 }));
  const early = day(10) + 'T16:00:00Z';
  await expectError('WITHDRAWAL', () => as(A, () => db.query('select * from public.set_catch_plan($1, $2, $3, $4)', [hb.p2, early, early, null])));
  const r = await as(A, () => db.query('select * from public.set_catch_plan($1, $2, $3, $4)', [hb.p2, early, early, 'покупатель не может позже']));
  eq(r.rows[0].catch_override_reason, 'покупатель не может позже');
  const ev = await as(H, () => db.query(`select count(*)::int c from public.farm_event where kind = 'catch_override'`));
  eq(ev.rows[0].c, 1);
  eq((await as(A, () => db.query(`select count(*)::int c from public.farm_event where kind = 'catch_override'`))).rows[0].c, 0);
});
await test('catch after withdrawal needs no reason', async () => {
  const r = await as(A, () => db.query('select * from public.set_catch_plan($1, $2, $3, $4)', [hb.p1, day(18) + 'T16:00:00Z', day(18) + 'T12:00:00Z', null]));
  eq(r.rows[0].catch_override_reason, null);
});
await test('feed phase change by worker', async () => {
  const r = await as(A, () => db.query('select * from public.set_feed_phase($1, $2, $3)', [hb.p1, 'finisher', today]));
  eq(r.rows[0].feed_phase, 'finisher');
  await expectError('FORBIDDEN', () => as(A, () => db.query('select * from public.set_feed_phase($1, $2, $3)', [hb.p3, 'finisher', today])));
});
await test('worker edits a feed delivery after 48 h → EDIT_WINDOW', async () => {
  const id = uuid();
  await as(A, () => ins('feed_delivery', { id, house_batch_id: hb.p1, delivered_on: today, feed_type: 'grower', tonnes: 5 }));
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.feed_delivery set created_at = now() - interval '49 hours' where id = $1`, [id]);
  await db.query(`set session_replication_role = origin`);
  await expectError('EDIT_WINDOW', () => as(A, () => db.query('update public.feed_delivery set tonnes = 6 where id = $1', [id])));
  await as(H, () => db.query(`update public.feed_delivery set tonnes = 6, edit_reason = 'накладная' where id = $1`, [id]));
});
await test('event feed: director sees all houses, worker only own', async () => {
  await as(N, () => ins('handover', { id: uuid(), house_batch_id: hb.p3, handed_on: today, buyer: 'Мясокомбинат', birds: 100, kg: 250 }));
  const hk = (await as(H, () => db.query(`select distinct kind from public.farm_event`))).rows.map((r) => r.kind).sort();
  for (const k of ['feed', 'handover', 'health_treatment', 'log', 'placement', 'weighing']) if (!hk.includes(k)) throw new Error('director misses ' + k);
  const nRows = (await as(N, () => db.query(`select distinct house_batch_id from public.farm_event`))).rows.map((r) => r.house_batch_id);
  eq(nRows, [hb.p3]);
});

console.log('Money is invisible to workers (FR-23)');
await test('director prices a delivery and adds costs and payments; worker sees none of it', async () => {
  const fd = (await db.query('select id from public.feed_delivery limit 1')).rows[0].id;
  const ho = (await db.query('select id from public.handover limit 1')).rows[0].id;
  await as(H, async () => {
    await ins('price', { kind: 'feed', ref_id: fd, unit_price: 38000 });
    await ins('price', { kind: 'chick', ref_id: Bp.p1, unit_price: 72 }).catch(() => {}); // copied by the migration already
    await ins('cost', { batch_id: Bp.p1, category: 'energy', amount: 85000 });
    await ins('cost', { batch_id: null, category: 'wages', amount: 450000 });
    await ins('payment', { handover_id: ho, amount: 10000 });
  });
  for (const t of ['price', 'cost', 'payment']) {
    eq((await as(A, () => db.query(`select count(*)::int c from public.${t}`))).rows[0].c, 0, `worker sees ${t}`);
    eq((await as(H, () => db.query(`select count(*)::int c from public.${t}`))).rows[0].c > 0, true, `director sees ${t}`);
  }
  await expectError('row-level security', () => as(A, () => ins('price', { kind: 'feed', ref_id: fd, unit_price: 1 })));
  await expectError('row-level security', () => as(A, () => ins('cost', { batch_id: Bp.p1, category: 'other', amount: 1 })));
  eq((await as(H2, () => db.query(`select count(*)::int c from public.price`))).rows[0].c, 0, 'other farm');
});

console.log('Placement by workers');
await test('placement starts a new numbered batch only in an empty block; worker only in own blocks', async () => {
  const y = today.slice(0, 4);
  await expectError('BLOCK_BUSY', () => as(A, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ id: uuid(), house_id: houses.p1, placed_on: today, placed: 100 })])));
  await as(H, () => db.query('select public.close_batch($1)', [Bp.p1]));
  await expectError('FORBIDDEN', () => as(A, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ house_id: houses.p3, placed_on: today, placed: 100 })])));
  const id = uuid();
  const r = (await as(A, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ id, house_id: houses.p1, placed_on: today, waybill_count: 17060, transport_dead: 10, placed: 17050 })]))).rows[0];
  const nb = (await db.query('select name, status, house_id from public.batch where id = $1', [r.batch_id])).rows[0];
  eq([nb.name, nb.status, nb.house_id], [`П1-${y}-02`, 'open', houses.p1]);
  const again = (await as(A, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ id, house_id: houses.p1, placed_on: today, placed: 17040 })]))).rows[0];
  eq([again.id, again.placed, again.batch_id], [r.id, 17040, r.batch_id]);
  // The director may set his own number; a taken number is refused.
  await as(H, () => db.query('select public.close_batch($1)', [r.batch_id]));
  await expectError('BATCH_NUMBER_TAKEN', () => as(H, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ id: uuid(), house_id: houses.p1, placed_on: today, placed: 1, batch_number: `П2-${y}-01` })])));
  const own = (await as(H, () => db.query('select * from public.record_placement($1)', [JSON.stringify({ id: uuid(), house_id: houses.p1, placed_on: today, placed: 1, batch_number: 'Б-7' })]))).rows[0];
  eq((await db.query('select name from public.batch where id = $1', [own.batch_id])).rows[0].name, 'Б-7');
  // Restore: the original batch of П-1 is the open one again.
  await db.query(`delete from public.batch where id = any($1)`, [[r.batch_id, own.batch_id]]);
  await db.query(`update public.batch set status = 'open', closed_at = null where id = $1`, [Bp.p1]);
});
await test('block code follows the name: «Блок B» → B', async () => {
  const r = (await as(H, () => db.query(`insert into public.house (farm_id, name, area_m2) values ($1, 'Блок B', 900) returning code`, [F]))).rows[0];
  eq(r.code, 'B');
  await db.query(`delete from public.house where name = 'Блок B'`);
});

console.log('Knowledge: AA norms and handbook');
await test('everyone reads the Arbor Acres defaults and the handbook', async () => {
  eq((await as(A, () => db.query(`select count(*)::int c from public.norm where farm_id is null`))).rows[0].c, 15);
  const t2 = (await as(A, () => db.query(`select data from public.norm where code = 'temp_by_age' and farm_id is null`))).rows[0].data;
  eq([t2.rows[0].day, t2.rows[0].whole, t2.rows[0].spot_edge, t2.rows[0].spot_2m], [0, 30, 32, 29]);
  if ((await as(N, () => db.query(`select count(*)::int c from public.knowledge_article`))).rows[0].c < 50) throw new Error('articles missing');
});
await test('Russian full-text search finds the temperature table', async () => {
  const r = await as(A, () => db.query(`select title from public.search_knowledge('температура по возрасту', 3)`));
  if (!r.rows.some((x) => /Температура по возрасту/.test(x.title))) throw new Error(JSON.stringify(r.rows));
});
await test('only the director overrides norms for the farm; other farms keep defaults', async () => {
  await expectError('row-level security', () => as(A, () => db.query(`insert into public.norm (farm_id, code, data) values ($1, 'mortality', '{}')`, [F])));
  await expectError('row-level security', () => as(A, () => db.query(`insert into public.norm (farm_id, code, data) values (null, 'mortality', '{}')`)));
  await as(H, () => db.query(`insert into public.norm (farm_id, code, data) values ($1, 'mortality', '{"daily_max_pct":0.2}')`, [F]));
  eq((await as(A, () => db.query(`select count(*)::int c from public.norm where code = 'mortality'`))).rows[0].c, 2);
  eq((await as(H2, () => db.query(`select count(*)::int c from public.norm where code = 'mortality'`))).rows[0].c, 1);
  await expectError('row-level security', () => as(H, () => db.query(`update public.norm set data = '{}' where farm_id is null and code = 'air' returning id`).then((r) => { if (!r.rowCount) throw new Error('row-level security: 0 rows'); })));
});
await test('director adds a farm note to the handbook; workers read it', async () => {
  await as(H, () => db.query(`insert into public.knowledge_article (id, farm_id, section, title, body_md) values ('farm-note-1', $1, 'Наша ферма', 'Ветврач', 'Телефон ветврача на доске в конторе')`, [F]));
  eq((await as(A, () => db.query(`select count(*)::int c from public.knowledge_article where id = 'farm-note-1'`))).rows[0].c, 1);
  eq((await as(H2, () => db.query(`select count(*)::int c from public.knowledge_article where id = 'farm-note-1'`))).rows[0].c, 0);
});

await test('assistant search matches any word of a natural question', async () => {
  const r = await as(A, () => db.query(`select title from public.search_knowledge_any('Какая температура нужна цыплятам на десятый день?', 6)`));
  if (!r.rows.length) throw new Error('no hits');
  eq((await as(A, () => db.query(`select count(*)::int c from public.search_knowledge_any('?!', 6)`))).rows[0].c, 0);
});
await test('assistant questions: each person logs and sees own; director sees the farm; other farms nothing', async () => {
  await as(A, () => db.query(`insert into public.assistant_question (question, answer) values ('Сколько воды?', 'Ответ')`));
  await expectError('row-level security', () => as(A, () => db.query(`insert into public.assistant_question (user_id, question) values ($1, 'чужой')`, [N])));
  eq((await as(A, () => db.query(`select count(*)::int c from public.assistant_question`))).rows[0].c, 1);
  eq((await as(N, () => db.query(`select count(*)::int c from public.assistant_question`))).rows[0].c, 0);
  eq((await as(H, () => db.query(`select count(*)::int c from public.assistant_question`))).rows[0].c, 1);
  eq((await as(H2, () => db.query(`select count(*)::int c from public.assistant_question`))).rows[0].c, 0);
});

console.log('People: director manages accounts');
await test('director renames a worker; nobody changes phone, role or farm from the browser', async () => {
  await as(H, () => db.query(`update public.app_user set display_name = 'Айгуль Т.' where id = $1`, [A]));
  await expectError('FORBIDDEN', () => as(H, () => db.query(`update public.app_user set phone = '+996700999999' where id = $1`, [A])));
  await expectError('FORBIDDEN', () => as(H, () => db.query(`update public.app_user set role = 'head' where id = $1`, [A])));
  const r = await as(A, () => db.query(`update public.app_user set display_name = 'x' where id = $1 returning id`, [N]));
  eq(r.rowCount, 0); // workers cannot edit people
});
await test('director cannot deactivate himself; server role can change the phone', async () => {
  await expectError('cannot deactivate yourself', () => as(H, () => db.query(`update public.app_user set active = false where id = $1`, [H])));
  await db.query('set role service_role');
  await db.query(`update public.app_user set phone = phone where id = $1`, [A]);
  await db.query('reset role');
});
await test('deactivated worker reads nothing; reactivated reads again', async () => {
  await as(H, () => db.query(`update public.app_user set active = false where id = $1`, [N]));
  eq((await as(N, () => db.query(`select count(*)::int c from public.house`))).rows[0].c, 0);
  eq((await as(N, () => db.query(`select count(*)::int c from public.daily_log`))).rows[0].c, 0);
  await as(H, () => db.query(`update public.app_user set active = true where id = $1`, [N]));
  if ((await as(N, () => db.query(`select count(*)::int c from public.house`))).rows[0].c < 1) throw new Error('no houses after reactivation');
});
await test('a house with batch history cannot be deleted; an empty one can', async () => {
  const used = (await db.query(`select house_id from public.house_batch limit 1`)).rows[0].house_id;
  const r = await as(H, () => db.query(`delete from public.house where id = $1 returning id`, [used]));
  eq(r.rowCount, 0);
  const [{ id }] = (await as(H, () => db.query(`insert into public.house (farm_id, name, area_m2) values ($1, 'Пустой', 500) returning id`, [F]))).rows;
  eq((await as(A, () => db.query(`delete from public.house where id = $1 returning id`, [id]))).rowCount, 0);
  eq((await as(H, () => db.query(`delete from public.house where id = $1 returning id`, [id]))).rowCount, 1);
});
await test('staff events: only the director of the farm reads them; sessions revoke is server-only', async () => {
  await db.query(`insert into public.staff_event (farm_id, actor_id, user_id, kind) values ($1, $2, $3, 'pin_reset')`, [F, H, A]);
  eq((await as(H, () => db.query(`select count(*)::int c from public.staff_event`))).rows[0].c, 1);
  eq((await as(A, () => db.query(`select count(*)::int c from public.staff_event`))).rows[0].c, 0);
  eq((await as(H2, () => db.query(`select count(*)::int c from public.staff_event`))).rows[0].c, 0);
  await expectError('permission denied', () => as(A, () => db.query(`insert into public.staff_event (farm_id, actor_id, user_id, kind) values ($1, $2, $2, 'created')`, [F, A])));
  await expectError('permission denied', () => as(H, () => db.query(`select public.revoke_sessions($1)`, [A])));
  await db.query(`insert into auth.sessions (user_id) values ($1), ($1)`, [A]);
  await db.query('set role service_role');
  await db.query(`select public.revoke_sessions($1)`, [A]);
  await db.query('reset role');
  eq((await db.query(`select count(*)::int c from auth.sessions where user_id = $1`, [A])).rows[0].c, 0);
});

await test('anon role cannot read anything', async () => {
  await db.query('set role anon');
  await expectError('permission denied', () => db.query('select * from public.daily_log'));
});

await db.end();
stopCluster();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
