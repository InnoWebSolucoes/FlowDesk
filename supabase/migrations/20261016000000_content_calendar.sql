-- ============================================================================
-- The content calendar.
--
-- Every piece of content goes through four tasks: its plan, its recording,
-- its edit and its post. This is where the firm's clients and those four
-- tasks live.
--
--   content_clients        who the content is for, and how much a month
--   content_recordings     a shoot: how many videos it produces, and the
--                          content plan that has to exist before it
--   content_edits          an editing session: how many of the videos
--                          recorded so far it turns into finished pieces
--   content_post_rules     when a client posts: which days, from when
--   content_posts          a post that has gone out, ticked off
--
-- Pieces are never stored one by one. A recording of 4 adds pieces 1–4, the
-- next one 5–8; an edit of 3 finishes the next three unedited pieces; the
-- n-th posting slot publishes the n-th finished piece. The app works that
-- out from the counts, so moving a session's date or changing its count
-- re-flows everything after it rather than leaving pieces orphaned.
--
-- The content calendar is everyone's, so anyone signed in can read and work
-- on it. Only the owner can delete a client, which takes its history with it.
-- ============================================================================

create table if not exists public.content_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Three letters on every post tag, e.g. ESP 03.
  code text not null,
  color text not null default '#1A5C3A',
  posts_per_month int not null default 8 check (posts_per_month >= 0),
  contact_name text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  -- Instagram handle, page, whatever they post under.
  handle text not null default '',
  notes text not null default '',
  is_archived boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.content_recordings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.content_clients(id) on delete cascade,
  recorded_on date not null,
  pieces int not null check (pieces > 0),
  assignee_id uuid references public.users(id) on delete set null,
  done_at timestamptz,
  notes text not null default '',
  -- The content plan: a task of its own, due before the shoot, and the file
  -- that comes out of it.
  plan_on date,
  plan_assignee_id uuid references public.users(id) on delete set null,
  plan_done_at timestamptz,
  plan_path text,
  plan_name text,
  plan_mime text,
  plan_notes text not null default '',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_recordings_client_idx
  on public.content_recordings(client_id, recorded_on);

create table if not exists public.content_edits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.content_clients(id) on delete cascade,
  edited_on date not null,
  pieces int not null check (pieces > 0),
  assignee_id uuid references public.users(id) on delete set null,
  done_at timestamptz,
  notes text not null default '',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_edits_client_idx
  on public.content_edits(client_id, edited_on);

create table if not exists public.content_post_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.content_clients(id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday. Every day of the week is a working day.
  weekdays int[] not null check (array_length(weekdays, 1) > 0),
  -- 1 = every week, 2 = every other week, counted from starts_on's week.
  every_weeks int not null default 1 check (every_weeks between 1 and 4),
  starts_on date not null,
  ends_on date,
  assignee_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_post_rules_client_idx
  on public.content_post_rules(client_id);

-- A slot that has been posted. Slots themselves are worked out from the rules,
-- so only the ones that went out need a row.
create table if not exists public.content_posts (
  client_id uuid not null references public.content_clients(id) on delete cascade,
  posted_on date not null,
  done_by uuid references public.users(id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (client_id, posted_on)
);

-- ─── Access ─────────────────────────────────────────────────────────────────

alter table public.content_clients enable row level security;
alter table public.content_recordings enable row level security;
alter table public.content_edits enable row level security;
alter table public.content_post_rules enable row level security;
alter table public.content_posts enable row level security;

drop policy if exists content_clients_select on public.content_clients;
create policy content_clients_select on public.content_clients
  for select to authenticated using (true);
drop policy if exists content_clients_insert on public.content_clients;
create policy content_clients_insert on public.content_clients
  for insert to authenticated with check (true);
drop policy if exists content_clients_update on public.content_clients;
create policy content_clients_update on public.content_clients
  for update to authenticated using (true) with check (true);
drop policy if exists content_clients_delete on public.content_clients;
create policy content_clients_delete on public.content_clients
  for delete to authenticated using (public.is_owner());

do $$
declare t text;
begin
  foreach t in array array['content_recordings', 'content_edits', 'content_post_rules', 'content_posts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all', t
    );
  end loop;
end $$;

-- ─── Content plans ──────────────────────────────────────────────────────────
-- Their own private bucket, readable by anyone signed in: a plan is for the
-- people recording it.

insert into storage.buckets (id, name, public)
values ('content-plans', 'content-plans', false)
on conflict (id) do nothing;

drop policy if exists content_plans_select on storage.objects;
create policy content_plans_select on storage.objects
  for select to authenticated using (bucket_id = 'content-plans');
drop policy if exists content_plans_insert on storage.objects;
create policy content_plans_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'content-plans');
drop policy if exists content_plans_update on storage.objects;
create policy content_plans_update on storage.objects
  for update to authenticated using (bucket_id = 'content-plans');
drop policy if exists content_plans_delete on storage.objects;
create policy content_plans_delete on storage.objects
  for delete to authenticated using (bucket_id = 'content-plans');

-- ─── Live ───────────────────────────────────────────────────────────────────
-- Someone ticking off a post on their phone ticks it off on the office screen.

do $$
declare t text;
begin
  foreach t in array array['content_clients', 'content_recordings', 'content_edits', 'content_post_rules', 'content_posts']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
