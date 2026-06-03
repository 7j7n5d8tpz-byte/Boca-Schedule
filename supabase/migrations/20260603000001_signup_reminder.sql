-- Track when a signup-deadline reminder was sent for a match, so the
-- reminder cron (POST /api/cron/signup-reminders) sends each match's
-- reminder exactly once. NULL = not yet reminded.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS signup_reminder_sent_at TIMESTAMPTZ;
