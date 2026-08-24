-- Do dates and a working calendar.
--
-- A due date is the hard deadline; a do date is when you actually intend to
-- work on it. Planning happens on do dates, which is what the calendar shows.
-- Busy/working slots live alongside todos so one calendar shows real capacity.

-- ─── Do dates on todos ──────────────────────────────────────────────────────

alter table public.project_todos
  add column if not exists do_date date,
  -- Optional time window on the do date. Null start = an all-day item.
  add column if not exists do_start time,
  add column if not exists do_end time,
  -- Who is expected to do it. Null = unassigned, still shows on manager views.
  add column if not exists assignee_id uuid references public.users(id) on delete set null,
  -- Per-item override of the role default. Null = follow the role rule.
  add column if not exists visibility text
    check (visibility in ('private', 'team', 'everyone'));

create index if not exists project_todos_do_date_idx on public.project_todos(do_date);
create index if not exists project_todos_assignee_idx on public.project_todos(assignee_id);

-- ─── Calendar entries that are not todos ────────────────────────────────────
-- Busy blocks, working hours, meetings, time off: the things that decide
-- whether a do date is realistic.

create table if not exists public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null default 'Busy',
  notes text not null default '',
  kind text not null default 'busy'
    check (kind in ('busy', 'working', 'meeting', 'timeoff')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  -- Null follows the role default; an explicit value overrides it.
  visibility text check (visibility in ('private', 'team', 'everyone')),
  created_at timestamptz not null default now(),
  constraint calendar_entry_range check (ends_at > starts_at)
);

create index if not exists calendar_entries_owner_idx on public.calendar_entries(owner_id);
create index if not exists calendar_entries_project_idx on public.calendar_entries(project_id);
create index if not exists calendar_entries_starts_idx on public.calendar_entries(starts_at);

-- People a single entry is explicitly shared with, beyond the visibility rule.
create table if not exists public.calendar_entry_shares (
  entry_id uuid not null references public.calendar_entries(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (entry_id, user_id)
);

-- Same, for a todo: "this one is shared with Kasim" without making it public.
create table if not exists public.project_todo_shares (
  todo_id uuid not null references public.project_todos(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (todo_id, user_id)
);

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.calendar_entries enable row level security;
alter table public.calendar_entry_shares enable row level security;
alter table public.project_todo_shares enable row level security;

-- Role default: admins see everything, employees see their own. On top of
-- that, an explicit visibility of 'everyone' opens an entry to all staff,
-- 'team' to everyone on the same project, and a share row names individuals.
-- 'private' keeps it to the owner even from admins.
create policy "calendar_entries_select" on public.calendar_entries for select to authenticated using (
  owner_id = auth.uid()
  or (
    coalesce(visibility, '') <> 'private'
    and (
      public.is_admin()
      or visibility = 'everyone'
      or (visibility = 'team' and project_id is not distinct from public.my_project_id())
      or exists (
        select 1 from public.calendar_entry_shares s
        where s.entry_id = calendar_entries.id and s.user_id = auth.uid()
      )
    )
  )
);

-- You manage your own entries; admins manage anyone's except private ones.
create policy "calendar_entries_insert" on public.calendar_entries for insert to authenticated
  with check (owner_id = auth.uid() or public.is_admin());

create policy "calendar_entries_update" on public.calendar_entries for update to authenticated
  using (owner_id = auth.uid() or (public.is_admin() and coalesce(visibility, '') <> 'private'))
  with check (owner_id = auth.uid() or (public.is_admin() and coalesce(visibility, '') <> 'private'));

create policy "calendar_entries_delete" on public.calendar_entries for delete to authenticated
  using (owner_id = auth.uid() or (public.is_admin() and coalesce(visibility, '') <> 'private'));

create policy "calendar_entry_shares_select" on public.calendar_entry_shares for select to authenticated using (
  user_id = auth.uid()
  or exists (
    select 1 from public.calendar_entries e
    where e.id = calendar_entry_shares.entry_id
      and (e.owner_id = auth.uid() or public.is_admin())
  )
);

create policy "calendar_entry_shares_write" on public.calendar_entry_shares for all to authenticated
  using (
    exists (
      select 1 from public.calendar_entries e
      where e.id = calendar_entry_shares.entry_id
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.calendar_entries e
      where e.id = calendar_entry_shares.entry_id
        and (e.owner_id = auth.uid() or public.is_admin())
    )
  );

-- Todos stay admin-managed (they are manager todos), but an employee needs to
-- read the ones assigned to or shared with them so they reach their calendar.
create policy "project_todo_shares_select" on public.project_todo_shares for select to authenticated using (
  user_id = auth.uid() or public.is_admin()
);
create policy "project_todo_shares_write_admin" on public.project_todo_shares for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Widen the existing admin-only read on todos: assignee or shared-with can see
-- their own, without gaining write access.
drop policy if exists "project_todos_admin" on public.project_todos;

create policy "project_todos_select" on public.project_todos for select to authenticated using (
  public.is_admin()
  or assignee_id = auth.uid()
  or exists (
    select 1 from public.project_todo_shares s
    where s.todo_id = project_todos.id and s.user_id = auth.uid()
  )
);

create policy "project_todos_write_admin" on public.project_todos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
