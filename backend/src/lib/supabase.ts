import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Server-side clients: never persist or auto-refresh a session. Without this a
// stray auth call (signInWithPassword/refreshSession) leaves a lingering session
// + background refresh timer on a shared singleton. supabaseAdmin in particular
// must always send the service_role key (RLS bypass) and never carry a user
// session — so keep all session-mutating auth calls on supabaseAnon.
const STATELESS = { auth: { autoRefreshToken: false, persistSession: false } } as const;

// Admin client — bypasses RLS (server-side only)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, STATELESS);

// Anon client — respects RLS; hosts password-grant / refresh auth calls
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, STATELESS);
