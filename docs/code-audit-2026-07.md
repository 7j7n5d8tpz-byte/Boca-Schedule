# Code audit — stale & unused code, July 2026

Repo-wide audit for dead code and stale connections: unused files/exports/dependencies,
API endpoints with no callers, env vars no code reads, and DB tables no code queries.
Method: full cross-reference of frontend `/api` calls ↔ backend Express routes,
backend Supabase queries ↔ migration schema, and GitHub workflows ↔ endpoints,
plus an ad-hoc `knip` sweep of both workspaces.

## Removed in this audit

### Retired Julia optimizer service (the headline)

The squad optimizer moved in-process (HiGHS-WASM, `backend/src/lib/optimizer.ts`),
but the old standalone service was still in the repo:

- `optimization-service/` (Dockerfile, fly.toml for app `boca-julia`, `Project.toml`,
  `server.jl`) — not deployed by any workflow, not called by any code.
- `BocaSchedule.jl` — root-level Julia prototype with hardcoded random test data.
- `JULIA_URL` env var in `backend/fly.toml` and `backend/.env.example` — zero reads
  in code (`grep JULIA_URL backend/src` → only comments).

### Orphaned endpoint + shadow routes

- `POST /api/matches/:matchId/performance` (`backend/src/routes/players.ts`) — zero
  callers: not in the frontend, not in any test, not in any workflow. Only the old
  spec document mentions it. Match performance is written by the results flow instead.
- The dual mount `app.use('/api/matches', playerRoutes)` in `backend/src/app.ts`
  existed only for that endpoint, and silently exposed shadow duplicates of every
  players route under `/api/matches/*` (e.g. `GET /api/matches/statistics/team`).
  Both removed.
- `POST /api/fines/:id/claim-paid` (`backend/src/routes/fines.ts`) — the per-fine
  "I paid" route. The app only ever uses the bulk `POST /api/fines/pay-outstanding`;
  no UI, workflow, or script called this. Removed after sign-off; the two lifecycle
  tests that used it to reach the claimed state now go through `pay-outstanding`,
  so confirm-paid/reject-claim coverage is unchanged.

### Dead frontend code

- `frontend/src/components/KitStripe.tsx` — zero references repo-wide.
- `frontend/src/components/NavMenu.tsx` — zero references; superseded by `AppNav.tsx`.
- `export { TIERS }` re-export in `frontend/src/api/achievements.ts` — consumers
  import `TIERS` from `components/Crest` directly.
- Dependencies `react-hook-form` and `zod` removed from `frontend/package.json` —
  zero imports anywhere in the frontend (the backend keeps its own `zod`).

### Dead backend code

- `supabaseForUser()` (`lib/supabase.ts`) — never called; only `supabaseAdmin` and
  `supabaseAnon` are used.
- `defByCode()` (`lib/achievements.ts`) — never called.
- `STREAK_TYPES` const and the unused `Position`/`MatchType`/`MatchStatus` types
  (`lib/achievements.ts`, `lib/types.ts`) — never referenced.

### Unnecessary `export` keywords (kept the code, dropped the export)

Used only inside their own file: `MAX_AVATAR_BYTES` (`backend/lib/avatar.ts`);
`TEAM_DEFS`, `Category`, `Glyph`, `StreakType` (`backend/lib/achievements.ts`);
`seasonYearOf`, `allRealPlayerIds` (`backend/lib/achievementsStore.ts`);
`isFutsalScope` (`backend/lib/season.ts`); `NotificationType`
(`backend/lib/notifications.ts`); `AuthUser` (`backend/lib/types.ts`);
`TOKEN_BG`, `shortName`, `futsalPositions` (`frontend/components/PitchView.tsx`);
`MatchCardSkeleton` (`frontend/components/Skeleton.tsx`); `StreakType`
(`frontend/api/achievements.ts`).

### Repo hygiene

- `_edit_repro.mjs` — committed one-off Playwright debug script. Deleted.
- `Screenshot 2026-06-15 at 07.39.48.png` — stray root screenshot. Deleted.
- `supabase/.temp/` — Supabase CLI local state accidentally committed (including
  Finder-style "` 2`" duplicate files and the prod project ref). Removed from git
  and added to `.gitignore`.
- `backend/.env.example` — removed never-read `JWT_SECRET` (auth is Supabase-based);
  added the actually-read but undocumented `CRON_SECRET` (required by
  `POST /api/cron/*`, sent by `reminders.yml`) and `ADMIN_EMAIL` (recipient of
  registration notifications).
- `.claude/skills/{start,stop,test}` — hardcoded a machine-specific macOS path
  (`/Users/asb/…/Boca Schedule`); now use `$(git rev-parse --show-toplevel)` so the
  skills work in any checkout, including remote sessions.

## Flagged, not touched — needs a product decision

- **Root binaries/docs**: `BocaLogo.png` (970 KB), `BocaBoldischShirt.jpg`,
  `Boca Boldisch History.xlsx`, `Fines_history.xlsx` (plausible source inputs for
  the import scripts), and `Football_Team_Player_Selection_System_Technical_Specification.md`
  (75 KB spec; describes the now-removed performance endpoint among other drift).
  Left in place — deleting historical source data is not the audit's call.
- **Manual utility scripts, kept deliberately**:
  `backend/scripts/{import-fines,import-history,restore-player,seed}.ts`,
  `frontend/seed-avatars.mjs`, `scripts/create-admin.mjs`. Not wired to npm scripts
  or CI, but they are ad-hoc admin/import tools (`import-*` are referenced by
  `templates/*/INSTRUCTIONS.md`).
- **`backend/src/lib/optimizer.ts` exported interfaces** (`OptimizePlayer`,
  `BatchSignup`, `BatchMatchSpec`, `BatchPlayer`, `BatchMatchResult`): flagged by
  knip as unimported, but they type the exported optimizer functions' signatures —
  kept as the module's API surface.

## Database staleness — none found (flag-only scope, no migrations written)

All 18 tables plus the `player_statistics` view that survive the migration chain are
queried by the backend (`users`, `matches`, `signups`, `selections`,
`match_performance`, `system_config`, `audit_log`, `match_results`,
`result_edit_requests`, `guest_players`, `announcements`, `notifications`,
`spot_claims`, `fine_types`, `fines`, `opponents`, `player_achievements`,
`player_streaks`). The one dead feature, `swap_requests`, was already dropped by
migration `20260603000006_spot_claims.sql`.

Notes (harmless, must stay for migration replay):
- `20260522000005_audit_log.sql` and `20260522000006_system_config.sql` re-create
  tables that `..._initial.sql` already created (`IF NOT EXISTS` no-ops).
- `20260528000001/2/3` bake in dev/test data, guarded so they no-op on prod.

## Connection map — every remaining route has a live caller

- Frontend `/api` calls ↔ backend routes: after the removals above, every backend
  route is called by the frontend, except the intentionally external ones below.
  The frontend calls no route that doesn't exist.
- `POST /api/cron/{signup-reminders,daily-reminders}` ← `.github/workflows/reminders.yml`.
- `GET /health`, `GET /health/db` ← `.github/workflows/keepalive.yml` + Fly checks.
- `GET /api/calendar/:token` ← external calendar apps (ICS feed), by design.

## Tooling note

The repo has no lint/dead-code tooling (no ESLint, knip, ts-prune, or depcheck).
This audit ran `npx knip` ad hoc in both workspaces; adding knip as a devDependency
with a small config would make this check repeatable in CI. Not added here to keep
the audit's footprint minimal.
