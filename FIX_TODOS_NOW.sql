-- ============================================================================
-- Fix "new row violates row-level security policy for table project_todos".
--
-- Run this whole file in the Supabase SQL editor, top to bottom.
-- Safe to run more than once.
--
-- The account listing showed why the earlier fix did nothing:
--
--   InnoWeb Admin  innowebsolucoes@gmail.com   is_owner true    1 admin row
--   Kasim          kasimcustodio@gmail.com     is_owner FALSE   0 admin rows
--   Rafael         rafamdann@gmail.com         is_owner FALSE   0 admin rows
--
-- Only the InnoWeb account was ever granted — that is the hardcoded id the
-- old FIX_MY_ACCESS.sql used. Kasim and Rafael have no grant at all, so
-- is_project_admin() is false for them and every write to the shared manager
-- board is refused. Signing in as either of them produces exactly the error
-- in the screenshot.
--
-- This grants all three, and restates the policies and gate functions so it
-- does not matter which of the past migrations actually landed here.
-- ============================================================================


-- ─── 1. The gate functions ──────────────────────────────────────────────────
-- is_project_admin is what the insert turns on. It must return true for the
-- owner unconditionally; an older version missing the is_owner() call is on
-- its own enough to cause this.

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


-- ─── 2. Grant the three admin accounts ──────────────────────────────────────
-- By id, taken from the listing, so it does not matter which one the app is
-- signed in as. is_owner reaches every project without needing a row each;
-- the membership and admin rows are what the rosters and pickers read.

update public.users
set is_owner = true, role = 'admin'
where id in (
  '1e2001c5-72b2-44a6-9605-9954db51908e',  -- InnoWeb Admin
  '5719747f-ccc2-4e4e-8b10-13bb026fe725',  -- Kasim
  'b63d846e-1780-4040-9a3a-468fb9bfb683'   -- Rafael
);

insert into public.project_members (user_id, project_id)
select u.id, p.id
from public.users u
cross join public.projects p
where u.id in (
  '1e2001c5-72b2-44a6-9605-9954db51908e',
  '5719747f-ccc2-4e4e-8b10-13bb026fe725',
  'b63d846e-1780-4040-9a3a-468fb9bfb683'
)
on conflict do nothing;

insert into public.project_admins (user_id, project_id)
select u.id, p.id
from public.users u
cross join public.projects p
where u.id in (
  '1e2001c5-72b2-44a6-9605-9954db51908e',
  '5719747f-ccc2-4e4e-8b10-13bb026fe725',
  'b63d846e-1780-4040-9a3a-468fb9bfb683'
)
on conflict do nothing;


-- ─── 3. The policies, restated ──────────────────────────────────────────────
-- Dropped under every name they have carried across six migrations, so
-- whatever is installed is replaced rather than left sitting alongside. One
-- of the old ones is FOR ALL, which covers INSERT too.

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
    -- every tab on it, "Rafa" and "Kasim" included.
    or (owner_id is null and public.is_project_admin(project_id))
    -- Somebody else's list, if you administer the project. owner_id must
    -- match the list's owner, so this cannot write a row claiming one
    -- person's board while sitting in another's list.
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


-- ─── 5. Confirm ─────────────────────────────────────────────────────────────
-- All three rows must now read is_owner true, and project_admin_rows must
-- equal total_projects. If they do, every one of these accounts can write to
-- the shared board and the error is gone.

select
  u.name,
  u.email,
  u.is_owner,
  (select count(*) from public.project_admins a where a.user_id = u.id)  as project_admin_rows,
  (select count(*) from public.project_members m where m.user_id = u.id) as membership_rows,
  (select count(*) from public.projects)                                 as total_projects
from public.users u
where u.id in (
  '1e2001c5-72b2-44a6-9605-9954db51908e',
  '5719747f-ccc2-4e4e-8b10-13bb026fe725',
  'b63d846e-1780-4040-9a3a-468fb9bfb683'
)
order by u.name;
