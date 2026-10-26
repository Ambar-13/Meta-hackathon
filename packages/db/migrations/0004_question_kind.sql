-- package: db
-- Adds the kind of each meeting's question, so the meeting prompts and the brief's section labels follow what the question asks (R10.5).

ALTER TABLE meetings ADD COLUMN question_kind text NOT NULL DEFAULT 'situation'
  CHECK (question_kind IN ('get_along', 'help', 'situation', 'decision'));
COMMENT ON COLUMN meetings.question_kind IS 'What the question asks the personas to play out: get_along, help, situation or decision. A curated question sets it at insert, a free-text one from the question check; situation until then.';
