-- ============================================================================
-- A project is never deleted by accident.
--
-- Deleting a project takes everything filed under it with it, by cascade: its
-- tasks and every tick on them, its todo lists, notes, resources, work logs,
-- chat, calendar and content calendar. Until now that was one right-click and
-- one click, with no question asked, from the project list — and one click on
-- the project's About page. That is the whole business one slip away.
--
-- From here on the database refuses to delete a project unless, in the five
-- minutes before, the owner has confirmed it by name through
-- request_project_deletion(). FlowDesk only calls that at the end of three
-- separate steps: reading what will be lost, typing the project's name, and
-- entering their password again. Any other route to a delete — an old copy of
-- the desktop app that still has the one-click version, a bug, a stray call —
-- is refused here, whatever the app asks for.
--
-- The SQL editor is refused too: auth.uid() is empty there, so nobody can have
-- confirmed. To delete a project by hand on purpose, disable the trigger around
-- the statement:
--
--   alter table public.projects disable trigger guard_project_delete;
--   delete from public.projects where id = '…';
--   alter table public.projects enable trigger guard_project_delete;
--
-- ─── What this file does to existing data: nothing ──────────────────────────
--
-- Adds two nullable columns to public.projects, one function to confirm a
-- deletion and one trigger that refuses unconfirmed ones. No delete, update,
-- truncate or drop of any table, column, policy or row. Running it twice is
-- the same as running it once.
-- ============================================================================

alter table public.projects
  add column if not exists delete_confirmed_at timestamptz,
  add column if not exists delete_confirmed_by uuid references public.users(id) on delete set null;


-- The confirmation. Only the owner, and only with the project's exact name —
-- so the check on the name is made here and not only in the browser.
create or replace function public.request_project_deletion(p_project uuid, p_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete a project.';
  end if;

  select name into v_name from projects where id = p_project;
  if v_name is null then
    raise exception 'That project does not exist.';
  end if;
  if btrim(coalesce(p_name, '')) <> btrim(v_name) then
    raise exception 'The name typed does not match the project''s name.';
  end if;

  update projects
  set delete_confirmed_at = now(),
      delete_confirmed_by = auth.uid()
  where id = p_project;
end;
$$;

revoke all on function public.request_project_deletion(uuid, text) from public;
grant execute on function public.request_project_deletion(uuid, text) to authenticated;


-- The refusal.
create or replace function public.guard_project_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.delete_confirmed_at is null
     or old.delete_confirmed_at < now() - interval '5 minutes'
     or old.delete_confirmed_by is distinct from auth.uid() then
    raise exception 'Projects cannot be deleted without confirming it in FlowDesk first (About → Delete project).';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_project_delete on public.projects;
create trigger guard_project_delete
  before delete on public.projects
  for each row execute function public.guard_project_delete();

notify pgrst, 'reload schema';
