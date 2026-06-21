-- Merge a placeholder player into a real account.
--
-- When a historical-import placeholder's real person registers, an admin merges
-- the placeholder into the new account: all of the placeholder's history moves
-- across, and the placeholder becomes a tombstone (merged_into set, hidden from
-- every roster/stats read path). Done in one function so it's atomic.
--
-- Collisions (target already has a row for the same match) are handled: match
-- performance is summed, duplicate signups/selections are dropped.

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

  -- Retire the placeholder as a tombstone pointing at the real account.
  UPDATE public.users
  SET merged_into = p_target, is_active = false, updated_at = NOW()
  WHERE user_id = p_placeholder;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_placeholder_player(uuid, uuid) TO service_role;
