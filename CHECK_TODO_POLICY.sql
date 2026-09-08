-- ============================================================================
-- Why "new row violates row-level security policy" is still showing.
--
-- The policy list came back truncated mid-expression, and the old and new
-- versions are identical up to where it was cut, so it did not say whether
-- the migration landed. Section 1 answers that.
--
-- But the more likely answer is section 4, and it is not the migration. The
-- board in the screenshot is the shared one: that page passes owner_id null
-- for every tab on it, "Rafa" and "Kasim" included — those are lists on the
-- shared board, not personal boards. So the failing insert needs
--
--   owner_id is null and public.is_project_admin(project_id)
--
-- which already existed before the ownership migration. That migration added
-- a branch for a different case and would not have fixed this error. If
-- section 4 says can_write_here false, the policy is fine and the account
-- simply lacks the grant.
--
-- One more thing narrows it. Reading the shared board and writing to it are
-- gated differently:
--
--   read  project_todo_lists_select  ... is_admin()                -- owner only
--   write project_todos_insert       ... is_project_admin(project) -- owner OR
--                                                                  -- a project_admins row
--
-- is_admin() is the stricter of the two: it requires role = 'admin' AND
-- is_owner. The screenshot shows 16 todos loading on the shared board, so the
-- read passed, so is_owner is already true for this account — and
-- is_project_admin() returns true for the owner unconditionally.
--
-- Which means the write should pass and does not. So either the deployed
-- functions are not the ones in these files (an earlier session ran
-- migrations against the wrong project), or the account the app is signed in
-- as is not the account those reads succeeded for. Section 6 settles which.
--
-- Sections 1-4, 6 and 7 are read-only. Section 5 is the fix, commented out.
-- Run 1-4, 6 and 7 first and send the results; do not run 5 until then.
-- ============================================================================

-- ─── 1. Is the third branch there? ──────────────────────────────────────────
-- The new policy is the only one mentioning is_project_admin twice: once for
-- the shared board, once for writing into somebody else's list.
--
-- has_third_branch false means the migration has not run on this database.

select
  policyname,
  (select count(*) from regexp_matches(with_check, 'is_project_admin', 'g')) as is_project_admin_mentions,
  (select count(*) from regexp_matches(with_check, 'is_project_admin', 'g')) >= 2 as has_third_branch,
  with_check as full_expression
from pg_policies
where schemaname = 'public'
  and tablename = 'project_todos'
  and cmd = 'INSERT';


-- ─── 2. The creator plumbing ────────────────────────────────────────────────
-- All three should be present: the column default, the trigger function and
-- the trigger itself. Empty rows mean that part did not run.

select 'column default' as piece,
       coalesce(column_default, '(none)') as detail
from information_schema.columns
where table_schema = 'public' and table_name = 'project_todos' and column_name = 'created_by'

union all

select 'trigger function',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'project_todos_set_creator'
       ) then 'present' else '(missing)' end

union all

select 'trigger',
       case when exists (
         select 1 from pg_trigger
         where tgname = 'project_todos_set_creator' and not tgisinternal
       ) then 'present' else '(missing)' end;


-- ─── 3. Does anything still belong to nobody? ───────────────────────────────
-- belonging_to_nobody should be 0 for rows that have an owner. Todos already
-- on the shared board with no creator recorded cannot be recovered — there is
-- nothing in the row saying who added them — so those are counted separately.

select
  count(*) as total,
  count(*) filter (where created_by is null) as no_creator,
  count(*) filter (where created_by is null and owner_id is null and assignee_id is null)
    as belonging_to_nobody,
  count(*) filter (where owner_id is null) as on_shared_board
from public.project_todos;


-- ─── 4. THE LIKELY ANSWER: does the gate open for you? ──────────────────────
-- The board in the screenshot is the shared one — the page passes owner_id
-- null for every tab on it, "Rafa" and "Kasim" included; those are lists on
-- the shared board, not personal boards. So the failing insert has
-- owner_id null and needs this branch:
--
--   owner_id is null and public.is_project_admin(project_id)
--
-- which existed before the ownership migration. The third branch that
-- migration added is for a different case and would not have fixed this.
-- So if can_write_here is false below, that is the whole bug: the policy is
-- correct and the account lacks the grant. FIX_MY_ACCESS.sql is what sets it.

select
  u.id,
  u.name,
  u.role,
  u.is_owner,
  p.name as project,
  public.is_project_admin(p.id) as can_write_here
from public.users u
cross join public.projects p
where u.id = auth.uid()
order by p.name;


-- ─── 5. If section 4 said false, this is the fix ────────────────────────────
-- Uncomment and run. It grants against auth.uid() rather than a pasted id, so
-- it applies to whichever account you are actually signed in as — the earlier
-- FIX_MY_ACCESS.sql hardcoded an id, and if the app signs in as a different
-- account than the one that was granted, that is exactly how this error
-- survives having "already been fixed".

-- update public.users set is_owner = true, role = 'admin' where id = auth.uid();
--
-- insert into public.project_members (user_id, project_id)
-- select auth.uid(), p.id from public.projects p
-- on conflict do nothing;
--
-- insert into public.project_admins (user_id, project_id)
-- select auth.uid(), p.id from public.projects p
-- on conflict do nothing;
--
-- -- Confirm: can_write_here must now be true everywhere.
-- select p.name as project, public.is_project_admin(p.id) as can_write_here
-- from public.projects p order by p.name;


-- ─── 6. Are the deployed functions the ones in these files? ─────────────────
-- Run this BEFORE section 5. If the bodies below do not match, the database
-- is running older definitions and granting the account will not help —
-- rerunning 20260911000000 and 20260918000000 is what is needed instead.
--
-- Expected:
--   is_owner          ... where id = auth.uid() and is_owner
--   is_admin          ... where id = auth.uid() and role = 'admin' and is_owner
--   is_project_admin  ... is_owner() OR a project_admins row for this project
--
-- is_project_admin must contain "is_owner()" — without that call the owner
-- has no path through it at all, which would produce exactly this symptom:
-- reads pass on is_admin(), writes fail on is_project_admin().

select
  p.proname,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_owner', 'is_admin', 'is_project_admin', 'todo_list_owner')
order by p.proname;


-- ─── 7. The direct answer ───────────────────────────────────────────────────
-- What the failing insert actually evaluates, without inserting anything.
-- Run it while signed in as the account that sees the error.
--
-- Read it with section 6:
--   would_be_allowed true, but the app still errors -> the deployed policy is
--     not the one in the files; rerun 20260918000000 and 20260919000000.
--   would_be_allowed false, is_owner true -> is_project_admin is not calling
--     is_owner(); section 6 shows its body, and rerunning 20260918000000
--     restates it.
--   would_be_allowed false, is_owner false -> the account lacks the grant,
--     and section 5 is the fix. Note is_admin true with is_owner false is
--     impossible in these files, so that combination also means the deployed
--     functions are stale.

select
  p.name as project,
  public.is_owner()                as is_owner,
  public.is_admin()                as is_admin,
  -- The shared-board branch is "owner_id is null and is_project_admin(...)".
  -- owner_id is null by construction on this board, so this call alone
  -- decides whether the insert is allowed.
  public.is_project_admin(p.id)    as would_be_allowed
from public.projects p
order by p.name;
