-- Multiple named todo lists per project (e.g. "Onboarding", "Q3 launch").
-- Existing todos are moved into a default "To do" list per project.

create table public.project_todo_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default 'New list',
  color text not null default '#6366f1',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index project_todo_lists_project_idx on public.project_todo_lists(project_id);

alter table public.project_todos
  add column list_id uuid references public.project_todo_lists(id) on delete cascade;

-- Backfill: give every project that already has todos a default list.
do $$
declare
  proj record;
  new_list_id uuid;
begin
  for proj in select distinct project_id from public.project_todos loop
    insert into public.project_todo_lists (project_id, name, sort_order)
    values (proj.project_id, 'To do', 0)
    returning id into new_list_id;

    update public.project_todos
    set list_id = new_list_id
    where project_id = proj.project_id and list_id is null;
  end loop;
end $$;

create index project_todos_list_idx on public.project_todos(list_id);

alter table public.project_todo_lists enable row level security;

-- Admin-only, matching project_todos.
create policy "project_todo_lists_admin" on public.project_todo_lists for all to authenticated using (is_admin()) with check (is_admin());
