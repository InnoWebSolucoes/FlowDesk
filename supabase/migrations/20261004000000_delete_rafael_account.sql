-- ============================================================================
-- Delete Rafael's account — whichever account that is.
--
-- The earlier script (20260926) went by one email, rafamdann@gmail.com. If
-- the account still showing is a different one — a second sign-up, a
-- different address, a row that still says role = 'admin' and so never
-- appears in the team list where the delete button lives — that script
-- found nothing and said so only in a notice nobody reads.
--
-- This one goes by name as well as email, deletes every match that is not
-- the owner, and finishes by listing every account left, so what happened
-- is on screen rather than in the notices tab.
--
-- The owner can never match: deleting the one account that manages
-- everything would lock the company out of its own app.
--
-- Needs 20261001000000_deleting_a_person_works.sql to have run first (the
-- verify script's rows all say OK, so it has). Safe to run twice.
-- ============================================================================


-- ─── 1. Nobody but the owner is an admin ────────────────────────────────────
-- Restated from 20260926: a row still carrying role = 'admin' is not drawn on
-- the team page at all, which is why it cannot be deleted from there.
-- guard_owner_flag reads auth.uid(), null in the SQL editor, so it is
-- disabled around the update and put straight back.

do $demote$
begin
  begin
    execute 'alter table public.users disable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;

  update public.users
  set is_owner = false, role = 'employee'
  where lower(email) <> 'innowebsolucoes@gmail.com'
    and (is_owner or role <> 'employee');

  begin
    execute 'alter table public.users enable trigger guard_owner_flag';
  exception when undefined_object then
    null;
  end;
end
$demote$;


-- ─── 1b. Deleting a person must not leave a todo belonging to nobody ────────
-- project_todos_has_an_owner says every todo has an assignee, a list owner
-- or a creator. A todo somebody made for themselves on a list with no owner
-- has only them in all three — so when their account goes, the SET NULL
-- cascades empty all three at once and the check refuses the whole delete
-- ("violates check constraint project_todos_has_an_owner").
--
-- Such a todo was that person's alone, and goes with them. This trigger
-- removes them just before the user row is deleted, so the cascade has
-- nothing left to refuse. Permanent: the dashboard's delete button hits the
-- same wall without it.

create or replace function public.drop_todos_of_departing_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.project_todos
  where (assignee_id is null or assignee_id = old.id)
    and (owner_id    is null or owner_id    = old.id)
    and (created_by  is null or created_by  = old.id);
  return old;
end;
$$;

drop trigger if exists drop_todos_of_departing_user on public.users;
create trigger drop_todos_of_departing_user
  before delete on public.users
  for each row execute function public.drop_todos_of_departing_user();


-- ─── 2. Rafael ──────────────────────────────────────────────────────────────

do $rafael$
declare
  victim record;
  n int := 0;
begin
  for victim in
    select u.id, u.email, u.name
    from public.users u
    where not u.is_owner
      and lower(u.email) <> 'innowebsolucoes@gmail.com'
      and (
        lower(u.email) = 'rafamdann@gmail.com'
        or u.name ilike 'rafael%'
        or u.email ilike 'rafael%'
      )
  loop
    -- Through auth.users, which cascades into public.users and on through
    -- the app's tables. An orphan row with no auth user is removed directly.
    delete from auth.users where id = victim.id;
    delete from public.users where id = victim.id;
    n := n + 1;
    raise notice 'Deleted % (%, %)', victim.name, victim.email, victim.id;
  end loop;

  if n = 0 then
    raise notice 'Nothing matched: no non-owner account named Rafael or under rafamdann@gmail.com.';
  end if;
end
$rafael$;


-- ─── 3. What is left ────────────────────────────────────────────────────────
-- Every account, so the result of the two blocks above is on screen.

select u.name, u.email, u.role, u.is_owner,
       case when a.id is null then 'no auth user' else 'ok' end as auth
from public.users u
left join auth.users a on a.id = u.id
order by u.is_owner desc, u.name;
