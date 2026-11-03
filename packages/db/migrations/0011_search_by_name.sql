-- package: db
-- Lets a search find people by their name, the start of a name first, as Instagram's search does (3 Nov 2026).

DROP FUNCTION directory_browse(text, int, int);
CREATE FUNCTION directory_browse(p_query text, p_limit int, p_offset int)
RETURNS TABLE (listing_id uuid, display_name text, line text, open_to_romance boolean, is_sample boolean, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH listed AS (
    SELECT l.id, l.card_id, l.line, l.open_to_romance, l.created_at, p.display_name, p.is_sample
    FROM directory_listings l
    JOIN people p ON p.id = l.person_id AND p.state = 'active'
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.person_id IS DISTINCT FROM app_person()
  ), shown AS (
    SELECT ci.card_id,
      jsonb_agg(jsonb_build_object('kind', ci.kind, 'claim', ci.claim, 'quote', ci.quote) ORDER BY ci.position) AS items,
      string_agg(ci.claim || ' ' || ci.quote, ' ') AS words
    FROM card_items ci JOIN listed ON listed.card_id = ci.card_id
    WHERE ci.is_public AND ci.approved AND ci.verified
    GROUP BY ci.card_id
  ), docs AS (
    SELECT listed.*, coalesce(shown.items, '[]'::jsonb) AS items,
      to_tsvector('simple', lower(listed.display_name || ' ' || listed.line || ' ' || coalesce(shown.words, ''))) AS doc,
      -- The search's words, trimmed and lower case, with LIKE's own wildcards escaped, so "ma" finds "Maya" and "50%" finds only itself.
      replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') AS prefix
    FROM listed LEFT JOIN shown ON shown.card_id = listed.card_id
  )
  SELECT docs.id, docs.display_name, docs.line, docs.open_to_romance, docs.is_sample, docs.items
  FROM docs
  WHERE coalesce(p_query, '') = ''
    OR lower(docs.display_name) LIKE docs.prefix || '%' ESCAPE '\'
    OR docs.doc @@ websearch_to_tsquery('simple', lower(p_query))
  ORDER BY CASE WHEN coalesce(p_query, '') <> '' AND lower(docs.display_name) LIKE docs.prefix || '%' ESCAPE '\' THEN 0 ELSE 1 END,
    CASE WHEN coalesce(p_query, '') = '' THEN 0 ELSE ts_rank(docs.doc, websearch_to_tsquery('simple', lower(p_query))) END DESC,
    docs.is_sample, docs.created_at DESC, docs.id
  LIMIT p_limit OFFSET p_offset
$$;
COMMENT ON FUNCTION directory_browse(text, int, int) IS 'One page of the directory for the person in app.person_id, leaving out their own listing: display name, line, the dating switch, the sample mark and public items only, never an id of a person, card, item or turn. With search words, people whose name starts with them come first, then the best matches of their name, line and public items; with none, real people newest first and then sample people.';

-- The grants run while app_migrate still owns the function: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION directory_browse(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directory_browse(text, int, int) TO app_api;
-- A new owner needs CREATE on the function's schema, so app_definer holds it only for the handover, as in 0008 to 0010.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION directory_browse(text, int, int) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
