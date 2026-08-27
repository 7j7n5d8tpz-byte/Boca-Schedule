/**
 * A cancelled match can still have an outcome: whoever called it off forfeits.
 * The club wins 3-0 when the opponent cancels and loses 0-3 when we do — a team
 * result only, with no players credited (nobody played).
 */
export const WALKOVER_GOALS = 3;

export type CancelledBy = 'us' | 'opponent';

export function walkoverScore(cancelledBy: CancelledBy): { goalsFor: number; goalsAgainst: number } {
  return cancelledBy === 'opponent'
    ? { goalsFor: WALKOVER_GOALS, goalsAgainst: 0 }
    : { goalsFor: 0, goalsAgainst: WALKOVER_GOALS };
}
