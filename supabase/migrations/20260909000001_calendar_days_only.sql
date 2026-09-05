-- The calendar becomes day-based.
--
-- Times were never how this calendar was actually used: work was planned by
-- which day it lands on, and the hour pickers only added friction. Entries
-- now occupy whole days, so an entry is a date range and nothing finer.
--
-- Existing times are collapsed to the day they fell on, in the entry's own
-- stored instant. The day survives; the time of day does not.

-- ─── Calendar entries span days, not instants ───────────────────────────────

alter table public.calendar_entries
  add column if not exists starts_on date,
  add column if not exists ends_on date;

-- Carry each entry across before the old columns go. ends_at was exclusive
-- for an all-day entry, so step back a day to get the last day it covers,
-- but never past its own start.
update public.calendar_entries
set starts_on = (starts_at at time zone 'UTC')::date,
    ends_on = greatest(
      (starts_at at time zone 'UTC')::date,
      case
        when all_day then ((ends_at at time zone 'UTC') - interval '1 day')::date
        else (ends_at at time zone 'UTC')::date
      end
    )
where starts_on is null;

-- Anything that somehow has no instant to convert gets today, so the column
-- can be made not-null without dropping the row.
update public.calendar_entries
set starts_on = current_date, ends_on = current_date
where starts_on is null;

alter table public.calendar_entries
  alter column starts_on set not null,
  alter column ends_on set not null;

-- The old range check goes with the columns it referenced.
alter table public.calendar_entries
  drop constraint if exists calendar_entry_range;

alter table public.calendar_entries
  add constraint calendar_entry_days check (ends_on >= starts_on);

drop index if exists public.calendar_entries_starts_idx;
create index if not exists calendar_entries_starts_on_idx
  on public.calendar_entries(starts_on);

alter table public.calendar_entries
  drop column if exists starts_at,
  drop column if exists ends_at,
  -- Every entry is all-day now, so the flag has nothing left to distinguish.
  drop column if exists all_day;

-- ─── Todos are planned by day ───────────────────────────────────────────────
-- do_date already carries the day; the time window on it is what goes.

alter table public.project_todos
  drop column if exists do_start,
  drop column if exists do_end;

-- Assigned tasks are scheduled the same way: the day is kept, the slot is not.

alter table public.task_assignments
  drop column if exists do_start,
  drop column if exists do_end;
