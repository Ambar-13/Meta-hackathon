-- package: db
-- Lets a person put up their own profile photo, which shows wherever they show, as Instagram's Edit profile does (3 Nov 2026).

-- One photo per person: a square JPEG the browser drew itself, so it carries no camera or location data. A new photo is a new row, so
-- its id, and with it the address the app loads it from, changes and no old copy is shown from a cache.
CREATE TABLE profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 64 AND 400000),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE profile_photos IS 'The profile photo a person put up themselves: a square JPEG drawn in their browser, at most 400000 bytes. Only its owner reads or changes the row; everyone else sees it through profile_photo_read with an id the app showed them.';
ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_photos_own ON profile_photos FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY profile_photos_definer ON profile_photos FOR SELECT TO app_definer USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_photos TO app_api, app_worker;
GRANT SELECT ON profile_photos TO app_definer;

-- One photo's image by its id, for anyone signed in who was shown the id, while its owner's account is active.
CREATE FUNCTION profile_photo_read(p_id uuid)
RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pp.image
  FROM profile_photos pp
  JOIN people p ON p.id = pp.person_id AND p.state = 'active'
  WHERE pp.id = p_id AND app_person() IS NOT NULL
$$;
COMMENT ON FUNCTION profile_photo_read(uuid) IS 'The image of one profile photo by its id, for a signed-in caller, while its owner is active; nothing for a photo that is gone or a caller with no person set.';

-- The photo ids of the people behind some listings, for the people and posts of Explore and a profile.
CREATE FUNCTION listing_photo_ids(p_listing_ids uuid[])
RETURNS TABLE (listing_id uuid, photo_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.id, pp.id
  FROM directory_listings l
  JOIN people p ON p.id = l.person_id AND p.state = 'active'
  JOIN profile_photos pp ON pp.person_id = l.person_id
  WHERE l.id = ANY(p_listing_ids) AND app_person() IS NOT NULL
$$;
COMMENT ON FUNCTION listing_photo_ids(uuid[]) IS 'The photo id of each listed person who put up a photo, by listing, for a signed-in caller. Listings are what Explore already shows; no person id leaves.';

-- The photo ids of the caller's friends by the pairs that make them friends, for the friends list.
CREATE FUNCTION pair_photo_ids(p_pair_ids uuid[])
RETURNS TABLE (pair_id uuid, photo_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pr.id, pp.id
  FROM pairs pr
  JOIN profile_photos pp ON pp.person_id = CASE WHEN pr.creator_person_id = app_person() THEN pr.joiner_person_id ELSE pr.creator_person_id END
  JOIN people p ON p.id = pp.person_id AND p.state = 'active'
  WHERE pr.id = ANY(p_pair_ids) AND pr.joined_at IS NOT NULL AND app_person() IN (pr.creator_person_id, pr.joiner_person_id)
$$;
COMMENT ON FUNCTION pair_photo_ids(uuid[]) IS 'The photo id of the other person of each of the caller''s joined pairs who put up a photo, by pair; pairs the caller is not in give nothing.';

-- The grants run while app_migrate still owns the functions: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION profile_photo_read(uuid), listing_photo_ids(uuid[]), pair_photo_ids(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profile_photo_read(uuid), listing_photo_ids(uuid[]), pair_photo_ids(uuid[]) TO app_api;
-- A new owner needs CREATE on the functions' schema, so app_definer holds it only for the handover, as in 0008 to 0011.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION profile_photo_read(uuid) OWNER TO app_definer;
ALTER FUNCTION listing_photo_ids(uuid[]) OWNER TO app_definer;
ALTER FUNCTION pair_photo_ids(uuid[]) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
