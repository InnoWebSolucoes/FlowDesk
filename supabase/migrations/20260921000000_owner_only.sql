-- ============================================================================
-- One owner, everybody else an employee. The admin tier goes away.
--
-- InnoWeb is the only account that manages anything. Kasim and Rafael become
-- employees, as does anyone else currently marked admin.
--
-- Rewriting the ~97 policy references across 26 migrations would be the
-- literal reading of "remove admin powers", and it is the wrong way to do it:
-- that is exactly the drift — the same policy restated under different names
-- in different migrations — that made the todo insert fail for three
-- sessions. Every one of those policies calls one of four gate functions, so
-- redefining the functions closes the tier everywhere at once, in one place
-- that can be read and reverted.
--
-- After this:
--   is_owner()            unchanged — true only for the owner
--   is_admin()            true only for the owner
--   is_any_admin()        true only for the owner
--   is_project_admin(p)   true only for the owner
--   is_my_employee(t)     true only for the owner, over any employee
--
-- project_admins rows stop conferring anything. The table is left in place
-- rather than dropped: nothing else reads it, and keeping it means this
-- migration can be reversed by restoring the function bodies alone.
-- ============================================================================


-- ─── 1. Demote everyone except the owner ────────────────────────────────────
-- guard_owner_flag refuses changes to is_owner unless the caller is already
-- the owner, and auth.uid() is null from a migration, so it never passes.
-- Disabled for these two statements and restored straight after.

do $demote$
begin
  begin
    execute 'alter table public.users disable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;

  -- InnoWeb is the owner and the only one.
  update public.users
  set is_owner = true, role = 'admin'
  where id = '1e2001c5-72b2-44a6-9605-9954db51908e';

  -- Everyone else becomes an employee, whatever they were.
  update public.users
  set is_owner = false, role = 'employee'
  where id <> '1e2001c5-72b2-44a6-9605-9954db51908e';

  begin
    execute 'alter table public.users enable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;
end
$demote$;

-- Their grants are meaningless now, and leaving them would quietly restore
-- access if the gate functions were ever put back.
delete from public.project_admins
where user_id <> '1e2001c5-72b2-44a6-9605-9954db51908e';

-- Membership is not permission — it is what puts somebody on a project's
-- roster — so it is left alone. An employee still belongs to their projects.


-- ─── 2. The gates: owner only ───────────────────────────────────────────────

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_owner);
$$;

-- Was: role = 'admin' and is_owner. The role half no longer adds anything,
-- but it stays so that clearing is_owner alone is enough to remove access.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

-- Was: anyone with role = 'admin'. There is no such tier now.
create or replace function public.is_any_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

-- Was: the owner, or an admin holding a project_admins row for this project.
-- The second half is gone, so a per-project grant confers nothing.
create or replace function public.is_project_admin(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

-- Was: the caller is an admin and the target is an employee. Same shape, but
-- only the owner qualifies. The target check stays: it is what stops this
-- reaching the owner's own records.
create or replace function public.is_my_employee(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() and exists (
    select 1 from public.users u where u.id = target and u.role = 'employee'
  );
$$;


-- ─── 3. Confirm ─────────────────────────────────────────────────────────────
-- Exactly one row, InnoWeb, with is_owner true. Everyone else an employee
-- with no project_admins row.

select
  u.name,
  u.email,
  u.role,
  u.is_owner,
  (select count(*) from public.project_admins a where a.user_id = u.id) as admin_rows
from public.users u
order by u.is_owner desc, u.name;
