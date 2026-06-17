-- Opponents as first-class entities.
--
-- Until now `matches.opponent` was free text, so the same club could be spelled
-- inconsistently across matches ("FC Vesterbro" vs "FC vesterbro"), making
-- reliable head-to-head analysis impossible. This introduces a normalized
-- `opponents` table and an `opponent_id` FK on matches.
--
-- `matches.opponent` (text) is kept as a denormalized display name, written in
-- sync with `opponent_id`, so the many read sites that already use it
-- (notification labels, /matches/upcoming, highlights, …) keep working untouched.

CREATE TABLE opponents (
  opponent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case/whitespace-insensitive uniqueness: "FC X", "fc x" and " FC X " collapse
-- to one opponent. The find-or-create path in the backend relies on this.
CREATE UNIQUE INDEX opponents_name_unique ON opponents (lower(trim(name)));

ALTER TABLE matches ADD COLUMN opponent_id UUID REFERENCES opponents(opponent_id) ON DELETE SET NULL;
CREATE INDEX idx_matches_opponent_id ON matches (opponent_id);

-- Backfill: create one opponent per distinct non-empty trimmed name, then point
-- each match at it (case-insensitive match so historical typos still group).
INSERT INTO opponents (name)
SELECT DISTINCT trim(opponent)
FROM matches
WHERE opponent IS NOT NULL AND trim(opponent) <> ''
ON CONFLICT (lower(trim(name))) DO NOTHING;

UPDATE matches m
SET opponent_id = o.opponent_id
FROM opponents o
WHERE m.opponent IS NOT NULL
  AND lower(trim(m.opponent)) = lower(trim(o.name));

-- RLS on (like every table); backend uses service_role which bypasses RLS but
-- still needs an explicit table GRANT — new tables don't inherit it.
ALTER TABLE opponents ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE opponents TO service_role;
