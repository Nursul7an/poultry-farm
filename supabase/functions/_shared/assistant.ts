// Pure helpers for the «Помощник» edge function: prompt text and citation handling.
// No Deno or npm imports here, so the unit tests run under Node (vitest).

export interface Snippet { id: string; section: string; title: string; body_md: string }
export interface HouseContext { houseName: string; dayOfAge: number; liveBirds: number; recent: string }

export const SYSTEM_RULES = `Ты — помощник на бройлерной ферме (кросс Arbor Acres, 4 птичника, Кыргызстан). Тебе пишут работники птичников и директор.

Как отвечать:
- По-русски, коротко и по делу: сначала что сделать или проверить, потом почему. Обычно 3–8 строк или короткий список.
- Опирайся только на нормы фермы и отрывки справочника из сообщения. Ставь ссылку [n] на номер отрывка после утверждения, взятого из него.
- Если в отрывках нет ответа — так и скажи и посоветуй, к кому обратиться (ветврач, директор, поставщик). Не выдумывай числа.
- Лечение, препараты и дозы: только то, что есть в справочнике, и всегда с пометкой, что назначает ветврач. Помни о сроке ожидания перед убоем.
- Если указаны данные птичника — сравни их с нормой и скажи, что не так.
- Без markdown-таблиц и заголовков: ответ читают на телефоне. Можно «- » для списка.`;

/** The farm's norms as compact text for the prompt (cached between questions). */
export function normsBlock(norms: Record<string, unknown>): string {
  return `Нормы этой фермы (Arbor Acres, с изменениями директора), JSON по разделам:\n${JSON.stringify(norms)}`;
}

/** Words for full-text search: drop very short words and punctuation. */
export function searchQuery(question: string): string {
  return (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3).slice(0, 20).join(' ');
}

export function userMessage(question: string, snippets: Snippet[], ctx: HouseContext | null, maxChars = 2500): string {
  const parts: string[] = [];
  if (ctx) {
    parts.push(`Данные птичника ${ctx.houseName}: день выращивания ${ctx.dayOfAge}, живых ${ctx.liveBirds} гол.` + (ctx.recent ? `\nПоследние журналы:\n${ctx.recent.slice(0, 1500)}` : ''));
  }
  parts.push(snippets.length
    ? `Отрывки справочника:\n\n${snippets.map((s, i) => `[${i + 1}] ${s.section} — ${s.title}\n${s.body_md.length > maxChars ? s.body_md.slice(0, maxChars) + '…' : s.body_md}`).join('\n\n')}`
    : 'Отрывки справочника: по этому вопросу ничего не найдено.');
  parts.push(`Вопрос: ${question}`);
  return parts.join('\n\n---\n\n');
}

/**
 * Keep only the sources the answer cites and renumber them 1..k in order of first use,
 * so the app can list them as [1], [2]… under the answer.
 */
export function citeSources(answer: string, snippets: Snippet[]): { answer: string; sources: { id: string; title: string }[] } {
  const order: number[] = [];
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= snippets.length && !order.includes(n)) order.push(n);
  }
  const renum = new Map(order.map((n, i) => [n, i + 1]));
  const text = answer.replace(/\[(\d{1,2})\]/g, (all, d) => (renum.has(Number(d)) ? `[${renum.get(Number(d))}]` : ''));
  return { answer: text.replace(/[ \t]+\n/g, '\n').trim(), sources: order.map((n) => ({ id: snippets[n - 1]!.id, title: snippets[n - 1]!.title })) };
}

export function clampContext(c: unknown): HouseContext | null {
  if (!c || typeof c !== 'object') return null;
  const x = c as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { houseName: String(x.houseName ?? '').slice(0, 20), dayOfAge: num(x.dayOfAge), liveBirds: num(x.liveBirds), recent: String(x.recent ?? '').slice(0, 1500) };
}
