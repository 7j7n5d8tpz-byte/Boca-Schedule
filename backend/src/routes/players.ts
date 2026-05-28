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
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').in('role', ['player', 'coach', 'admin']).eq('is_active', true).order('name'),
      supabaseAdmin.from('matches').select('match_date').in('status', ['completed', 'published']),
    ]);

    const availableYears = [...new Set(
      (allMatchDates ?? []).map((m: any) => new Date(m.match_date).getFullYear())
    )].sort((a, b) => b - a);

    const defaultYear = availableYears[0] ?? new Date().getFullYear();
    const year = req.query.year ? parseInt(req.query.year as string) : defaultYear;
    const matchTypeFilter = (req.query.matchType as string | undefined) ?? 'all';

    type PlayerRow = {
      userId: string; name: string; preferredPositions: string[];
      totalSignups: number; totalSelected: number; totalPlayed: number;
      totalGoals: number; totalAssists: number; totalCleanSheets: number;
      totalYellowCards: number; totalRedCards: number; totalManOfMatch: number;
      avgRating: number; attendanceRate: number; gkAppearances: number;
    };
    type MatchRow = { matchId: string; matchDate: string; location: string; opponent: string | null; goalsFor: number; goalsAgainst: number };

    async function getYearData(y: number): Promise<{ players: PlayerRow[]; matchHistory: MatchRow[] }> {
      let yearMatchQuery = supabaseAdmin
        .from('matches').select('match_id')
        .gte('match_date', `${y}-01-01`).lte('match_date', `${y}-12-31`);
      if (matchTypeFilter !== 'all') yearMatchQuery = yearMatchQuery.eq('match_type', matchTypeFilter);
      const { data: yearMatches } = await yearMatchQuery;

      const matchIds = (yearMatches ?? []).map((m: any) => m.match_id);
      if (matchIds.length === 0) return { players: [], matchHistory: [] };

      const [{ data: perfData }, { data: signupData }, { data: selectionData }, { data: historyData }, { data: completedMatchData }, { data: gkData }] = await Promise.all([
        supabaseAdmin.from('match_performance').select('player_id, goals, assists, clean_sheet, self_rating, yellow_cards, red_cards, man_of_match').in('match_id', matchIds),
        supabaseAdmin.from('signups').select('player_id').eq('is_active', true).in('match_id', matchIds),
        supabaseAdmin.from('selections').select('player_id, match_id').in('match_id', matchIds),
        supabaseAdmin.from('match_results')
          .select('match_id, goals_for, goals_against, matches(match_date, location, opponent)')
          .in('match_id', matchIds).order('recorded_at', { ascending: true }),
        supabaseAdmin.from('matches').select('match_id').eq('status', 'completed').in('match_id', matchIds),
        supabaseAdmin.from('match_results').select('gk_first_half, gk_second_half').in('match_id', matchIds),
      ]);

      const completedIds = new Set((completedMatchData ?? []).map((m: any) => m.match_id));

      const gkAppearanceMap = new Map<string, number>();
      for (const r of (gkData ?? [])) {
        if (r.gk_first_half)  gkAppearanceMap.set(r.gk_first_half,  (gkAppearanceMap.get(r.gk_first_half)  ?? 0) + 1);
        if (r.gk_second_half) gkAppearanceMap.set(r.gk_second_half, (gkAppearanceMap.get(r.gk_second_half) ?? 0) + 1);
      }

      const signupMap = new Map<string, number>();
      (signupData ?? []).forEach((s: any) => signupMap.set(s.player_id, (signupMap.get(s.player_id) ?? 0) + 1));

      const selectedMap = new Map<string, number>();
      const playedMap = new Map<string, number>();
      (selectionData ?? []).forEach((s: any) => {
        selectedMap.set(s.player_id, (selectedMap.get(s.player_id) ?? 0) + 1);
        if (completedIds.has(s.match_id)) {
          playedMap.set(s.player_id, (playedMap.get(s.player_id) ?? 0) + 1);
        }
      });

      const perfMap = new Map<string, { goals: number; assists: number; cleanSheets: number; yellowCards: number; redCards: number; motmCount: number; ratingSum: number; ratingCount: number }>();
      (perfData ?? []).forEach((p: any) => {
        const c = perfMap.get(p.player_id) ?? { goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motmCount: 0, ratingSum: 0, ratingCount: 0 };
        perfMap.set(p.player_id, {
          goals: c.goals + (p.goals ?? 0),
          assists: c.assists + (p.assists ?? 0),
          cleanSheets: c.cleanSheets + (p.clean_sheet ? 1 : 0),
          yellowCards: c.yellowCards + (p.yellow_cards ?? 0),
          redCards: c.redCards + (p.red_cards ?? 0),
          motmCount: c.motmCount + (p.man_of_match ? 1 : 0),
          ratingSum: c.ratingSum + (p.self_rating ?? 0),
          ratingCount: c.ratingCount + (p.self_rating != null ? 1 : 0),
        });
      });

      const players: PlayerRow[] = (allUsers ?? []).map((u: any) => {
        const perf = perfMap.get(u.user_id) ?? { goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motmCount: 0, ratingSum: 0, ratingCount: 0 };
        const signups = signupMap.get(u.user_id) ?? 0;
        const selected = selectedMap.get(u.user_id) ?? 0;
        const played = playedMap.get(u.user_id) ?? 0;
        return {
          userId: u.user_id, name: u.name, preferredPositions: u.preferred_positions ?? [],
          totalSignups: signups, totalSelected: selected, totalPlayed: played,
          totalGoals: perf.goals, totalAssists: perf.assists, totalCleanSheets: perf.cleanSheets,
          totalYellowCards: perf.yellowCards, totalRedCards: perf.redCards, totalManOfMatch: perf.motmCount,
          avgRating: perf.ratingCount > 0 ? +(perf.ratingSum / perf.ratingCount).toFixed(2) : 0,
          attendanceRate: signups > 0 ? +((played / signups) * 100).toFixed(2) : 0,
          gkAppearances: gkAppearanceMap.get(u.user_id) ?? 0,
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
      const totalCleanSheets  = players.reduce((s, p) => s + p.totalCleanSheets, 0);
      const totalGoalsAgainst = matchHistory.reduce((s, m) => s + m.goalsAgainst, 0);
      const gamesWithResults  = matchHistory.length;
      const wins   = matchHistory.filter(m => m.goalsFor > m.goalsAgainst).length;
      const draws  = matchHistory.filter(m => m.goalsFor === m.goalsAgainst).length;
      const losses = matchHistory.filter(m => m.goalsFor < m.goalsAgainst).length;
      const active = players.filter(p => p.totalSignups > 0);
      const avgAttendance = active.length ? Math.round(active.reduce((s, p) => s + p.attendanceRate, 0) / active.length) : 0;
      const topScorer   = players.reduce((b, p) => p.totalGoals        > (b?.totalGoals ?? -1)        ? p : b, null as PlayerRow | null);
      const topAssister = players.reduce((b, p) => p.totalAssists      > (b?.totalAssists ?? -1)      ? p : b, null as PlayerRow | null);
      const topKeeper   = players.reduce((b, p) => p.totalCleanSheets  > (b?.totalCleanSheets ?? -1)  ? p : b, null as PlayerRow | null);
      const topMotm     = players.reduce((b, p) => p.totalManOfMatch   > (b?.totalManOfMatch ?? -1)   ? p : b, null as PlayerRow | null);
      return {
        totalPlayers: active.length, totalGoals, totalGoalsAgainst, totalAssists, totalCleanSheets,
        avgAttendanceRate: avgAttendance, gamesWithResults, wins, draws, losses,
        avgGoalsFor:     gamesWithResults ? +(totalGoals / gamesWithResults).toFixed(2) : 0,
        avgGoalsAgainst: gamesWithResults ? +(totalGoalsAgainst / gamesWithResults).toFixed(2) : 0,
        topScorer:   topScorer?.totalGoals        ? { name: topScorer.name,   value: topScorer.totalGoals }         : null,
        topAssister: topAssister?.totalAssists    ? { name: topAssister.name, value: topAssister.totalAssists }     : null,
        topKeeper:   topKeeper?.totalCleanSheets  ? { name: topKeeper.name,   value: topKeeper.totalCleanSheets }   : null,
        topMotm:     topMotm?.totalManOfMatch     ? { name: topMotm.name,     value: topMotm.totalManOfMatch }      : null,
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

// GET /api/players/statistics/highlights — per-match highlights with goal events + clean sheets
router.get('/statistics/highlights', authenticate, async (req, res, next) => {
  try {
    const y = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
    const matchTypeFilter = (req.query.matchType as string | undefined) ?? 'all';

    let q = supabaseAdmin
      .from('match_results')
      .select('match_id, goals_for, goals_against, game_assessment, goal_events, long_read, matches!inner(match_date, match_time, location, opponent, match_type, status)')
      .eq('matches.status', 'completed')
      .gte('matches.match_date', `${y}-01-01`)
      .lte('matches.match_date', `${y}-12-31`);
    if (matchTypeFilter !== 'all') q = q.eq('matches.match_type', matchTypeFilter);
    const { data: results, error } = await q.order('match_id');
    if (error) throw error;

    // Collect all player IDs referenced in goal events
    const playerIds = new Set<string>();
    for (const r of (results ?? [])) {
      for (const g of (r.goal_events ?? [])) {
        if (g.scorerId)   playerIds.add(g.scorerId);
        if (g.assisterId) playerIds.add(g.assisterId);
      }
    }

    const matchIds = (results ?? []).map((r: any) => r.match_id);

    const [{ data: users }, { data: cardPerfs }] = await Promise.all([
      playerIds.size > 0
        ? supabaseAdmin.from('users').select('user_id, name').in('user_id', [...playerIds])
        : Promise.resolve({ data: [] as any[], error: null }),
      matchIds.length > 0
        ? supabaseAdmin.from('match_performance')
            .select('match_id, player_id, clean_sheet, yellow_cards, red_cards, man_of_match, users!match_performance_player_id_fkey(name)')
            .in('match_id', matchIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const nameMap = new Map<string, string>();
    for (const u of (users ?? [])) nameMap.set(u.user_id, u.name);

    const cleanSheetMap = new Map<string, string[]>();
    const yellowCardMap = new Map<string, string[]>();
    const redCardMap    = new Map<string, string[]>();
    const motmMap       = new Map<string, string>();
    for (const p of (cardPerfs ?? [])) {
      const pname = p.users?.name ?? 'Unknown';
      if (p.clean_sheet) {
        const arr = cleanSheetMap.get(p.match_id) ?? [];
        arr.push(pname);
        cleanSheetMap.set(p.match_id, arr);
      }
      if ((p.yellow_cards ?? 0) > 0) {
        const arr = yellowCardMap.get(p.match_id) ?? [];
        arr.push(pname);
        yellowCardMap.set(p.match_id, arr);
      }
      if ((p.red_cards ?? 0) > 0) {
        const arr = redCardMap.get(p.match_id) ?? [];
        arr.push(pname);
        redCardMap.set(p.match_id, arr);
      }
      if (p.man_of_match) {
        motmMap.set(p.match_id, pname);
      }
    }

    const highlights = (results ?? []).map((r: any) => ({
      matchId:        r.match_id,
      matchDate:      r.matches.match_date,
      matchTime:      r.matches.match_time,
      location:       r.matches.location,
      opponent:       r.matches.opponent ?? null,
      matchType:      r.matches.match_type,
      goalsFor:       Number(r.goals_for),
      goalsAgainst:   Number(r.goals_against),
      gameAssessment: r.game_assessment ?? null,
      goals: (r.goal_events ?? []).map((g: any) => ({
        scorerName:   g.scorerId   ? (nameMap.get(g.scorerId)   ?? 'Unknown') : null,
        assisterName: g.assisterId ? (nameMap.get(g.assisterId) ?? null)      : null,
      })),
      cleanSheets:  cleanSheetMap.get(r.match_id) ?? [],
      yellowCards:  yellowCardMap.get(r.match_id) ?? [],
      redCards:     redCardMap.get(r.match_id)    ?? [],
      manOfMatch:   motmMap.get(r.match_id)       ?? null,
      longRead:     r.long_read                   ?? null,
    })).sort((a: any, b: any) => b.matchDate.localeCompare(a.matchDate));

    res.json({ success: true, data: { highlights } });
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

    const [{ data: profile }, { data: recent }, { data: perfRows }, { data: signupRows }, { data: selectionMatchRows }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').eq('user_id', playerId).single(),
      supabaseAdmin.from('match_performance').select('*, matches(match_date)').eq('player_id', playerId).order('submitted_at', { ascending: false }).limit(10),
      supabaseAdmin.from('match_performance').select('goals, assists, saves, clean_sheet, self_rating, man_of_match').eq('player_id', playerId),
      supabaseAdmin.from('signups').select('signup_id').eq('player_id', playerId).eq('is_active', true),
      supabaseAdmin.from('selections').select('match_id').eq('player_id', playerId),
    ]);

    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
      return;
    }

    // Count played = selections for completed matches (attendance is assumed for selected players)
    const selMatchIds = (selectionMatchRows ?? []).map((s: any) => s.match_id);
    let playedCount = 0;
    if (selMatchIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .in('match_id', selMatchIds)
        .eq('status', 'completed');
      playedCount = count ?? 0;
    }

    const rows = perfRows ?? [];
    const goals       = rows.reduce((s: number, r: any) => s + (r.goals ?? 0), 0);
    const assists     = rows.reduce((s: number, r: any) => s + (r.assists ?? 0), 0);
    const saves       = rows.reduce((s: number, r: any) => s + (r.saves ?? 0), 0);
    const cleanSheets = rows.filter((r: any) => r.clean_sheet).length;
    const manOfMatch  = rows.filter((r: any) => r.man_of_match).length;
    const totalSignups = signupRows?.length ?? 0;
    const ratedRows   = rows.filter((r: any) => r.self_rating != null);
    const avgRating   = ratedRows.length > 0 ? +(ratedRows.reduce((s: number, r: any) => s + r.self_rating, 0) / ratedRows.length).toFixed(2) : null;

    const stats = {
      total_played: playedCount,
      total_goals: goals, total_assists: assists,
      total_saves: saves, total_clean_sheets: cleanSheets,
      total_man_of_match: manOfMatch,
      total_signups: totalSignups,
      avg_self_rating: avgRating,
      attendance_rate: totalSignups > 0 ? +((playedCount / totalSignups) * 100).toFixed(2) : 0,
    };

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
          cleanSheet: mp.clean_sheet ?? false,
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
