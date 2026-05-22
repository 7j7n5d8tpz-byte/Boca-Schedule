import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  preferredPositions: z.array(z.enum(['GK', 'DEF', 'WIN', 'MID', 'STR'])).optional(),
});

// GET /api/players — all registered players except self (for swap target picker)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('user_id, name, preferred_positions')
      .neq('user_id', req.user!.userId)
      .order('name');
    if (error) throw error;
    res.json({ success: true, data: (data ?? []).map((p: any) => ({
      userId: p.user_id,
      name: p.name,
      preferredPositions: p.preferred_positions ?? [],
    })) });
  } catch (err) {
    next(err);
  }
});

// GET /api/players/statistics/team — year-filtered stats + comparison with previous year
router.get('/statistics/team', authenticate, async (req, res, next) => {
  try {
    // Fetch all players and available years in parallel
    const [{ data: allUsers }, { data: allMatchDates }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').in('role', ['player', 'coach']).eq('is_active', true).order('name'),
      supabaseAdmin.from('matches').select('match_date').in('status', ['completed', 'published']),
    ]);

    const availableYears = [...new Set(
      (allMatchDates ?? []).map((m: any) => new Date(m.match_date).getFullYear())
    )].sort((a, b) => b - a);

    const defaultYear = availableYears[0] ?? new Date().getFullYear();
    const year = req.query.year ? parseInt(req.query.year as string) : defaultYear;

    type PlayerRow = {
      userId: string; name: string; preferredPositions: string[];
      totalSignups: number; totalSelected: number; totalPlayed: number;
      totalGoals: number; totalAssists: number; totalSaves: number;
      avgRating: number; attendanceRate: number;
    };
    type MatchRow = { matchId: string; matchDate: string; location: string; opponent: string | null; goalsFor: number; goalsAgainst: number };

    async function getYearData(y: number): Promise<{ players: PlayerRow[]; matchHistory: MatchRow[] }> {
      const { data: yearMatches } = await supabaseAdmin
        .from('matches').select('match_id')
        .gte('match_date', `${y}-01-01`).lte('match_date', `${y}-12-31`);

      const matchIds = (yearMatches ?? []).map((m: any) => m.match_id);
      if (matchIds.length === 0) return { players: [], matchHistory: [] };

      const [{ data: perfData }, { data: signupData }, { data: selectionData }, { data: historyData }] = await Promise.all([
        supabaseAdmin.from('match_performance').select('player_id, attended, goals, assists, saves, self_rating').in('match_id', matchIds),
        supabaseAdmin.from('signups').select('player_id').eq('is_active', true).in('match_id', matchIds),
        supabaseAdmin.from('selections').select('player_id').in('match_id', matchIds),
        supabaseAdmin.from('match_results')
          .select('match_id, goals_for, goals_against, matches(match_date, location, opponent)')
          .in('match_id', matchIds).order('recorded_at', { ascending: true }),
      ]);

      const signupMap = new Map<string, number>();
      (signupData ?? []).forEach((s: any) => signupMap.set(s.player_id, (signupMap.get(s.player_id) ?? 0) + 1));

      const selectedMap = new Map<string, number>();
      (selectionData ?? []).forEach((s: any) => selectedMap.set(s.player_id, (selectedMap.get(s.player_id) ?? 0) + 1));

      const perfMap = new Map<string, { played: number; goals: number; assists: number; saves: number; ratingSum: number; ratingCount: number }>();
      (perfData ?? []).forEach((p: any) => {
        const c = perfMap.get(p.player_id) ?? { played: 0, goals: 0, assists: 0, saves: 0, ratingSum: 0, ratingCount: 0 };
        perfMap.set(p.player_id, {
          played: c.played + (p.attended ? 1 : 0),
          goals: c.goals + (p.goals ?? 0),
          assists: c.assists + (p.assists ?? 0),
          saves: c.saves + (p.saves ?? 0),
          ratingSum: c.ratingSum + (p.self_rating ?? 0),
          ratingCount: c.ratingCount + (p.self_rating != null ? 1 : 0),
        });
      });

      const players: PlayerRow[] = (allUsers ?? []).map((u: any) => {
        const perf = perfMap.get(u.user_id) ?? { played: 0, goals: 0, assists: 0, saves: 0, ratingSum: 0, ratingCount: 0 };
        const signups = signupMap.get(u.user_id) ?? 0;
        const selected = selectedMap.get(u.user_id) ?? 0;
        return {
          userId: u.user_id, name: u.name, preferredPositions: u.preferred_positions ?? [],
          totalSignups: signups, totalSelected: selected, totalPlayed: perf.played,
          totalGoals: perf.goals, totalAssists: perf.assists, totalSaves: perf.saves,
          avgRating: perf.ratingCount > 0 ? +(perf.ratingSum / perf.ratingCount).toFixed(2) : 0,
          attendanceRate: signups > 0 ? +((perf.played / signups) * 100).toFixed(2) : 0,
        };
      }).filter((p: PlayerRow) => p.totalSignups > 0 || p.totalPlayed > 0);

      const matchHistory: MatchRow[] = (historyData ?? []).map((r: any) => ({
        matchId: r.match_id,
        matchDate: r.matches?.match_date ?? '',
        location: r.matches?.location ?? '',
        opponent: r.matches?.opponent ?? null,
        goalsFor: Number(r.goals_for),
        goalsAgainst: Number(r.goals_against),
      }));

      return { players, matchHistory };
    }

    function buildOverview(players: PlayerRow[], matchHistory: MatchRow[]) {
      const totalGoals        = players.reduce((s, p) => s + p.totalGoals, 0);
      const totalAssists      = players.reduce((s, p) => s + p.totalAssists, 0);
      const totalSaves        = players.reduce((s, p) => s + p.totalSaves, 0);
      const totalGoalsAgainst = matchHistory.reduce((s, m) => s + m.goalsAgainst, 0);
      const gamesWithResults  = matchHistory.length;
      const wins   = matchHistory.filter(m => m.goalsFor > m.goalsAgainst).length;
      const draws  = matchHistory.filter(m => m.goalsFor === m.goalsAgainst).length;
      const losses = matchHistory.filter(m => m.goalsFor < m.goalsAgainst).length;
      const active = players.filter(p => p.totalSignups > 0);
      const avgAttendance = active.length ? Math.round(active.reduce((s, p) => s + p.attendanceRate, 0) / active.length) : 0;
      const topScorer   = players.reduce((b, p) => p.totalGoals   > (b?.totalGoals ?? -1)   ? p : b, null as PlayerRow | null);
      const topAssister = players.reduce((b, p) => p.totalAssists > (b?.totalAssists ?? -1) ? p : b, null as PlayerRow | null);
      const topKeeper   = players.reduce((b, p) => p.totalSaves   > (b?.totalSaves ?? -1)   ? p : b, null as PlayerRow | null);
      return {
        totalPlayers: active.length, totalGoals, totalGoalsAgainst, totalAssists, totalSaves,
        avgAttendanceRate: avgAttendance, gamesWithResults, wins, draws, losses,
        avgGoalsFor:     gamesWithResults ? +(totalGoals / gamesWithResults).toFixed(2) : 0,
        avgGoalsAgainst: gamesWithResults ? +(totalGoalsAgainst / gamesWithResults).toFixed(2) : 0,
        topScorer:   topScorer?.totalGoals   ? { name: topScorer.name,   value: topScorer.totalGoals }   : null,
        topAssister: topAssister?.totalAssists ? { name: topAssister.name, value: topAssister.totalAssists } : null,
        topKeeper:   topKeeper?.totalSaves   ? { name: topKeeper.name,   value: topKeeper.totalSaves }   : null,
      };
    }

    const [current, prev] = await Promise.all([getYearData(year), getYearData(year - 1)]);

    res.json({
      success: true,
      data: {
        year,
        availableYears: availableYears.length > 0 ? availableYears : [year],
        overview: buildOverview(current.players, current.matchHistory),
        prevYear: year - 1,
        prevOverview: buildOverview(prev.players, prev.matchHistory),
        players: current.players.sort((a, b) => b.totalSignups - a.totalSignups),
        matchHistory: current.matchHistory,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:playerId/statistics
router.get('/:playerId/statistics', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;

    // Only allow viewing own stats unless coach/admin
    if (playerId !== req.user!.userId && req.user!.role === 'player') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const [{ data: profile }, { data: stats }, { data: recent }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').eq('user_id', playerId).single(),
      supabaseAdmin.from('player_statistics').select('*').eq('user_id', playerId).single(),
      supabaseAdmin.from('match_performance').select('*, matches(match_date)').eq('player_id', playerId).order('submitted_at', { ascending: false }).limit(10),
    ]);

    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
      return;
    }

    res.json({
      success: true,
      data: {
        player: { userId: profile.user_id, name: profile.name, preferredPositions: profile.preferred_positions },
        seasonStats: stats ?? {},
        recentMatches: (recent ?? []).map((mp: any) => ({
          matchId: mp.match_id,
          matchDate: mp.matches?.match_date,
          attended: mp.attended,
          goals: mp.goals,
          assists: mp.assists,
          minutesPlayed: mp.minutes_played,
          positionPlayed: mp.position_played,
          selfRating: mp.self_rating,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/players/:playerId/profile
router.put('/:playerId/profile', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;

    if (playerId !== req.user!.userId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot edit another user\'s profile' } });
      return;
    }

    const body = UpdateProfileSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (body.data.name) updates.name = body.data.name;
    if (body.data.preferredPositions) updates.preferred_positions = body.data.preferredPositions;

    const { data, error } = await supabaseAdmin.from('users').update(updates).eq('user_id', playerId).select().single();
    if (error) throw error;

    res.json({ success: true, data: { userId: data.user_id, name: data.name, preferredPositions: data.preferred_positions, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/performance
router.post('/:matchId/performance', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { attended, goals, assists, saves, cleanSheet, yellowCards, redCards, minutesPlayed, positionPlayed, selfRating } = req.body;

    const { data, error } = await supabaseAdmin.from('match_performance').insert({
      match_id: matchId,
      player_id: req.user!.userId,
      attended: attended ?? false,
      goals: goals ?? 0,
      assists: assists ?? 0,
      saves: saves ?? 0,
      clean_sheet: cleanSheet ?? false,
      yellow_cards: yellowCards ?? 0,
      red_cards: redCards ?? 0,
      minutes_played: minutesPlayed,
      position_played: positionPlayed,
      self_rating: selfRating,
      submitted_by: req.user!.userId,
    }).select().single();

    if (error) throw error;

    res.status(201).json({ success: true, data: { performanceId: data.performance_id, matchId, playerId: req.user!.userId, submittedAt: data.submitted_at } });
  } catch (err) {
    next(err);
  }
});

export default router;
