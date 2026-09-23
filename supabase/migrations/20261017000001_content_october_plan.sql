-- ============================================================================
-- The October content plan, loaded into the content calendar.
--
-- Seven clients, and every shoot, edit, delivery and scheduling day from the
-- October plan and the four-week rhythm after it, up to Christmas:
--
--   week 1  record + edit Espaço Luanda, Okulya, Dermevet, Oluango;
--           deliver the lot on Saturday
--   week 2  schedule them on Monday; record + edit Shazia Saima and
--           Sra Tasca, deliver on Saturday
--   week 3  schedule those; record + edit Dialis, Dermevet and Oluango,
--           deliver
--   week 4  light week: schedule Dermevet, Oluango and Dialis on Monday
--
-- Every shoot is edited the next day, and has a content plan due two days
-- before it. Posting days are those of the plan and carry on with no end
-- date — except Dialis, whose three pieces a month fill three Wednesdays out
-- of four, so each batch gets its own window. Once the last batch here has
-- gone out, in early January, the calendar shows the posting days with
-- nothing to publish: that is the cue to book the next shoots.
--
-- Nobody is assigned to anything yet; that is done in the app.
--
-- Safe to run twice. A client that already has recordings, edits or posting
-- days is left exactly as it is. One created by hand under the same name
-- with nothing in it yet is filled in, rather than added a second time.
--
-- Needs 20261017000000_content_delivery_and_scheduling.sql first.
-- ============================================================================

do $$
declare
  -- One entry per client. A shoot is
  --   [recorded on, pieces, edited on, delivered on, scheduled on]
  -- and a posting rule is
  --   [weekdays (0 = Sunday … 6 = Saturday), from, until or null].
  seed jsonb := $seed$
  [
    {"name": "Espaço Luanda", "code": "ESP", "color": "#0E7A6A", "per_month": 8,
     "notes": "Gravado de quatro em quatro semanas, no mesmo dia que Okulya, 8 peças por gravação. Publica à quarta e ao sábado.",
     "shoots": [
       ["2026-10-05", 8, "2026-10-06", "2026-10-10", "2026-10-12"],
       ["2026-11-02", 8, "2026-11-03", "2026-11-07", "2026-11-09"],
       ["2026-11-30", 8, "2026-12-01", "2026-12-05", "2026-12-07"]
     ],
     "posting": [[[3, 6], "2026-10-12", null]]},

    {"name": "Okulya", "code": "OKU", "color": "#7B3D9E", "per_month": 8,
     "notes": "Gravado de quatro em quatro semanas, no mesmo dia que o Espaço Luanda, 8 peças por gravação. Publica à segunda e à quinta.",
     "shoots": [
       ["2026-10-05", 8, "2026-10-06", "2026-10-10", "2026-10-12"],
       ["2026-11-02", 8, "2026-11-03", "2026-11-07", "2026-11-09"],
       ["2026-11-30", 8, "2026-12-01", "2026-12-05", "2026-12-07"]
     ],
     "posting": [[[1, 4], "2026-10-12", null]]},

    {"name": "Dermevet", "code": "DER", "color": "#2360A8", "per_month": 12,
     "notes": "Gravado de duas em duas semanas, 6 peças por gravação. Publica à segunda, à quarta e à sexta.",
     "shoots": [
       ["2026-10-07", 6, "2026-10-08", "2026-10-10", "2026-10-12"],
       ["2026-10-21", 6, "2026-10-22", "2026-10-24", "2026-10-26"],
       ["2026-11-04", 6, "2026-11-05", "2026-11-07", "2026-11-09"],
       ["2026-11-18", 6, "2026-11-19", "2026-11-21", "2026-11-23"],
       ["2026-12-02", 6, "2026-12-03", "2026-12-05", "2026-12-07"],
       ["2026-12-16", 6, "2026-12-17", "2026-12-19", "2026-12-21"]
     ],
     "posting": [[[1, 3, 5], "2026-10-12", null]]},

    {"name": "Oluango", "code": "OLU", "color": "#B8700C", "per_month": 12,
     "notes": "Gravado de duas em duas semanas, 6 peças por gravação. Publica à terça, à quinta e ao sábado.",
     "shoots": [
       ["2026-10-09", 6, "2026-10-10", "2026-10-10", "2026-10-12"],
       ["2026-10-23", 6, "2026-10-24", "2026-10-24", "2026-10-26"],
       ["2026-11-06", 6, "2026-11-07", "2026-11-07", "2026-11-09"],
       ["2026-11-20", 6, "2026-11-21", "2026-11-21", "2026-11-23"],
       ["2026-12-04", 6, "2026-12-05", "2026-12-05", "2026-12-07"],
       ["2026-12-18", 6, "2026-12-19", "2026-12-19", "2026-12-21"]
     ],
     "posting": [[[2, 4, 6], "2026-10-12", null]]},

    {"name": "Shazia Saima", "code": "SHZ", "color": "#B8336A", "per_month": 8,
     "notes": "Gravado de quatro em quatro semanas, 8 peças por gravação. Publica à segunda e à quinta.",
     "shoots": [
       ["2026-10-13", 8, "2026-10-14", "2026-10-17", "2026-10-19"],
       ["2026-11-10", 8, "2026-11-11", "2026-11-14", "2026-11-16"],
       ["2026-12-08", 8, "2026-12-09", "2026-12-12", "2026-12-14"]
     ],
     "posting": [[[1, 4], "2026-10-19", null]]},

    {"name": "Sra Tasca", "code": "TAS", "color": "#5E7D1A", "per_month": 8,
     "notes": "Gravado de quatro em quatro semanas, 8 peças por gravação. Publica à terça e à sexta.",
     "shoots": [
       ["2026-10-15", 8, "2026-10-16", "2026-10-17", "2026-10-19"],
       ["2026-11-12", 8, "2026-11-13", "2026-11-14", "2026-11-16"],
       ["2026-12-10", 8, "2026-12-11", "2026-12-12", "2026-12-14"]
     ],
     "posting": [[[2, 5], "2026-10-19", null]]},

    {"name": "Dialis", "code": "DIA", "color": "#8C5A2E", "per_month": 3,
     "notes": "Gravado de quatro em quatro semanas, 3 peças por gravação. Uma publicação por semana, à quarta; a semana da gravação não tem publicação.",
     "shoots": [
       ["2026-10-19", 3, "2026-10-20", "2026-10-20", "2026-10-26"],
       ["2026-11-16", 3, "2026-11-17", "2026-11-17", "2026-11-23"],
       ["2026-12-14", 3, "2026-12-15", "2026-12-15", "2026-12-21"]
     ],
     "posting": [
       [[3], "2026-10-26", "2026-11-11"],
       [[3], "2026-11-23", "2026-12-09"],
       [[3], "2026-12-21", "2027-01-06"]
     ]}
  ]
  $seed$::jsonb;

  c jsonb;
  s jsonb;
  p jsonb;
  cid uuid;
begin
  for c in select value from jsonb_array_elements(seed) loop
    select id into cid
    from public.content_clients
    where lower(name) = lower(c->>'name')
    order by created_at
    limit 1;

    if cid is not null and (
      exists (select 1 from public.content_recordings where client_id = cid)
      or exists (select 1 from public.content_edits where client_id = cid)
      or exists (select 1 from public.content_post_rules where client_id = cid)
    ) then
      raise notice '% already has a schedule, left as it is.', c->>'name';
      continue;
    end if;

    if cid is null then
      insert into public.content_clients (name, code, color, posts_per_month, notes)
      values (c->>'name', c->>'code', c->>'color', (c->>'per_month')::int, c->>'notes')
      returning id into cid;
    end if;

    for s in select value from jsonb_array_elements(c->'shoots') loop
      insert into public.content_recordings (client_id, recorded_on, pieces, plan_on)
      values (cid, (s->>0)::date, (s->>1)::int, (s->>0)::date - 2);

      insert into public.content_edits (client_id, edited_on, pieces, deliver_on, schedule_on)
      values (cid, (s->>2)::date, (s->>1)::int, (s->>3)::date, (s->>4)::date);
    end loop;

    for p in select value from jsonb_array_elements(c->'posting') loop
      insert into public.content_post_rules (client_id, weekdays, starts_on, ends_on)
      values (
        cid,
        array(select value::int from jsonb_array_elements_text(p->0)),
        (p->>1)::date,
        (p->>2)::date
      );
    end loop;
  end loop;
end $$;
