// In-process squad optimizer — a faithful port of optimization-service/server.jl.
//
// The Julia service was a separate Fly machine purely because the model was
// written in JuMP; the actual problem is a tiny mixed-integer linear program.
// Here we build the same MILP and solve it with HiGHS (the very same solver
// JuMP used) compiled to WebAssembly, in-process in the always-on backend —
// so there is no extra service, no cold start, and no network hop.
//
// server.jl is kept in the repo for reference; this module is the runtime path.

import highsLoader from 'highs';

// ─── Constants (mirrors server.jl) ────────────────────────────────────────────

const POSITIONS_7 = ['GK', 'DEF', 'WIN', 'MID', 'STR'] as const;
const FORMATION_7: Record<string, number> = { GK: 1, DEF: 2, WIN: 2, MID: 1, STR: 1 };
const POSITIONS_FUTSAL = ['GK', 'WIN', 'MID', 'STR'] as const;
const FORMATION_FUTSAL: Record<string, number> = { GK: 1, WIN: 2, MID: 1, STR: 1 };

const W_FAIRNESS = 0.8; // fairness blend: games played vs sign-ups, weighted 4:1
const W_DEFICIT = 15.0; // penalty per missing player below target
const W_POSITION = -1.0; // reward per covered formation slot
const W_WINGER = -0.5; // extra reward for covering both winger slots
const R_PRIORITY = -1.0; // reward for including a priority player

// ─── Request / result shapes (snake_case, matching the old Julia contract) ────

export interface OptimizePlayer {
  id: string;
  name: string;
  preferred_positions: string[];
  games_played: number;
  games_signedup: number;
  is_priority: boolean;
}

export interface OptimizeRequest {
  match_id: string;
  match_type: string; // "futsal" | "7-player" | "11-player"
  target_players: number;
  max_players: number;
  total_matches: number;
  fairness_weight: number; // 0 = positions only, 1 = fairness only
  players: OptimizePlayer[];
}

interface FormationSlot {
  covered: boolean;
  required: number;
  filled: number;
}

export interface OptimizeResult {
  status: string;
  objective?: number;
  deficit?: number;
  selected_ids?: string[];
  formation?: Record<string, FormationSlot>;
  solve_time_ms?: number;
  error?: string;
}

export interface BatchSignup {
  player_id: string;
  is_priority: boolean;
}

export interface BatchMatchSpec {
  match_id: string;
  match_type: string;
  target_players: number;
  max_players: number;
  fairness_weight: number;
  signups: BatchSignup[];
}

export interface BatchPlayer {
  id: string;
  name: string;
  preferred_positions: string[];
  games_played: number;
  games_signedup: number;
}

export interface BatchOptimizeRequest {
  total_matches: number;
  players: BatchPlayer[];
  matches: BatchMatchSpec[];
}

export interface BatchMatchResult {
  match_id: string;
  selected_ids: string[];
  deficit: number;
  formation: Record<string, FormationSlot>;
}

export interface BatchOptimizeResult {
  status: string;
  objective?: number;
  solve_time_ms?: number;
  matches?: BatchMatchResult[];
  error?: string;
}

// ─── HiGHS loader (lazy singleton) ────────────────────────────────────────────

type HighsInstance = Awaited<ReturnType<typeof highsLoader>>;
let highsPromise: Promise<HighsInstance> | null = null;
function getHighs(): Promise<HighsInstance> {
  // In node the wasm sits next to the module, so no locateFile is needed.
  if (!highsPromise) highsPromise = highsLoader();
  return highsPromise;
}

// ─── Tiny CPLEX-LP model builder ──────────────────────────────────────────────
//
// HiGHS reads the CPLEX .lp format. Variable names cannot contain hyphens, so we
// never use raw UUIDs as names — variables are index-based (x0, y3, pc_DEF, …)
// and mapped back to player ids by the caller.

interface Term {
  name: string;
  coef: number;
}

class LpModel {
  private objTerms: Term[] = [];
  private constraints: string[] = [];
  private binaryVars: string[] = [];
  private generalVars: string[] = [];
  private cIdx = 0;

  addObjTerm(name: string, coef: number): void {
    this.objTerms.push({ name, coef });
  }

  binary(name: string): void {
    this.binaryVars.push(name);
  }

  /** Integer variable with default bounds [0, +inf). */
  generalInteger(name: string): void {
    this.generalVars.push(name);
  }

  constraint(terms: Term[], op: '<=' | '=', rhs: number): void {
    this.constraints.push(` c${this.cIdx++}: ${renderExpr(terms)} ${op} ${fmtNum(rhs)}`);
  }

  build(): string {
    const lines: string[] = ['Minimize', ` obj: ${renderExpr(this.objTerms)}`, 'Subject To'];
    lines.push(...this.constraints);
    if (this.generalVars.length > 0) lines.push('General', ` ${this.generalVars.join(' ')}`);
    if (this.binaryVars.length > 0) lines.push('Binary', ` ${this.binaryVars.join(' ')}`);
    lines.push('End');
    return lines.join('\n');
  }
}

function fmtNum(n: number): string {
  // Number#toString gives the shortest string that round-trips the double, so
  // coefficients match Julia's Float64 values exactly. LP accepts exponents.
  return n.toString();
}

function renderExpr(terms: Term[]): string {
  const parts: string[] = [];
  for (const { name, coef } of terms) {
    if (Math.abs(coef) < 1e-12) continue; // drop numerically-zero terms
    const sign = coef < 0 ? '-' : '+';
    parts.push(`${sign} ${fmtNum(Math.abs(coef))} ${name}`);
  }
  if (parts.length === 0) return '0';
  const joined = parts.join(' ');
  return joined.startsWith('+ ') ? joined.slice(2) : joined;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function positionsFor(matchType: string): { positions: readonly string[]; formation: Record<string, number> } {
  // Note: only "futsal" gets the 4-slot formation; everything else (incl.
  // "11-player") uses the 7-player formation — identical to server.jl.
  return matchType === 'futsal'
    ? { positions: POSITIONS_FUTSAL, formation: FORMATION_FUTSAL }
    : { positions: POSITIONS_7, formation: FORMATION_7 };
}

/** For futsal only the GK preference matters; outfielders are picked on fairness. */
function effectivePrefs(preferred: string[], isFutsal: boolean): string[] {
  return isFutsal ? preferred.filter((p) => p === 'GK') : preferred;
}

function fairnessMeasure(gamesPlayed: number, gamesSignedup: number, total: number): number {
  return (W_FAIRNESS * gamesPlayed - (1 - W_FAIRNESS) * gamesSignedup) / total;
}

function primal(sol: any, name: string): number {
  return sol.Columns[name]?.Primal ?? 0;
}

// ─── Single-match optimizer ───────────────────────────────────────────────────

export async function optimizeMatch(req: OptimizeRequest): Promise<OptimizeResult> {
  const n = req.players.length;
  if (n === 0) return { status: 'EMPTY', error: 'No players signed up' };

  const isFutsal = req.match_type === 'futsal';
  const { positions, formation } = positionsFor(req.match_type);
  const effPrefs = req.players.map((p) => effectivePrefs(p.preferred_positions, isFutsal));

  const total = Math.max(req.total_matches, 1);
  const alpha = req.fairness_weight;
  const wFair = 2.0 * alpha;
  const wPos = 2.0 * (1.0 - alpha);

  const measure = req.players.map((p) => fairnessMeasure(p.games_played, p.games_signedup, total));
  const priorityIdx = req.players.flatMap((p, i) => (p.is_priority ? [i] : []));

  const model = new LpModel();

  // x[i] selected?  y[i] priority & selected (priority players only)
  for (let i = 0; i < n; i++) {
    model.binary(`x${i}`);
    model.addObjTerm(`x${i}`, wFair * measure[i]);
  }
  for (const i of priorityIdx) {
    model.binary(`y${i}`);
    model.addObjTerm(`y${i}`, R_PRIORITY);
  }

  // d >= 0 integer deficit below target
  model.generalInteger('d');
  model.addObjTerm('d', W_DEFICIT);

  // pos_covered[p] — created only when at least one eligible player exists
  const createdPos = new Set<string>();
  for (const pos of positions) {
    const eligible = effPrefs.flatMap((prefs, i) => (prefs.includes(pos) ? [i] : []));
    if (eligible.length === 0) continue; // matches Julia's fix(pos_covered, 0)
    createdPos.add(pos);
    model.binary(`pc_${pos}`);
    let coef = wPos * W_POSITION;
    if (pos === 'WIN') coef += wPos * W_WINGER;
    model.addObjTerm(`pc_${pos}`, coef);
    // formation[pos] * pc_pos <= sum(x[eligible])
    model.constraint(
      [{ name: `pc_${pos}`, coef: formation[pos] }, ...eligible.map((i) => ({ name: `x${i}`, coef: -1 }))],
      '<=',
      0,
    );
  }

  // sum(x) + d == target ;  sum(x) <= max
  const allX = Array.from({ length: n }, (_, i) => ({ name: `x${i}`, coef: 1 }));
  model.constraint([...allX, { name: 'd', coef: 1 }], '=', req.target_players);
  model.constraint(allX, '<=', req.max_players);

  // y[i] <= x[i]
  for (const i of priorityIdx) {
    model.constraint([{ name: `y${i}`, coef: 1 }, { name: `x${i}`, coef: -1 }], '<=', 0);
  }

  const highs = await getHighs();
  const t0 = performance.now();
  const sol: any = highs.solve(model.build());
  const solveMs = performance.now() - t0;

  if (sol.Status !== 'Optimal') {
    return { status: sol.Status, error: 'Solver did not find an optimal solution' };
  }

  const selected = req.players.filter((_, i) => primal(sol, `x${i}`) > 0.9).map((p) => p.id);

  const resultFormation: Record<string, FormationSlot> = {};
  for (const pos of positions) {
    const eligible = effPrefs.flatMap((prefs, i) => (prefs.includes(pos) ? [i] : []));
    const filled = eligible.reduce((acc, i) => acc + (primal(sol, `x${i}`) > 0.9 ? 1 : 0), 0);
    resultFormation[pos] = {
      covered: createdPos.has(pos) && primal(sol, `pc_${pos}`) > 0.9,
      required: formation[pos],
      filled,
    };
  }

  return {
    status: sol.Status,
    objective: round4(sol.ObjectiveValue),
    deficit: Math.round(primal(sol, 'd')),
    selected_ids: selected,
    formation: resultFormation,
    solve_time_ms: Math.round(solveMs * 10) / 10,
  };
}

// ─── Batch optimizer ──────────────────────────────────────────────────────────
//
// One MILP across all M matches. Variables are indexed by (match, local signup).
// The fairness terms share the same per-player measure, so picking a high-load
// player in one match raises his cost in the others — coupling the decisions.

export async function optimizeBatch(req: BatchOptimizeRequest): Promise<BatchOptimizeResult> {
  const M = req.matches.length;
  const P = req.players.length;
  if (M === 0) return { status: 'EMPTY', error: 'No matches provided' };
  if (P === 0) return { status: 'EMPTY', error: 'No players provided' };

  const idToIdx = new Map(req.players.map((p, i) => [p.id, i]));
  const total = Math.max(req.total_matches, 1);
  const measure = req.players.map((p) => fairnessMeasure(p.games_played, p.games_signedup, total));

  // Per-match precomputed data
  const signupsGlobal: number[][] = []; // global player index per local signup slot
  const priorityLocal: number[][] = []; // local indices that are priority
  const effPrefs: string[][][] = [];
  const positionsM: (readonly string[])[] = [];
  const formationM: Record<string, number>[] = [];

  for (let m = 0; m < M; m++) {
    const spec = req.matches[m];
    const isFutsal = spec.match_type === 'futsal';
    const { positions, formation } = positionsFor(spec.match_type);
    positionsM[m] = positions;
    formationM[m] = formation;

    const gidxs: number[] = [];
    const prio: number[] = [];
    const prefs: string[][] = [];
    for (const su of spec.signups) {
      const gi = idToIdx.get(su.player_id);
      if (gi === undefined) continue;
      gidxs.push(gi);
      const li = gidxs.length - 1;
      if (su.is_priority) prio.push(li);
      prefs.push(effectivePrefs(req.players[gi].preferred_positions, isFutsal));
    }
    if (gidxs.length === 0) {
      return { status: 'EMPTY', error: `Match ${spec.match_id} has no valid sign-ups` };
    }
    signupsGlobal[m] = gidxs;
    priorityLocal[m] = prio;
    effPrefs[m] = prefs;
  }

  const model = new LpModel();
  const createdPos: Set<string>[] = [];

  for (let m = 0; m < M; m++) {
    const spec = req.matches[m];
    const alpha = spec.fairness_weight;
    const wFair = 2.0 * alpha;
    const wPos = 2.0 * (1.0 - alpha);
    const nM = signupsGlobal[m].length;
    createdPos[m] = new Set<string>();

    for (let li = 0; li < nM; li++) {
      const gi = signupsGlobal[m][li];
      model.binary(`x_${m}_${li}`);
      model.addObjTerm(`x_${m}_${li}`, wFair * measure[gi]);
    }
    for (const li of priorityLocal[m]) {
      model.binary(`y_${m}_${li}`);
      model.addObjTerm(`y_${m}_${li}`, R_PRIORITY);
    }
    model.generalInteger(`d_${m}`);
    model.addObjTerm(`d_${m}`, W_DEFICIT);

    for (const pos of positionsM[m]) {
      const eligible = effPrefs[m].flatMap((prefs, li) => (prefs.includes(pos) ? [li] : []));
      if (eligible.length === 0) continue;
      createdPos[m].add(pos);
      model.binary(`pc_${m}_${pos}`);
      let coef = wPos * W_POSITION;
      if (pos === 'WIN') coef += wPos * W_WINGER;
      model.addObjTerm(`pc_${m}_${pos}`, coef);
      model.constraint(
        [
          { name: `pc_${m}_${pos}`, coef: formationM[m][pos] },
          ...eligible.map((li) => ({ name: `x_${m}_${li}`, coef: -1 })),
        ],
        '<=',
        0,
      );
    }

    const allX = Array.from({ length: nM }, (_, li) => ({ name: `x_${m}_${li}`, coef: 1 }));
    model.constraint([...allX, { name: `d_${m}`, coef: 1 }], '=', spec.target_players);
    model.constraint(allX, '<=', spec.max_players);
    for (const li of priorityLocal[m]) {
      model.constraint([{ name: `y_${m}_${li}`, coef: 1 }, { name: `x_${m}_${li}`, coef: -1 }], '<=', 0);
    }
  }

  const highs = await getHighs();
  const t0 = performance.now();
  const sol: any = highs.solve(model.build());
  const solveMs = performance.now() - t0;

  if (sol.Status !== 'Optimal') {
    return { status: sol.Status, error: 'Solver did not find an optimal solution' };
  }

  const matchResults: BatchMatchResult[] = [];
  for (let m = 0; m < M; m++) {
    const spec = req.matches[m];
    const nM = signupsGlobal[m].length;

    const selected: string[] = [];
    for (let li = 0; li < nM; li++) {
      if (primal(sol, `x_${m}_${li}`) > 0.9) selected.push(req.players[signupsGlobal[m][li]].id);
    }

    const resultFormation: Record<string, FormationSlot> = {};
    for (const pos of positionsM[m]) {
      const eligible = effPrefs[m].flatMap((prefs, li) => (prefs.includes(pos) ? [li] : []));
      const filled = eligible.reduce((acc, li) => acc + (primal(sol, `x_${m}_${li}`) > 0.9 ? 1 : 0), 0);
      resultFormation[pos] = {
        covered: createdPos[m].has(pos) && primal(sol, `pc_${m}_${pos}`) > 0.9,
        required: formationM[m][pos],
        filled,
      };
    }

    matchResults.push({
      match_id: spec.match_id,
      selected_ids: selected,
      deficit: Math.round(primal(sol, `d_${m}`)),
      formation: resultFormation,
    });
  }

  return {
    status: sol.Status,
    objective: round4(sol.ObjectiveValue),
    solve_time_ms: Math.round(solveMs * 10) / 10,
    matches: matchResults,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
