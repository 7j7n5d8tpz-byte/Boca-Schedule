-- ============================================================
-- Simulation data: GK appearances and clean sheets
--
-- 4 goalkeepers across 8 completed matches gives a realistic
-- leaderboard. Final state:
--   Lars Petersen    7 halves  2 CS  29%
--   Christian Holm   4 halves  1 CS  25%
--   Patrick Nørgaard 3 halves  1 CS  33%
--   Kasper Møller    2 halves  1 CS  50%
-- ============================================================

-- ── 5 new completed matches ──────────────────────────────────

INSERT INTO matches (
  match_id, match_date, match_time, location, match_type,
  signup_open_date, signup_close_date,
  min_players, max_players, status, created_by, created_at, updated_at
) VALUES
  ('c3000000-0000-0000-0000-000000000001', '2026-04-03', '19:00:00', 'Hvidovre Stadion', '7-player',
   '2026-03-20T00:00:00Z', '2026-04-01T20:00:00Z', 7, 9, 'completed',
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()),
  ('c3000000-0000-0000-0000-000000000002', '2026-04-10', '19:00:00', 'KB Hallen', '7-player',
   '2026-03-27T00:00:00Z', '2026-04-08T20:00:00Z', 7, 9, 'completed',
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()),
  ('c3000000-0000-0000-0000-000000000003', '2026-04-17', '19:00:00', 'Gentofte Hallen', '7-player',
   '2026-04-03T00:00:00Z', '2026-04-15T20:00:00Z', 7, 9, 'completed',
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()),
  ('c3000000-0000-0000-0000-000000000004', '2026-04-24', '19:00:00', 'Hvidovre Stadion', '7-player',
   '2026-04-10T00:00:00Z', '2026-04-22T20:00:00Z', 7, 9, 'completed',
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()),
  ('c3000000-0000-0000-0000-000000000005', '2026-05-17', '19:00:00', 'KB Hallen', '7-player',
   '2026-05-03T00:00:00Z', '2026-05-15T20:00:00Z', 7, 9, 'completed',
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW())
ON CONFLICT (match_id) DO NOTHING;

-- ── Results with GK assignments for the 5 new matches ────────
--   Lars     = a1000000-0000-0000-0000-000000000001
--   Kasper   = a1000000-0000-0000-0000-000000000009
--   Christian = a1000001-0000-0000-0000-000000000001
--   Patrick  = a1000001-0000-0000-0000-000000000009

INSERT INTO match_results (match_id, goals_for, goals_against, recorded_by, gk_first_half, gk_second_half, updated_at)
VALUES
  -- Apr  3: 3-0 W — Lars both halves (clean sheet)
  ('c3000000-0000-0000-0000-000000000001', 3, 0,
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
   'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', NOW()),
  -- Apr 10: 2-0 W — Christian both halves (clean sheet)
  ('c3000000-0000-0000-0000-000000000002', 2, 0,
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
   'a1000001-0000-0000-0000-000000000001', 'a1000001-0000-0000-0000-000000000001', NOW()),
  -- Apr 17: 1-0 W — Patrick 1st, Kasper 2nd (clean sheet for both)
  ('c3000000-0000-0000-0000-000000000003', 1, 0,
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
   'a1000001-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000009', NOW()),
  -- Apr 24: 3-0 W — Lars both halves (clean sheet)
  ('c3000000-0000-0000-0000-000000000004', 3, 0,
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
   'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', NOW()),
  -- May 17: 2-1 W — Patrick 1st, Christian 2nd (no clean sheet)
  ('c3000000-0000-0000-0000-000000000005', 2, 1,
   'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
   'a1000001-0000-0000-0000-000000000009', 'a1000001-0000-0000-0000-000000000001', NOW())
ON CONFLICT (match_id) DO UPDATE SET
  gk_first_half  = EXCLUDED.gk_first_half,
  gk_second_half = EXCLUDED.gk_second_half;

-- ── Clean sheet performances for GK players ──────────────────

INSERT INTO match_performance (match_id, player_id, attended, goals, assists, clean_sheet, yellow_cards, red_cards, submitted_by)
VALUES
  -- Apr  3: Lars clean sheet
  ('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  -- Apr 10: Christian clean sheet
  ('c3000000-0000-0000-0000-000000000002', 'a1000001-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  -- Apr 17: Patrick clean sheet
  ('c3000000-0000-0000-0000-000000000003', 'a1000001-0000-0000-0000-000000000009', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  -- Apr 17: Kasper clean sheet
  ('c3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000009', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  -- Apr 24: Lars clean sheet
  ('c3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  -- May 17: no clean sheet (2-1) — performance rows without CS
  ('c3000000-0000-0000-0000-000000000005', 'a1000001-0000-0000-0000-000000000009', true, 0, 0, false, 0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
  ('c3000000-0000-0000-0000-000000000005', 'a1000001-0000-0000-0000-000000000001', true, 0, 0, false, 0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4')
ON CONFLICT (match_id, player_id) DO UPDATE SET clean_sheet = EXCLUDED.clean_sheet;

-- ── Assign GKs to the 3 existing completed matches ───────────
-- b0000000-...-000000000003  Apr 26  4-1 W
UPDATE match_results SET
  gk_first_half  = 'a1000000-0000-0000-0000-000000000001',
  gk_second_half = 'a1000000-0000-0000-0000-000000000001'
WHERE match_id = 'b0000000-0000-0000-0000-000000000003';

-- b0000000-...-000000000002  May  3  1-3 L
UPDATE match_results SET
  gk_first_half  = 'a1000000-0000-0000-0000-000000000009',
  gk_second_half = 'a1000001-0000-0000-0000-000000000001'
WHERE match_id = 'b0000000-0000-0000-0000-000000000002';

-- b0000000-...-000000000001  May 10  3-2 W
UPDATE match_results SET
  gk_first_half  = 'a1000001-0000-0000-0000-000000000009',
  gk_second_half = 'a1000000-0000-0000-0000-000000000001'
WHERE match_id = 'b0000000-0000-0000-0000-000000000001';
