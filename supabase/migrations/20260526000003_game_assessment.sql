-- Add game assessment label to match results
ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS game_assessment TEXT
    CHECK (game_assessment IN ('dominated', 'strong_performance', 'even_game', 'unlucky', 'tough_game', 'off_day'));
