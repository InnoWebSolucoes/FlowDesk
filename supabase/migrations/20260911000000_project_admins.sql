-- Admins become scoped to projects, with one owner above them.
--
-- Until now every admin saw everything: is_admin() asked only "are you an
-- admin", never "of what". That is right for the person who owns the company
-- and wrong for anyone brought in to run a single client.
--
-- The shape:
--   owner  - one person, full access to everything, the only one who can
--            create or delete projects and grant admin access.
--   admin  - granted specific projects; inside them they can do everything the
--            owner can, and outside them they see nothing.
--
-- Existing admins become the owner or keep full access, so nobody is locked
-- out by this migration: the first admin created becomes the owner and the
-- rest are granted every project that exists today.

-- ─── Who owns the place ─────────────────────────────────────────────────────

alter table public.users
  add column if not exists is_owner boolean not null default false;

-- The oldest admin is the owner. Deterministic, and in practice the account
-- that set the company up.
update public.users
set is_owner = true
where id = (
  select id from public.users where role = 'admin' order by join_date, id limit 1
)
and not exists (select 1 from public.users where is_owner);

-- ─── Which projects an admin may run ────────────────────────────────────────

create table if not exists public.project_admins (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.users(id),
  primary key (project_id, user_id)
);

create index if not exists project_admins_user_idx on public.project_admins(user_id);

-- Everyone who is an admin today keeps the access they have today, or this
-- migration would quietly lock them out of their own work.
insert into public.project_admins (project_id, user_id)
select p.id, u.id
from public.projects p
cross join public.users u
where u.role = 'admin' and not u.is_owner
on conflict do nothing;

-- ─── The predicates every policy is built on ────────────────────────────────

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_owner);
$$;

-- is_admin() keeps its name and its meaning for the owner, so the 100-odd
-- policies that call it keep working. What changes is that a scoped admin is
-- no longer globally true: they must go through is_project_admin().
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin' and is_owner
  );
$$;

-- True for the owner anywhere, and for an admin on a project they were given.
create or replace function public.is_project_admin(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_owner()
    or exists (
      select 1
      from public.project_admins pa
      join public.users u on u.id = pa.user_id
      where pa.user_id = auth.uid()
        and pa.project_id = p
        and u.role = 'admin'
    );
$$;

-- "Is this person an admin at all", regardless of which projects. Used where
-- the check is about capability rather than a specific project.
create or replace function public.is_any_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- ─── Who may grant access ───────────────────────────────────────────────────

alter table public.project_admins enable row level security;

-- An admin can see their own grants; the owner sees all of them.
create policy "project_admins_select" on public.project_admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

-- Only the owner hands out access, so an admin cannot widen their own reach.
create policy "project_admins_write_owner" on public.project_admins
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- ─── Project-scoped access for the tables that carry a project ──────────────
-- These replace the blanket admin policies with ones that ask which project.

drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_write_admin" on public.projects;
create policy "projects_select_scoped" on public.projects
  for select to authenticated
  using (
    public.is_project_admin(id)
    or exists (select 1 from public.users where id = auth.uid() and project_id = projects.id)
  );

-- Creating and deleting a whole project stays with the owner.
create policy "projects_insert_owner" on public.projects
  for insert to authenticated with check (public.is_owner());
create policy "projects_delete_owner" on public.projects
  for delete to authenticated using (public.is_owner());
-- A scoped admin may rename and edit the projects they run.
create policy "projects_update_scoped" on public.projects
  for update to authenticated
  using (public.is_project_admin(id)) with check (public.is_project_admin(id));

-- ─── People ─────────────────────────────────────────────────────────────────
-- An admin sees the people on their projects; the owner sees everyone.

drop policy if exists "users_write_admin" on public.users;
create policy "users_write_scoped" on public.users
  for all to authenticated
  using (
    public.is_owner()
    or (public.is_any_admin() and project_id is not null and public.is_project_admin(project_id))
  )
  with check (
    public.is_owner()
    or (public.is_any_admin() and project_id is not null and public.is_project_admin(project_id))
  );

-- Nobody but the owner may make someone else an owner. Enforced in a trigger
-- because a policy cannot see the old row's value on update.
create or replace function public.guard_owner_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.is_owner)
     or (tg_op = 'UPDATE' and new.is_owner is distinct from old.is_owner) then
    if not public.is_owner() then
      raise exception 'Only the owner can change ownership';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_owner_flag on public.users;
create trigger guard_owner_flag
  before insert or update on public.users
  for each row execute procedure public.guard_owner_flag();
