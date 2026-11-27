// Supabase Edge Function «ask»: answers a farm question from the handbook with Claude.
// Deploy:  supabase functions deploy ask
// Secret:  supabase secrets set ANTHROPIC_API_KEY=...   (optional: ASSISTANT_MODEL, ASSISTANT_DAILY_LIMIT)
// Flow: verify the caller → daily limit → full-text search of the handbook → Claude with the farm's norms
// (cached) + the best articles → answer with [n] citations mapped back to article ids → log the question.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@^1.14.0';
import { citeSources, clampContext, normsBlock, searchQuery, SYSTEM_RULES, userMessage, type Snippet } from '../_shared/assistant.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-opus-5-5';
const DAILY_LIMIT = Number(Deno.env.get('ASSISTANT_DAILY_LIMIT') ?? 30);
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // The caller's own client: RLS applies to everything below.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: 'Войдите заново' }, 401);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'Помощник не настроен: нет ключа ANTHROPIC_API_KEY' }, 503);

  let body: { question?: unknown; context?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Неверный запрос' }, 400); }
  const question = String(body.question ?? '').trim().slice(0, 1000);
  if (question.length < 5) return json({ error: 'Напишите вопрос подробнее' }, 400);
  const ctx = clampContext(body.context);

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count } = await db.from('assistant_question').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id).gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `Лимит ${DAILY_LIMIT} вопросов в сутки. Справочник доступен без ограничений.` }, 429);

  const [{ data: hits }, { data: normRows }] = await Promise.all([
    db.rpc('search_knowledge_any', { q: searchQuery(question), max_results: 6 }),
    db.from('norm').select('code, data, farm_id'),
  ]);
  const snippets = (hits ?? []) as Snippet[];
  // Farm rows override the Arbor Acres defaults.
  const norms: Record<string, unknown> = {};
  for (const r of (normRows ?? []).sort((a, b) => Number(a.farm_id != null) - Number(b.farm_id != null))) norms[r.code] = r.data;

  let res;
  try {
    res = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM_RULES },
        { type: 'text', text: normsBlock(norms), cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage(question, snippets, ctx) }],
    });
  } catch (e) {
    console.error('anthropic error', e);
    return json({ error: 'Помощник сейчас недоступен, попробуйте позже' }, 502);
  }

  if (res.stop_reason === 'refusal') return json({ error: 'Помощник не может ответить на этот вопрос. Обратитесь к ветврачу или директору.' }, 422);
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
  if (!text) return json({ error: 'Пустой ответ, попробуйте переформулировать' }, 502);
  const out = citeSources(text, snippets);

  await db.from('assistant_question').insert({
    question, answer: out.answer, sources: out.sources.map((s) => s.id),
    input_tokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
    output_tokens: res.usage.output_tokens,
  });
  return json(out);
});
