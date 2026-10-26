Request build/w0-contracts-006.
File: the acceptance step 7 in the spec (the psql run on a new database).
Change wanted: step 7 cannot pass as written on a fresh cluster. Checked on PostgreSQL 16 in this run:
1. The DO block in the file creates app_api, app_worker and app_definer. app_migrate, created by the step with plain LOGIN, lacks CREATEROLE: "permission denied to create role".
2. CREATE EXTENSION pgcrypto and pg_trgm, run as app_migrate on a database app_migrate does not own: "permission denied to create extension".
3. CREATE TABLE schema_migrations, run as app_migrate on a database owned by the operating system user: "permission denied for schema public". PostgreSQL 15 and later do not grant CREATE on public.
The same file run as the superuser, with schema graphile_worker created first, applies with no error.
Proposed, the integrator's choice: run step 7 as the superuser, and drop the scratch database at the end. Or create app_migrate with CREATEROLE and CREATEDB, create the database with createdb -O app_migrate, and create the two extensions as the superuser first.
Why: step 7 is the migration proof for this wave, and it cannot pass as written.
Until then: step 7 is reported as failed, with the error text.
Resolved at the Wave 0 freeze, 26 Oct: app_migrate owns the database and holds CREATEROLE; 0001 grants it SET on app_definer; the migration proof in docs/contracts.md 6a.
