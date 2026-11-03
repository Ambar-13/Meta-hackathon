-- package: db
-- Keeps the summary a person's own AI wrote about them, and lets a person ask their own Meety, with or without a card.

-- The summary a person pasted, written by their own AI from Meety's prompt. The api stores it scrubbed by code; the check_summary
-- job then replaces other people's names, reads its points, and looks each point's quotes up in the person's own messages. One per
-- person, read and written only by that person, and it goes with their account.
CREATE TABLE person_summaries (
  person_id uuid PRIMARY KEY REFERENCES people (id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 20000),
  points jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'checking' CHECK (state IN ('checking', 'ready', 'failed')),
  friends_can_ask boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE person_summaries IS 'The summary a person''s own AI wrote about them, scrubbed, with its points once checked. Only its person reads or writes it.';
COMMENT ON COLUMN person_summaries.points IS 'The points read after the names check, each with the quote found in the person''s own messages, or none.';
COMMENT ON COLUMN person_summaries.friends_can_ask IS 'Whether friends'' asks may use the summary; off until the person turns it on.';
ALTER TABLE person_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY person_summaries_own ON person_summaries FOR ALL TO app_api, app_worker
  USING (person_id = app_person()) WITH CHECK (person_id = app_person());
GRANT SELECT, INSERT, UPDATE, DELETE ON person_summaries TO app_api, app_worker;

-- How many times a person saved a summary on summary_save_day, a UTC day, so the api can cap saves; each save runs one names check.
-- The count lives on the person, so deleting the summary does not reset it.
ALTER TABLE people ADD COLUMN summary_save_day date;
ALTER TABLE people ADD COLUMN summary_saves_today int NOT NULL DEFAULT 0 CHECK (summary_saves_today >= 0);
COMMENT ON COLUMN people.summary_saves_today IS 'Summary saves on summary_save_day, a UTC day; kept on the person so deleting the summary does not reset the cap.';

-- A person may ask their own Meety: mode self, with no pair, whose one answer has the same person as asker and subject.
ALTER TABLE persona_asks DROP CONSTRAINT persona_asks_mode_check;
ALTER TABLE persona_asks ADD CONSTRAINT persona_asks_mode_check CHECK (mode IN ('help', 'react', 'self'));
ALTER TABLE persona_answers DROP CONSTRAINT persona_answers_mode_check;
ALTER TABLE persona_answers ADD CONSTRAINT persona_answers_mode_check CHECK (mode IN ('help', 'react', 'self'));
ALTER TABLE persona_answers DROP CONSTRAINT persona_answers_check;
ALTER TABLE persona_answers ADD CONSTRAINT persona_answers_asker_not_subject CHECK (asker_person_id <> subject_person_id OR mode = 'self');

-- An answer can come from a summary alone, when its person has no approved card yet.
ALTER TABLE persona_answers ALTER COLUMN subject_card_id DROP NOT NULL;

-- The search-words call, which turns an ask into the words its search uses.
ALTER TABLE ledger DROP CONSTRAINT ledger_call_site_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_call_site_check CHECK (call_site IN ('scrub_names','question_check','card','quiz_answer','quiz_judge','speech','receipts','brief','brief_support_judge','comic_panels','comic_image','self_test','persona_answer','ask_support_judge','orchestrator','search_words'));
