-- v3: the farm is divided into blocks (кашары). Each block runs its own cycle, so a batch belongs to ONE block
-- and gets an automatic number <block code>-<year>-<seq> (e.g. B-2026-07). Spec: docs/BLUEPRINT-blocks.md.
-- `house` keeps its table name; in the app a house is called «Блок».

-- ---------------------------------------------------------------- block code (the letter in batch numbers)
create or replace function public.block_code(p_name text) returns text
language sql immutable as $$
  select coalesce(nullif(upper(regexp_replace(regexp_replace(p_name, '^\s*(блок|кашар|сарай|птичник)\s*', '', 'i'), '[^[:alnum:]]', '', 'g')), ''), 'X')
$$;
alter table public.house add column code text;
update public.house set code = public.block_code(name);
alter table public.house alter column code set not null;
create or replace function public.house_code_default() returns trigger language plpgsql as $$
begin
  if new.code is null or tg_op = 'UPDATE' and new.name is distinct from old.name and new.code = old.code then
    new.code := public.block_code(new.name);
  end if;
  return new;
end $$;
create trigger house_code_default before insert or update on public.house for each row execute function public.house_code_default();

-- ---------------------------------------------------------------- batch per block
alter table public.batch add column house_id uuid references public.house (id);
alter table public.batch add column seq int;
drop index public.one_active_batch_per_farm;

-- Costs: a cost belongs to a block's batch, or (batch_id null) is shared by the farm and split by chicks placed.
-- Costs booked on a farm-wide batch (several blocks) become shared costs.
alter table public.cost alter column batch_id drop not null;
update public.cost set batch_id = null
  where batch_id in (select batch_id from public.house_batch group by batch_id having count(*) > 1);

-- Split every farm-wide batch into one batch per block it was placed in (same status, dates, chick price).
do $$
declare
  r record;
  v_new uuid;
begin
  for r in
    select hb.id as hb_id, hb.house_id, b.*
    from public.house_batch hb join public.batch b on b.id = hb.batch_id join public.house h on h.id = hb.house_id
    order by b.opened_at, hb.placed_on, h.name desc
  loop
    if (select count(*) from public.house_batch where batch_id = r.id) = 1 then
      update public.batch set house_id = r.house_id where id = r.id;
    else
      insert into public.batch (farm_id, name, breed, status, chick_price, opened_at, closed_at, house_id)
      values (r.farm_id, r.name, r.breed, r.status, r.chick_price, r.opened_at, r.closed_at, r.house_id)
      returning id into v_new;
      update public.house_batch set batch_id = v_new where id = r.hb_id;
      insert into public.price (farm_id, kind, ref_id, unit_price, set_by, set_at)
        select farm_id, 'chick', v_new, unit_price, set_by, set_at from public.price where kind = 'chick' and ref_id = r.id;
    end if;
  end loop;
end $$;

update public.cost c set batch_id = null
  where batch_id is not null and not exists (select 1 from public.house_batch hb where hb.batch_id = c.batch_id);
-- Farm-wide batches left without blocks are removed (their chick prices were copied above).
delete from public.price p where p.kind = 'chick' and not exists (select 1 from public.house_batch hb where hb.batch_id = p.ref_id);
delete from public.batch b where b.house_id is null and not exists (select 1 from public.house_batch hb where hb.batch_id = b.id);

-- Numbers: per block and year, in order of placement.
update public.batch b set seq = x.seq, name = h.code || '-' || x.y || '-' || lpad(x.seq::text, 2, '0')
from (
  select b2.id, extract(year from hb.placed_on)::int as y,
         row_number() over (partition by b2.house_id, extract(year from hb.placed_on) order by hb.placed_on, b2.opened_at) as seq
  from public.batch b2 join public.house_batch hb on hb.batch_id = b2.id
) x, public.house h
where x.id = b.id and h.id = b.house_id;

alter table public.batch alter column house_id set not null;
create unique index one_open_batch_per_block on public.batch (house_id) where status <> 'closed';
create unique index batch_number_per_farm on public.batch (farm_id, name);

-- ---------------------------------------------------------------- placement = start a new batch in an empty block
create or replace function public.record_placement(p jsonb) returns public.house_batch
language plpgsql security definer set search_path = public as $$
declare
  v_house uuid := (p->>'house_id')::uuid;
  v_farm uuid := public.current_farm_id();
  v_on date := (p->>'placed_on')::date;
  v_batch uuid;
  v_row public.house_batch;
  v_existing public.house_batch;
  v_seq int;
  v_name text;
begin
  if not public.can_access_house(v_house) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.house where id = v_house and active) then raise exception 'BLOCK_INACTIVE'; end if;
  select hb.* into v_existing from public.house_batch hb where hb.id = (p->>'id')::uuid;
  if v_existing.id is null then
    -- A new batch: the block must be empty (one open batch per block).
    if exists (select 1 from public.batch where house_id = v_house and status <> 'closed') then raise exception 'BLOCK_BUSY'; end if;
    select coalesce(max(seq), 0) + 1 into v_seq from public.batch b
      join public.house_batch hb on hb.batch_id = b.id
      where b.house_id = v_house and extract(year from hb.placed_on) = extract(year from v_on);
    v_name := coalesce(nullif(trim(p->>'batch_number'), ''),
                       (select code from public.house where id = v_house) || '-' || extract(year from v_on)::int || '-' || lpad(v_seq::text, 2, '0'));
    if exists (select 1 from public.batch where farm_id = v_farm and name = v_name) then raise exception 'BATCH_NUMBER_TAKEN'; end if;
    insert into public.batch (farm_id, house_id, name, seq) values (v_farm, v_house, v_name, v_seq) returning id into v_batch;
    insert into public.house_batch (id, batch_id, house_id, placed_on, hatchery, waybill_count, transport_dead, placed,
                                    parent_age_weeks, day0_weight_g, cloacal_t, crop_fill, feed_phase_since, created_by)
    values (coalesce((p->>'id')::uuid, gen_random_uuid()), v_batch, v_house, v_on, p->>'hatchery',
            (p->>'waybill_count')::int, coalesce((p->>'transport_dead')::int, 0), (p->>'placed')::int,
            (p->>'parent_age_weeks')::int, (p->>'day0_weight_g')::numeric, (p->>'cloacal_t')::numeric,
            coalesce(p->'crop_fill', '{}'::jsonb), v_on, auth.uid())
    returning * into v_row;
  else
    if v_existing.house_id <> v_house then raise exception 'FORBIDDEN'; end if;
    if now() - v_existing.created_at > interval '48 hours' and not public.is_head() then raise exception 'EDIT_WINDOW'; end if;
    insert into public.edit_history (entity, entity_id, user_id, old, new, reason)
    values ('placement', v_existing.id, auth.uid(), to_jsonb(v_existing), p, p->>'edit_reason');
    update public.house_batch set placed_on = v_on, hatchery = p->>'hatchery',
      waybill_count = (p->>'waybill_count')::int, transport_dead = coalesce((p->>'transport_dead')::int, 0),
      placed = (p->>'placed')::int, parent_age_weeks = (p->>'parent_age_weeks')::int,
      day0_weight_g = (p->>'day0_weight_g')::numeric, cloacal_t = (p->>'cloacal_t')::numeric,
      crop_fill = coalesce(p->'crop_fill', crop_fill)
    where id = v_existing.id returning * into v_row;
    if nullif(trim(p->>'batch_number'), '') is not null then
      update public.batch set name = trim(p->>'batch_number') where id = v_row.batch_id and public.is_head();
    end if;
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------- close a batch (director): the block becomes empty
create or replace function public.close_batch(p_batch uuid) returns public.batch
language plpgsql security definer set search_path = public as $$
declare v_row public.batch;
begin
  if not public.is_head() then raise exception 'FORBIDDEN'; end if;
  update public.batch set status = 'closed', closed_at = now()
  where id = p_batch and farm_id = public.current_farm_id() and status <> 'closed'
  returning * into v_row;
  if v_row.id is null then raise exception 'BATCH_CLOSED'; end if;
  return v_row;
end $$;
grant execute on function public.close_batch(uuid), public.block_code(text) to authenticated;

-- Workers may not create batches directly (only through record_placement); the director may (and edit numbers).
drop policy if exists batch_head_insert on public.batch;
create policy batch_head_insert on public.batch for insert with check (farm_id = public.current_farm_id() and public.is_head());
