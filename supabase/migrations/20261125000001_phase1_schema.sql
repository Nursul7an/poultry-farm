-- Phase 1 schema: farm, people, houses, batches, daily logs, edit history.
-- Spec: docs/tz-broiler-farm-app.md (FR-1..FR-6, NFR Security/Reliability).
-- Access is enforced by Row Level Security: a worker sees only assigned houses; the head sees the whole farm.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.farm (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tz text not null default 'Asia/Bishkek',
  day_start_hour int not null default 8 check (day_start_hour between 0 and 23),
  currency text not null default 'KGS',
  created_at timestamptz not null default now()
);

create table public.app_user (
  id uuid primary key references auth.users (id) on delete cascade,
  farm_id uuid not null references public.farm (id),
  role text not null check (role in ('head', 'worker')),
  display_name text not null,
  phone text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.house (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farm (id),
  name text not null,
  area_m2 numeric(8, 1) not null check (area_m2 > 0),
  has_water_meter boolean not null default true,
  drinker_type text,
  feeder_type text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (farm_id, name)
);

create table public.house_worker (
  house_id uuid not null references public.house (id) on delete cascade,
  user_id uuid not null references public.app_user (id) on delete cascade,
  primary key (house_id, user_id)
);

create table public.batch (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farm (id),
  name text not null,
  breed text not null default 'Arbor Acres',
  status text not null default 'open' check (status in ('open', 'catching', 'closed')),
  chick_price numeric(12, 2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
-- FR-3 AC-3.4: only one batch that is not closed per farm.
create unique index one_active_batch_per_farm on public.batch (farm_id) where status <> 'closed';

create table public.house_batch (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batch (id) on delete cascade,
  house_id uuid not null references public.house (id),
  placed_on date not null,
  waybill_count int check (waybill_count >= 0),
  transport_dead int not null default 0 check (transport_dead >= 0),
  placed int not null check (placed > 0),
  parent_age_weeks int,
  day0_weight_g numeric(5, 1),
  unique (batch_id, house_id)
);

create table public.daily_log (
  id uuid primary key,                       -- generated on the device: makes sync idempotent
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  production_day date not null,
  deaths int not null default 0 check (deaths >= 0),
  culls int not null default 0 check (culls >= 0),
  cull_reason text check (cull_reason in ('legs', 'runt', 'injury', 'ascites', 'other')),
  feed_kg numeric(9, 1) check (feed_kg >= 0),
  water_meter numeric(12, 3) check (water_meter >= 0),
  new_meter boolean not null default false,
  water_l int,                               -- computed by trigger from the previous reading
  t_min numeric(4, 1),
  t_max numeric(4, 1),
  rh numeric(4, 1) check (rh between 0 and 100),
  note text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.app_user (id),
  updated_at timestamptz not null default now(),
  edit_reason text,
  unique (house_batch_id, production_day),
  check (culls = 0 or cull_reason is not null)
);

create table public.edit_history (
  id bigserial primary key,
  entity text not null,
  entity_id uuid not null,
  user_id uuid,
  at timestamptz not null default now(),
  old jsonb,
  new jsonb,
  reason text
);
create index on public.edit_history (entity, entity_id);

-- ---------------------------------------------------------------- helpers (security definer: read profile without recursion)

create or replace function public.current_farm_id() returns uuid
language sql stable security definer set search_path = public as $$
  select farm_id from public.app_user where id = auth.uid() and active
$$;

create or replace function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user where id = auth.uid() and active and role = 'head')
$$;

create or replace function public.my_house_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select hw.house_id from public.house_worker hw
  join public.app_user u on u.id = hw.user_id and u.active
  where hw.user_id = auth.uid()
$$;

create or replace function public.can_access_house_batch(hb uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.house_batch x
    join public.house h on h.id = x.house_id
    where x.id = hb
      and h.farm_id = public.current_farm_id()
      and (public.is_head() or h.id in (select public.my_house_ids()))
  )
$$;

/** Current production day in the farm's time zone (day starts at farm.day_start_hour). */
create or replace function public.current_production_day(p_farm uuid) returns date
language sql stable set search_path = public as $$
  select ((now() at time zone f.tz) - make_interval(hours => f.day_start_hour))::date
  from public.farm f where f.id = p_farm
$$;

-- ---------------------------------------------------------------- daily_log rules (FR-4, FR-6)

create or replace function public.daily_log_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_farm uuid;
  v_today date;
  v_prev numeric;
  v_head boolean := public.is_head();
begin
  select b.status, h.farm_id into v_status, v_farm
  from public.house_batch hb join public.batch b on b.id = hb.batch_id join public.house h on h.id = hb.house_id
  where hb.id = new.house_batch_id;

  if v_status = 'closed' then
    raise exception 'BATCH_CLOSED' using hint = 'Партия закрыта — сообщите директору';
  end if;

  if tg_op = 'INSERT' then
    v_today := public.current_production_day(v_farm);
    if new.production_day > v_today then
      raise exception 'DAY_IN_FUTURE';
    end if;
    -- A worker may fill a forgotten day, but not older than 2 production days back.
    if not v_head and new.production_day < v_today - 2 then
      raise exception 'DAY_TOO_OLD' using hint = 'Старые дни заполняет директор';
    end if;
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.house_batch_id <> old.house_batch_id or new.production_day <> old.production_day
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'IMMUTABLE_FIELDS';
    end if;
    if now() - old.created_at > interval '48 hours' then
      if not v_head then
        raise exception 'EDIT_WINDOW' using hint = 'Прошло больше 48 часов — исправить может только директор';
      end if;
      if coalesce(trim(new.edit_reason), '') = '' then
        raise exception 'REASON_REQUIRED';
      end if;
    end if;
  end if;

  -- Water litres from the previous reading of the same house_batch.
  if new.water_meter is null or new.new_meter then
    new.water_l := null;
  else
    select l.water_meter into v_prev from public.daily_log l
    where l.house_batch_id = new.house_batch_id and l.production_day < new.production_day and l.water_meter is not null
    order by l.production_day desc limit 1;
    if v_prev is null then
      new.water_l := null;
    elsif new.water_meter < v_prev then
      raise exception 'METER_BACKWARDS' using hint = 'Показание меньше прошлого — отметьте «новый счётчик»';
    else
      new.water_l := round((new.water_meter - v_prev) * 1000);
    end if;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger daily_log_before_write before insert or update on public.daily_log
for each row execute function public.daily_log_before_write();

create or replace function public.daily_log_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.edit_history (entity, entity_id, user_id, old, new, reason)
  values ('daily_log', new.id, auth.uid(), to_jsonb(old), to_jsonb(new), new.edit_reason);
  return new;
end $$;

create trigger daily_log_history after update on public.daily_log
for each row when (old.* is distinct from new.*) execute function public.daily_log_history();

/**
 * Idempotent save used by the sync engine.
 * - same id → update
 * - other device already saved this house+day → update that row (last write wins, earlier version kept in edit_history)
 * - otherwise insert
 * Runs as the caller, so RLS and triggers apply. Returns the stored row (its id may differ from the one sent).
 */
create or replace function public.upsert_daily_log(p jsonb) returns public.daily_log
language plpgsql security invoker set search_path = public as $$
declare
  v_row public.daily_log;
  v_id uuid := (p->>'id')::uuid;
  v_hb uuid := (p->>'house_batch_id')::uuid;
  v_day date := (p->>'production_day')::date;
  v_existing uuid;
begin
  if not public.can_access_house_batch(v_hb) then
    raise exception 'FORBIDDEN';
  end if;

  select id into v_existing from public.daily_log where id = v_id;
  if v_existing is null then
    select id into v_existing from public.daily_log where house_batch_id = v_hb and production_day = v_day;
  end if;

  if v_existing is null then
    insert into public.daily_log (id, house_batch_id, production_day, deaths, culls, cull_reason, feed_kg,
                                  water_meter, new_meter, t_min, t_max, rh, note, edit_reason)
    values (v_id, v_hb, v_day, coalesce((p->>'deaths')::int, 0), coalesce((p->>'culls')::int, 0), p->>'cull_reason',
            (p->>'feed_kg')::numeric, (p->>'water_meter')::numeric, coalesce((p->>'new_meter')::boolean, false),
            (p->>'t_min')::numeric, (p->>'t_max')::numeric, (p->>'rh')::numeric, p->>'note', p->>'edit_reason')
    returning * into v_row;
  else
    update public.daily_log set
      deaths = coalesce((p->>'deaths')::int, 0), culls = coalesce((p->>'culls')::int, 0), cull_reason = p->>'cull_reason',
      feed_kg = (p->>'feed_kg')::numeric, water_meter = (p->>'water_meter')::numeric,
      new_meter = coalesce((p->>'new_meter')::boolean, false),
      t_min = (p->>'t_min')::numeric, t_max = (p->>'t_max')::numeric, rh = (p->>'rh')::numeric,
      note = p->>'note', edit_reason = p->>'edit_reason'
    where id = v_existing
    returning * into v_row;
    if v_row.id is null then
      raise exception 'FORBIDDEN';   -- RLS hid the row from this user
    end if;
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- head overview (FR-22, T-13)

create view public.house_today with (security_invoker = true) as
select
  hb.id as house_batch_id,
  h.id as house_id,
  h.name as house_name,
  h.area_m2,
  hb.batch_id,
  hb.placed_on,
  hb.placed,
  public.current_production_day(h.farm_id) as today,
  public.current_production_day(h.farm_id) - hb.placed_on as day_of_age,
  (hb.placed - coalesce((select sum(l.deaths + l.culls) from public.daily_log l where l.house_batch_id = hb.id), 0))::int as live_birds,
  t.id as today_log_id, t.deaths as today_deaths, t.culls as today_culls, t.feed_kg as today_feed_kg,
  t.water_l as today_water_l, t.t_min as today_t_min, t.t_max as today_t_max, t.rh as today_rh, t.updated_at as today_logged_at,
  y.deaths as yesterday_deaths, y.culls as yesterday_culls,
  (select string_agg(u.display_name, ', ' order by u.display_name) from public.house_worker hw join public.app_user u on u.id = hw.user_id where hw.house_id = h.id) as workers
from public.house_batch hb
join public.batch b on b.id = hb.batch_id and b.status <> 'closed'
join public.house h on h.id = hb.house_id
left join public.daily_log t on t.house_batch_id = hb.id and t.production_day = public.current_production_day(h.farm_id)
left join public.daily_log y on y.house_batch_id = hb.id and y.production_day = public.current_production_day(h.farm_id) - 1;

-- ---------------------------------------------------------------- RLS

alter table public.farm enable row level security;
alter table public.app_user enable row level security;
alter table public.house enable row level security;
alter table public.house_worker enable row level security;
alter table public.batch enable row level security;
alter table public.house_batch enable row level security;
alter table public.daily_log enable row level security;
alter table public.edit_history enable row level security;

create policy farm_read on public.farm for select using (id = public.current_farm_id());
create policy farm_head_update on public.farm for update using (id = public.current_farm_id() and public.is_head());

create policy user_read on public.app_user for select using (farm_id = public.current_farm_id());
create policy user_head_write on public.app_user for update using (farm_id = public.current_farm_id() and public.is_head());

create policy house_read on public.house for select using (
  farm_id = public.current_farm_id() and (public.is_head() or id in (select public.my_house_ids())));
create policy house_head_insert on public.house for insert with check (farm_id = public.current_farm_id() and public.is_head());
create policy house_head_update on public.house for update using (farm_id = public.current_farm_id() and public.is_head());

create policy hw_read on public.house_worker for select using (
  user_id = auth.uid() or (public.is_head() and house_id in (select id from public.house where farm_id = public.current_farm_id())));
create policy hw_head_insert on public.house_worker for insert with check (
  public.is_head() and house_id in (select id from public.house where farm_id = public.current_farm_id()));
create policy hw_head_delete on public.house_worker for delete using (
  public.is_head() and house_id in (select id from public.house where farm_id = public.current_farm_id()));

create policy batch_read on public.batch for select using (farm_id = public.current_farm_id());
create policy batch_head_insert on public.batch for insert with check (farm_id = public.current_farm_id() and public.is_head());
create policy batch_head_update on public.batch for update using (farm_id = public.current_farm_id() and public.is_head());

create policy hb_read on public.house_batch for select using (public.can_access_house_batch(id));
create policy hb_head_insert on public.house_batch for insert with check (
  public.is_head() and house_id in (select id from public.house where farm_id = public.current_farm_id()));
create policy hb_head_update on public.house_batch for update using (public.is_head() and public.can_access_house_batch(id));

create policy log_read on public.daily_log for select using (public.can_access_house_batch(house_batch_id));
create policy log_insert on public.daily_log for insert with check (public.can_access_house_batch(house_batch_id));
create policy log_update on public.daily_log for update using (public.can_access_house_batch(house_batch_id));
create policy log_head_delete on public.daily_log for delete using (public.is_head() and public.can_access_house_batch(house_batch_id));

create policy history_head_read on public.edit_history for select using (public.is_head());

-- ---------------------------------------------------------------- grants (Supabase roles)

grant usage on schema public to authenticated;
grant select on public.farm, public.app_user, public.house, public.house_worker, public.batch,
  public.house_batch, public.daily_log, public.edit_history, public.house_today to authenticated;
grant update on public.farm, public.app_user, public.house, public.batch, public.house_batch, public.daily_log to authenticated;
grant insert on public.house, public.house_worker, public.batch, public.house_batch, public.daily_log to authenticated;
grant delete on public.house_worker, public.daily_log to authenticated;
grant execute on function public.upsert_daily_log(jsonb), public.current_production_day(uuid),
  public.is_head(), public.current_farm_id() to authenticated;
revoke all on public.farm, public.app_user, public.house, public.house_worker, public.batch,
  public.house_batch, public.daily_log, public.edit_history from anon;
