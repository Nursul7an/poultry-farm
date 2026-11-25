export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'));
export const fmtNum = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }));
/** Parses user input, accepting comma or dot decimals and spaces. Empty → null. */
export function parseNum(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const fmtDayLong = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m! - 1]}`; };
export const fmtDayShort = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };
export const fmtTime = (iso: string | undefined) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
export const CULL_REASONS: { value: 'legs' | 'runt' | 'injury' | 'ascites' | 'other'; label: string }[] = [
  { value: 'legs', label: 'Ноги' }, { value: 'runt', label: 'Отставание' }, { value: 'injury', label: 'Травма' },
  { value: 'ascites', label: 'Асцит' }, { value: 'other', label: 'Другое' },
];
