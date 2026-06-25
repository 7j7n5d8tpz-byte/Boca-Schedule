-- Retention for high-churn tables that are not bounded by team size alone.
--
-- notifications: read rows are worthless after a week; unread after a month
--   (if you haven't seen it in 30 days it's stale regardless).
-- spot_claims: resolved/rejected claims from past matches serve no purpose
--   after two weeks.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── notifications ────────────────────────────────────────────────────────────

SELECT cron.unschedule('prune-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-notifications');

-- Daily at 03:15 UTC (stagger with the audit-log job at 03:00).
SELECT cron.schedule(
  'prune-notifications',
  '15 3 * * *',
  $$
    DELETE FROM notifications
    WHERE (read_at IS NOT NULL AND created_at < now() - interval '7 days')
       OR created_at < now() - interval '30 days'
  $$
);

-- ── spot_claims ───────────────────────────────────────────────────────────────

SELECT cron.unschedule('prune-spot-claims')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-spot-claims');

-- Daily at 03:30 UTC.
SELECT cron.schedule(
  'prune-spot-claims',
  '30 3 * * *',
  $$
    DELETE FROM spot_claims
    WHERE status IN ('accepted', 'rejected', 'cancelled')
      AND created_at < now() - interval '14 days'
  $$
);
