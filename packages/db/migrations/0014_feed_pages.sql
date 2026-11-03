-- package: db
-- Gives Home an endless, honest feed: your friends' posts and your own first, newest first and a page at a time, then everyone else's.

-- One page of the feed. With p_friends true: posts by the caller and by their friends, as friend_list counts friends (a joined pair that
-- no directory meeting made). With p_friends false: posts by everyone else listed in Explore. Both read only posts of people listed with
-- an approved card, as explore_posts does, newest first, strictly older than the post (p_before, p_before_id) when given, which is how
-- the next page starts where the last one ended. Stories never show here.
CREATE FUNCTION feed_posts(p_friends boolean, p_before timestamptz, p_before_id uuid, p_limit int)
RETURNS TABLE (post_id uuid, listing_id uuid, display_name text, is_sample boolean, text text, created_at timestamptz, is_mine boolean, is_liked boolean, has_photo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH friends AS (
    SELECT CASE WHEN pr.creator_person_id = app_person() THEN pr.joiner_person_id ELSE pr.creator_person_id END AS person_id
    FROM pairs pr
    WHERE pr.joined_at IS NOT NULL AND NOT pr.via_directory AND app_person() IN (pr.creator_person_id, pr.joiner_person_id)
  )
  SELECT po.id, l.id, p.display_name, p.is_sample, po.text, po.created_at, po.person_id = app_person(),
    EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = po.id AND pl.person_id = app_person()), po.photo IS NOT NULL
  FROM posts po
  JOIN directory_listings l ON l.person_id = po.person_id
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE app_person() IS NOT NULL AND po.kind = 'post'
    AND (po.person_id = app_person() OR po.person_id IN (SELECT person_id FROM friends)) = p_friends
    AND (p_before IS NULL OR (po.created_at, po.id) < (p_before, p_before_id))
  ORDER BY po.created_at DESC, po.id DESC
  LIMIT p_limit
$$;
COMMENT ON FUNCTION feed_posts(boolean, timestamptz, uuid, int) IS 'One page of Home''s feed for the person in app.person_id: their own and their friends'' posts (p_friends true) or everyone else''s (false), of people listed in Explore, newest first, older than (p_before, p_before_id) when given, with the marks explore_posts gives and never a person id. No stories, and no rows without a person set.';

-- The grants run while app_migrate still owns the function: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION feed_posts(boolean, timestamptz, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION feed_posts(boolean, timestamptz, uuid, int) TO app_api;
-- A new owner needs CREATE on the function's schema, so app_definer holds it only for the handover, as in 0008 to 0013.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION feed_posts(boolean, timestamptz, uuid, int) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
