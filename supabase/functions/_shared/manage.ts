// Director's account actions: create a worker, new PIN, deactivate/reactivate, change phone (login).
// Runs with the service-role key, so every action first checks — as the caller — that they are the farm's
// director and that the worker belongs to that farm.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseAction, phoneToEmail, Rejected } from './people.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const FOREVER = '876000h'; // ~100 years: Supabase Auth ban until reactivated

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const [{ data: isHead }, { data: farmId }, { data: me }] = await Promise.all([
      caller.rpc('is_head'), caller.rpc('current_farm_id'), caller.auth.getUser(),
    ]);
    if (!isHead || !farmId || !me?.user) throw new Rejected('FORBIDDEN', 'Только директор фермы', 403);
    const a = parseAction(await req.json().catch(() => ({})));
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const log = (userId: string, kind: string) =>
      admin.from('staff_event').insert({ farm_id: farmId, actor_id: me.user!.id, user_id: userId, kind });

    const phoneFree = async (phone: string, except?: string) => {
      const { data } = await admin.from('app_user').select('id, display_name').eq('phone', phone).maybeSingle();
      if (data && data.id !== except) throw new Rejected('PHONE_TAKEN', `Этот номер уже есть у ${data.display_name}`, 409);
    };
    const worker = async (id: string) => {
      const { data } = await admin.from('app_user').select('id, role, active, farm_id').eq('id', id).maybeSingle();
      if (!data || data.farm_id !== farmId || data.role !== 'worker') throw new Rejected('BAD_USER', 'Работник не найден', 404);
      return data;
    };

    switch (a.action) {
      case 'create': {
        await phoneFree(a.phone);
        const { data: created, error } = await admin.auth.admin.createUser({ email: phoneToEmail(a.phone), password: a.pin, email_confirm: true });
        if (error || !created.user) throw new Rejected('CREATE_FAILED', 'Не удалось создать аккаунт: ' + (error?.message ?? ''), 400);
        const uid = created.user.id;
        const { error: e1 } = await admin.from('app_user').insert({ id: uid, farm_id: farmId, role: 'worker', display_name: a.display_name, phone: a.phone });
        if (e1) { await admin.auth.admin.deleteUser(uid); throw new Rejected('PROFILE_FAILED', 'Не удалось сохранить работника', 400); }
        const { data: own } = await admin.from('house').select('id').eq('farm_id', farmId).in('id', a.house_ids.length ? a.house_ids : ['00000000-0000-0000-0000-000000000000']);
        if (own?.length) await admin.from('house_worker').insert(own.map((h) => ({ house_id: h.id, user_id: uid })));
        await log(uid, 'created');
        return json({ id: uid });
      }
      case 'reset_pin': {
        await worker(a.user_id);
        const { error } = await admin.auth.admin.updateUserById(a.user_id, { password: a.pin });
        if (error) throw new Rejected('PIN_FAILED', 'Не удалось сменить PIN', 400);
        await admin.rpc('revoke_sessions', { uid: a.user_id });
        await log(a.user_id, 'pin_reset');
        return json({ ok: true });
      }
      case 'set_active': {
        await worker(a.user_id);
        const { error } = await admin.auth.admin.updateUserById(a.user_id, { ban_duration: a.active ? 'none' : FOREVER });
        if (error) throw new Rejected('BAN_FAILED', 'Не удалось изменить доступ', 400);
        await admin.from('app_user').update({ active: a.active }).eq('id', a.user_id);
        if (!a.active) await admin.rpc('revoke_sessions', { uid: a.user_id });
        await log(a.user_id, a.active ? 'reactivated' : 'deactivated');
        return json({ ok: true });
      }
      case 'set_phone': {
        await worker(a.user_id);
        await phoneFree(a.phone, a.user_id);
        const { error } = await admin.auth.admin.updateUserById(a.user_id, { email: phoneToEmail(a.phone), email_confirm: true });
        if (error) throw new Rejected('PHONE_FAILED', 'Не удалось сменить телефон', 400);
        await admin.from('app_user').update({ phone: a.phone }).eq('id', a.user_id);
        await log(a.user_id, 'phone_changed');
        return json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof Rejected) return json({ error: e.code, message: e.message }, e.status);
    console.error(e);
    return json({ error: 'UNKNOWN', message: 'Ошибка сервера, попробуйте ещё раз' }, 500);
  }
}
