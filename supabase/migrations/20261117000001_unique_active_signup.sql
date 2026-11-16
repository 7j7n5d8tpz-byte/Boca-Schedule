-- One active sign-up per player per match.
--
-- POST /api/signups checks for an existing active sign-up and then inserts, with
-- nothing in the database to back the check up. Two requests arriving together
-- (a double tap on a slow connection) both pass it, and the player ends up
-- signed up twice: counted twice against the squad size, and handed to the
-- optimizer twice — which then fails on UNIQUE (match_id, player_id) when it
-- writes the squad, after the old squad has already been deleted.
--
-- Withdrawn rows are left out of the index on purpose: withdrawing and signing
-- up again is normal and leaves one withdrawn row per round trip.

-- Clear any duplicates first, or the index cannot be built. Keeps one row per
-- (match, player): a priority-flagged one if there is one, otherwise the
-- earliest. The rows removed are exact repeats of the one kept.
DELETE FROM signups s
USING (
    SELECT signup_id,
           ROW_NUMBER() OVER (
               PARTITION BY match_id, player_id
               ORDER BY is_priority DESC NULLS LAST, signed_up_at, signup_id
           ) AS rn
    FROM signups
    WHERE withdrawn_at IS NULL
) ranked
WHERE s.signup_id = ranked.signup_id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_one_active
    ON signups (match_id, player_id)
    WHERE withdrawn_at IS NULL;
