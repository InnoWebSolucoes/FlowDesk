-- ============================================================================
-- How often people open the app, and how long they stay.
--
-- A session is one continuous stretch of use: it opens when the app loads or
-- comes back to the foreground, and is extended by a heartbeat while the tab
-- is visible. Closing the laptop, switching tabs or going idle stops the
-- heartbeat, so `ended_at` stops moving and the session ends where the person
-- actually stopped rather than whenever the browser got round to firing an
-- unload event — which on mobile it often never does.
--
-- Only the owner can read this. It is deliberately not shown to the person it
-- is about: RLS has no select branch for the subject, so an employee querying
-- their own rows gets nothing back. The insert and update branches are theirs
-- alone, and narrow — they can start a session and extend one they already
-- own, and nothing else.
-- ============================================================================

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  -- Moved forward by the heartbeat. Equal to started_at for a session that
  -- was open for less than one beat.
  ended_at timestamptz not null default now(),
  -- Which build and device, so a jump in the numbers can be explained.
  platform text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_idx
  on public.app_sessions(user_id, started_at desc);

alter table public.app_sessions enable row level security;

-- Reading is the owner's alone. There is deliberately no branch here for
-- user_id = auth.uid(): the point is that people do not see their own usage.
drop policy if exists "app_sessions_select_owner" on public.app_sessions;
create policy "app_sessions_select_owner" on public.app_sessions
  for select to authenticated using (public.is_owner());

-- Anyone may start their own session, and only their own.
drop policy if exists "app_sessions_insert_self" on public.app_sessions;
create policy "app_sessions_insert_self" on public.app_sessions
  for insert to authenticated with check (user_id = auth.uid());

-- And extend one they own. The row cannot be reassigned to somebody else.
drop policy if exists "app_sessions_update_self" on public.app_sessions;
create policy "app_sessions_update_self" on public.app_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Nobody deletes: no delete policy, so history cannot be trimmed by the
-- person it describes.


-- ─── Starting and extending, without being able to read ─────────────────────
-- `insert ... returning` needs select privilege, and select here is the
-- owner's alone — so an employee inserting their own session would get no id
-- back and could never extend it. Tracking would silently record nothing for
-- exactly the people it exists to track.
--
-- These two do the writing instead. Being security definer they return the
-- id without the caller holding select on the table, and neither one hands
-- back any timing: beat() returns nothing at all, and the id is opaque.

create or replace function public.app_session_start(p_platform text default '')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.app_sessions (user_id, platform)
  values (auth.uid(), coalesce(p_platform, ''))
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.app_session_beat(p_session uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  -- Scoped to the caller's own row, so one person cannot extend another's.
  update public.app_sessions
  set ended_at = now()
  where id = p_session and user_id = auth.uid();
end;
$$;

revoke all on function public.app_session_start(text) from public;
revoke all on function public.app_session_beat(uuid) from public;
grant execute on function public.app_session_start(text) to authenticated;
grant execute on function public.app_session_beat(uuid) to authenticated;


-- ─── Reading it back ────────────────────────────────────────────────────────
-- Per-person totals, so the analytics page does not have to pull every row
-- and add them up in the browser.
--
-- ended_at - started_at is what was actually observed. A session shorter than
-- one heartbeat reads as zero, which is honest: they opened it and left.

create or replace function public.app_session_stats(
  since date default null,
  until date default null
)
returns table (
  user_id uuid,
  sessions bigint,
  total_minutes numeric,
  avg_minutes numeric,
  last_seen timestamptz,
  active_days bigint
)
language sql stable security definer set search_path = public as $$
  select
    s.user_id,
    count(*) as sessions,
    round(sum(extract(epoch from (s.ended_at - s.started_at)) / 60.0)::numeric, 1)
      as total_minutes,
    round(avg(extract(epoch from (s.ended_at - s.started_at)) / 60.0)::numeric, 1)
      as avg_minutes,
    max(s.ended_at) as last_seen,
    count(distinct s.started_at::date) as active_days
  from public.app_sessions s
  where public.is_owner()
    and (since is null or s.started_at >= since)
    and (until is null or s.started_at < (until + 1))
  group by s.user_id;
$$;

-- security definer would otherwise let anyone call this and read everyone's
-- usage, which is the opposite of the point. The is_owner() test inside the
-- query is what stops that: for anybody else the where clause matches no
-- rows and the function returns nothing.

revoke all on function public.app_session_stats(date, date) from public;
grant execute on function public.app_session_stats(date, date) to authenticated;
