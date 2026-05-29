-- ============================================================
-- Test data: 11 new players (total 25), 3 signup_closed 7-player matches
-- Guard: only runs on databases that have the local dev coach account.
-- No-op on production.
-- ============================================================

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4') THEN
    RETURN;
  END IF;

  -- ── New players ────────────────────────────────────────────────────────────
  INSERT INTO users (user_id, email, name, role, preferred_positions, is_active) VALUES
    ('a1000001-0000-0000-0000-000000000001', 'christian.holm@boca.dk',      'Christian Holm',     'player', ARRAY['GK'],        true),
    ('a1000001-0000-0000-0000-000000000002', 'jonas.berg@boca.dk',          'Jonas Berg',         'player', ARRAY['DEF','MID'], true),
    ('a1000001-0000-0000-0000-000000000003', 'alexander.dahl@boca.dk',      'Alexander Dahl',     'player', ARRAY['WIN','STR'], true),
    ('a1000001-0000-0000-0000-000000000004', 'mads.lund@boca.dk',           'Mads Lund',          'player', ARRAY['MID'],       true),
    ('a1000001-0000-0000-0000-000000000005', 'victor.kjaer@boca.dk',        'Victor Kjær',        'player', ARRAY['DEF'],       true),
    ('a1000001-0000-0000-0000-000000000006', 'simon.brandt@boca.dk',        'Simon Brandt',       'player', ARRAY['STR','WIN'], true),
    ('a1000001-0000-0000-0000-000000000007', 'tobias.holm@boca.dk',         'Tobias Holm',        'player', ARRAY['MID','DEF'], true),
    ('a1000001-0000-0000-0000-000000000008', 'daniel.juhl@boca.dk',         'Daniel Juhl',        'player', ARRAY['WIN'],       true),
    ('a1000001-0000-0000-0000-000000000009', 'patrick.norgaard@boca.dk',    'Patrick Nørgaard',   'player', ARRAY['GK'],        true),
    ('a1000001-0000-0000-0000-000000000010', 'benjamin.storm@boca.dk',      'Benjamin Storm',     'player', ARRAY['STR'],       true),
    ('a1000001-0000-0000-0000-000000000011', 'nikolai.vestergaard@boca.dk', 'Nikolai Vestergaard','player', ARRAY['DEF','WIN'], true)
  ON CONFLICT (user_id) DO NOTHING;

  -- ── 3 upcoming 7-player matches (signup_closed, ready to optimize) ─────────
  INSERT INTO matches (
    match_id, match_date, match_time, location, match_type,
    signup_open_date, signup_close_date,
    min_players, max_players, status,
    match_category, serie_letter,
    created_by, created_at, updated_at
  ) VALUES
    (
      'b2000001-0000-0000-0000-000000000001',
      '2026-06-10', '19:00:00', 'Hvidovre Stadion', '7-player',
      '2026-05-20T00:00:00Z', '2026-06-08T20:00:00Z',
      7, 9, 'signup_closed',
      'serie', 'A',
      'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()
    ),
    (
      'b2000001-0000-0000-0000-000000000002',
      '2026-06-17', '19:00:00', 'KB Hallen', '7-player',
      '2026-05-20T00:00:00Z', '2026-06-15T20:00:00Z',
      7, 9, 'signup_closed',
      'serie', 'A',
      'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()
    ),
    (
      'b2000001-0000-0000-0000-000000000003',
      '2026-06-24', '19:00:00', 'Gentofte Hallen', '7-player',
      '2026-05-20T00:00:00Z', '2026-06-22T20:00:00Z',
      7, 9, 'signup_closed',
      'serie', 'B',
      'f7d8e95b-2c53-4c73-b42d-be5230ea9cd4', NOW(), NOW()
    )
  ON CONFLICT (match_id) DO NOTHING;

  -- ── Signups ─────────────────────────────────────────────────────────────────
  INSERT INTO signups (match_id, player_id)
  SELECT 'b2000001-0000-0000-0000-000000000001', user_id FROM users WHERE email IN (
    'anders.larsen@boca.dk','martin.jensen@boca.dk','mikkel.hansen@boca.dk',
    'oliver.rasmussen@boca.dk','lars.petersen@boca.dk','magnus.eriksen@boca.dk',
    'thomas.nielsen@boca.dk','soren.madsen@boca.dk','christian.holm@boca.dk',
    'jonas.berg@boca.dk','alexander.dahl@boca.dk','mads.lund@boca.dk'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO signups (match_id, player_id)
  SELECT 'b2000001-0000-0000-0000-000000000002', user_id FROM users WHERE email IN (
    'martin.jensen@boca.dk','mikkel.hansen@boca.dk','oliver.rasmussen@boca.dk',
    'lars.petersen@boca.dk','magnus.eriksen@boca.dk','nikolaj.poulsen@boca.dk',
    'kasper.moller@boca.dk','rasmus.christensen@boca.dk','christian.holm@boca.dk',
    'jonas.berg@boca.dk','victor.kjaer@boca.dk','simon.brandt@boca.dk','tobias.holm@boca.dk'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO signups (match_id, player_id)
  SELECT 'b2000001-0000-0000-0000-000000000003', user_id FROM users WHERE email IN (
    'anders.larsen@boca.dk','thomas.nielsen@boca.dk','soren.madsen@boca.dk',
    'nikolaj.poulsen@boca.dk','kasper.moller@boca.dk','frederik.christiansen@boca.dk',
    'alexander.dahl@boca.dk','mads.lund@boca.dk','daniel.juhl@boca.dk',
    'patrick.norgaard@boca.dk','benjamin.storm@boca.dk'
  ) ON CONFLICT DO NOTHING;

END $guard$;
