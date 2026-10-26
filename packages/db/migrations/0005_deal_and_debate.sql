-- package: db
-- Adds deal and debate to the kinds a meeting question can have, and lets curated question ids run to 16 (R10.5).

ALTER TABLE meetings DROP CONSTRAINT meetings_question_kind_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_question_kind_check
  CHECK (question_kind IN ('get_along', 'help', 'situation', 'decision', 'deal', 'debate'));
ALTER TABLE meetings DROP CONSTRAINT meetings_question_id_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_question_id_check CHECK (question_id BETWEEN 1 AND 16);
COMMENT ON COLUMN meetings.question_kind IS 'What the question asks the personas to play out: get_along (including whether they would clash), help, situation, decision, deal or debate. A curated question sets it at insert, a free-text one from the question check; situation until then.';
