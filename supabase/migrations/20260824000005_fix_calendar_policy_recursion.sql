-- Fixes: "infinite recursion detected in policy for relation calendar_entries".
--
-- The select policy on calendar_entries asked calendar_entry_shares whether the
-- viewer was named on the entry, while the policy on calendar_entry_shares
-- asked calendar_entries whether the viewer could see the entry. Each table
-- deferred to the other and Postgres gave up. calendar_entry_links inherited
-- the same loop through calendar_entries.
--
-- The membership checks move into security-definer helpers, which run with the
-- owner's rights and therefore do not re-enter RLS. The visibility rules
-- themselves are unchanged.

create or replace function public.shares_calendar_entry(entry uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calendar_entry_shares s
    where s.entry_id = entry and s.user_id = auth.uid()
  );
$$;

-- Who owns an entry, and whether it is private, without going through RLS.
create or replace function public.calendar_entry_owner(entry uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from public.calendar_entries where id = entry;
$$;

create or replace function public.can_manage_calendar_entry(entry uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calendar_entries e
    where e.id = entry
      and (e.owner_id = auth.uid() or public.is_admin())
  );
$$;

-- The same visibility rule as the select policy below, reusable from tables
-- that hang off an entry without them re-entering its RLS.
create or replace function public.can_view_calendar_entry(entry uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calendar_entries e
    where e.id = entry
      and (
        e.owner_id = auth.uid()
        or (
          coalesce(e.visibility, '') <> 'private'
          and (
            public.is_admin()
            or e.visibility = 'everyone'
            or (e.visibility = 'team' and e.project_id is not distinct from public.my_project_id())
            or public.shares_calendar_entry(e.id)
          )
        )
      )
  );
$$;

-- ─── calendar_entries: same rules, no cross-table recursion ─────────────────

drop policy if exists "calendar_entries_select" on public.calendar_entries;

create policy "calendar_entries_select" on public.calendar_entries for select to authenticated using (
  owner_id = auth.uid()
  or (
    coalesce(visibility, '') <> 'private'
    and (
      public.is_admin()
      or visibility = 'everyone'
      or (visibility = 'team' and project_id is not distinct from public.my_project_id())
      or public.shares_calendar_entry(id)
    )
  )
);

-- ─── calendar_entry_shares ──────────────────────────────────────────────────

drop policy if exists "calendar_entry_shares_select" on public.calendar_entry_shares;
drop policy if exists "calendar_entry_shares_write" on public.calendar_entry_shares;

create policy "calendar_entry_shares_select" on public.calendar_entry_shares for select to authenticated using (
  user_id = auth.uid()
  or public.calendar_entry_owner(entry_id) = auth.uid()
  or public.is_admin()
);

create policy "calendar_entry_shares_write" on public.calendar_entry_shares for all to authenticated
  using (public.can_manage_calendar_entry(entry_id))
  with check (public.can_manage_calendar_entry(entry_id));

-- ─── calendar_entry_links ───────────────────────────────────────────────────

drop policy if exists "calendar_entry_links_select" on public.calendar_entry_links;
drop policy if exists "calendar_entry_links_write" on public.calendar_entry_links;

-- Mirrors the entry's own visibility. Querying this table directly must not
-- reveal what is attached to someone's private entry, so the check is real —
-- it just runs in a definer function instead of re-entering RLS.
create policy "calendar_entry_links_select" on public.calendar_entry_links for select to authenticated
  using (public.can_view_calendar_entry(entry_id));

create policy "calendar_entry_links_write" on public.calendar_entry_links for all to authenticated
  using (public.can_manage_calendar_entry(entry_id))
  with check (public.can_manage_calendar_entry(entry_id));
