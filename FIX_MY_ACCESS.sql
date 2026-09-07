-- ============================================================================
-- Give the InnoWeb Admin account the access every write is gated on.
--
-- Result set 4 of the diagnosis showed this account with no project_members
-- row and a null legacy project_id. Every insert the organiser makes — todos
-- onto the shared board, tasks for staff — is checked by is_project_admin(),
-- which is true only for the owner or for an admin listed in project_admins
-- for that project. Neither held, so RLS refused the writes and the import
-- looked like a dead button.
--
-- Run section 1. Check the result. Then run section 2.
-- ============================================================================

-- ─── 1. Make this account the owner ─────────────────────────────────────────
-- is_owner is what makes is_admin() and is_project_admin() true. It is the
-- top tier: it reaches every project without needing a row per project.
--
-- This is the account you sign in with, so this is the one that needs it.

update public.users
set is_owner = true, role = 'admin'
where id = '1e2001c5-72b2-44a6-9605-9954db51908e';

-- Confirm before going on: is_owner must be true.
select id, name, role, is_owner from public.users
where id = '1e2001c5-72b2-44a6-9605-9954db51908e';


-- ─── 2. Put the account on the project ──────────────────────────────────────
-- Ownership settles permission, but membership is what the rosters and the
-- project pickers read. Without it the account keeps looking absent from its
-- own projects.

insert into public.project_members (user_id, project_id)
select '1e2001c5-72b2-44a6-9605-9954db51908e', p.id
from public.projects p
on conflict do nothing;

-- And grant it explicitly on every project, so the account still works if
-- ownership is ever moved elsewhere.
insert into public.project_admins (user_id, project_id)
select '1e2001c5-72b2-44a6-9605-9954db51908e', p.id
from public.projects p
on conflict do nothing;


-- ─── 3. Confirm ─────────────────────────────────────────────────────────────
-- memberships and project_admin_rows should both equal the number of
-- projects, and is_owner should be true.

select
  u.name,
  u.role,
  u.is_owner,
  (select count(*) from project_members m where m.user_id = u.id) as memberships,
  (select count(*) from project_admins a where a.user_id = u.id)  as project_admin_rows,
  (select count(*) from projects)                                 as total_projects
from public.users u
where u.id = '1e2001c5-72b2-44a6-9605-9954db51908e';
