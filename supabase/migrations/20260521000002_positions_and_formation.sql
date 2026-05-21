-- Update positions: replace FWD with WIN (Winger) and STR (Striker)
UPDATE system_config
SET config_value = '["GK", "DEF", "WIN", "MID", "STR"]',
    description  = 'Available field positions: Goalkeeper, Defensive, Winger, Midfielder, Striker'
WHERE config_key = 'positions';

-- Formation targets: minimum players per position for the position coverage reward.
-- 7-player formation: 1 GK, 2 DEF, 2 WIN, 1 MID, 1 STR.
INSERT INTO system_config (config_key, config_value, description) VALUES
(
  'formation_targets',
  '{"GK": 1, "DEF": 2, "WIN": 2, "MID": 1, "STR": 1}',
  'Minimum players per position required to earn the position-coverage reward in the optimization model'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      description  = EXCLUDED.description;
