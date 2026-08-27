-- Who called a cancelled match off. A cancelled match with a side recorded is a
-- walkover: the club wins 3-0 when the opponent cancels, loses 0-3 when we do.
-- NULL means "cancelled, no walkover" (weather, postponed, mutually called off),
-- which is also the state every already-cancelled match keeps.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_cancelled_by_check;
ALTER TABLE matches ADD CONSTRAINT matches_cancelled_by_check CHECK (
  cancelled_by IS NULL OR (cancelled_by IN ('us', 'opponent') AND status = 'cancelled')
);
