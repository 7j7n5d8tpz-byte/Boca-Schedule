-- Open-spot claims replace the player-to-player swap flow.
--
-- When a selected player releases their spot, every player not currently
-- selected for that match is notified that a spot opened up. Any of them can
-- *claim* the spot; the claim goes to the coach/admin, who confirms one
-- claimant (even when there is only one). Accepting a claim adds that player to
-- the squad and rejects any other pending claims for the same match.
--
-- An "open spot" is simply: a published match where the number of selections is
-- below max_players.
CREATE TABLE spot_claims (
  claim_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    UUID NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  claimant_id UUID NOT NULL CONSTRAINT spot_claims_claimant_id_fkey REFERENCES users(user_id),
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  -- one live claim per player per match (resolved rows are re-usable via the
  -- partial unique index below, but a single row reset to pending also works)
  CONSTRAINT spot_claims_one_per_player UNIQUE (match_id, claimant_id)
);

CREATE INDEX idx_spot_claims_match     ON spot_claims(match_id);
CREATE INDEX idx_spot_claims_claimant  ON spot_claims(claimant_id);
CREATE INDEX idx_spot_claims_pending   ON spot_claims(match_id) WHERE status = 'pending';

-- RLS on for every table; backend uses service_role (bypasses RLS but needs an
-- explicit grant — new tables don't inherit it).
ALTER TABLE spot_claims ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE spot_claims TO service_role;

-- The swap flow is fully replaced by open-spot claims.
DROP TABLE IF EXISTS swap_requests;
