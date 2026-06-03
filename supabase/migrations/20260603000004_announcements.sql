-- Coach-authored announcements shown to players on their dashboard.
-- An announcement may optionally be tied to a match; if so it auto-hides once
-- that match's date has passed (filtered in the API). Match-less announcements
-- persist until a coach removes them.
CREATE TABLE IF NOT EXISTS announcements (
  announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body            TEXT NOT NULL,
  match_id        UUID REFERENCES matches(match_id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);

-- RLS is on for every table; the backend uses service_role (which bypasses RLS
-- but still needs an explicit table GRANT — new tables don't inherit it).
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE announcements TO service_role;
