-- Correct DEF count from 1 to 2: formation is 1 GK, 2 DEF, 2 WIN, 1 MID, 1 STR (7-player)
UPDATE system_config
SET config_value = '{"GK": 1, "DEF": 2, "WIN": 2, "MID": 1, "STR": 1}'
WHERE config_key = 'formation_targets';
