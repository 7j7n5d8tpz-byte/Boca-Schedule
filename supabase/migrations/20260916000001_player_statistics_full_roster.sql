-- Widen `player_statistics` to the same roster the statistics page uses.
--
-- The view was written with `WHERE u.role = 'player' AND u.is_active = true`,
-- which silently drops two kinds of people who nonetheless have match history:
--
--   * coaches and admins who also play (role <> 'player'), and
--   * placeholder users, who carry backfilled history but are `is_active = false`.
--
-- Everything reading the view falls back to `?? 0` on a missing row, so those
-- people showed up as "0 played / 0 signed up" on the manual squad picker
-- (GET /matches/:id/selections) and the coach sign-up list, while
-- GET /players/statistics/team — which computes from the base tables against
-- `role IN ('player','coach','admin')`, active OR placeholder, not merged —
-- showed their real numbers. Same person, two contradictory totals.
--
-- It is not only cosmetic: the view feeds `games_played` / `games_signedup`
-- into the squad optimizer's fairness term. A player stuck at 0/0 looks like
-- the most under-used person on the roster at every single run, so fairness
-- pushes them into the squad no matter how much they have actually played.
--
-- The roster filter below is the one from players.ts, so the two sources agree:
-- merged tombstones stay out (their history now belongs to the account they
-- were merged into), everyone else with history stays in.
--
-- Only the WHERE clause changes, so CREATE OR REPLACE applies in place — the
-- column list is identical and the service_role GRANT on the view is preserved.
CREATE OR REPLACE VIEW player_statistics AS
WITH perf AS (
    SELECT player_id,
        COUNT(*) FILTER (WHERE attended)  AS total_played,
        COALESCE(SUM(goals), 0)           AS total_goals,
        COALESCE(SUM(assists), 0)         AS total_assists,
        COALESCE(SUM(saves), 0)           AS total_saves,
        AVG(self_rating)                  AS avg_rating
    FROM match_performance
    GROUP BY player_id
),
sigs AS (
    SELECT player_id, COUNT(*) FILTER (WHERE is_active) AS total_signups
    FROM signups
    GROUP BY player_id
),
sels AS (
    SELECT player_id, COUNT(*) AS total_selected
    FROM selections
    GROUP BY player_id
)
SELECT
    u.user_id,
    u.name,
    u.preferred_positions,
    COALESCE(sigs.total_signups, 0)  AS total_signups,
    COALESCE(sels.total_selected, 0) AS total_selected,
    COALESCE(perf.total_played, 0)   AS total_played,
    COALESCE(perf.total_goals, 0)    AS total_goals,
    COALESCE(perf.total_assists, 0)  AS total_assists,
    COALESCE(perf.total_saves, 0)    AS total_saves,
    COALESCE(perf.avg_rating, 0)     AS avg_rating,
    ROUND(
        COALESCE(perf.total_played, 0)::numeric /
        NULLIF(COALESCE(sigs.total_signups, 0), 0)::numeric * 100,
        2
    ) AS attendance_rate
FROM users u
LEFT JOIN sigs ON u.user_id = sigs.player_id
LEFT JOIN sels ON u.user_id = sels.player_id
LEFT JOIN perf ON u.user_id = perf.player_id
WHERE u.role IN ('player', 'coach', 'admin')
  AND (u.is_active = true OR u.is_placeholder = true)
  AND u.merged_into IS NULL;
