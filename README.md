# Птичник — broiler farm app

An offline-capable app for a 4-house broiler farm. House workers log each house's day on their own Android phones (even with no signal); the head sees all houses and later gets warnings, batch results and profit.

- Product plan: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)
- Technical spec and tickets: [`docs/tz-broiler-farm-app.md`](docs/tz-broiler-farm-app.md)
- Screen designs: [`docs/design/`](docs/design/)
- Domain knowledge (Arbor Acres norms): [`docs/knowledge/`](docs/knowledge/)

## Status

**Role model v2.1** (docs/BLUEPRINT.md §0.2): workers record every operation of their own houses; the director sees everything, can correct anything and alone sees money. Nothing waits for approval.

| Area | Worker (own houses, offline) | Director | State |
|---|---|---|---|
| Daily log | ✔ record, fix ≤ 48 h | ✔ see, fix any (reason after 48 h) | done |
| Feed: deliveries, bin stock, phase change | ✔ tonnes, no price | ✔ price per tonne in «Деньги» | done |
| Health: treatment, vaccination, post-mortem | ✔ with earliest-slaughter date | ✔ sees in «События», prices medicine | done |
| Placement (first one opens the batch), crop fill | ✔ | ✔ chick price | done |
| Weighing (individual → CV%, group) | ✔ | ✔ | done |
| Catch plan with withdrawal block, handover | ✔ override needs a reason | ✔ sees override at once; price per kg, payments | done |
| Money: prices, costs, payments, profit per kg | ✗ never (server-enforced) | ✔ | done |
| Event feed (instead of approvals) | — | ✔ «События», panel on «Ферма» | done |
| Norm check of each saved daily log (mortality, week 1, temperature vs. age and humidity, water:feed, humidity) | ✔ offline | ✔ | done |
| «Справочник»: 90 handbook articles + today's norms per house, search | ✔ offline | ✔ | done |
| Farm norms (Arbor Acres by default) | read | ✔ edit / reset to AA | done |
| «Помощник»: questions answered by Claude from the handbook, with sources | ✔ online, 30/day | ✔ sees all questions | done (needs API key) |
| Reminders engine (notifications are in-app only, no Telegram) | | | Phase 2 |
| Batch report and close/lock, export | | | Phase 3 |
| Real-phone test (T-02), Supabase project, hosting | | | **needs you** — see below and `docs/PHASE1-PHONE-TEST.md` |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — demo mode if no Supabase keys
```

**Demo mode** (no `.env`): data lives only in that browser. The sign-in screen offers three demo accounts: head, Айгуль (П-1, П-2), Нурлан (П-3, П-4). The batch is always on day 23.

## Tests

```bash
npm run typecheck
npm test             # core rules, money, sync engine (Vitest)
npm run test:db      # schema, RLS, money invisible to workers, withdrawal block… on a throwaway Postgres 16 (or DATABASE_URL)
npm run test:e2e     # browser tests on a production build: offline save → reload → sync once, 48 h rule…
```

## Connect a real server (Supabase)

1. Create a Supabase project (choose the region closest to Kyrgyzstan; check plan, backups and price — see spec §8).
2. Authentication → Providers → Email: **disable "Confirm email"**; check the minimum password length allows 6 characters (PINs are 6 digits).
3. Run `supabase/migrations/*.sql` in the SQL editor (or `supabase db push`).
4. Create the head user (Authentication → Users → Add user) with email `p<phone digits>@phone.farm.local` (e.g. `p996700000001@phone.farm.local`) and a 6-digit PIN as password, then run `supabase/bootstrap.sql` with your values.
5. Deploy the functions: `supabase functions deploy invite-worker` and `supabase functions deploy ask`.
   For «Помощник» add the secret `ANTHROPIC_API_KEY` (Edge Functions → Secrets). Optional: `ASSISTANT_MODEL` (default `claude-opus-5-5`), `ASSISTANT_DAILY_LIMIT` (default 30 per person).
   Or run everything at once with `scripts/supabase-setup.mjs` (see its header).
6. The first worker who records a placement («Ещё → Посадка») opens the batch.
7. `apps/web/.env.local`: `VITE_SUPABASE_URL=…` and `VITE_SUPABASE_ANON_KEY=…`, then `npm run build -w apps/web` and host `apps/web/dist` on any static HTTPS host (Cloudflare Pages, Netlify, Vercel).

## Knowledge

One source, two outputs. Edit `packages/core/src/norms/aa-norms.json` (norm numbers) or `docs/knowledge/*.md` (handbook), then run `npm run gen:knowledge`: it regenerates the database seed (`supabase/migrations/20261127000003_knowledge_seed.sql`) and the demo copy (`apps/web/src/api/knowledge.generated.json`). CI fails if they are out of date.

- Phones cache the norms and the handbook (IndexedDB), so checks and «Справочник» work with no signal.
- The director's changes to norms are stored per farm (`norm` rows with `farm_id`) and override Arbor Acres on every phone after sync.
- «Помощник» (`supabase/functions/ask`): full-text search picks the 6 best articles; Claude answers in Russian from them and the farm's norms, citing [n]. Server-side refusal fallback is on (`fallbacks: "default"`). Every question is logged in `assistant_question` (the director can read them). Rough cost: about 5–8 US cents per question with the default model; set `ASSISTANT_MODEL` to a cheaper model to lower it.

## Layout

```
apps/web          PWA: screens, offline storage (Dexie), sync engine, demo + Supabase backends
packages/core     shared rules: production day, day of age, water litres, plausibility, 48 h window
supabase/         migrations (schema + RLS + triggers + knowledge), invite-worker and ask functions, DB tests
docs/             plan, spec, designs, knowledge base
```

## Decisions worth knowing

- **Production day** runs 08:00 → 08:00 in `Asia/Bishkek` (both are farm settings) — still an open question in the plan.
- **One log per house per day.** If two phones save the same day, the later save wins and the earlier version stays in `edit_history`.
- **Workers can fill a missed day up to 2 days back** and edit their own log for 48 h; after that only the head, with a reason.
- **Water litres are computed on the server** from the previous meter reading; a lower reading must be marked "новый счётчик".
- **Sign-in:** the head sets the worker's first PIN (the spec said the worker sets it — simpler for the pilot; PIN change by the worker comes later).
- **Styling:** plain CSS with the design tokens instead of Tailwind (fewer moving parts; same tokens).
