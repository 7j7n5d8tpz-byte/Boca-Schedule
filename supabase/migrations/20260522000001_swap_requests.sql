CREATE TABLE swap_requests (
  swap_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  requester_id  UUID NOT NULL CONSTRAINT swap_requests_requester_id_fkey REFERENCES users(user_id),
  target_id     UUID NOT NULL CONSTRAINT swap_requests_target_id_fkey    REFERENCES users(user_id),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  CONSTRAINT no_self_swap CHECK (requester_id <> target_id)
);

CREATE INDEX idx_swap_requests_match      ON swap_requests(match_id);
CREATE INDEX idx_swap_requests_requester  ON swap_requests(requester_id);
CREATE INDEX idx_swap_requests_target     ON swap_requests(target_id);
CREATE INDEX idx_swap_requests_pending    ON swap_requests(target_id) WHERE status = 'pending';
