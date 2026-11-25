-- One-time setup of the farm and the head account, run in the Supabase SQL editor
-- AFTER creating the head user in Authentication → Users with:
--   email:    p<phone digits>@phone.farm.local     (e.g. p996700000001@phone.farm.local)
--   password: a 6-digit PIN
-- Replace the values in <> below.
with f as (
  insert into public.farm (name) values ('<Название фермы>') returning id
)
insert into public.app_user (id, farm_id, role, display_name, phone)
select u.id, f.id, 'head', '<Имя руководителя>', '<+996...>'
from auth.users u, f
where u.email = 'p<phone digits>@phone.farm.local';

