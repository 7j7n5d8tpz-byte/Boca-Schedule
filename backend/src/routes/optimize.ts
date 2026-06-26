import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { optimizeMatch } from '../lib/optimizer.js';
import { sendSelectionNotifications, sendDeselectionNotifications } from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';

const router = Router({ mergeParams: true });

// Human-readable match label for notification copy, e.g. "Sat 7 Jun vs FC X".
function matchLabel(m: { match_date: string; match_time?: string; opponent?: string | null }): string {
  const d = new Date(`${m.match_date}T${m.match_time ?? '00:00'}`);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return m.opponent ? `${date} vs ${m.opponent}` : date;
}

// Fire-and-forget: notify players added to / removed from an already-published
// squad after a manual coach swap. Mirrors the publish/cancellation pattern.
function notifyPublishedSquadChange(
  match: { match_date: string; match_time: string; location: string; opponent: string | null },
  addedIds: string[],
  removedIds: string[],
  matchId: string,
) {
  if (addedIds.length === 0 && removedIds.length === 0) return;
  const matchInfo = { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null };
  const label = matchLabel(match);

  supabaseAdmin
    .from('users')
    .select('user_id, name, email')
    .in('user_id', [...addedIds, ...removedIds])
    .then(({ data: users }) => {
      const byId = new Map((users ?? []).map((u: any) => [u.user_id, u]));

      if (addedIds.length > 0) {
        const added = addedIds.map(id => byId.get(id)).filter(Boolean);
        const withEmail = added.filter((u: any) => u.email);
        if (withEmail.length > 0) {
          sendSelectionNotifications(withEmail.map((u: any) => ({ name: u.name, email: u.email })), matchInfo)
            .catch(err => console.error('Failed to send selection notifications:', err));
        }
        createNotifications(added.map((u: any) => u.user_id), {
          type: 'selected', title: "You're selected", body: label, link: '/dashboard', matchId,
        });
      }

      if (removedIds.length > 0) {
        const removed = removedIds.map(id => byId.get(id)).filter(Boolean);
        const withEmail = removed.filter((u: any) => u.email);
        if (withEmail.length > 0) {
          sendDeselectionNotifications(withEmail.map((u: any) => ({ name: u.name, email: u.email })), matchInfo)
            .catch(err => console.error('Failed to send deselection notifications:', err));
        }
        createNotifications(removed.map((u: any) => u.user_id), {
          type: 'deselected', title: 'Removed from squad', body: label, link: '/dashboard', matchId,
        });
      }
    });
}

// GET /api/matches/:matchId/selections
// Accessible to coach/admin OR players with can_enter_results (for result entry page)
router.get('/selections', authenticate, async (req, res, next) => {
  try {
    const { role, userId } = req.user!;
    if (role !== 'coach' && role !== 'admin') {
      const { data: userRow } = await supabaseAdmin.from('users').select('can_enter_results').eq('user_id', userId).single();
      if (!userRow?.can_enter_results) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
        return;
      }
    }

    const { matchId } = req.params;

    // Full candidate roster so the Edit picker can offer players who did NOT sign
    // up (real people only — placeholders and merged tombstones aren't selectable).
    const [{ data: match }, { data: signups }, { data: selections }, { data: roster }] = await Promise.all([
      supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single(),
      supabaseAdmin
        .from('signups')
        .select('player_id, is_priority, users!signups_player_id_fkey(user_id, name, preferred_positions)')
        .eq('match_id', matchId)
        .eq('is_active', true),
      supabaseAdmin
        .from('selections')
        .select('player_id, selected_by_optimization, manually_adjusted, is_priority_selection, optimization_score')
        .eq('match_id', matchId),
      supabaseAdmin
        .from('users')
        .select('user_id, name, preferred_positions')
        .eq('is_active', true)
        .eq('is_placeholder', false)
        .is('merged_into', null),
    ]);

    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    const signedUpIds = new Set((signups ?? []).map((s: any) => s.player_id));
    const priorityMap = new Map((signups ?? []).map((s: any) => [s.player_id, s.is_priority ?? false]));
    const selectedIds = new Set((selections ?? []).map((s: any) => s.player_id));
    const selectionDetails = new Map((selections ?? []).map((s: any) => [s.player_id, s]));

    // Candidate set = active roster ∪ everyone signed up ∪ everyone selected, so a
    // signed-up placeholder or an already-selected player is never dropped.
    const userMap = new Map<string, { user_id: string; name: string; preferred_positions: string[] }>();
    for (const u of (roster ?? []) as any[]) userMap.set(u.user_id, u);
    for (const s of (signups ?? []) as any[]) if (s.users) userMap.set(s.users.user_id, s.users);
    const missingIds = [...selectedIds].filter(id => !userMap.has(id));
    if (missingIds.length > 0) {
      const { data: extra } = await supabaseAdmin
        .from('users').select('user_id, name, preferred_positions').in('user_id', missingIds);
      for (const u of (extra ?? [])) userMap.set(u.user_id, u);
    }

    const allIds = [...userMap.keys()];
    const { data: statsData } = allIds.length > 0
      ? await supabaseAdmin.from('player_statistics').select('user_id, total_played, total_signups').in('user_id', allIds)
      : { data: [] };
    const statsMap = new Map((statsData ?? []).map((s: any) => [s.user_id, s]));

    const players = [...userMap.values()].map((u: any) => ({
      player: {
        userId: u.user_id,
        name: u.name,
        preferredPositions: u.preferred_positions ?? [],
        totalPlayed: Number(statsMap.get(u.user_id)?.total_played ?? 0),
        totalSignups: Number(statsMap.get(u.user_id)?.total_signups ?? 0),
      },
      isSignedUp: signedUpIds.has(u.user_id),
      isPriority: priorityMap.get(u.user_id) ?? false,
      isSelected: selectedIds.has(u.user_id),
      selectedByOptimization: selectionDetails.get(u.user_id)?.selected_by_optimization ?? false,
      manuallyAdjusted: selectionDetails.get(u.user_id)?.manually_adjusted ?? false,
      optimizationScore: selectionDetails.get(u.user_id)?.optimization_score ?? null,
    })).sort((a, b) => a.player.name.localeCompare(b.player.name));

    res.json({
      success: true,
      data: {
        match: {
          matchId: match.match_id,
          matchDate: match.match_date,
          matchTime: match.match_time,
          matchType: match.match_type,
          location: match.location,
          opponent: match.opponent ?? null,
          opponentId: match.opponent_id ?? null,
          matchCategory: match.match_category ?? 'serie',
          serieLetter: match.serie_letter ?? null,
          status: match.status,
          minPlayers: match.min_players,
          maxPlayers: match.max_players,
          signupOpenDate: match.signup_open_date,
          signupCloseDate: match.signup_close_date,
          optimizationResult: match.optimization_result ?? null,
        },
        players,
        summary: {
          totalSignups: players.filter(p => p.isSignedUp).length,
          totalSelected: players.filter(p => p.isSelected).length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/matches/:matchId/selections — manual override after optimization
router.put('/selections', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { selectedPlayerIds } = req.body as { selectedPlayerIds: string[] };

    if (!Array.isArray(selectedPlayerIds)) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'selectedPlayerIds must be an array' } });
      return;
    }

    const { data: match } = await supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    // Capture the current squad up front, so we can validate against it and later
    // diff added/removed players. Selections aren't mutated until the delete below,
    // so this snapshot stays accurate for both uses.
    const { data: prior } = await supabaseAdmin.from('selections').select('player_id').eq('match_id', matchId);
    const priorIds = new Set((prior ?? []).map((s: any) => s.player_id));

    // Validate only the players being *added* (not already in the squad) against the
    // selectable roster: active, not a placeholder stand-in, not a merged tombstone.
    // Players already selected are grandfathered in — a placeholder the optimizer
    // legitimately kept in the squad must not block an unrelated swap of two valid
    // players. The coach may add players who didn't sign up — they get a signup
    // created below — so we validate against the user roster rather than this match's
    // signups. Done before any writes, so a bad payload leaves the existing squad untouched.
    const addedIds = selectedPlayerIds.filter(id => !priorIds.has(id));
    if (addedIds.length > 0) {
      const { data: validUsers } = await supabaseAdmin
        .from('users')
        .select('user_id')
        .eq('is_active', true)
        .eq('is_placeholder', false)
        .is('merged_into', null)
        .in('user_id', addedIds);
      const validIds = new Set((validUsers ?? []).map((u: any) => u.user_id));
      const invalid = addedIds.filter(id => !validIds.has(id));
      if (invalid.length > 0) {
        res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'One or more player IDs are not selectable players.' } });
        return;
      }
    }

    // Any selected player without an active signup gets one created (or a withdrawn
    // signup re-activated), mirroring the historical-backfill flow — so manually
    // added players are signed up and counted consistently in stats.
    if (selectedPlayerIds.length > 0) {
      const { data: existingSignups } = await supabaseAdmin
        .from('signups')
        .select('signup_id, player_id, withdrawn_at')
        .eq('match_id', matchId)
        .in('player_id', selectedPlayerIds);
      const activeSignedUp = new Set((existingSignups ?? []).filter((s: any) => s.withdrawn_at === null).map((s: any) => s.player_id));
      const withdrawnByPlayer = new Map((existingSignups ?? []).filter((s: any) => s.withdrawn_at !== null).map((s: any) => [s.player_id, s.signup_id]));

      const toInsert: { match_id: string; player_id: string }[] = [];
      for (const playerId of selectedPlayerIds) {
        if (activeSignedUp.has(playerId)) continue;
        const withdrawnId = withdrawnByPlayer.get(playerId);
        if (withdrawnId) {
          await supabaseAdmin.from('signups').update({ withdrawn_at: null }).eq('signup_id', withdrawnId);
        } else {
          toInsert.push({ match_id: String(matchId), player_id: playerId });
        }
      }
      if (toInsert.length > 0) {
        const { error: signupErr } = await supabaseAdmin.from('signups').insert(toInsert);
        if (signupErr) throw signupErr;
      }
    }

    await supabaseAdmin.from('selections').delete().eq('match_id', matchId);

    const rows = selectedPlayerIds.map(playerId => ({
      match_id: matchId,
      player_id: playerId,
      selected_by_optimization: false,
      manually_adjusted: true,
      selected_by: req.user!.userId,
    }));

    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from('selections').insert(rows);
      if (error) throw error;
    }

    // A live (published) or completed squad keeps its state on a manual edit —
    // only pre-publish edits land in 'optimized'. Reverting a published squad to
    // 'optimized' would hide it from players (the squad endpoint requires
    // published/completed) and silently un-publish the match.
    const newStatus = match.status === 'published' ? 'published'
      : match.status === 'completed' ? 'completed'
      : 'optimized';
    await supabaseAdmin.from('matches').update({ status: newStatus }).eq('match_id', matchId);

    // Swapping players on a published squad → notify the affected players.
    if (match.status === 'published') {
      const newIds = new Set(selectedPlayerIds);
      const removedIds = [...priorIds].filter(id => !newIds.has(id)) as string[];
      notifyPublishedSquadChange(match, addedIds, removedIds, String(matchId));
    }

    res.json({ success: true, data: { matchId, selectedCount: selectedPlayerIds.length, status: newStatus } });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/optimize
router.post('/optimize', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const { fairnessWeight } = req.body as { fairnessWeight?: number };
    const fairness_weight = typeof fairnessWeight === 'number'
      ? Math.min(1, Math.max(0, fairnessWeight))
      : 0.5;

    const { data: match } = await supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    const { data: signups } = await supabaseAdmin
      .from('signups')
      .select('player_id, is_priority, users!signups_player_id_fkey(user_id, name, preferred_positions)')
      .eq('match_id', matchId)
      .eq('is_active', true);

    if (!signups || signups.length === 0) {
      res.status(400).json({ success: false, error: { code: 'NO_SIGNUPS', message: 'No active sign-ups for this match' } });
      return;
    }

    const playerIds = signups.map((s: any) => s.player_id);

    const [{ data: stats }, { count: totalCompleted }] = await Promise.all([
      supabaseAdmin
        .from('player_statistics')
        .select('user_id, total_played, total_signups')
        .in('user_id', playerIds),
      supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'completed'),
    ]);

    const statsMap = new Map((stats ?? []).map((s: any) => [s.user_id, s]));
    const totalMatches = Math.max(totalCompleted ?? 0, 1);

    const players = signups.map((s: any) => {
      const st = statsMap.get(s.player_id);
      return {
        id: s.player_id,
        name: s.users.name,
        preferred_positions: s.users.preferred_positions ?? [],
        games_played: Number(st?.total_played ?? 0),
        games_signedup: Number(st?.total_signups ?? 0),
        is_priority: s.is_priority ?? false,
      };
    });

    let result: any;
    try {
      result = await optimizeMatch({
        match_id: String(matchId),
        match_type: match.match_type,
        target_players: match.max_players,
        max_players: match.max_players,
        total_matches: totalMatches,
        fairness_weight,
        players,
      });
    } catch (optErr) {
      console.error('Optimizer error', optErr);
      res.status(502).json({ success: false, error: { code: 'OPTIMIZER_ERROR', message: 'Optimization service error — please try again.' } });
      return;
    }

    if (result.error && !result.selected_ids) {
      res.status(422).json({ success: false, error: { code: 'OPTIMIZER_FAILED', message: result.error } });
      return;
    }

    const selectedSet = new Set<string>(result.selected_ids);

    await supabaseAdmin.from('selections').delete().eq('match_id', matchId);

    const rows = result.selected_ids.map((playerId: string) => ({
      match_id: matchId,
      player_id: playerId,
      selected_by_optimization: true,
      manually_adjusted: false,
      is_priority_selection: signups.find((s: any) => s.player_id === playerId)?.is_priority ?? false,
      selected_by: req.user!.userId,
    }));

    const { error: insertErr } = await supabaseAdmin.from('selections').insert(rows);
    if (insertErr) throw insertErr;

    const optimizationResult = {
      formation: result.formation ?? null,
      deficit: result.deficit ?? 0,
      objective: result.objective ?? null,
      fairnessWeight: fairness_weight,
      selectedCount: result.selected_ids.length,
      solveTimeMs: result.solve_time_ms ?? null,
      optimizedAt: new Date().toISOString(),
    };

    await supabaseAdmin.from('matches')
      .update({ status: 'optimized', optimization_result: optimizationResult })
      .eq('match_id', matchId);

    res.json({
      success: true,
      data: {
        matchId,
        status: 'optimized',
        selectedCount: result.selected_ids.length,
        deficit: result.deficit,
        objective: result.objective,
        solveTimeMs: result.solve_time_ms,
        formation: result.formation,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
