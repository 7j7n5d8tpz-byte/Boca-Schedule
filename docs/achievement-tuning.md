# Achievement threshold tuning

How the crest ladders in [`backend/src/lib/achievements.ts`](../backend/src/lib/achievements.ts)
are sized, and the data behind the current numbers. Re-run the measurement below
before changing a ladder — the original thresholds were guesses, and one of them
turned out to be unreachable.

## Reference season

2026, measured from `templates/historical-import/`:

- **9 completed matches**, 2026-04-12 → 2026-06-21 (season ongoing; next fixture 2026-08-15)
- **23 real players** (guests excluded, placeholder duplicates merged)
- **Most appearances by one player: 7 of 9 (78%)** — nobody plays every match
- A full season looks like ~18–20 matches at this rate

## Iron Run (`attendance_streak`)

Longest run of consecutive matches played, where *any* missed match breaks the
run — including one the player wasn't selected for.

Measured distribution over the 9 completed matches:

| Longest run | Players reaching it |
|---|---|
| ≥ 2 | 16 (70%) |
| ≥ 3 | 7 (30%) |
| ≥ 4 | 4 (17%) |
| ≥ 5 | 1 (4%) |
| ≥ 6 | 1 (4%) |
| ≥ 7 | 0 |

Best run in the club: **6** (Ajay Kumar). The most-selected player, Mads Emil
Oxholm Iversen, has 7 appearances but a best run of only 4.

**Thresholds: `[2, 3, 4, 5, 7, 9, 12]`** (bronze → legend)

Against half a season this puts 70% of the squad on bronze, the club's best
attendee on platinum, and leaves diamond/champion/legend as things to chase over
a full season. Gaps widen as they climb (1, 1, 1, 2, 2, 3) so the top of the
ladder stays meaningful.

The previous ladder was `[2, 4, 6, 9, 12, 16, 20]`. Those numbers were only
survivable while the streak could never break (see below); under the strict rule
legend at 20 would have exceeded the entire season's match count.

### Why the ladder had to be retuned

The streak originally counted only matches the player was selected for, skipping
the rest rather than treating them as a break. Since results are always recorded
with `attended: true` for the whole squad, a selected match always counted as
played — so nothing in a season could break the run. Iron Run silently
re-measured total appearances on an easier ladder than Ever Present, and players
earned gold without ever playing six matches in a row.

## Known issue: Ever Present (`matches_played`) is over-tuned

Not yet changed, flagged here so it isn't forgotten. Thresholds are
`[1, 5, 10, 15, 20, 28, 36]`, but the reference season has ~18–20 matches total
and the best attendee played 78% of them. Diamond (20), champion (28) and legend
(36) are unreachable in a season of this size — the ladder effectively caps at
platinum. Something like `[1, 3, 6, 9, 12, 15, 18]` would restore a full range;
worth confirming against a completed season first.

## Re-measuring

The distribution above came from a throwaway script over the historical-import
CSVs. To redo it after a season completes, read match dates + participation
straight from the DB instead:

- completed matches for the season, ordered by `match_date`
- per player, the set of matches where `playedMatch(selected, attended)` is true
- longest consecutive run over the ordered match list

Then pick thresholds so bronze is near-universal, the current season's best
performer lands around platinum, and legend sits above anything yet achieved but
inside the season's match count.
