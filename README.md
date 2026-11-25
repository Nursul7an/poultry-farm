# Птичник — broiler farm app

An offline-capable app for a 4-house broiler farm. House workers log each house's day on their own Android phones (even with no signal); the head sees all houses and later gets warnings, batch results and profit.

- Product plan: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)
- Technical spec and tickets: [`docs/tz-broiler-farm-app.md`](docs/tz-broiler-farm-app.md)
- Screen designs: [`docs/design/`](docs/design/)
- Domain knowledge (Arbor Acres norms): [`docs/knowledge/`](docs/knowledge/)

## Status: Phase 1 — offline daily log

| Ticket | What | State |
|---|---|---|
| T-01 | PWA skeleton (React + TS + Vite), design tokens, CI | done |
| T-02 | **Spike on the workers' real phones** | **needs you** → [`docs/PHASE1-PHONE-TEST.md`](docs/PHASE1-PHONE-TEST.md) |
| T-03 | Supabase project and secrets | **needs you** (see below) |
| T-04 | Schema v1 (farm, users, houses, batch, house_batch, daily_log, edit_history) | done, tested |
| T-05 | Row Level Security: worker = own houses, head = farm | done, tested |
| T-06 | Sign-in by phone + 6-digit PIN; head adds workers | done (invite function untested: needs Supabase) |
| T-07 | Settings: houses, worker ↔ house assignment | done |
| T-08 | On-device storage (IndexedDB), drafts, outbox | done, tested |
| T-09 | Sync engine (idempotent upsert, retry, "не принято" queue) | done, tested |
| T-10 | Worker «Сегодня» | done |
| T-11 | Worker «Журнал дня»: steppers, bags → kg, water meter, new meter, "Это верно?" check | done |
| T-12 | Server rules: production day, 48 h edit window, edit history, water litres | done, tested |
| T-13 | Head farm table (phone + laptop) | done |
| T-14 | Offline E2E tests | done |

Not in Phase 1 (by plan): norm warnings, Telegram, weighing, reminders (Phase 2); batch opening, feed, costs, treatments, catch, sales, report (Phase 3). Until Phase 3 the batch and placement are created in SQL (see below).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 — demo mode if no Supabase keys
```

**Demo mode** (no `.env`): data lives only in that browser. The sign-in screen offers three demo accounts: head, Айгуль (П-1, П-2), Нурлан (П-3, П-4). The batch is always on day 23.

## Tests

```bash
npm run typecheck
npm test             # core rules + sync engine (Vitest)
npm run test:db      # schema, RLS, edit window on a throwaway local Postgres 16 (or DATABASE_URL)
npm run test:e2e     # browser tests on a production build: offline save → reload → sync once, 48 h rule…
```

## Connect a real server (Supabase)

1. Create a Supabase project (choose the region closest to Kyrgyzstan; check plan, backups and price — see spec §8).
2. Authentication → Providers → Email: **disable "Confirm email"**; check the minimum password length allows 6 characters (PINs are 6 digits).
3. Run `supabase/migrations/*.sql` in the SQL editor (or `supabase db push`).
4. Create the head user (Authentication → Users → Add user) with email `p<phone digits>@phone.farm.local` (e.g. `p996700000001@phone.farm.local`) and a 6-digit PIN as password, then run `supabase/bootstrap.sql` with your values.
5. Deploy the invite function: `supabase functions deploy invite-worker`.
6. Until Phase 3, open a batch in SQL:
   ```sql
   insert into batch (farm_id, name) select id, '06/2026' from farm;
   insert into house_batch (batch_id, house_id, placed_on, placed)
   select b.id, h.id, '2026-11-01', 17000 from batch b, house h where b.status = 'open';
   ```
7. `apps/web/.env.local`: `VITE_SUPABASE_URL=…` and `VITE_SUPABASE_ANON_KEY=…`, then `npm run build -w apps/web` and host `apps/web/dist` on any static HTTPS host (Cloudflare Pages, Netlify, Vercel).

## Layout

```
apps/web          PWA: screens, offline storage (Dexie), sync engine, demo + Supabase backends
packages/core     shared rules: production day, day of age, water litres, plausibility, 48 h window
supabase/         migrations (schema + RLS + triggers), invite-worker function, DB tests
docs/             plan, spec, designs, knowledge base
```

## Decisions worth knowing

- **Production day** runs 08:00 → 08:00 in `Asia/Bishkek` (both are farm settings) — still an open question in the plan.
- **One log per house per day.** If two phones save the same day, the later save wins and the earlier version stays in `edit_history`.
- **Workers can fill a missed day up to 2 days back** and edit their own log for 48 h; after that only the head, with a reason.
- **Water litres are computed on the server** from the previous meter reading; a lower reading must be marked "новый счётчик".
- **Sign-in:** the head sets the worker's first PIN (the spec said the worker sets it — simpler for the pilot; PIN change by the worker comes later).
- **Styling:** plain CSS with the design tokens instead of Tailwind (fewer moving parts; same tokens).
