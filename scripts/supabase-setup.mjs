#!/usr/bin/env node
// One-time setup of a fresh Supabase project for the farm app, through the Supabase Management API.
//
//   SUPABASE_REF=abcd1234 SUPABASE_ACCESS_TOKEN=sbp_... \
//   FARM_NAME="Бройлерная ферма" HEAD_NAME="Имя" HEAD_PHONE="+996700000001" HEAD_PIN=123456 \
//   node scripts/supabase-setup.mjs
//
// Safe to re-run: every step checks whether it was already done.
// Steps: schema migrations → auth settings → head account → farm + head profile → invite-worker function
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

async function mgmt(path, init = {}) {
  const res = await fetch(api + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
const sql = (query) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
const step = (s) => console.log(`\n▸ ${s}`);
const digits = (p) => p.replace(/\D/g, '');
const normPhone = (p) => (digits(p).length === 9 ? `+996${digits(p)}` : `+${digits(p)}`);

step('Project');
const project = await mgmt('');
console.log(`  ${project.name} · region ${project.region} · status ${project.status}`);

step('Schema');
const [{ exists }] = await sql(`select to_regclass('public.daily_log') is not null as exists`);
if (exists) console.log('  already applied');
else for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) {
  await sql(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
  console.log(`  applied ${f}`);
}

step('Auth settings: no email confirmation, 6-digit PINs allowed');
await mgmt('/config/auth', { method: 'PATCH', body: JSON.stringify({ mailer_autoconfirm: true, password_min_length: 6 }) });
console.log('  ok');

step('API keys');
const keys = await mgmt('/api-keys');
const anon = keys.find((k) => k.name === 'anon')?.api_key;
const service = keys.find((k) => k.name === 'service_role')?.api_key;
if (!anon || !service) throw new Error('anon/service_role keys not found');
console.log('  ok (keys are not printed)');

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

step('Edge function invite-worker');
try {
  const form = new FormData();
  form.append('metadata', JSON.stringify({ name: 'invite-worker', entrypoint_path: 'index.ts', verify_jwt: true }));
  form.append('file', new Blob([readFileSync(join(root, 'supabase/functions/invite-worker/index.ts'))], { type: 'application/typescript' }), 'index.ts');
  const res = await fetch(`${api}/functions/deploy?slug=invite-worker`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.log('  deployed');
} catch (e) {
  console.log(`  NOT deployed (${e.message}).\n  Deploy it with the Supabase CLI: npx supabase functions deploy invite-worker --project-ref ${ref}`);
}

step('apps/web/.env.production');
writeFileSync(join(root, 'apps/web/.env.production'),
  `# Public values: the anon key is meant to ship in the browser; access is enforced by Row Level Security.\nVITE_SUPABASE_URL=${projectUrl}\nVITE_SUPABASE_ANON_KEY=${anon}\n`);
console.log('  written');

console.log(`\nDone. The head signs in with ${headPhone} and the PIN.`);
