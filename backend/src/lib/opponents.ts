import { supabaseAdmin } from './supabase.js';

export interface ResolvedOpponent {
  opponentId: string;
  name: string;
}

/**
 * Resolve the opponent for a match write.
 *
 * - `opponentId` given  → load that opponent (authoritative; ignores `name`).
 * - `name` given        → find-or-create, case/whitespace-insensitively
 *                         (matches the `opponents_name_unique` index).
 * - neither / blank     → `null` (no opponent set).
 *
 * Returns `{ opponentId, name }` so callers can store the FK *and* the
 * denormalized `matches.opponent` display text in sync.
 */
export async function resolveOpponent(
  opponent?: string | null,
  opponentId?: string | null,
  createdBy?: string,
): Promise<ResolvedOpponent | null> {
  if (opponentId) {
    const { data, error } = await supabaseAdmin
      .from('opponents')
      .select('opponent_id, name')
      .eq('opponent_id', opponentId)
      .single();
    if (error) throw error;
    return { opponentId: data.opponent_id, name: data.name };
  }

  const trimmed = opponent?.trim();
  if (!trimmed) return null;

  // Find existing case-insensitively before inserting, so we never duplicate.
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('opponents')
    .select('opponent_id, name')
    .ilike('name', trimmed)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return { opponentId: existing.opponent_id, name: existing.name };

  const { data: created, error: insertErr } = await supabaseAdmin
    .from('opponents')
    .insert({ name: trimmed, created_by: createdBy ?? null })
    .select('opponent_id, name')
    .single();
  // A concurrent insert may have won the unique index race — fall back to read.
  if (insertErr) {
    if (insertErr.code === '23505') {
      const { data: raced } = await supabaseAdmin
        .from('opponents')
        .select('opponent_id, name')
        .ilike('name', trimmed)
        .single();
      if (raced) return { opponentId: raced.opponent_id, name: raced.name };
    }
    throw insertErr;
  }
  return { opponentId: created.opponent_id, name: created.name };
}
