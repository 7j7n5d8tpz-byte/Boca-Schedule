import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const JULIA_URL = process.env.JULIA_SERVICE_URL || 'http://localhost:3002';

// POST /api/optimize/batch
// Jointly optimizes multiple matches in one solver call.
// Body: { matches: [{ matchId, fairnessWeight? }] }
router.post('/batch', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matches: matchConfigs } = req.body as {
      matches: Array<{ matchId: string; fairnessWeight?: number }>;
    };

    if (!Array.isArray(matchConfigs) || matchConfigs.length === 0) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'matches must be a non-empty array' } });
      return;
    }

    // Fetch match data and signups for every match in parallel
    const matchDataResults = await Promise.all(
      matchConfigs.map(async ({ matchId, fairnessWeight }) => {
        const fw = typeof fairnessWeight === 'number'
          ? Math.min(1, Math.max(0, fairnessWeight))
          : 0.5;

        const [{ data: match }, { data: signups }] = await Promise.all([
          supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single(),
          supabaseAdmin
            .from('signups')
            .select('player_id, is_priority, users!signups_player_id_fkey(user_id, name, preferred_positions)')
            .eq('match_id', matchId)
            .eq('is_active', true),
        ]);

        return { matchId, match, signups: (signups ?? []) as any[], fairnessWeight: fw };
      })
    );

    for (const { matchId, match } of matchDataResults) {
      if (!match) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Match ${matchId} not found` } });
        return;
      }
    }

    // Deduplicate players across all matches
    const playerUserMap = new Map<string, { name: string; preferred_positions: string[] }>();
    for (const { signups } of matchDataResults) {
      for (const s of signups) {
        if (!playerUserMap.has(s.player_id)) {
          playerUserMap.set(s.player_id, s.users);
        }
      }
    }

    const playerIds = [...playerUserMap.keys()];

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

    const players = playerIds.map(pid => {
      const user = playerUserMap.get(pid)!;
      const st = statsMap.get(pid);
      return {
        id: pid,
        name: user.name,
        preferred_positions: user.preferred_positions ?? [],
        games_played: Number(st?.total_played ?? 0),
        games_signedup: Number(st?.total_signups ?? 0),
      };
    });

    const juliaMatches = matchDataResults.map(({ matchId, match, signups, fairnessWeight }) => ({
      match_id: matchId,
      match_type: match.match_type,
      target_players: match.max_players,
      max_players: match.max_players,
      fairness_weight: fairnessWeight,
      signups: signups.map((s: any) => ({
        player_id: s.player_id,
        is_priority: s.is_priority ?? false,
      })),
    }));

    const juliaRes = await fetch(`${JULIA_URL}/optimize/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ total_matches: totalMatches, players, matches: juliaMatches }),
    });

    if (!juliaRes.ok) {
      res.status(502).json({ success: false, error: { code: 'OPTIMIZER_ERROR', message: 'Optimization service error — please try again.' } });
      return;
    }

    const batchResult: any = await juliaRes.json();

    if (batchResult.error && !batchResult.matches) {
      res.status(422).json({ success: false, error: { code: 'OPTIMIZER_FAILED', message: batchResult.error } });
      return;
    }

    // Save selections for every match and advance status to 'optimized'
    await Promise.all(
      (batchResult.matches as any[]).map(async (matchResult: any) => {
        const { matchId, signups, fairnessWeight } = matchDataResults.find(m => m.matchId === matchResult.match_id)!;

        await supabaseAdmin.from('selections').delete().eq('match_id', matchId);

        const rows = (matchResult.selected_ids as string[]).map(playerId => ({
          match_id: matchId,
          player_id: playerId,
          selected_by_optimization: true,
          manually_adjusted: false,
          is_priority_selection: signups.find((s: any) => s.player_id === playerId)?.is_priority ?? false,
          selected_by: req.user!.userId,
        }));

        if (rows.length > 0) {
          const { error } = await supabaseAdmin.from('selections').insert(rows);
          if (error) throw error;
        }

        const optimizationResult = {
          formation: matchResult.formation ?? null,
          deficit: matchResult.deficit ?? 0,
          objective: batchResult.objective ?? null,
          fairnessWeight,
          selectedCount: (matchResult.selected_ids as string[]).length,
          solveTimeMs: batchResult.solve_time_ms ?? null,
          optimizedAt: new Date().toISOString(),
        };

        await supabaseAdmin.from('matches')
          .update({ status: 'optimized', optimization_result: optimizationResult })
          .eq('match_id', matchId);
      })
    );

    // Build player impact summary
    const impactMap = new Map<string, {
      playerId: string; name: string;
      historicalPlayed: number; historicalSignups: number;
      batchSignups: number; batchSelected: number;
    }>();

    for (const { matchId, signups } of matchDataResults) {
      const matchResult = (batchResult.matches as any[]).find((m: any) => m.match_id === matchId);
      const selectedSet = new Set<string>(matchResult?.selected_ids ?? []);

      for (const s of signups) {
        const pid: string = s.player_id;
        if (!impactMap.has(pid)) {
          const st = statsMap.get(pid);
          impactMap.set(pid, {
            playerId: pid,
            name: playerUserMap.get(pid)!.name,
            historicalPlayed: Number(st?.total_played ?? 0),
            historicalSignups: Number(st?.total_signups ?? 0),
            batchSignups: 0,
            batchSelected: 0,
          });
        }
        const entry = impactMap.get(pid)!;
        entry.batchSignups++;
        if (selectedSet.has(pid)) entry.batchSelected++;
      }
    }

    const impact = [...impactMap.values()].sort((a, b) => {
      // Most underplayed relative to sign-ups first
      const rA = a.historicalSignups > 0 ? a.historicalPlayed / a.historicalSignups : 0;
      const rB = b.historicalSignups > 0 ? b.historicalPlayed / b.historicalSignups : 0;
      return rA - rB;
    });

    res.json({
      success: true,
      data: {
        solveTimeMs: batchResult.solve_time_ms,
        objective: batchResult.objective,
        matches: (batchResult.matches as any[]).map((mr: any) => ({
          matchId: mr.match_id,
          selectedIds: mr.selected_ids as string[],
          deficit: mr.deficit as number,
          formation: mr.formation,
        })),
        impact,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
