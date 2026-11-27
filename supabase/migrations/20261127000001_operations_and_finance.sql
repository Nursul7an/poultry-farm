-- Role model v2.1 (docs/BLUEPRINT.md §0.2, spec FR-3, FR-12, FR-13, FR-15–FR-17, FR-23):
-- workers record every operation of their own houses; the director (role 'head') sees everything,
-- can correct anything, and alone owns money. Nothing waits for approval.
--
-- Operational tables (worker + director): feed_delivery, health_event, weighing, handover,
--   plus placement / catch plan / feed phase on house_batch through RPCs.
-- Finance tables (director only, FR-23): price, cost, payment.

-- ---------------------------------------------------------------- house_batch: placement, phase, catch plan

alter table public.house_batch
  add column hatchery text,
  add column cloacal_t numeric(4, 1),
  add column crop_fill jsonb not null default '{}'::jsonb,      -- {"2": 78, "4": 83, "24": 96, ...} percent by hour
  add column feed_phase text not null default 'starter' check (feed_phase in ('starter', 'grower', 'finisher')),
  add column feed_phase_since date,
  add column catch_at timestamptz,
  add column feed_off_at timestamptz,
  add column catch_override_reason text,
  add column created_by uuid references public.app_user (id),
  add column created_at timestamptz not null default now();

-- ---------------------------------------------------------------- operational tables

create table public.feed_delivery (
  id uuid primary key,                                        -- client UUID: idempotent offline sync
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  delivered_on date not null,
  feed_type text not null check (feed_type in ('starter', 'grower', 'finisher')),
  tonnes numeric(7, 2) not null check (tonnes > 0),
  note text,
  edit_reason text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.health_event (
  id uuid primary key,
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  kind text not null check (kind in ('vaccination', 'treatment', 'post_mortem')),
  event_on date not null,
  product text,
  dose text,
  lot text,
  method text,
  course_days int check (course_days between 1 and 60),
  withdrawal_days int check (withdrawal_days between 0 and 120),
  birds_examined int check (birds_examined >= 0),
  findings text,
  -- earliest slaughter = last dose (start + course − 1) + withdrawal + 1 day
  earliest_slaughter date generated always as (
    case when kind = 'treatment' then event_on + coalesce(course_days, 1) + coalesce(withdrawal_days, 0) end
  ) stored,
  note text,
  edit_reason text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'treatment' or (product is not null and course_days is not null and withdrawal_days is not null)),
  check (kind <> 'vaccination' or product is not null)
);

create table public.weighing (
  id uuid primary key,
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  weighed_on date not null,
  method text not null check (method in ('individual', 'group')),
  samples_g numeric[] not null default '{}',                  -- individual weights, grams
  group_total_g numeric,                                      -- group weighing: total of all crates …
  group_birds int,                                            -- … and number of birds in them
  n int,
  mean_g numeric(7, 1),
  sd_g numeric(7, 1),
  cv numeric(5, 2),
  edit_reason text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method <> 'group' or (group_total_g > 0 and group_birds > 0))
);

create table public.handover (
  id uuid primary key,
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  handed_on date not null,
  buyer text not null,
  birds int not null check (birds > 0),
  kg numeric(10, 1) not null check (kg > 0),
  transport_dead int not null default 0 check (transport_dead >= 0),
  note text,
  edit_reason text,
  created_by uuid references public.app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- finance tables (director only)

create table public.price (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null default public.current_farm_id() references public.farm (id),
  kind text not null check (kind in ('chick', 'feed', 'medicine', 'sale')),
  ref_id uuid not null,               -- chick → batch.id, feed → feed_delivery.id, medicine → health_event.id, sale → handover.id
  unit_price numeric(14, 2) not null check (unit_price >= 0),  -- chick: per bird; feed: per tonne; medicine: per course; sale: per kg
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  unique (kind, ref_id)
);

create table public.cost (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null default public.current_farm_id() references public.farm (id),
  batch_id uuid not null references public.batch (id) on delete cascade,
  category text not null check (category in ('energy', 'wages', 'litter', 'vet', 'transport', 'other')),
  amount numeric(14, 2) not null check (amount >= 0),
  spent_on date not null default current_date,
  comment text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payment (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null default public.current_farm_id() references public.farm (id),
  handover_id uuid not null references public.handover (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  comment text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- shared write rules for operational tables

/** Same rules as daily_log: closed batch is read-only; worker edits ≤ 48 h; director edits older records with a reason. */
create or replace function public.operation_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select b.status into v_status from public.house_batch hb join public.batch b on b.id = hb.batch_id where hb.id = new.house_batch_id;
  if v_status = 'closed' then raise exception 'BATCH_CLOSED'; end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.house_batch_id <> old.house_batch_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'IMMUTABLE_FIELDS';
    end if;
    if now() - old.created_at > interval '48 hours' then
      if not public.is_head() then raise exception 'EDIT_WINDOW'; end if;
      if coalesce(trim(new.edit_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.operation_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.edit_history (entity, entity_id, user_id, old, new, reason)
  values (tg_table_name, new.id, auth.uid(), to_jsonb(old), to_jsonb(new), new.edit_reason);
  return new;
end $$;

/** Weighing statistics are computed on the server from the samples (n, mean, SD, CV%). */
create or replace function public.weighing_stats() returns trigger
language plpgsql as $$
begin
  if new.method = 'individual' then
    select count(*), avg(x), stddev_samp(x) into new.n, new.mean_g, new.sd_g from unnest(new.samples_g) as x;
    new.cv := case when new.mean_g > 0 and new.sd_g is not null then round(new.sd_g / new.mean_g * 100, 2) end;
  else
    new.n := new.group_birds;
    new.mean_g := round(new.group_total_g / new.group_birds, 1);
    new.sd_g := null; new.cv := null;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['feed_delivery', 'health_event', 'weighing', 'handover'] loop
    execute format('create trigger %1$s_before_write before insert or update on public.%1$s for each row execute function public.operation_before_write()', t);
    execute format('create trigger %1$s_history after update on public.%1$s for each row when (old.* is distinct from new.*) execute function public.operation_history()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('create policy %1$s_read on public.%1$s for select using (public.can_access_house_batch(house_batch_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (public.can_access_house_batch(house_batch_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update using (public.can_access_house_batch(house_batch_id))', t);
    execute format('create policy %1$s_head_delete on public.%1$s for delete using (public.is_head() and public.can_access_house_batch(house_batch_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
end $$;

create trigger weighing_stats before insert or update on public.weighing for each row execute function public.weighing_stats();

-- Finance: director only (FR-23). A worker gets zero rows and cannot write.
do $$
declare t text;
begin
  foreach t in array array['price', 'cost', 'payment'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('create policy %1$s_head_all on public.%1$s for all using (farm_id = public.current_farm_id() and public.is_head()) with check (farm_id = public.current_farm_id() and public.is_head())', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
    execute format('revoke all on public.%s from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RPCs that change house_batch (workers can't update it directly)

create or replace function public.can_access_house(p_house uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.house h where h.id = p_house and h.farm_id = public.current_farm_id()
                 and (public.is_head() or h.id in (select public.my_house_ids())))
$$;

/**
 * Placement of chicks in a house (FR-3). The first placement opens the batch if none is open.
 * Idempotent: same id → update; a placement already recorded for this house in the open batch → update that one.
 */
create or replace function public.record_placement(p jsonb) returns public.house_batch
language plpgsql security definer set search_path = public as $$
declare
  v_house uuid := (p->>'house_id')::uuid;
  v_farm uuid := public.current_farm_id();
  v_batch uuid;
  v_row public.house_batch;
  v_existing public.house_batch;
begin
  if not public.can_access_house(v_house) then raise exception 'FORBIDDEN'; end if;
  select id into v_batch from public.batch where farm_id = v_farm and status <> 'closed';
  if v_batch is null then
    insert into public.batch (farm_id, name) values (v_farm, to_char((p->>'placed_on')::date, 'MM/YYYY')) returning id into v_batch;
  end if;
  select * into v_existing from public.house_batch where id = (p->>'id')::uuid or (batch_id = v_batch and house_id = v_house) limit 1;
  if v_existing.id is not null and now() - v_existing.created_at > interval '48 hours' and not public.is_head() then
    raise exception 'EDIT_WINDOW';
  end if;
  if v_existing.id is null then
    insert into public.house_batch (id, batch_id, house_id, placed_on, hatchery, waybill_count, transport_dead, placed,
                                    parent_age_weeks, day0_weight_g, cloacal_t, crop_fill, feed_phase_since, created_by)
    values (coalesce((p->>'id')::uuid, gen_random_uuid()), v_batch, v_house, (p->>'placed_on')::date, p->>'hatchery',
            (p->>'waybill_count')::int, coalesce((p->>'transport_dead')::int, 0), (p->>'placed')::int,
            (p->>'parent_age_weeks')::int, (p->>'day0_weight_g')::numeric, (p->>'cloacal_t')::numeric,
            coalesce(p->'crop_fill', '{}'::jsonb), (p->>'placed_on')::date, auth.uid())
    returning * into v_row;
  else
    insert into public.edit_history (entity, entity_id, user_id, old, new, reason)
    values ('placement', v_existing.id, auth.uid(), to_jsonb(v_existing), p, p->>'edit_reason');
    update public.house_batch set placed_on = (p->>'placed_on')::date, hatchery = p->>'hatchery',
      waybill_count = (p->>'waybill_count')::int, transport_dead = coalesce((p->>'transport_dead')::int, 0),
      placed = (p->>'placed')::int, parent_age_weeks = (p->>'parent_age_weeks')::int,
      day0_weight_g = (p->>'day0_weight_g')::numeric, cloacal_t = (p->>'cloacal_t')::numeric,
      crop_fill = coalesce(p->'crop_fill', crop_fill)
    where id = v_existing.id returning * into v_row;
  end if;
  return v_row;
end $$;

/** Feed phase change (старт → рост → финиш), recorded by the house's worker or the director. */
create or replace function public.set_feed_phase(p_house_batch uuid, p_phase text, p_since date) returns public.house_batch
language plpgsql security definer set search_path = public as $$
declare v_row public.house_batch;
begin
  if not public.can_access_house_batch(p_house_batch) then raise exception 'FORBIDDEN'; end if;
  update public.house_batch set feed_phase = p_phase, feed_phase_since = p_since where id = p_house_batch returning * into v_row;
  return v_row;
end $$;

/**
 * Catch plan (FR-13). A catch before the end of a treatment's withdrawal period is refused unless a reason is
 * given; with a reason it is saved and logged as a 'catch_override' event the director sees at once. No approval.
 */
create or replace function public.set_catch_plan(p_house_batch uuid, p_catch_at timestamptz, p_feed_off_at timestamptz, p_reason text)
returns public.house_batch
language plpgsql security definer set search_path = public as $$
declare
  v_row public.house_batch;
  v_earliest date;
  v_tz text;
begin
  if not public.can_access_house_batch(p_house_batch) then raise exception 'FORBIDDEN'; end if;
  select f.tz into v_tz from public.house_batch hb join public.house h on h.id = hb.house_id join public.farm f on f.id = h.farm_id where hb.id = p_house_batch;
  select max(earliest_slaughter) into v_earliest from public.health_event where house_batch_id = p_house_batch and kind = 'treatment';
  if v_earliest is not null and (p_catch_at at time zone v_tz)::date < v_earliest then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'WITHDRAWAL' using detail = v_earliest::text, hint = 'Срок ожидания: убой не ранее ' || to_char(v_earliest, 'DD.MM');
    end if;
    insert into public.edit_history (entity, entity_id, user_id, old, new, reason)
    values ('catch_override', p_house_batch, auth.uid(), jsonb_build_object('earliest_slaughter', v_earliest),
            jsonb_build_object('catch_at', p_catch_at), p_reason);
  end if;
  update public.house_batch set catch_at = p_catch_at, feed_off_at = p_feed_off_at,
    catch_override_reason = case when v_earliest is not null and (p_catch_at at time zone v_tz)::date < v_earliest then p_reason end
  where id = p_house_batch returning * into v_row;
  return v_row;
end $$;

grant execute on function public.record_placement(jsonb), public.set_feed_phase(uuid, text, date),
  public.set_catch_plan(uuid, timestamptz, timestamptz, text), public.can_access_house(uuid) to authenticated;

-- ---------------------------------------------------------------- event feed (director: everything; worker: own houses)

create view public.farm_event with (security_invoker = true) as
select l.updated_at as at, l.house_batch_id, 'log'::text as kind, l.id as ref_id, coalesce(l.updated_by, l.created_by) as user_id,
       jsonb_build_object('day', l.production_day, 'deaths', l.deaths, 'culls', l.culls, 'feed_kg', l.feed_kg, 'water_l', l.water_l) as data
from public.daily_log l
union all
select f.created_at, f.house_batch_id, 'feed', f.id, f.created_by,
       jsonb_build_object('feed_type', f.feed_type, 'tonnes', f.tonnes, 'on', f.delivered_on)
from public.feed_delivery f
union all
select e.created_at, e.house_batch_id, 'health_' || e.kind, e.id, e.created_by,
       jsonb_build_object('product', e.product, 'course_days', e.course_days, 'withdrawal_days', e.withdrawal_days,
                          'earliest_slaughter', e.earliest_slaughter, 'findings', e.findings, 'on', e.event_on)
from public.health_event e
union all
select w.created_at, w.house_batch_id, 'weighing', w.id, w.created_by,
       jsonb_build_object('n', w.n, 'mean_g', w.mean_g, 'cv', w.cv, 'on', w.weighed_on)
from public.weighing w
union all
select h.created_at, h.house_batch_id, 'handover', h.id, h.created_by,
       jsonb_build_object('buyer', h.buyer, 'birds', h.birds, 'kg', h.kg, 'on', h.handed_on)
from public.handover h
union all
select hb.created_at, hb.id, 'placement', hb.id, hb.created_by,
       jsonb_build_object('placed', hb.placed, 'transport_dead', hb.transport_dead, 'on', hb.placed_on)
from public.house_batch hb
union all
select x.at, x.entity_id, 'catch_override', x.entity_id, x.user_id, x.new || x.old || jsonb_build_object('reason', x.reason)
from public.edit_history x where x.entity = 'catch_override' and public.is_head();

grant select on public.farm_event to authenticated;
