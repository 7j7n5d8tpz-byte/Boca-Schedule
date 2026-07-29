// Gamification award engine.
//
// This module is the SINGLE SOURCE OF TRUTH for the achievement catalog and the
// pure logic that decides which crests a player has earned and what their streaks
// are. It is deliberately free of DB/IO so it can be unit-tested directly — the
// routes/trigger/backfill assemble a `PlayerSeasonInput` from the database and feed
// it to `computeForPlayer`.
//
// Crests use a 7-tier ladder (Rocket-League style). A "tier group" (e.g. goals
// scored) has one threshold per tier; reaching a value awards every tier at/under
// it. The UI shows the highest tier earned plus progress toward the next.

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'champion' | 'legend';

/** Low → high. Index doubles as the ordinal rank used by the frontend Crest. */
export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'legend'];

type Category = 'performance' | 'reliability' | 'team';

/** A unique emblem per achievement, drawn by the frontend Crest component. */
type Glyph =
  | 'football' | 'boot' | 'glove' | 'medal' | 'calendar' | 'clipboard'
  | 'flame' | 'chain' | 'bolt' | 'trophy' | 'fortress' | 'swords';

export interface TierGroupDef {
  code: string;
  name: string;
  description: string;
  category: Category;
  glyph: Glyph;
  unit: string;
  /** Exactly 7 thresholds, lowest → highest, aligned to TIERS. */
  thresholds: [number, number, number, number, number, number, number];
  /** A streak group is measured by a player's best run; a count group by a season total. */
  streakType?: StreakType;
}

type StreakType = 'attendance' | 'scoring' | 'clean_sheet' | 'win' | 'no_withdrawal';

// Reaching a reliability tier is shareable ("Ever Present – Gold"), but the EXACT
// signup/selection count behind it is private (existing stats-privacy rule). The
// read routes null out the numeric value of these groups for non-owner viewers,
// leaving only the earned tier badges.
export const PRIVATE_COUNT_CODES = ['matches_played', 'signups_made'];

// ─── Season volume ──────────────────────────────────────────────────────────
// Every ladder is calibrated against this. A season (calendar year, all
// competitions — see achievementsStore.ts) is:
//
//   20  seven-a-side serie
//   10  futsal serie
//    3  seven-a-side pokal   ⎫ win-or-out, so the real number depends on how far
//    3  futsal pokal         ⎭ the team goes; 3 apiece is the working estimate
//   ──
//   36  matches
//
// No count achievement may exceed this — a legend nobody can reach is a dead
// tier, and `signups_made` previously topped out at 40, which is more matches
// than exist. Keep it in sync if the fixture list changes; the engine test
// asserts every threshold fits inside a season.
export const SEASON_MATCHES = 36;

// ─── Catalog ────────────────────────────────────────────────────────────────
// Thresholds are tuned for an amateur club's season volume: bronze is reachable
// almost immediately, legend is a genuine season-long feat that is nonetheless
// achievable. Sized against the 2026 season's measured per-player rates scaled
// to SEASON_MATCHES — the working assumption is that the club's best performer
// in a category lands around diamond/champion, leaving legend as a stretch.
// docs/achievement-tuning.md records the distribution and the arithmetic.

export const ACHIEVEMENT_DEFS: TierGroupDef[] = [
  // Performance — on-pitch output (per season).
  { code: 'goals_scored',  name: 'Goalscorer',   description: 'Goals scored this season',        category: 'performance', glyph: 'football', unit: 'goals',        thresholds: [1, 3, 6, 9, 13, 18, 24] },
  { code: 'assists_made',  name: 'Playmaker',    description: 'Assists made this season',         category: 'performance', glyph: 'boot',     unit: 'assists',      thresholds: [1, 3, 5, 8, 11, 15, 20] },
  // Wall/Fortress are the least data-backed ladders: the reference season kept
  // zero clean sheets in 9 matches, so these are scaled to season length and a
  // recovered defence rather than measured. Revisit after a season with some.
  { code: 'clean_sheets',  name: 'Wall',         description: 'Clean sheets kept this season',    category: 'performance', glyph: 'glove',    unit: 'clean sheets', thresholds: [1, 2, 3, 4, 6, 8, 10] },
  // One award per match, so a whole season only mints SEASON_MATCHES of them
  // across the entire squad; legend at 10 is ~28% of every award going one way.
  { code: 'motm_awards',   name: 'Match Winner', description: 'Man of the Match awards',          category: 'performance', glyph: 'medal',    unit: 'awards',       thresholds: [1, 2, 3, 4, 6, 8, 10] },

  // Reliability — showing up, which is what keeps squads filled (per season).
  // Legend for Ever Present is 28 (78% of the season), the best attendance rate
  // the club has actually managed — 36 would have demanded a perfect record.
  // Always In sits higher because signing up costs nothing but intent; you can
  // put your name down for a match you are not picked for.
  { code: 'matches_played', name: 'Ever Present', description: 'Matches played this season',      category: 'reliability', glyph: 'calendar',  unit: 'matches', thresholds: [1, 4, 8, 12, 17, 22, 28] },
  { code: 'signups_made',   name: 'Always In',    description: 'Matches signed up for this season', category: 'reliability', glyph: 'clipboard', unit: 'sign-ups', thresholds: [1, 5, 10, 15, 21, 27, 33] },

  // Streaks — consecutive runs (measured by the season's best run).
  // Iron Run breaks on any missed match, so it is bounded by attendance rate
  // rather than season length: at the observed 78%, the longest run a dedicated
  // player can expect across 36 matches is low-to-mid teens, hence legend at 14.
  // The old ladder wanted 20 in a row and was only survivable back when the
  // streak could not break at all.
  { code: 'attendance_streak', name: 'Iron Run',    description: 'Matches played without missing one',   category: 'reliability', glyph: 'chain', unit: 'in a row', thresholds: [2, 3, 4, 6, 8, 11, 14], streakType: 'attendance' },
  // Scoring and winning runs only count matches the player featured in, so they
  // are bounded by appearances (~28 at best), not by the 36-match season.
  { code: 'scoring_streak',    name: 'On Fire',     description: 'Consecutive matches with a goal',      category: 'performance', glyph: 'flame', unit: 'in a row', thresholds: [2, 3, 4, 5, 6, 8, 10], streakType: 'scoring' },
  { code: 'win_streak',        name: 'Unstoppable', description: 'Consecutive wins played in',           category: 'performance', glyph: 'bolt',  unit: 'in a row', thresholds: [2, 3, 4, 5, 6, 8, 10], streakType: 'win' },
];


// ─── Inputs / outputs ─────────────────────────────────────────────────────────

export interface PlayerMatch {
  matchId: string;
  date: string;          // YYYY-MM-DD; matches must be passed ordered ascending
  selected: boolean;     // named to the squad
  played: boolean;       // featured in the match — see lib/participation.ts for the shared definition
  signedUp: boolean;     // had an active sign-up
  withdrew: boolean;     // signed up then withdrew
  goals: number;
  assists: number;
  cleanSheet: boolean;
  manOfMatch: boolean;
  win: boolean | null;   // result-based; null when the match has no recorded result
}

export interface PlayerSeasonInput {
  seasonYear: number;
  matches: PlayerMatch[];
}

export interface EarnedTier {
  code: string;
  tier: Tier;
  progress: number;      // measured value when computed (≥ threshold)
}

export interface GroupProgress {
  code: string;
  value: number;         // current measured value
  highestTier: Tier | null;
  nextThreshold: number | null;
}

export interface StreakResult {
  type: StreakType;
  current: number;
  record: number;
  currentStartDate: string | null;
}

export interface PlayerAchievementResult {
  seasonYear: number;
  earned: EarnedTier[];          // every (group, tier) the player qualifies for
  groups: GroupProgress[];       // per-group current value + next target
  streaks: StreakResult[];
}

// ─── Core ──────────────────────────────────────────────────────────────────

/** Highest tier reached for a measured value, and the next threshold to chase. */
export function tiersForValue(thresholds: number[], value: number): { tiers: Tier[]; highest: Tier | null; next: number | null } {
  const tiers: Tier[] = [];
  for (let i = 0; i < TIERS.length; i++) {
    if (value >= thresholds[i]) tiers.push(TIERS[i]);
  }
  const highest = tiers.length ? tiers[tiers.length - 1] : null;
  const nextIdx = tiers.length; // first not-yet-reached tier
  const next = nextIdx < thresholds.length ? thresholds[nextIdx] : null;
  return { tiers, highest, next };
}

/**
 * Longest and trailing run of a boolean signal over an ordered sequence.
 * `counts(m)` decides whether a match participates at all (matches that don't
 * count are skipped, not treated as a break); `hit(m)` is the success test.
 */
function runStreak(matches: PlayerMatch[], counts: (m: PlayerMatch) => boolean, hit: (m: PlayerMatch) => boolean): StreakResult & { type: StreakType } {
  let record = 0;
  let current = 0;
  let currentStart: string | null = null;
  let runStart: string | null = null;
  for (const m of matches) {
    if (!counts(m)) continue;
    if (hit(m)) {
      if (current === 0) runStart = m.date;
      current += 1;
      currentStart = runStart;
      if (current > record) record = current;
    } else {
      current = 0;
      currentStart = null;
    }
  }
  return { type: 'attendance', current, record, currentStartDate: currentStart };
}

export function computeStreaks(input: PlayerSeasonInput): StreakResult[] {
  const m = input.matches;
  const defs: Array<{ type: StreakType; counts: (x: PlayerMatch) => boolean; hit: (x: PlayerMatch) => boolean }> = [
    // Every completed match counts, so missing one breaks the run — including a
    // match the player wasn't picked for. Anything narrower makes Iron Run
    // unbreakable in practice: results are recorded with attended=true for the
    // whole squad, so a selected match always hits, and skipping the rest would
    // leave nothing that can ever break the streak (it would just re-measure
    // total appearances, which is what Ever Present already does).
    { type: 'attendance',    counts: () => true,               hit: x => x.played },
    { type: 'scoring',       counts: x => x.played,            hit: x => x.goals > 0 },
    { type: 'clean_sheet',   counts: x => x.played,            hit: x => x.cleanSheet },
    { type: 'win',           counts: x => x.played && x.win !== null, hit: x => x.win === true },
    { type: 'no_withdrawal', counts: x => x.signedUp,          hit: x => !x.withdrew },
  ];
  return defs.map(d => ({ ...runStreak(m, d.counts, d.hit), type: d.type }));
}

export function computeForPlayer(input: PlayerSeasonInput): PlayerAchievementResult {
  const m = input.matches;
  const sum = (f: (x: PlayerMatch) => number) => m.reduce((s, x) => s + f(x), 0);
  const count = (f: (x: PlayerMatch) => boolean) => m.reduce((s, x) => s + (f(x) ? 1 : 0), 0);

  const streaks = computeStreaks(input);
  const streakRecord = (t: StreakType) => streaks.find(s => s.type === t)?.record ?? 0;

  const valueFor = (def: TierGroupDef): number => {
    if (def.streakType) return streakRecord(def.streakType);
    switch (def.code) {
      case 'goals_scored':   return sum(x => x.goals);
      case 'assists_made':   return sum(x => x.assists);
      case 'clean_sheets':   return count(x => x.cleanSheet);
      case 'motm_awards':    return count(x => x.manOfMatch);
      case 'matches_played': return count(x => x.played);
      case 'signups_made':   return count(x => x.signedUp && !x.withdrew);
      default:               return 0;
    }
  };

  const earned: EarnedTier[] = [];
  const groups: GroupProgress[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    const value = valueFor(def);
    const { tiers, highest, next } = tiersForValue(def.thresholds, value);
    for (const tier of tiers) earned.push({ code: def.code, tier, progress: value });
    groups.push({ code: def.code, value, highestTier: highest, nextThreshold: next });
  }

  return { seasonYear: input.seasonYear, earned, groups, streaks };
}

/** Catalog as served by GET /api/achievements (no DB round-trip needed). */
export function catalog() {
  return ACHIEVEMENT_DEFS.map(d => ({
    code: d.code,
    name: d.name,
    description: d.description,
    category: d.category,
    glyph: d.glyph,
    unit: d.unit,
    isStreak: !!d.streakType,
    tiers: TIERS.map((tier, i) => ({ tier, threshold: d.thresholds[i] })),
  }));
}

// ─── Team / collective crests ─────────────────────────────────────────────────
// Computed live (not persisted) from the team's season results. Shared on the
// team wall; celebrate the whole squad rather than an individual.

// Calibrated against SEASON_MATCHES like the individual ladders. These are
// deliberately not tuned to the reference season's record (1W-1D-7L, zero clean
// sheets): pinning legend to a bad run would make the whole ladder trivial the
// moment the team improves. Legend is a strong season — 20 wins is 56% of the
// fixture list — not the club's current form.
const TEAM_DEFS: TierGroupDef[] = [
  { code: 'team_wins',         name: 'Winning Season', description: 'Wins this season',              category: 'team', glyph: 'trophy',   unit: 'wins',         thresholds: [1, 3, 6, 9, 12, 16, 20] },
  { code: 'team_clean_sheets', name: 'Fortress',       description: 'Matches without conceding',     category: 'team', glyph: 'fortress', unit: 'clean sheets', thresholds: [1, 2, 4, 6, 8, 11, 14] },
  { code: 'team_win_streak',   name: 'Juggernaut',     description: 'Longest winning run',           category: 'team', glyph: 'swords',   unit: 'in a row',     thresholds: [2, 3, 4, 5, 7, 9, 12] },
];

export interface TeamMatch {
  date: string;          // YYYY-MM-DD; pass ordered ascending
  win: boolean;
  goalsAgainst: number;
}

export interface TeamSeasonInput {
  seasonYear: number;
  matches: TeamMatch[];
}

export function computeTeam(input: TeamSeasonInput): { seasonYear: number; earned: EarnedTier[]; groups: GroupProgress[] } {
  const m = input.matches;
  const wins = m.filter(x => x.win).length;
  const cleanSheets = m.filter(x => x.goalsAgainst === 0).length;
  // Longest winning run over the ordered season.
  let winStreak = 0;
  let run = 0;
  for (const x of m) {
    run = x.win ? run + 1 : 0;
    if (run > winStreak) winStreak = run;
  }

  const valueFor = (code: string): number =>
    code === 'team_wins' ? wins : code === 'team_clean_sheets' ? cleanSheets : winStreak;

  const earned: EarnedTier[] = [];
  const groups: GroupProgress[] = [];
  for (const def of TEAM_DEFS) {
    const value = valueFor(def.code);
    const { tiers, highest, next } = tiersForValue(def.thresholds, value);
    for (const tier of tiers) earned.push({ code: def.code, tier, progress: value });
    groups.push({ code: def.code, value, highestTier: highest, nextThreshold: next });
  }
  return { seasonYear: input.seasonYear, earned, groups };
}

export function teamCatalog() {
  return TEAM_DEFS.map(d => ({
    code: d.code,
    name: d.name,
    description: d.description,
    category: d.category,
    glyph: d.glyph,
    unit: d.unit,
    isStreak: d.code === 'team_win_streak',
    tiers: TIERS.map((tier, i) => ({ tier, threshold: d.thresholds[i] })),
  }));
}
