# Boca Schedule

Monorepo for the Boca Boldisch football scheduling app.

## Stack & layout

- `frontend/` — Vite + React (port 5173). Calls the backend via a **relative** `/api`.
- `backend/` — Express + TypeScript (port 3001). Uses Supabase `service_role`. The squad
  optimizer runs **in-process** here (HiGHS-WASM) — see `backend/src/lib/optimizer.ts`;
  there is no separate optimizer service or port.
- `supabase/` — local Supabase config + migrations.
- npm workspaces; root `npm run dev` runs backend + frontend concurrently.

## Development flow

Single-branch, local-then-production. There is **one** long-lived branch: `main`.
There is no staging environment — develop and test locally, then push to deploy.

```
develop locally  →  test locally  →  commit  →  push to main  →  CI gates  →  auto-deploy to prod
```

- Do all development and manual testing **locally first**. Local Supabase (Docker),
  backend, and frontend are fully isolated from production.
- Start the stack with the `/start` skill; stop with `/stop`. Ports: Supabase API
  54321 / DB 54322 / Studio 54323, backend 3001, frontend 5173.
- Before manual testing or pushing, run the `/test` skill: it runs the same gates as CI
  locally (typecheck → frontend unit → backend integration → E2E), cheapest-first and
  stops at the first failure. Requires the stack up via `/start`; it does not auto-start.
- For larger changes, branch off `main`, open a PR (CI runs on PRs), then merge.
  For small changes, committing straight to `main` is fine.

## CI / CD

GitHub Actions [.github/workflows/deploy.yml](.github/workflows/deploy.yml), triggered on
push/PR to `main`:

1. Frontend unit tests (vitest)
2. Backend integration tests (vitest, against an ephemeral local Supabase)
3. E2E tests (Playwright) — **push events only**, not PRs
4. **Deploy (push to `main` only, after E2E passes):**
   - `supabase db push` — applies new migrations to the prod DB
   - Backend → Fly.io (`boca-backend`)

Any push to `main` triggers the full pipeline, including a prod deploy — even a
config-only commit will redeploy (a no-op if no code/migrations changed).

## Production

- Frontend: https://boca-schedule.vercel.app — Vercel, auto-deploys on push to `main`.
- Backend: `boca-backend.fly.dev` (health: `/health`). Squad optimizer runs in-process
  (HiGHS-WASM) — no separate optimizer service.
- DB/Auth: Supabase project `bqucqglcueffoqiywers` (West EU).

Secrets live in GitHub Actions and Vercel — never committed. `.env*` is gitignored.

### Gotchas (don't re-break)

- [vercel.json](vercel.json) must keep the `/api/(.*)` → `boca-backend.fly.dev` rewrite
  **before** the SPA catch-all, or the live app silently can't reach the backend.
- RLS is on for all tables but the backend uses `service_role`, which needs explicit
  table GRANTs (migration `20260602000001`). Without them every backend query fails
  with "permission denied for table …".

## Migration safety

Migrations auto-apply to the **single** prod DB on push to `main`, with no staging
dry-run. Before pushing a migration, test it locally with `supabase db reset` (replays
all migrations from scratch). Confirm Supabase backups/PITR are enabled before relying
on unattended migrations.

## Conventions

- Generated test output (`frontend/playwright-report/`, `test-results/`) is gitignored —
  do not commit it.
- Data tables must be mobile-responsive: stacked cards below Tailwind's `sm` breakpoint
  (`sm:hidden`), the `<table>` above it (`hidden sm:block`, `overflow-x-auto`). Never wrap
  a table in `overflow-hidden` — it clips columns on phones with no way to scroll. See
  `frontend/src/pages/admin/Dashboard.tsx` and `frontend/src/pages/player/Statistics.tsx`.
