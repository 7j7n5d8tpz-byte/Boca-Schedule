import { supabaseAdmin } from './users.js';

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  .toISOString().split('T')[0];

// Lazily-created system coach used as default created_by for test matches.
// Created once per test run; not cleaned up (the whole DB is ephemeral in CI).
let _systemCoachId: string | null = null;
async function systemCoachId(): Promise<string> {
  if (_systemCoachId) return _systemCoachId;
  const email = `system-coach-${Date.now()}@bocatest.internal`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password: 'Test123!', email_confirm: true,
  });
  if (error) throw new Error(`Failed to create system coach: ${error.message}`);
  await supabaseAdmin.from('users').insert({
    user_id: data.user!.id, email,
    name: 'System Coach', role: 'coach',
    is_active: true, preferred_positions: [],
  });
  _systemCoachId = data.user!.id;
  return _systemCoachId;
}

export async function createTestMatch(overrides: Record<string, unknown> = {}) {
  const created_by = await systemCoachId();
  const { data, error } = await supabaseAdmin.from('matches').insert({
    match_date:        FUTURE_DATE,
    match_time:        '18:00',
    location:          'Test Pitch',
    match_type:        '7-player',
    status:            'signup_open',
    min_players:       5,
    max_players:       7,
    signup_open_date:  new Date().toISOString().split('T')[0],
    signup_close_date: FUTURE_DATE,
    created_by,
    ...overrides,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTestMatch(matchId: string) {
  await supabaseAdmin.from('match_performance').delete().eq('match_id', matchId);
  await supabaseAdmin.from('match_results').delete().eq('match_id', matchId);
  await supabaseAdmin.from('selections').delete().eq('match_id', matchId);
  await supabaseAdmin.from('signups').delete().eq('match_id', matchId);
  await supabaseAdmin.from('matches').delete().eq('match_id', matchId);
}

export async function signupPlayer(matchId: string, playerId: string) {
  const { data, error } = await supabaseAdmin.from('signups').insert({
    match_id:    matchId,
    player_id:   playerId,
    is_priority: false,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function selectPlayer(matchId: string, playerId: string) {
  const { data, error } = await supabaseAdmin.from('selections').insert({
    match_id:                 matchId,
    player_id:                playerId,
    selected_by_optimization: false,
    manually_adjusted:        true,
  }).select().single();
  if (error) throw error;
  return data;
}
