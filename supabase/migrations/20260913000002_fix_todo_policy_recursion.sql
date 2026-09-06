-- "infinite recursion detected in policy for relation project_todos"
--
-- project_todos_select asks project_todo_shares whether the row is shared with
-- you. 20260911000001 then gave project_todo_shares a policy that asks
-- project_todos which project the todo belongs to. Reading either table now
-- requires reading the other, and Postgres stops with a recursion error — so
-- the calendar, which reads todos on load, showed nothing at all.
--
-- The codebase already has the answer to this, from the calendar's own
-- recursion fix in 20260824000005: ask through a security definer function,
-- which does not re-enter RLS. todo_owner() and todo_project() are the two
-- facts the child policies actually need.

create or replace function public.todo_project(todo uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select project_id from public.project_todos where id = todo;
$fn$;

grant execute on function public.todo_project(uuid) to authenticated;

-- ─── Links ──────────────────────────────────────────────────────────────────

drop policy if exists "project_todo_links_write_scoped" on public.project_todo_links;
drop policy if exists "project_todo_links_write" on public.project_todo_links;
create policy "project_todo_links_write" on public.project_todo_links
  for all to authenticated
  using (
    public.todo_owner(todo_id) = auth.uid()
    or (
      public.todo_owner(todo_id) is null
      and public.is_project_admin(public.todo_project(todo_id))
    )
  )
  with check (
    public.todo_owner(todo_id) = auth.uid()
    or (
      public.todo_owner(todo_id) is null
      and public.is_project_admin(public.todo_project(todo_id))
    )
  );

-- ─── Shares ─────────────────────────────────────────────────────────────────

drop policy if exists "project_todo_shares_write_scoped" on public.project_todo_shares;
drop policy if exists "project_todo_shares_write_admin" on public.project_todo_shares;
create policy "project_todo_shares_write" on public.project_todo_shares
  for all to authenticated
  using (
    public.todo_owner(todo_id) = auth.uid()
    or (
      public.todo_owner(todo_id) is null
      and public.is_project_admin(public.todo_project(todo_id))
    )
  )
  with check (
    public.todo_owner(todo_id) = auth.uid()
    or (
      public.todo_owner(todo_id) is null
      and public.is_project_admin(public.todo_project(todo_id))
    )
  );

-- ─── Notes have the same shape ──────────────────────────────────────────────
-- project_note_items_write_scoped reads project_notes the same way. Nothing
-- reads back the other direction today, so it does not recurse — but it is one
-- policy away from doing so, and note_owner() already exists for it.

create or replace function public.note_project(note uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select project_id from public.project_notes where id = note;
$fn$;

grant execute on function public.note_project(uuid) to authenticated;

drop policy if exists "project_note_items_write_scoped" on public.project_note_items;
drop policy if exists "project_note_items_write" on public.project_note_items;
create policy "project_note_items_write" on public.project_note_items
  for all to authenticated
  using (
    public.note_owner(note_id) = auth.uid()
    or (
      public.note_owner(note_id) is null
      and public.is_project_admin(public.note_project(note_id))
    )
  )
  with check (
    public.note_owner(note_id) = auth.uid()
    or (
      public.note_owner(note_id) is null
      and public.is_project_admin(public.note_project(note_id))
    )
  );
