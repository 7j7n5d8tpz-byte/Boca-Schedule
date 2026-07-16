# Fines history import

Backfills each player's current fines position from `Fines_history.xlsx`
(columns: name, total fines, balance; source spreadsheet no longer kept in the
repo) into the app's fines ledger.

## Data model

`1_Fines.csv` columns:
- `player_name` — exactly as in the spreadsheet.
- `canonical_name` — the app user this maps to (an existing placeholder/account
  from the match import, or a new placeholder). Variant spellings and four people
  not in the match roster are mapped here.
- `total_fined`, `balance` — from the sheet. **Balance is `paid − total`**, so a
  negative balance means money owed:
  - `owed = -balance`, `paid = total_fined + balance`.

Each player becomes up to two ledger fines (reason "Historisk bødesaldo (import)"):
- a **paid** fine for the settled portion (amount = paid) → counts toward the pot's
  collected total,
- an **approved** fine for the outstanding part (amount = owed) → the player's balance.

Players with no account become **placeholder users** (no login), found-or-created by
`canonical_name` so they reuse the placeholders the match import already made. When a
player registers, an admin merges the placeholder into the real account — the merge
now also carries fines across (migration `20260621000003_merge_fines.sql`).

## Running

From `backend/` (uses `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from env):

```bash
npx tsx scripts/import-fines.ts            # dry run: parse + validate, no DB
npx tsx scripts/import-fines.ts --commit   # write to the DB the env points at
```

Run the dry run first; it refuses to commit if any row is inconsistent. The commit
is idempotent — players who already carry an imported balance fine are skipped, so
re-running is safe. Test against local Supabase before prod, and make sure the
`20260621000003_merge_fines.sql` migration is deployed first.

Note: `Andreas Sølling Brendstrup` maps to the real admin account `Andreas Brendstrup`
— confirm that matches the admin's profile name in prod, or the fine lands on a new
placeholder instead.
