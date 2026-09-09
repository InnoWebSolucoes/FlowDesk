-- ============================================================================
-- Websites whose name and address were entered the wrong way round.
--
-- The add form was three unlabelled boxes, so the address went into the name:
--
--   name = 'https://drive.google.com'   url = 'https://cfghj'
--
-- which is why the list shows a URL as the title and the favicon is blank —
-- it is asking for the favicon of "cfghj", which is not a hostname.
--
-- Section 1 shows what is wrong before anything changes. Section 2 swaps the
-- rows where the name looks like an address and the url does not.
-- ============================================================================


-- ─── 1. What looks wrong ────────────────────────────────────────────────────
-- name_looks_like_url and url_looks_like_url tell you which way round each
-- row is. A row with the first true and the second false is swapped.

select
  id,
  name,
  url,
  (name ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}')     as name_looks_like_url,
  (url  ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}')     as url_looks_like_url
from public.websites
order by name;


-- ─── 2. Swap the ones that are the wrong way round ──────────────────────────
-- Only where the name is a real address and the url is not, so a correctly
-- entered row is never touched. A dotted hostname is the test: 'cfghj' has no
-- dot and no suffix, 'drive.google.com' has both.

update public.websites
set name = url,
    url  = name
where name ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}'
  and not (url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}');


-- ─── 3. Tidy the names ──────────────────────────────────────────────────────
-- After the swap the name is whatever was typed as the address — 'https://
-- cfghj' and the like. Where a name is still URL-shaped, reduce it to
-- something readable rather than leaving a broken address as the title.

update public.websites
set name = initcap(
  regexp_replace(
    regexp_replace(name, '^https?://(www\.)?', '', 'i'),  -- drop scheme and www
    '[/?#].*$', ''                                        -- drop path and query
  )
)
where name ~* '^https?://';


-- ─── 4. Confirm ─────────────────────────────────────────────────────────────
-- Every url should start with http, and no name should. Fix any that are
-- still wrong by hand — a row where both fields were nonsense cannot be
-- worked out from here.

select
  name,
  url,
  (url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}') as url_is_a_real_address
from public.websites
order by name;
