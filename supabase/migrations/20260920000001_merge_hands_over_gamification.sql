-- merge_placeholder_player left the gamification tables behind.
--
-- Every other table a placeholder touches (match_performance, selections,
-- signups, match_results, fines) is folded into the target account by the merge
-- function, but `player_achievements` and `player_streaks` were never handled.
-- The placeholder's crests therefore stayed pinned to the tombstone, and the
-- team wall (GET /api/players/achievements/team-wall) reads those rows joined
-- straight to `users` — so a merged-away placeholder kept rendering as its own
-- player on the Achievements page, a ghost teammate findable nowhere else
-- (e.g. "Emil Aagaard Madsen", merged into "Emil Aagard Madsen").
--
-- Two parts: teach the merge function to hand the rows over, then repair the
-- tombstones that were merged before it did.

CREATE OR REPLACE FUNCTION public.merge_placeholder_player(p_placeholder uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  ph public.users%ROWTYPE;
  tg public.users%ROWTYPE;
BEGIN
  IF p_placeholder = p_target THEN
    RAISE EXCEPTION 'Cannot merge a user into itself';
  END IF;

  SELECT * INTO ph FROM public.users WHERE user_id = p_placeholder;
  IF NOT FOUND THEN RAISE EXCEPTION 'Placeholder user not found'; END IF;
  IF NOT ph.is_placeholder THEN RAISE EXCEPTION 'Source user is not a placeholder'; END IF;
  IF ph.merged_into IS NOT NULL THEN RAISE EXCEPTION 'Placeholder has already been merged'; END IF;

  SELECT * INTO tg FROM public.users WHERE user_id = p_target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target user not found'; END IF;
  IF tg.is_placeholder THEN RAISE EXCEPTION 'Target user is itself a placeholder'; END IF;
  IF tg.merged_into IS NOT NULL THEN RAISE EXCEPTION 'Target user has already been merged into another account'; END IF;

  -- match_performance: fold colliding rows into the target by summing, then
  -- re-point the rest. (UNIQUE (match_id, player_id).)
  UPDATE public.match_performance t SET
    attended     = t.attended OR s.attended,
    goals        = t.goals + s.goals,
    assists      = t.assists + s.assists,
    saves        = COALESCE(t.saves, 0) + COALESCE(s.saves, 0),
    clean_sheet  = t.clean_sheet OR s.clean_sheet,
    yellow_cards = t.yellow_cards + s.yellow_cards,
    red_cards    = t.red_cards + s.red_cards,
    man_of_match = t.man_of_match OR s.man_of_match
  FROM public.match_performance s
  WHERE s.player_id = p_placeholder AND t.player_id = p_target AND t.match_id = s.match_id;
  DELETE FROM public.match_performance s
  WHERE s.player_id = p_placeholder
    AND EXISTS (SELECT 1 FROM public.match_performance t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.match_performance SET player_id = p_target WHERE player_id = p_placeholder;

  -- selections (UNIQUE (match_id, player_id)): drop dupes, re-point the rest.
  DELETE FROM public.selections s
  WHERE s.player_id = p_placeholder
    AND EXISTS (SELECT 1 FROM public.selections t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.selections SET player_id = p_target WHERE player_id = p_placeholder;

  -- signups: drop same-match dupes, re-point the rest.
  DELETE FROM public.signups s
  WHERE s.player_id = p_placeholder
    AND EXISTS (SELECT 1 FROM public.signups t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.signups SET player_id = p_target WHERE player_id = p_placeholder;

  -- Goalkeeper halves on team results.
  UPDATE public.match_results SET gk_first_half  = p_target WHERE gk_first_half  = p_placeholder;
  UPDATE public.match_results SET gk_second_half = p_target WHERE gk_second_half = p_placeholder;

  -- Per-goal scorer/assister references inside the goal_events JSON array.
  UPDATE public.match_results m
  SET goal_events = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'scorerId',   CASE WHEN elem->>'scorerId'   = p_placeholder::text THEN to_jsonb(p_target::text) ELSE elem->'scorerId'   END,
        'assisterId', CASE WHEN elem->>'assisterId' = p_placeholder::text THEN to_jsonb(p_target::text) ELSE elem->'assisterId' END
      )
    )
    FROM jsonb_array_elements(m.goal_events) AS elem
  )
  WHERE m.goal_events IS NOT NULL
    AND m.goal_events::text LIKE '%' || p_placeholder::text || '%';

  -- Fines ledger: move all of the placeholder's fines to the real account.
  UPDATE public.fines SET player_id = p_target WHERE player_id = p_placeholder;

  -- Earned crests (UNIQUE (player_id, achievement_code, tier, season_year)).
  -- On a collision keep the target's row — its `progress` already counts the
  -- history being merged in — but pull `earned_at` back to whichever account
  -- reached that tier first, so the crest keeps its real date. Re-point the
  -- rest. Values are reconciled exactly by the next recompute; this only makes
  -- sure nothing is stranded on the tombstone in the meantime.
  UPDATE public.player_achievements t
  SET earned_at = LEAST(t.earned_at, s.earned_at)
  FROM public.player_achievements s
  WHERE s.player_id = p_placeholder AND t.player_id = p_target
    AND t.achievement_code = s.achievement_code
    AND t.tier             = s.tier
    AND t.season_year      = s.season_year;
  DELETE FROM public.player_achievements s
  WHERE s.player_id = p_placeholder
    AND EXISTS (SELECT 1 FROM public.player_achievements t
                WHERE t.player_id        = p_target
                  AND t.achievement_code = s.achievement_code
                  AND t.tier             = s.tier
                  AND t.season_year      = s.season_year);
  UPDATE public.player_achievements SET player_id = p_target WHERE player_id = p_placeholder;

  -- Streak caches (UNIQUE (player_id, streak_type, season_year)). The current
  -- run belongs to the target's own timeline, so keep it; the season record is
  -- the better of the two. Recomputed exactly on the next result entry.
  UPDATE public.player_streaks t
  SET record_count = GREATEST(t.record_count, s.record_count),
      updated_at   = NOW()
  FROM public.player_streaks s
  WHERE s.player_id = p_placeholder AND t.player_id = p_target
    AND t.streak_type = s.streak_type
    AND t.season_year = s.season_year;
  DELETE FROM public.player_streaks s
  WHERE s.player_id = p_placeholder
    AND EXISTS (SELECT 1 FROM public.player_streaks t
                WHERE t.player_id   = p_target
                  AND t.streak_type = s.streak_type
                  AND t.season_year = s.season_year);
  UPDATE public.player_streaks SET player_id = p_target WHERE player_id = p_placeholder;

  -- Retire the placeholder as a tombstone pointing at the real account.
  UPDATE public.users
  SET merged_into = p_target, is_active = false, updated_at = NOW()
  WHERE user_id = p_placeholder;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_placeholder_player(uuid, uuid) TO service_role;

-- Repair the tombstones merged before the above existed: same hand-over, applied
-- to whatever gamification rows are still stranded. `merged_into` never chains
-- (the merge guard rejects an already-merged target), so one pass is enough.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT user_id AS ph, merged_into AS tg FROM public.users WHERE merged_into IS NOT NULL LOOP
    UPDATE public.player_achievements t
    SET earned_at = LEAST(t.earned_at, s.earned_at)
    FROM public.player_achievements s
    WHERE s.player_id = r.ph AND t.player_id = r.tg
      AND t.achievement_code = s.achievement_code
      AND t.tier             = s.tier
      AND t.season_year      = s.season_year;
    DELETE FROM public.player_achievements s
    WHERE s.player_id = r.ph
      AND EXISTS (SELECT 1 FROM public.player_achievements t
                  WHERE t.player_id        = r.tg
                    AND t.achievement_code = s.achievement_code
                    AND t.tier             = s.tier
                    AND t.season_year      = s.season_year);
    UPDATE public.player_achievements SET player_id = r.tg WHERE player_id = r.ph;

    UPDATE public.player_streaks t
    SET record_count = GREATEST(t.record_count, s.record_count),
        updated_at   = NOW()
    FROM public.player_streaks s
    WHERE s.player_id = r.ph AND t.player_id = r.tg
      AND t.streak_type = s.streak_type
      AND t.season_year = s.season_year;
    DELETE FROM public.player_streaks s
    WHERE s.player_id = r.ph
      AND EXISTS (SELECT 1 FROM public.player_streaks t
                  WHERE t.player_id   = r.tg
                    AND t.streak_type = s.streak_type
                    AND t.season_year = s.season_year);
    UPDATE public.player_streaks SET player_id = r.tg WHERE player_id = r.ph;
  END LOOP;
END $$;
