import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router({ mergeParams: true });

const JULIA_URL = process.env.JULIA_SERVICE_URL || 'http://localhost:3002';

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

    const [{ data: match }, { data: signups }, { data: selections }] = await Promise.all([
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
    ]);

    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    const playerIds = (signups ?? []).map((s: any) => s.player_id);
    const { data: statsData } = playerIds.length > 0
      ? await supabaseAdmin.from('player_statistics').select('user_id, total_played, total_signups').in('user_id', playerIds)
      : { data: [] };
    const statsMap = new Map((statsData ?? []).map((s: any) => [s.user_id, s]));

    const selectedIds = new Set((selections ?? []).map((s: any) => s.player_id));
    const selectionDetails = new Map((selections ?? []).map((s: any) => [s.player_id, s]));

    const players = (signups ?? []).map((s: any) => ({
      player: {
        userId: s.users.user_id,
        name: s.users.name,
        preferredPositions: s.users.preferred_positions,
        totalPlayed: Number(statsMap.get(s.users.user_id)?.total_played ?? 0),
        totalSignups: Number(statsMap.get(s.users.user_id)?.total_signups ?? 0),
      },
      isPriority: s.is_priority ?? false,
      isSelected: selectedIds.has(s.player_id),
      selectedByOptimization: selectionDetails.get(s.player_id)?.selected_by_optimization ?? false,
      manuallyAdjusted: selectionDetails.get(s.player_id)?.manually_adjusted ?? false,
      optimizationScore: selectionDetails.get(s.player_id)?.optimization_score ?? null,
    }));

    res.json({
      success: true,
      data: {
        match: {
          matchId: match.match_id,
          matchDate: match.match_date,
          matchTime: match.match_time,
          matchType: match.match_type,
          opponent: match.opponent ?? null,
          status: match.status,
          minPlayers: match.min_players,
          maxPlayers: match.max_players,
        },
        players,
        summary: {
          totalSignups: players.length,
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

    await supabaseAdmin.from('matches').update({ status: 'optimized' }).eq('match_id', matchId);

    res.json({ success: true, data: { matchId, selectedCount: selectedPlayerIds.length } });
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

    const juliaRes = await fetch(`${JULIA_URL}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id: matchId,
        match_type: match.match_type,
        target_players: match.max_players,
        max_players: match.max_players,
        total_matches: totalMatches,
        fairness_weight,
        players,
      }),
    });

    if (!juliaRes.ok) {
      const errBody = await juliaRes.text();
      res.status(502).json({ success: false, error: { code: 'OPTIMIZER_ERROR', message: errBody } });
      return;
    }

    const result: any = await juliaRes.json();

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

    await supabaseAdmin.from('matches').update({ status: 'optimized' }).eq('match_id', matchId);

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
