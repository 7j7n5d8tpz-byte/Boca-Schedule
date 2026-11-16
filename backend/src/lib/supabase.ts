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

// supabase-js resolves with `{ error }` instead of rejecting, so a bare
// `await supabaseAdmin.from(…).update(…)` reports success whatever happened.
// Wrap a write whose failure must fail the request.
export async function must<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw result.error;
  return result;
}

// PostgREST returns at most 1000 rows per request (config.toml: max_rows) and
// says nothing when it cuts a list short — totals just come out too low. Read
// any list that grows with the club's history through this instead. The query
// needs a stable `.order(…)` (the primary key will do) or pages can overlap.
const PAGE_SIZE = 1000;
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
