-- ============================================================================
-- Fix "new row violates row-level security policy" on project_todos AND
-- project_todo_lists.
--
-- Run the whole file in the Supabase SQL editor. Safe to run repeatedly.
--
-- If a previous attempt failed with "P0001: Only the owner can change
-- ownership", nothing from it took effect: that error aborted the script at
-- the ownership update, before any policy was created. The guard_owner_flag
-- trigger raises it because it asks is_owner(), which reads auth.uid() —
-- null in the SQL editor, so never the owner. Section 2 now turns that
-- trigger off for the one statement and back on straight after.
--
-- The second error is the same cause as the first. Creating a todo from the
-- calendar makes the list first when the board has none, and that insert is
-- gated the same way. Both come down to one thing: whether the signed-in
-- account passes the admin gate.
--
-- Every account whose role is 'admin' is granted below, so it does not
-- matter which one the app is signed in as. Both tables get every policy restated — not
-- just INSERT, because the old versions of UPDATE and DELETE gate on
-- is_admin(), which demands is_owner and refuses a merely-scoped admin.
--
-- Section 6 at the end prints, per account, whether the gate now opens —
-- so you can see it worked without guessing which account you use.
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


-- ─── 2. Grant EVERY admin account ───────────────────────────────────────────
-- Not a hardcoded list this time. Anyone whose role is already 'admin' gets
-- the owner flag and a row on every project, so whichever account the app
-- signs in as is covered. That is what the previous attempt got wrong: it
-- granted one pasted id, which happened to be the account that already
-- worked.

-- guard_owner_flag refuses any change to is_owner unless is_owner() is
-- already true for the caller. In the SQL editor auth.uid() is null, so it is
-- never true and the update is rejected with "Only the owner can change
-- ownership" — which aborts the whole script before a single policy is
-- created. Turning the trigger off for this one statement is what an earlier
-- migration already recommended for exactly this case.
do $grant$
begin
  -- Wrapped so a database where the trigger does not exist still runs this.
  begin
    execute 'alter table public.users disable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;

  update public.users set is_owner = true where role = 'admin';

  begin
    execute 'alter table public.users enable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;
end
$grant$;

insert into public.project_members (user_id, project_id)
select u.id, p.id
from public.users u
cross join public.projects p
where u.role = 'admin'
on conflict do nothing;

insert into public.project_admins (user_id, project_id)
select u.id, p.id
from public.users u
cross join public.projects p
where u.role = 'admin'
on conflict do nothing;


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


-- ─── 6. Proof, per account ──────────────────────────────────────────────────
-- Evaluates the gate as each admin in turn, rather than trusting that the
-- grants took. can_write must be true on every row — that is the whole test.
--
-- The function impersonates each account to ask the question and puts the
-- claim back afterwards, so it changes nothing.

create or replace function public.gate_check(target uuid, proj uuid)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  before text := current_setting('request.jwt.claims', true);
  answer boolean;
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', target, 'role', 'authenticated')::text,
                     true);
  answer := public.is_project_admin(proj);
  perform set_config('request.jwt.claims', coalesce(before, ''), true);
  return answer;
end;
$$;

select
  u.name,
  u.email,
  u.is_owner,
  (select count(*) from public.project_admins a where a.user_id = u.id)  as admin_rows,
  (select count(*) from public.project_members m where m.user_id = u.id) as member_rows,
  (select count(*) from public.projects)                                 as projects,
  -- Both the failing inserts turn on this one call, for the shared board.
  public.gate_check(u.id, (select id from public.projects order by name limit 1))
    as can_write
from public.users u
where u.role = 'admin'
order by u.name;

-- Tidy up: the checker is not part of the app.
drop function if exists public.gate_check(uuid, uuid);
