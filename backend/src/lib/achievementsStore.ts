// DB glue around the pure achievement engine (achievements.ts).
//
// Assembles a PlayerSeasonInput from the database, runs computeForPlayer, and
// persists earned crests + streak caches idempotently. Used by the result-
// recording route (recompute on the fly), the backfill script, and the read
// routes.

import { supabaseAdmin } from './supabase.js';
import { seasonStartYear } from './season.js';
import { playedMatch } from './participation.js';
import { computeForPlayer, computeTeam, type PlayerMatch, type PlayerSeasonInput, type PlayerAchievementResult, type TeamMatch } from './achievements.js';

// Achievements span ALL competitions — there is one crest ladder, not one per
// match type — so seasons use the shared helper's mixed-competition scope,
// which groups by calendar year (see season.ts). The Achievements UI labels
// the season accordingly.
export function seasonYearOf(dateStr: string): number {
  return seasonStartYear(dateStr, 'all');
}

interface CompletedMatch { match_id: string; match_date: string }
interface MatchWin { win: boolean }

/** All completed matches + a per-match win/loss/draw lookup from results. */
async function loadCompletedMatches(): Promise<{ matches: CompletedMatch[]; winByMatch: Map<string, boolean> }> {
  const [{ data: matches }, { data: results }] = await Promise.all([
    supabaseAdmin.from('matches').select('match_id, match_date').eq('status', 'completed'),
    supabaseAdmin.from('match_results').select('match_id, goals_for, goals_against'),
  ]);
  const winByMatch = new Map<string, boolean>();
  for (const r of (results ?? []) as any[]) {
    winByMatch.set(r.match_id, (r.goals_for ?? 0) > (r.goals_against ?? 0)); // draw counts as not-a-win
  }
  return { matches: (matches ?? []) as CompletedMatch[], winByMatch };
}

/** Build one player's season input from their selections / sign-ups / performance. */
async function buildInput(
  playerId: string,
  seasonYear: number,
  seasonMatches: CompletedMatch[],
  winByMatch: Map<string, boolean>,
): Promise<PlayerSeasonInput> {
  const seasonIds = new Set(seasonMatches.map(m => m.match_id));

  const [{ data: sel }, { data: sign }, { data: perf }] = await Promise.all([
    supabaseAdmin.from('selections').select('match_id').eq('player_id', playerId),
    supabaseAdmin.from('signups').select('match_id, withdrawn_at').eq('player_id', playerId),
    supabaseAdmin.from('match_performance').select('match_id, attended, goals, assists, clean_sheet, man_of_match').eq('player_id', playerId),
  ]);

  const selected = new Set((sel ?? []).map((s: any) => s.match_id));
  const signups = new Map<string, { withdrew: boolean }>();
  for (const s of (sign ?? []) as any[]) signups.set(s.match_id, { withdrew: s.withdrawn_at != null });
  const perfByMatch = new Map<string, any>();
  for (const p of (perf ?? []) as any[]) perfByMatch.set(p.match_id, p);

  const matches: PlayerMatch[] = seasonMatches
    .slice()
    .sort((a, b) => a.match_date.localeCompare(b.match_date))
    .map(m => {
      const p = perfByMatch.get(m.match_id);
      const su = signups.get(m.match_id);
      return {
        matchId: m.match_id,
        date: m.match_date,
        selected: selected.has(m.match_id),
        played: playedMatch(selected.has(m.match_id), p?.attended),
        signedUp: !!su,
        withdrew: su?.withdrew ?? false,
        goals: p?.goals ?? 0,
        assists: p?.assists ?? 0,
        cleanSheet: !!p?.clean_sheet,
        manOfMatch: !!p?.man_of_match,
        win: winByMatch.has(m.match_id) ? winByMatch.get(m.match_id)! : null,
      };
    });

  return { seasonYear, matches };
}

async function persist(playerId: string, seasonYear: number, result: PlayerAchievementResult): Promise<void> {
  const earnedRows = result.earned.map(e => ({
    player_id: playerId,
    achievement_code: e.code,
    tier: e.tier,
    season_year: seasonYear,
    progress: e.progress,
  }));
  if (earnedRows.length > 0) {
    // ignoreDuplicates: keep the original earned_at on a tier already held.
    await supabaseAdmin
      .from('player_achievements')
      .upsert(earnedRows, { onConflict: 'player_id,achievement_code,tier,season_year', ignoreDuplicates: true });
  }

  const streakRows = result.streaks.map(s => ({
    player_id: playerId,
    streak_type: s.type,
    season_year: seasonYear,
    current_count: s.current,
    record_count: s.record,
    current_start_date: s.currentStartDate,
    updated_at: new Date().toISOString(),
  }));
  // Streaks always update (current/record move over time).
  await supabaseAdmin
    .from('player_streaks')
    .upsert(streakRows, { onConflict: 'player_id,streak_type,season_year' });
}

/** Recompute + persist for the given players in the season of `matchId`. */
export async function recomputeForMatch(matchId: string, playerIds: string[]): Promise<void> {
  if (playerIds.length === 0) return;
  const { data: match } = await supabaseAdmin.from('matches').select('match_date').eq('match_id', matchId).single();
  if (!match) return;
  const seasonYear = seasonYearOf(match.match_date);
  const { matches, winByMatch } = await loadCompletedMatches();
  const seasonMatches = matches.filter(m => seasonYearOf(m.match_date) === seasonYear);
  for (const playerId of [...new Set(playerIds)]) {
    const input = await buildInput(playerId, seasonYear, seasonMatches, winByMatch);
    await persist(playerId, seasonYear, computeForPlayer(input));
  }
}

/** Live result for one player/season (for the read route), no persistence. */
export async function computePlayerSeason(playerId: string, seasonYear: number): Promise<PlayerAchievementResult> {
  const { matches, winByMatch } = await loadCompletedMatches();
  const seasonMatches = matches.filter(m => seasonYearOf(m.match_date) === seasonYear);
  const input = await buildInput(playerId, seasonYear, seasonMatches, winByMatch);
  return computeForPlayer(input);
}

/** Live team/collective crests for a season (computed from results, not persisted). */
export async function computeTeamSeason(seasonYear: number) {
  const { data: matches } = await supabaseAdmin
    .from('matches')
    .select('match_id, match_date, match_results(goals_for, goals_against)')
    .eq('status', 'completed');
  const teamMatches: TeamMatch[] = (matches ?? [])
    .filter((m: any) => seasonYearOf(m.match_date) === seasonYear)
    .map((m: any) => {
      const r = Array.isArray(m.match_results) ? m.match_results[0] : m.match_results;
      return r ? { date: m.match_date, win: (r.goals_for ?? 0) > (r.goals_against ?? 0), goalsAgainst: r.goals_against ?? 0 } : null;
    })
    .filter((x: TeamMatch | null): x is TeamMatch => x !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return computeTeam({ seasonYear, matches: teamMatches });
}

/** Seasons (calendar years) that have completed matches, newest first. */
export async function seasonsWithMatches(): Promise<number[]> {
  const { data } = await supabaseAdmin.from('matches').select('match_date').eq('status', 'completed');
  return [...new Set((data ?? []).map((m: any) => seasonYearOf(m.match_date)))].sort((a, b) => b - a);
}

/** Every non-placeholder, non-merged player id (for backfill). */
export async function allRealPlayerIds(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('user_id')
    .eq('is_placeholder', false)
    .is('merged_into', null);
  return (data ?? []).map((u: any) => u.user_id);
}

/** Backfill every player across every season. Idempotent. */
export async function backfillAll(): Promise<{ players: number; seasons: number }> {
  const { matches, winByMatch } = await loadCompletedMatches();
  const seasons = [...new Set(matches.map(m => seasonYearOf(m.match_date)))];
  const playerIds = await allRealPlayerIds();
  for (const seasonYear of seasons) {
    const seasonMatches = matches.filter(m => seasonYearOf(m.match_date) === seasonYear);
    for (const playerId of playerIds) {
      const input = await buildInput(playerId, seasonYear, seasonMatches, winByMatch);
      await persist(playerId, seasonYear, computeForPlayer(input));
    }
  }
  return { players: playerIds.length, seasons: seasons.length };
}
