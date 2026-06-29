// Computed match performance rating.
//
// The app never collected the `self_rating` field the old "Avg rating" stat was
// built on, so that number was always blank. This replaces it with a rating
// derived entirely from data we *do* capture automatically when results are
// entered: goals, assists, clean sheets, halves in goal, Man of Match, cards and
// the team result. Each match yields a 1–10 score; the displayed rating is the
// mean across the matches a player featured in.
//
// The weights are position-aware on purpose. With only offensive events recorded
// per player, a flat goals+assists score would rank defenders last regardless of
// how they actually played, so rarer contributions are worth more for defensive
// roles, and clean sheets (now credited to defenders too — see results route)
// carry real weight for GK/DEF. Weights are deliberately simple constants here so
// they're easy to read and tune against real matches; move them to system_config
// later if runtime tuning is wanted.

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'FWD';
export type MatchResult = 'win' | 'draw' | 'loss';

export interface MatchPerformance {
  goals?: number | null;
  assists?: number | null;
  cleanSheet?: boolean | null;
  /** Halves this player spent in goal that match (0–2). */
  gkHalves?: number | null;
  manOfMatch?: boolean | null;
  yellowCards?: number | null;
  redCards?: number | null;
  /** Team result for the match, or null when no result was recorded. */
  result?: MatchResult | null;
}

const BASE = 6.0;
const MIN = 1.0;
const MAX = 10.0;

// Per-goal / per-assist value by position group: rarer for a role ⇒ worth more,
// so a defender's goal counts for more than a striker's expected one.
const GOAL_WEIGHT:   Record<PositionGroup, number> = { GK: 2.0, DEF: 1.6, MID: 1.1, FWD: 0.8 };
const ASSIST_WEIGHT: Record<PositionGroup, number> = { GK: 1.6, DEF: 1.3, MID: 0.9, FWD: 0.8 };
// Clean sheet is the core reward for defensive roles, a minor bonus for the rest.
const CLEAN_SHEET_BONUS: Record<PositionGroup, number> = { GK: 1.5, DEF: 1.2, MID: 0.4, FWD: 0.2 };

const GK_HALF_BONUS = 0.25; // baseline credit for the thankless job of keeping goal
const MOTM_BONUS    = 1.0;  // the one position-neutral human judgement we capture
const RESULT_BONUS: Record<MatchResult, number> = { win: 0.3, draw: 0, loss: -0.2 };
const YELLOW_PENALTY = 0.3;
const RED_PENALTY    = 1.0;

/** Map a stored preferred-position code (GK/DEF/WIN/MID/STR) to a rating group. */
export function positionGroup(position: string | null | undefined): PositionGroup {
  switch (position) {
    case 'GK':  return 'GK';
    case 'DEF': return 'DEF';
    case 'STR': return 'FWD';
    case 'WIN': // wide players score like attacking midfielders here
    case 'MID': return 'MID';
    // No (known) preferred position: treat as a midfielder, the neutral middle.
    default:    return 'MID';
  }
}

/** A player's primary position is the first of their preferred positions. */
export function primaryPosition(preferredPositions: string[] | null | undefined): string | null {
  return preferredPositions && preferredPositions.length > 0 ? preferredPositions[0] : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Score a single match performance on a 1–10 scale. */
export function computeMatchRating(perf: MatchPerformance, position: string | null | undefined): number {
  const group = positionGroup(position);
  let r = BASE;

  r += (perf.goals   ?? 0) * GOAL_WEIGHT[group];
  r += (perf.assists ?? 0) * ASSIST_WEIGHT[group];
  if (perf.cleanSheet) r += CLEAN_SHEET_BONUS[group];
  r += (perf.gkHalves ?? 0) * GK_HALF_BONUS;
  if (perf.manOfMatch) r += MOTM_BONUS;
  if (perf.result) r += RESULT_BONUS[perf.result];
  r -= (perf.yellowCards ?? 0) * YELLOW_PENALTY;
  r -= (perf.redCards    ?? 0) * RED_PENALTY;

  return clamp(r, MIN, MAX);
}

/** Mean of per-match ratings, rounded to 2dp. Returns null when there are none. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  return +(ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(2);
}

/** Win/draw/loss from the team's goals for/against. */
export function matchResult(goalsFor: number, goalsAgainst: number): MatchResult {
  return goalsFor > goalsAgainst ? 'win' : goalsFor < goalsAgainst ? 'loss' : 'draw';
}
