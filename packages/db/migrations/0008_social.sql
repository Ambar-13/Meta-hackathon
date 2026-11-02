-- package: db
-- Adds friend requests, which become invite-style friendships when accepted, and the orchestrator chat, one thread per person whose replies plan one ask each (wave 7).

-- The ledger takes the orchestrator's call site.
ALTER TABLE ledger DROP CONSTRAINT ledger_call_site_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_call_site_check CHECK (call_site IN ('scrub_names','question_check','card','quiz_answer','quiz_judge','speech','receipts','brief','brief_support_judge','comic_panels','comic_image','self_test','persona_answer','ask_support_judge','orchestrator'));

CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  to_person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'declined')),
  pair_id uuid REFERENCES pairs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (from_person_id <> to_person_id),
  CHECK ((state = 'pending') = (decided_at IS NULL))
);
COMMENT ON TABLE friend_requests IS 'A request from one person to a person listed in Explore. Accepting makes one joined pair with via_directory false, so the two are friends exactly as an invite link makes them.';
COMMENT ON COLUMN friend_requests.pair_id IS 'The pair accepting made, or the pair the two already had; null while pending, after a decline, and once the pair is gone.';
-- At most one pending request between two people, whichever of them sent it.
CREATE UNIQUE INDEX friend_requests_one_pending ON friend_requests (LEAST(from_person_id, to_person_id), GREATEST(from_person_id, to_person_id)) WHERE state = 'pending';
CREATE INDEX friend_requests_from_created_idx ON friend_requests (from_person_id, created_at);
CREATE INDEX friend_requests_to_pending_idx ON friend_requests (to_person_id) WHERE state = 'pending';
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests FORCE ROW LEVEL SECURITY;

CREATE TABLE orchestrator_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('you', 'agent')),
  text text NOT NULL CHECK (char_length(text) <= 2000),
  state text NOT NULL DEFAULT 'done' CHECK (state IN ('thinking', 'planned', 'running', 'done', 'failed')),
  action text CHECK (action IN ('help', 'react', 'reply')),
  action_question text CHECK (char_length(action_question) BETWEEN 5 AND 300),
  action_friend_name text,
  action_pair_id uuid REFERENCES pairs (id) ON DELETE SET NULL,
  ask_id uuid REFERENCES persona_asks (id) ON DELETE SET NULL,
  friends_snapshot jsonb NOT NULL DEFAULT '[]',
  reply_to uuid REFERENCES orchestrator_messages (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'agent') = (reply_to IS NOT NULL)),
  CHECK (role = 'agent' OR (state = 'done' AND action IS NULL)),
  CHECK (state <> 'planned' OR (action IN ('help', 'react') AND action_question IS NOT NULL))
);
COMMENT ON TABLE orchestrator_messages IS 'The orchestrator chat: each person has one thread of their own messages (you) and the replies (agent). A reply plans one action; help and react replies start an ask when the person runs them.';
COMMENT ON COLUMN orchestrator_messages.state IS 'Your messages are done. A reply is thinking until the orchestrate job plans it, then planned (an ask is ready to run), running (the ask is out), done (only words, or the ask was refused) or failed (the model call failed).';
COMMENT ON COLUMN orchestrator_messages.action_pair_id IS 'For a react reply, the pair of the friend the plan matched in friends_snapshot; the run step asks through it.';
COMMENT ON COLUMN orchestrator_messages.friends_snapshot IS 'The friend list when the message was sent, [{pairId, displayName, canAsk}], so the plan is checked against the friends the person had then.';
COMMENT ON COLUMN orchestrator_messages.reply_to IS 'For a reply, the message it answers; null for the person''s own messages.';
CREATE INDEX orchestrator_messages_person_created_idx ON orchestrator_messages (person_id, created_at);
ALTER TABLE orchestrator_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestrator_messages FORCE ROW LEVEL SECURITY;

-- Both people of a request may read it; only the definer functions below write it.
CREATE POLICY friend_requests_member_read ON friend_requests FOR SELECT TO app_api, app_worker
  USING (app_person() IN (from_person_id, to_person_id));
CREATE POLICY friend_requests_definer ON friend_requests FOR ALL TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY orchestrator_messages_own ON orchestrator_messages FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());

GRANT SELECT ON friend_requests TO app_api, app_worker;
GRANT SELECT, INSERT, UPDATE ON friend_requests TO app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchestrator_messages TO app_api;
GRANT SELECT, UPDATE ON orchestrator_messages TO app_worker;

CREATE FUNCTION friend_request_send(p_listing uuid, p_cap int)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_person();
  other uuid;
  pending_from uuid;
  sent int;
  new_request uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'friend_request_send needs app.person_id set.';
  END IF;
  SELECT l.person_id INTO other
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
  BEGIN
    INSERT INTO friend_requests (from_person_id, to_person_id) VALUES (me, other) RETURNING id INTO new_request;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'friend_request_pending: A request between you two is already waiting for an answer.' USING ERRCODE = 'check_violation';
  END;
  RETURN new_request;
END
$$;
COMMENT ON FUNCTION friend_request_send(uuid, int) IS 'Sends a friend request from the person in app.person_id to the person behind a listing shown in Explore. Refuses your own listing, someone you are already friends with, a request already waiting either way, and more than p_cap requests a UTC day.';

CREATE FUNCTION friend_request_accept(p_request uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_person();
  sender uuid;
  request_state text;
  friends_pair uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'friend_request_accept needs app.person_id set.';
  END IF;
  SELECT r.from_person_id, r.state INTO sender, request_state
  FROM friend_requests r
  JOIN people p ON p.id = r.from_person_id AND p.state = 'active'
  WHERE r.id = p_request AND r.to_person_id = me
  FOR UPDATE OF r;
  IF sender IS NULL THEN
    RAISE EXCEPTION 'friend_request_not_found: This request is gone or was not sent to you.' USING ERRCODE = 'check_violation';
  END IF;
  IF request_state <> 'pending' THEN
    RAISE EXCEPTION 'friend_request_decided: This request was already answered.' USING ERRCODE = 'check_violation';
  END IF;
  -- An invite link may have made the two friends while the request waited; then accepting keeps that pair.
  SELECT pr.id INTO friends_pair
  FROM pairs pr
  WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory
    AND ((pr.creator_person_id = me AND pr.joiner_person_id = sender) OR (pr.creator_person_id = sender AND pr.joiner_person_id = me))
  ORDER BY pr.joined_at DESC
  LIMIT 1;
  IF friends_pair IS NULL THEN
    INSERT INTO pairs (creator_person_id, joiner_person_id, token_hash, expires_at, joined_at, via_directory)
    VALUES (sender, me, sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), now(), now(), false)
    RETURNING id INTO friends_pair;
  END IF;
  UPDATE friend_requests SET state = 'accepted', decided_at = now(), pair_id = friends_pair WHERE id = p_request;
  RETURN friends_pair;
END
$$;
COMMENT ON FUNCTION friend_request_accept(uuid) IS 'Accepts a pending request sent to the person in app.person_id: one joined pair, the sender as creator and the caller as joiner, via_directory false, whose token is never shown to anyone. Returns the pair id.';

CREATE FUNCTION friend_request_decline(p_request uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  me uuid := app_person();
  request_state text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'friend_request_decline needs app.person_id set.';
  END IF;
  SELECT r.state INTO request_state FROM friend_requests r WHERE r.id = p_request AND r.to_person_id = me FOR UPDATE;
  IF request_state IS NULL THEN
    RAISE EXCEPTION 'friend_request_not_found: This request is gone or was not sent to you.' USING ERRCODE = 'check_violation';
  END IF;
  IF request_state <> 'pending' THEN
    RAISE EXCEPTION 'friend_request_decided: This request was already answered.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE friend_requests SET state = 'declined', decided_at = now() WHERE id = p_request;
END
$$;
COMMENT ON FUNCTION friend_request_decline(uuid) IS 'Declines a pending request sent to the person in app.person_id. The sender sees the request disappear; asking again counts against their daily cap, as on Instagram.';

CREATE FUNCTION friend_requests_mine()
RETURNS TABLE (request_id uuid, direction text, other_display_name text, other_listing_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id,
    CASE WHEN r.to_person_id = app_person() THEN 'incoming' ELSE 'outgoing' END,
    p.display_name, shown.id, r.created_at
  FROM friend_requests r
  JOIN people p ON p.id = CASE WHEN r.to_person_id = app_person() THEN r.from_person_id ELSE r.to_person_id END AND p.state = 'active'
  LEFT JOIN LATERAL (
    SELECT l.id FROM directory_listings l
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.person_id = p.id
  ) shown ON true
  WHERE r.state = 'pending' AND app_person() IN (r.from_person_id, r.to_person_id)
  ORDER BY r.created_at DESC, r.id
$$;
COMMENT ON FUNCTION friend_requests_mine() IS 'The pending requests of the person in app.person_id, received and sent, newest first: the other person''s display name and their listing when Explore shows it, never their person id.';

CREATE FUNCTION directory_profile(p_listing uuid)
RETURNS TABLE (listing_id uuid, display_name text, line text, open_to_romance boolean, items jsonb, friendship text, request_id uuid, pair_id uuid, can_ask boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH target AS (
    SELECT l.id, l.person_id, l.card_id, l.line, l.open_to_romance, p.display_name
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
  SELECT t.id, t.display_name, t.line, t.open_to_romance,
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
COMMENT ON FUNCTION directory_profile(uuid) IS 'One listing shown in Explore, as the person in app.person_id sees it: display name, line, the dating switch, public items, and how the caller stands with its person (self, friends with the pair id and the ask switch, requested or incoming with the request id, or none). No row for a listing Explore does not show.';

-- friend_list gains each friend's listing, so a friend links to their profile when Explore shows them.
DROP FUNCTION friend_list();
CREATE FUNCTION friend_list()
RETURNS TABLE (pair_id uuid, display_name text, can_ask boolean, listing_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.pair_id, f.display_name, f.can_ask, shown.id
  FROM (
    SELECT DISTINCT ON (o.other) o.id AS pair_id, o.other, p.display_name, o.joined_at,
      EXISTS (SELECT 1 FROM cards c WHERE c.person_id = o.other AND c.state = 'approved' AND c.friends_can_ask) AS can_ask
    FROM (
      SELECT pr.id, pr.joined_at, CASE WHEN pr.creator_person_id = app_person() THEN pr.joiner_person_id ELSE pr.creator_person_id END AS other
      FROM pairs pr
      WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory AND app_person() IN (pr.creator_person_id, pr.joiner_person_id)
    ) o
    JOIN people p ON p.id = o.other AND p.state = 'active'
    ORDER BY o.other, o.joined_at DESC
  ) f
  LEFT JOIN LATERAL (
    SELECT l.id FROM directory_listings l
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE l.person_id = f.other
  ) shown ON true
  ORDER BY f.joined_at DESC
$$;
COMMENT ON FUNCTION friend_list() IS 'The friends of the person in app.person_id: everyone they joined an invite pair with or accepted a friend request from, once each by their latest pair, with whether that friend lets friends ask their persona and their listing when Explore shows it. Directory pairs never count.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION friend_request_send(uuid, int), friend_request_accept(uuid), friend_request_decline(uuid), friend_requests_mine(),
  directory_profile(uuid), friend_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION friend_request_send(uuid, int), friend_request_accept(uuid), friend_request_decline(uuid), friend_requests_mine(),
  directory_profile(uuid), friend_list() TO app_api;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0001, 0003, 0006 and 0007.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION friend_request_send(uuid, int) OWNER TO app_definer;
ALTER FUNCTION friend_request_accept(uuid) OWNER TO app_definer;
ALTER FUNCTION friend_request_decline(uuid) OWNER TO app_definer;
ALTER FUNCTION friend_requests_mine() OWNER TO app_definer;
ALTER FUNCTION directory_profile(uuid) OWNER TO app_definer;
ALTER FUNCTION friend_list() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
