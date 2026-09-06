-- Two things: documents that could not be opened, and work that could not be
-- shown.
--
-- 1. A document sent in chat never reached the other person.
--
-- resource_items_select gates on `project_id = my_project_id()`, and
-- my_project_id() reads users.project_id — one project, the primary one. Since
-- membership moved to project_members, anyone whose primary project is not the
-- one a document lives in cannot read that document at all: the message
-- arrives, the attachment does not open. Membership decides now.
--
-- 2. There is nowhere to put the work itself.
--
-- task_attachments hangs off task_comments, and comments were replaced by chat
-- — so an employee finishing a task has no way to attach what they produced.
-- Files now attach to the task directly.

-- ─── Reading a document you have access to ──────────────────────────────────

create or replace function public.in_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p is not null
    and (
      exists (
        select 1 from public.project_members pm
        where pm.user_id = auth.uid() and pm.project_id = p
      )
      -- project_members is the source of truth, but a row that predates the
      -- backfill would otherwise vanish for its owner.
      or exists (
        select 1 from public.users u
        where u.id = auth.uid() and u.project_id = p
      )
    );
$$;

grant execute on function public.in_project(uuid) to authenticated;

drop policy if exists "resource_items_select" on public.resource_items;
create policy "resource_items_select" on public.resource_items
  for select to authenticated using (
    public.is_project_admin(project_id)
    or (
      public.in_project(project_id)
      and (
        access = 'everyone'
        or access = 'employees'
        or (access = 'specific' and public.can_access_resource_item(id))
      )
      and public.item_clusters_allow(id)
    )
  );

-- The clusters those documents sit in, or the folder a chat file lands in is
-- unreadable and the document with it.
drop policy if exists "resource_clusters_select" on public.resource_clusters;
create policy "resource_clusters_select" on public.resource_clusters
  for select to authenticated using (
    public.is_project_admin(project_id)
    or (public.in_project(project_id) and public.cluster_chain_allows(id))
  );

-- ─── Files on a task ────────────────────────────────────────────────────────
-- What was actually produced, attached to the task it was produced for.

create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  -- Which day's work this is. A recurring task is done again and again, and
  -- last Tuesday's photographs are not this Tuesday's.
  due_date date,
  name text not null,
  type text not null default '',
  size int not null default 0,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references public.users(id) on delete cascade
);

create index if not exists task_files_task_idx on public.task_files(task_id, due_date);

alter table public.task_files enable row level security;

-- Seen by whoever the task concerns: the people it is assigned to, and the
-- managers of its project.
drop policy if exists "task_files_select" on public.task_files;
create policy "task_files_select" on public.task_files
  for select to authenticated using (
    public.is_project_admin(public.task_project(task_id))
    or exists (
      select 1 from public.task_assignments ta
      where ta.task_id = task_files.task_id and ta.employee_id = auth.uid()
    )
  );

-- Added by the person doing the work, or by a manager of the project.
drop policy if exists "task_files_insert" on public.task_files;
create policy "task_files_insert" on public.task_files
  for insert to authenticated with check (
    uploaded_by = auth.uid()
    and (
      public.is_project_admin(public.task_project(task_id))
      or exists (
        select 1 from public.task_assignments ta
        where ta.task_id = task_files.task_id and ta.employee_id = auth.uid()
      )
    )
  );

-- Removed by whoever put it there, or by a manager.
drop policy if exists "task_files_delete" on public.task_files;
create policy "task_files_delete" on public.task_files
  for delete to authenticated using (
    uploaded_by = auth.uid()
    or public.is_project_admin(public.task_project(task_id))
  );

-- Live, so a manager sees the work appear rather than on their next reload.
do $$
begin
  alter publication supabase_realtime add table public.task_files;
exception when duplicate_object then null;
end $$;

-- ─── The bytes behind them ──────────────────────────────────────────────────
-- Filed under tasks/{taskId}/…, so the task segment is what gates access.

drop policy if exists "attachments_task_files_read" on storage.objects;
create policy "attachments_task_files_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
    and exists (
      select 1 from public.task_files tf
      where tf.storage_path = storage.objects.name
    )
  );

drop policy if exists "attachments_task_files_write" on storage.objects;
create policy "attachments_task_files_write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
  );

drop policy if exists "attachments_task_files_delete" on storage.objects;
create policy "attachments_task_files_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'tasks'
    -- Only the bytes behind a row this person may delete; once the row is
    -- gone the orphaned object is an admin's to clear, which is the safe way
    -- round.
    and exists (
      select 1 from public.task_files tf
      where tf.storage_path = storage.objects.name
        and tf.uploaded_by = auth.uid()
    )
  );
