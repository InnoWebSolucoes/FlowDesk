-- ============================================================================
-- A chat message can be edited for 15 minutes after it was sent.
--
-- The app offers the edit within that window; this makes sure the database
-- refuses one outside it, whoever asks. Only the words are held to the
-- window — marking a message deleted is a different change and stays as it
-- was. Nothing here reads or changes existing rows.
-- ============================================================================

create or replace function public.chat_message_edit_window()
returns trigger language plpgsql as $fn$
begin
  if new.body is distinct from old.body then
    if old.created_at < now() - interval '15 minutes' then
      raise exception 'A message can only be edited within 15 minutes of sending it.';
    end if;
    new.edited_at := now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists chat_message_edit_window on public.chat_messages;
create trigger chat_message_edit_window
  before update on public.chat_messages
  for each row execute function public.chat_message_edit_window();
