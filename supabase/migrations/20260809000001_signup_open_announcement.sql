-- "Sign-ups are open" announcements.
--
-- When a match's sign-up window opens, every active player gets an in-app
-- notification straight away and a grouped email shortly after. Two one-shot
-- stamps keep both idempotent:
--   signup_open_notified_at — the in-app notification went out. Doubles as the
--     "sign-ups opened at" instant, which the email batcher groups on.
--   signup_open_emailed_at  — the match has been covered by a grouped email
--     (or is moot: cancelled, or its deadline passed before we got to it).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS signup_open_notified_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS signup_open_emailed_at  TIMESTAMPTZ;

-- Every match that exists right now predates the feature, so stamp them all as
-- already announced. Without this the first cron run would mail the club the
-- entire back-catalogue of open matches.
UPDATE matches
   SET signup_open_notified_at = COALESCE(signup_open_notified_at, now()),
       signup_open_emailed_at  = COALESCE(signup_open_emailed_at,  now())
 WHERE signup_open_notified_at IS NULL
    OR signup_open_emailed_at  IS NULL;

-- The batcher only ever scans for un-emailed matches — a partial index keeps
-- that scan cheap as the match table grows season over season.
CREATE INDEX IF NOT EXISTS idx_matches_signup_open_pending
  ON matches (signup_open_notified_at)
  WHERE signup_open_emailed_at IS NULL;

INSERT INTO system_config (config_key, config_value, description) VALUES
  ('signup_open_quiet_minutes',
   '20',
   'Hold the grouped "sign-ups open" email until the newest match has been open this long, so a burst of matches becomes one email'),
  ('signup_open_max_defer_hours',
   '3',
   'Send the grouped "sign-ups open" email regardless once the longest-waiting match has been open this long')
ON CONFLICT (config_key) DO NOTHING;
