/** Block code used in batch numbers: «Блок B» → "B", «П-1» → "П1". Must match public.block_code() in SQL. */
export function blockCode(name: string): string {
  const c = name.replace(/^\s*(блок|кашар|сарай|птичник)\s*/i, '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  return c || 'X';
}
/** Letters for new blocks: A, B, C… skipping codes already used. */
export function nextBlockNames(existing: { code?: string; name: string }[], count: number): string[] {
  const used = new Set(existing.map((h) => h.code ?? blockCode(h.name)));
  const out: string[] = [];
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (out.length >= count) break; if (!used.has(L)) out.push(`Блок ${L}`); }
  return out;
}
