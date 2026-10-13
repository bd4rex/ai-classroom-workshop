-- Read-only inspection. Select the intended project's PRODUCTION database first.
-- This returns counts and schema only, never student content or credentials.
SELECT
  COUNT(*) AS submissions_total,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) AS visible_submissions,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS removal_receipts,
  (SELECT string_agg(column_name || ':' || is_nullable, ', ' ORDER BY ordinal_position)
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'submissions') AS columns,
  (SELECT string_agg(pg_get_constraintdef(oid), ' | ' ORDER BY conname)
   FROM pg_constraint
   WHERE conrelid = 'public.submissions'::regclass) AS constraints
FROM public.submissions;
