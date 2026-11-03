-- package: db
-- Adds the open directory, friend asks and help searches: public card items, a listing per person, the friends switch, directory meetings, and asks answered by personas.

-- What a person shows strangers: only items they mark public, and only approved, verified ones.
ALTER TABLE card_items ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE card_items ADD CONSTRAINT card_items_public_needs_approval CHECK (NOT is_public OR (approved AND verified));
COMMENT ON COLUMN card_items.is_public IS 'Marked by the owner on the card screen: the directory shows this item, and directory meetings and help answers may use it.';

ALTER TABLE cards ADD COLUMN friends_can_ask boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN cards.friends_can_ask IS 'The switch letting people the owner paired with by invite ask this persona how the owner would probably react. Off by default.';

ALTER TABLE pairs ADD COLUMN via_directory boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN pairs.via_directory IS 'True for the pair directory_meeting_create makes for a meeting with a listed persona; such a pair never makes two people friends.';

ALTER TABLE meeting_members ADD COLUMN public_only boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN meeting_members.public_only IS 'True for a listed persona met through the directory: its prompt prefix holds only the items its owner marked public.';

CREATE TABLE directory_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL UNIQUE REFERENCES people (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  line text NOT NULL CHECK (char_length(line) BETWEEN 1 AND 140),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE directory_listings IS 'One row per person who opted their persona into the open directory. The row is the consent to be met; deleting it leaves the directory at once.';
COMMENT ON COLUMN directory_listings.line IS 'One line the person writes about themselves, shown with their display name and public items.';
CREATE INDEX directory_listings_created_idx ON directory_listings (created_at);
ALTER TABLE directory_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE directory_listings FORCE ROW LEVEL SECURITY;

CREATE TABLE persona_asks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('help', 'react')),
  pair_id uuid REFERENCES pairs (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 5 AND 300),
  state text NOT NULL DEFAULT 'checking' CHECK (state IN ('checking', 'asking', 'ranking', 'done', 'refused', 'failed')),
  refused_reason text,
  about_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK ((mode = 'react') = (pair_id IS NOT NULL)),
  CHECK ((state = 'refused') = (refused_reason IS NOT NULL))
);
COMMENT ON TABLE persona_asks IS 'One question a person sent to personas: help sends a stuck problem to up to 20 listed personas, react asks one friend''s persona how the friend would probably react.';
COMMENT ON COLUMN persona_asks.person_id IS 'The person who asked.';
COMMENT ON COLUMN persona_asks.pair_id IS 'For a react ask, the invite pair that makes the asker and the friend friends; null for help.';
COMMENT ON COLUMN persona_asks.about_name IS 'For a react ask, the friend''s display name when the ask was sent.';
CREATE INDEX persona_asks_person_created_idx ON persona_asks (person_id, created_at);
ALTER TABLE persona_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_asks FORCE ROW LEVEL SECURITY;

CREATE TABLE persona_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id uuid NOT NULL REFERENCES persona_asks (id) ON DELETE CASCADE,
  asker_person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  subject_person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  subject_card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  listing_id uuid REFERENCES directory_listings (id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('help', 'react')),
  ask_text text NOT NULL,
  asker_display_name text NOT NULL,
  subject_display_name text NOT NULL,
  subject_line text,
  shortlist_rank int NOT NULL CHECK (shortlist_rank >= 1),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'answered', 'failed')),
  answer text,
  has_sign boolean,
  claims jsonb NOT NULL DEFAULT '[]',
  supported_count int,
  position int CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  CHECK (asker_person_id <> subject_person_id),
  CHECK ((state = 'answered') = (answer IS NOT NULL AND has_sign IS NOT NULL)),
  UNIQUE (ask_id, subject_person_id)
);
COMMENT ON TABLE persona_answers IS 'One persona''s answer to one ask. The asker reads it in their results; the person the persona speaks for reads it as their copy.';
COMMENT ON COLUMN persona_answers.listing_id IS 'The listing a help answer came from; null for a react ask, and set null when the person leaves the directory, which ends meeting them from this answer.';
COMMENT ON COLUMN persona_answers.ask_text IS 'The ask''s text, copied so the subject''s copy shows what was asked.';
COMMENT ON COLUMN persona_answers.shortlist_rank IS 'The place the help shortlist gave this persona (1 for a react ask); the tie-break of the results.';
COMMENT ON COLUMN persona_answers.claims IS 'Up to 3 claims [{text, quote, turnId, verified, supported}], each quote checked inside its named turn of the subject''s notes.';
COMMENT ON COLUMN persona_answers.supported_count IS 'Claims whose quote was found and that the support check backed; the results are ordered by it, and it is never shown as a number.';
COMMENT ON COLUMN persona_answers.position IS 'The answer''s place in the help results, null while unranked and for an answer that showed no sign.';
CREATE INDEX persona_answers_ask_idx ON persona_answers (ask_id);
CREATE INDEX persona_answers_subject_created_idx ON persona_answers (subject_person_id, created_at);
ALTER TABLE persona_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_answers FORCE ROW LEVEL SECURITY;

CREATE POLICY directory_listings_own ON directory_listings FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY directory_listings_definer ON directory_listings FOR ALL TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY persona_asks_own ON persona_asks FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY persona_answers_asker ON persona_answers FOR ALL TO app_api, app_worker
  USING (asker_person_id = app_person()) WITH CHECK (asker_person_id = app_person());
CREATE POLICY persona_answers_subject_read ON persona_answers FOR SELECT TO app_api, app_worker
  USING (subject_person_id = app_person());
-- The directory functions read public items of every listed card, which no person context can see.
CREATE POLICY card_items_definer ON card_items FOR SELECT TO app_definer USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON directory_listings, persona_asks, persona_answers TO app_api, app_worker;
-- The API reads meeting members column by column (0001); a listed person's meeting list needs the new flag.
GRANT SELECT (public_only) ON meeting_members TO app_api;
GRANT SELECT, UPDATE ON directory_listings TO app_definer;

-- The ledger takes the two new call sites.
ALTER TABLE ledger DROP CONSTRAINT ledger_call_site_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_call_site_check CHECK (call_site IN ('scrub_names','question_check','card','quiz_answer','quiz_judge','speech','receipts','brief','brief_support_judge','comic_panels','comic_image','self_test','persona_answer','ask_support_judge'));

CREATE FUNCTION directory_browse(p_query text, p_limit int, p_offset int)
RETURNS TABLE (listing_id uuid, display_name text, line text, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH listed AS (
    SELECT l.id, l.card_id, l.line, l.created_at, p.display_name
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
  SELECT docs.id, docs.display_name, docs.line, docs.items
  FROM docs
  WHERE coalesce(p_query, '') = '' OR docs.doc @@ websearch_to_tsquery('simple', lower(p_query))
  ORDER BY CASE WHEN coalesce(p_query, '') = '' THEN 0 ELSE ts_rank(docs.doc, websearch_to_tsquery('simple', lower(p_query))) END DESC,
    docs.created_at DESC, docs.id
  LIMIT p_limit OFFSET p_offset
$$;
COMMENT ON FUNCTION directory_browse(text, int, int) IS 'One page of the directory for the person in app.person_id, leaving out their own listing: display name, line and public items only, never an id of a person, card, item or turn. Best match first when there are search words, else newest first.';

CREATE FUNCTION directory_shortlist(p_words text[], p_exclude uuid, p_limit int)
RETURNS TABLE (listing_id uuid, person_id uuid, card_id uuid, display_name text, line text, match_rank int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH listed AS (
    SELECT l.id, l.person_id, l.card_id, l.line, l.created_at, p.display_name
    FROM directory_listings l
    JOIN people p ON p.id = l.person_id AND p.state = 'active'
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.person_id <> p_exclude
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
COMMENT ON FUNCTION directory_shortlist(text[], uuid, int) IS 'Stage 1 of a help search: the listed personas whose line and public items best match the words (lower-case letters and digits only, as queryWords makes them), leaving out the asker. Full-text match first, word similarity of 0.3 or more as the fallback.';

CREATE FUNCTION directory_meeting_create(p_listing uuid, me uuid, my_card uuid, p_question_id int, p_question_text text, is_checked boolean, p_cap int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other uuid;
  other_card uuid;
  used int;
  new_pair uuid;
  new_meeting uuid;
BEGIN
  SELECT l.person_id, l.card_id INTO other, other_card
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
  INSERT INTO meetings (pair_id, question_id, question_text, question_checked_at)
  VALUES (new_pair, p_question_id, p_question_text, CASE WHEN is_checked THEN now() ELSE NULL END)
  RETURNING id INTO new_meeting;
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id, ready_at) VALUES (new_meeting, me, 'a', my_card, now());
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id, ready_at, public_only) VALUES (new_meeting, other, 'b', other_card, now(), true);
  RETURN new_meeting;
END
$$;
COMMENT ON FUNCTION directory_meeting_create(uuid, uuid, uuid, int, text, boolean, int) IS 'Starts a meeting with a listed persona: its own pair (via_directory), the caller as side a and the listed person as side b, both with their go-ahead given, because asking is the caller''s go-ahead and the listing is the other''s. At most p_cap a day per listed person.';

CREATE FUNCTION friend_list()
RETURNS TABLE (pair_id uuid, display_name text, can_ask boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.pair_id, f.display_name, f.can_ask
  FROM (
    SELECT DISTINCT ON (o.other) o.id AS pair_id, p.display_name, o.joined_at,
      EXISTS (SELECT 1 FROM cards c WHERE c.person_id = o.other AND c.state = 'approved' AND c.friends_can_ask) AS can_ask
    FROM (
      SELECT pr.id, pr.joined_at, CASE WHEN pr.creator_person_id = app_person() THEN pr.joiner_person_id ELSE pr.creator_person_id END AS other
      FROM pairs pr
      WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory AND app_person() IN (pr.creator_person_id, pr.joiner_person_id)
    ) o
    JOIN people p ON p.id = o.other AND p.state = 'active'
    ORDER BY o.other, o.joined_at DESC
  ) f
  ORDER BY f.joined_at DESC
$$;
COMMENT ON FUNCTION friend_list() IS 'The friends of the person in app.person_id: everyone they joined an invite pair with, once each by their latest pair, with whether that friend lets friends ask their persona. Directory pairs never count.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION directory_browse(text, int, int), directory_shortlist(text[], uuid, int),
  directory_meeting_create(uuid, uuid, uuid, int, text, boolean, int), friend_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directory_browse(text, int, int), directory_meeting_create(uuid, uuid, uuid, int, text, boolean, int), friend_list() TO app_api;
GRANT EXECUTE ON FUNCTION directory_shortlist(text[], uuid, int) TO app_worker;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0001 and 0003.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION directory_browse(text, int, int) OWNER TO app_definer;
ALTER FUNCTION directory_shortlist(text[], uuid, int) OWNER TO app_definer;
ALTER FUNCTION directory_meeting_create(uuid, uuid, uuid, int, text, boolean, int) OWNER TO app_definer;
ALTER FUNCTION friend_list() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
