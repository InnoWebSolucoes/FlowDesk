-- People can belong to more than one project.
--
-- users.project_id held exactly one, so someone working across two clients had
-- to exist twice, with two logins and two halves of a history. Membership
-- moves to its own table; project_id stays as the person's primary project so
-- nothing that reads it breaks, and it is kept in step with the memberships.

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on public.project_members(user_id);

-- Everyone keeps the project they are on today.
insert into public.project_members (project_id, user_id)
select u.project_id, u.id
from public.users u
where u.project_id is not null
on conflict do nothing;

-- ─── Membership as a predicate ──────────────────────────────────────────────

create or replace function public.is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members
    where user_id = auth.uid() and project_id = p
  );
$$;

-- Someone's primary project, for the places that still want a single one.
-- Keeping project_id populated means the existing reads carry on working
-- while the app is taught about multiple memberships.
create or replace function public.sync_primary_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.users
    set project_id = new.project_id
    where id = new.user_id and project_id is null;
  elsif tg_op = 'DELETE' then
    -- Losing your primary project promotes whichever membership remains.
    update public.users u
    set project_id = (
      select pm.project_id from public.project_members pm
      where pm.user_id = old.user_id
      order by pm.added_at
      limit 1
    )
    where u.id = old.user_id and u.project_id = old.project_id;
  end if;
  return null;
end;
$$;

drop trigger if exists sync_primary_project on public.project_members;
create trigger sync_primary_project
  after insert or delete on public.project_members
  for each row execute procedure public.sync_primary_project();

-- ─── Who may read and change membership ─────────────────────────────────────

alter table public.project_members enable row level security;

-- You can see who is on a project you are part of, or that you administer.
create policy "project_members_select" on public.project_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_project_admin(project_id)
    or public.is_project_member(project_id)
  );

-- An admin of the project adds and removes its people — including adding
-- someone who already works on another project, which is the point.
create policy "project_members_write_scoped" on public.project_members
  for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

-- ─── Seeing a project you are a member of ───────────────────────────────────
-- projects_select_scoped asked users.project_id, which now only names the
-- primary one; a second project would be invisible to the people on it.

drop policy if exists "projects_select_scoped" on public.projects;
create policy "projects_select_scoped" on public.projects
  for select to authenticated
  using (public.is_project_admin(id) or public.is_project_member(id));

-- ─── Reading people across projects ─────────────────────────────────────────
-- An admin may edit anyone who shares a project with them, by any membership
-- rather than only by their primary one.

drop policy if exists "users_write_scoped" on public.users;
create policy "users_write_scoped" on public.users
  for all to authenticated
  using (
    public.is_owner()
    or (
      public.is_admin()
      and exists (
        select 1 from public.project_members pm
        where pm.user_id = users.id and public.is_project_admin(pm.project_id)
      )
    )
  )
  with check (
    public.is_owner()
    or (
      public.is_admin()
      and exists (
        select 1 from public.project_members pm
        where pm.user_id = users.id and public.is_project_admin(pm.project_id)
      )
    )
  );

-- ─── A new account joins its project ────────────────────────────────────────
-- handle_new_user writes users.project_id from the signup metadata. Without a
-- matching membership row that person is on a project by the old column and on
-- none by the new table, so the two would disagree from the first minute.

create or replace function public.member_from_primary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null then
    insert into public.project_members (project_id, user_id)
    values (new.project_id, new.id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists member_from_primary on public.users;
create trigger member_from_primary
  after insert on public.users
  for each row execute procedure public.member_from_primary();
