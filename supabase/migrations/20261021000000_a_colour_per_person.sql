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
-- ============================================================================

alter table public.users
  add column if not exists calendar_color text;

-- A plain hex colour or nothing. Checked here rather than only in the picker,
-- so a bad value cannot reach the stylesheet from anywhere else.
alter table public.users
  drop constraint if exists users_calendar_color_hex;
alter table public.users
  add constraint users_calendar_color_hex
  check (calendar_color is null or calendar_color ~ '^#[0-9A-Fa-f]{6}$');

-- No new policy: users_write_scoped already lets the owner change anybody and
-- a project admin change the people on their projects, which is exactly who
-- may set this.
