-- Team-level match outcome (goals for/against)
CREATE TABLE match_results (
  result_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID UNIQUE NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  goals_for     INTEGER NOT NULL DEFAULT 0 CHECK (goals_for >= 0),
  goals_against INTEGER NOT NULL DEFAULT 0 CHECK (goals_against >= 0),
  recorded_by   UUID NOT NULL REFERENCES users(user_id),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_results_match ON match_results(match_id);

-- Allow specific players to enter/edit match results
ALTER TABLE users ADD COLUMN can_enter_results BOOLEAN NOT NULL DEFAULT false;

-- Permission request from a player to enter results
CREATE TABLE result_edit_requests (
  request_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES users(user_id),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES users(user_id)
);

CREATE INDEX idx_result_edit_requests_player ON result_edit_requests(player_id);
CREATE INDEX idx_result_edit_requests_pending ON result_edit_requests(status) WHERE status = 'pending';
