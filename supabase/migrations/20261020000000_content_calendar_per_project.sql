-- ============================================================================
-- The content calendar belongs to an organisation.
--
-- It started as a tab of its own in the main sidebar, shared by everyone. It
-- is InnoWeb's work, so it now lives inside a project, the way todos,
-- resources and the calendar do: a project either has a content calendar or
-- it does not, and its clients are its own.
--
--   projects.has_content_calendar   whether the project's sidebar has the tab
--   content_clients.project_id      the project a client's content is for
--
-- InnoWeb's project gets the tab, and every client made so far moves into it.
-- It is found by name. If no project, or more than one, is called InnoWeb —
-- and there is more than one project to choose from — nothing is changed and
-- the error lists the projects, so the right one can be named.
--
-- Who can see and work on a client follows its project: the project's members
-- and the owner. The content plans' files follow their client the same way.
-- ============================================================================

alter table public.projects
  add column if not exists has_content_calendar boolean not null default false;

alter table public.content_clients
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

create index if not exists content_clients_project_idx
  on public.content_clients(project_id);

do $$
declare
  matches uuid[];
  target uuid;
  names text;
begin
  select array_agg(id order by created_at) into matches
  from public.projects
  where not is_archived
    and (name ~* 'inno\s*web' or company_name ~* 'inno\s*web');

  if coalesce(array_length(matches, 1), 0) = 1 then
    target := matches[1];
  elsif coalesce(array_length(matches, 1), 0) = 0
    and (select count(*) from public.projects where not is_archived) = 1 then
    -- A single project is InnoWeb's, whatever it is called.
    select id into target from public.projects where not is_archived;
  else
    select string_agg(name, ', ' order by name) into names
    from public.projects
    where not is_archived;
    raise exception 'Could not tell which project is InnoWeb''s, so nothing was changed. Projects: %',
      coalesce(names, '(none)');
  end if;

  update public.projects set has_content_calendar = true where id = target;
  update public.content_clients set project_id = target where project_id is null;
end $$;

-- Every client is for some project from now on.
alter table public.content_clients
  alter column project_id set not null;

-- ─── Access ─────────────────────────────────────────────────────────────────

drop policy if exists content_clients_select on public.content_clients;
create policy content_clients_select on public.content_clients
  for select to authenticated
  using (public.is_owner() or public.in_project(project_id));

drop policy if exists content_clients_insert on public.content_clients;
create policy content_clients_insert on public.content_clients
  for insert to authenticated
  with check (public.is_owner() or public.in_project(project_id));

drop policy if exists content_clients_update on public.content_clients;
create policy content_clients_update on public.content_clients
  for update to authenticated
  using (public.is_owner() or public.in_project(project_id))
  with check (public.is_owner() or public.in_project(project_id));

-- Deleting a client stays the owner's alone, as before.

-- Everything under a client — its shoots, edits, posting days and posts — is
-- for whoever can see the client. The check reads content_clients, whose own
-- policy above decides that.
do $$
declare t text;
begin
  foreach t in array array['content_recordings', 'content_edits', 'content_post_rules', 'content_posts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (exists (select 1 from public.content_clients c where c.id = client_id))
         with check (exists (select 1 from public.content_clients c where c.id = client_id))',
      t || '_all', t
    );
  end loop;
end $$;

-- A plan's file sits under its client's id: <client>/<recording>/<file>.
-- objects.name is spelled out because content_clients has a name of its own.
drop policy if exists content_plans_select on storage.objects;
create policy content_plans_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'content-plans'
    and exists (
      select 1 from public.content_clients c
      where c.id::text = (storage.foldername(objects.name))[1]
    )
  );

drop policy if exists content_plans_insert on storage.objects;
create policy content_plans_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-plans'
    and exists (
      select 1 from public.content_clients c
      where c.id::text = (storage.foldername(objects.name))[1]
    )
  );

drop policy if exists content_plans_update on storage.objects;
create policy content_plans_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'content-plans'
    and exists (
      select 1 from public.content_clients c
      where c.id::text = (storage.foldername(objects.name))[1]
    )
  );

drop policy if exists content_plans_delete on storage.objects;
create policy content_plans_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'content-plans'
    and exists (
      select 1 from public.content_clients c
      where c.id::text = (storage.foldername(objects.name))[1]
    )
  );

-- Which project has it, and how many clients are in it — shown when this runs.
select p.name as projeto, count(c.id) as clientes
from public.projects p
left join public.content_clients c on c.project_id = p.id
where p.has_content_calendar
group by p.id, p.name;
