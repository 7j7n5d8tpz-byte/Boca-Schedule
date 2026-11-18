-- Web Push subscriptions: one row per device/browser a user has opted in on.
--
-- The frontend's service worker subscribes through the browser's push service
-- (Apple, Google, Mozilla) and hands the backend the endpoint plus the two
-- encryption keys. lib/push.ts sends to every row of a user whenever an in-app
-- notification is created, and deletes rows the push service reports as gone
-- (HTTP 404/410: the user revoked permission or uninstalled the app).
--
-- endpoint is unique: it identifies the device subscription itself, so a phone
-- that logs in as another player moves the row to that player instead of
-- pushing to both.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  subscription_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- RLS on for every table; backend uses service_role (bypasses RLS but needs an
-- explicit grant).
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE push_subscriptions TO service_role;
