-- package: db
-- Adds the names each names pass found and the time each pass finished, so the names review can list them, put kept ones back and refuse to freeze early.

CREATE TABLE names_passes (
  source_id uuid PRIMARY KEY REFERENCES sources (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  finished_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE names_passes IS 'One row per source once the names pass has finished; the names review refuses to freeze a source without it (D15, D16).';
ALTER TABLE names_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE names_passes FORCE ROW LEVEL SECURITY;
CREATE POLICY names_passes_own ON names_passes FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());

CREATE TABLE source_names (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (text <> ''),
  role_token text NOT NULL CHECK (role_token LIKE '[person:%]'),
  is_minor boolean NOT NULL DEFAULT false,
  placeholder_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, text),
  UNIQUE (source_id, role_token)
);
COMMENT ON TABLE source_names IS 'A third-party name the names pass replaced in one source, kept only until the names review so the person can choose to keep it (D15, R2.4).';
COMMENT ON COLUMN source_names.role_token IS 'The token written into turns.text for this name, unique within the source, so a kept name can be put back.';
COMMENT ON COLUMN source_names.placeholder_ids IS 'The placeholder ids of the redactions rows written for this name, one per replaced occurrence.';
CREATE INDEX source_names_source_id_idx ON source_names (source_id);
ALTER TABLE source_names ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_names FORCE ROW LEVEL SECURITY;
CREATE POLICY source_names_own ON source_names FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());

-- Only the worker's names check writes these rows. The API reads them, and the review deletes a source's names at the freeze.
GRANT SELECT, INSERT, UPDATE, DELETE ON names_passes, source_names TO app_worker;
GRANT SELECT ON names_passes TO app_api;
GRANT SELECT, DELETE ON source_names TO app_api;

-- A source can be frozen only after its names check has finished, so no name the check would have replaced reaches a
-- card or a meeting, whatever the calling code does. The review route checks first; this is the backstop.
CREATE OR REPLACE FUNCTION sources_freeze_needs_names_pass() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.frozen_at IS NULL AND NEW.frozen_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM names_passes WHERE source_id = NEW.id) THEN
    RAISE EXCEPTION 'names_pass_running: The names check is still running. Wait a few seconds and send the review again.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sources_freeze_needs_names_pass BEFORE UPDATE OF frozen_at ON sources
  FOR EACH ROW EXECUTE FUNCTION sources_freeze_needs_names_pass();
