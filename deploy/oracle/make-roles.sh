#!/usr/bin/env bash
# Runs once, when the Postgres volume is new (docker-entrypoint-initdb.d). It makes the four roles migration 0001 expects and
# the database, owned by app_migrate as in a local rebuild (packages/db/src/fresh.ts), so the migrations run as they do on a
# laptop. app_migrate gets no CREATEROLE, since every role exists before 0001 runs, and keeps its app_definer membership,
# because the api migrates on every start (D71). psql reads the passwords with \getenv, so none sits on a command line.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv migrate_pw APP_MIGRATE_PASSWORD
\getenv api_pw APP_API_PASSWORD
\getenv worker_pw APP_WORKER_PASSWORD
CREATE ROLE app_migrate LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'migrate_pw';
CREATE ROLE app_api LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD :'api_pw';
CREATE ROLE app_worker LOGIN NOBYPASSRLS NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD :'worker_pw';
CREATE ROLE app_definer NOLOGIN NOBYPASSRLS NOINHERIT;
GRANT app_definer TO app_migrate WITH ADMIN OPTION, INHERIT FALSE, SET TRUE;
CREATE DATABASE meet_first OWNER app_migrate;
SQL
