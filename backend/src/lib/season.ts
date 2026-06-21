// Seasons.
//
// A season is identified by its START year (a number). Outdoor competitions
// (7-player / 11-player) align to the calendar year — season "2026" = all of
// 2026. Futsal runs across the New Year (Nov–Feb), so it uses a July→June
// window labelled like "2025/26": a match in Nov/Dec 2025 and one in Jan/Feb
// 2026 both belong to season 2025.
//
// Only the explicit futsal filter gets the cross-year treatment. Under "all"
// (mixed competitions) we fall back to calendar-year grouping, since there's no
// single boundary that fits both.

// Futsal season boundary (1-based month): months >= this start the next season.
// July sits in the summer gap when no futsal is played, so a Nov–Feb season is
// never split.
const FUTSAL_START_MONTH = 7;

export function isFutsalScope(matchType: string | undefined): boolean {
  return matchType === 'futsal';
}

/** The season (start year) a match date falls into, given the competition scope. */
export function seasonStartYear(dateStr: string, matchType: string | undefined): number {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  if (isFutsalScope(matchType)) {
    return d.getMonth() + 1 >= FUTSAL_START_MONTH ? y : y - 1;
  }
  return y;
}

/** Inclusive [start, end] date range (YYYY-MM-DD) for a season. */
export function seasonRange(year: number, matchType: string | undefined): { start: string; end: string } {
  if (isFutsalScope(matchType)) {
    return { start: `${year}-07-01`, end: `${year + 1}-06-30` };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Human label: "2026" outdoor, "2025/26" futsal. */
export function seasonLabel(year: number, matchType: string | undefined): string {
  if (isFutsalScope(matchType)) {
    return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
  }
  return `${year}`;
}
