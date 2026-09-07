-- ============================================================================
-- Why project_todos still refuses the insert (Postgres 42501).
--
-- The insert sends owner_id = null, so the policy that must pass is
--   owner_id is null and public.is_project_admin(project_id)
-- You now have is_owner = true, which should make is_project_admin true for
-- every project. So either a different policy is live than the migration
-- files say, or the functions do not agree.
--
-- Read-only. Run it and send back all three result sets.
-- ============================================================================

-- ─── 1. The policies actually live on project_todos ─────────────────────────
-- This is the authority. The migration files are only what was *meant* to be
-- applied; this is what Postgres is enforcing right now.

select
  policyname,
  cmd,
  qual        as using_expression,
  with_check  as with_check_expression
from pg_policies
where schemaname = 'public' and tablename = 'project_todos'
order by cmd, policyname;


-- ─── 2. What the gate functions return for the signed-in account ────────────
-- The SQL editor runs as postgres, not as you, so auth.uid() is null here and
-- these would all read false. Impersonate the account instead.

set local role authenticated;
set local request.jwt.claims = '{"sub":"1e2001c5-72b2-44a6-9605-9954db51908e","role":"authenticated"}';

select
  auth.uid()                                                    as acting_as,
  public.is_owner()                                             as is_owner,
  public.is_admin()                                             as is_admin,
  public.is_any_admin()                                         as is_any_admin,
  (select public.is_project_admin(id) from projects limit 1)     as is_project_admin_on_first_project;

reset role;


-- ─── 3. The project the app is writing into ─────────────────────────────────
-- is_project_admin is checked against the project_id on the row being
-- inserted. If the app sends a project the account was never granted, the
-- check fails however correct the account looks.

select
  p.id,
  p.name,
  exists (
    select 1 from project_admins pa
    where pa.project_id = p.id
      and pa.user_id = '1e2001c5-72b2-44a6-9605-9954db51908e'
  ) as account_granted_here,
  exists (
    select 1 from project_members m
    where m.project_id = p.id
      and m.user_id = '1e2001c5-72b2-44a6-9605-9954db51908e'
  ) as account_member_here
from projects p
order by p.created_at;
