-- Team fines box ("bødekasse"). Players get fined for infractions (late to a
-- match, daft red card, "må jeg låne noget tape?", …) and pay into a shared box.
--
-- Roles:
--   • is_fine_admin (one or two people) + app admins: approve fines, confirm
--     payments, issue fines anytime, issue custom-amount fines, edit fine types.
--   • can_enter_results users: may issue list fines on a match → pending_approval.
--
-- Lifecycle (status):
--   pending_approval ─approve→ approved ─claim→ payment_claimed ─confirm→ paid
--          │                      ▲  │                  │
--        reject               reject-claim          (admin mark-paid)
--          ▼                      │
--       rejected           (back to approved, player notified)
--   any approved+ ─void→ voided
--
-- Amounts are whole DKK. fines.amount_dkk is a SNAPSHOT taken at issue time, so
-- editing a fine type's price later never rewrites historical fines.

-- ─── Fine admins ──────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fine_admin BOOLEAN NOT NULL DEFAULT false;

-- ─── Fine catalogue (admin-editable) ──────────────────────────────────────────
CREATE TABLE fine_types (
  fine_type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT    NOT NULL,
  amount_dkk   INTEGER NOT NULL CHECK (amount_dkk >= 0),
  active       BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Fines ledger ─────────────────────────────────────────────────────────────
-- Decoupled from match_results (a replace-all upsert) so re-saving a result
-- never wipes fines, and fines carry their own approval/payment lifecycle.
CREATE TABLE fines (
  fine_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- fine type kept for reference/reporting; nullable for one-off custom fines.
  -- SET NULL (not CASCADE) so deleting a type doesn't erase money owed.
  fine_type_id   UUID REFERENCES fine_types(fine_type_id) ON DELETE SET NULL,
  amount_dkk     INTEGER NOT NULL CHECK (amount_dkk >= 0),  -- snapshot at issue
  reason         TEXT,  -- required (app-enforced) for custom and non-match fines
  -- non-match fine when null; SET NULL so deleting a match keeps the fine.
  match_id       UUID REFERENCES matches(match_id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending_approval'
                   CHECK (status IN ('pending_approval','approved','payment_claimed','paid','rejected','voided')),
  issued_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  approved_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  paid_claimed_at TIMESTAMPTZ,
  confirmed_by   UUID REFERENCES users(user_id) ON DELETE SET NULL,
  confirmed_at   TIMESTAMPTZ,
  voided_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
  voided_at      TIMESTAMPTZ,
  void_reason    TEXT,
  disputed       BOOLEAN NOT NULL DEFAULT false,
  dispute_note   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fines_player ON fines(player_id, created_at DESC);
CREATE INDEX idx_fines_status ON fines(status);
CREATE INDEX idx_fines_match  ON fines(match_id);

-- ─── Payment rail ─────────────────────────────────────────────────────────────
-- MobilePay box shown at the "pay" action; editable by fine admins in-app.
INSERT INTO system_config (config_key, config_value, description) VALUES
  ('fines_payment_info', '"2203EK"', 'MobilePay box / payment instructions for fines')
ON CONFLICT (config_key) DO NOTHING;

-- ─── Seed fine catalogue (amounts in DKK) ─────────────────────────────────────
INSERT INTO fine_types (label, amount_dkk, sort_order) VALUES
  ('0-15 min forsinket til kamp',            18,  10),
  ('15+ min forsinket til kamp',             35,  20),
  ('Brok over tildelt bøde',                 25,  30),
  ('Brug af skohorn',                        10,  40),
  ('Drik Fyns forår',                        45,  50),
  ('Dumt gult kort',                         50,  60),
  ('Dumt rødt kort',                        100,  70),
  ('Forlad kamp før tid',                   100,  80),
  ('Forsinket eventstafet',                  50,  90),
  ('Glemt udstyr',                           50, 100),
  ('Ikke medlem af bødekasse',               25, 110),
  ('Krænkelse af spillersæt',                30, 120),
  ('Manglende afbud kamp',                  200, 130),
  ('Manglende solcreme',                     10, 140),
  ('Meld fra til kamp <24 timer før kamp',  100, 150),
  ('Skip køen på spoti',                     20, 160),
  ('Snakke dårligt om boca Boldisch',        50, 170),
  ('"Må jeg låne noget tape?"',              10, 180);

-- RLS on for every table; backend uses service_role (bypasses RLS but needs an
-- explicit grant — new tables don't inherit it).
ALTER TABLE fine_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE fines      ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE fine_types TO service_role;
GRANT ALL PRIVILEGES ON TABLE fines      TO service_role;
