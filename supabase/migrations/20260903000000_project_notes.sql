-- Sticky notes per project, in the spirit of Google Keep: a board of short
-- notes with colours, pinning and optional checklists.
--
-- Manager-only, matching project_todo_lists: employees never see these.

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  color text not null default '#fef3c7',
  -- Pinned notes sort above the rest, as in Keep.
  is_pinned boolean not null default false,
  -- Archived notes stay out of the board but are not destroyed.
  is_archived boolean not null default false,
  -- Manual ordering within the board, so notes can be dragged into place.
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

create index project_notes_project_idx on public.project_notes(project_id);
-- The board's default query: unarchived notes, pinned first.
create index project_notes_board_idx
  on public.project_notes(project_id, is_archived, is_pinned, sort_order);

-- A note is either free text or a checklist; these are its items when it is a
-- checklist. Kept in a child table so items can be ticked without rewriting
-- the note body.
create table public.project_note_items (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.project_notes(id) on delete cascade,
  text text not null default '',
  is_checked boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index project_note_items_note_idx on public.project_note_items(note_id, sort_order);

alter table public.project_notes enable row level security;
alter table public.project_note_items enable row level security;

-- Admin-only, matching project_todo_lists.
create policy "project_notes_admin" on public.project_notes
  for all to authenticated using (is_admin()) with check (is_admin());

create policy "project_note_items_admin" on public.project_note_items
  for all to authenticated using (is_admin()) with check (is_admin());

-- Keep updated_at honest, so "recently edited" ordering is possible later.
create or replace function public.touch_project_note()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger project_notes_touch
  before update on public.project_notes
  for each row execute function public.touch_project_note();
