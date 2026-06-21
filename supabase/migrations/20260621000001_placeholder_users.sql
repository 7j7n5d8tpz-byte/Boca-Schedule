-- Placeholder players for historical backfill.
--
-- Some players in the imported match history have not registered yet. We create
-- a `users` row for them so their goals/assists/cards/attendance count, but with
-- NO auth account (not loginable) and `is_active = false`. When the real person
-- later registers (a fresh auth user + user_id), an admin "merge" folds the
-- placeholder's history into the real account and stamps `merged_into`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT false;

-- Set once on merge: points a retired placeholder at the real account that
-- absorbed its history. Non-null ⇒ this row is a tombstone, hidden from rosters.
ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_placeholder ON users(is_placeholder) WHERE is_placeholder;
