-- Director manages the farm and its people (spec v2.2, FR-D1…D9).

-- What the director did with accounts. Never stores a PIN.
create table public.staff_event (
  id bigserial primary key,
  farm_id uuid not null references public.farm (id) on delete cascade,
  actor_id uuid not null references public.app_user (id),
  user_id uuid not null references public.app_user (id) on delete cascade,
  kind text not null check (kind in ('created', 'pin_reset', 'deactivated', 'reactivated', 'phone_changed')),
  at timestamptz not null default now()
);
create index staff_event_farm_at on public.staff_event (farm_id, at desc);
alter table public.staff_event enable row level security;
create policy staff_event_head_read on public.staff_event for select using (farm_id = public.current_farm_id() and public.is_head());
grant select on public.staff_event to authenticated;
-- Rows are written by the manage-worker function (service role), not by browsers.

-- The phone is the login, and role/farm decide access: browsers may change only the display name and active flag.
-- Phone changes go through manage-worker, which updates Auth and the profile together.
create or replace function public.app_user_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.phone is distinct from old.phone or new.role is distinct from old.role or new.farm_id is distinct from old.farm_id then
      raise exception 'FORBIDDEN: phone, role and farm change only through the server';
    end if;
    if new.id = auth.uid() and new.active is distinct from old.active then
      raise exception 'FORBIDDEN: cannot deactivate yourself';
    end if;
  end if;
  return new;
end $$;
create trigger app_user_guard before update on public.app_user for each row execute function public.app_user_guard();

-- A house can be deleted only while it has no batch history; otherwise it is deactivated.
create policy house_head_delete on public.house for delete using (
  farm_id = public.current_farm_id() and public.is_head()
  and not exists (select 1 from public.house_batch hb where hb.house_id = house.id)
);
grant delete on public.house to authenticated;

-- Ends every session of a user (PIN reset, deactivation). Only the server function may call it.
create or replace function public.revoke_sessions(uid uuid) returns void
language sql security definer set search_path = auth, public as $$
  delete from auth.sessions where user_id = uid
$$;
revoke all on function public.revoke_sessions(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.revoke_sessions(uuid) to service_role';
  end if;
end $$;
