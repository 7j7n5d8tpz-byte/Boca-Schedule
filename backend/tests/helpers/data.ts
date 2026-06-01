import { supabaseAdmin } from './users.js';

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  .toISOString().split('T')[0];

// Singleton promise ensures only one system coach is created even under concurrent calls.
// process.env persists across module re-evaluations within the same Vitest process.
let _systemCoachPromise: Promise<string> | null = null;

function systemCoachId(): Promise<string> {
  if (process.env.TEST_SYSTEM_COACH_ID) return Promise.resolve(process.env.TEST_SYSTEM_COACH_ID);
  if (_systemCoachPromise) return _systemCoachPromise;
  _systemCoachPromise = (async () => {
    const email = `system-coach-${Date.now()}-${Math.random().toString(36).slice(2)}@bocatest.internal`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email, password: 'Test123!', email_confirm: true,
    });
    if (error) throw new Error(`Failed to create system coach: ${error.message}`);
    await supabaseAdmin.from('users').insert({
      user_id: data.user!.id, email,
      name: 'System Coach', role: 'coach',
      is_active: true, preferred_positions: [],
    });
    process.env.TEST_SYSTEM_COACH_ID = data.user!.id;
    return data.user!.id;
  })();
  return _systemCoachPromise;
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
  const selected_by = await systemCoachId();
  const { data, error } = await supabaseAdmin.from('selections').insert({
    match_id:                 matchId,
    player_id:                playerId,
    selected_by_optimization: false,
    manually_adjusted:        true,
    selected_by,
  }).select().single();
  if (error) throw error;
  return data;
}
