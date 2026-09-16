// Coach season overview: one state per (player, match) cell, plus the season
// totals the coach used to keep in a spreadsheet ("Kampe spillet" and
// "Udtagelsesprocent").

export type CellState =
  | 'played'     // completed, and playedMatch() says they featured
  | 'no_show'    // completed, selected, but marked absent
  | 'selected'   // squad picked, match not yet played
  | 'signed_up'  // active signup, not (or not yet) selected
  | 'withdrawn'  // signed up, then withdrew (afbud)
  | 'missing'    // sign-up is open and they haven't responded
  | 'none';      // no signup for a match that is no longer open

export interface CellInput {
  status: string;
  signup: 'active' | 'withdrawn' | null;
  selected: boolean;
  played: boolean;
}

export function cellState({ status, signup, selected, played }: CellInput): CellState {
  if (status === 'completed') {
    if (played) return 'played';
    if (selected) return 'no_show';
  } else if (selected) {
    return 'selected';
  }
  if (signup === 'active') return 'signed_up';
  if (signup === 'withdrawn') return 'withdrawn';
  return status === 'signup_open' ? 'missing' : 'none';
}

/** Squad is final: selection % only counts these, so open matches don't drag it down. */
export function isDecided(status: string): boolean {
  return status === 'published' || status === 'completed';
}

/**
 * Selection % = selected ÷ matches they were in the running for (active signup
 * or selected), over decided matches only. Withdrawals are excluded. Null when
 * there is nothing to divide by.
 */
export function selectionPct(cells: { status: string; signup: CellInput['signup']; selected: boolean }[]): {
  selected: number; considered: number; pct: number | null;
} {
  let selected = 0;
  let considered = 0;
  for (const c of cells) {
    if (!isDecided(c.status)) continue;
    if (c.selected) { selected++; considered++; }
    else if (c.signup === 'active') considered++;
  }
  return { selected, considered, pct: considered > 0 ? +((selected / considered) * 100).toFixed(1) : null };
}
