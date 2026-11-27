#!/usr/bin/env node
// One-time setup of a fresh Supabase project for the farm app, through the Supabase Management API.
//
//   SUPABASE_REF=abcd1234 SUPABASE_ACCESS_TOKEN=sbp_... \
//   FARM_NAME="Бройлерная ферма" HEAD_NAME="Имя" HEAD_PHONE="+996700000001" HEAD_PIN=123456 \
//   node scripts/supabase-setup.mjs
//
// Safe to re-run: every step checks whether it was already done.
// Steps: schema migrations → auth settings → head account → farm + head profile → edge functions (invite-worker, ask)
//        → apps/web/.env.production (project URL + public anon key).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (k, required = true) => { const v = process.env[k]; if (required && !v) { console.error(`Missing ${k}`); process.exit(1); } return v; };
const ref = env('SUPABASE_REF');
// In the cloud session the network proxy injects the real token for api.supabase.com; a placeholder is fine there.
const token = env('SUPABASE_ACCESS_TOKEN', false) || 'injected-by-proxy';
const api = `https://api.supabase.com/v1/projects/${ref}`;
const projectUrl = `https://${ref}.supabase.co`;

class Transient extends Error {}
async function mgmtOnce(path, init = {}) {
  const res = await fetch(api + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (res.status >= 500) throw new Transient(`${init.method ?? 'GET'} ${path} → ${res.status}`);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Retries gateway errors (a new project's API is flaky for a while). `settled()` says whether a failed write landed anyway. */
async function mgmt(path, init = {}, settled = null) {
  for (let i = 0; ; i++) {
    try { return await mgmtOnce(path, init); }
    catch (e) {
      if (!(e instanceof Transient) || i >= 7) throw e;
      await sleep(3000 * (i + 1));
      if (settled && (await settled())) return null;
    }
  }
}
const sql = (query, settled = null) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) }, settled);
const step = (s) => console.log(`\n▸ ${s}`);
const digits = (p) => p.replace(/\D/g, '');
const normPhone = (p) => (digits(p).length === 9 ? `+996${digits(p)}` : `+${digits(p)}`);

step('Project');
const project = await mgmt('');
console.log(`  ${project.name} · region ${project.region} · status ${project.status}`);

step('Schema');
// Applied migrations are recorded in public.app_migration, so re-running applies only new files.
await sql(`create table if not exists public.app_migration (name text primary key, applied_at timestamptz not null default now());
  revoke all on public.app_migration from anon, authenticated;`);
const done = new Set((await sql(`select name from public.app_migration`)).map((r) => r.name));
const files = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
if (!done.size) {
  // A project set up before migrations were recorded: mark what is already there.
  const [{ ops, knowledge }] = await sql(`select to_regclass('public.daily_log') is not null as ops, to_regclass('public.norm') is not null as knowledge`);
  const pre = files.filter((f) => (ops && f < '20261127000002') || (knowledge && f < '20261127000004'));
  for (const f of pre) { await sql(`insert into public.app_migration (name) values ('${f}') on conflict do nothing`); done.add(f); }
}
for (const f of files) {
  if (done.has(f)) continue;
  await sql(readFileSync(join(root, 'supabase/migrations', f), 'utf8') + `\ninsert into public.app_migration (name) values ('${f}');`,
    async () => (await sql(`select 1 from public.app_migration where name = '${f}'`)).length > 0);
  console.log(`  applied ${f}`);
}
console.log(`  ${files.length} migrations in place`);

step('Auth settings: no email confirmation, 6-digit PINs allowed');
// Not strictly needed (accounts are created confirmed; 6 is Supabase's default minimum), so a token without
// auth_config_write only gets a note.
try {
  await mgmt('/config/auth', { method: 'PATCH', body: JSON.stringify({ mailer_autoconfirm: true, password_min_length: 6 }) });
  console.log('  ok');
} catch (e) {
  console.log(`  skipped (${String(e.message).slice(0, 80)}). Check: Authentication → Sign In / Providers → Email, minimum password length 6.`);
}

step('API keys');
const keys = await mgmt('/api-keys');
const anon = keys.find((k) => k.name === 'anon')?.api_key;
const service = keys.find((k) => k.name === 'service_role')?.api_key;
if (!anon || !service) throw new Error('anon/service_role keys not found');
console.log('  ok (keys are not printed)');

// Edge functions: each is deployed with the shared helpers it imports.
for (const [slug, extra] of [
  ['manage-worker', ['_shared/manage.ts', '_shared/people.ts']],
  ['invite-worker', ['_shared/manage.ts', '_shared/people.ts']],
  ['ask', ['_shared/assistant.ts']],
]) {
  step(`Edge function ${slug}`);
  try {
    const form = new FormData();
    form.append('metadata', JSON.stringify({ name: slug, entrypoint_path: `${slug}/index.ts`, verify_jwt: true }));
    for (const f of [`${slug}/index.ts`, ...extra]) {
      form.append('file', new Blob([readFileSync(join(root, 'supabase/functions', f))], { type: 'application/typescript' }), f);
    }
    const res = await fetch(`${api}/functions/deploy?slug=${slug}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log('  deployed');
  } catch (e) {
    console.log(`  NOT deployed (${e.message}).\n  Deploy it with the Supabase CLI: npx supabase functions deploy ${slug} --project-ref ${ref}`);
  }
}
const secrets = await mgmt('/secrets').catch(() => []);
if (!secrets.some?.((x) => x.name === 'ANTHROPIC_API_KEY')) {
  console.log('  «Помощник» needs ANTHROPIC_API_KEY: Supabase dashboard → Edge Functions → Secrets (the handbook works without it).');
}

step('apps/web/.env.production');
writeFileSync(join(root, 'apps/web/.env.production'),
  `# Public values: the anon key is meant to ship in the browser; access is enforced by Row Level Security.\nVITE_SUPABASE_URL=${projectUrl}\nVITE_SUPABASE_ANON_KEY=${anon}\n`);
console.log('  written');

if (process.env.HEAD_PHONE) {
  step('Head account');
  const headPhone = normPhone(env('HEAD_PHONE'));
  const headPin = env('HEAD_PIN');
  if (!/^\d{6}$/.test(headPin)) throw new Error('HEAD_PIN must be 6 digits');
  const email = `p${digits(headPhone)}@phone.farm.local`;
  const [existingUser] = await sql(`select id from auth.users where email = '${email}'`);
  let headId = existingUser?.id;
  if (headId) console.log('  already exists');
  else {
    const res = await fetch(`${projectUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: headPin, email_confirm: true }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`create head user → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    headId = body.id;
    console.log('  created');
  }

  step('Farm and head profile');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const [profile] = await sql(`select farm_id from public.app_user where id = ${q(headId)}`);
  if (profile) console.log('  already exists');
  else {
    await sql(`with f as (insert into public.farm (name) values (${q(env('FARM_NAME'))}) returning id)
      insert into public.app_user (id, farm_id, role, display_name, phone)
      select ${q(headId)}, f.id, 'head', ${q(env('HEAD_NAME'))}, ${q(headPhone)} from f`);
    console.log('  created');
  }
  console.log(`\nDone. The head signs in with ${headPhone} and the PIN.`);
} else console.log('\nDone, except the director: re-run with FARM_NAME, HEAD_NAME, HEAD_PHONE, HEAD_PIN.');
