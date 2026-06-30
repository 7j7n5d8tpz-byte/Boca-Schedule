-- Gamification: per-player earned achievements (tiered crests) and streak caches.
--
-- The achievement CATALOG (names, tiers, thresholds, glyphs) lives in code as the
-- single source of truth (backend/src/lib/achievements.ts → ACHIEVEMENT_DEFS) and
-- is served directly by GET /api/achievements, so there is no catalog table to keep
-- in sync. These tables only record what each player has EARNED, per season.
--
-- Achievements are shared across the team by default (the club is inclusive) — these
-- rows are readable by any authenticated teammate via the backend. They never expose
-- the raw signup/selection counts, which stay private per the existing stats rule.

-- One row per (player, achievement code, tier) earned in a season.
-- `achievement_code` is a tier-group code from ACHIEVEMENT_DEFS (e.g. 'goals_scored').
-- `tier` is the 7-tier ladder rung. `progress` is the measured value at earn time.
CREATE TABLE player_achievements (
  player_achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  achievement_code TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN
                     ('bronze','silver','gold','platinum','diamond','champion','legend')),
  season_year      INTEGER NOT NULL,
  progress         INTEGER NOT NULL DEFAULT 0,
  earned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_player_achievement UNIQUE (player_id, achievement_code, tier, season_year)
);

CREATE INDEX idx_player_achievements_player ON player_achievements(player_id, season_year);
CREATE INDEX idx_player_achievements_season ON player_achievements(season_year);

-- Cached streak state per player / streak type / season. Recomputed idempotently
-- whenever a match result is recorded; `record_count` is the season's best run.
CREATE TABLE player_streaks (
  player_streak_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  streak_type        TEXT NOT NULL,
  season_year        INTEGER NOT NULL,
  current_count      INTEGER NOT NULL DEFAULT 0,
  current_start_date DATE,
  record_count       INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_player_streak UNIQUE (player_id, streak_type, season_year)
);

CREATE INDEX idx_player_streaks_player ON player_streaks(player_id, season_year);

-- RLS is on for all tables; the backend uses service_role which needs explicit
-- table GRANTs (see migration 20260602000001). ALTER DEFAULT PRIVILEGES from that
-- migration should cover these, but grant explicitly so a "permission denied"
-- regression can never reach prod (CLAUDE.md gotcha).
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_streaks       ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON player_achievements TO service_role;
GRANT ALL PRIVILEGES ON player_streaks       TO service_role;
