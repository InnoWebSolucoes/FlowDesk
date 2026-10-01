-- ============================================================================
-- Moving one day of the content calendar, and putting something on it by hand.
--
-- Everything on the content calendar was worked out from a client's sessions
-- and posting rules, and nothing on it could be moved by dragging. The two
-- tables here are what a drag writes:
--
--   content_post_moves      one posting slot, on a different day. The rule it
--                           came from is left alone, so moving next Tuesday's
--                           post does not move every Tuesday.
--   content_one_off_tasks   something that belongs on the calendar and in no
--                           pipeline: a call, a reshoot, a favour. It has a
--                           day, a title and a tick, and it moves like
--                           everything else.
--
-- Sessions themselves — plans, shoots, edits, deliveries, scheduling — need
-- nothing new: each already has its own date column, and a drag writes that
-- one row's date.
--
-- A one-off task is not a piece of content. It is never counted, numbered,
-- edited or posted; it does not enter flowFor. That is the point of it.
-- ============================================================================

-- ─── One posting slot, moved ────────────────────────────────────────────────
-- Keyed by the day the rule put it on, which is the only stable name a
-- generated slot has. Moving it again rewrites to_day rather than chaining,
-- so a slot is never in two places.

create table if not exists public.content_post_moves (
  client_id uuid not null references public.content_clients(id) on delete cascade,
  -- Where the posting rule put it.
  from_day date not null,
  -- Where it actually goes.
  to_day date not null,
  moved_by uuid references public.users(id) on delete set null,
  moved_at timestamptz not null default now(),
  primary key (client_id, from_day)
);

create index if not exists content_post_moves_client_idx
  on public.content_post_moves(client_id, to_day);

-- ─── Something put on the calendar by hand ──────────────────────────────────

create table if not exists public.content_one_off_tasks (
  id uuid primary key default gen_random_uuid(),
  -- Which calendar it is on. A one-off need not be about a client — a day of
  -- admin, a studio booking — so the project is what scopes it, not the
  -- client, and client_id is there only to colour it and file it under
  -- somebody when it does belong to one.
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid references public.content_clients(id) on delete set null,
  day date not null,
  title text not null check (length(btrim(title)) > 0),
  detail text not null default '',
  assignee_id uuid references public.users(id) on delete set null,
  -- Freeform, but still something to tick off: it sits among work that ticks.
  done_at timestamptz,
  done_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_one_off_tasks_day_idx
  on public.content_one_off_tasks(project_id, day);

-- ─── Access ─────────────────────────────────────────────────────────────────
-- The same as the rest of the content calendar: it is everyone's, and anyone
-- signed in can read it and work on it. Deleting a one-off is not the
-- destructive act deleting a client is — it takes no history with it — so it
-- is not held back to the owner.

alter table public.content_post_moves enable row level security;
alter table public.content_one_off_tasks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['content_post_moves', 'content_one_off_tasks']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all', t
    );
  end loop;
end $$;

-- ─── Live ───────────────────────────────────────────────────────────────────
-- Dragging a shoot on the office screen moves it on everyone else's.

do $$
declare t text;
begin
  foreach t in array array['content_post_moves', 'content_one_off_tasks']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
