-- ============================================================================
-- Deactivating somebody, as an alternative to deleting them.
--
-- Deleting is permanent and takes their history with it: comments and
-- uploads go, and tasks they created lose their author. That is the right
-- thing when somebody was added by mistake, and the wrong thing when they
-- have simply left — the record of what they did is usually worth keeping.
--
-- Deactivating stops them signing in and takes them off the lists people
-- pick from, while leaving everything they did exactly where it is.
-- ============================================================================

alter table public.users
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz;

-- Who is still working here, which is the question almost every list is
-- really asking.
create index if not exists users_is_active_idx on public.users(is_active);


-- ─── Signing in ─────────────────────────────────────────────────────────────
-- Blocking the login itself is done through Supabase's own ban_duration, in
-- the deactivate-employee function, not with a trigger on auth.sessions. A
-- trigger there would be a home-made rule inside a schema Supabase manages
-- and upgrades, and getting it wrong locks everybody out — including the
-- account needed to undo it.
--
-- So this column is the app's record of who is still here, and the ban is
-- what actually stops the password working. The function sets both together.


-- ─── Turning it on and off ──────────────────────────────────────────────────
-- The owner's alone, and it cannot reach the owner: locking the only account
-- that can unlock things is not a state to be able to get into.

create or replace function public.set_user_active(target uuid, active boolean)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can deactivate an account.';
  end if;

  if exists (select 1 from public.users where id = target and is_owner) then
    raise exception 'The owner account cannot be deactivated.';
  end if;

  update public.users
  set is_active = active,
      deactivated_at = case when active then null else now() end
  where id = target;
end;
$$;

revoke all on function public.set_user_active(uuid, boolean) from public;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;


-- ─── Confirm ────────────────────────────────────────────────────────────────

select name, email, role, is_owner, is_active, deactivated_at
from public.users
order by is_owner desc, is_active desc, name;
