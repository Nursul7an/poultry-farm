/** Phone numbers are the login. Internally each maps to an email-style identity (must match the invite function). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 9) return `+996${digits}`;          // local KG number without the country code
  return `+${digits}`;
}
export function phoneToEmail(phone: string): string {
  return `p${normalizePhone(phone).replace(/\D/g, '')}@phone.farm.local`;
}
export const PIN_RE = /^\d{6}$/;
