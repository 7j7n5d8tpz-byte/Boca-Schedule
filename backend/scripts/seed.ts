/**
 * Seed script — creates synthetic coach + players, 4 weekly matches, and sign-ups.
 * Run from the backend directory: npx tsx scripts/seed.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── People ──────────────────────────────────────────────────────────────────

const COACH = {
  email: 'coach@boca.test',
  password: 'Coach123!',
  name: 'Marcus Andersen',
  role: 'coach' as const,
  preferred_positions: [] as string[],
};

const PLAYERS: Array<{
  email: string;
  name: string;
  preferred_positions: string[];
  // which of the 4 matches (0-indexed) they sign up for
  signups: number[];
}> = [
  { email: 'thomas.moller@boca.test',    name: 'Thomas Møller',      preferred_positions: ['GK'],       signups: [0,1,2,3] },
  { email: 'kasper.lund@boca.test',      name: 'Kasper Lund',        preferred_positions: ['GK','DEF'], signups: [0,2,3]   },
  { email: 'andreas.bjerke@boca.test',   name: 'Andreas Bjerke',     preferred_positions: ['DEF'],      signups: [0,1,3]   },
  { email: 'nicolai.holm@boca.test',     name: 'Nicolai Holm',       preferred_positions: ['DEF','WIN'],signups: [0,1,2,3] },
  { email: 'mads.svendsen@boca.test',    name: 'Mads Svendsen',      preferred_positions: ['DEF'],      signups: [1,2,3]   },
  { email: 'simon.dahl@boca.test',       name: 'Simon Dahl',         preferred_positions: ['DEF','WIN'],signups: [0,1,2]   },
  { email: 'jonas.kvist@boca.test',      name: 'Jonas Kvist',        preferred_positions: ['WIN'],      signups: [0,1,2,3] },
  { email: 'patrick.borch@boca.test',    name: 'Patrick Borch',      preferred_positions: ['WIN'],      signups: [0,2,3]   },
  { email: 'christian.baek@boca.test',   name: 'Christian Bæk',      preferred_positions: ['WIN','MID'],signups: [1,2,3]   },
  { email: 'oscar.lindqvist@boca.test',  name: 'Oscar Lindqvist',    preferred_positions: ['WIN','STR'],signups: [0,1]     },
  { email: 'rasmus.fog@boca.test',       name: 'Rasmus Fog',         preferred_positions: ['MID'],      signups: [0,1,2,3] },
  { email: 'henrik.wulff@boca.test',     name: 'Henrik Wulff',       preferred_positions: ['MID','DEF'],signups: [0,1,3]   },
  { email: 'tobias.norgaard@boca.test',  name: 'Tobias Nørgaard',    preferred_positions: ['MID','STR'],signups: [1,2,3]   },
  { email: 'martin.agger@boca.test',     name: 'Martin Agger',       preferred_positions: ['STR'],      signups: [0,1,2,3] },
  { email: 'emil.rosendahl@boca.test',   name: 'Emil Rosendahl',     preferred_positions: ['STR','WIN'],signups: [0,2]     },
  { email: 'soren.feld@boca.test',       name: 'Søren Feld',         preferred_positions: ['STR'],      signups: [0,1,2,3] },
  { email: 'benjamin.vang@boca.test',    name: 'Benjamin Vang',      preferred_positions: ['DEF','MID'],signups: [0,1,2]   },
  { email: 'alexander.fugl@boca.test',   name: 'Alexander Fugl',     preferred_positions: ['WIN','MID'],signups: [1,2,3]   },
];

// ─── Matches ─────────────────────────────────────────────────────────────────
// Wednesdays at 20:00, starting next week.  Match 0 has signup already closed
// so the coach can immediately run the optimizer on it.

const MATCHES = [
  {
    match_date: '2026-05-27',
    match_time: '20:00:00',
    location: 'Valby Idrætsanlæg – Hal 2',
    match_type: '7-player',
    signup_open_date: '2026-05-17T00:00:00Z',
    signup_close_date: '2026-05-25T20:00:00Z', // already passed → signup_closed
    status: 'signup_closed',
    min_players: 7,
    max_players: 10,
  },
  {
    match_date: '2026-06-03',
    match_time: '20:00:00',
    location: 'Valby Idrætsanlæg – Hal 2',
    match_type: '7-player',
    signup_open_date: '2026-05-21T00:00:00Z',
    signup_close_date: '2026-06-01T20:00:00Z',
    status: 'signup_open',
    min_players: 7,
    max_players: 10,
  },
  {
    match_date: '2026-06-10',
    match_time: '20:00:00',
    location: 'Valby Idrætsanlæg – Hal 2',
    match_type: '7-player',
    signup_open_date: '2026-05-28T00:00:00Z',
    signup_close_date: '2026-06-08T20:00:00Z',
    status: 'signup_open',
    min_players: 7,
    max_players: 10,
  },
  {
    match_date: '2026-06-17',
    match_time: '20:00:00',
    location: 'Valby Idrætsanlæg – Hal 2',
    match_type: '7-player',
    signup_open_date: '2026-06-04T00:00:00Z',
    signup_close_date: '2026-06-15T20:00:00Z',
    status: 'signup_open',
    min_players: 7,
    max_players: 10,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(
  email: string,
  password: string,
  name: string,
  role: string,
  preferred_positions: string[]
): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Auth create failed for ${email}: ${error.message}`);

  const userId = data.user.id;

  const { error: profileError } = await supabase.from('users').insert({
    user_id: userId,
    email,
    name,
    role,
    preferred_positions,
    is_active: true,
  });
  if (profileError) throw new Error(`Profile insert failed for ${email}: ${profileError.message}`);

  return userId;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('Seeding database…\n');

  // Coach
  console.log('Creating coach…');
  const coachId = await createUser(
    COACH.email, COACH.password, COACH.name, COACH.role, COACH.preferred_positions
  );
  console.log(`  ✓ ${COACH.name}  (${COACH.email})`);

  // Players
  console.log('\nCreating players…');
  const playerIds: string[] = [];
  for (const p of PLAYERS) {
    const id = await createUser(p.email, 'Player123!', p.name, 'player', p.preferred_positions);
    playerIds.push(id);
    console.log(`  ✓ ${p.name.padEnd(22)} ${p.preferred_positions.join('/')}`);
  }

  // Matches
  console.log('\nCreating matches…');
  const matchIds: string[] = [];
  for (const m of MATCHES) {
    const { data, error } = await supabase
      .from('matches')
      .insert({ ...m, created_by: coachId, priority_enabled: true })
      .select('match_id')
      .single();
    if (error) throw new Error(`Match insert failed: ${error.message}`);
    matchIds.push(data.match_id);
    console.log(`  ✓ ${m.match_date}  ${m.status}`);
  }

  // Sign-ups
  console.log('\nCreating sign-ups…');
  const signupRows: Array<{ match_id: string; player_id: string }> = [];
  for (let pi = 0; pi < PLAYERS.length; pi++) {
    for (const mi of PLAYERS[pi].signups) {
      signupRows.push({ match_id: matchIds[mi], player_id: playerIds[pi] });
    }
  }
  const { error: signupError } = await supabase.from('signups').insert(signupRows);
  if (signupError) throw new Error(`Signups insert failed: ${signupError.message}`);

  // Count per match
  for (let mi = 0; mi < MATCHES.length; mi++) {
    const count = signupRows.filter(r => r.match_id === matchIds[mi]).length;
    console.log(`  Match ${mi + 1} (${MATCHES[mi].match_date}): ${count} sign-ups`);
  }

  // Summary
  console.log('\n─────────────────────────────────────────');
  console.log('Done! Login credentials:');
  console.log(`  Coach:   ${COACH.email}  /  Coach123!`);
  console.log(`  Players: <any player email>  /  Player123!`);
  console.log('─────────────────────────────────────────');
}

seed().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
