-- In-app notification center. A row is written (alongside the existing email)
-- whenever something relevant happens to a user: selected, match cancelled or
-- moved, swap requested/answered, signup closing, new announcement, etc.
-- read_at NULL = unread (drives the nav bell badge).
--
-- ref_id is a free-form reference to the entity the notification is about when
-- it differs from match_id — e.g. the swap_request id, so the dropdown can
-- render inline Accept/Decline. No FK, since the referenced entity varies.
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  match_id   UUID REFERENCES matches(match_id) ON DELETE CASCADE,
  ref_id     UUID,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- RLS on for every table; backend uses service_role (bypasses RLS but needs an
-- explicit grant — new tables don't inherit it).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE notifications TO service_role;
