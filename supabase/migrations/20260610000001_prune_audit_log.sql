-- Keep the database comfortably inside Supabase's free-tier 0.5 GB cap.
-- audit_log is the one table that grows with time/activity rather than with
-- team size, so age it out: a nightly pg_cron job deletes anything older than
-- 6 months. Everything else is bounded by players x matches and needs no prune.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: drop any prior copy of the job before re-creating it, so replaying
-- migrations (supabase db reset) doesn't stack duplicate schedules.
SELECT cron.unschedule('prune-audit-log')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-audit-log');

-- Daily at 03:00 UTC.
SELECT cron.schedule(
  'prune-audit-log',
  '0 3 * * *',
  $$DELETE FROM audit_log WHERE created_at < now() - interval '6 months'$$
);
