/**
 * Creates the three fixed E2E test users (player, coach, admin) in the local
 * Supabase instance. Safe to run multiple times — skips users that already exist.
 * Used by the E2E CI job before running Playwright.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const E2E_USERS = [
  { email: 'e2e-player@bocatest.internal', name: 'E2E Player', role: 'player' },
  { email: 'e2e-coach@bocatest.internal',  name: 'E2E Coach',  role: 'coach'  },
  { email: 'e2e-admin@bocatest.internal',  name: 'E2E Admin',  role: 'admin'  },
];

const PASSWORD = 'Test123!';

for (const u of E2E_USERS) {
  // Check if already exists
  const { data: existing } = await supabase
    .from('users')
    .select('user_id')
    .eq('email', u.email)
    .maybeSingle();

  if (existing) {
    console.log(`  skip  ${u.email} (already exists)`);
    continue;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error) {
    console.error(`  error ${u.email}: ${error.message}`);
    continue;
  }

  await supabase.from('users').insert({
    user_id:             data.user.id,
    email:               u.email,
    name:                u.name,
    role:                u.role,
    is_active:           true,
    preferred_positions: u.role === 'player' ? ['MID', 'STR'] : [],
  });

  console.log(`  created ${u.role}: ${u.email}`);
}

console.log('E2E users ready.');
