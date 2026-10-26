-- package: db
-- The whole schema of Meet First: roles, settings, every table with forced row-level security, the triggers that hold the invariants, the lookup functions, and the quiz bank seed.

-- Roles (R9.1, D55). app_migrate owns the tables and runs only this command. app_api and app_worker
-- are the two runtime roles; neither owns anything and neither can bypass row security.
-- app_definer owns the lookup functions below and nothing else.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_definer') THEN
    CREATE ROLE app_definer NOLOGIN NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;
-- The migrating role must be able to SET ROLE app_definer, or PostgreSQL 16 refuses to hand it the
-- lookup functions below. INHERIT FALSE keeps app_definer's rights out of the migrating role's own queries.
GRANT app_definer TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Settings read by every policy (D55). NULL or empty means "no context", and every policy then yields zero rows.
CREATE OR REPLACE FUNCTION app_person() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT nullif(current_setting('app.person_id', true), '')::uuid
$$;
COMMENT ON FUNCTION app_person() IS 'The person this transaction acts for, from SET LOCAL app.person_id; NULL when unset.';

CREATE OR REPLACE FUNCTION app_meeting() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT nullif(current_setting('app.meeting_id', true), '')::uuid
$$;
COMMENT ON FUNCTION app_meeting() IS 'The meeting this transaction acts for, from SET LOCAL app.meeting_id; NULL when unset.';

CREATE TABLE schema_migrations (
  number int PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS 'Which migration files have run. The worker compares the highest number with the one it was built for at boot (D71).';
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations FORCE ROW LEVEL SECURITY;

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (display_name <> ''),
  affiliations text[] NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'deleted')),
  recovery_code_hash bytea,
  recovery_code_used_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE people IS 'One row per person. Nobody has an email; a person is a display name plus a session cookie and a recovery code.';
COMMENT ON COLUMN people.affiliations IS 'Names the scrubber must leave alone because the person declared them (D17).';
COMMENT ON COLUMN people.recovery_code_hash IS 'sha256 of the 32-character recovery code shown once at signup; redeemable once (A5).';
COMMENT ON COLUMN people.state IS 'deleted is set first by DELETE /api/people/me; the row itself goes when the delete_person job finishes (D69).';
CREATE UNIQUE INDEX people_recovery_code_hash_key ON people (recovery_code_hash) WHERE recovery_code_hash IS NOT NULL;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE sessions IS 'One row per signed-in browser. The token itself is never stored; only its sha256 (D33).';
COMMENT ON COLUMN sessions.expires_at IS 'created_at plus 90 days (D33).';
CREATE INDEX sessions_person_id_idx ON sessions (person_id);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE TABLE transfer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE transfer_links IS 'Ten-minute single-use links that move a session out of an in-app webview into the real browser (R9.2).';
ALTER TABLE transfer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_links FORCE ROW LEVEL SECURITY;

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chatgpt', 'claude', 'notes', 'paste')),
  content_hash bytea NOT NULL,
  turn_count int NOT NULL CHECK (turn_count BETWEEN 1 AND 10000),
  canonical_chars int NOT NULL CHECK (canonical_chars <= 2097152),
  persona_signal numeric(4,3) NOT NULL,
  parser_version text NOT NULL,
  scrub_version text NOT NULL,
  chars_per_token numeric(6,3),
  attested_at timestamptz NOT NULL,
  sensitive_opt_in text[] NOT NULL DEFAULT '{}',
  names_reviewed_at timestamptz,
  frozen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, content_hash)
);
COMMENT ON TABLE sources IS 'One upload of a person''s own turns. The raw file never arrives; only canonical scrubbed turns do (D1).';
COMMENT ON COLUMN sources.content_hash IS 'sha256 of the canonical turns; a second upload of the same text returns the first row (D8).';
COMMENT ON COLUMN sources.frozen_at IS 'Set by the names review. After this, turn text cannot change and a card may be built (D16).';
COMMENT ON COLUMN sources.chars_per_token IS 'Measured from the first card call''s prompt_tokens, because Tamil is three times English (D20).';
COMMENT ON COLUMN sources.attested_at IS 'When the person ticked "these are my own chats" (R2.7).';
COMMENT ON COLUMN sources.sensitive_opt_in IS 'Sensitive categories the person chose to keep in the card and recall (D18).';
CREATE INDEX sources_person_id_idx ON sources (person_id);
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources FORCE ROW LEVEL SECURITY;

CREATE TABLE turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  turn_index int NOT NULL,
  role text NOT NULL CHECK (role = 'user'),
  text text NOT NULL CHECK (length(text) <= 20000),
  norm_text text NOT NULL,
  lang text,
  sensitive_categories text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, turn_index)
);
COMMENT ON TABLE turns IS 'One of the person''s own messages, canonical and scrubbed, with names rewritten to role tokens.';
COMMENT ON COLUMN turns.norm_text IS 'normQuote(text), stored so quote checks compare like with like (D24).';
COMMENT ON COLUMN turns.sensitive_categories IS 'Tags from the names pass; such turns stay out of cards and recall unless opted in (R2.8).';
CREATE INDEX turns_source_id_idx ON turns (source_id);
CREATE INDEX turns_norm_text_tsv_idx ON turns USING GIN (to_tsvector('simple', norm_text));
CREATE INDEX turns_norm_text_trgm_idx ON turns USING GIN (norm_text gin_trgm_ops);
ALTER TABLE turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE turns FORCE ROW LEVEL SECURITY;

CREATE TABLE redactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES turns (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('secret','email','phone','url_credentials','jwt','nric','aadhaar','pan','postal','iban','card','address','person','health','minor','identifier','code')),
  placeholder_id char(8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, placeholder_id)
);
COMMENT ON TABLE redactions IS 'One row per thing the scrubber replaced. The count shown anywhere is COUNT(*) of this table (R2.5). No offsets are kept (D14).';
CREATE INDEX redactions_source_id_idx ON redactions (source_id);
ALTER TABLE redactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE redactions FORCE ROW LEVEL SECURITY;

CREATE TABLE cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('building', 'ready', 'thin', 'failed', 'approved')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  items_total int,
  items_verified int,
  thin boolean NOT NULL DEFAULT false,
  recall_allowed boolean NOT NULL DEFAULT false,
  built_at timestamptz,
  approved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE cards IS 'The persona card built from one frozen source: a list of items, each with a quote from a named turn.';
COMMENT ON COLUMN cards.thin IS 'True when fewer than 6 items verified; the quiz is skipped and the meeting shows a badge (D23).';
COMMENT ON COLUMN cards.recall_allowed IS 'The explicit switch allowing lookups into the scrubbed notes during meetings (R7.1).';
CREATE INDEX cards_person_created_idx ON cards (person_id, created_at);
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards FORCE ROW LEVEL SECURITY;

CREATE TABLE card_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  position int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('value', 'preference', 'habit', 'boundary', 'goal')),
  claim text NOT NULL,
  lang text NOT NULL,
  gloss text NOT NULL,
  turn_id uuid NOT NULL REFERENCES turns (id),
  quote text NOT NULL,
  norm_quote text NOT NULL,
  verified boolean NOT NULL,
  flagged boolean NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verified OR flagged),
  UNIQUE (card_id, position)
);
COMMENT ON TABLE card_items IS 'One persona item. verified means the quote was found inside the named turn; flagged means it was not (R3.2).';
COMMENT ON COLUMN card_items.gloss IS 'English gloss of a claim written in another language (R6.3).';
ALTER TABLE card_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_items FORCE ROW LEVEL SECURITY;

CREATE TABLE quiz_bank (
  bank_version int NOT NULL,
  question_id int NOT NULL CHECK (question_id BETWEEN 1 AND 30),
  text text NOT NULL,
  PRIMARY KEY (bank_version, question_id)
);
COMMENT ON TABLE quiz_bank IS 'The fixed 30 quiz questions per bank version, seeded by migration and equal to QUIZ_BANK in packages/contracts (D28, R4.7).';
ALTER TABLE quiz_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_bank FORCE ROW LEVEL SECURITY;

CREATE TABLE quizzes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL UNIQUE REFERENCES cards (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  bank_version int NOT NULL,
  seed text NOT NULL,
  state text NOT NULL CHECK (state IN ('answering', 'waiting_human', 'judging', 'judged', 'failed')),
  matched int CHECK (matched BETWEEN 0 AND 10),
  reliable boolean,
  calibration_raw jsonb,
  judge_runs int NOT NULL DEFAULT 0,
  judged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE quizzes IS 'The knows-me quiz for one card: ten bank questions, persona answers first, then the human, then a blind judge.';
COMMENT ON COLUMN quizzes.reliable IS 'False when the judge failed both calibration pairs twice (D30).';
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quizzes FORCE ROW LEVEL SECURITY;

CREATE TABLE quiz_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position BETWEEN 1 AND 10),
  bank_version int NOT NULL,
  question_id int NOT NULL,
  persona_answer text,
  human_answer text CHECK (human_answer IS NULL OR length(human_answer) <= 200),
  flipped boolean NOT NULL,
  agree boolean,
  judge_reason text,
  judge_raw jsonb,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, position),
  FOREIGN KEY (bank_version, question_id) REFERENCES quiz_bank (bank_version, question_id),
  CHECK (human_answer IS NULL OR persona_answer IS NOT NULL)
);
COMMENT ON TABLE quiz_items IS 'One quiz question with both answers. A human answer cannot be stored before the persona answer exists (D29).';
COMMENT ON COLUMN quiz_items.flipped IS 'Whether the judge saw the human answer first; set at random per item (D30).';
ALTER TABLE quiz_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_items FORCE ROW LEVEL SECURITY;

CREATE TABLE pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  joiner_person_id uuid REFERENCES people (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (creator_person_id IS DISTINCT FROM joiner_person_id)
);
COMMENT ON TABLE pairs IS 'An invite between two people. The token is 128 bits, stored as sha256, single use, 24 hours (D32).';
ALTER TABLE pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairs FORCE ROW LEVEL SECURITY;

CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES pairs (id) ON DELETE CASCADE,
  question_id int CHECK (question_id BETWEEN 1 AND 12),
  question_text text NOT NULL,
  question_checked_at timestamptz,
  question_rejected_reason text,
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'queued', 'running', 'ended', 'deleted')),
  queue_position int,
  phase text CHECK (phase IN ('open', 'explore', 'decide', 'close')),
  current_step_seq int NOT NULL DEFAULT 0,
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('decided', 'budget', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE meetings IS 'One ten-minute meeting between two personas on one question (D34).';
COMMENT ON COLUMN meetings.question_checked_at IS 'Set at insert for a curated question, by check_question for free text; start waits for it (R10.5).';
COMMENT ON COLUMN meetings.ends_at IS 'started_at plus 10 minutes (D34).';
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;

CREATE TABLE meeting_members (
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  side char(1) NOT NULL CHECK (side IN ('a', 'b')),
  card_id uuid NOT NULL REFERENCES cards (id),
  ready_at timestamptz,
  last_seen_at timestamptz,
  frozen_prefix text,
  frozen_prefix_tokens int,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, person_id),
  UNIQUE (meeting_id, side)
);
COMMENT ON TABLE meeting_members IS 'The two sides of a meeting, each tied to one approved card.';
COMMENT ON COLUMN meeting_members.last_seen_at IS 'Touched on each SSE heartbeat and lobby poll; start needs both within 30 seconds (D53).';
COMMENT ON COLUMN meeting_members.frozen_prefix IS 'The byte-identical system prefix for this side, fixed at start so the prompt cache hits every turn (D41).';
ALTER TABLE meeting_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_members FORCE ROW LEVEL SECURITY;

CREATE TABLE meeting_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  step_seq int NOT NULL,
  side char(1) NOT NULL CHECK (side IN ('a', 'b')),
  phase text NOT NULL CHECK (phase IN ('open', 'explore', 'decide')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'stalled', 'done')),
  attempt int NOT NULL DEFAULT 0,
  tool_rounds int NOT NULL DEFAULT 0 CHECK (tool_rounds <= 5),
  messages jsonb NOT NULL DEFAULT '[]',
  partial_text text NOT NULL DEFAULT '',
  partial_len int NOT NULL DEFAULT 0,
  first_token_at timestamptz,
  claimed_at timestamptz,
  finished_at timestamptz,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, step_seq),
  CHECK ((output IS NOT NULL) = (state = 'done'))
);
COMMENT ON TABLE meeting_steps IS 'One persona turn. The row is the claim: a job owns a step only after its conditional UPDATE returned this row (D44).';
COMMENT ON COLUMN meeting_steps.messages IS 'The exact messages array sent so far for this step, so a resumed step replays the same history (R5.1).';
COMMENT ON COLUMN meeting_steps.partial_text IS 'Streamed text so far, flushed every 250 ms, so a reconnecting browser sees the turn mid-way (D47).';
COMMENT ON COLUMN meeting_steps.output IS '{text, toolCalls, claimsCommitted}; present exactly when state is done (invariant 10).';
ALTER TABLE meeting_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_steps FORCE ROW LEVEL SECURITY;

CREATE TABLE meeting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  seq int NOT NULL,
  type text NOT NULL CHECK (type IN ('meeting.started','phase.changed','turn.committed','tool.called','tool.result','concede','hold','meeting.ended','brief.ready','comic.ready','comic.skipped')),
  v int NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, seq)
);
COMMENT ON TABLE meeting_events IS 'The truth of a meeting: every committed event in order. Browsers fold these rows into the screen; turn.delta is never a row (D47).';
COMMENT ON COLUMN meeting_events.v IS 'Event schema version, so an old browser can tell it must refresh (R5.11).';
ALTER TABLE meeting_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_events FORCE ROW LEVEL SECURITY;


CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  step_seq int NOT NULL,
  side char(1) NOT NULL CHECK (side IN ('a', 'b')),
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  position int NOT NULL,
  text text NOT NULL,
  quote text NOT NULL,
  gloss text,
  lang text NOT NULL,
  turn_id uuid NOT NULL REFERENCES turns (id),
  verified boolean NOT NULL,
  flagged boolean NOT NULL,
  regenerated boolean NOT NULL DEFAULT false,
  evidence_valid boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (verified OR flagged),
  UNIQUE (meeting_id, step_seq, position)
);
COMMENT ON TABLE claims IS 'One claim a persona made in a turn, with the quote it rests on. flagged claims show "no receipt" on both screens (R6.5).';
COMMENT ON COLUMN claims.evidence_valid IS 'True when the cited turn is behind an approved item of the speaker or inside the speaker''s recall corpus (eval metric 1).';
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims FORCE ROW LEVEL SECURITY;

CREATE TABLE briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  agree jsonb NOT NULL,
  clash jsonb NOT NULL,
  decide_first jsonb NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  support_checked_at timestamptz,
  support_rate numeric(4,3),
  support_reliable boolean,
  support_raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, person_id)
);
COMMENT ON TABLE briefs IS 'One brief per person per meeting: agree, clash, decide first, three lines each with quotes.';
COMMENT ON COLUMN briefs.support_rate IS 'Supported lines over lines with a quote, from the second judge call; a rate, never proof (A1).';
COMMENT ON COLUMN briefs.support_reliable IS 'False when the judge failed after its retry; every supported flag is then NULL and renders as weak receipt (A1).';
ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefs FORCE ROW LEVEL SECURITY;

CREATE TABLE comics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL UNIQUE REFERENCES meetings (id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('rendering', 'ready', 'failed', 'skipped')),
  avatar_a text NOT NULL,
  avatar_b text NOT NULL,
  prompt_version text NOT NULL,
  purge_after timestamptz NOT NULL,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE comics IS 'The optional six-panel comic of a meeting with fixed avatars; purged after 30 days unless the share page is published (D64).';
ALTER TABLE comics ENABLE ROW LEVEL SECURITY;
ALTER TABLE comics FORCE ROW LEVEL SECURITY;

CREATE TABLE comic_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comic_id uuid NOT NULL REFERENCES comics (id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  position int NOT NULL CHECK (position BETWEEN 1 AND 6),
  caption text NOT NULL,
  image_prompt text NOT NULL,
  image bytea NOT NULL CHECK (octet_length(image) <= 153600),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comic_id, position)
);
COMMENT ON TABLE comic_panels IS 'One webp panel of at most 150 KB. All six are written in one transaction or none are (R11.1).';
COMMENT ON COLUMN comic_panels.image_prompt IS 'The final prompt after the scrubber ran on it; kept so a refusal can be explained (R7.5).';
ALTER TABLE comic_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE comic_panels FORCE ROW LEVEL SECURITY;

CREATE TABLE share_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL UNIQUE REFERENCES meetings (id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  consent_a boolean NOT NULL DEFAULT false,
  consent_b boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  snapshot jsonb,
  published_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (published = (consent_a AND consent_b))
);
COMMENT ON TABLE share_pages IS 'The public page of a meeting. It exists only while both consents stand; the snapshot is built at the second consent (D68).';
COMMENT ON COLUMN share_pages.revoked_at IS 'Set by a human after a report; the page is a 404 from then on (R2.7).';
ALTER TABLE share_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_pages FORCE ROW LEVEL SECURITY;

CREATE TABLE ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people (id) ON DELETE SET NULL,
  meeting_id uuid REFERENCES meetings (id) ON DELETE SET NULL,
  call_site text NOT NULL CHECK (call_site IN ('scrub_names','question_check','card','quiz_answer','quiz_judge','speech','receipts','brief','brief_support_judge','comic_panels','comic_image','self_test')),
  model text NOT NULL,
  effort text NOT NULL CHECK (effort IN ('minimal', 'low', 'medium')),
  est_tokens int NOT NULL CHECK (est_tokens >= 0),
  prompt_tokens int,
  cached_tokens int,
  completion_tokens int,
  reasoning_tokens int,
  usd numeric(10,6),
  status text NOT NULL CHECK (status IN ('started', 'ok', 'error', 'timeout', 'refused')),
  http_status int,
  request_id text,
  llm_mode text NOT NULL CHECK (llm_mode IN ('live', 'record', 'replay')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
COMMENT ON TABLE ledger IS 'One row per model call, written before the call with an estimate and finished after it. The limiter and every cap read only this table (invariant 14).';
COMMENT ON COLUMN ledger.est_tokens IS 'Estimated tokens written before the call; an image call counts 1000 (R11.4).';
COMMENT ON COLUMN ledger.usd IS 'Cost computed at call time from the prices in packages/llm/config.ts (R10.8).';
CREATE INDEX ledger_started_at_idx ON ledger (started_at);
CREATE INDEX ledger_meeting_id_idx ON ledger (meeting_id);
CREATE INDEX ledger_person_started_idx ON ledger (person_id, started_at);
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger FORCE ROW LEVEL SECURITY;

CREATE TABLE deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  counts jsonb
);
COMMENT ON TABLE deletions IS 'The record that a person was deleted and how many rows went per table. No foreign key: the people row is gone when this is complete (D69).';
ALTER TABLE deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletions FORCE ROW LEVEL SECURITY;

CREATE TABLE service_heartbeats (
  service text PRIMARY KEY CHECK (service IN ('worker')),
  seen_at timestamptz NOT NULL,
  schema_version int NOT NULL
);
COMMENT ON TABLE service_heartbeats IS 'Written by the sweep_stalled cron each minute; /api/health reports worker true when seen_at is within 2 minutes.';
ALTER TABLE service_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_heartbeats FORCE ROW LEVEL SECURITY;

-- Membership, read by the policies. SECURITY INVOKER, so they see only what the caller may see.
CREATE OR REPLACE FUNCTION app_is_member(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM meeting_members WHERE meeting_id = m AND person_id = app_person())
$$;
COMMENT ON FUNCTION app_is_member(uuid) IS 'True when the current person is a member of meeting m.';

CREATE OR REPLACE FUNCTION app_meeting_person(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM meeting_members WHERE meeting_id = app_meeting() AND person_id = p)
$$;
COMMENT ON FUNCTION app_meeting_person(uuid) IS 'True when person p is a member of the current meeting; lets meeting jobs read a member''s turns and cards.';

-- Triggers that hold the invariants of ARCHITECTURE.md section 11. Each raises with a stable code in the message.

CREATE OR REPLACE FUNCTION turns_text_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.text IS DISTINCT FROM NEW.text OR OLD.norm_text IS DISTINCT FROM NEW.norm_text)
     AND EXISTS (SELECT 1 FROM sources WHERE id = NEW.source_id AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'turn_text_frozen: the source was frozen by the names review, so its turn text cannot change. Upload again to re-scrub.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER turns_text_frozen BEFORE UPDATE ON turns FOR EACH ROW EXECUTE FUNCTION turns_text_frozen();

CREATE OR REPLACE FUNCTION cards_require_frozen_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sources WHERE id = NEW.source_id AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'card_source_not_frozen: finish the names review before building a card.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cards_require_frozen_source BEFORE INSERT ON cards FOR EACH ROW EXECUTE FUNCTION cards_require_frozen_source();

CREATE OR REPLACE FUNCTION card_items_turn_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM turns t JOIN cards c ON c.id = NEW.card_id
    WHERE t.id = NEW.turn_id AND t.source_id = c.source_id
  ) THEN
    RAISE EXCEPTION 'card_item_foreign_turn: a card item may only quote a turn of its own source.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER card_items_turn_owner BEFORE INSERT OR UPDATE ON card_items FOR EACH ROW EXECUTE FUNCTION card_items_turn_owner();

CREATE OR REPLACE FUNCTION claims_turn_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM turns t
    JOIN meeting_members mm ON mm.meeting_id = NEW.meeting_id AND mm.side = NEW.side
    JOIN cards c ON c.id = mm.card_id
    WHERE t.id = NEW.turn_id AND t.source_id = c.source_id
  ) THEN
    RAISE EXCEPTION 'claim_foreign_turn: a claim may only quote a turn of the speaking side''s own source.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER claims_turn_owner BEFORE INSERT ON claims FOR EACH ROW EXECUTE FUNCTION claims_turn_owner();

CREATE OR REPLACE FUNCTION meetings_state_transitions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = NEW.state THEN RETURN NEW; END IF;
  IF NEW.state = 'deleted' THEN RETURN NEW; END IF;
  IF (OLD.state, NEW.state) IN (('ready', 'queued'), ('ready', 'running'), ('queued', 'running'), ('running', 'ended')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'meeting_bad_transition: a meeting cannot go from % to %.', OLD.state, NEW.state USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER meetings_state_transitions BEFORE UPDATE OF state ON meetings FOR EACH ROW EXECUTE FUNCTION meetings_state_transitions();

CREATE OR REPLACE FUNCTION members_prefix_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_prefix IS DISTINCT FROM NEW.frozen_prefix
     AND EXISTS (SELECT 1 FROM meetings WHERE id = NEW.meeting_id AND state IN ('running', 'ended')) THEN
    RAISE EXCEPTION 'prefix_frozen: the prompt prefix cannot change once the meeting is running (D41).' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER members_prefix_frozen BEFORE UPDATE ON meeting_members FOR EACH ROW EXECUTE FUNCTION members_prefix_frozen();

CREATE OR REPLACE FUNCTION events_gapless_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected int;
BEGIN
  SELECT coalesce(max(seq), 0) + 1 INTO expected FROM meeting_events WHERE meeting_id = NEW.meeting_id;
  IF NEW.seq <> expected THEN
    RAISE EXCEPTION 'event_seq_gap: expected seq % for this meeting, got %. Re-read max(seq) inside the same transaction.', expected, NEW.seq USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER events_gapless_seq BEFORE INSERT ON meeting_events FOR EACH ROW EXECUTE FUNCTION events_gapless_seq();

CREATE OR REPLACE FUNCTION events_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('meeting_events', 'e:' || NEW.meeting_id::text || ':' || NEW.seq::text);
  RETURN NEW;
END
$$;
CREATE TRIGGER events_notify AFTER INSERT ON meeting_events FOR EACH ROW EXECUTE FUNCTION events_notify();


CREATE OR REPLACE FUNCTION auth_person_for_session(h bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  found uuid;
BEGIN
  UPDATE sessions s SET last_used_at = now()
  FROM people p
  WHERE s.token_hash = h AND s.expires_at > now() AND s.revoked_at IS NULL
    AND p.id = s.person_id AND p.state = 'active'
  RETURNING s.person_id INTO found;
  RETURN found;
END
$$;
COMMENT ON FUNCTION auth_person_for_session(bytea) IS 'Person for a live session token hash, or NULL. Called by the API before any SET LOCAL.';

CREATE OR REPLACE FUNCTION auth_create_person(name text, affiliations text[], recovery_hash bytea, session_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  new_person uuid;
BEGIN
  INSERT INTO people (display_name, affiliations, recovery_code_hash) VALUES (name, affiliations, recovery_hash) RETURNING id INTO new_person;
  INSERT INTO sessions (person_id, token_hash, expires_at) VALUES (new_person, session_hash, now() + interval '90 days');
  RETURN new_person;
END
$$;
COMMENT ON FUNCTION auth_create_person(text, text[], bytea, bytea) IS 'Creates a person and their first session from hashes only; the API keeps the tokens (A5, D33).';

CREATE OR REPLACE FUNCTION auth_claim_transfer(h bytea, new_session_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner uuid;
BEGIN
  UPDATE transfer_links SET used_at = now()
  WHERE token_hash = h AND used_at IS NULL AND expires_at > now()
  RETURNING person_id INTO owner;
  IF owner IS NULL THEN RETURN NULL; END IF;
  INSERT INTO sessions (person_id, token_hash, expires_at) VALUES (owner, new_session_hash, now() + interval '90 days');
  RETURN owner;
END
$$;
COMMENT ON FUNCTION auth_claim_transfer(bytea, bytea) IS 'Spends a transfer link once and opens a new session for its owner; NULL when used or expired (R9.2).';

CREATE OR REPLACE FUNCTION auth_redeem_recovery(h bytea, new_session_hash bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  owner uuid;
BEGIN
  UPDATE people SET recovery_code_used_at = now()
  WHERE recovery_code_hash = h AND recovery_code_used_at IS NULL AND state = 'active'
  RETURNING id INTO owner;
  IF owner IS NULL THEN RETURN NULL; END IF;
  INSERT INTO sessions (person_id, token_hash, expires_at) VALUES (owner, new_session_hash, now() + interval '90 days');
  RETURN owner;
END
$$;
COMMENT ON FUNCTION auth_redeem_recovery(bytea, bytea) IS 'Spends the recovery code once and opens a new session; NULL when unknown or already used (A5, invariant 20).';

CREATE OR REPLACE FUNCTION pairs_join(h bytea, me uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE pairs SET joiner_person_id = me, joined_at = now()
  WHERE token_hash = h AND joiner_person_id IS NULL AND expires_at > now() AND creator_person_id <> me
  RETURNING id
$$;
COMMENT ON FUNCTION pairs_join(bytea, uuid) IS 'Joins a pair by invite token hash in one conditional UPDATE; zero rows means used, expired or own pair (R9.3).';

CREATE OR REPLACE FUNCTION share_read(s text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT snapshot FROM share_pages WHERE slug = s AND published AND revoked_at IS NULL
$$;
COMMENT ON FUNCTION share_read(text) IS 'The public snapshot for a slug while both consents stand and nobody revoked it; never returns ids (D68).';

CREATE OR REPLACE FUNCTION ledger_window(seconds int)
RETURNS TABLE (sum_est_tokens bigint, call_count bigint, image_call_count bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(est_tokens), 0), count(*), count(*) FILTER (WHERE call_site = 'comic_image')
  FROM ledger WHERE started_at > now() - make_interval(secs => seconds)
$$;
COMMENT ON FUNCTION ledger_window(int) IS 'Token and call totals over the last n seconds across everyone, for the limiter (D58).';

CREATE OR REPLACE FUNCTION ledger_usd_since(t timestamptz) RETURNS numeric
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(usd), 0) FROM ledger WHERE started_at >= t
$$;
COMMENT ON FUNCTION ledger_usd_since(timestamptz) IS 'Dollars spent since t across everyone, for the daily and total caps (D60).';

CREATE OR REPLACE FUNCTION ledger_meeting_tokens(m uuid) RETURNS bigint
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0) FROM ledger WHERE meeting_id = m
$$;
COMMENT ON FUNCTION ledger_meeting_tokens(uuid) IS 'Tokens one meeting has used so far, for the 1,500,000 stop (D61).';

CREATE OR REPLACE FUNCTION claim_meeting_slot(m uuid, max_running int)
RETURNS TABLE (state text, queue_position int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  running_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(1);
  SELECT count(*) INTO running_count FROM meetings mt WHERE mt.state = 'running';
  IF running_count < max_running THEN
    RETURN QUERY
      UPDATE meetings mt SET state = 'running', started_at = now(), ends_at = now() + interval '10 minutes', queue_position = NULL
      WHERE mt.id = m AND mt.state IN ('ready', 'queued')
      RETURNING mt.state, mt.queue_position;
  ELSE
    RETURN QUERY
      UPDATE meetings mt SET state = 'queued',
        queue_position = (SELECT coalesce(max(q.queue_position), 0) + 1 FROM meetings q WHERE q.state = 'queued')
      WHERE mt.id = m AND mt.state = 'ready'
      RETURNING mt.state, mt.queue_position;
  END IF;
END
$$;
COMMENT ON FUNCTION claim_meeting_slot(uuid, int) IS 'Starts a meeting if fewer than max_running are running, else queues it; one row back means the caller won (R5.3, R5.9, D57).';

CREATE OR REPLACE FUNCTION meeting_create(p_pair uuid, me uuid, my_card uuid, p_question_id int, p_question_text text, is_checked boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  other uuid;
  other_card uuid;
  new_meeting uuid;
BEGIN
  SELECT CASE WHEN creator_person_id = me THEN joiner_person_id ELSE creator_person_id END INTO other
  FROM pairs WHERE id = p_pair AND joined_at IS NOT NULL AND (creator_person_id = me OR joiner_person_id = me);
  IF other IS NULL THEN
    RAISE EXCEPTION 'pair_not_joined: the other person has not joined this pair yet.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cards WHERE id = my_card AND person_id = me AND state = 'approved') THEN
    RAISE EXCEPTION 'card_not_approved: approve your card before creating a meeting.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT id INTO other_card FROM cards WHERE person_id = other AND state = 'approved' ORDER BY approved_at DESC LIMIT 1;
  IF other_card IS NULL THEN
    RAISE EXCEPTION 'other_card_missing: the other person has no approved card yet.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO meetings (pair_id, question_id, question_text, question_checked_at)
  VALUES (p_pair, p_question_id, p_question_text, CASE WHEN is_checked THEN now() ELSE NULL END)
  RETURNING id INTO new_meeting;
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id) VALUES (new_meeting, me, 'a', my_card);
  INSERT INTO meeting_members (meeting_id, person_id, side, card_id) VALUES (new_meeting, other, 'b', other_card);
  RETURN new_meeting;
END
$$;
COMMENT ON FUNCTION meeting_create(uuid, uuid, uuid, int, text, boolean) IS 'Creates a meeting and both member rows; the creator is side a. Needed because one person cannot read the other''s cards.';

CREATE OR REPLACE FUNCTION sweep_candidates(stale_seconds int)
RETURNS TABLE (meeting_id uuid, kind text, queue_position int)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT mt.id, 'stalled', NULL::int
  FROM meetings mt
  WHERE mt.state = 'running'
    AND coalesce((SELECT max(e.created_at) FROM meeting_events e WHERE e.meeting_id = mt.id), mt.started_at) < now() - make_interval(secs => stale_seconds)
  UNION ALL
  SELECT mt.id, 'queued', mt.queue_position FROM meetings mt WHERE mt.state = 'queued'
  UNION ALL
  SELECT mt.id, 'running', NULL::int FROM meetings mt WHERE mt.state = 'running'
  UNION ALL
  SELECT mt.id, 'ready', NULL::int
  FROM meetings mt
  WHERE mt.state = 'ready' AND mt.question_checked_at IS NOT NULL AND mt.question_rejected_reason IS NULL
    AND (SELECT count(*) FROM meeting_members mm
         WHERE mm.meeting_id = mt.id AND mm.ready_at IS NOT NULL AND mm.frozen_prefix IS NOT NULL) = 2
  ORDER BY 2, 3
$$;
COMMENT ON FUNCTION sweep_candidates(int) IS 'Meetings the sweeper must look at: queued ones with their position, lowest first; ready ones whose two people have both given their go-ahead and whose prompt prefixes exist, to start with nobody online; every running one, for the token stop; and stalled ones, with no event for n seconds (D46).';

CREATE OR REPLACE FUNCTION pair_display_names(p uuid)
RETURNS TABLE (creator_display_name text, joiner_display_name text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT c.display_name, j.display_name
  FROM pairs pr
  JOIN people c ON c.id = pr.creator_person_id
  LEFT JOIN people j ON j.id = pr.joiner_person_id
  WHERE pr.id = p AND app_person() IN (pr.creator_person_id, pr.joiner_person_id)
$$;
COMMENT ON FUNCTION pair_display_names(uuid) IS 'The two display names of a pair the current person belongs to, and nothing else of either person; for the lobby, the meeting screen and meeting.started.';

CREATE OR REPLACE FUNCTION purge_expired_rows()
RETURNS TABLE (table_name text, removed bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n bigint;
BEGIN
  DELETE FROM transfer_links WHERE expires_at < now(); GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'transfer_links'; removed := n; RETURN NEXT;
  DELETE FROM pairs WHERE joiner_person_id IS NULL AND expires_at < now(); GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'pairs'; removed := n; RETURN NEXT;
  DELETE FROM comics c WHERE c.purge_after < now()
    AND NOT EXISTS (SELECT 1 FROM share_pages sp WHERE sp.meeting_id = c.meeting_id AND sp.published);
  GET DIAGNOSTICS n = ROW_COUNT;
  table_name := 'comics'; removed := n; RETURN NEXT;
END
$$;
COMMENT ON FUNCTION purge_expired_rows() IS 'The hourly purge: expired transfer links, unjoined pairs past 24 hours, and comics past 30 days whose page is not published (D64, R11.5).';

-- These grants run while app_migrate still owns the functions. After the handover below, app_migrate (a member
-- of app_definer without INHERIT) may no longer grant on them, and PostgreSQL ignores such a grant with a warning.
REVOKE ALL ON FUNCTION auth_person_for_session(bytea), auth_create_person(text, text[], bytea, bytea), auth_claim_transfer(bytea, bytea),
  auth_redeem_recovery(bytea, bytea), pairs_join(bytea, uuid), share_read(text), ledger_window(int), ledger_usd_since(timestamptz),
  ledger_meeting_tokens(uuid), claim_meeting_slot(uuid, int), meeting_create(uuid, uuid, uuid, int, text, boolean), sweep_candidates(int), purge_expired_rows(),
  pair_display_names(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_person_for_session(bytea), auth_create_person(text, text[], bytea, bytea), auth_claim_transfer(bytea, bytea),
  auth_redeem_recovery(bytea, bytea), pairs_join(bytea, uuid), share_read(text), claim_meeting_slot(uuid, int), meeting_create(uuid, uuid, uuid, int, text, boolean),
  pair_display_names(uuid)
  TO app_api;
GRANT EXECUTE ON FUNCTION ledger_window(int), ledger_usd_since(timestamptz), ledger_meeting_tokens(uuid), claim_meeting_slot(uuid, int),
  sweep_candidates(int), purge_expired_rows() TO app_worker;

-- PostgreSQL 15 and later let a role own a function only if it may create in the function's schema.
-- app_definer gets that right for the ownership handovers below and loses it again after the last one.
GRANT CREATE ON SCHEMA public TO app_definer;
ALTER FUNCTION auth_person_for_session(bytea) OWNER TO app_definer;
ALTER FUNCTION auth_create_person(text, text[], bytea, bytea) OWNER TO app_definer;
ALTER FUNCTION auth_claim_transfer(bytea, bytea) OWNER TO app_definer;
ALTER FUNCTION auth_redeem_recovery(bytea, bytea) OWNER TO app_definer;
ALTER FUNCTION pairs_join(bytea, uuid) OWNER TO app_definer;
ALTER FUNCTION share_read(text) OWNER TO app_definer;
ALTER FUNCTION ledger_window(int) OWNER TO app_definer;
ALTER FUNCTION ledger_usd_since(timestamptz) OWNER TO app_definer;
ALTER FUNCTION ledger_meeting_tokens(uuid) OWNER TO app_definer;
ALTER FUNCTION claim_meeting_slot(uuid, int) OWNER TO app_definer;
ALTER FUNCTION meeting_create(uuid, uuid, uuid, int, text, boolean) OWNER TO app_definer;
ALTER FUNCTION sweep_candidates(int) OWNER TO app_definer;
ALTER FUNCTION purge_expired_rows() OWNER TO app_definer;
ALTER FUNCTION pair_display_names(uuid) OWNER TO app_definer;

GRANT USAGE ON SCHEMA public TO app_api, app_worker, app_definer;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api, app_worker, app_definer;
-- Only the worker writes the ledger, so a route bug cannot erase the rows the caps read.
REVOKE INSERT, UPDATE, DELETE ON ledger FROM app_api;
-- frozen_prefix holds a person's approved card items and quiz misses. The API never reads it; the worker builds and reads it.
REVOKE SELECT ON meeting_members FROM app_api;
GRANT SELECT (meeting_id, person_id, side, card_id, ready_at, last_seen_at, frozen_prefix_tokens, created_at) ON meeting_members TO app_api;
REVOKE INSERT, UPDATE, DELETE ON meeting_members FROM app_api;
GRANT UPDATE (ready_at, last_seen_at) ON meeting_members TO app_api;
GRANT USAGE ON SCHEMA graphile_worker TO app_api, app_worker;
GRANT ALL ON ALL TABLES IN SCHEMA graphile_worker TO app_worker;
GRANT ALL ON ALL SEQUENCES IN SCHEMA graphile_worker TO app_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO app_api, app_worker;

CREATE POLICY schema_migrations_read ON schema_migrations FOR SELECT TO app_api, app_worker USING (true);
CREATE POLICY schema_migrations_owner ON schema_migrations FOR ALL TO app_migrate USING (true) WITH CHECK (true);

-- A person changes only their own rows. A meeting context (a meeting job, or a route that has already checked
-- membership) may read both members' rows and never change or delete them.
CREATE POLICY people_own ON people FOR ALL TO app_api, app_worker USING (id = app_person()) WITH CHECK (id = app_person());
CREATE POLICY people_meeting_read ON people FOR SELECT TO app_api, app_worker USING (app_meeting_person(id));
CREATE POLICY people_definer ON people FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY sessions_own ON sessions FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY sessions_definer ON sessions FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY transfer_links_own ON transfer_links FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY transfer_links_definer ON transfer_links FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY sources_own ON sources FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY sources_meeting_read ON sources FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));
CREATE POLICY turns_own ON turns FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY turns_meeting_read ON turns FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));
CREATE POLICY redactions_own ON redactions FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY cards_own ON cards FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY cards_meeting_read ON cards FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));
CREATE POLICY cards_definer ON cards FOR SELECT TO app_definer USING (true);
CREATE POLICY card_items_own ON card_items FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY card_items_meeting_read ON card_items FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));

CREATE POLICY quiz_bank_read ON quiz_bank FOR SELECT TO app_api, app_worker USING (true);
CREATE POLICY quiz_bank_seed ON quiz_bank FOR INSERT TO app_migrate WITH CHECK (true);
CREATE POLICY quizzes_own ON quizzes FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY quizzes_meeting_read ON quizzes FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));
CREATE POLICY quiz_items_own ON quiz_items FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY quiz_items_meeting_read ON quiz_items FOR SELECT TO app_api, app_worker USING (app_meeting_person(person_id));

CREATE POLICY pairs_own ON pairs FOR ALL TO app_api, app_worker
  USING (creator_person_id = app_person() OR joiner_person_id = app_person())
  WITH CHECK (creator_person_id = app_person() OR joiner_person_id = app_person());
CREATE POLICY pairs_definer ON pairs FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY meetings_member ON meetings FOR ALL TO app_api, app_worker
  USING (id = app_meeting() OR app_is_member(id)) WITH CHECK (id = app_meeting() OR app_is_member(id));
CREATE POLICY meetings_definer ON meetings FOR ALL TO app_definer USING (true) WITH CHECK (true);

-- A member sees the other member of a meeting they are in. The check goes through a lookup function, because a
-- policy that reads its own table inside USING recurses forever (found by the Wave 0 build, request 005).
CREATE OR REPLACE FUNCTION app_shares_meeting(m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM meeting_members WHERE meeting_id = m AND person_id = app_person())
$$;
REVOKE ALL ON FUNCTION app_shares_meeting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_shares_meeting(uuid) TO app_api, app_worker;
ALTER FUNCTION app_shares_meeting(uuid) OWNER TO app_definer;
REVOKE CREATE ON SCHEMA public FROM app_definer;
-- Membership rows are made only by meeting_create and removed only by cascades. The worker may write them in a meeting
-- context; the API may read them and change only its own ready and seen times (column grants below the table grants).
CREATE POLICY meeting_members_worker ON meeting_members FOR ALL TO app_worker
  USING (meeting_id = app_meeting() OR person_id = app_person() OR app_shares_meeting(meeting_id))
  WITH CHECK (meeting_id = app_meeting() OR person_id = app_person());
CREATE POLICY meeting_members_api_read ON meeting_members FOR SELECT TO app_api
  USING (meeting_id = app_meeting() OR person_id = app_person() OR app_shares_meeting(meeting_id));
CREATE POLICY meeting_members_api_update ON meeting_members FOR UPDATE TO app_api
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());
CREATE POLICY meeting_members_definer ON meeting_members FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY meeting_steps_member ON meeting_steps FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY meeting_events_member ON meeting_events FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY meeting_events_definer ON meeting_events FOR SELECT TO app_definer USING (true);
CREATE POLICY claims_member ON claims FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY briefs_member ON briefs FOR ALL TO app_api, app_worker
  USING (person_id = app_person() OR meeting_id = app_meeting()) WITH CHECK (person_id = app_person() OR meeting_id = app_meeting());
CREATE POLICY comics_member ON comics FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY comics_definer ON comics FOR ALL TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY comic_panels_member ON comic_panels FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY share_pages_member ON share_pages FOR ALL TO app_api, app_worker
  USING (meeting_id = app_meeting() OR app_is_member(meeting_id)) WITH CHECK (meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY share_pages_definer ON share_pages FOR ALL TO app_definer USING (true) WITH CHECK (true);

CREATE POLICY ledger_own ON ledger FOR ALL TO app_api, app_worker
  USING (person_id = app_person() OR meeting_id = app_meeting() OR app_is_member(meeting_id))
  WITH CHECK (person_id = app_person() OR meeting_id = app_meeting() OR app_is_member(meeting_id));
CREATE POLICY ledger_definer ON ledger FOR SELECT TO app_definer USING (true);

CREATE POLICY deletions_own ON deletions FOR ALL TO app_api, app_worker USING (person_id = app_person()) WITH CHECK (person_id = app_person());

CREATE POLICY service_heartbeats_read ON service_heartbeats FOR SELECT TO app_api, app_worker USING (true);
CREATE POLICY service_heartbeats_write ON service_heartbeats FOR UPDATE TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY service_heartbeats_seed ON service_heartbeats FOR INSERT TO app_migrate WITH CHECK (true);

CREATE POLICY ledger_self_test_insert ON ledger FOR INSERT TO app_worker
  WITH CHECK (call_site = 'self_test' AND person_id IS NULL AND meeting_id IS NULL);
CREATE POLICY ledger_self_test_read ON ledger FOR SELECT TO app_worker
  USING (call_site = 'self_test' AND person_id IS NULL AND meeting_id IS NULL);
CREATE POLICY ledger_self_test_finish ON ledger FOR UPDATE TO app_worker
  USING (call_site = 'self_test' AND person_id IS NULL AND meeting_id IS NULL)
  WITH CHECK (call_site = 'self_test' AND person_id IS NULL AND meeting_id IS NULL);

-- security_invoker: the view runs with the reader's row security, not its owner's (ARCHITECTURE.md 3.26; Wave 0 request 005).
CREATE VIEW recall_corpus WITH (security_invoker = true) AS
SELECT t.id AS turn_id, t.person_id, t.source_id, t.text, t.norm_text, c.id AS card_id
FROM turns t
JOIN sources s ON s.id = t.source_id AND s.frozen_at IS NOT NULL
JOIN cards c ON c.source_id = s.id AND c.state = 'approved' AND c.recall_allowed = true
WHERE t.sensitive_categories = '{}'
   OR t.sensitive_categories <@ s.sensitive_opt_in;
COMMENT ON VIEW recall_corpus IS 'The turns a persona may look up during a meeting: frozen source, approved card with the recall switch on, sensitive turns only when opted in (invariant 16).';
GRANT SELECT ON recall_corpus TO app_api, app_worker;

INSERT INTO quiz_bank (bank_version, question_id, text) VALUES
  (1, 1, 'What do you do when a plan you cared about falls apart?'),
  (1, 2, 'How do you prefer to get bad news: straight away, or with context first?'),
  (1, 3, 'What kind of work makes you lose track of time?'),
  (1, 4, 'When a teammate misses a deadline, what do you do first?'),
  (1, 5, 'How do you decide between two options that both look fine?'),
  (1, 6, 'What is a boundary you hold at work that others sometimes push on?'),
  (1, 7, 'How much structure do you want in a week: a fixed plan, or room to move?'),
  (1, 8, 'What do you need from a collaborator before you trust them with something hard?'),
  (1, 9, 'When you disagree with someone senior, what do you do?'),
  (1, 10, 'What do you do on a day when nothing is going right?'),
  (1, 11, 'Do you prefer to finish one thing before starting the next, or keep several moving?'),
  (1, 12, 'What makes you say no to an otherwise good opportunity?'),
  (1, 13, 'How do you like to be thanked, if at all?'),
  (1, 14, 'What do you do when you realise you were wrong in front of others?'),
  (1, 15, 'How late is too late to message you about work?'),
  (1, 16, 'What do you want to be known for in five years?'),
  (1, 17, 'Do you think out loud or come back with a finished view?'),
  (1, 18, 'What is a habit you keep even when nobody is checking?'),
  (1, 19, 'How do you handle a task you find boring but necessary?'),
  (1, 20, 'What is the first thing you look at when judging someone else''s work?'),
  (1, 21, 'How do you want feedback delivered: in writing, in person, or either?'),
  (1, 22, 'What would make you leave a project you had committed to?'),
  (1, 23, 'Do you prefer to lead, to follow a clear lead, or to share the wheel?'),
  (1, 24, 'What is something you are trying to get better at right now?'),
  (1, 25, 'How do you react when someone changes a plan at the last minute?'),
  (1, 26, 'What kind of question do you most enjoy being asked?'),
  (1, 27, 'How do you split credit when a team wins?'),
  (1, 28, 'What do you do in the first hour of a free day?'),
  (1, 29, 'What topic do you avoid at work, and why?'),
  (1, 30, 'If a project could only have one of speed, quality or low cost, which would you give up?');

INSERT INTO service_heartbeats (service, seen_at, schema_version) VALUES ('worker', to_timestamp(0), 1);
INSERT INTO schema_migrations (number, name) VALUES (1, '0001_foundation');
