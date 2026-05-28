-- Man-of-the-match flag on individual performances
ALTER TABLE match_performance ADD COLUMN IF NOT EXISTS man_of_match BOOLEAN NOT NULL DEFAULT false;

-- Long-read match report on team results
ALTER TABLE match_results ADD COLUMN IF NOT EXISTS long_read TEXT;
