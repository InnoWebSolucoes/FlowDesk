-- ============================================================================
-- When somebody started their working day.
--
-- Nothing new is recorded. app_sessions already stores the moment each visit
-- began, so the first session of a day is already the first time that person
-- opened the app that day — the question was only ever unanswerable because
-- nothing read it back that way.
--
-- Timezone matters here in a way it does not for totals. `started_at::date`
-- would bucket by UTC, and a working day that begins at 08:00 in Luanda is
-- 07:00 UTC — same date, fine — but anyone starting before 01:00 local would
-- land on the previous day. So the caller passes its own zone and the bucket
-- is computed in it.
--
-- Owner-only, like everything else on this table: the is_owner() test inside
-- the query is what stops security definer handing this to anybody who calls
-- it. For anyone else the where clause matches nothing and it returns no rows.
-- ============================================================================

create or replace function public.app_session_day_starts(
  p_user uuid,
  p_days int default 14,
  p_tz text default 'UTC'
)
returns table (
  day date,
  first_seen timestamptz,
  last_seen timestamptz,
  sessions bigint,
  minutes numeric
)
language sql stable security definer set search_path = public as $$
  select
    (s.started_at at time zone p_tz)::date as day,
    min(s.started_at) as first_seen,
    max(s.ended_at) as last_seen,
    count(*) as sessions,
    round(sum(extract(epoch from (s.ended_at - s.started_at)) / 60.0)::numeric, 1)
      as minutes
  from public.app_sessions s
  where public.is_owner()
    and s.user_id = p_user
    -- Bounded so a long-running account does not return years of rows. The
    -- window is in the caller's zone too, or the oldest day would be clipped
    -- an hour early.
    and (s.started_at at time zone p_tz)::date
        > ((now() at time zone p_tz)::date - greatest(coalesce(p_days, 14), 1))
  group by 1
  order by 1 desc;
$$;

revoke all on function public.app_session_day_starts(uuid, int, text) from public;
grant execute on function public.app_session_day_starts(uuid, int, text) to authenticated;
