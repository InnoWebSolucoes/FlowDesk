-- ============================================================================
-- The owner can write a work log entry on somebody's behalf.
--
-- Opening an employee's side of the app as them and adding to their work log
-- saved the entry under the owner's own id — the insert policy insisted on
-- it — so it never showed in the employee's list and looked like it had
-- vanished. The app now sends the author it is acting as; these policies
-- let the owner do that. Everyone else still writes only as themselves.
--
-- Nothing here touches data. The three policies are altered in place —
-- their conditions change, no rows are read, written or removed — so the
-- entries already on the site are exactly as they were afterwards.
-- ============================================================================

alter policy "work_log_insert" on public.work_log_entries
  with check (
    (author_id = auth.uid() and (public.in_project(project_id) or public.is_project_admin(project_id)))
    or public.is_owner()
  );

alter policy "work_log_update" on public.work_log_entries
  using (author_id = auth.uid() or public.is_owner())
  with check (author_id = auth.uid() or public.is_owner());

alter policy "work_log_items_write" on public.work_log_items
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
