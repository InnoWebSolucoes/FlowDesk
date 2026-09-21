-- ============================================================================
-- The order of a day's work, decided by hand.
--
-- Until now nothing carried an order: the calendar drew a day in whatever
-- order the rows arrived in, with urgent floated to the top, and My Tasks
-- sorted the same day into morning/afternoon/end-of-day buckets guessed from
-- category names. The two never agreed, and neither could be arranged.
--
-- One row here is one item's place in one person's day. Both views read it, so
-- dragging a block on the calendar moves it in My Tasks and the other way
-- round — it is the same day, so it is the same order.
--
-- Keyed by the person whose day it is, not by who is arranging it: a manager
-- ordering an employee's Tuesday is ordering that employee's Tuesday, which is
-- what they see in My Tasks.
--
-- A day with no rows here has no manual order, and both views fall back to
-- what they did before. Nothing here reads or changes existing rows.
-- ============================================================================

create table if not exists public.day_order (
  -- Whose day this is.
  owner_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  -- What kind of thing is being placed. A day holds assigned work, the
  -- person's own todos and their busy blocks, and they share one order.
  kind text not null check (kind in ('task', 'todo', 'entry')),
  -- The task, todo or calendar entry. Not a foreign key: it points at one of
  -- three tables, and which one is `kind`. A row left behind by something
  -- deleted is harmless — both views only order what they are already
  -- drawing — and is cleaned up the next time that day is arranged.
  item_id uuid not null,
  position int not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, day, kind, item_id)
);

create index if not exists day_order_day_idx on public.day_order(owner_id, day);

alter table public.day_order enable row level security;

-- Your own days, and — for the owner — anybody's. The same rule the calendar
-- itself follows: an employee arranges their day, the owner arranges anyone's.
drop policy if exists day_order_select on public.day_order;
create policy day_order_select on public.day_order
  for select to authenticated
  using (owner_id = auth.uid() or public.is_owner());

drop policy if exists day_order_write on public.day_order;
create policy day_order_write on public.day_order
  for all to authenticated
  using (owner_id = auth.uid() or public.is_owner())
  with check (owner_id = auth.uid() or public.is_owner());

-- Live, so a day rearranged on one screen is rearranged on the other.
do $$
begin
  alter publication supabase_realtime add table public.day_order;
exception when duplicate_object then null;
end $$;
