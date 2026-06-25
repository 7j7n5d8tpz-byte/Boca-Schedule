-- Adjust notification retention: read → 30 days, unread → 45 days.

SELECT cron.unschedule('prune-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-notifications');

SELECT cron.schedule(
  'prune-notifications',
  '15 3 * * *',
  $$
    DELETE FROM notifications
    WHERE (read_at IS NOT NULL AND created_at < now() - interval '30 days')
       OR created_at < now() - interval '45 days'
  $$
);
