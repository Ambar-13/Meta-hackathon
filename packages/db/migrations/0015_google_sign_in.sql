-- package: db
-- Lets a person sign in with their Google account and keeps only Google's id for it, never the email (3 Nov 2026).

-- One Google account a person signs in with, by Google's own id for it (the OpenID subject). Meety never keeps the email. A person has
-- at most one, a Google account belongs to at most one person, and the row goes with the person's account.
CREATE TABLE google_accounts (
  google_sub text PRIMARY KEY CHECK (char_length(google_sub) BETWEEN 1 AND 255),
  person_id uuid NOT NULL UNIQUE REFERENCES people (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE google_accounts IS 'The Google account a person signs in with, by its OpenID subject only; no email is kept. Its person reads it; only auth_google_person writes it.';
ALTER TABLE google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY google_accounts_own ON google_accounts FOR SELECT TO app_api, app_worker USING (person_id = app_person());
CREATE POLICY google_accounts_definer ON google_accounts FOR ALL TO app_definer USING (true) WITH CHECK (true);
GRANT SELECT ON google_accounts TO app_api, app_worker;
GRANT SELECT, INSERT ON google_accounts TO app_definer;

-- Signs a person in with a Google account the api has already checked: the person that Google id belongs to, or, the first time, a new
-- person with this display name and no recovery code, since signing in with Google again is how they come back; then a new session
-- from its hash either way. NULL when the id belongs to a person whose account is being deleted.
CREATE FUNCTION auth_google_person(p_sub text, p_name text, p_session_hash bytea)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  found uuid;
  found_state text;
BEGIN
  SELECT g.person_id, p.state INTO found, found_state FROM google_accounts g JOIN people p ON p.id = g.person_id WHERE g.google_sub = p_sub;
  IF found IS NULL THEN
    INSERT INTO people (display_name) VALUES (p_name) RETURNING id INTO found;
    INSERT INTO google_accounts (google_sub, person_id) VALUES (p_sub, found);
  ELSIF found_state <> 'active' THEN
    RETURN NULL;
  END IF;
  INSERT INTO sessions (person_id, token_hash, expires_at) VALUES (found, p_session_hash, now() + interval '90 days');
  RETURN found;
END
$$;
COMMENT ON FUNCTION auth_google_person(text, text, bytea) IS 'Signs in with a Google account the api checked: its person, or a new person with this name the first time, and a new session from its hash. NULL for a person whose account is being deleted.';

-- The grants run while app_migrate still owns the function: after the handover PostgreSQL ignores them with a warning (0001 does the same).
REVOKE ALL ON FUNCTION auth_google_person(text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_google_person(text, text, bytea) TO app_api;
-- A new owner needs CREATE on the function's schema, so app_definer holds it only for the handover, as in 0008 to 0014.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION auth_google_person(text, text, bytea) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
