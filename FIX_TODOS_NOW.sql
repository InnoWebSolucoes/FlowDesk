-- ============================================================================
-- Fix "new row violates row-level security policy for table project_todos".
--
-- Run this whole file in the Supabase SQL editor, top to bottom, once.
-- It is safe to run more than once.
--
-- Rather than work out which of the several past migrations actually landed
-- on this database, this restates everything the insert depends on from
-- scratch: the three gate functions, the account's grants, and the policies
-- themselves — dropping every name they have ever carried so that whatever
-- is currently installed is replaced rather than added to.
--
-- The last statement prints whether it worked.
-- ============================================================================


-- ─── 1. The gate functions ──────────────────────────────────────────────────
-- is_project_admin is the one the insert turns on. It must return true for
-- the owner unconditionally; an older version that omits the is_owner() call
-- is enough on its own to produce this error.

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


-- ─── 2. Give THIS account the grants ────────────────────────────────────────
-- Against auth.uid(), not a hardcoded id. An earlier script granted a pasted
-- id, which does nothing if the app signs in as a different account — that is
-- one way this error survives having "already been fixed".
--
-- If you are running this from the SQL editor rather than from the app,
-- auth.uid() is null and these three statements will no-op harmlessly; see
-- section 5 for the version that takes an explicit id.

update public.users
set is_owner = true, role = 'admin'
where id = auth.uid();

insert into public.project_members (user_id, project_id)
select auth.uid(), p.id from public.projects p
where auth.uid() is not null
on conflict do nothing;

insert into public.project_admins (user_id, project_id)
select auth.uid(), p.id from public.projects p
where auth.uid() is not null
on conflict do nothing;


-- ─── 3. The policies, restated ──────────────────────────────────────────────
-- Every name these have carried across six migrations, so whichever is
-- installed is replaced rather than left to sit alongside the new one.

drop policy if exists "project_todos_insert"       on public.project_todos;
drop policy if exists "project_todos_admin"        on public.project_todos;
drop policy if exists "project_todos_write_admin"  on public.project_todos;
drop policy if exists "project_todos_write_scoped" on public.project_todos;

create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    -- Your own todo, in your own list.
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    -- The shared manager board, if you administer the project. This is the
    -- branch the failing insert needs: that page sends owner_id null for
    -- every tab on it.
    or (owner_id is null and public.is_project_admin(project_id))
    -- Somebody else's list, if you administer the project. owner_id must
    -- match the list's owner, so this cannot be used to write a row claiming
    -- one person's board while sitting in another's list.
    or (
      public.is_project_admin(project_id)
      and owner_id is not distinct from public.todo_list_owner(list_id)
    )
  );

drop policy if exists "project_todo_lists_insert"       on public.project_todo_lists;
drop policy if exists "project_todo_lists_admin"        on public.project_todo_lists;
drop policy if exists "project_todo_lists_write_admin"  on public.project_todo_lists;
drop policy if exists "project_todo_lists_write_scoped" on public.project_todo_lists;

create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or public.is_project_admin(project_id)
  );


-- ─── 4. Record who adds a todo from here on ─────────────────────────────────
-- So a todo on the shared board still belongs to somebody. Harmless if the
-- ownership migration already ran.

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


-- ─── 5. Did it work? ────────────────────────────────────────────────────────
-- can_write_here must be true for the project you are adding todos to.
--
-- Run from the SQL editor, auth.uid() is null, so this shows every admin
-- account and whether the grants are on it. Find the one you sign in as:
--   is_owner true  -> that account is fixed.
--   is_owner false -> replace the id on the last line and run it.

select
  u.id,
  u.name,
  u.email,
  u.role,
  u.is_owner,
  (select count(*) from public.project_admins a where a.user_id = u.id) as project_admin_rows,
  (select count(*) from public.projects)                                as total_projects
from public.users u
where u.role = 'admin' or u.is_owner
order by u.is_owner desc, u.name;


-- ─── 6. Only if section 5 showed your account with is_owner false ───────────
-- Uncomment, put your own user id in, run. The id is in the first column of
-- section 5's result, on the row whose email you sign in with.

-- update public.users set is_owner = true, role = 'admin'
-- where id = 'PASTE-YOUR-USER-ID-HERE';
--
-- insert into public.project_members (user_id, project_id)
-- select 'PASTE-YOUR-USER-ID-HERE', p.id from public.projects p
-- on conflict do nothing;
--
-- insert into public.project_admins (user_id, project_id)
-- select 'PASTE-YOUR-USER-ID-HERE', p.id from public.projects p
-- on conflict do nothing;
