-- One-shot stamps so each daily reminder (sent by /api/cron/daily-reminders at
-- 18:00 Europe/Copenhagen) fires at most once per match.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS matchday_reminder_sent_at  TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS selection_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS result_reminder_sent_at    TIMESTAMPTZ;
