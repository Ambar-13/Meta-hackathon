Request build/w0-contracts-005.
File: packages/db/migrations/0001_foundation.sql. Two defects, both found by running the file as the spec gives it in a scratch database. Each fix below was checked in that scratch database. Nothing else was changed.
Defect A. The policy meeting_members_member reads meeting_members inside its own USING clause, in the inline EXISTS. Any read of meeting_members as app_api or app_worker fails with "infinite recursion detected in policy for relation meeting_members". Reads of people fail the same way, through app_meeting_person. Proposed:
```diff
+CREATE OR REPLACE FUNCTION app_shares_meeting(m uuid) RETURNS boolean
+LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
+  SELECT EXISTS (SELECT 1 FROM meeting_members WHERE meeting_id = m AND person_id = app_person())
+$$;
+ALTER FUNCTION app_shares_meeting(uuid) OWNER TO app_definer;
 CREATE POLICY meeting_members_member ON meeting_members FOR ALL TO app_api, app_worker
-  USING (meeting_id = app_meeting() OR person_id = app_person()
-         OR EXISTS (SELECT 1 FROM meeting_members mine WHERE mine.meeting_id = meeting_members.meeting_id AND mine.person_id = app_person()))
+  USING (meeting_id = app_meeting() OR person_id = app_person() OR app_shares_meeting(meeting_id))
   WITH CHECK (meeting_id = app_meeting() OR person_id = app_person());
```
Checked: after the change, app_api with a person context reads people and meeting_members without error. The people read returned both members of the test pair. Not yet checked: that the function returns true for a real member's row. Wave 1 database tests should cover that.
Defect B. recall_corpus is a plain view, so it runs with the owner's rights. The owner app_migrate is subject to FORCE row security and has no policy on these tables, so the view returns zero rows even when the card allows recall. Proposed:
```diff
-CREATE VIEW recall_corpus AS
+CREATE VIEW recall_corpus WITH (security_invoker = true) AS
```
Checked: with the owner set to app_migrate, app_worker with a person context read 0 rows before the change and 1 row after it. ARCHITECTURE.md 3.26 says the view is SECURITY INVOKER.
Why: no Wave 0 test reads the view or these policies. Invariants 15 and 16, the recall tests of R7.1 and the membership reads in Wave 1 depend on both lines. Ambar's review of the policies (IMPLEMENTATION.md section 3) should decide.
Until then: the file is applied exactly as the spec gives it, with both defects in place.
Resolved at the Wave 0 freeze, 26 Oct: 0001 is fixed: app_shares_meeting for the meeting_members policy, security_invoker on recall_corpus, grants before the owner handover, no partner branch on people (pair_display_names instead).
