-- "Vi mangler DIG på banen!": the short-handed match alert.
--
-- POST /api/cron/shortage-alerts emails the club when a match that is still
-- open for sign-up has fewer active sign-ups than min_players and kicks off
-- within the next week. This stamp makes each match trigger that alert once.
-- NULL = not yet alerted.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS shortage_alert_sent_at TIMESTAMPTZ;

-- POST /api/cron/coach-shortage-alerts warns coaches once sign-ups have closed
-- on a match that is still below min_players. Same once-per-match stamp.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS coach_shortage_alert_sent_at TIMESTAMPTZ;

INSERT INTO system_config (config_key, config_value, description) VALUES
  ('shortage_alert_days',
   '7',
   'Email "Vi mangler DIG på banen!" when a match is below min_players this many days before kick-off')
ON CONFLICT (config_key) DO NOTHING;
