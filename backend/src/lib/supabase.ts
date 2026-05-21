import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Admin client — bypasses RLS (server-side only)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Anon client — respects RLS
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);

// Create a client authenticated as the requesting user
export function supabaseForUser(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
