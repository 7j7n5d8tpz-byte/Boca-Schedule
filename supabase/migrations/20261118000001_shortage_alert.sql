-- "Vi mangler DIG på banen!" — the short-handed match alert.
--
-- POST /api/cron/shortage-alerts emails the club when a match that is still
-- open for sign-up has fewer active sign-ups than min_players and its sign-up
-- deadline is close. This stamp makes each match trigger that alert once.
-- NULL = not yet alerted.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS shortage_alert_sent_at TIMESTAMPTZ;

-- How many hours before the sign-up deadline a short-handed match triggers the
-- alert. The alert is sent at 18:00 club time, so 48 means "the evening one or
-- two days before sign-ups close".
INSERT INTO system_config (config_key, config_value, description) VALUES
  ('shortage_alert_hours',
   '48',
   'Email "Vi mangler DIG på banen!" when a match is below min_players this many hours before its sign-up deadline')
ON CONFLICT (config_key) DO NOTHING;
