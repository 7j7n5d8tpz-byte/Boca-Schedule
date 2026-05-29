import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import app from '../../src/app.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  name: string;
  role: 'player' | 'coach' | 'admin';
  token: string;
}

const RUN_ID = Date.now();

export async function createTestUser(
  role: 'player' | 'coach' | 'admin',
  suffix = '',
): Promise<TestUser> {
  const email    = `test-${role}-${RUN_ID}${suffix}@bocatest.internal`;
  const password = 'Test123!';
  const name     = `Test ${role} ${RUN_ID}${suffix}`;

  // Create Supabase Auth user
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create auth user: ${error.message}`);
  const userId = data.user!.id;

  // Insert profile
  await supabaseAdmin.from('users').insert({
    user_id: userId,
    email,
    name,
    role,
    is_active: true,
    preferred_positions: role === 'player' ? ['MID', 'STR'] : [],
  });

  // Get access token via login
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  }

  return { userId, email, password, name, role, token: res.body.data.tokens.accessToken };
}

export async function deleteTestUser(userId: string) {
  await supabaseAdmin.from('users').delete().eq('user_id', userId);
  await supabaseAdmin.auth.admin.deleteUser(userId);
}

export { supabaseAdmin };
