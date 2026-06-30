import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createNotifications } from '../lib/notifications.js';
import { recomputeForMatch } from '../lib/achievementsStore.js';

const router = Router();

function canEditResults(role: string, canEnterResults: boolean) {
  return role === 'coach' || role === 'admin' || canEnterResults;
}

// ─── Match results ────────────────────────────────────────────────────────────

// GET /api/matches/:matchId/results
router.get('/matches/:matchId/results', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const [{ data: result }, { data: performances }] = await Promise.all([
      supabaseAdmin.from('match_results').select('*').eq('match_id', matchId).maybeSingle(),
      supabaseAdmin
        .from('match_performance')
        .select('*, users!match_performance_player_id_fkey(user_id, name, preferred_positions)')
        .eq('match_id', matchId),
    ]);

    res.json({
      success: true,
      data: {
        result: result
          ? {
              goalsFor: result.goals_for,
              goalsAgainst: result.goals_against,
              gameAssessment: result.game_assessment ?? null,
              goalEvents: result.goal_events ?? [],
              longRead: result.long_read ?? null,
              gkFirstHalfId: result.gk_first_half ?? null,
              gkSecondHalfId: result.gk_second_half ?? null,
              recordedAt: result.recorded_at,
            }
          : null,
        performances: (performances ?? []).map((p: any) => ({
          playerId: p.player_id,
          name: p.users.name,
          preferredPositions: p.users.preferred_positions ?? [],
          attended: p.attended,
          goals: p.goals ?? 0,
          assists: p.assists ?? 0,
          cleanSheet: p.clean_sheet ?? false,
          yellowCards: p.yellow_cards ?? 0,
          redCards: p.red_cards ?? 0,
          minutesPlayed: p.minutes_played,
          positionPlayed: p.position_played,
          selfRating: p.self_rating,
          manOfMatch: p.man_of_match ?? false,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/results — create or replace full match result
router.post('/matches/:matchId/results', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const userId = req.user!.userId;

    // Fetch user's can_enter_results flag
    const { data: userRow } = await supabaseAdmin.from('users').select('can_enter_results').eq('user_id', userId).single();
    if (!canEditResults(req.user!.role, userRow?.can_enter_results ?? false)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'No permission to record results' } });
      return;
    }

    const { goalsFor, goalsAgainst, gameAssessment, goalEvents, longRead, manOfMatchId, gkFirstHalfId, gkSecondHalfId, players } = req.body as {
      goalsFor: number;
      goalsAgainst: number;
      gameAssessment?: string | null;
      goalEvents?: Array<{ scorerId: string | null; assisterId: string | null }>;
      longRead?: string | null;
      manOfMatchId?: string | null;
      gkFirstHalfId?: string | null;
      gkSecondHalfId?: string | null;
      players: Array<{
        playerId: string;
        attended: boolean;
        goals: number;
        assists: number;
        cleanSheet?: boolean;
        yellowCards?: number;
        redCards?: number;
        minutesPlayed?: number;
        positionPlayed?: string;
        selfRating?: number;
      }>;
    };

    if (typeof goalsFor !== 'number' || typeof goalsAgainst !== 'number') {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'goalsFor and goalsAgainst are required' } });
      return;
    }

    // Upsert team result
    await supabaseAdmin.from('match_results').upsert({
      match_id: matchId,
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      game_assessment: gameAssessment ?? null,
      goal_events: goalEvents ?? null,
      long_read: longRead ?? null,
      gk_first_half: gkFirstHalfId ?? null,
      gk_second_half: gkSecondHalfId ?? null,
      recorded_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'match_id' });

    // Upsert individual performances
    if (Array.isArray(players) && players.length > 0) {
      // A shutout is a defensive achievement for the whole back line, not just the
      // keeper: when the team conceded nothing, credit a clean sheet to every
      // attended defensive player (GK/DEF), so defenders get a real positive
      // signal in their stats and performance rating — not only goalscorers.
      const teamCleanSheet = goalsAgainst === 0;
      const { data: posRows } = await supabaseAdmin
        .from('users').select('user_id, preferred_positions').in('user_id', players.map(p => p.playerId));
      const isDefensive = new Map<string, boolean>(
        (posRows ?? []).map((u: any) => [u.user_id, (u.preferred_positions ?? []).some((pos: string) => pos === 'GK' || pos === 'DEF')]),
      );
      const rows = players.map(p => ({
        match_id: matchId,
        player_id: p.playerId,
        attended: p.attended ?? false,
        goals: p.goals ?? 0,
        assists: p.assists ?? 0,
        clean_sheet: (p.cleanSheet ?? false) || (teamCleanSheet && (p.attended ?? false) && (isDefensive.get(p.playerId) ?? false)),
        yellow_cards: p.yellowCards ?? 0,
        red_cards: p.redCards ?? 0,
        minutes_played: p.minutesPlayed ?? null,
        position_played: p.positionPlayed ?? null,
        self_rating: p.selfRating ?? null,
        man_of_match: manOfMatchId ? p.playerId === manOfMatchId : false,
        submitted_by: userId,
      }));
      await supabaseAdmin.from('match_performance').upsert(rows, { onConflict: 'match_id,player_id' });
    }

    // Advance match to completed if still published
    const { data: match } = await supabaseAdmin.from('matches').select('status').eq('match_id', matchId).single();
    if (match?.status === 'published') {
      await supabaseAdmin.from('matches').update({ status: 'completed' }).eq('match_id', matchId);
    }

    // Recompute achievements/streaks for every player in this result. Fire-and-
    // forget: a gamification hiccup must never fail recording the result.
    const affectedPlayers = Array.isArray(players) ? players.map(p => p.playerId) : [];
    recomputeForMatch(String(matchId), affectedPlayers).catch(err =>
      console.error('[achievements] recompute failed for match', matchId, err),
    );

    res.json({ success: true, data: { matchId, goalsFor, goalsAgainst } });
  } catch (err) {
    next(err);
  }
});

// ─── Result edit permissions ──────────────────────────────────────────────────

// POST /api/result-permissions/request — player requests edit permission
router.post('/result-permissions/request', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;

    // Check for existing pending or approved
    const { data: existing } = await supabaseAdmin
      .from('result_edit_requests')
      .select('request_id, status')
      .eq('player_id', userId)
      .in('status', ['pending', 'approved'])
      .maybeSingle();

    if (existing?.status === 'approved') {
      res.status(409).json({ success: false, error: { code: 'ALREADY_APPROVED', message: 'You already have edit permission' } });
      return;
    }
    if (existing?.status === 'pending') {
      res.status(409).json({ success: false, error: { code: 'ALREADY_REQUESTED', message: 'You already have a pending request' } });
      return;
    }

    const { data, error } = await supabaseAdmin.from('result_edit_requests').insert({
      player_id: userId,
    }).select().single();

    if (error) throw error;

    // Notify coaches/admins of the pending request — fire-and-forget
    Promise.all([
      supabaseAdmin.from('users').select('name').eq('user_id', userId).single(),
      supabaseAdmin.from('users').select('user_id').in('role', ['coach', 'admin']).eq('is_active', true),
    ]).then(([{ data: player }, { data: staff }]) => {
      createNotifications((staff ?? []).map((s: any) => s.user_id), {
        type: 'result_permission_request',
        title: 'Result access requested',
        body: `${player?.name ?? 'A player'} wants permission to record match results`,
        link: '/coach',
      });
    });

    res.status(201).json({ success: true, data: { requestId: data.request_id, status: 'pending' } });
  } catch (err) {
    next(err);
  }
});

// GET /api/result-permissions/my — current user's permission status
router.get('/result-permissions/my', authenticate, async (req, res, next) => {
  try {
    const { role, userId } = req.user!;

    if (role === 'coach' || role === 'admin') {
      res.json({ success: true, data: { canEnterResults: true, pendingRequest: null } });
      return;
    }

    const [{ data: userRow }, { data: request }] = await Promise.all([
      supabaseAdmin.from('users').select('can_enter_results').eq('user_id', userId).single(),
      supabaseAdmin
        .from('result_edit_requests')
        .select('request_id, status, requested_at')
        .eq('player_id', userId)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    res.json({
      success: true,
      data: {
        canEnterResults: userRow?.can_enter_results ?? false,
        pendingRequest: request?.status === 'pending' ? { requestId: request.request_id } : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/result-permissions/pending — coach/admin sees all pending requests
router.get('/result-permissions/pending', authenticate, requireRole('coach', 'admin'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('result_edit_requests')
      .select('request_id, player_id, requested_at, users!result_edit_requests_player_id_fkey(name)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      data: (data ?? []).map((r: any) => ({
        requestId: r.request_id,
        playerId: r.player_id,
        playerName: r.users.name,
        requestedAt: r.requested_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/result-permissions/:requestId/respond — coach approves or rejects
router.put('/result-permissions/:requestId/respond', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { approve } = req.body as { approve: boolean };

    const { data: req_ } = await supabaseAdmin
      .from('result_edit_requests')
      .select('player_id, status')
      .eq('request_id', requestId)
      .eq('status', 'pending')
      .single();

    if (!req_) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending request not found' } });
      return;
    }

    await supabaseAdmin.from('result_edit_requests').update({
      status: approve ? 'approved' : 'rejected',
      resolved_at: new Date().toISOString(),
      resolved_by: req.user!.userId,
    }).eq('request_id', requestId);

    if (approve) {
      await supabaseAdmin.from('users').update({ can_enter_results: true }).eq('user_id', req_.player_id);
    }

    res.json({ success: true, data: { requestId, status: approve ? 'approved' : 'rejected' } });
  } catch (err) {
    next(err);
  }
});

export default router;
