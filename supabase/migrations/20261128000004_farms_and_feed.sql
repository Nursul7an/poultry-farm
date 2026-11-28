-- v4: a director runs several farms (each with its own blocks, people, feed and money), a farm profile,
-- and a farm feed warehouse: deliveries (lots) with type, maker, kg/bags, dates and storage, issued to blocks.

-- ================================================================ farm profile
alter table public.farm add column region text;
alter table public.farm add column address text;
alter table public.farm add column lat numeric(9, 6);
alter table public.farm add column lng numeric(9, 6);
-- Capacity = sum of block areas × birds per m² (Arbor Acres: ~33–39 kg/m² at catch → ~16–18 birds/m² at 2.2 kg).
alter table public.farm add column birds_per_m2 numeric(4, 1) not null default 17 check (birds_per_m2 > 0 and birds_per_m2 <= 40);
alter table public.farm add column created_by uuid;

-- ================================================================ several farms per director
-- app_user.farm_id stays the ACTIVE farm (all RLS uses current_farm_id()); farm_member lists every farm a person belongs to.
create table public.farm_member (
  farm_id uuid not null references public.farm (id) on delete cascade,
  user_id uuid not null references public.app_user (id) on delete cascade,
  role text not null check (role in ('head', 'worker')),
  created_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);
insert into public.farm_member (farm_id, user_id, role) select farm_id, id, role from public.app_user on conflict do nothing;
alter table public.farm_member enable row level security;
create policy farm_member_own on public.farm_member for select using (user_id = auth.uid());
grant select on public.farm_member to authenticated;

-- Every profile is a member of the farm it is created in (workers via manage-worker, directors via setup).
create or replace function public.app_user_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.farm_member (farm_id, user_id, role) values (new.farm_id, new.id, new.role) on conflict do nothing;
  return new;
end $$;
create trigger app_user_membership after insert on public.app_user for each row execute function public.app_user_membership();

/** The director's farms with their block count, the active one first. */
create or replace function public.my_farms()
returns table (id uuid, name text, region text, address text, blocks int, area_m2 numeric, birds_per_m2 numeric, is_current boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.region, f.address,
         (select count(*)::int from public.house h where h.farm_id = f.id and h.active),
         (select coalesce(sum(h.area_m2), 0) from public.house h where h.farm_id = f.id and h.active),
         f.birds_per_m2,
         f.id = (select farm_id from public.app_user where id = auth.uid())
  from public.farm f join public.farm_member m on m.farm_id = f.id and m.user_id = auth.uid()
  order by f.id = (select farm_id from public.app_user where id = auth.uid()) desc, f.name
$$;

/** A director creates another farm and switches to it. */
create or replace function public.create_farm(p jsonb) returns public.farm
language plpgsql security definer set search_path = public as $$
declare v_farm public.farm;
begin
  if not public.is_head() then raise exception 'FORBIDDEN'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  insert into public.farm (name, region, address, lat, lng, tz, day_start_hour, birds_per_m2, created_by)
  values (trim(p->>'name'), nullif(trim(p->>'region'), ''), nullif(trim(p->>'address'), ''), (p->>'lat')::numeric, (p->>'lng')::numeric,
          coalesce(p->>'tz', (select tz from public.farm where id = public.current_farm_id()), 'Asia/Bishkek'),
          coalesce((p->>'day_start_hour')::int, (select day_start_hour from public.farm where id = public.current_farm_id()), 8),
          coalesce((p->>'birds_per_m2')::numeric, 17), auth.uid())
  returning * into v_farm;
  insert into public.farm_member (farm_id, user_id, role) values (v_farm.id, auth.uid(), 'head');
  update public.app_user set farm_id = v_farm.id where id = auth.uid();
  return v_farm;
end $$;

/** Switch the active farm (only farms you belong to). */
create or replace function public.switch_farm(p_farm uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.farm_member where farm_id = p_farm and user_id = auth.uid()) then raise exception 'FORBIDDEN'; end if;
  update public.app_user set farm_id = p_farm where id = auth.uid();
end $$;
grant execute on function public.my_farms(), public.create_farm(jsonb), public.switch_farm(uuid) to authenticated;

-- ================================================================ feed warehouse
create table public.feed_lot (
  id uuid primary key,                                  -- generated on the device (offline, idempotent)
  farm_id uuid not null default public.current_farm_id() references public.farm (id) on delete cascade,
  received_on date not null,
  feed_type text not null check (feed_type in ('starter', 'grower', 'finisher', 'other')),
  product text,                                         -- maker / brand, e.g. «Агрокорм ПК-5»
  kg numeric(10, 1) not null check (kg > 0),
  bags int check (bags >= 0),
  bag_kg numeric(5, 1) check (bag_kg > 0),
  produced_on date,
  expires_on date,
  storage text,                                         -- where it is stored: «Склад 1», «Бункер у блока B»
  note text,
  edit_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or produced_on is null or expires_on >= produced_on)
);
create index feed_lot_farm on public.feed_lot (farm_id, received_on desc);

/** Feed taken from a lot to a block (its running batch). */
create table public.feed_issue (
  id uuid primary key,
  lot_id uuid not null references public.feed_lot (id) on delete restrict,
  house_batch_id uuid not null references public.house_batch (id) on delete cascade,
  issued_on date not null,
  kg numeric(9, 1) not null check (kg > 0),
  note text,
  edit_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feed_issue_lot on public.feed_issue (lot_id);
create index feed_issue_hb on public.feed_issue (house_batch_id);

-- Lots: same edit rule as other records (worker ≤ 48 h, then the director with a reason).
create or replace function public.feed_lot_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now();
  else
    if new.farm_id <> old.farm_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then raise exception 'IMMUTABLE_FIELDS'; end if;
    if now() - old.created_at > interval '48 hours' then
      if not public.is_head() then raise exception 'EDIT_WINDOW'; end if;
      if coalesce(trim(new.edit_reason), '') = '' then raise exception 'REASON_REQUIRED'; end if;
    end if;
    if new.kg < (select coalesce(sum(kg), 0) from public.feed_issue where lot_id = new.id) then raise exception 'LOT_BELOW_ISSUED'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger feed_lot_before_write before insert or update on public.feed_lot for each row execute function public.feed_lot_before_write();
create trigger feed_lot_history after update on public.feed_lot for each row when (old.* is distinct from new.*) execute function public.operation_history();

-- Issues: the block's rules (closed batch read-only, 48 h…) plus: the lot is on this farm and has enough left.
create trigger feed_issue_before_write before insert or update on public.feed_issue for each row execute function public.operation_before_write();
create trigger feed_issue_history after update on public.feed_issue for each row when (old.* is distinct from new.*) execute function public.operation_history();
create or replace function public.feed_issue_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_left numeric; v_lot public.feed_lot;
begin
  select * into v_lot from public.feed_lot where id = new.lot_id for update;
  if v_lot.farm_id is distinct from (select b.farm_id from public.house_batch hb join public.batch b on b.id = hb.batch_id where hb.id = new.house_batch_id) then
    raise exception 'FORBIDDEN';
  end if;
  select v_lot.kg - coalesce(sum(kg), 0) into v_left from public.feed_issue where lot_id = new.lot_id and id <> new.id;
  if new.kg > v_left then raise exception 'LOT_EMPTY'; end if;
  return new;
end $$;
create trigger feed_issue_stock before insert or update on public.feed_issue for each row execute function public.feed_issue_stock();

alter table public.feed_lot enable row level security;
alter table public.feed_issue enable row level security;
-- Everyone on the farm sees the warehouse and records deliveries; the director deletes.
create policy feed_lot_read on public.feed_lot for select using (farm_id = public.current_farm_id());
create policy feed_lot_insert on public.feed_lot for insert with check (farm_id = public.current_farm_id());
create policy feed_lot_update on public.feed_lot for update using (farm_id = public.current_farm_id());
create policy feed_lot_head_delete on public.feed_lot for delete using (farm_id = public.current_farm_id() and public.is_head());
-- Issues: like other block records (worker: own blocks).
create policy feed_issue_read on public.feed_issue for select using (public.can_access_house_batch(house_batch_id));
create policy feed_issue_insert on public.feed_issue for insert with check (public.can_access_house_batch(house_batch_id));
create policy feed_issue_update on public.feed_issue for update using (public.can_access_house_batch(house_batch_id));
create policy feed_issue_head_delete on public.feed_issue for delete using (public.is_head() and public.can_access_house_batch(house_batch_id));
grant select, insert, update, delete on public.feed_lot, public.feed_issue to authenticated;
revoke all on public.feed_lot, public.feed_issue from anon;

/** Warehouse stock per lot: what came, what was issued, what is left. Workers see all lots of the farm. */
-- Issued kg counts every block (a worker sees only own blocks' issues, but the stock left is the whole farm's).
create or replace function public.lot_issued_kg(p_lot uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(i.kg), 0) from public.feed_issue i join public.feed_lot l on l.id = i.lot_id
  where i.lot_id = p_lot and l.farm_id = public.current_farm_id()
$$;
grant execute on function public.lot_issued_kg(uuid) to authenticated;
create view public.feed_lot_stock with (security_invoker = true) as
select l.*, public.lot_issued_kg(l.id)::numeric(10, 1) as issued_kg, (l.kg - public.lot_issued_kg(l.id))::numeric(10, 1) as left_kg
from public.feed_lot l;
grant select on public.feed_lot_stock to authenticated;
