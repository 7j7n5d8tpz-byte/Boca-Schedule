import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { storeAvatar, AvatarTooLargeError, AVATAR_DATA_URL_RE } from '../lib/avatar.js';
import { seasonStartYear, seasonRange, seasonLabel } from '../lib/season.js';
import { computeMatchRating, averageRating, matchResult, type MatchResult } from '../lib/rating.js';

const router = Router();

const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  preferredPositions: z.array(z.enum(['GK', 'DEF', 'WIN', 'MID', 'STR'])).optional(),
});

// GET /api/players — all registered players except self
router.get('/', authenticate, async (req, res, next) => {
  try {
    // Roster for selection / signup pickers: real people only. Placeholder
    // players (historical-import stand-ins, not yet registered) and merged
    // tombstones must not be selectable for future matches.
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('user_id, name, preferred_positions')
      .neq('user_id', req.user!.userId)
      .eq('is_placeholder', false)
      .is('merged_into', null)
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
    const matchTypeFilter = (req.query.matchType as string | undefined) ?? 'all';

    // Fetch all players and available seasons in parallel
    const [{ data: allUsers }, { data: allMatchDates }] = await Promise.all([
      // Include placeholder players so their backfilled history shows in stats;
      // exclude merged tombstones. (Placeholders are excluded from the GET /
      // selection roster instead — they can't be picked for future matches.)
      supabaseAdmin.from('users').select('user_id, name, preferred_positions, avatar_url').in('role', ['player', 'coach', 'admin']).or('is_active.eq.true,is_placeholder.eq.true').is('merged_into', null).order('name'),
      supabaseAdmin.from('matches').select('match_date, match_type').in('status', ['completed', 'published']),
    ]);

    // Available seasons depend on the competition: futsal seasons cross the New
    // Year ("2025/26"); outdoor seasons are calendar years. A season is keyed by
    // its start year (a number), labelled per the selected match type.
    const availableYears = [...new Set(
      (allMatchDates ?? [])
        .filter((m: any) => matchTypeFilter === 'all' || m.match_type === matchTypeFilter)
        .map((m: any) => seasonStartYear(m.match_date, matchTypeFilter))
    )].sort((a, b) => b - a);

    const defaultYear = availableYears[0] ?? new Date().getFullYear();
    const year = req.query.year ? parseInt(req.query.year as string) : defaultYear;

    type PlayerRow = {
      userId: string; name: string; preferredPositions: string[]; avatarUrl: string | null;
      totalSignups: number; totalSelected: number; totalPlayed: number;
      totalGoals: number; totalAssists: number; totalCleanSheets: number;
      totalYellowCards: number; totalRedCards: number; totalManOfMatch: number;
      avgRating: number; attendanceRate: number; gkAppearances: number;
    };
    type MatchRow = { matchId: string; matchDate: string; location: string; opponent: string | null; goalsFor: number; goalsAgainst: number };

    async function getYearData(y: number): Promise<{ players: PlayerRow[]; matchHistory: MatchRow[]; teamGames: number }> {
      const { start, end } = seasonRange(y, matchTypeFilter);
      let yearMatchQuery = supabaseAdmin
        .from('matches').select('match_id')
        .gte('match_date', start).lte('match_date', end);
      if (matchTypeFilter !== 'all') yearMatchQuery = yearMatchQuery.eq('match_type', matchTypeFilter);
      const { data: yearMatches } = await yearMatchQuery;

      const matchIds = (yearMatches ?? []).map((m: any) => m.match_id);
      if (matchIds.length === 0) {
        // No matches this year, but still show the whole active roster with
        // zeroed stats — otherwise the "All players" table is empty whenever
        // the selected year has no matches yet.
        const players: PlayerRow[] = (allUsers ?? []).map((u: any) => ({
          userId: u.user_id, name: u.name, preferredPositions: u.preferred_positions ?? [], avatarUrl: u.avatar_url ?? null,
          totalSignups: 0, totalSelected: 0, totalPlayed: 0,
          totalGoals: 0, totalAssists: 0, totalCleanSheets: 0,
          totalYellowCards: 0, totalRedCards: 0, totalManOfMatch: 0,
          avgRating: 0, attendanceRate: 0, gkAppearances: 0,
        }));
        return { players, matchHistory: [], teamGames: 0 };
      }

      const [{ data: perfData }, { data: signupData }, { data: selectionData }, { data: historyData }, { data: completedMatchData }, { data: gkData }] = await Promise.all([
        supabaseAdmin.from('match_performance').select('match_id, player_id, goals, assists, clean_sheet, yellow_cards, red_cards, man_of_match').in('match_id', matchIds),
        supabaseAdmin.from('signups').select('player_id').eq('is_active', true).in('match_id', matchIds),
        supabaseAdmin.from('selections').select('player_id, match_id').in('match_id', matchIds),
        supabaseAdmin.from('match_results')
          .select('match_id, goals_for, goals_against, matches(match_date, location, opponent)')
          .in('match_id', matchIds).order('recorded_at', { ascending: true }),
        supabaseAdmin.from('matches').select('match_id').eq('status', 'completed').in('match_id', matchIds),
        supabaseAdmin.from('match_results').select('match_id, gk_first_half, gk_second_half').in('match_id', matchIds),
      ]);

      const completedIds = new Set((completedMatchData ?? []).map((m: any) => m.match_id));

      // Position lookup (for position-aware ratings) and team result per match.
      const positionMap = new Map<string, string[]>();
      (allUsers ?? []).forEach((u: any) => positionMap.set(u.user_id, u.preferred_positions ?? []));
      const resultMap = new Map<string, MatchResult>();
      (historyData ?? []).forEach((r: any) => resultMap.set(r.match_id, matchResult(Number(r.goals_for), Number(r.goals_against))));

      // Halves in goal, both as a season total (gkAppearanceMap) and per match+player
      // (gkHalvesMap, used to credit goalkeeping in the per-match rating).
      const gkAppearanceMap = new Map<string, number>();
      const gkHalvesMap = new Map<string, number>();
      for (const r of (gkData ?? [])) {
        for (const id of [r.gk_first_half, r.gk_second_half]) {
          if (!id) continue;
          gkAppearanceMap.set(id, (gkAppearanceMap.get(id) ?? 0) + 1);
          const key = `${r.match_id}:${id}`;
          gkHalvesMap.set(key, (gkHalvesMap.get(key) ?? 0) + 1);
        }
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

      const perfMap = new Map<string, { goals: number; assists: number; cleanSheets: number; yellowCards: number; redCards: number; motmCount: number; ratings: number[] }>();
      (perfData ?? []).forEach((p: any) => {
        const c = perfMap.get(p.player_id) ?? { goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motmCount: 0, ratings: [] };
        const rating = computeMatchRating({
          goals: p.goals, assists: p.assists, cleanSheet: p.clean_sheet,
          gkHalves: gkHalvesMap.get(`${p.match_id}:${p.player_id}`) ?? 0,
          manOfMatch: p.man_of_match, yellowCards: p.yellow_cards, redCards: p.red_cards,
          result: resultMap.get(p.match_id) ?? null,
        }, positionMap.get(p.player_id));
        perfMap.set(p.player_id, {
          goals: c.goals + (p.goals ?? 0),
          assists: c.assists + (p.assists ?? 0),
          cleanSheets: c.cleanSheets + (p.clean_sheet ? 1 : 0),
          yellowCards: c.yellowCards + (p.yellow_cards ?? 0),
          redCards: c.redCards + (p.red_cards ?? 0),
          motmCount: c.motmCount + (p.man_of_match ? 1 : 0),
          ratings: [...c.ratings, rating],
        });
      });

      const players: PlayerRow[] = (allUsers ?? []).map((u: any) => {
        const perf = perfMap.get(u.user_id) ?? { goals: 0, assists: 0, cleanSheets: 0, yellowCards: 0, redCards: 0, motmCount: 0, ratings: [] };
        const signups = signupMap.get(u.user_id) ?? 0;
        const selected = selectedMap.get(u.user_id) ?? 0;
        const played = playedMap.get(u.user_id) ?? 0;
        return {
          userId: u.user_id, name: u.name, preferredPositions: u.preferred_positions ?? [], avatarUrl: u.avatar_url ?? null,
          totalSignups: signups, totalSelected: selected, totalPlayed: played,
          totalGoals: perf.goals, totalAssists: perf.assists, totalCleanSheets: perf.cleanSheets,
          totalYellowCards: perf.yellowCards, totalRedCards: perf.redCards, totalManOfMatch: perf.motmCount,
          avgRating: averageRating(perf.ratings) ?? 0,
          // Attendance = share of the team's completed matches this player featured
          // in (played / total team games), so it reads "X of N games".
          attendanceRate: completedIds.size > 0 ? +((played / completedIds.size) * 100).toFixed(2) : 0,
          gkAppearances: gkAppearanceMap.get(u.user_id) ?? 0,
        };
      });
      // Return the whole active roster — players who haven't appeared in a match
      // yet show with zeroed stats rather than being hidden.

      const matchHistory: MatchRow[] = (historyData ?? []).map((r: any) => ({
        matchId: r.match_id,
        matchDate: r.matches?.match_date ?? '',
        location: r.matches?.location ?? '',
        opponent: r.matches?.opponent ?? null,
        goalsFor: Number(r.goals_for),
        goalsAgainst: Number(r.goals_against),
      }));

      return { players, matchHistory, teamGames: completedIds.size };
    }

    function buildOverview(players: PlayerRow[], matchHistory: MatchRow[], teamGames: number) {
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
      // Goalkeepers are ranked by time in goal (halves kept), not clean sheets —
      // clean sheets are too rare to rank by. Ties broken by clean sheets.
      const topGk       = players.reduce((b, p) => (p.gkAppearances > (b?.gkAppearances ?? -1) || (p.gkAppearances === (b?.gkAppearances ?? -1) && p.totalCleanSheets > (b?.totalCleanSheets ?? -1))) ? p : b, null as PlayerRow | null);
      const topMotm     = players.reduce((b, p) => p.totalManOfMatch   > (b?.totalManOfMatch ?? -1)   ? p : b, null as PlayerRow | null);
      return {
        totalPlayers: active.length, totalGoals, totalGoalsAgainst, totalAssists, totalCleanSheets,
        avgAttendanceRate: avgAttendance, gamesWithResults, teamGames, wins, draws, losses,
        avgGoalsFor:     gamesWithResults ? +(totalGoals / gamesWithResults).toFixed(2) : 0,
        avgGoalsAgainst: gamesWithResults ? +(totalGoalsAgainst / gamesWithResults).toFixed(2) : 0,
        topScorer:   topScorer?.totalGoals        ? { name: topScorer.name,   value: topScorer.totalGoals }         : null,
        topAssister: topAssister?.totalAssists    ? { name: topAssister.name, value: topAssister.totalAssists }     : null,
        topGk:       topGk?.gkAppearances         ? { name: topGk.name, halves: topGk.gkAppearances, cleanSheets: topGk.totalCleanSheets } : null,
        topMotm:     topMotm?.totalManOfMatch     ? { name: topMotm.name,     value: topMotm.totalManOfMatch }      : null,
      };
    }

    const [current, prev] = await Promise.all([getYearData(year), getYearData(year - 1)]);

    res.json({
      success: true,
      data: {
        year,
        seasonLabel: seasonLabel(year, matchTypeFilter),
        availableSeasons: (availableYears.length > 0 ? availableYears : [year]).map(y => ({ year: y, label: seasonLabel(y, matchTypeFilter) })),
        overview: buildOverview(current.players, current.matchHistory, current.teamGames),
        prevYear: year - 1,
        prevSeasonLabel: seasonLabel(year - 1, matchTypeFilter),
        prevOverview: buildOverview(prev.players, prev.matchHistory, prev.teamGames),
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
    const { start, end } = seasonRange(y, matchTypeFilter);

    let q = supabaseAdmin
      .from('match_results')
      .select('match_id, goals_for, goals_against, game_assessment, goal_events, long_read, gk_first_half, gk_second_half, matches!inner(match_date, match_time, location, opponent, match_type, status)')
      .eq('matches.status', 'completed')
      .gte('matches.match_date', start)
      .lte('matches.match_date', end);
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
            .select('match_id, player_id, attended, clean_sheet, yellow_cards, red_cards, man_of_match, users!match_performance_player_id_fkey(name)')
            .in('match_id', matchIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const nameMap = new Map<string, string>();
    for (const u of (users ?? [])) nameMap.set(u.user_id, u.name);

    // Build per-match scorer/assister/GK sets
    const scorersByMatch   = new Map<string, Set<string>>();
    const assistersByMatch = new Map<string, Set<string>>();
    const gkByMatch        = new Map<string, Set<string>>();
    for (const r of (results ?? [])) {
      const scorers   = new Set<string>();
      const assisters = new Set<string>();
      for (const g of (r.goal_events ?? [])) {
        if (g.scorerId)   scorers.add(g.scorerId);
        if (g.assisterId) assisters.add(g.assisterId);
      }
      scorersByMatch.set(r.match_id, scorers);
      assistersByMatch.set(r.match_id, assisters);
      const gks = new Set<string>();
      if (r.gk_first_half)  gks.add(r.gk_first_half);
      if (r.gk_second_half) gks.add(r.gk_second_half);
      gkByMatch.set(r.match_id, gks);
    }

    const cleanSheetMap = new Map<string, string[]>();
    const yellowCardMap = new Map<string, string[]>();
    const redCardMap    = new Map<string, string[]>();
    const motmMap       = new Map<string, string>();
    const playersMap    = new Map<string, { name: string; isScorer: boolean; isAssister: boolean; isGoalkeeper: boolean }[]>();
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
      if (p.attended) {
        const arr = playersMap.get(p.match_id) ?? [];
        arr.push({
          name:         pname,
          isScorer:     (scorersByMatch.get(p.match_id)   ?? new Set()).has(p.player_id),
          isAssister:   (assistersByMatch.get(p.match_id) ?? new Set()).has(p.player_id),
          isGoalkeeper: (gkByMatch.get(p.match_id)        ?? new Set()).has(p.player_id),
        });
        playersMap.set(p.match_id, arr);
      }
    }

    // Sort each match's player list: GKs first, then alphabetically
    for (const [mid, arr] of playersMap) {
      arr.sort((a, b) => {
        if (a.isGoalkeeper !== b.isGoalkeeper) return a.isGoalkeeper ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      playersMap.set(mid, arr);
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
      players:      playersMap.get(r.match_id)    ?? [],
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

    const yearParam = req.query.year ? parseInt(req.query.year as string) : undefined;

    const [{ data: profile }, { data: recent }, { data: perfRows }, { data: signupRows }, { data: selectionMatchRows }, { data: completedMatches }, { data: resultRows }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').eq('user_id', playerId).single(),
      supabaseAdmin.from('match_performance').select('*, matches(match_date)').eq('player_id', playerId).order('submitted_at', { ascending: false }).limit(10),
      supabaseAdmin.from('match_performance').select('match_id, goals, assists, saves, clean_sheet, yellow_cards, red_cards, man_of_match').eq('player_id', playerId),
      supabaseAdmin.from('signups').select('match_id').eq('player_id', playerId).eq('is_active', true),
      supabaseAdmin.from('selections').select('match_id').eq('player_id', playerId),
      supabaseAdmin.from('matches').select('match_id, match_date').eq('status', 'completed'),
      supabaseAdmin.from('match_results').select('match_id, goals_for, goals_against, gk_first_half, gk_second_half'),
    ]);

    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
      return;
    }

    // Scope every figure to ONE season (calendar year). Default to the most recent
    // season that has completed matches so a player's home shows their current run,
    // not a lifetime total. Attendance & "games" use the team's games that season.
    const seasonYears = [...new Set((completedMatches ?? []).map((m: any) => new Date(m.match_date).getFullYear()))].sort((a, b) => b - a);
    const season = yearParam ?? seasonYears[0] ?? new Date().getFullYear();
    const seasonMatchIds = new Set(
      (completedMatches ?? []).filter((m: any) => new Date(m.match_date).getFullYear() === season).map((m: any) => m.match_id),
    );
    const teamGames = seasonMatchIds.size;

    // Played = completed matches this season the player was selected for.
    const playedCount = (selectionMatchRows ?? []).filter((s: any) => seasonMatchIds.has(s.match_id)).length;

    const rows = (perfRows ?? []).filter((r: any) => seasonMatchIds.has(r.match_id));
    const goals       = rows.reduce((s: number, r: any) => s + (r.goals ?? 0), 0);
    const assists     = rows.reduce((s: number, r: any) => s + (r.assists ?? 0), 0);
    const saves       = rows.reduce((s: number, r: any) => s + (r.saves ?? 0), 0);
    const cleanSheets = rows.filter((r: any) => r.clean_sheet).length;
    const manOfMatch  = rows.filter((r: any) => r.man_of_match).length;
    const totalSignups = (signupRows ?? []).filter((s: any) => seasonMatchIds.has(s.match_id)).length;

    // Computed performance rating: score each match the player featured in from the
    // recorded events (position-aware) and average across the season.
    const positions = profile.preferred_positions ?? [];
    const resultMap = new Map<string, MatchResult>();
    const gkHalvesMap = new Map<string, number>();
    (resultRows ?? []).forEach((r: any) => {
      resultMap.set(r.match_id, matchResult(Number(r.goals_for), Number(r.goals_against)));
      for (const id of [r.gk_first_half, r.gk_second_half]) {
        if (id === playerId) gkHalvesMap.set(r.match_id, (gkHalvesMap.get(r.match_id) ?? 0) + 1);
      }
    });
    const avgRating = averageRating(rows.map((r: any) => computeMatchRating({
      goals: r.goals, assists: r.assists, cleanSheet: r.clean_sheet,
      gkHalves: gkHalvesMap.get(r.match_id) ?? 0,
      manOfMatch: r.man_of_match, yellowCards: r.yellow_cards, redCards: r.red_cards,
      result: resultMap.get(r.match_id) ?? null,
    }, positions)));

    const stats = {
      season_year: season,
      total_team_games: teamGames,
      total_played: playedCount,
      total_goals: goals, total_assists: assists,
      total_saves: saves, total_clean_sheets: cleanSheets,
      total_man_of_match: manOfMatch,
      total_signups: totalSignups,
      avg_rating: avgRating,
      // Attendance = share of the team's games this season the player featured in.
      attendance_rate: teamGames > 0 ? +((playedCount / teamGames) * 100).toFixed(2) : 0,
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

// PUT /api/players/:playerId/avatar — upload a cropped profile picture.
// The client sends an already-cropped, resized webp as a data URL; we just
// decode it and store it. Bucket + column come from migration 20260614000001.
const AvatarSchema = z.object({
  image: z.string().regex(AVATAR_DATA_URL_RE, 'Expected a base64 image data URL'),
});

router.put('/:playerId/avatar', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;
    if (playerId !== req.user!.userId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot edit another user\'s photo' } });
      return;
    }

    const body = AvatarSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid image' } });
      return;
    }

    let avatarUrl: string;
    try {
      avatarUrl = await storeAvatar(playerId as string, body.data.image);
    } catch (err) {
      if (err instanceof AvatarTooLargeError) {
        res.status(413).json({ success: false, error: { code: 'TOO_LARGE', message: 'Image too large' } });
        return;
      }
      throw err;
    }

    const { error } = await supabaseAdmin.from('users').update({ avatar_url: avatarUrl }).eq('user_id', playerId);
    if (error) throw error;

    res.json({ success: true, data: { avatarUrl } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/players/:playerId/avatar — remove the profile picture.
router.delete('/:playerId/avatar', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;
    if (playerId !== req.user!.userId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot edit another user\'s photo' } });
      return;
    }

    await supabaseAdmin.storage.from('avatars').remove([`${playerId}.webp`, `${playerId}.png`, `${playerId}.jpeg`]);
    const { error } = await supabaseAdmin.from('users').update({ avatar_url: null }).eq('user_id', playerId);
    if (error) throw error;

    res.json({ success: true, data: { avatarUrl: null } });
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
