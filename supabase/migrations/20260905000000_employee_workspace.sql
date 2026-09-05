-- The employee's own workspace.
--
-- Until now todo lists and notes were manager-only in every direction: an
-- employee could not read them, let alone create one. But an employee needs
-- the same tools the managers have — their own lists, their own board — without
-- being able to touch the managers' ones.
--
-- The split is an owner: a row with owner_id null is the project's shared
-- manager board, exactly what exists today; a row with an owner_id is that
-- person's private one. Employees manage their own rows and see nothing else.
-- Admins keep the shared board and may READ an employee's, so an owner can
-- check in on their team without being able to edit or delete their work.

-- ─── Ownership ──────────────────────────────────────────────────────────────

alter table public.project_todo_lists
  add column if not exists owner_id uuid references public.users(id) on delete cascade;

alter table public.project_notes
  add column if not exists owner_id uuid references public.users(id) on delete cascade;

-- Existing rows predate this and belong to the shared manager board, which is
-- what owner_id null already means. No backfill needed.

create index if not exists project_todo_lists_owner_idx
  on public.project_todo_lists(owner_id);
create index if not exists project_notes_owner_idx
  on public.project_notes(owner_id, is_archived, sort_order);

-- A todo inherits its owner from the list it sits in. Denormalised onto the
-- todo so its policies don't have to join back to the list on every row.
alter table public.project_todos
  add column if not exists owner_id uuid references public.users(id) on delete cascade;

create index if not exists project_todos_owner_idx on public.project_todos(owner_id);

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- Definer functions, so the policies below never re-enter the policies of the
-- table they are asking about — the loop that caused the calendar recursion.

-- Who owns the list a todo belongs to. Null for the shared manager board.
create or replace function public.todo_list_owner(list uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select owner_id from public.project_todo_lists where id = list;
$fn$;

-- An employee whose work an admin may look at. Admins manage every project, so
-- this is really "the caller is an admin and the target is an employee".
create or replace function public.is_my_employee(target uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() and exists (
    select 1 from public.users u where u.id = target and u.role = 'employee'
  );
$fn$;

-- ─── Todo lists ─────────────────────────────────────────────────────────────

drop policy if exists "project_todo_lists_admin" on public.project_todo_lists;

-- Read: your own lists always; admins additionally read the shared board and,
-- read-only, any employee's list.
create policy "project_todo_lists_select" on public.project_todo_lists
  for select to authenticated using (
    owner_id = auth.uid()
    or (public.is_admin() and (owner_id is null or public.is_my_employee(owner_id)))
  );

-- Write: an employee owns their own lists outright, and admins own the shared
-- board. Nobody writes someone else's — an admin reading an employee's list
-- must not be able to rename or delete it.
create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_admin())
  );

create policy "project_todo_lists_update" on public.project_todo_lists
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

create policy "project_todo_lists_delete" on public.project_todo_lists
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

-- ─── Todos ──────────────────────────────────────────────────────────────────

drop policy if exists "project_todos_select" on public.project_todos;
drop policy if exists "project_todos_write_admin" on public.project_todos;

-- Read: your own todos; the ones assigned to or shared with you; and, for
-- admins, the shared manager board plus any employee's list (read-only).
create policy "project_todos_select" on public.project_todos
  for select to authenticated using (
    owner_id = auth.uid()
    or assignee_id = auth.uid()
    or exists (
      select 1 from public.project_todo_shares s
      where s.todo_id = project_todos.id and s.user_id = auth.uid()
    )
    or (public.is_admin() and (owner_id is null or public.is_my_employee(owner_id)))
  );

-- Write: whoever owns the list the todo lands in. An employee cannot drop a
-- todo into the managers' list — owner_id must be them, and the list they name
-- must be theirs too.
create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    or (owner_id is null and public.is_admin())
  );

create policy "project_todos_update" on public.project_todos
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

create policy "project_todos_delete" on public.project_todos
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

-- ─── Todo links ─────────────────────────────────────────────────────────────
-- A link is readable with its todo, and writable by whoever owns that todo.

drop policy if exists "project_todo_links_admin" on public.project_todo_links;

create or replace function public.todo_owner(todo uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select owner_id from public.project_todos where id = todo;
$fn$;

-- Mirrors the todo's own read rule, in a definer function so the link policy
-- does not re-enter project_todos' RLS.
create or replace function public.can_view_todo(todo uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.project_todos t
    where t.id = todo
      and (
        t.owner_id = auth.uid()
        or t.assignee_id = auth.uid()
        or exists (
          select 1 from public.project_todo_shares s
          where s.todo_id = t.id and s.user_id = auth.uid()
        )
        or (public.is_admin() and (t.owner_id is null or public.is_my_employee(t.owner_id)))
      )
  );
$fn$;

create policy "project_todo_links_select" on public.project_todo_links
  for select to authenticated using (public.can_view_todo(todo_id));

create policy "project_todo_links_write" on public.project_todo_links
  for all to authenticated
  using (
    public.todo_owner(todo_id) = auth.uid()
    or (public.todo_owner(todo_id) is null and public.is_admin())
  )
  with check (
    public.todo_owner(todo_id) = auth.uid()
    or (public.todo_owner(todo_id) is null and public.is_admin())
  );

-- ─── Notes ──────────────────────────────────────────────────────────────────

drop policy if exists "project_notes_admin" on public.project_notes;
drop policy if exists "project_note_items_admin" on public.project_note_items;

create policy "project_notes_select" on public.project_notes
  for select to authenticated using (
    owner_id = auth.uid()
    or (public.is_admin() and (owner_id is null or public.is_my_employee(owner_id)))
  );

create policy "project_notes_insert" on public.project_notes
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_admin())
  );

create policy "project_notes_update" on public.project_notes
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

create policy "project_notes_delete" on public.project_notes
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

create or replace function public.note_owner(note uuid)
returns uuid
language sql stable security definer set search_path = public as $fn$
  select owner_id from public.project_notes where id = note;
$fn$;

create or replace function public.can_view_note(note uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.project_notes n
    where n.id = note
      and (
        n.owner_id = auth.uid()
        or (public.is_admin() and (n.owner_id is null or public.is_my_employee(n.owner_id)))
      )
  );
$fn$;

create policy "project_note_items_select" on public.project_note_items
  for select to authenticated using (public.can_view_note(note_id));

create policy "project_note_items_write" on public.project_note_items
  for all to authenticated
  using (
    public.note_owner(note_id) = auth.uid()
    or (public.note_owner(note_id) is null and public.is_admin())
  )
  with check (
    public.note_owner(note_id) = auth.uid()
    or (public.note_owner(note_id) is null and public.is_admin())
  );

-- ─── Resources: employees may add their own documents ───────────────────────
--
-- Reading was already open to employees through the access model. Uploading
-- was not: every write policy on resources is admin-only. An employee may now
-- create a document in a cluster they can see, and edit or delete the ones
-- they created — never anyone else's, and never a cluster, since clusters
-- carry the access rules that decide who sees what.

create policy "resource_items_insert_employee" on public.resource_items
  for insert to authenticated with check (
    project_id = public.my_project_id()
    -- Only where they can already see: a cluster they can reach, or the
    -- project's main space.
    and (cluster_id is null or public.cluster_chain_allows(cluster_id))
    -- Their own, and never pre-restricted in a way they could not undo.
    and created_by = auth.uid()
    and access in ('everyone', 'employees')
  );

create policy "resource_items_update_own" on public.resource_items
  for update to authenticated
  using (created_by = auth.uid() and project_id = public.my_project_id())
  -- They keep it visible to the project: an employee must not be able to hide
  -- a document from the managers responsible for it.
  with check (
    created_by = auth.uid()
    and project_id = public.my_project_id()
    and access in ('everyone', 'employees')
  );

create policy "resource_items_delete_own" on public.resource_items
  for delete to authenticated
  using (created_by = auth.uid() and project_id = public.my_project_id());

-- The links attached to a document follow whoever may edit it.
create or replace function public.can_edit_resource_item(item uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select public.is_admin() or exists (
    select 1 from public.resource_items ri
    where ri.id = item
      and ri.created_by = auth.uid()
      and ri.project_id = public.my_project_id()
  );
$fn$;

drop policy if exists "resource_item_links_write_admin" on public.resource_item_links;

create policy "resource_item_links_write" on public.resource_item_links
  for all to authenticated
  using (public.can_edit_resource_item(item_id))
  with check (public.can_edit_resource_item(item_id));

-- Version history on a document follows whoever may edit it, so an employee
-- can upload a new version of their own file rather than only their first one.
drop policy if exists "resource_item_versions_write_admin" on public.resource_item_versions;

create policy "resource_item_versions_write" on public.resource_item_versions
  for all to authenticated
  using (public.can_edit_resource_item(item_id))
  with check (public.can_edit_resource_item(item_id));

-- Tagging a document into other clusters, same rule.
drop policy if exists "resource_item_clusters_write_admin" on public.resource_item_clusters;

create policy "resource_item_clusters_write" on public.resource_item_clusters
  for all to authenticated
  using (public.can_edit_resource_item(item_id))
  with check (
    public.can_edit_resource_item(item_id)
    and (public.is_admin() or public.cluster_chain_allows(cluster_id))
  );

-- ─── The files themselves ───────────────────────────────────────────────────
-- An employee uploading a document needs to write its bytes, and to delete
-- them again if they remove the document. The path convention is
-- resources/{projectId}/…, so the project segment is what gates it.

create policy "attachments_insert_resources_employee" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (storage.foldername(name))[2] = public.my_project_id()::text
  );

-- Re-uploading over an existing path is an UPDATE, not an insert: without this
-- an employee could upload a file once and never replace it.
create policy "attachments_update_resources_employee" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (storage.foldername(name))[2] = public.my_project_id()::text
    and exists (
      select 1 from public.resource_items ri
      where ri.storage_path = storage.objects.name
        and ri.created_by = auth.uid()
    )
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (storage.foldername(name))[2] = public.my_project_id()::text
  );

create policy "attachments_delete_resources_employee" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (storage.foldername(name))[2] = public.my_project_id()::text
    -- Only the bytes behind a document they created. Once the row is gone the
    -- orphaned object is an admin's to clear, which is the safe direction.
    and exists (
      select 1 from public.resource_items ri
      where ri.storage_path = storage.objects.name
        and ri.created_by = auth.uid()
    )
  );
