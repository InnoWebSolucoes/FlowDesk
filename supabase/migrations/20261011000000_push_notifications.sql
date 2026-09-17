-- ============================================================================
-- Push notifications to phones.
--
-- Every notification already lands in the bell. This makes it also reach the
-- phone of whoever it is for, through the browser's push service — Android
-- and iPhone alike, once FlowDesk is on the home screen.
--
-- Two parts:
--   push_subscriptions — one row per phone (or browser) a person has turned
--                        notifications on in. The app writes it; the send-push
--                        edge function reads it.
--   a trigger          — every new notification row asks the send-push edge
--                        function to deliver it. Asynchronous (pg_net), so
--                        the insert never waits on a phone.
--
-- The function is handed only the row's id and re-reads the row itself with
-- its own privileges, so whatever calls it cannot make it push words that
-- are not in the table. Nothing here reads or changes existing rows.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  -- The push service's URL for this device. Unique per device, and what the
  -- service identifies it by, so it is the key.
  endpoint text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  -- The device's encryption keys, as the browser hands them out.
  p256dh text not null,
  auth text not null,
  -- Which phone or browser, for the person's own reference.
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Your own devices, nobody else's.
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Hand each new notification to the edge function ────────────────────────

-- The key the trigger presents to the function lives in Vault, not here.
-- Set it once in the SQL editor (the project's anon key, the same value as
-- VITE_SUPABASE_ANON_KEY):
--
--   select vault.create_secret('<anon key>', 'send_push_key');
--
-- Until it is set, the trigger does nothing, so notifications keep working
-- in the bell as before.

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = public, extensions as $fn$
declare
  key text;
begin
  select decrypted_secret into key
  from vault.decrypted_secrets
  where name = 'send_push_key'
  limit 1;
  if key is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://bccqkppxfpncdpalhkws.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || key
    ),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$fn$;

drop trigger if exists notification_push on public.notifications;
create trigger notification_push
  after insert on public.notifications
  for each row execute function public.push_notification();
