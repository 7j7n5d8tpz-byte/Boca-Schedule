---
description: Run all local automated gates (typecheck, frontend unit, backend integration, E2E) before manual testing — mirrors the CI pipeline locally
---

Run the full local verification suite for Boca Schedule. This mirrors the gates in
[.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml) so the same things
that would block a deploy are caught **before** manual clicking, and before pushing.

Run the gates **in order, cheapest first, and stop at the first failure** (a type error
makes every later failure noise). After each gate, state PASS/FAIL. At the end, print the
summary table in the last section.

## Preflight — the stack must be running

Gates 3 and 4 need local Supabase + backend + frontend up. Check first:

```bash
cd "$(git rev-parse --show-toplevel)"
echo "Supabase:" && (curl -sf -o /dev/null http://127.0.0.1:54321/rest/v1/ -H "apikey: x" -w "%{http_code}\n" 2>/dev/null || echo DOWN)
echo "Backend: " && (curl -sf -o /dev/null http://localhost:3001/health -w "%{http_code}\n" 2>/dev/null || echo DOWN)
echo "Frontend:" && (curl -sf -o /dev/null http://localhost:5173 -w "%{http_code}\n" 2>/dev/null || echo DOWN)
```

- If any are DOWN, **stop and tell the user to run `/start` first** — do not try to start
  services here (that is `/start`'s job, and auto-starting hides real problems).
- **Migration note:** if the user added or changed a file under `supabase/migrations/`,
  the local DB does not have it yet. Remind them to run `npx supabase db reset` **before**
  this skill (⚠️ that wipes local data and replays all migrations). Do not run it
  automatically.

## Gate 1 — Typecheck (fast, no services)

Catches type errors, bad imports, and the camelCase ↔ snake_case mismatches that are the
most common mistakes when adding a field across the stack.

```bash
cd "$(git rev-parse --show-toplevel)/frontend" && npx tsc -b
cd "$(git rev-parse --show-toplevel)/backend"  && npx tsc --noEmit
```

If either prints errors, report the file:line and **stop** — fix types before running tests.

## Gate 2 — Frontend unit tests (vitest)

```bash
cd "$(git rev-parse --show-toplevel)/frontend" && npm test
```

## Gate 3 — Backend integration tests (vitest, needs local Supabase)

These run against the local Supabase from `/start`, using the existing `backend/.env`.
They may create and clean up their own rows in the local dev DB — expected, not a problem.

```bash
cd "$(git rev-parse --show-toplevel)/backend" && npm test
```

## Gate 4 — E2E (Playwright, needs the full stack)

First seed the three fixed test users (idempotent — safe to re-run; skips existing).
The seed script reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; source them from the
existing `backend/.env` so the key is guaranteed to match the running local stack (and
nothing is hardcoded or CLI-version-dependent):

```bash
cd "$(git rev-parse --show-toplevel)"
set -a; . backend/.env; set +a
node scripts/seed-e2e-users.mjs
```

(If `backend/.env` is missing, the local stack was never configured — run `/start` first.)

Then run the browser tests (the E2E auth helper defaults to these seeded users, so no extra
env is needed):

```bash
cd "$(git rev-parse --show-toplevel)/frontend" && npm run test:e2e
```

On failure: Playwright captured a screenshot and video (`screenshot: only-on-failure`,
`video: retain-on-failure`) and wrote an HTML report. Point the user to:

```bash
cd "$(git rev-parse --show-toplevel)/frontend" && npx playwright show-report
```

(`playwright-report/` and `test-results/` are gitignored — never commit them.)

## Final summary

Print a verdict like this, filling in each gate's result, then a one-line bottom line:

```
Gate                          Result
1. Typecheck                  ✅ / ❌
2. Frontend unit tests        ✅ / ❌ / ⏭ skipped
3. Backend integration tests  ✅ / ❌ / ⏭ skipped
4. E2E (Playwright)           ✅ / ❌ / ⏭ skipped
```

- All green → "Safe to click around at http://localhost:5173 — local gates match what CI
  will run on push."
- Any red → name the failing gate, show the key error lines, and say what to fix. Do **not**
  declare the app ready.
