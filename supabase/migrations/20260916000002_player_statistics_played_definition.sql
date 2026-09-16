-- Align `player_statistics.total_played` with the shared "played a match"
-- definition in backend/src/lib/participation.ts.
--
-- The previous migration fixed *who* appears in the view. This one fixes *how
-- one of its numbers is counted*, closing the second way the view could
-- contradict the statistics page.
--
-- The view counted `match_performance` rows with `attended` set, and did not
-- look at match status at all. playedMatch() — used by GET /players/statistics/team
-- and the achievements builder — says something different: within a COMPLETED
-- match, an explicit attendance flag wins, and where no flag was recorded,
-- being named to the squad counts as having played. So the two disagree whenever
--
--   * a completed match's result was recorded without per-player performance
--     rows: selected players played, but the view counted nobody;
--   * a walk-on was marked present without having been selected: the statistics
--     page counts them, and so should the view;
--   * a performance row carries `attended` on a match that is not completed:
--     the view counted it early.
--
-- None of those hold in production today, which is why the totals currently
-- agree — this is a latent divergence, not a live one. It is worth closing
-- anyway, because the view feeds the optimizer's fairness term: the first case
-- would zero out an entire squad's match history at once, making every player
-- in it look maximally under-used on the next run.
--
-- Goals, assists, saves and ratings keep counting every performance row
-- regardless of match status, matching how the statistics route aggregates them.
-- Only `total_played` (and `attendance_rate`, which derives from it) changes.
--
-- Column list is unchanged, so CREATE OR REPLACE applies in place and the
-- service_role GRANT persists.
CREATE OR REPLACE VIEW player_statistics AS
WITH perf AS (
    SELECT player_id,
        COALESCE(SUM(goals), 0)           AS total_goals,
        COALESCE(SUM(assists), 0)         AS total_assists,
        COALESCE(SUM(saves), 0)           AS total_saves,
        AVG(self_rating)                  AS avg_rating
    FROM match_performance
    GROUP BY player_id
),
-- One row per (player, completed match) they featured in — the SQL twin of
-- playedMatch(). The UNION dedupes a player who was both selected and has an
-- attended performance row for the same match, so they count once.
played AS (
    SELECT player_id, COUNT(*) AS total_played
    FROM (
        -- Selected, and not explicitly marked absent.
        SELECT s.player_id, s.match_id
        FROM selections s
        JOIN matches m ON m.match_id = s.match_id AND m.status = 'completed'
        LEFT JOIN match_performance mp
               ON mp.match_id = s.match_id AND mp.player_id = s.player_id
        WHERE COALESCE(mp.attended, true)
        UNION
        -- Marked present, whether or not they were ever named to the squad.
        SELECT mp.player_id, mp.match_id
        FROM match_performance mp
        JOIN matches m ON m.match_id = mp.match_id AND m.status = 'completed'
        WHERE mp.attended
    ) appearances
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
    COALESCE(played.total_played, 0) AS total_played,
    COALESCE(perf.total_goals, 0)    AS total_goals,
    COALESCE(perf.total_assists, 0)  AS total_assists,
    COALESCE(perf.total_saves, 0)    AS total_saves,
    COALESCE(perf.avg_rating, 0)     AS avg_rating,
    ROUND(
        COALESCE(played.total_played, 0)::numeric /
        NULLIF(COALESCE(sigs.total_signups, 0), 0)::numeric * 100,
        2
    ) AS attendance_rate
FROM users u
LEFT JOIN sigs   ON u.user_id = sigs.player_id
LEFT JOIN sels   ON u.user_id = sels.player_id
LEFT JOIN perf   ON u.user_id = perf.player_id
LEFT JOIN played ON u.user_id = played.player_id
WHERE u.role IN ('player', 'coach', 'admin')
  AND (u.is_active = true OR u.is_placeholder = true)
  AND u.merged_into IS NULL;
