# Boca Schedule

Monorepo for the Boca Boldisch football scheduling app.

## Response style

Use caveman mode (the `caveman` skill) from the start of every session, without waiting
for `/caveman`. Stay in it until the user says "stop caveman" or "normal mode".

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
- For interactive browser work (checking the running app, screenshots, console/network
  debugging, performance), use the `chrome-devtools-mcp` plugin by default, not Claude in
  Chrome. Automated E2E stays on Playwright via `/test`.
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
   - Backend → Fly.io (`boca-backend`), after the migrations
   - Frontend → Vercel, last, via a deploy hook (secret `VERCEL_DEPLOY_HOOK`)

Any push to `main` triggers the full pipeline, including a prod deploy — even a
config-only commit will redeploy (a no-op if no code/migrations changed).

## Production

- Frontend: https://boca-schedule.vercel.app — Vercel. Git auto-deploy is **off** for `main`
  ([vercel.json](vercel.json)); CI triggers the deploy once tests pass and the backend is live.
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
all migrations from scratch). The deploy workflow requires an encrypted off-site
backup before pending migrations; weekly/manual backups use the same script. See
[database-backups.md](docs/database-backups.md) for coverage, secrets and restore drills.

## Conventions

- Generated test output (`frontend/playwright-report/`, `test-results/`) is gitignored —
  do not commit it.
- Data tables must be mobile-responsive: stacked cards below Tailwind's `sm` breakpoint
  (`sm:hidden`), the `<table>` above it (`hidden sm:block`, `overflow-x-auto`). Never wrap
  a table in `overflow-hidden` — it clips columns on phones with no way to scroll. See
  `frontend/src/pages/admin/Dashboard.tsx` and `frontend/src/pages/player/Statistics.tsx`.
- Astryx (`@astryxdesign/core`, see [frontend/AGENTS.md](frontend/AGENTS.md)) is the design
  system for new and migrated UI. The mobile rule above still holds there, as a **swap**:
  Astryx `Table` at `sm` and up, Astryx `List`/`Item` rows below it (not Card-wrapped
  lists, not a sideways-scrolling `Table`). Existing Tailwind tables keep the pattern
  above until they are migrated.
- Theme: `boca` (Astryx neutral + club green/red/raven black, Archivo headings). Change it
  with `npx astryx experimental theme editor set boca …` from `frontend/` — never edit
  `frontend/src/themes/` by hand (generated). The app runs it in **light** mode only
  (`<Theme mode="light">` in `App.tsx`) until the Tailwind pages have dark styles.
- CSS cascade layers: `frontend/src/layers.css` must stay the first stylesheet imported in
  `main.tsx`, and `@tailwind base` stays wrapped in `@layer tw-preflight` (index.css).
  Unlayered preflight silently flattens every Astryx component.
- Navigation is `frontend/src/components/AppNav.tsx`: floating bottom bar on phones (shrinks
  on scroll down, expands on scroll up; "More" opens a bottom sheet with profile, coach /
  admin views, settings, log out), Astryx `TopNav` at `sm` and up. No top ribbon on phones;
  the notification bell floats top-right.
- Loading states: `BocaLoader` (crest coin-flip) for page / card / inline loads; skeletons
  stay for lists. Don't add plain "Loading…" texts or CSS spinners.
- Backend zod is v4: validate IDs with `z.string().guid()`, not `.uuid()`. v4's `.uuid()`
  enforces RFC version/variant bits and rejects seeded IDs such as
  `a1000000-0000-0000-0000-000000000001` (migration `20260528000003`).
