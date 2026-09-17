-- ============================================================================
-- The owner can write a work log entry on somebody's behalf.
--
-- Opening an employee's side of the app as them and adding to their work log
-- saved the entry under the owner's own id — the insert policy insisted on
-- it — so it never showed in the employee's list and looked like it had
-- vanished. The app now sends the author it is acting as; these policies
-- let the owner do that. Everyone else still writes only as themselves.
-- ============================================================================

drop policy if exists "work_log_insert" on public.work_log_entries;
create policy "work_log_insert" on public.work_log_entries
  for insert to authenticated with check (
    (author_id = auth.uid() and (public.in_project(project_id) or public.is_project_admin(project_id)))
    or public.is_owner()
  );

drop policy if exists "work_log_update" on public.work_log_entries;
create policy "work_log_update" on public.work_log_entries
  for update to authenticated
  using (author_id = auth.uid() or public.is_owner())
  with check (author_id = auth.uid() or public.is_owner());

drop policy if exists "work_log_items_write" on public.work_log_items;
create policy "work_log_items_write" on public.work_log_items
  for all to authenticated
  using (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id and (e.author_id = auth.uid() or public.is_owner())
    )
  )
  with check (
    exists (
      select 1 from public.work_log_entries e
      where e.id = entry_id and (e.author_id = auth.uid() or public.is_owner())
    )
  );
