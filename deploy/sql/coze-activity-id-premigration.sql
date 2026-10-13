-- MAINTENANCE ONLY: this changes the selected database; it is not a diagnostic.
-- Read ../DEBUGGING_COZE_DEPLOY_2026-10-13.md (or its .en.md counterpart) first.
-- Verify the target, take a restorable full backup, and STOP ALL OLD WRITERS.
-- Old application versions omit activity_id and cannot submit after this commits.
-- This prepares ONLY activity_id. The new application still performs its migration.
-- Execute the WHOLE file in one connection. On an error, ROLLBACK before retrying.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(741923);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS activity_id TEXT;
UPDATE public.submissions SET activity_id = kind WHERE activity_id IS NULL;
ALTER TABLE public.submissions ALTER COLUMN activity_id SET NOT NULL;
COMMIT;
