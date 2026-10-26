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

GRANT SELECT, INSERT, UPDATE, DELETE ON names_passes, source_names TO app_api, app_worker;
