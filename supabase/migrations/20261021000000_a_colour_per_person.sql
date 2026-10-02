-- ============================================================================
-- A colour per person, for the calendar.
--
-- The task calendar lets a manager lay several people's weeks over each other
-- at once, which is the only way to plan against the team's week — but every
-- employee's work was drawn in the same purple, so the overlay said *that*
-- there was work without saying whose. A colour each, set on the person's
-- profile, is what makes three people on one day readable.
--
-- This colour is for that calendar and nothing else. Avatars keep their own
-- colouring, which is a different question (who is this) with a different
-- answer, and no part of the app reads this to decide anything but what to
-- paint a block on the calendar of tasks.
--
-- Null means nobody has chosen one, and the app falls back to the colour it
-- used before. Nothing changes until a colour is actually picked.
--
-- ─── What this file does to existing data: nothing ──────────────────────────
--
-- It adds one nullable column to public.users and one constraint governing
-- what may be written to that column. It contains no delete, no update, no
-- truncate, no drop of any table, column, policy or row, and does not touch
-- row-level security on users — so it cannot remove a person, change a person,
-- or change who may see one. Running it twice is the same as running it once.
-- ============================================================================

alter table public.users
  add column if not exists calendar_color text;

-- A plain hex colour or nothing. Checked here rather than only in the picker,
-- so a bad value cannot reach the stylesheet from anywhere else.
--
-- Added `not valid`, and only when it is not already there. `not valid` means
-- the constraint governs what is written from now on without reading the rows
-- already in the table: it cannot fail on existing data, and it does not take
-- the lock a full validation would. The column is brand new and therefore null
-- everywhere, so there is nothing to validate in any case — this is belt and
-- braces on the one table where being wrong would matter most.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_calendar_color_hex'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_calendar_color_hex
      check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$')
      not valid;
  end if;
end $$;

-- No new policy, and no change to an existing one: users_write_scoped already
-- lets the owner change anybody and a project admin change the people on their
-- projects, which is exactly who may set this.
