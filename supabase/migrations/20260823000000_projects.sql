-- Projects: the new top-level organisational unit. Each project is a company.
-- Employees, tasks, resources and manager todos all hang off a project.
-- Existing rows are backfilled onto a single "Default Project" so nothing is lost.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_name text not null default '',
  description text not null default '',
  industry text not null default '',
  website text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  color text not null default '#6366f1',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

-- ─── Scope existing entities to a project ───────────────────────────────────

alter table public.users add column project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column project_id uuid references public.projects(id) on delete cascade;

-- Backfill: one default project owning everything that exists today.
do $$
declare
  default_project_id uuid;
  first_admin_id uuid;
begin
  -- Nothing to migrate on a fresh install: skip so it starts with no projects.
  if not exists (select 1 from public.users where role = 'employee')
     and not exists (select 1 from public.tasks) then
    return;
  end if;

  select id into first_admin_id from public.users where role = 'admin' order by created_at limit 1;

  insert into public.projects (name, company_name, description, created_by)
  values ('Default Project', 'Default Company',
          'Auto-created during the projects migration. All pre-existing employees and tasks were assigned here.',
          first_admin_id)
  returning id into default_project_id;

  update public.users set project_id = default_project_id where role = 'employee';
  update public.tasks set project_id = default_project_id;
end $$;

-- Tasks must always belong to a project; employees may be unassigned (admins always are).
alter table public.tasks alter column project_id set not null;

create index tasks_project_id_idx on public.tasks(project_id);
create index users_project_id_idx on public.users(project_id);

-- Re-create the signup trigger so a new employee's project_id (passed as user
-- metadata by the create-employee function) lands on their profile row.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, role, avatar_initials, job_title, department, manager_id, project_id, join_date)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'employee'),
    coalesce(new.raw_user_meta_data->>'avatar_initials', upper(left(new.email,2))),
    new.raw_user_meta_data->>'job_title',
    new.raw_user_meta_data->>'department',
    nullif(new.raw_user_meta_data->>'manager_id','')::uuid,
    nullif(new.raw_user_meta_data->>'project_id','')::uuid,
    coalesce((new.raw_user_meta_data->>'join_date')::date, current_date)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Helper: the project the current user belongs to (null for admins).
create function public.my_project_id() returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from public.users where id = auth.uid();
$$;

-- ─── Resources: spatial clusters and items ──────────────────────────────────

-- A cluster is a bubble on the canvas. parent_cluster_id null = top level.
-- Nesting is unlimited; the UI zooms into a cluster to reveal its children.
create table public.resource_clusters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_cluster_id uuid references public.resource_clusters(id) on delete cascade,
  title text not null default 'Untitled cluster',
  color text not null default '#6366f1',
  x double precision not null default 0,
  y double precision not null default 0,
  radius double precision not null default 160,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index resource_clusters_project_idx on public.resource_clusters(project_id);
create index resource_clusters_parent_idx on public.resource_clusters(parent_cluster_id);

-- An item is a document/image/audio/link node. The file bytes (storage_path)
-- are deliberately separate from the metadata (title/description/links) so the
-- file can be replaced in place without losing what was written about it.
create table public.resource_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cluster_id uuid references public.resource_clusters(id) on delete cascade,
  title text not null default 'Untitled',
  description text not null default '',
  storage_path text,
  file_name text,
  mime_type text,
  size int,
  x double precision not null default 0,
  y double precision not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create index resource_items_project_idx on public.resource_items(project_id);
create index resource_items_cluster_idx on public.resource_items(cluster_id);

-- Extra links attached to an item, e.g. the Google Docs URL for an uploaded PDF.
create table public.resource_item_links (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.resource_items(id) on delete cascade,
  label text not null default '',
  url text not null,
  sort_order int not null default 0
);

create index resource_item_links_item_idx on public.resource_item_links(item_id);

-- ─── Manager todos (admin-only, per project) ────────────────────────────────

create table public.project_todos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  notes text not null default '',
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  is_completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid references public.users(id),
  due_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index project_todos_project_idx on public.project_todos(project_id);

-- A todo can point at a resource item or a whole cluster, so the documents
-- relevant to a task are reachable from the task itself.
create table public.project_todo_links (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.project_todos(id) on delete cascade,
  item_id uuid references public.resource_items(id) on delete cascade,
  cluster_id uuid references public.resource_clusters(id) on delete cascade,
  constraint todo_link_target check (num_nonnulls(item_id, cluster_id) = 1)
);

create index project_todo_links_todo_idx on public.project_todo_links(todo_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.projects enable row level security;
alter table public.resource_clusters enable row level security;
alter table public.resource_items enable row level security;
alter table public.resource_item_links enable row level security;
alter table public.project_todos enable row level security;
alter table public.project_todo_links enable row level security;

-- projects: admins manage all; employees may read the project they belong to.
create policy "projects_select" on public.projects for select to authenticated using (
  is_admin() or id = my_project_id()
);
create policy "projects_write_admin" on public.projects for all to authenticated using (is_admin()) with check (is_admin());

-- resources: admins manage all; employees read their own project's resources.
create policy "resource_clusters_select" on public.resource_clusters for select to authenticated using (
  is_admin() or project_id = my_project_id()
);
create policy "resource_clusters_write_admin" on public.resource_clusters for all to authenticated using (is_admin()) with check (is_admin());

create policy "resource_items_select" on public.resource_items for select to authenticated using (
  is_admin() or project_id = my_project_id()
);
create policy "resource_items_write_admin" on public.resource_items for all to authenticated using (is_admin()) with check (is_admin());

create policy "resource_item_links_select" on public.resource_item_links for select to authenticated using (
  exists (
    select 1 from public.resource_items ri
    where ri.id = resource_item_links.item_id
      and (is_admin() or ri.project_id = my_project_id())
  )
);
create policy "resource_item_links_write_admin" on public.resource_item_links for all to authenticated using (is_admin()) with check (is_admin());

-- todos: admin-only in every direction. Employees never see manager todos.
create policy "project_todos_admin" on public.project_todos for all to authenticated using (is_admin()) with check (is_admin());
create policy "project_todo_links_admin" on public.project_todo_links for all to authenticated using (is_admin()) with check (is_admin());

-- ─── Storage policies for project resources ─────────────────────────────────
-- Path convention: resources/{projectId}/{itemId}-{filename}

create policy "attachments_select_resources" on storage.objects for select to authenticated using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'resources'
  and (
    public.is_admin()
    or (storage.foldername(name))[2] = public.my_project_id()::text
  )
);

create policy "attachments_insert_resources" on storage.objects for insert to authenticated with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'resources'
  and public.is_admin()
);

create policy "attachments_delete_resources" on storage.objects for delete to authenticated using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = 'resources'
  and public.is_admin()
);
