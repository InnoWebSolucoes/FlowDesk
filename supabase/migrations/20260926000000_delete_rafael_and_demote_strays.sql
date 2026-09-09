-- ============================================================================
-- Delete Rafael's account, and demote whatever still calls itself an admin.
--
-- Two things, because they are the same bug seen from both ends.
--
-- 1. The team page builds its list as `employees.filter(e => e.role ===
--    'employee')`. A row still carrying role = 'admin' is therefore not in
--    the list at all — which is not a delete button that fails, it is a card
--    that was never drawn. That is why "employees with admin access" could
--    not be deleted from the dashboard: there was nothing to click.
--
--    20260921000000_owner_only.sql already demoted everyone but InnoWeb. If
--    a row is still 'admin', that migration has not reached this database or
--    the row was changed afterwards. Restating it here is idempotent.
--
-- 2. Rafael goes entirely. Deleting the auth user cascades to public.users
--    and onward through the app's tables.
--
-- Run this in the Supabase SQL editor. It cannot run from the app: deleting
-- an auth user needs the service role, which the browser never holds.
-- ============================================================================


-- ─── 1. Nobody but the owner is an admin ────────────────────────────────────
-- guard_owner_flag calls is_owner(), which reads auth.uid() — null in the SQL
-- editor — so it refuses every change to is_owner and aborts the statement.
-- Disabled around the update and put straight back, as owner_only does.

do $demote$
begin
  begin
    execute 'alter table public.users disable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;

  update public.users
  set is_owner = true, role = 'admin'
  where id = '1e2001c5-72b2-44a6-9605-9954db51908e';

  update public.users
  set is_owner = false, role = 'employee'
  where id <> '1e2001c5-72b2-44a6-9605-9954db51908e'
    and (is_owner or role <> 'employee');

  begin
    execute 'alter table public.users enable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;
end
$demote$;


-- ─── 2. Rafael ──────────────────────────────────────────────────────────────
-- By email, not by a pasted id: the id in the notes is what the account was,
-- the email is who it is. The owner guard is belt and braces — deleting the
-- one account that manages everything would lock the company out of its own
-- app, and this file should not be able to do that however it is edited.

do $rafael$
declare
  victim uuid;
begin
  select u.id into victim
  from public.users u
  where lower(u.email) = 'rafamdann@gmail.com'
    and not u.is_owner;

  if victim is null then
    raise notice 'Nothing to do: rafamdann@gmail.com is not here, or is the owner.';
    return;
  end if;

  delete from auth.users where id = victim;
  raise notice 'Deleted %', victim;
end
$rafael$;


-- ─── 3. What is left ────────────────────────────────────────────────────────
-- Expect exactly one row, InnoWeb, and no Rafael.

select id, name, email, role, is_owner
from public.users
order by is_owner desc, name;
