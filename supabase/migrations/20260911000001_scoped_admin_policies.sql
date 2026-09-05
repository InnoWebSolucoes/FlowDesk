-- Finish scoping admins to their projects.
--
-- 20260911000000 introduced the owner and the project_admins table, and
-- narrowed is_admin() to mean "the owner". That alone locks a project admin
-- out of the ~100 policies still written as is_admin(): they could see a
-- project and do nothing inside it.
--
-- This migration rewrites those policies to ask *which* project. The rule
-- throughout is is_project_admin(<the row's project>), which is true for the
-- owner everywhere and for an admin on the projects they were granted. Inside
-- those projects an admin can do everything the owner can — create and delete
-- tasks, people, documents, everything.
--
-- Tables whose rows do not carry a project_id reach one by joining: an item
-- through its project, a todo link through its todo, a task assignment
-- through its task.

-- ─── Restore the general predicate, and add the scoped one ──────────────────
-- is_admin() goes back to meaning "an admin of some kind", because a policy
-- that only needs to know "is this person staff" should not care which
-- project. Anywhere the project matters, the policies below name it.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- The project a task belongs to, for policies on task children.
create or replace function public.task_project(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select project_id from public.tasks where id = t;
$$;

-- ─── Projects ───────────────────────────────────────────────────────────────

drop policy if exists "projects_select_scoped" on public.projects;
create policy "projects_select_scoped" on public.projects
  for select to authenticated
  using (
    public.is_project_admin(id)
    or exists (select 1 from public.users u where u.id = auth.uid() and u.project_id = projects.id)
  );

-- ─── Resources ──────────────────────────────────────────────────────────────

drop policy if exists "resource_clusters_write_admin" on public.resource_clusters;
create policy "resource_clusters_write_scoped" on public.resource_clusters
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "resource_items_write_admin" on public.resource_items;
create policy "resource_items_write_scoped" on public.resource_items
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "resource_item_links_write_admin" on public.resource_item_links;
drop policy if exists "resource_item_links_write" on public.resource_item_links;
create policy "resource_item_links_write_scoped" on public.resource_item_links
  for all to authenticated
  using (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_links.item_id and public.is_project_admin(i.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_links.item_id and public.is_project_admin(i.project_id)
    )
  );

drop policy if exists "resource_item_clusters_write_admin" on public.resource_item_clusters;
create policy "resource_item_clusters_write_scoped" on public.resource_item_clusters
  for all to authenticated
  using (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_clusters.item_id and public.is_project_admin(i.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_clusters.item_id and public.is_project_admin(i.project_id)
    )
  );

drop policy if exists "resource_item_access_write_admin" on public.resource_item_access;
create policy "resource_item_access_write_scoped" on public.resource_item_access
  for all to authenticated
  using (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_access.item_id and public.is_project_admin(i.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_access.item_id and public.is_project_admin(i.project_id)
    )
  );

drop policy if exists "resource_cluster_access_write_admin" on public.resource_cluster_access;
create policy "resource_cluster_access_write_scoped" on public.resource_cluster_access
  for all to authenticated
  using (
    exists (
      select 1 from public.resource_clusters c
      where c.id = resource_cluster_access.cluster_id and public.is_project_admin(c.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.resource_clusters c
      where c.id = resource_cluster_access.cluster_id and public.is_project_admin(c.project_id)
    )
  );

-- ─── Todos ──────────────────────────────────────────────────────────────────

drop policy if exists "project_todos_write_admin" on public.project_todos;
drop policy if exists "project_todos_admin" on public.project_todos;
create policy "project_todos_write_scoped" on public.project_todos
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "project_todo_lists_admin" on public.project_todo_lists;
create policy "project_todo_lists_write_scoped" on public.project_todo_lists
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "project_todo_links_admin" on public.project_todo_links;
create policy "project_todo_links_write_scoped" on public.project_todo_links
  for all to authenticated
  using (
    exists (
      select 1 from public.project_todos t
      where t.id = project_todo_links.todo_id and public.is_project_admin(t.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.project_todos t
      where t.id = project_todo_links.todo_id and public.is_project_admin(t.project_id)
    )
  );

drop policy if exists "project_todo_shares_write_admin" on public.project_todo_shares;
create policy "project_todo_shares_write_scoped" on public.project_todo_shares
  for all to authenticated
  using (
    exists (
      select 1 from public.project_todos t
      where t.id = project_todo_shares.todo_id and public.is_project_admin(t.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.project_todos t
      where t.id = project_todo_shares.todo_id and public.is_project_admin(t.project_id)
    )
  );

-- ─── Notes ──────────────────────────────────────────────────────────────────

drop policy if exists "project_notes_admin" on public.project_notes;
create policy "project_notes_write_scoped" on public.project_notes
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "project_note_items_admin" on public.project_note_items;
create policy "project_note_items_write_scoped" on public.project_note_items
  for all to authenticated
  using (
    exists (
      select 1 from public.project_notes n
      where n.id = project_note_items.note_id and public.is_project_admin(n.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.project_notes n
      where n.id = project_note_items.note_id and public.is_project_admin(n.project_id)
    )
  );

-- ─── Tasks ──────────────────────────────────────────────────────────────────
-- Tasks carry a project directly; their children reach it through the task.

drop policy if exists "tasks_write_admin" on public.tasks;
drop policy if exists "tasks_admin_all" on public.tasks;
create policy "tasks_write_scoped" on public.tasks
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

drop policy if exists "task_assignments_write_admin" on public.task_assignments;
drop policy if exists "task_assignments_admin" on public.task_assignments;
create policy "task_assignments_write_scoped" on public.task_assignments
  for all to authenticated
  using (
    public.is_project_admin(public.task_project(task_id))
    -- An employee schedules their own work.
    or employee_id = auth.uid()
  )
  with check (
    public.is_project_admin(public.task_project(task_id))
    or employee_id = auth.uid()
  );

-- ─── Categories ─────────────────────────────────────────────────────────────
-- Categories are shared across projects and carry no project of their own, so
-- any admin may add one. Narrowing this would stop a project admin creating a
-- task in a category that does not exist yet.

drop policy if exists "categories_write_admin" on public.categories;
create policy "categories_write_any_admin" on public.categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─── Document versions ──────────────────────────────────────────────────────

drop policy if exists "resource_item_versions_write_admin" on public.resource_item_versions;
create policy "resource_item_versions_write_scoped" on public.resource_item_versions
  for all to authenticated
  using (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_versions.item_id and public.is_project_admin(i.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.resource_items i
      where i.id = resource_item_versions.item_id and public.is_project_admin(i.project_id)
    )
  );

-- ─── Per-employee guidelines ────────────────────────────────────────────────
-- Written about a person, so the scope is the project that person is on.

drop policy if exists "guidelines_write_admin" on public.guidelines;
create policy "guidelines_write_scoped" on public.guidelines
  for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = guidelines.employee_id
        and u.project_id is not null
        and public.is_project_admin(u.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = guidelines.employee_id
        and u.project_id is not null
        and public.is_project_admin(u.project_id)
    )
  );

-- ─── Websites ───────────────────────────────────────────────────────────────
-- A shared library with no project of its own, like categories: any admin may
-- maintain it.

drop policy if exists "websites_write_admin" on public.websites;
create policy "websites_write_any_admin" on public.websites
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "website_assignments_write_admin" on public.website_assignments;
create policy "website_assignments_write_scoped" on public.website_assignments
  for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = website_assignments.employee_id
        and u.project_id is not null
        and public.is_project_admin(u.project_id)
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = website_assignments.employee_id
        and u.project_id is not null
        and public.is_project_admin(u.project_id)
    )
  );
