// Pure rules for worker accounts, shared by the manage-worker function and its tests (no Deno imports).

/** Login email for a phone. Must match apps/web/src/api/phone.ts. */
export function phoneToEmail(phone: string): string {
  return `p${phone.replace(/\D/g, '')}@phone.farm.local`;
}
/** +996XXXXXXXXX, or null if it is not a Kyrgyz mobile number (9 digits after the code). */
export function normalizeKgPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 9) return `+996${d}`;
  if (d.length === 12 && d.startsWith('996')) return `+${d}`;
  return null;
}
export const validPin = (p: unknown) => /^\d{6}$/.test(String(p ?? ''));

export type Action =
  | { action: 'create'; display_name: string; phone: string; pin: string; house_ids: string[] }
  | { action: 'reset_pin'; user_id: string; pin: string }
  | { action: 'set_active'; user_id: string; active: boolean }
  | { action: 'set_phone'; user_id: string; phone: string };

export class Rejected extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** Validates and normalises a request body; throws Rejected with a Russian message for the director. */
export function parseAction(body: any): Action {
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  switch (body?.action ?? 'create') {
    case 'create': {
      const name = String(body.display_name ?? '').trim();
      if (!name || name.length > 60) throw new Rejected('NAME_REQUIRED', 'Укажите имя работника');
      const phone = normalizeKgPhone(body.phone);
      if (!phone) throw new Rejected('BAD_PHONE', 'Телефон: +996 и 9 цифр');
      if (!validPin(body.pin)) throw new Rejected('BAD_PIN', 'PIN — 6 цифр');
      const houses = Array.isArray(body.house_ids) ? body.house_ids.filter(uuid) : [];
      return { action: 'create', display_name: name, phone, pin: String(body.pin), house_ids: houses };
    }
    case 'reset_pin':
      if (!uuid(body.user_id)) throw new Rejected('BAD_USER', 'Работник не найден');
      if (!validPin(body.pin)) throw new Rejected('BAD_PIN', 'PIN — 6 цифр');
      return { action: 'reset_pin', user_id: body.user_id, pin: String(body.pin) };
    case 'set_active':
      if (!uuid(body.user_id)) throw new Rejected('BAD_USER', 'Работник не найден');
      return { action: 'set_active', user_id: body.user_id, active: body.active === true };
    case 'set_phone': {
      if (!uuid(body.user_id)) throw new Rejected('BAD_USER', 'Работник не найден');
      const phone = normalizeKgPhone(body.phone);
      if (!phone) throw new Rejected('BAD_PHONE', 'Телефон: +996 и 9 цифр');
      return { action: 'set_phone', user_id: body.user_id, phone };
    }
    default:
      throw new Rejected('BAD_ACTION', 'Неизвестное действие');
  }
}
