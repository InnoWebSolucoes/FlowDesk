-- ============================================================================
-- Ferramentas: employees add their own websites, and documents get a title.
--
-- Two things:
--
-- 1. Adding a website was admin-only, and with the admin tier gone that left
--    nobody but the owner able to do it. Esmael needs it too, so the write
--    policy becomes "the owner, or somebody adding a site assigned to
--    themselves". Nobody can create a site pointing at another person.
--
-- 2. A document showed its raw filename, so a scan called
--    "IMG_20260908_112233.pdf" was unreadable in a list. It now carries a
--    title people choose, falling back to the filename for everything already
--    uploaded, and an icon URL so a link to a service shows that service's
--    favicon rather than a generic page glyph.
-- ============================================================================


-- ─── 1. Documents: a title of their own, and an icon ────────────────────────

alter table public.documents
  add column if not exists title text,
  add column if not exists icon_url text;

-- Everything already uploaded keeps reading as it did: the filename is the
-- title until somebody changes it.
update public.documents
set title = name
where title is null;


-- ─── 2. Employees may add a website ─────────────────────────────────────────
-- Assigned to themselves, and to themselves only. The check reads the rows
-- being inserted into website_assignments rather than trusting the client,
-- so a site cannot be created pointing at somebody else's list.

drop policy if exists "websites_write_admin"     on public.websites;
drop policy if exists "websites_write_any_admin" on public.websites;
drop policy if exists "websites_write_scoped"    on public.websites;

-- The owner manages everything.
create policy "websites_write_owner" on public.websites
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Anyone signed in may add one. What stops it becoming everybody's site is
-- the assignment policy below: without a row there it appears on nobody's
-- list, including the creator's.
drop policy if exists "websites_insert_self" on public.websites;
create policy "websites_insert_self" on public.websites
  for insert to authenticated with check (true);

-- Editing and removing stay with the owner and with whoever it is assigned
-- to, so somebody can tidy their own list without reaching anyone else's.
drop policy if exists "websites_update_assigned" on public.websites;
create policy "websites_update_assigned" on public.websites
  for update to authenticated
  using (
    public.is_owner()
    or exists (
      select 1 from public.website_assignments wa
      where wa.website_id = websites.id and wa.employee_id = auth.uid()
    )
  )
  with check (
    public.is_owner()
    or exists (
      select 1 from public.website_assignments wa
      where wa.website_id = websites.id and wa.employee_id = auth.uid()
    )
  );

drop policy if exists "websites_delete_assigned" on public.websites;
create policy "websites_delete_assigned" on public.websites
  for delete to authenticated using (
    public.is_owner()
    or exists (
      select 1 from public.website_assignments wa
      where wa.website_id = websites.id and wa.employee_id = auth.uid()
    )
  );


-- ─── 3. Assignments: to yourself, or anyone if you are the owner ────────────

drop policy if exists "website_assignments_write_admin"     on public.website_assignments;
drop policy if exists "website_assignments_write_any_admin" on public.website_assignments;
drop policy if exists "website_assignments_write_scoped"    on public.website_assignments;
drop policy if exists "website_assignments_write_self"      on public.website_assignments;

create policy "website_assignments_write_self" on public.website_assignments
  for all to authenticated
  using (public.is_owner() or employee_id = auth.uid())
  with check (public.is_owner() or employee_id = auth.uid());


-- ─── 4. Confirm ─────────────────────────────────────────────────────────────

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('websites', 'website_assignments')
order by tablename, cmd, policyname;
