-- ============================================================================
-- set_user_active refused the service role, so deactivating never worked.
--
-- The function guards itself with is_owner(), which reads auth.uid(). The
-- deactivate-employee function calls it with the service role, where
-- auth.uid() is null — so is_owner() was false and every call raised "Only
-- the owner can deactivate an account", whoever was signed in.
--
-- The service role reaching this function is not a hole: the edge function
-- has already checked that the caller is the owner before it gets here, and
-- the service key is never in the browser. What the guard is for is the case
-- where somebody calls the RPC directly from the app with their own session,
-- and that still has to be the owner.
--
-- The owner check stays. Only the service role is let through, and only
-- because something has already done the checking on its behalf.
-- ============================================================================

create or replace function public.set_user_active(target uuid, active boolean)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  -- auth.uid() is null under the service role, which is how the edge function
  -- arrives; it has verified the caller is the owner already. Any other
  -- caller is somebody's own session and must be the owner themselves.
  if auth.uid() is not null and not public.is_owner() then
    raise exception 'Only the owner can deactivate an account.';
  end if;

  -- The owner is never a valid target, whoever is asking. Locking the one
  -- account that can unlock things is not a state to be able to reach.
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
-- The body should contain "auth.uid() is not null and not public.is_owner()".

select pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_user_active';
