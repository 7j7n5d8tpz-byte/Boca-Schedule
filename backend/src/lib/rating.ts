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

interface GroupWeights { goal: number; assist: number; cleanSheet: number; }

// Value of a goal / assist / clean sheet by position group. Rarer for a role ⇒
// worth more, so a defender's goal counts for more than a striker's expected one,
// and a clean sheet is the core reward for defensive roles, a minor bonus for the
// rest.
const WEIGHTS: Record<PositionGroup, GroupWeights> = {
  GK:  { goal: 2.0, assist: 1.6, cleanSheet: 1.5 },
  DEF: { goal: 1.6, assist: 1.3, cleanSheet: 1.2 },
  MID: { goal: 1.1, assist: 0.9, cleanSheet: 0.4 },
  FWD: { goal: 0.8, assist: 0.8, cleanSheet: 0.2 },
};

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

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Decide how to weight a match. Preferred positions are an unordered *set* (the
// order players tick them in carries no meaning, and the rest of the app treats
// them as a set), so we never single one out. Goalkeeping is the one role we can
// observe per match: if the player actually kept goal, weight the whole match as a
// keeper. Otherwise blend their preferred outfield roles by averaging the weights
// — a DEF/STR player sits halfway between the two — and ignore a GK preference for
// matches they didn't keep goal in.
function effectiveWeights(positions: string[] | null | undefined, keptGoal: boolean): GroupWeights {
  if (keptGoal) return WEIGHTS.GK;
  const groups = [...new Set((positions ?? []).map(positionGroup).filter((g) => g !== 'GK'))];
  const outfield: PositionGroup[] = groups.length > 0 ? groups : ['MID'];
  return {
    goal:       avg(outfield.map((g) => WEIGHTS[g].goal)),
    assist:     avg(outfield.map((g) => WEIGHTS[g].assist)),
    cleanSheet: avg(outfield.map((g) => WEIGHTS[g].cleanSheet)),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Score a single match performance on a 1–10 scale.
 * `positions` is the player's full set of preferred positions (order-insensitive).
 */
export function computeMatchRating(perf: MatchPerformance, positions: string[] | null | undefined): number {
  const halves = perf.gkHalves ?? 0;
  const w = effectiveWeights(positions, halves > 0);
  let r = BASE;

  r += (perf.goals   ?? 0) * w.goal;
  r += (perf.assists ?? 0) * w.assist;
  if (perf.cleanSheet) r += w.cleanSheet;
  r += halves * GK_HALF_BONUS;
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
