-- ============================================================================
-- The todo policies, restated once so they stop drifting.
--
-- Adding a todo failed with "new row violates row-level security policy",
-- first on project_todos and then on project_todo_lists — the calendar
-- creates the list before the todo, so both are on the path.
--
-- The cause was six migrations having rewritten these policies under four
-- different names (_insert, _admin, _write_admin, _write_scoped), each
-- dropping only the names it knew about. Whatever a given database ended up
-- with depended on which of them had actually run. One of the old ones is
-- FOR ALL, which covers INSERT too.
--
-- This drops every name they have ever carried and states all four commands
-- on both tables, so the outcome no longer depends on history. The gate
-- functions are restated for the same reason.
--
-- Note this deliberately does NOT grant anyone. Who is an owner or a project
-- admin is data, not schema; FIX_TODOS_NOW.sql at the repo root does that
-- part, and needs to because guard_owner_flag blocks it from a plain script.
-- ============================================================================


-- ─── 1. The gate functions ──────────────────────────────────────────────────

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_owner);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and is_owner
  );
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

create or replace function public.todo_list_owner(list uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from public.project_todo_lists where id = list;
$$;


-- ─── 3. project_todo_lists: every policy ────────────────────────────────────
-- The calendar creates the list before the todo, so this table has to allow
-- the write too. UPDATE and DELETE are restated as well: their old versions
-- gate on is_admin(), which refuses an admin who is not the owner.

drop policy if exists "project_todo_lists_insert"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_update"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_delete"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_select"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_admin"        on public.project_todo_lists;
drop policy if exists "project_todo_lists_write_admin"  on public.project_todo_lists;
drop policy if exists "project_todo_lists_write_scoped" on public.project_todo_lists;

create policy "project_todo_lists_select" on public.project_todo_lists
  for select to authenticated using (
    owner_id = auth.uid()
    or public.is_project_admin(project_id)
  );

create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    owner_id = auth.uid()
    or public.is_project_admin(project_id)
  );

create policy "project_todo_lists_update" on public.project_todo_lists
  for update to authenticated
  using       (owner_id = auth.uid() or public.is_project_admin(project_id))
  with check  (owner_id = auth.uid() or public.is_project_admin(project_id));

create policy "project_todo_lists_delete" on public.project_todo_lists
  for delete to authenticated using (
    owner_id = auth.uid()
    or public.is_project_admin(project_id)
  );


-- ─── 4. project_todos: every policy ─────────────────────────────────────────

drop policy if exists "project_todos_insert"       on public.project_todos;
drop policy if exists "project_todos_update"       on public.project_todos;
drop policy if exists "project_todos_delete"       on public.project_todos;
drop policy if exists "project_todos_admin"        on public.project_todos;
drop policy if exists "project_todos_write_admin"  on public.project_todos;
drop policy if exists "project_todos_write_scoped" on public.project_todos;

create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    -- Your own todo in your own list.
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    -- The shared manager board. The calendar and the todos page both send
    -- owner_id null, so this is the branch they need.
    or (owner_id is null and public.is_project_admin(project_id))
    -- Somebody else's list, if you administer the project. owner_id must
    -- match the list's owner, so this cannot write a row claiming one
    -- person's board while sitting in another's list.
    or (
      public.is_project_admin(project_id)
      and owner_id is not distinct from public.todo_list_owner(list_id)
    )
  );

create policy "project_todos_update" on public.project_todos
  for update to authenticated
  using       (owner_id = auth.uid() or public.is_project_admin(project_id))
  with check  (owner_id = auth.uid() or public.is_project_admin(project_id));

create policy "project_todos_delete" on public.project_todos
  for delete to authenticated using (
    owner_id = auth.uid() or public.is_project_admin(project_id)
  );


-- ─── 5. Record who adds a todo ──────────────────────────────────────────────

update public.project_todos
set created_by = owner_id
where created_by is null and owner_id is not null;

alter table public.project_todos
  alter column created_by set default auth.uid();

create or replace function public.project_todos_set_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists project_todos_set_creator on public.project_todos;
create trigger project_todos_set_creator
  before insert on public.project_todos
  for each row execute function public.project_todos_set_creator();


