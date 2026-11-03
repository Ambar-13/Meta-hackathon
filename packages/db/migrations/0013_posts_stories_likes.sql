-- package: db
-- Lets every person share posts and 24-hour stories with a photo and like posts, as Instagram does, and lets their Meety read them (3 Nov 2026).

-- A post or a story holds words, a photo the browser drew itself (so it carries no camera or location data), or both. A story shows for
-- 24 hours from when it went up and never shows on a profile's Posts tab or in the feed.
ALTER TABLE posts DROP CONSTRAINT posts_text_check;
ALTER TABLE posts
  ADD COLUMN kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'story')),
  ADD COLUMN photo bytea CHECK (photo IS NULL OR octet_length(photo) BETWEEN 64 AND 1000000),
  ADD COLUMN expires_at timestamptz,
  ADD CONSTRAINT posts_words_or_photo CHECK (char_length(text) <= 600 AND (char_length(text) >= 1 OR photo IS NOT NULL)),
  ADD CONSTRAINT posts_story_expires CHECK ((kind = 'story') = (expires_at IS NOT NULL));
COMMENT ON TABLE posts IS 'A post or a story a person shared: words, a photo, or both. The feed and profiles show the posts of people listed in Explore, and the row of faces their stories until each expires; only its writer changes a row.';
COMMENT ON COLUMN posts.kind IS 'post for the feed and the profile, story for the row of faces for 24 hours.';
COMMENT ON COLUMN posts.photo IS 'A JPEG the browser drew from the person''s picture, at most 1000000 bytes; GET /api/photos/:id serves it by the post id.';
COMMENT ON COLUMN posts.expires_at IS 'When a story stops showing, 24 hours after it went up; null for a post.';
CREATE INDEX posts_story_expires_idx ON posts (expires_at) WHERE kind = 'story';

-- One like: a person and a post they liked. Nobody sees a count or a list of who liked what; the liker's own Meety reads their likes.
CREATE TABLE post_likes (
  post_id uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, person_id)
);
COMMENT ON TABLE post_likes IS 'A post a person liked. Only the person who liked it reads or changes the row; the feed shows them their own heart filled, and their Meety reads what they liked to learn what they are into.';
CREATE INDEX post_likes_person_created_idx ON post_likes (person_id, created_at);
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes FORCE ROW LEVEL SECURITY;
CREATE POLICY post_likes_own ON post_likes FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY post_likes_definer ON post_likes FOR SELECT TO app_definer USING (true);
GRANT SELECT, INSERT, DELETE ON post_likes TO app_api, app_worker;
GRANT SELECT ON post_likes TO app_definer;

-- explore_posts gains the caller's own posts, whether the caller liked each post and whether it has a photo, and leaves out stories.
DROP FUNCTION explore_posts(int);
CREATE FUNCTION explore_posts(p_limit int)
RETURNS TABLE (post_id uuid, listing_id uuid, display_name text, is_sample boolean, text text, created_at timestamptz, is_mine boolean, is_liked boolean, has_photo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, l.id, p.display_name, p.is_sample, po.text, po.created_at, po.person_id = app_person(),
    EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = po.id AND pl.person_id = app_person()), po.photo IS NOT NULL
  FROM posts po
  JOIN directory_listings l ON l.person_id = po.person_id
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE app_person() IS NOT NULL AND po.kind = 'post'
  ORDER BY po.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION explore_posts(int) IS 'The newest posts of people listed in Explore, the caller''s own among them once listed: the post, the author''s listing, display name and sample mark, whether it is the caller''s, whether the caller liked it and whether it has a photo, never a person id. Stories never show here. No rows without a person in app.person_id.';

-- listing_posts gains the same three marks, and leaves out stories.
DROP FUNCTION listing_posts(uuid, int);
CREATE FUNCTION listing_posts(p_listing uuid, p_limit int)
RETURNS TABLE (post_id uuid, listing_id uuid, display_name text, is_sample boolean, text text, created_at timestamptz, is_mine boolean, is_liked boolean, has_photo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, l.id, p.display_name, p.is_sample, po.text, po.created_at, po.person_id = app_person(),
    EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = po.id AND pl.person_id = app_person()), po.photo IS NOT NULL
  FROM directory_listings l
  JOIN people p ON p.id = l.person_id AND p.state = 'active'
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  JOIN posts po ON po.person_id = l.person_id AND po.kind = 'post'
  WHERE l.id = p_listing AND app_person() IS NOT NULL
  ORDER BY po.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION listing_posts(uuid, int) IS 'The newest posts of the person behind one listing Explore shows, for that profile''s Posts tab, with the same marks as explore_posts. No stories, no rows without a person in app.person_id, and none for a listing Explore does not show.';

-- The stories that show now: the caller's own, listed or not, then those of people listed in Explore, newest first.
CREATE FUNCTION story_feed(p_limit int)
RETURNS TABLE (story_id uuid, listing_id uuid, display_name text, is_sample boolean, is_mine boolean, text text, has_photo boolean, created_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, l.id, p.display_name, p.is_sample, po.person_id = app_person(), po.text, po.photo IS NOT NULL, po.created_at, po.expires_at
  FROM posts po
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  LEFT JOIN directory_listings l ON l.person_id = po.person_id
  LEFT JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE app_person() IS NOT NULL AND po.kind = 'story' AND po.expires_at > now() AND (po.person_id = app_person() OR c.id IS NOT NULL)
  ORDER BY po.person_id = app_person() DESC, po.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION story_feed(int) IS 'The stories that have not expired: the caller''s own first, whether or not they are listed, then those of people listed in Explore, newest first, with the listing (null for an unlisted caller''s own), display name, sample mark and whether it has a photo, never a person id.';

-- One post's or story's photo by its id, where the post or story shows: to its writer, and to anyone signed in while its writer is listed
-- in Explore, as explore_posts and story_feed show them. A story's photo ends with the story.
CREATE FUNCTION post_photo_read(p_id uuid)
RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.photo
  FROM posts po
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  WHERE po.id = p_id AND app_person() IS NOT NULL AND (po.kind = 'post' OR po.expires_at > now())
    AND (po.person_id = app_person() OR EXISTS (
      SELECT 1
      FROM directory_listings l
      JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
      WHERE l.person_id = po.person_id
    ))
$$;
COMMENT ON FUNCTION post_photo_read(uuid) IS 'The photo of one post or unexpired story by its id, for its writer, and for anyone signed in while the writer is listed in Explore with an approved card; null for one with no photo, one that is gone or no longer shows, and a caller with no person set.';

-- Whether the caller may like a post: one that explore_posts or listing_posts could show them.
CREATE FUNCTION post_is_visible(p_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM posts po
    JOIN directory_listings l ON l.person_id = po.person_id
    JOIN people p ON p.id = po.person_id AND p.state = 'active'
    JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
    WHERE po.id = p_id AND po.kind = 'post' AND app_person() IS NOT NULL
  )
$$;
COMMENT ON FUNCTION post_is_visible(uuid) IS 'True when the post with this id is one the feed or a profile shows the signed-in caller, so they may like it; false for a story, a post that is gone, and a caller with no person set.';

-- The posts the caller liked that still show, newest like first, for their own Meety: the writer's name and the post, never an id.
CREATE FUNCTION liked_posts(p_limit int)
RETURNS TABLE (display_name text, text text, has_photo boolean, liked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.display_name, po.text, po.photo IS NOT NULL, pl.created_at
  FROM post_likes pl
  JOIN posts po ON po.id = pl.post_id AND po.kind = 'post'
  JOIN people p ON p.id = po.person_id AND p.state = 'active'
  JOIN directory_listings l ON l.person_id = po.person_id
  JOIN cards c ON c.id = l.card_id AND c.person_id = l.person_id AND c.state = 'approved'
  WHERE pl.person_id = app_person()
  ORDER BY pl.created_at DESC, po.id
  LIMIT p_limit
$$;
COMMENT ON FUNCTION liked_posts(int) IS 'The posts the person in app.person_id liked that the feed still shows, newest like first: the writer''s display name, the words and whether it has a photo. The worker reads it in that person''s own context for their Meety; nobody else''s likes are readable.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION explore_posts(int), listing_posts(uuid, int), story_feed(int), post_photo_read(uuid), post_is_visible(uuid), liked_posts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION explore_posts(int), listing_posts(uuid, int), story_feed(int), post_photo_read(uuid), post_is_visible(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION liked_posts(int) TO app_worker;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0008 to 0012.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION explore_posts(int) OWNER TO app_definer;
ALTER FUNCTION listing_posts(uuid, int) OWNER TO app_definer;
ALTER FUNCTION story_feed(int) OWNER TO app_definer;
ALTER FUNCTION post_photo_read(uuid) OWNER TO app_definer;
ALTER FUNCTION post_is_visible(uuid) OWNER TO app_definer;
ALTER FUNCTION liked_posts(int) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
