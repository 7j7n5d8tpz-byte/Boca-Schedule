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

/**
 * The set of `${matchId}|${playerId}` keys that count as played, over a batch
 * of matches. Unions selections and attended performances so a walk-on with a
 * performance row still counts once. Only completed matches count.
 */
export function buildPlayedKeys(
  selections: { match_id: string; player_id: string }[],
  performances: { match_id: string; player_id: string; attended: boolean | null }[],
  completedIds: Set<string>,
): Set<string> {
  const attendedByKey = new Map<string, boolean>();
  performances.forEach(p => attendedByKey.set(`${p.match_id}|${p.player_id}`, !!p.attended));

  const played = new Set<string>();
  selections.forEach(s => {
    const key = `${s.match_id}|${s.player_id}`;
    if (completedIds.has(s.match_id) && playedMatch(true, attendedByKey.get(key))) played.add(key);
  });
  performances.forEach(p => {
    if (completedIds.has(p.match_id) && p.attended) played.add(`${p.match_id}|${p.player_id}`);
  });
  return played;
}
