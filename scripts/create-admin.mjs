/**
 * Creates (or repairs) a single admin account directly in Supabase, bypassing
 * the app's registration + approval flow. Use this to bootstrap the very first
 * admin, since there's no existing admin to approve one through the UI.
 *
 * Usage (values come from your Supabase dashboard → Project Settings):
 *
 *   SUPABASE_URL="https://<project-ref>.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \
 *   ADMIN_PASSWORD="<a strong password>" \
 *   node scripts/create-admin.mjs
 *
 * Optional: ADMIN_EMAIL (default andreas@brendstrup.dk), ADMIN_NAME.
 */
import { createClient } from '@supabase/supabase-js';

const url        = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email      = process.env.ADMIN_EMAIL    || 'andreas@brendstrup.dk';
const password   = process.env.ADMIN_PASSWORD;
const name       = process.env.ADMIN_NAME     || 'Andreas Brendstrup';

if (!url || !serviceKey || !password) {
  console.error('Missing env. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create the auth user (email pre-confirmed), or reuse it if it already exists.
let userId;
const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (created?.user) {
  userId = created.user.id;
  console.log(`Created auth user for ${email}`);
} else {
  // Likely "already registered" — find the existing user and reset its password.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) { console.error('listUsers failed:', listErr.message); process.exit(1); }
  const existing = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) { console.error('createUser failed:', createErr?.message); process.exit(1); }
  userId = existing.id;
  await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true });
  console.log(`Auth user already existed — reset password for ${email}`);
}

// 2. Upsert the profile row as an active admin.
const { error: upsertErr } = await supabase.from('users').upsert(
  { user_id: userId, email, name, role: 'admin', is_active: true, preferred_positions: [] },
  { onConflict: 'user_id' },
);
if (upsertErr) { console.error('Profile upsert failed:', upsertErr.message); process.exit(1); }

console.log(`✅ Admin ready: ${email} (role=admin, active). You can now log in.`);
