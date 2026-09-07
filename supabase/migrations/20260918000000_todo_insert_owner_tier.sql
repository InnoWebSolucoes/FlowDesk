-- ============================================================================
-- The owner can always write the shared board.
--
-- The console said it plainly: 42501, "new row violates row-level security
-- policy for table project_todos". The insert sends owner_id = null, so the
-- branch that has to pass is
--
--   owner_id is null and public.is_project_admin(project_id)
--
-- The account now has is_owner = true, a project_members row and a
-- project_admins row, and is_project_admin() returns true for the owner
-- unconditionally — so on the migrations as written this should already pass.
-- It does not, which means the policy live on this database is not the one the
-- files describe. That is consistent with the earlier session where migrations
-- were run against the wrong project.
--
-- Rather than guess which of the three historical versions is installed, this
-- restates all of them from scratch. Dropping by every name they have ever
-- had makes it idempotent regardless of what is currently there.
-- ============================================================================

-- ─── The gate functions, restated ───────────────────────────────────────────
-- If an older version of these is installed, the policies below inherit its
-- behaviour. Restating them costs nothing and removes the doubt.

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_owner);
$$;

create or replace function public.is_project_admin(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_owner()
    or exists (
      select 1
      from public.project_admins pa
      join public.users u on u.id = pa.user_id
      where pa.user_id = auth.uid()
        and pa.project_id = p
        and u.role = 'admin'
    );
$$;


-- ─── project_todos ──────────────────────────────────────────────────────────
-- Every name this policy has carried, so whichever is installed is replaced.

drop policy if exists "project_todos_insert"       on public.project_todos;
drop policy if exists "project_todos_admin"        on public.project_todos;
drop policy if exists "project_todos_write_scoped" on public.project_todos;

-- An employee owns their own todos and may only put them in their own list.
-- The shared board (owner_id null) belongs to whoever administers the project,
-- and to the owner everywhere.
create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    or (owner_id is null and public.is_project_admin(project_id))
  );


-- ─── project_todo_lists ─────────────────────────────────────────────────────
-- The list the todo lands in is created by the same import, under the same
-- rule, so it needs the same treatment.

drop policy if exists "project_todo_lists_insert"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_admin"        on public.project_todo_lists;
drop policy if exists "project_todo_lists_write_scoped" on public.project_todo_lists;

create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_project_admin(project_id))
  );


-- ─── Confirm ────────────────────────────────────────────────────────────────
-- Both should show is_project_admin in their with_check expression.

select tablename, policyname, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('project_todos', 'project_todo_lists')
  and cmd = 'INSERT';
