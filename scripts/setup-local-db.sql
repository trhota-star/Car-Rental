-- Creates the DriveEasy role and databases. Safe to run more than once.
-- Run via scripts/setup-local-db.ps1 (pnpm db:setup), which supplies :pw.

SELECT format('CREATE ROLE driveeasy LOGIN CREATEDB PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'driveeasy') \gexec
SELECT format('ALTER ROLE driveeasy PASSWORD %L', :'pw') \gexec

SELECT 'CREATE DATABASE driveeasy_dev OWNER driveeasy'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'driveeasy_dev') \gexec
SELECT 'CREATE DATABASE driveeasy_test OWNER driveeasy'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'driveeasy_test') \gexec

\c driveeasy_dev
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER SCHEMA public OWNER TO driveeasy;

\c driveeasy_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER SCHEMA public OWNER TO driveeasy;
