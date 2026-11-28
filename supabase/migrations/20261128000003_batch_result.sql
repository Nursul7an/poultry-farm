-- Closing a batch stores its result (survival, weight, FCR, EPEF… computed by the app from the batch's records),
-- so the block card and reports show it after the records are gone from the phones.
alter table public.batch add column result jsonb;

drop function if exists public.close_batch(uuid);
create or replace function public.close_batch(p_batch uuid, p_result jsonb default null) returns public.batch
language plpgsql security definer set search_path = public as $$
declare v_row public.batch;
begin
  if not public.is_head() then raise exception 'FORBIDDEN'; end if;
  update public.batch set status = 'closed', closed_at = now(), result = coalesce(p_result, result)
  where id = p_batch and farm_id = public.current_farm_id() and status <> 'closed'
  returning * into v_row;
  if v_row.id is null then raise exception 'BATCH_CLOSED'; end if;
  return v_row;
end $$;
grant execute on function public.close_batch(uuid, jsonb) to authenticated;
