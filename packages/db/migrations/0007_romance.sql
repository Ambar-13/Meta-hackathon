-- package: db
-- Adds romance as a question kind with its own consent switch in the directory, and lets curated question ids run to 20.

ALTER TABLE meetings DROP CONSTRAINT meetings_question_kind_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_question_kind_check
  CHECK (question_kind IN ('get_along', 'help', 'situation', 'decision', 'deal', 'debate', 'romance'));
ALTER TABLE meetings DROP CONSTRAINT meetings_question_id_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_question_id_check CHECK (question_id BETWEEN 1 AND 20);
COMMENT ON COLUMN meetings.question_kind IS 'What the question asks the personas to play out: get_along (including whether they would clash), help, situation, decision, deal, debate or romance. A curated question sets it at insert, a free-text one from the question check; situation until then.';

ALTER TABLE meetings ADD COLUMN romance_allowed boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN meetings.romance_allowed IS 'False for a directory meeting whose listed person has not switched on dating questions; the question check then refuses a romance question. Invite meetings keep true: both people said yes to each other.';

ALTER TABLE directory_listings ADD COLUMN open_to_romance boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN directory_listings.open_to_romance IS 'The dating switch: people in the directory may ask how this persona would get on with them romantically. Off by default.';

ALTER TABLE persona_asks ADD COLUMN question_kind text
  CHECK (question_kind IN ('get_along', 'help', 'situation', 'decision', 'deal', 'debate', 'romance'));
COMMENT ON COLUMN persona_asks.question_kind IS 'The kind the question check gave; null until checked. A help search of kind romance asks only listings open to dating questions.';

DROP FUNCTION directory_browse(text, int, int);
CREATE FUNCTION directory_browse(p_query text, p_limit int, p_offset int)
RETURNS TABLE (listing_id uuid, display_name text, line text, open_to_romance boolean, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH listed AS (
    SELECT l.id, l.card_id, l.line, l.open_to_romance, l.created_at, p.display_name
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
      to_tsvector('simple', lower(listed.line || ' ' || coalesce(shown.words, ''))) AS doc
    FROM listed LEFT JOIN shown ON shown.card_id = listed.card_id
  )
  SELECT docs.id, docs.display_name, docs.line, docs.open_to_romance, docs.items
  FROM docs
  WHERE coalesce(p_query, '') = '' OR docs.doc @@ websearch_to_tsquery('simple', lower(p_query))
  ORDER BY CASE WHEN coalesce(p_query, '') = '' THEN 0 ELSE ts_rank(docs.doc, websearch_to_tsquery('simple', lower(p_query))) END DESC,
    docs.created_at DESC, docs.id
  LIMIT p_limit OFFSET p_offset
$$;
COMMENT ON FUNCTION directory_browse(text, int, int) IS 'One page of the directory for the person in app.person_id, leaving out their own listing: display name, line, the dating switch and public items only, never an id of a person, card, item or turn. Best match first when there are search words, else newest first.';

DROP FUNCTION directory_shortlist(text[], uuid, int);
CREATE FUNCTION directory_shortlist(p_words text[], p_exclude uuid, p_limit int, p_romance_only boolean)
RETURNS TABLE (listing_id uuid, person_id uuid, card_id uuid, display_name text, line text, match_rank int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH listed AS (
    SELECT l.id, l.person_id, l.card_id, l.line, l.created_at, p.display_name
    FROM directory_listings l
    JOIN people p ON p.id = l.person_id AND p.state = 'active'
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.person_id <> p_exclude AND (NOT p_romance_only OR l.open_to_romance)
  ), docs AS (
    SELECT listed.id, listed.person_id, listed.card_id, listed.line, listed.created_at, listed.display_name,
      lower(listed.line || ' ' || coalesce(string_agg(ci.claim || ' ' || ci.quote, ' '), '')) AS doc
    FROM listed
    LEFT JOIN card_items ci ON ci.card_id = listed.card_id AND ci.is_public AND ci.approved AND ci.verified
    GROUP BY listed.id, listed.person_id, listed.card_id, listed.line, listed.created_at, listed.display_name
  ), scored AS (
    SELECT docs.*,
      ts_rank(to_tsvector('simple', docs.doc), to_tsquery('simple', array_to_string(p_words, ' | '))) AS fts,
      word_similarity(array_to_string(p_words, ' '), docs.doc) AS sim
    FROM docs
    WHERE cardinality(p_words) > 0
  )
  SELECT scored.id, scored.person_id, scored.card_id, scored.display_name, scored.line,
    (row_number() OVER (ORDER BY greatest(scored.fts, scored.sim) DESC, scored.created_at DESC, scored.id))::int
  FROM scored
  WHERE scored.fts > 0 OR scored.sim >= 0.3
  ORDER BY 6
  LIMIT p_limit
$$;
COMMENT ON FUNCTION directory_shortlist(text[], uuid, int, boolean) IS 'Stage 1 of a help search: the listed personas whose line and public items best match the words (lower-case letters and digits only, as queryWords makes them), leaving out the asker, and only listings open to dating questions when p_romance_only. Full-text match first, word similarity of 0.3 or more as the fallback.';

DROP FUNCTION directory_meeting_create(uuid, uuid, uuid, int, text, boolean, int);
CREATE FUNCTION directory_meeting_create(p_listing uuid, me uuid, my_card uuid, p_question_id int, p_question_text text, is_checked boolean, p_kind text, p_cap int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other uuid;
  other_card uuid;
  is_open boolean;
  used int;
  new_pair uuid;
  new_meeting uuid;
BEGIN
  SELECT l.person_id, l.card_id, l.open_to_romance INTO other, other_card, is_open
  FROM directory_listings l
  JOIN people p ON p.id = l.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE l.id = p_listing
  FOR UPDATE OF l;
  IF other IS NULL THEN
    RAISE EXCEPTION 'listing_not_found: this persona is no longer in the directory.' USING ERRCODE = 'check_violation';
  END IF;
  IF other = me THEN
    RAISE EXCEPTION 'directory_self: this is your own listing; pick someone else in the directory.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind = 'romance' AND NOT is_open THEN
    RAISE EXCEPTION 'romance_not_open: this person has not opened their persona to dating questions.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cards WHERE id = my_card AND person_id = me AND state = 'approved') THEN
    RAISE EXCEPTION 'card_not_approved: approve your card before creating a meeting.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO used
  FROM meeting_members mm JOIN meetings m ON m.id = mm.meeting_id
  WHERE mm.person_id = other AND mm.public_only AND m.created_at >= date_trunc('day', now(), 'UTC');
  IF used >= p_cap THEN
    RAISE EXCEPTION 'directory_daily_cap: this persona has met as many people as it can today. Try again tomorrow.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO pairs (creator_person_id, joiner_person_id, token_hash, expires_at, joined_at, via_directory)
  VALUES (me, other, sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), now(), now(), true)
  RETURNING id INTO new_pair;
  INSERT INTO meetings (pair_id, question_id, question_text, question_checked_at, question_kind, romance_allowed)
  VALUES (new_pair, p_question_id, p_question_text, CASE WHEN is_checked THEN now() ELSE NULL END, coalesce(p_kind, 'situation'), is_open)
  RETURNING id INTO new_meeting;
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id, ready_at) VALUES (new_meeting, me, 'a', my_card, now());
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id, ready_at, public_only) VALUES (new_meeting, other, 'b', other_card, now(), true);
  RETURN new_meeting;
END
$$;
COMMENT ON FUNCTION directory_meeting_create(uuid, uuid, uuid, int, text, boolean, text, int) IS 'Starts a meeting with a listed persona: its own pair (via_directory), the caller as side a and the listed person as side b, both with their go-ahead given, the question''s kind set (situation when null), and the listing''s dating switch copied to romance_allowed. Refuses a romance question when the switch is off, and more than p_cap meetings a day per listed person.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION directory_browse(text, int, int), directory_shortlist(text[], uuid, int, boolean),
  directory_meeting_create(uuid, uuid, uuid, int, text, boolean, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directory_browse(text, int, int), directory_meeting_create(uuid, uuid, uuid, int, text, boolean, text, int) TO app_api;
GRANT EXECUTE ON FUNCTION directory_shortlist(text[], uuid, int, boolean) TO app_worker;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0001, 0003 and 0006.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION directory_browse(text, int, int) OWNER TO app_definer;
ALTER FUNCTION directory_shortlist(text[], uuid, int, boolean) OWNER TO app_definer;
ALTER FUNCTION directory_meeting_create(uuid, uuid, uuid, int, text, boolean, text, int) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
