-- Goalkeeper per half tracked on the team result
ALTER TABLE match_results
  ADD COLUMN IF NOT EXISTS gk_first_half  UUID REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS gk_second_half UUID REFERENCES users(user_id);
