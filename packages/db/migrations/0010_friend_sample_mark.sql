-- package: db
-- Gives friend_list each friend's sample mark, so a sample friend shows their face and the made-up mark among your friends as in Explore (3 Nov 2026).

DROP FUNCTION friend_list();
CREATE FUNCTION friend_list()
RETURNS TABLE (pair_id uuid, display_name text, can_ask boolean, listing_id uuid, is_sample boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.pair_id, f.display_name, f.can_ask, shown.id, f.is_sample
  FROM (
    SELECT DISTINCT ON (o.other) o.id AS pair_id, o.other, p.display_name, p.is_sample, o.joined_at,
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
COMMENT ON FUNCTION friend_list() IS 'The friends of the person in app.person_id: everyone they joined an invite pair with or accepted a friend request from, once each by their latest pair, with whether that friend lets friends ask their Meety, their listing when Explore shows it, and their sample mark. Directory pairs never count.';

-- The grants run while app_migrate still owns the function: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION friend_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION friend_list() TO app_api;
-- A new owner needs CREATE on the function's schema, so app_definer holds it only for the handover, as in 0008 and 0009.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION friend_list() OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
