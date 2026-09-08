-- Esmael's user id, so his colour can be keyed by id like everyone else's.
--
-- He is currently matched on first name, which is the weaker key: renaming
-- him drops him back to the fallback colour, and anyone else called Esmael
-- would take it. The other three are keyed by id already.

select id, name, email
from public.users
where email = 'esmaelinnoweb@gmail.com';
