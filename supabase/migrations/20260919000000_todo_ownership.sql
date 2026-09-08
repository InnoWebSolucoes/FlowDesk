-- ============================================================================
-- Every todo belongs to somebody, and a manager may add one to a person's list.
--
-- Two problems, one cause: nothing on a todo row said whose it was unless it
-- was explicitly assigned.
--
-- 1. "new row violates row-level security policy for table project_todos".
--    The insert policy had exactly two branches: your own todo in your own
--    list, or a todo on the shared board if you administer the project. A
--    manager adding a todo to somebody else's list matched neither, so the
--    box just emptied and nothing was added.
--
-- 2. A todo on the shared board has owner_id null, and one nobody has been
--    assigned has assignee_id null, so it belonged to no one at all. On the
--    calendar that is a block with nobody's colour.
--
-- created_by already exists on the table but was never written, so the row
-- did not even record who added it. The app now sets it; this backfills what
-- is already there and makes it automatic from here on, so the rule
-- "assignee, else list owner, else creator" always lands on a real person.
-- ============================================================================

-- ─── Record who added a todo ────────────────────────────────────────────────

-- Existing rows: the shared board's todos were added by whoever administers
-- the project, and a personal todo by the person whose list it is on. The
-- latter is exactly right; the former is a guess, but a better one than null.
update public.project_todos t
set created_by = t.owner_id
where created_by is null
  and t.owner_id is not null;

-- Default it for anything that inserts without saying, so this cannot drift
-- again if some other code path forgets. The app sets it explicitly too;
-- both agree, and the default only fills a null.
alter table public.project_todos
  alter column created_by set default auth.uid();

-- Belt and braces: an insert that passes created_by = null explicitly beats a
-- column default, so pin it to the caller.
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


-- ─── Let a manager put a todo on somebody's list ────────────────────────────
-- The missing third branch. A project admin may write into any list belonging
-- to this project, whoever owns it, as long as owner_id and the list agree —
-- so the todo still lands on that person's board rather than floating free.

drop policy if exists "project_todos_insert" on public.project_todos;

create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    -- Your own todo, in your own list.
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    -- The shared board, if you administer the project. Kept as its own branch
    -- rather than folded into the one below: a shared-board todo can sit in a
    -- list the board owns, and the owner-matches-list test below would refuse
    -- it whenever that list has an owner.
    or (owner_id is null and public.is_project_admin(project_id))
    -- Somebody else's list, if you administer the project. owner_id must match
    -- the list's owner, so a manager cannot use this to write a row that
    -- claims to be on one person's board while sitting in another's list.
    or (
      public.is_project_admin(project_id)
      and owner_id is not distinct from public.todo_list_owner(list_id)
    )
  );


-- ─── The same for lists ─────────────────────────────────────────────────────
-- Creating the list a todo lands in is gated the same way, so a manager
-- setting up a board for somebody hits the same wall one step earlier.

drop policy if exists "project_todo_lists_insert" on public.project_todo_lists;

create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    -- Your own list, on your own project.
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    -- Any list on a project you administer: the shared board, or one you are
    -- setting up for somebody else.
    or public.is_project_admin(project_id)
  );


-- ─── Confirm ────────────────────────────────────────────────────────────────
-- No todo should be left with nobody it belongs to.

select
  count(*) filter (where created_by is null and owner_id is null and assignee_id is null)
    as belonging_to_nobody,
  count(*) as total
from public.project_todos;
