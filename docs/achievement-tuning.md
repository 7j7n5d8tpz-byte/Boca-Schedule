# Achievement threshold tuning

How the crest ladders in [`backend/src/lib/achievements.ts`](../backend/src/lib/achievements.ts)
are sized, and the data behind the current numbers. Re-run the measurement below
before changing a ladder — the original thresholds were guesses, and several
turned out to be unreachable.

## Season volume

A season is a calendar year across **all** competitions (achievements span every
match type — there is one crest ladder, not one per competition), so:

| Competition | Matches |
|---|---|
| Seven-a-side serie | 20 |
| Futsal serie | 10 |
| Seven-a-side pokal | 3 (estimate) |
| Futsal pokal | 3 (estimate) |
| **Total** | **36** |

Both pokals are win-or-out, so their real length depends on how far the team
goes; 3 apiece is the working estimate. This is `SEASON_MATCHES` in
`achievements.ts` — **no threshold may exceed it**, and an engine test asserts
that for the whole catalog.

## Reference data

2026 season to date, from `templates/historical-import/` (9 completed matches,
2026-04-12 → 2026-06-21, 23 real players after merging placeholder duplicates via
`4_Players.csv`). Extrapolation to a full season is ×4.

**Team:** 1W 1D 7L, goals 18:31, **zero clean sheets**, best win run 1.

**Per player, scaled to 36 matches:**

| Metric | Club best (observed → projected) |
|---|---|
| Appearances | 7 of 9 (78%) → **28** |
| Goals | 4 → **16** |
| Assists | 4 → **16** |
| MOTM | 1 → **4** |
| Longest attendance run | **6** |

Two facts drive most of the calibration: **nobody plays every match** (78% is the
ceiling), and **one MOTM is minted per match**, so the whole squad shares 36 a
season.

## Current ladders

Sized so the club's best performer in a category lands around diamond/champion,
leaving legend as a genuine stretch that is still inside the season.

| Achievement | Bronze → Legend | Legend means |
|---|---|---|
| Goalscorer | 1, 3, 6, 9, 13, 18, 24 | 24 goals (projected best: 16) |
| Playmaker | 1, 3, 5, 8, 11, 15, 20 | 20 assists (projected best: 16) |
| Wall | 1, 2, 3, 4, 6, 8, 10 | 10 clean sheets |
| Match Winner | 1, 2, 3, 4, 6, 8, 10 | 10 MOTM — 28% of the season's awards |
| Ever Present | 1, 4, 8, 12, 17, 22, 28 | 28 of 36 — the observed 78% ceiling |
| Always In | 1, 5, 10, 15, 21, 27, 33 | 33 of 36 sign-ups |
| Iron Run | 2, 3, 4, 6, 8, 11, 14 | 14 consecutive matches |
| On Fire | 2, 3, 4, 5, 6, 8, 10 | scored in 10 straight |
| Unstoppable | 2, 3, 4, 5, 6, 8, 10 | 10 straight wins played in |
| Winning Season (team) | 1, 3, 6, 9, 12, 16, 20 | 20 wins — 56% of fixtures |
| Fortress (team) | 1, 2, 4, 6, 8, 11, 14 | 14 clean sheets |
| Juggernaut (team) | 2, 3, 4, 5, 7, 9, 12 | 12 straight wins |

### Notes per ladder

**Ever Present** — legend was 36, i.e. a perfect record. Nobody has exceeded 78%
attendance, so the top tier was decorative. Now 28.

**Always In** — legend was 40, *more matches than the season contains*: strictly
impossible. Now 33. It sits above Ever Present deliberately, since signing up
costs only intent — you can put your name down for a match you aren't picked for.

**Iron Run** — bounded by attendance rate, not season length. At 78% attendance
the longest run a dedicated player can expect across 36 matches is low-to-mid
teens, so legend is 14. The club's current best (6) lands on platinum.

**Match Winner** — bounded by supply: 36 awards exist per season across ~23
players. Legend at 10 means more than a quarter of them going one way. Was 14.

**On Fire / Unstoppable** — count only matches the player featured in, so they're
capped by appearances (~28 at best), not by 36. Both were unreachable before (13
and 15 in a row).

**Wall and Fortress are the least data-backed.** The reference season kept zero
clean sheets in 9 matches, so there is nothing to extrapolate from — these are
scaled to season length assuming a recovered defence. Revisit after a season with
some clean sheets in it.

**Team ladders are deliberately not tuned to the reference season's record.** The
team is on 1W-1D-7L; pinning legend to that would make the ladder trivial as soon
as form improves. Legend describes a strong season, not the current one.

## Known limitation: streaks mix competitions

Iron Run breaks on any missed match, and a season interleaves four competitions.
A player who only plays futsal has their run broken by every seven-a-side fixture
and can never build a long one, however reliable they are. The same applies to
On Fire and Unstoppable.

If that turns out to matter, the fix is to compute streaks per competition and
take the player's best, rather than over the whole mixed fixture list. Left as-is
for now — it is a design change, not a calibration one.

## Re-measuring

The numbers above came from a throwaway script over the historical-import CSVs.
Once a full season is in the database, redo it from there instead:

- completed matches for the season, ordered by `match_date`
- per player, the set of matches where `playedMatch(selected, attended)` is true
- totals for goals/assists/MOTM/clean sheets, and longest consecutive run over the
  ordered match list

Then pick thresholds so bronze is near-universal, the season's best performer
lands around diamond/champion, and legend sits above anything yet achieved but
inside `SEASON_MATCHES`.
