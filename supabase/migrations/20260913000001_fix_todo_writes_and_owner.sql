-- Two things the scoped-admin work left broken.
--
-- 1. Adding a todo could be refused.
--
-- 20260911000001 added project_todos_write_scoped as FOR ALL, which includes
-- INSERT, next to the project_todos_insert policy that was already there.
-- Permissive policies are ORed, so that alone is harmless — but it means an
-- admin who is not the owner and has no project_admins row passes neither:
-- write_scoped wants is_project_admin(project_id), and the older insert policy
-- wants is_admin(). An admin created after the grants were backfilled has
-- neither, and clicking a day on the calendar silently did nothing.
--
-- The scoped policy is narrowed to the commands it should govern, and the
-- insert rule is restated so an admin of the project can always add to the
-- shared board.
--
-- 2. Ownership may have landed on the wrong account.
--
-- The backfill made the oldest admin by join_date the owner. On a database
-- where a second admin was created with an earlier join_date than the real
-- owner, that is the wrong person — and is_owner() gates granting access,
-- creating projects and changing ownership, so it is not a small mistake.
-- There is no way to guess the right answer here, so this only makes it
-- fixable: see the note at the end.

-- ─── Todos ──────────────────────────────────────────────────────────────────

drop policy if exists "project_todos_write_scoped" on public.project_todos;

-- The shared manager board (owner_id null) belongs to whoever administers the
-- project; a private board belongs to its owner. Both are stated in one place
-- rather than split across two policies that each half-answer the question.

drop policy if exists "project_todos_insert" on public.project_todos;
create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    or (owner_id is null and public.is_project_admin(project_id))
  );

drop policy if exists "project_todos_update" on public.project_todos;
create policy "project_todos_update" on public.project_todos
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

drop policy if exists "project_todos_delete" on public.project_todos;
create policy "project_todos_delete" on public.project_todos
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

-- Todo lists have the same shape and the same problem.

drop policy if exists "project_todo_lists_write_scoped" on public.project_todo_lists;

drop policy if exists "project_todo_lists_insert" on public.project_todo_lists;
create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_project_admin(project_id))
  );

drop policy if exists "project_todo_lists_update" on public.project_todo_lists;
create policy "project_todo_lists_update" on public.project_todo_lists
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

drop policy if exists "project_todo_lists_delete" on public.project_todo_lists;
create policy "project_todo_lists_delete" on public.project_todo_lists
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

-- Notes were given the same FOR ALL treatment and need the same narrowing.

drop policy if exists "project_notes_write_scoped" on public.project_notes;

drop policy if exists "project_notes_insert" on public.project_notes;
create policy "project_notes_insert" on public.project_notes
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_project_admin(project_id))
  );

drop policy if exists "project_notes_update" on public.project_notes;
create policy "project_notes_update" on public.project_notes
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

drop policy if exists "project_notes_delete" on public.project_notes;
create policy "project_notes_delete" on public.project_notes
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_project_admin(project_id)));

-- ─── Every admin can reach every project until told otherwise ───────────────
--
-- The original backfill only granted projects to admins that existed at the
-- time. An admin promoted afterwards has no grants at all and can see a
-- project without being able to change anything in it, which reads as the app
-- being broken rather than as a permission being absent. Grant what is
-- missing; revoking is a deliberate act from the team tab.

insert into public.project_admins (project_id, user_id)
select p.id, u.id
from public.projects p
cross join public.users u
where u.role = 'admin'
on conflict do nothing;

-- ─── Ownership ──────────────────────────────────────────────────────────────
--
-- Nothing is changed automatically: guessing who should own the company is
-- worse than leaving it. To check who holds it:
--
--   select id, name, email, is_owner, join_date from public.users
--   where role = 'admin' order by join_date;
--
-- To move it, run both statements together — the guard trigger allows it only
-- when the current owner is the one running it:
--
--   update public.users set is_owner = false where is_owner;
--   update public.users set is_owner = true where email = 'you@example.com';
--
-- If nobody currently holds it, the trigger will refuse. In that case disable
-- it for the one statement:
--
--   alter table public.users disable trigger guard_owner_flag;
--   update public.users set is_owner = true where email = 'you@example.com';
--   alter table public.users enable trigger guard_owner_flag;

select id, name, email, is_owner, join_date
from public.users
where role = 'admin'
order by join_date;
