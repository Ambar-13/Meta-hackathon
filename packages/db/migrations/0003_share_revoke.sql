-- package: db
-- Lets the takedown script hide a share page by its public slug after a report, which needs an owner-run function because no share_pages row is visible without a person or meeting set (R2.7).

CREATE FUNCTION share_revoke(s text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE share_pages SET revoked_at = now() WHERE slug = s AND revoked_at IS NULL RETURNING true
$$;
COMMENT ON FUNCTION share_revoke(text) IS 'Marks the share page with this slug revoked, so the next public read returns nothing; true the first time, null after (R2.7).';

-- The grants run while app_migrate still owns the function: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION share_revoke(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION share_revoke(text) TO app_worker;
-- A new owner needs CREATE on the function's schema, so app_definer holds it only for the handover, as in 0001.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION share_revoke(text) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
