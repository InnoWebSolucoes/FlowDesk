-- ============================================================================
-- Is the app usage tracking actually recording?
--
-- Run this after signing in to FlowDesk as somebody (any account) and leaving
-- it open for a couple of minutes. Nothing here writes.
-- ============================================================================

-- ─── 1. Are the pieces installed? ───────────────────────────────────────────
-- All four rows should say present.

select 'table app_sessions' as piece,
       case when to_regclass('public.app_sessions') is not null
            then 'present' else '(missing)' end as state
union all
select 'function app_session_start',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname='public' and p.proname='app_session_start')
            then 'present' else '(missing)' end
union all
select 'function app_session_beat',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname='public' and p.proname='app_session_beat')
            then 'present' else '(missing)' end
union all
select 'function app_session_stats',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname='public' and p.proname='app_session_stats')
            then 'present' else '(missing)' end;


-- ─── 2. Is anything being recorded? ─────────────────────────────────────────
-- One row per visit. minutes grows by about 1 for each minute the app is left
-- open and visible; a visit shorter than one heartbeat reads as 0, which is
-- correct — they opened it and left.
--
-- Empty means nobody has opened the app since the migration ran. Open
-- FlowDesk, wait two minutes, and run this again.

select
  u.name,
  u.email,
  s.started_at,
  s.ended_at,
  round(extract(epoch from (s.ended_at - s.started_at)) / 60.0, 1) as minutes,
  s.platform
from public.app_sessions s
join public.users u on u.id = s.user_id
order by s.started_at desc
limit 20;


-- ─── 3. The totals the analytics panel shows ────────────────────────────────
-- This is exactly what the App usage panel renders, per person.
--
-- Note it returns nothing when run as anyone but the owner — that is the
-- privacy rule working, not a fault. From the SQL editor auth.uid() is null,
-- so is_owner() is false and this is empty by design; section 2 above is the
-- one that shows the raw data here.

select
  u.name,
  st.sessions,
  st.total_minutes,
  st.avg_minutes,
  st.active_days,
  st.last_seen
from public.app_session_stats() st
join public.users u on u.id = st.user_id
order by st.total_minutes desc;


-- ─── 4. Confirm employees genuinely cannot read their own ───────────────────
-- The privacy guarantee, tested rather than assumed. Both must be false:
-- there must be exactly one select policy and its condition must be
-- is_owner() with no branch matching the subject.

select
  policyname,
  cmd,
  qual as using_expression,
  qual like '%auth.uid()%' as leaks_to_subject
from pg_policies
where schemaname = 'public'
  and tablename = 'app_sessions'
order by cmd, policyname;
