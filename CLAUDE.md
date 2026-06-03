# Boca Schedule

Monorepo for the Boca Boldisch football scheduling app.

## Stack & layout

- `frontend/` — Vite + React (port 5173). Calls the backend via a **relative** `/api`.
- `backend/` — Express + TypeScript (port 3001). Uses Supabase `service_role`.
- `optimization-service/` — Julia optimizer (port 3002).
- `supabase/` — local Supabase config + migrations.
- npm workspaces; root `npm run dev` runs backend + frontend concurrently.

## Development flow

Single-branch, local-then-production. There is **one** long-lived branch: `main`.
There is no staging environment — develop and test locally, then push to deploy.

```
develop locally  →  test locally  →  commit  →  push to main  →  CI gates  →  auto-deploy to prod
```

- Do all development and manual testing **locally first**. Local Supabase (Docker),
  Julia, backend, and frontend are fully isolated from production.
- Start the stack with the `/start` skill; stop with `/stop`. Ports: Supabase API
  54321 / DB 54322 / Studio 54323, backend 3001, Julia 3002, frontend 5173.
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
   - Julia → Fly.io (`boca-julia`)

Any push to `main` triggers the full pipeline, including a prod deploy — even a
config-only commit will redeploy (a no-op if no code/migrations changed).

## Production

- Frontend: https://boca-schedule.vercel.app — Vercel, auto-deploys on push to `main`.
- Backend: `boca-backend.fly.dev` (health: `/health`).
- Julia: `boca-julia.fly.dev` (512 MB; can flake on cold deploys — backend tolerates its absence).
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
