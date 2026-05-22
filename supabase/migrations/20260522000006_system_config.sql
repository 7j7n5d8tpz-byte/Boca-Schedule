CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  description TEXT,
  updated_by  UUID        REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_config (key, value, description) VALUES
  ('max_players_per_match',      '18',      'Maximum players allowed per match'),
  ('signup_window_default_days', '7',       'Default days before match to open signups'),
  ('optimization_weights',       '{"fairness":1.0,"deficit":1.5,"position_coverage":1.0,"preferred_position":0.5}', 'Default optimization weights')
ON CONFLICT (key) DO NOTHING;
