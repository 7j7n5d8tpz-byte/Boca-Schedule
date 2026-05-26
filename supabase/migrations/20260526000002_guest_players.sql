CREATE TABLE IF NOT EXISTS guest_players (
  guest_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
  position   TEXT CHECK (position IN ('GK', 'DEF', 'WIN', 'MID', 'STR')),
  added_by   UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
