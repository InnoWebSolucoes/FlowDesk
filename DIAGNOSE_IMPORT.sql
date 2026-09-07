-- ============================================================================
-- Why the import writes nothing.
--
-- Result set 4 already showed it: InnoWeb Admin has no project membership and
-- no legacy project_id. Every write the organiser makes is gated on
-- is_project_admin(project_id), which is true only for the owner or for an
-- admin listed in project_admins for that exact project. If neither holds,
-- RLS refuses the insert.
--
-- Read-only. Run it and send back the three result sets.
-- ============================================================================

-- ─── 1. Are you the owner, and are you a project admin anywhere? ────────────
-- is_owner true makes is_project_admin true everywhere and the whole problem
-- disappears. If it is false, the project_admins rows are what matter.

select
  u.id,
  u.name,
  u.role,
  u.is_owner,
  (select count(*) from project_admins pa where pa.user_id = u.id) as project_admin_rows
from users u
order by u.role, u.name;


-- ─── 2. Who is granted what ─────────────────────────────────────────────────

select
  pa.project_id,
  p.name as project,
  u.name as admin,
  u.is_owner
from project_admins pa
join users u   on u.id = pa.user_id
join projects p on p.id = pa.project_id
order by p.name, u.name;


-- ─── 3. The verdict, as the database sees it for the signed-in user ─────────
-- Run this while signed in as InnoWeb Admin (the SQL editor runs as postgres,
-- so these will read as the service role — what matters is column 1 and 2
-- being true for your account in result set 1 above).

select
  (select name from projects order by created_at limit 1) as first_project,
  (select id   from projects order by created_at limit 1) as first_project_id;
