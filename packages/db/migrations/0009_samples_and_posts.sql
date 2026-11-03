-- package: db
-- Adds sample people, who are marked Sample and accept every friend request at once so Explore works before real people list themselves, and posts, which Explore and profiles show.

ALTER TABLE people ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN people.is_sample IS 'True for the sample people seeded for the demo (pnpm db:seed-samples). The app marks them Sample, and they accept every friend request at once, because no human answers for them. Nobody can sign in as one: their session and recovery code were random and never kept.';

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 600),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE posts IS 'A post on a person''s profile. Explore shows the posts of people listed there. Today only sample people have posts; posts an agent drafts and its person approves come next.';
CREATE INDEX posts_person_created_idx ON posts (person_id, created_at);
CREATE INDEX posts_created_idx ON posts (created_at);
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts FORCE ROW LEVEL SECURITY;
CREATE POLICY posts_own ON posts FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
-- explore_posts and listing_posts read the posts of every listed person, which no person context can see.
CREATE POLICY posts_definer ON posts FOR SELECT TO app_definer USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON posts TO app_api, app_worker;
GRANT SELECT ON posts TO app_definer;

-- directory_browse gains the sample mark, and lists real people before sample people when no search words rank them.
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
      to_tsvector('simple', lower(listed.line || ' ' || coalesce(shown.words, ''))) AS doc
    FROM listed LEFT JOIN shown ON shown.card_id = listed.card_id
  )
  SELECT docs.id, docs.display_name, docs.line, docs.open_to_romance, docs.is_sample, docs.items
  FROM docs
  WHERE coalesce(p_query, '') = '' OR docs.doc @@ websearch_to_tsquery('simple', lower(p_query))
  ORDER BY CASE WHEN coalesce(p_query, '') = '' THEN 0 ELSE ts_rank(docs.doc, websearch_to_tsquery('simple', lower(p_query))) END DESC,
    docs.is_sample, docs.created_at DESC, docs.id
  LIMIT p_limit OFFSET p_offset
$$;
COMMENT ON FUNCTION directory_browse(text, int, int) IS 'One page of the directory for the person in app.person_id, leaving out their own listing: display name, line, the dating switch, the sample mark and public items only, never an id of a person, card, item or turn. Best match first when there are search words, else real people newest first and then sample people.';

-- directory_profile gains the sample mark.
DROP FUNCTION directory_profile(uuid);
CREATE FUNCTION directory_profile(p_listing uuid)
RETURNS TABLE (listing_id uuid, display_name text, line text, open_to_romance boolean, is_sample boolean, items jsonb, friendship text, request_id uuid, pair_id uuid, can_ask boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH target AS (
    SELECT l.id, l.person_id, l.card_id, l.line, l.open_to_romance, p.display_name, p.is_sample
    FROM directory_listings l
    JOIN people p ON p.id = l.person_id AND p.state = 'active'
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.id = p_listing AND app_person() IS NOT NULL
  ), friends_pair AS (
    SELECT pr.id FROM pairs pr, target t
    WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory
      AND ((pr.creator_person_id = app_person() AND pr.joiner_person_id = t.person_id) OR (pr.creator_person_id = t.person_id AND pr.joiner_person_id = app_person()))
    ORDER BY pr.joined_at DESC
    LIMIT 1
  ), waiting AS (
    SELECT r.id, r.from_person_id FROM friend_requests r, target t
    WHERE r.state = 'pending'
      AND ((r.from_person_id = app_person() AND r.to_person_id = t.person_id) OR (r.from_person_id = t.person_id AND r.to_person_id = app_person()))
  ), standing AS (
    SELECT CASE
      WHEN t.person_id = app_person() THEN 'self'
      WHEN EXISTS (SELECT 1 FROM friends_pair) THEN 'friends'
      WHEN EXISTS (SELECT 1 FROM waiting w WHERE w.from_person_id = app_person()) THEN 'requested'
      WHEN EXISTS (SELECT 1 FROM waiting) THEN 'incoming'
      ELSE 'none'
    END AS friendship
    FROM target t
  )
  SELECT t.id, t.display_name, t.line, t.open_to_romance, t.is_sample,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', ci.kind, 'claim', ci.claim, 'quote', ci.quote) ORDER BY ci.position)
      FROM card_items ci WHERE ci.card_id = t.card_id AND ci.is_public AND ci.approved AND ci.verified
    ), '[]'::jsonb),
    s.friendship,
    CASE WHEN s.friendship IN ('requested', 'incoming') THEN (SELECT w.id FROM waiting w LIMIT 1) END,
    CASE WHEN s.friendship = 'friends' THEN (SELECT fp.id FROM friends_pair fp) END,
    s.friendship = 'friends' AND EXISTS (SELECT 1 FROM cards c WHERE c.person_id = t.person_id AND c.state = 'approved' AND c.friends_can_ask)
  FROM target t, standing s
$$;
COMMENT ON FUNCTION directory_profile(uuid) IS 'One listing shown in Explore, as the person in app.person_id sees it: display name, line, the dating switch, the sample mark, public items, and how the caller stands with its person (self, friends with the pair id and the ask switch, requested or incoming with the request id, or none). No row for a listing Explore does not show.';

-- friend_request_send accepts at once when the listing's person is a sample person, because no human will answer for them.
DROP FUNCTION friend_request_send(uuid, int);
CREATE FUNCTION friend_request_send(p_listing uuid, p_cap int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_person();
  other uuid;
  other_is_sample boolean;
  pending_from uuid;
  sent int;
  new_pair uuid;
  new_request uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'friend_request_send needs app.person_id set.';
  END IF;
  SELECT l.person_id, p.is_sample INTO other, other_is_sample
  FROM directory_listings l
  JOIN people p ON p.id = l.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE l.id = p_listing;
  IF other IS NULL THEN
    RAISE EXCEPTION 'listing_not_found: This person is no longer in Explore.' USING ERRCODE = 'check_violation';
  END IF;
  IF other = me THEN
    RAISE EXCEPTION 'friend_request_self: This is your own listing.' USING ERRCODE = 'check_violation';
  END IF;
  -- The caller's row lock makes requests sent at the same moment take turns, so none can pass the daily count.
  PERFORM 1 FROM people WHERE id = me FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM pairs pr
    WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory
      AND ((pr.creator_person_id = me AND pr.joiner_person_id = other) OR (pr.creator_person_id = other AND pr.joiner_person_id = me))
  ) THEN
    RAISE EXCEPTION 'already_friends: You are already friends.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.from_person_id INTO pending_from
  FROM friend_requests r
  WHERE r.state = 'pending' AND ((r.from_person_id = me AND r.to_person_id = other) OR (r.from_person_id = other AND r.to_person_id = me));
  IF pending_from = me THEN
    RAISE EXCEPTION 'friend_request_pending: You already asked this person. They have not answered yet.' USING ERRCODE = 'check_violation';
  END IF;
  IF pending_from = other THEN
    RAISE EXCEPTION 'friend_request_pending: This person already asked to be your friend. Accept their request on your Friends page.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO sent FROM friend_requests r WHERE r.from_person_id = me AND r.created_at >= date_trunc('day', now(), 'UTC');
  IF sent >= p_cap THEN
    RAISE EXCEPTION 'friend_request_daily_cap: You have sent today''s friend requests. Try again tomorrow.' USING ERRCODE = 'check_violation';
  END IF;
  IF other_is_sample THEN
    INSERT INTO pairs (creator_person_id, joiner_person_id, token_hash, expires_at, joined_at, via_directory)
    VALUES (me, other, sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), now(), now(), false)
    RETURNING id INTO new_pair;
    INSERT INTO friend_requests (from_person_id, to_person_id, state, pair_id, decided_at) VALUES (me, other, 'accepted', new_pair, now()) RETURNING id INTO new_request;
    RETURN new_request;
  END IF;
  BEGIN
    INSERT INTO friend_requests (from_person_id, to_person_id) VALUES (me, other) RETURNING id INTO new_request;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'friend_request_pending: A request between you two is already waiting for an answer.' USING ERRCODE = 'check_violation';
  END;
  RETURN new_request;
END
$$;
COMMENT ON FUNCTION friend_request_send(uuid, int) IS 'Sends a friend request from the person in app.person_id to the person behind a listing shown in Explore; a sample person accepts it at once, with a joined pair as an invite makes. Refuses your own listing, someone you are already friends with, a request already waiting either way, and more than p_cap requests a UTC day.';

CREATE FUNCTION explore_posts(p_limit int)
RETURNS TABLE (post_id uuid, listing_id uuid, display_name text, is_sample boolean, text text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, l.id, p.display_name, p.is_sample, po.text, po.created_at
  FROM posts po
  JOIN directory_listings l ON l.person_id = po.person_id
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE app_person() IS NOT NULL AND po.person_id <> app_person()
  ORDER BY po.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION explore_posts(int) IS 'The newest posts of people listed in Explore, leaving out the caller''s own: the post, the author''s listing, display name and sample mark, never a person id. No rows without a person in app.person_id.';

CREATE FUNCTION listing_posts(p_listing uuid, p_limit int)
RETURNS TABLE (post_id uuid, listing_id uuid, display_name text, is_sample boolean, text text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, l.id, p.display_name, p.is_sample, po.text, po.created_at
  FROM directory_listings l
  JOIN people p ON p.id = l.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  JOIN posts po ON po.person_id = l.person_id
  WHERE l.id = p_listing AND app_person() IS NOT NULL
  ORDER BY po.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION listing_posts(uuid, int) IS 'The newest posts of the person behind one listing Explore shows, for that profile''s Posts tab. No rows without a person in app.person_id, and none for a listing Explore does not show.';

CREATE FUNCTION sample_people_listed()
RETURNS TABLE (display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.display_name
  FROM people p
  JOIN directory_listings l ON l.person_id = p.id
  WHERE p.is_sample AND p.state = 'active'
  ORDER BY p.display_name
$$;
COMMENT ON FUNCTION sample_people_listed() IS 'The display names of the sample people listed in Explore, so pnpm db:seed-samples adds only the ones missing. Sample people only, and no ids.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION directory_browse(text, int, int), directory_profile(uuid), friend_request_send(uuid, int), explore_posts(int), listing_posts(uuid, int), sample_people_listed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directory_browse(text, int, int), directory_profile(uuid), friend_request_send(uuid, int), explore_posts(int), listing_posts(uuid, int), sample_people_listed() TO app_api;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0001, 0003, 0006, 0007 and 0008.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION directory_browse(text, int, int) OWNER TO app_definer;
ALTER FUNCTION directory_profile(uuid) OWNER TO app_definer;
ALTER FUNCTION friend_request_send(uuid, int) OWNER TO app_definer;
ALTER FUNCTION explore_posts(int) OWNER TO app_definer;
ALTER FUNCTION listing_posts(uuid, int) OWNER TO app_definer;
ALTER FUNCTION sample_people_listed() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
