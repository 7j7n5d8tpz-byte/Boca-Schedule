-- Per-user secret token for the personal calendar subscription feed
-- (GET /api/calendar/:token.ics). Calendar clients poll the feed with no
-- auth header, so the unguessable token in the URL is what authorizes it.
-- A volatile default backfills every existing row with a distinct UUID.
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);
