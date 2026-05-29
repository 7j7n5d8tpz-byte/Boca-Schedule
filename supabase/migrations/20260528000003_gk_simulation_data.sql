-- ============================================================
-- Simulation data: GK appearances and clean sheets
-- Guard: only runs on databases that have the local dev coach account.
-- No-op on production.
-- ============================================================

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4') THEN
    RETURN;
  END IF;

  -- ── 5 new completed matches ────────────────────────────────
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

  -- ── Results with GK assignments ───────────────────────────
  INSERT INTO match_results (match_id, goals_for, goals_against, recorded_by, gk_first_half, gk_second_half, updated_at)
  VALUES
    ('c3000000-0000-0000-0000-000000000001', 3, 0,
     'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
     'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', NOW()),
    ('c3000000-0000-0000-0000-000000000002', 2, 0,
     'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
     'a1000001-0000-0000-0000-000000000001', 'a1000001-0000-0000-0000-000000000001', NOW()),
    ('c3000000-0000-0000-0000-000000000003', 1, 0,
     'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
     'a1000001-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000009', NOW()),
    ('c3000000-0000-0000-0000-000000000004', 3, 0,
     'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
     'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', NOW()),
    ('c3000000-0000-0000-0000-000000000005', 2, 1,
     'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4',
     'a1000001-0000-0000-0000-000000000009', 'a1000001-0000-0000-0000-000000000001', NOW())
  ON CONFLICT (match_id) DO UPDATE SET
    gk_first_half  = EXCLUDED.gk_first_half,
    gk_second_half = EXCLUDED.gk_second_half;

  -- ── Clean sheet performances ───────────────────────────────
  INSERT INTO match_performance (match_id, player_id, attended, goals, assists, clean_sheet, yellow_cards, red_cards, submitted_by)
  VALUES
    ('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000002', 'a1000001-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000003', 'a1000001-0000-0000-0000-000000000009', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000009', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', true, 0, 0, true,  0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000005', 'a1000001-0000-0000-0000-000000000009', true, 0, 0, false, 0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4'),
    ('c3000000-0000-0000-0000-000000000005', 'a1000001-0000-0000-0000-000000000001', true, 0, 0, false, 0, 0, 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4')
  ON CONFLICT (match_id, player_id) DO UPDATE SET clean_sheet = EXCLUDED.clean_sheet;

  -- ── Assign GKs to the 3 existing completed matches ─────────
  UPDATE match_results SET
    gk_first_half  = 'a1000000-0000-0000-0000-000000000001',
    gk_second_half = 'a1000000-0000-0000-0000-000000000001'
  WHERE match_id = 'b0000000-0000-0000-0000-000000000003';

  UPDATE match_results SET
    gk_first_half  = 'a1000000-0000-0000-0000-000000000009',
    gk_second_half = 'a1000001-0000-0000-0000-000000000001'
  WHERE match_id = 'b0000000-0000-0000-0000-000000000002';

  UPDATE match_results SET
    gk_first_half  = 'a1000001-0000-0000-0000-000000000009',
    gk_second_half = 'a1000000-0000-0000-0000-000000000001'
  WHERE match_id = 'b0000000-0000-0000-0000-000000000001';

END $guard$;
