-- FlowDesk initial schema: unified users table, tasks, tools, notifications.
-- Run this once in the Supabase Dashboard SQL Editor (Project -> SQL Editor -> New query).

create type user_role as enum ('admin', 'employee');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role user_role not null default 'employee',
  avatar_initials text not null,
  join_date date not null default current_date,
  job_title text,
  department text,
  manager_id uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- Auto-create a public.users profile row whenever a new auth.users row is created.
-- Metadata (name/role/job_title/department/manager_id) is passed in at signup/createUser time.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name, role, avatar_initials, job_title, department, manager_id, join_date)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'employee'),
    coalesce(new.raw_user_meta_data->>'avatar_initials', upper(left(new.email,2))),
    new.raw_user_meta_data->>'job_title',
    new.raw_user_meta_data->>'department',
    nullif(new.raw_user_meta_data->>'manager_id','')::uuid,
    coalesce((new.raw_user_meta_data->>'join_date')::date, current_date)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  frequency jsonb not null,
  category_id uuid references public.categories(id),
  priority text not null check (priority in ('low','medium','high')),
  associated_tool text,
  estimated_minutes int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id),
  is_active boolean not null default true
);

create table public.task_assignments (
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  primary key (task_id, employee_id)
);

create table public.completion_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  due_date date not null,
  was_late boolean not null,
  time_of_day text not null check (time_of_day in ('early','mid-morning','afternoon','end-of-day')),
  unique (task_id, employee_id, due_date)
);

create table public.task_statuses (
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  due_date date not null,
  status text not null default 'in_progress' check (status = 'in_progress'),
  primary key (task_id, employee_id, due_date)
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.users(id),
  content text not null default '',
  created_at timestamptz not null default now()
);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  name text not null,
  type text not null,
  size int not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references public.users(id)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  action text not null check (action in ('completed','uncompleted','in_progress','commented','file_uploaded')),
  detail text,
  timestamp timestamptz not null default now()
);

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  description text not null default '',
  favicon_url text
);

create table public.website_assignments (
  website_id uuid not null references public.websites(id) on delete cascade,
  employee_id uuid not null references public.users(id) on delete cascade,
  primary key (website_id, employee_id)
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  size int not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references public.users(id),
  storage_path text not null,
  folder_id uuid references public.folders(id) on delete set null
);

create table public.guidelines (
  employee_id uuid primary key references public.users(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.users(id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('task_assigned','task_due_today','task_due_tomorrow','task_overdue','comment_added','workload_alert','inactivity_alert')),
  title text not null,
  message text not null,
  task_id uuid references public.tasks(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  target_user_id uuid references public.users(id) on delete cascade,
  target_role user_role
);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.completion_logs enable row level security;
alter table public.task_statuses enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
alter table public.activity_logs enable row level security;
alter table public.websites enable row level security;
alter table public.website_assignments enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.guidelines enable row level security;
alter table public.notifications enable row level security;

-- users: any authenticated user can read profiles (names/avatars aren't secret);
-- only admin can write (employees don't self-edit profiles in this app).
create policy "users_select_all" on public.users for select to authenticated using (true);
create policy "users_write_admin" on public.users for all to authenticated using (is_admin()) with check (is_admin());

-- categories: read all, admin writes.
create policy "categories_select_all" on public.categories for select to authenticated using (true);
create policy "categories_write_admin" on public.categories for all to authenticated using (is_admin()) with check (is_admin());

-- tasks: admin sees all; employee sees only assigned tasks. Admin-only writes.
create policy "tasks_select" on public.tasks for select to authenticated using (
  is_admin() or exists (select 1 from public.task_assignments ta where ta.task_id = tasks.id and ta.employee_id = auth.uid())
);
create policy "tasks_write_admin" on public.tasks for all to authenticated using (is_admin()) with check (is_admin());

-- task_assignments: admin sees all; employee sees own. Admin-only writes.
create policy "task_assignments_select" on public.task_assignments for select to authenticated using (
  is_admin() or employee_id = auth.uid()
);
create policy "task_assignments_write_admin" on public.task_assignments for all to authenticated using (is_admin()) with check (is_admin());

-- completion_logs: admin sees/writes all; employee sees/writes only their own, only for assigned tasks.
create policy "completion_logs_select" on public.completion_logs for select to authenticated using (
  is_admin() or employee_id = auth.uid()
);
create policy "completion_logs_insert" on public.completion_logs for insert to authenticated with check (
  is_admin() or (employee_id = auth.uid() and exists (select 1 from public.task_assignments ta where ta.task_id = completion_logs.task_id and ta.employee_id = auth.uid()))
);
create policy "completion_logs_delete" on public.completion_logs for delete to authenticated using (
  is_admin() or employee_id = auth.uid()
);

-- task_statuses: same ownership shape as completion_logs.
create policy "task_statuses_select" on public.task_statuses for select to authenticated using (
  is_admin() or employee_id = auth.uid()
);
create policy "task_statuses_insert" on public.task_statuses for insert to authenticated with check (
  is_admin() or employee_id = auth.uid()
);
create policy "task_statuses_delete" on public.task_statuses for delete to authenticated using (
  is_admin() or employee_id = auth.uid()
);

-- task_comments: visible if the parent task is visible; insert requires author = self; delete by author or admin.
create policy "task_comments_select" on public.task_comments for select to authenticated using (
  is_admin() or exists (select 1 from public.task_assignments ta where ta.task_id = task_comments.task_id and ta.employee_id = auth.uid())
);
create policy "task_comments_insert" on public.task_comments for insert to authenticated with check (
  author_id = auth.uid() and (is_admin() or exists (select 1 from public.task_assignments ta where ta.task_id = task_comments.task_id and ta.employee_id = auth.uid()))
);
create policy "task_comments_delete" on public.task_comments for delete to authenticated using (
  is_admin() or author_id = auth.uid()
);

-- task_attachments: mirrors the parent comment's visibility/ownership.
create policy "task_attachments_select" on public.task_attachments for select to authenticated using (
  exists (
    select 1 from public.task_comments tc
    where tc.id = task_attachments.comment_id
      and (is_admin() or exists (select 1 from public.task_assignments ta where ta.task_id = tc.task_id and ta.employee_id = auth.uid()))
  )
);
create policy "task_attachments_insert" on public.task_attachments for insert to authenticated with check (
  uploaded_by = auth.uid()
);
create policy "task_attachments_delete" on public.task_attachments for delete to authenticated using (
  is_admin() or uploaded_by = auth.uid()
);

-- activity_logs: same visibility as parent task; actor must be self on insert.
create policy "activity_logs_select" on public.activity_logs for select to authenticated using (
  is_admin() or exists (select 1 from public.task_assignments ta where ta.task_id = activity_logs.task_id and ta.employee_id = auth.uid())
);
create policy "activity_logs_insert" on public.activity_logs for insert to authenticated with check (
  actor_id = auth.uid()
);

-- websites: admin sees all; employee sees only assigned. Admin-only writes.
create policy "websites_select" on public.websites for select to authenticated using (
  is_admin() or exists (select 1 from public.website_assignments wa where wa.website_id = websites.id and wa.employee_id = auth.uid())
);
create policy "websites_write_admin" on public.websites for all to authenticated using (is_admin()) with check (is_admin());

create policy "website_assignments_select" on public.website_assignments for select to authenticated using (
  is_admin() or employee_id = auth.uid()
);
create policy "website_assignments_write_admin" on public.website_assignments for all to authenticated using (is_admin()) with check (is_admin());

-- folders: admin sees all; employee only own.
create policy "folders_select" on public.folders for select to authenticated using (
  is_admin() or owner_id = auth.uid()
);
create policy "folders_insert" on public.folders for insert to authenticated with check (
  is_admin() or owner_id = auth.uid()
);
create policy "folders_delete" on public.folders for delete to authenticated using (
  is_admin() or owner_id = auth.uid()
);

-- documents: admin sees all; employee sees own uploads or documents in their own folders.
create policy "documents_select" on public.documents for select to authenticated using (
  is_admin() or uploaded_by = auth.uid() or folder_id in (select id from public.folders where owner_id = auth.uid())
);
create policy "documents_insert" on public.documents for insert to authenticated with check (
  uploaded_by = auth.uid()
);
create policy "documents_delete" on public.documents for delete to authenticated using (
  is_admin() or uploaded_by = auth.uid()
);

-- guidelines: admin sees/writes all; employee reads only their own row.
create policy "guidelines_select" on public.guidelines for select to authenticated using (
  is_admin() or employee_id = auth.uid()
);
create policy "guidelines_write_admin" on public.guidelines for all to authenticated using (is_admin()) with check (is_admin());

-- notifications: visible to their target user, or to any admin if targeted at the admin role.
create policy "notifications_select" on public.notifications for select to authenticated using (
  target_user_id = auth.uid() or (target_role = 'admin' and is_admin())
);
create policy "notifications_insert" on public.notifications for insert to authenticated with check (true);
create policy "notifications_update" on public.notifications for update to authenticated using (
  target_user_id = auth.uid() or (target_role = 'admin' and is_admin())
);
create policy "notifications_delete" on public.notifications for delete to authenticated using (
  target_user_id = auth.uid() or (target_role = 'admin' and is_admin())
);
