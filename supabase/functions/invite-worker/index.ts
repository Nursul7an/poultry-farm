// Supabase Edge Function: the head creates a worker account (phone + PIN) and assigns houses.
// Deploy: supabase functions deploy invite-worker
// NOTE: written for the Supabase Edge (Deno) runtime; not executed in this repo's test suite (no Deno here).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Must match apps/web/src/lib/phone.ts */
function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `p${digits}@phone.farm.local`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isHead } = await caller.rpc('is_head');
  if (!isHead) return json({ error: 'FORBIDDEN' }, 403);
  const { data: farmId } = await caller.rpc('current_farm_id');

  const { phone, display_name, pin, house_ids } = await req.json();
  if (!/^\+?\d{9,15}$/.test(String(phone).replace(/\s/g, ''))) return json({ error: 'BAD_PHONE' }, 400);
  if (!/^\d{6}$/.test(String(pin))) return json({ error: 'BAD_PIN' }, 400);
  if (!display_name) return json({ error: 'NAME_REQUIRED' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: phoneToEmail(phone), password: String(pin), email_confirm: true,
  });
  if (error || !created.user) return json({ error: 'CREATE_FAILED', detail: error?.message }, 400);

  const uid = created.user.id;
  const { error: e1 } = await admin.from('app_user').insert({
    id: uid, farm_id: farmId, role: 'worker', display_name, phone: String(phone).replace(/\s/g, ''),
  });
  if (e1) { await admin.auth.admin.deleteUser(uid); return json({ error: 'PROFILE_FAILED', detail: e1.message }, 400); }

  // Only houses of the caller's farm can be assigned.
  const { data: own } = await admin.from('house').select('id').eq('farm_id', farmId).in('id', house_ids ?? []);
  if (own?.length) await admin.from('house_worker').insert(own.map((h) => ({ house_id: h.id, user_id: uid })));

  return json({ id: uid });
});
