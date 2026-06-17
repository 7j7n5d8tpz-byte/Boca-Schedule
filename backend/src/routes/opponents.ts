import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { resolveOpponent } from '../lib/opponents.js';

const router = Router();

// GET /api/opponents — every authenticated user (powers the Statistics tab and
// the coach's opponent picker). matchesPlayed counts completed matches that have
// a recorded result, i.e. the rows the head-to-head view aggregates over.
router.get('/', authenticate, async (_req, res, next) => {
  try {
    const [{ data: opponents, error: oppErr }, { data: results, error: resErr }] = await Promise.all([
      supabaseAdmin.from('opponents').select('opponent_id, name').order('name'),
      supabaseAdmin
        .from('match_results')
        .select('matches!inner(opponent_id, status)')
        .eq('matches.status', 'completed'),
    ]);
    if (oppErr) throw oppErr;
    if (resErr) throw resErr;

    const playedCount = new Map<string, number>();
    for (const r of (results ?? []) as any[]) {
      const oid = r.matches?.opponent_id;
      if (oid) playedCount.set(oid, (playedCount.get(oid) ?? 0) + 1);
    }

    res.json({
      success: true,
      data: (opponents ?? []).map(o => ({
        opponentId: o.opponent_id,
        name: o.name,
        matchesPlayed: playedCount.get(o.opponent_id) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/opponents/:opponentId/history — head-to-head record + per-match list.
router.get('/:opponentId/history', authenticate, async (req, res, next) => {
  try {
    const { opponentId } = req.params;
    const matchTypeFilter = (req.query.matchType as string | undefined) ?? 'all';

    const { data: opponent, error: oppErr } = await supabaseAdmin
      .from('opponents')
      .select('opponent_id, name')
      .eq('opponent_id', opponentId)
      .single();
    if (oppErr || !opponent) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Opponent not found' } });
      return;
    }

    let q = supabaseAdmin
      .from('match_results')
      .select('match_id, goals_for, goals_against, game_assessment, matches!inner(match_date, match_time, location, match_type, status, opponent_id)')
      .eq('matches.status', 'completed')
      .eq('matches.opponent_id', opponentId);
    if (matchTypeFilter !== 'all') q = q.eq('matches.match_type', matchTypeFilter);
    const { data: rows, error } = await q;
    if (error) throw error;

    const matches = ((rows ?? []) as any[])
      .map(r => ({
        matchId: r.match_id,
        matchDate: r.matches.match_date,
        matchTime: r.matches.match_time,
        matchType: r.matches.match_type,
        location: r.matches.location,
        goalsFor: r.goals_for,
        goalsAgainst: r.goals_against,
        gameAssessment: r.game_assessment ?? null,
      }))
      // Chronological — drives both the result list and the trend chart.
      .sort((a, b) => (a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : 0));

    let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
    let biggestWin: typeof matches[number] | null = null;
    let biggestLoss: typeof matches[number] | null = null;
    for (const m of matches) {
      goalsFor += m.goalsFor;
      goalsAgainst += m.goalsAgainst;
      const diff = m.goalsFor - m.goalsAgainst;
      if (diff > 0) {
        wins++;
        if (!biggestWin || diff > biggestWin.goalsFor - biggestWin.goalsAgainst) biggestWin = m;
      } else if (diff < 0) {
        losses++;
        if (!biggestLoss || diff < biggestLoss.goalsFor - biggestLoss.goalsAgainst) biggestLoss = m;
      } else {
        draws++;
      }
    }
    const played = matches.length;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    res.json({
      success: true,
      data: {
        opponentId: opponent.opponent_id,
        name: opponent.name,
        summary: {
          played,
          wins,
          draws,
          losses,
          goalsFor,
          goalsAgainst,
          avgGoalsFor: played > 0 ? round1(goalsFor / played) : 0,
          avgGoalsAgainst: played > 0 ? round1(goalsAgainst / played) : 0,
          biggestWin,
          biggestLoss,
          lastResult: played > 0 ? matches[matches.length - 1] : null,
        },
        matches,
      },
    });
  } catch (err) {
    next(err);
  }
});

const CreateOpponentSchema = z.object({ name: z.string().min(1).max(100) });

// POST /api/opponents — coach/admin. Find-or-create (case-insensitive).
router.post('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const body = CreateOpponentSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }
    const resolved = await resolveOpponent(body.data.name, undefined, req.user!.userId);
    res.status(201).json({ success: true, data: resolved });
  } catch (err) {
    next(err);
  }
});

export default router;
