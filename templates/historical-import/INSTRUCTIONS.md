# Historical match import

These four CSVs hold the backfill of already-played matches (M1–M9) plus one
upcoming fixture (M10), exported from `Boca Boldisch History.xlsx`. They feed
`backend/scripts/import-history.ts`, which writes them into the database.

The sheets are linked by `match_ref` (M1, M2…).

## Sheets

- **1_Matches.csv** — one row per match. `venue` → match location (falls back to
  "Historical"). A blank `goals_for`/`goals_against` marks an **upcoming** match
  (M10): it's created with open signups and no result, and its participant rows
  are ignored (players sign up themselves). `game_assessment` accepts the app's
  labels or Danish equivalents ("Uheldig" → unlucky, "Strong Performance" →
  strong_performance).
- **2_Participants.csv** — who played, per match (= attendance), plus yes/no cards.
- **3_GoalEvents.csv** — one row per Boca goal (scorer + assister). Source of all
  goal/assist totals. `N/A` scorer = own goal / unknown (counts on the scoreline,
  credited to nobody).
- **4_Players.csv** — the roster / name key. One row per real person:
  `canonical_name`, `variants_seen` (every alternate spelling seen in the other
  sheets), `type` (`player` / `guest` / `unknown`), `email`, `notes`. The importer
  resolves every name in the other sheets through this map.

## Players without an account yet

Most players here haven't registered. The importer creates each as a
**placeholder user** — a real `users` row (so stats count) with no auth account,
`is_active = false`, `is_placeholder = true`. It is not loginable.

When a placeholder's real person later registers (a fresh account), an admin
**merges** the placeholder into the new account, moving all their history across.
(That merge tool is Part 2 — built after this import is verified.)

Special cases already encoded in `4_Players.csv`:
- `Oskar Mygind` — played as a guest but has an assist (M9), so he gets a
  placeholder so the assist counts.
- `David?` (M7 MotM) — typed `unknown`: skipped entirely, no account, no credit.
  Set a real name + `player` to include him.
- `Gæst` (M7) — unnamed guest: recorded in `guest_players` with no stats.

## Running the import

From `backend/` (uses `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `.env`):

```bash
npx tsx scripts/import-history.ts            # dry run: parse + validate, no DB access
npx tsx scripts/import-history.ts --commit   # write to the DB the env points at
```

Run the dry run first — it prints the per-match plan and refuses to commit if any
name fails to map. The commit step is idempotent on (date + opponent): re-running
skips matches already imported. Test against **local** Supabase before prod.

The placeholder columns require migration `20260621000001_placeholder_users.sql`.
