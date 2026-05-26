-- Store per-goal scorer/assister pairings so edits can round-trip correctly
ALTER TABLE match_results ADD COLUMN IF NOT EXISTS goal_events JSONB;
