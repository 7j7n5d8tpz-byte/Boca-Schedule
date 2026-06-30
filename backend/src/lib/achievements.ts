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

export type Category = 'performance' | 'reliability' | 'team';

/** A unique emblem per achievement, drawn by the frontend Crest component. */
export type Glyph =
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

export type StreakType = 'attendance' | 'scoring' | 'clean_sheet' | 'win' | 'no_withdrawal';

// Reaching a reliability tier is shareable ("Ever Present – Gold"), but the EXACT
// signup/selection count behind it is private (existing stats-privacy rule). The
// read routes null out the numeric value of these groups for non-owner viewers,
// leaving only the earned tier badges.
export const PRIVATE_COUNT_CODES = ['matches_played', 'signups_made'];

// ─── Catalog ────────────────────────────────────────────────────────────────
// Thresholds are tuned for an amateur club's season volume: bronze is reachable
// almost immediately, legend is a genuine season-long feat.

export const ACHIEVEMENT_DEFS: TierGroupDef[] = [
  // Performance — on-pitch output (per season).
  { code: 'goals_scored',  name: 'Goalscorer',   description: 'Goals scored this season',        category: 'performance', glyph: 'football', unit: 'goals',        thresholds: [1, 3, 6, 10, 15, 22, 30] },
  { code: 'assists_made',  name: 'Playmaker',    description: 'Assists made this season',         category: 'performance', glyph: 'boot',     unit: 'assists',      thresholds: [1, 3, 6, 10, 14, 18, 25] },
  { code: 'clean_sheets',  name: 'Wall',         description: 'Clean sheets kept this season',    category: 'performance', glyph: 'glove',    unit: 'clean sheets', thresholds: [1, 2, 4, 6, 9, 12, 16] },
  { code: 'motm_awards',   name: 'Match Winner', description: 'Man of the Match awards',          category: 'performance', glyph: 'medal',    unit: 'awards',       thresholds: [1, 2, 3, 5, 7, 10, 14] },

  // Reliability — showing up, which is what keeps squads filled (per season).
  { code: 'matches_played', name: 'Ever Present', description: 'Matches played this season',      category: 'reliability', glyph: 'calendar',  unit: 'matches', thresholds: [1, 5, 10, 15, 20, 28, 36] },
  { code: 'signups_made',   name: 'Always In',    description: 'Matches signed up for this season', category: 'reliability', glyph: 'clipboard', unit: 'sign-ups', thresholds: [1, 5, 10, 16, 22, 30, 40] },

  // Streaks — consecutive runs (measured by the season's best run).
  { code: 'attendance_streak', name: 'Iron Run',    description: 'Consecutive matches played',          category: 'reliability', glyph: 'chain', unit: 'in a row', thresholds: [2, 4, 6, 9, 12, 16, 20], streakType: 'attendance' },
  { code: 'scoring_streak',    name: 'On Fire',     description: 'Consecutive matches with a goal',      category: 'performance', glyph: 'flame', unit: 'in a row', thresholds: [2, 3, 4, 6, 8, 10, 13], streakType: 'scoring' },
  { code: 'win_streak',        name: 'Unstoppable', description: 'Consecutive wins played in',           category: 'performance', glyph: 'bolt',  unit: 'in a row', thresholds: [2, 3, 5, 7, 9, 12, 15], streakType: 'win' },
];

export const STREAK_TYPES: StreakType[] = ['attendance', 'scoring', 'clean_sheet', 'win', 'no_withdrawal'];

// ─── Inputs / outputs ─────────────────────────────────────────────────────────

export interface PlayerMatch {
  matchId: string;
  date: string;          // YYYY-MM-DD; matches must be passed ordered ascending
  selected: boolean;     // named to the squad
  played: boolean;       // selected AND attended
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
 * `counts(m)` decides whether a match participates at all (non-participating
 * matches are skipped, not treated as a break); `hit(m)` is the success test.
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
    { type: 'attendance',    counts: x => x.selected,          hit: x => x.played },
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

export function defByCode(code: string): TierGroupDef | undefined {
  return ACHIEVEMENT_DEFS.find(d => d.code === code) ?? TEAM_DEFS.find(d => d.code === code);
}

// ─── Team / collective crests ─────────────────────────────────────────────────
// Computed live (not persisted) from the team's season results. Shared on the
// team wall; celebrate the whole squad rather than an individual.

export const TEAM_DEFS: TierGroupDef[] = [
  { code: 'team_wins',         name: 'Winning Season', description: 'Wins this season',              category: 'team', glyph: 'trophy',   unit: 'wins',         thresholds: [1, 3, 5, 8, 11, 15, 20] },
  { code: 'team_clean_sheets', name: 'Fortress',       description: 'Matches without conceding',     category: 'team', glyph: 'fortress', unit: 'clean sheets', thresholds: [1, 2, 4, 6, 9, 12, 16] },
  { code: 'team_win_streak',   name: 'Juggernaut',     description: 'Longest winning run',           category: 'team', glyph: 'swords',   unit: 'in a row',     thresholds: [2, 3, 4, 6, 8, 10, 12] },
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
