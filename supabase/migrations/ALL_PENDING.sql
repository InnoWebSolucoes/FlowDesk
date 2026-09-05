-- ============================================================================
-- FlowDesk - all outstanding migrations, combined.
--
-- Run this once, whole, in the Supabase SQL editor.
--
-- Safe to run more than once, and safe to run if some of these have already
-- been applied: every statement is guarded (if not exists / or replace /
-- drop policy if exists), so re-running is a no-op rather than an error.
--
-- Contains, in order:
--   1. Employee workspace     - owner_id on todo lists, todos and notes
--   2. Activity notifications - triggers telling managers what staff do
--   3. Task dates             - task deadlines and per-assignee do dates
--   4. Rich notes             - note content and drawings
--   5. Relative cluster access
-- ============================================================================


-- ############################################################################
-- 1. 20260905000000_employee_workspace.sql
-- ############################################################################

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
drop policy if exists "project_todo_lists_select" on public.project_todo_lists;
create policy "project_todo_lists_select" on public.project_todo_lists
  for select to authenticated using (
    owner_id = auth.uid()
    or (public.is_admin() and (owner_id is null or public.is_my_employee(owner_id)))
  );

-- Write: an employee owns their own lists outright, and admins own the shared
-- board. Nobody writes someone else's — an admin reading an employee's list
-- must not be able to rename or delete it.
drop policy if exists "project_todo_lists_insert" on public.project_todo_lists;
create policy "project_todo_lists_insert" on public.project_todo_lists
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_admin())
  );

drop policy if exists "project_todo_lists_update" on public.project_todo_lists;
create policy "project_todo_lists_update" on public.project_todo_lists
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

drop policy if exists "project_todo_lists_delete" on public.project_todo_lists;
create policy "project_todo_lists_delete" on public.project_todo_lists
  for delete to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

-- ─── Todos ──────────────────────────────────────────────────────────────────

drop policy if exists "project_todos_select" on public.project_todos;
drop policy if exists "project_todos_write_admin" on public.project_todos;

-- Read: your own todos; the ones assigned to or shared with you; and, for
-- admins, the shared manager board plus any employee's list (read-only).
drop policy if exists "project_todos_select" on public.project_todos;
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
drop policy if exists "project_todos_insert" on public.project_todos;
create policy "project_todos_insert" on public.project_todos
  for insert to authenticated with check (
    (owner_id = auth.uid() and public.todo_list_owner(list_id) = auth.uid())
    or (owner_id is null and public.is_admin())
  );

drop policy if exists "project_todos_update" on public.project_todos;
create policy "project_todos_update" on public.project_todos
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

drop policy if exists "project_todos_delete" on public.project_todos;
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

drop policy if exists "project_todo_links_select" on public.project_todo_links;
create policy "project_todo_links_select" on public.project_todo_links
  for select to authenticated using (public.can_view_todo(todo_id));

drop policy if exists "project_todo_links_write" on public.project_todo_links;
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

drop policy if exists "project_notes_select" on public.project_notes;
create policy "project_notes_select" on public.project_notes
  for select to authenticated using (
    owner_id = auth.uid()
    or (public.is_admin() and (owner_id is null or public.is_my_employee(owner_id)))
  );

drop policy if exists "project_notes_insert" on public.project_notes;
create policy "project_notes_insert" on public.project_notes
  for insert to authenticated with check (
    (owner_id = auth.uid() and project_id = coalesce(public.my_project_id(), project_id))
    or (owner_id is null and public.is_admin())
  );

drop policy if exists "project_notes_update" on public.project_notes;
create policy "project_notes_update" on public.project_notes
  for update to authenticated
  using (owner_id = auth.uid() or (owner_id is null and public.is_admin()))
  with check (owner_id = auth.uid() or (owner_id is null and public.is_admin()));

drop policy if exists "project_notes_delete" on public.project_notes;
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

drop policy if exists "project_note_items_select" on public.project_note_items;
create policy "project_note_items_select" on public.project_note_items
  for select to authenticated using (public.can_view_note(note_id));

drop policy if exists "project_note_items_write" on public.project_note_items;
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

drop policy if exists "resource_items_insert_employee" on public.resource_items;
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

drop policy if exists "resource_items_update_own" on public.resource_items;
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

drop policy if exists "resource_items_delete_own" on public.resource_items;
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

drop policy if exists "resource_item_links_write" on public.resource_item_links;
create policy "resource_item_links_write" on public.resource_item_links
  for all to authenticated
  using (public.can_edit_resource_item(item_id))
  with check (public.can_edit_resource_item(item_id));

-- Version history on a document follows whoever may edit it, so an employee
-- can upload a new version of their own file rather than only their first one.
drop policy if exists "resource_item_versions_write_admin" on public.resource_item_versions;

drop policy if exists "resource_item_versions_write" on public.resource_item_versions;
create policy "resource_item_versions_write" on public.resource_item_versions
  for all to authenticated
  using (public.can_edit_resource_item(item_id))
  with check (public.can_edit_resource_item(item_id));

-- Tagging a document into other clusters, same rule.
drop policy if exists "resource_item_clusters_write_admin" on public.resource_item_clusters;

drop policy if exists "resource_item_clusters_write" on public.resource_item_clusters;
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

drop policy if exists "attachments_insert_resources_employee" on storage.objects;
create policy "attachments_insert_resources_employee" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'resources'
    and (storage.foldername(name))[2] = public.my_project_id()::text
  );

-- Re-uploading over an existing path is an UPDATE, not an insert: without this
-- an employee could upload a file once and never replace it.
drop policy if exists "attachments_update_resources_employee" on storage.objects;
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

drop policy if exists "attachments_delete_resources_employee" on storage.objects;
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


-- ############################################################################
-- 2. 20260906000000_activity_notifications.sql
-- ############################################################################

-- Tell the managers what their staff are doing.
--
-- Until now every notification was derived on the client, in NotificationBell,
-- from task due dates. That has two consequences: nothing an employee actually
-- *does* ever notified anyone, and a notification only came into existence if
-- the right person happened to have the app open at the right moment.
--
-- These are triggers instead. The database raises them at the moment the thing
-- happens, so a manager is told whether or not anyone is looking, and the
-- record exists exactly once no matter how many clients are running.
--
-- Every one targets the admin role rather than a user, which is how the
-- existing notification fan-out already works: target_role = 'admin' is read
-- by every manager (see notifications_select).

-- ─── New notification kinds ─────────────────────────────────────────────────
-- The type column is a check constraint, so the new kinds have to be allowed
-- before anything can insert them.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    -- Existing kinds, unchanged.
    'task_assigned',
    'task_due_today',
    'task_due_tomorrow',
    'task_overdue',
    'comment_added',
    'workload_alert',
    'inactivity_alert',
    -- What an employee does.
    'task_started',
    'task_completed',
    'task_reopened',
    'file_uploaded'
  ));

-- The client de-duplicates by (type, task, target, day) before inserting. The
-- triggers below fire per event and are deliberately not deduplicated: a
-- manager wants to see that a task was started twice, or commented on twice.

-- ─── Who did it ─────────────────────────────────────────────────────────────
-- Definer so a trigger can read a name without the actor needing to be able to
-- select that row themselves.

create or replace function public.actor_name(actor uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(name, email, 'Someone') from public.users where id = actor;
$fn$;

create or replace function public.task_title(task uuid)
returns text
language sql stable security definer set search_path = public as $fn$
  select coalesce(title, 'a task') from public.tasks where id = task;
$fn$;

-- Admins do not need telling about their own actions: a manager completing a
-- task on someone's behalf should not notify the manager who just did it.
create or replace function public.actor_is_employee(actor uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.users where id = actor and role = 'employee'
  );
$fn$;

-- ─── Started a task ─────────────────────────────────────────────────────────
-- task_statuses only ever holds 'in_progress', so a row appearing is the
-- employee saying they have started.

create or replace function public.notify_task_started()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(new.employee_id) then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_started',
    'Task started',
    public.actor_name(new.employee_id) || ' started "' || public.task_title(new.task_id) || '"',
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_statuses_notify on public.task_statuses;
create trigger task_statuses_notify
  after insert on public.task_statuses
  for each row execute function public.notify_task_started();

-- ─── Completed a task ───────────────────────────────────────────────────────

create or replace function public.notify_task_completed()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(new.employee_id) then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_completed',
    case when new.was_late then 'Task completed late' else 'Task completed' end,
    public.actor_name(new.employee_id) || ' completed "' || public.task_title(new.task_id) || '"'
      || case when new.was_late then ' (late)' else '' end,
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists completion_logs_notify on public.completion_logs;
create trigger completion_logs_notify
  after insert on public.completion_logs
  for each row execute function public.notify_task_completed();

-- ─── Un-completed a task ────────────────────────────────────────────────────
-- Marking something done and then undoing it is worth knowing about: it is the
-- one action that silently moves work back into the queue.

create or replace function public.notify_task_reopened()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.actor_is_employee(old.employee_id) then
    return old;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'task_reopened',
    'Task marked not done',
    public.actor_name(old.employee_id) || ' reopened "' || public.task_title(old.task_id) || '"',
    old.task_id,
    null,
    'admin'
  );
  return old;
end;
$fn$;

drop trigger if exists completion_logs_notify_delete on public.completion_logs;
create trigger completion_logs_notify_delete
  after delete on public.completion_logs
  for each row execute function public.notify_task_reopened();

-- ─── Commented on a task ────────────────────────────────────────────────────
-- Managers could already read every comment; they were simply never told one
-- had been written, which is why they went unnoticed.

create or replace function public.notify_comment_added()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  preview text;
begin
  if not public.actor_is_employee(new.author_id) then
    return new;
  end if;

  -- A comment can be long; the notification carries enough to recognise it.
  preview := regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g');
  if length(preview) > 120 then
    preview := left(preview, 117) || '…';
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'comment_added',
    'New comment',
    public.actor_name(new.author_id) || ' on "' || public.task_title(new.task_id) || '": ' || preview,
    new.task_id,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify
  after insert on public.task_comments
  for each row execute function public.notify_comment_added();

-- ─── Attached a file to a comment ───────────────────────────────────────────
-- Separate from the comment itself: a file is the thing a manager most often
-- needs to go and look at.

create or replace function public.notify_file_uploaded()
returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  parent_task uuid;
begin
  -- uploaded_by is on the attachment itself, so the uploader is known without
  -- going through the comment. The comment is only needed for which task.
  if not public.actor_is_employee(new.uploaded_by) then
    return new;
  end if;

  select task_id into parent_task from public.task_comments where id = new.comment_id;
  if parent_task is null then
    return new;
  end if;

  insert into public.notifications (type, title, message, task_id, target_user_id, target_role)
  values (
    'file_uploaded',
    'File uploaded',
    public.actor_name(new.uploaded_by) || ' attached "' || coalesce(new.name, 'a file')
      || '" to "' || public.task_title(parent_task) || '"',
    parent_task,
    null,
    'admin'
  );
  return new;
end;
$fn$;

drop trigger if exists task_attachments_notify on public.task_attachments;
create trigger task_attachments_notify
  after insert on public.task_attachments
  for each row execute function public.notify_file_uploaded();

-- ─── Employees writing their own boards ─────────────────────────────────────
-- Their private todos and notes are deliberately NOT notified: they are that
-- person's own workspace, and a manager being pinged for every line an
-- employee writes on their own list would bury the notifications that matter.
-- Managers can look at those boards from the employee's profile when they want
-- to. See 20260905000000_employee_workspace.sql.

-- ─── Live delivery ──────────────────────────────────────────────────────────
-- A trigger fires on the employee's action, but the manager's app is a
-- different client entirely. Without the table in the realtime publication the
-- manager would only see these by reloading, which defeats the point of
-- notifying at all.
--
-- Realtime still applies RLS per subscriber, so this does not widen who can
-- see what: a manager receives the admin-targeted rows, and an employee
-- receives only their own.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception
  -- A self-hosted or differently-named setup may not have this publication.
  -- The triggers above still work; only live delivery is lost.
  when undefined_object then
    raise notice 'supabase_realtime publication not found; notifications will not stream live';
end $$;


-- ############################################################################
-- 3. 20260907000000_task_dates.sql
-- ############################################################################

-- Two dates on a task, the way the todos already have them.
--
-- Until now a task had only its recurrence: a one-off carried a date inside
-- its frequency JSON, and everything else had no date at all. So "what do I
-- have to finish by today" could not be answered, and nothing an employee was
-- assigned ever reached their calendar.
--
--   deadline  — the date it must be finished by. Set by the manager when the
--               task is created, and may be left empty.
--   do_date   — the day the employee plans to actually do it. Theirs to set,
--               and what the calendar shows. May also be empty.
--
-- This mirrors project_todos exactly (due_date / do_date), so both kinds of
-- work read the same way on the calendar.

-- ─── The deadline lives on the task ─────────────────────────────────────────
-- One deadline for the task, set by whoever assigned it.

alter table public.tasks
  add column if not exists deadline date;

create index if not exists tasks_deadline_idx on public.tasks(deadline);

-- Backfill: a one-off's frequency date has always been its deadline in all but
-- name, so carry it across rather than losing it.
update public.tasks
set deadline = (frequency->>'date')::date
where deadline is null
  and frequency->>'type' = 'one-off'
  and frequency->>'date' is not null
  -- Guard against a malformed value stopping the whole migration.
  and (frequency->>'date') ~ '^\d{4}-\d{2}-\d{2}';

-- ─── The do date is per person ──────────────────────────────────────────────
-- A task can be assigned to several people, and they will not all plan to do
-- it on the same day, so the do date belongs to the assignment rather than the
-- task. task_assignments is already keyed (task_id, employee_id).

alter table public.task_assignments
  add column if not exists do_date date,
  -- Optional time window, so a task can be dropped into a specific slot on the
  -- calendar rather than sitting as an all-day item.
  add column if not exists do_start time,
  add column if not exists do_end time;

create index if not exists task_assignments_do_date_idx
  on public.task_assignments(employee_id, do_date);

-- ─── Employees schedule their own work ──────────────────────────────────────
-- Assignments were admin-only for writes, which is right for *who* a task goes
-- to, but an employee has to be able to say when they intend to do it.
-- Updating their own row is allowed; inserting or deleting one is not, so they
-- still cannot assign work to themselves or drop it.

drop policy if exists "task_assignments_update_own" on public.task_assignments;
create policy "task_assignments_update_own" on public.task_assignments
  for update to authenticated
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid());

-- ─── Live delivery ──────────────────────────────────────────────────────────
-- An admin assigning a task writes on their machine; the employee's app is a
-- different client. Without these in the realtime publication the employee had
-- to reload before a new task appeared, which is what made the app feel stale.
--
-- RLS still applies per subscriber, so this changes delivery, not visibility.

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks',
    'task_assignments',
    'completion_logs',
    'task_statuses',
    'task_comments',
    'project_todos',
    'project_todo_lists',
    'project_notes',
    'project_note_items',
    'calendar_entries'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; live updates unavailable';
end $$;


-- ############################################################################
-- 4. 20260908000000_rich_notes.sql
-- ############################################################################

-- Notes become documents, not sticky labels.
--
-- The board was built as Google Keep: a title, a plain-text body, and an
-- optional flat checklist. That is too little to actually write in — no
-- formatting, no tables, no drawings, and a note you could not really come
-- back to and keep working on.
--
-- The body becomes rich content (HTML from the editor). The plain body is
-- kept and backfilled into it, so nothing written so far is lost, and it stays
-- as the search/preview text.

alter table public.project_notes
  -- Rich HTML from the editor. Empty until the note is edited, at which point
  -- the plain body below is migrated into it.
  add column if not exists content text not null default '',
  -- Reserved for storing drawings as re-editable strokes. Drawings currently
  -- embed into `content` as images, which cannot be reopened for editing;
  -- this is where the stroke data will live when that is addressed. Unused
  -- for now, and harmless to keep so the column need not be added later.
  add column if not exists drawings jsonb not null default '[]'::jsonb;

-- Carry every existing note's plain body into the rich field, as paragraphs.
-- Done once: after this the editor owns `content`, and `body` is the plain
-- text mirror kept for searching.
update public.project_notes
set content = '<p>' || replace(
    replace(replace(replace(body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
    E'\n', '</p><p>'
  ) || '</p>'
where content = '' and coalesce(body, '') <> '';

-- Existing checklists become task lists in the rich body, so the conversion
-- does not silently drop them. Items stay in their own table as well, which
-- keeps the old checklist rendering working for notes nobody has opened yet.
update public.project_notes n
set content = n.content || coalesce((
  select '<ul data-type="taskList">' || string_agg(
    '<li data-type="taskItem" data-checked="' || (case when i.is_checked then 'true' else 'false' end) || '"><p>'
      || replace(replace(replace(i.text, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
      || '</p></li>',
    '' order by i.sort_order
  ) || '</ul>'
  from public.project_note_items i
  where i.note_id = n.id
), '')
where exists (select 1 from public.project_note_items i where i.note_id = n.id)
  -- Only once: re-running must not append the checklist a second time.
  and n.content not like '%data-type="taskList"%';


-- ############################################################################
-- 5. 20260909000000_cluster_relative_access.sql
-- ############################################################################

-- Sharing a cluster without overriding what is inside it.
--
-- Cluster access is inherited restrictively: a document is visible only if its
-- own access allows it AND every cluster it sits in allows it. That is the
-- right default — setting a cluster to "managers only" must not be undone by
-- one permissive document inside it.
--
-- But it makes the opposite intent impossible to express: "let this person
-- into the cluster, and they see whatever their own access already entitles
-- them to". Under the old model, opening the cluster to someone was the only
-- way to let them in, and it opened the cluster for everything.
--
--   relative — the named people may enter the cluster; each document inside is
--              then judged on its own access, exactly as it would be anywhere
--              else. Entry, not a blanket grant.
--
-- The existing levels are unchanged.

alter table public.resource_clusters
  drop constraint if exists resource_clusters_access_check;

alter table public.resource_clusters
  add constraint resource_clusters_access_check check (access in (
    'everyone',
    'managers',
    'employees',
    'specific',
    'relative'
  ));

-- A cluster the caller may enter. 'relative' behaves like 'specific' for the
-- purpose of getting in; the difference is entirely in what happens to the
-- documents once inside, which is handled by item_clusters_allow below.
create or replace function public.cluster_access_allows(cluster uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.resource_clusters c
    where c.id = cluster
      and (
        c.access in ('everyone', 'employees')
        or (
          c.access in ('specific', 'relative')
          and exists (
            select 1 from public.resource_cluster_access a
            where a.cluster_id = c.id and a.user_id = auth.uid()
          )
        )
      )
  );
$fn$;

-- Does every cluster this document sits in allow it through?
--
-- A 'relative' cluster deliberately does not gate its contents beyond letting
-- you in: the document's own access decides, which is the whole point of the
-- level. Every other level keeps inheriting restrictively as before.
create or replace function public.item_clusters_allow(item uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select not exists (
    select 1
    from public.resource_item_clusters ic
    join public.resource_clusters c on c.id = ic.cluster_id
    where ic.item_id = item
      and c.access <> 'relative'
      and not public.cluster_chain_allows(ic.cluster_id)
  );
$fn$;
