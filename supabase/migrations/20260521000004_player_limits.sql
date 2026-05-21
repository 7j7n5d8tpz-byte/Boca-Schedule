-- Update default system config
UPDATE system_config SET config_value = '10' WHERE config_key = 'default_max_players';
UPDATE system_config SET config_value = '7'  WHERE config_key = 'default_min_players';

-- Update the 4 seeded matches
UPDATE matches SET max_players = 10, min_players = 7;
