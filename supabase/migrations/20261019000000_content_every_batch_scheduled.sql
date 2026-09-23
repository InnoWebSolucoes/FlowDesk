-- ============================================================================
-- Every editing session delivered and scheduled — and a look at the result.
--
-- Delivery and scheduling arrived after the first version of the content
-- calendar. An editing session saved before then has neither day, so its
-- batch never shows up to be delivered or scheduled, and its pieces are never
-- ready to post. Those get the plan's own rule: delivered the day they are
-- edited, scheduled the Monday after.
--
-- Only a session with neither day is touched. One that has either was set on
-- purpose and is left alone, and running this twice changes nothing.
--
-- The last statement lists each client's scheduling days, so running this
-- also shows what the calendar should be drawing.
-- ============================================================================

update public.content_edits
set deliver_on = edited_on,
    -- The Monday of the edit's week, plus a week: the Monday after.
    schedule_on = date_trunc('week', edited_on)::date + 7
where deliver_on is null
  and schedule_on is null;

select
  c.name as cliente,
  count(e.id) as edicoes,
  count(e.schedule_on) as agendadas,
  string_agg(to_char(e.schedule_on, 'DD/MM'), ', ' order by e.schedule_on) as dias_de_agendamento
from public.content_clients c
left join public.content_edits e on e.client_id = c.id
where not c.is_archived
group by c.id, c.name
order by c.name;
