-- Merge any two player accounts, not just a placeholder into a real one.
--
-- A player can end up with two real (loginable) accounts — e.g. they registered
-- again with a new e-mail. The admin needs to retire one account and keep all of
-- its history on the other. merge_placeholder_player only accepted a placeholder
-- source and only moved the tables a historical-import placeholder can touch; a
-- real account also has notifications, spot claims, result-edit requests and —
-- if it was a coach/admin — "actor" columns (created_by, selected_by, …).
--
-- merge_player(source, target) does the whole hand-over atomically. The source
-- becomes a tombstone exactly like a merged placeholder (merged_into set,
-- is_active = false), so every roster/stats read path already hides it, login is
-- refused for inactive accounts, and the backend rejects the tombstone's
-- existing sessions. merge_placeholder_player is kept as a thin wrapper so its
-- stricter "source must be a placeholder" contract still holds.

CREATE OR REPLACE FUNCTION public.merge_player(p_source uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  src public.users%ROWTYPE;
  tg  public.users%ROWTYPE;
BEGIN
  IF p_source = p_target THEN
    RAISE EXCEPTION 'Cannot merge a user into itself';
  END IF;

  SELECT * INTO src FROM public.users WHERE user_id = p_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source user not found'; END IF;
  IF src.merged_into IS NOT NULL THEN RAISE EXCEPTION 'Source user has already been merged'; END IF;

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
  WHERE s.player_id = p_source AND t.player_id = p_target AND t.match_id = s.match_id;
  DELETE FROM public.match_performance s
  WHERE s.player_id = p_source
    AND EXISTS (SELECT 1 FROM public.match_performance t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.match_performance SET player_id = p_target WHERE player_id = p_source;

  -- selections (UNIQUE (match_id, player_id)): drop dupes, re-point the rest.
  DELETE FROM public.selections s
  WHERE s.player_id = p_source
    AND EXISTS (SELECT 1 FROM public.selections t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.selections SET player_id = p_target WHERE player_id = p_source;

  -- signups: when both accounts signed up for the same match, an active sign-up
  -- beats a withdrawn one (two live accounts can disagree); otherwise keep the
  -- target's. Then re-point the rest.
  DELETE FROM public.signups t
  WHERE t.player_id = p_target AND t.withdrawn_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.signups s
                WHERE s.player_id = p_source AND s.match_id = t.match_id AND s.withdrawn_at IS NULL);
  DELETE FROM public.signups s
  WHERE s.player_id = p_source
    AND EXISTS (SELECT 1 FROM public.signups t WHERE t.player_id = p_target AND t.match_id = s.match_id);
  UPDATE public.signups SET player_id = p_target WHERE player_id = p_source;

  -- Open-spot claims (UNIQUE (match_id, claimant_id)): keep the target's.
  DELETE FROM public.spot_claims s
  WHERE s.claimant_id = p_source
    AND EXISTS (SELECT 1 FROM public.spot_claims t WHERE t.claimant_id = p_target AND t.match_id = s.match_id);
  UPDATE public.spot_claims SET claimant_id = p_target WHERE claimant_id = p_source;

  -- Goalkeeper halves on team results.
  UPDATE public.match_results SET gk_first_half  = p_target WHERE gk_first_half  = p_source;
  UPDATE public.match_results SET gk_second_half = p_target WHERE gk_second_half = p_source;

  -- Per-goal scorer/assister references inside the goal_events JSON array.
  UPDATE public.match_results m
  SET goal_events = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'scorerId',   CASE WHEN elem->>'scorerId'   = p_source::text THEN to_jsonb(p_target::text) ELSE elem->'scorerId'   END,
        'assisterId', CASE WHEN elem->>'assisterId' = p_source::text THEN to_jsonb(p_target::text) ELSE elem->'assisterId' END
      )
    )
    FROM jsonb_array_elements(m.goal_events) AS elem
  )
  WHERE m.goal_events IS NOT NULL
    AND m.goal_events::text LIKE '%' || p_source::text || '%';

  -- Fines ledger: move all of the source's fines to the target.
  UPDATE public.fines SET player_id = p_target WHERE player_id = p_source;

  -- Earned crests (UNIQUE (player_id, achievement_code, tier, season_year)).
  -- On a collision keep the target's row but pull `earned_at` back to whichever
  -- account reached that tier first. Reconciled exactly by the next recompute.
  UPDATE public.player_achievements t
  SET earned_at = LEAST(t.earned_at, s.earned_at)
  FROM public.player_achievements s
  WHERE s.player_id = p_source AND t.player_id = p_target
    AND t.achievement_code = s.achievement_code
    AND t.tier             = s.tier
    AND t.season_year      = s.season_year;
  DELETE FROM public.player_achievements s
  WHERE s.player_id = p_source
    AND EXISTS (SELECT 1 FROM public.player_achievements t
                WHERE t.player_id        = p_target
                  AND t.achievement_code = s.achievement_code
                  AND t.tier             = s.tier
                  AND t.season_year      = s.season_year);
  UPDATE public.player_achievements SET player_id = p_target WHERE player_id = p_source;

  -- Streak caches (UNIQUE (player_id, streak_type, season_year)): keep the
  -- target's current run, take the better season record.
  UPDATE public.player_streaks t
  SET record_count = GREATEST(t.record_count, s.record_count),
      updated_at   = NOW()
  FROM public.player_streaks s
  WHERE s.player_id = p_source AND t.player_id = p_target
    AND t.streak_type = s.streak_type
    AND t.season_year = s.season_year;
  DELETE FROM public.player_streaks s
  WHERE s.player_id = p_source
    AND EXISTS (SELECT 1 FROM public.player_streaks t
                WHERE t.player_id   = p_target
                  AND t.streak_type = s.streak_type
                  AND t.season_year = s.season_year);
  UPDATE public.player_streaks SET player_id = p_target WHERE player_id = p_source;

  -- Things only a real (loginable) account accumulates.
  UPDATE public.notifications         SET user_id   = p_target WHERE user_id   = p_source;
  UPDATE public.result_edit_requests  SET player_id = p_target WHERE player_id = p_source;

  -- "Who did it" columns. Same person, so re-point them; this also means the
  -- tombstone holds no ON DELETE RESTRICT / CASCADE references and could be
  -- deleted later without taking anything with it.
  UPDATE public.matches              SET created_by      = p_target WHERE created_by      = p_source;
  UPDATE public.selections           SET selected_by     = p_target WHERE selected_by     = p_source;
  UPDATE public.signups              SET priority_set_by = p_target WHERE priority_set_by = p_source;
  UPDATE public.match_performance    SET submitted_by    = p_target WHERE submitted_by    = p_source;
  UPDATE public.match_results        SET recorded_by     = p_target WHERE recorded_by     = p_source;
  UPDATE public.result_edit_requests SET resolved_by     = p_target WHERE resolved_by     = p_source;
  UPDATE public.announcements        SET created_by      = p_target WHERE created_by      = p_source;
  UPDATE public.guest_players        SET added_by        = p_target WHERE added_by        = p_source;
  UPDATE public.opponents            SET created_by      = p_target WHERE created_by      = p_source;
  UPDATE public.system_config        SET updated_by      = p_target WHERE updated_by      = p_source;
  UPDATE public.fines                SET issued_by       = p_target WHERE issued_by       = p_source;
  UPDATE public.fines                SET approved_by     = p_target WHERE approved_by     = p_source;
  UPDATE public.fines                SET confirmed_by    = p_target WHERE confirmed_by    = p_source;
  UPDATE public.fines                SET voided_by       = p_target WHERE voided_by       = p_source;
  UPDATE public.audit_log            SET user_id         = p_target WHERE user_id         = p_source;

  -- Profile: the target account wins, but it inherits whatever the source had
  -- that it lacks — permissions, the higher role, positions and avatar. A
  -- placeholder source has none of these set, so this is a no-op for it.
  UPDATE public.users SET
    role = CASE
             WHEN 'admin' IN (tg.role, src.role) THEN 'admin'
             WHEN 'coach' IN (tg.role, src.role) THEN 'coach'
             ELSE tg.role
           END,
    can_enter_results   = tg.can_enter_results OR src.can_enter_results,
    is_fine_admin       = tg.is_fine_admin OR src.is_fine_admin,
    preferred_positions = CASE WHEN COALESCE(array_length(tg.preferred_positions, 1), 0) = 0
                               THEN src.preferred_positions ELSE tg.preferred_positions END,
    avatar_url          = COALESCE(tg.avatar_url, src.avatar_url),
    updated_at          = NOW()
  WHERE user_id = p_target;

  -- Retire the source as a tombstone pointing at the surviving account.
  UPDATE public.users
  SET merged_into = p_target, is_active = false, updated_at = NOW()
  WHERE user_id = p_source;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_player(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_placeholder_player(p_placeholder uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_placeholder) THEN
    RAISE EXCEPTION 'Placeholder user not found';
  END IF;
  IF NOT (SELECT is_placeholder FROM public.users WHERE user_id = p_placeholder) THEN
    RAISE EXCEPTION 'Source user is not a placeholder';
  END IF;
  PERFORM public.merge_player(p_placeholder, p_target);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_placeholder_player(uuid, uuid) TO service_role;
