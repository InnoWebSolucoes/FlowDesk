-- ============================================================================
-- The seeded clients' notes, in Portuguese.
--
-- 20261017000001 wrote each client's notes in English. The content calendar
-- is in Portuguese now, and a note is shown as written, so the seven notes
-- are swapped for their translation.
--
-- Only a note still exactly as the seed wrote it is changed. One edited
-- since is someone's own words and is left alone, and running this twice, or
-- before the seed, changes nothing.
-- ============================================================================

update public.content_clients as c
set notes = t.pt
from (values
    ('Shot every four weeks together with Okulya, 8 pieces a shoot. Posts Wednesday and Saturday.',
     'Gravado de quatro em quatro semanas, no mesmo dia que Okulya, 8 peças por gravação. Publica à quarta e ao sábado.'),
    ('Shot every four weeks together with Espaço Luanda, 8 pieces a shoot. Posts Monday and Thursday.',
     'Gravado de quatro em quatro semanas, no mesmo dia que o Espaço Luanda, 8 peças por gravação. Publica à segunda e à quinta.'),
    ('Shot every two weeks, 6 pieces a shoot. Posts Monday, Wednesday and Friday.',
     'Gravado de duas em duas semanas, 6 peças por gravação. Publica à segunda, à quarta e à sexta.'),
    ('Shot every two weeks, 6 pieces a shoot. Posts Tuesday, Thursday and Saturday.',
     'Gravado de duas em duas semanas, 6 peças por gravação. Publica à terça, à quinta e ao sábado.'),
    ('Shot every four weeks, 8 pieces a shoot. Posts Monday and Thursday.',
     'Gravado de quatro em quatro semanas, 8 peças por gravação. Publica à segunda e à quinta.'),
    ('Shot every four weeks, 8 pieces a shoot. Posts Tuesday and Friday.',
     'Gravado de quatro em quatro semanas, 8 peças por gravação. Publica à terça e à sexta.'),
    ('Shot every four weeks, 3 pieces a shoot. One post a week on Wednesdays; the week it is shot has none.',
     'Gravado de quatro em quatro semanas, 3 peças por gravação. Uma publicação por semana, à quarta; a semana da gravação não tem publicação.')
) as t(en, pt)
where c.notes = t.en;
