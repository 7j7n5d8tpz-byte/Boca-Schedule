// The ONE definition of "played a match", shared by the statistics routes
// (players.ts) and the achievements input builder (achievementsStore.ts) so a
// crest can never contradict the stats table.
//
// A recorded result carries an explicit per-player `attended` flag — when it
// exists it wins (a selected player marked absent did not play; a walk-on
// marked present did). Before a result is recorded there is no attendance
// data, so being selected to the squad counts as having played.

/**
 * Whether a player featured in a completed match.
 * @param selected  player was named to the squad
 * @param attended  explicit attendance from the recorded result, if any
 */
export function playedMatch(selected: boolean, attended?: boolean | null): boolean {
  return attended ?? selected;
}
