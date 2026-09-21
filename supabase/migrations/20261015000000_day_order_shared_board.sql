-- ============================================================================
-- The managers' shared board can be arranged too.
--
-- day_order was keyed by the person whose day it is, which covers every
-- employee's calendar and their My Tasks — and silently covers nothing at all
-- on the project's own board, which belongs to no one person. Dragging there
-- appeared to work and then sprang back.
--
-- So a row now belongs to a *board* rather than to a person:
--
--   user:<uuid>    somebody's own day — their calendar and their My Tasks
--   shared:<uuid>  a project's shared board
--
-- board_key is what the rows are keyed and upserted by. owner_id and
-- project_id stay beside it, one of them filled, because row-level security
-- should ask a typed question about a real foreign key rather than pick a
-- uuid out of the middle of a string.
--
-- Existing rows are carried over, not dropped.
-- ============================================================================

alter table public.day_order
  add column if not exists board_key text;

alter table public.day_order
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

-- Everything written so far was somebody's own day.
update public.day_order
set board_key = 'user:' || owner_id
where board_key is null;

alter table public.day_order
  alter column board_key set not null;

-- Re-key on the board, before anything touches owner_id: a column that is
-- still part of the primary key cannot be made nullable, and Postgres refuses
-- the whole migration rather than half of it.
--
-- A swap rather than a fresh table, so the orders already arranged survive.
alter table public.day_order
  drop constraint if exists day_order_pkey;
alter table public.day_order
  add primary key (board_key, day, kind, item_id);

-- Now it is free: a shared board's rows have no owner, so the column can no
-- longer demand one.
alter table public.day_order
  alter column owner_id drop not null;

-- One or the other, never both and never neither.
alter table public.day_order
  drop constraint if exists day_order_one_board;
alter table public.day_order
  add constraint day_order_one_board check (num_nonnulls(owner_id, project_id) = 1);

create index if not exists day_order_board_day_idx
  on public.day_order(board_key, day);

-- ─── Who may arrange what ───────────────────────────────────────────────────
-- A person's own day: them, or the owner. A project's shared board: the
-- owner, or anyone on the project — it is the board they plan on together.

drop policy if exists day_order_select on public.day_order;
create policy day_order_select on public.day_order
  for select to authenticated
  using (
    (owner_id is not null and (owner_id = auth.uid() or public.is_owner()))
    or (project_id is not null and (public.is_owner() or public.in_project(project_id)))
  );

drop policy if exists day_order_write on public.day_order;
create policy day_order_write on public.day_order
  for all to authenticated
  using (
    (owner_id is not null and (owner_id = auth.uid() or public.is_owner()))
    or (project_id is not null and (public.is_owner() or public.in_project(project_id)))
  )
  with check (
    (owner_id is not null and (owner_id = auth.uid() or public.is_owner()))
    or (project_id is not null and (public.is_owner() or public.in_project(project_id)))
  );
