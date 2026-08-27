// Pure helpers for the fines UI — kept framework-free so they're unit-testable.

export type FineStatus = 'pending_approval' | 'approved' | 'payment_claimed' | 'paid' | 'rejected' | 'voided';

// Minimal shape the computations need (the full Fine type is a superset).
export interface FineLike {
  playerId: string;
  playerName: string | null;
  amountDkk: number;
  status: FineStatus;
  typeLabel?: string | null;
  reason?: string | null;
}

export const formatKr = (n: number) => `${n.toLocaleString('da-DK')} kr`;

// This module stays framework-free, so it carries the i18n *key* for each
// status rather than the words — the badge component resolves it.
export const STATUS_META: Record<FineStatus, { labelKey: string; cls: string }> = {
  pending_approval: { labelKey: 'fines.status.pending_approval', cls: 'bg-gray-100 text-gray-600' },
  approved:         { labelKey: 'fines.status.approved',         cls: 'bg-amber-100 text-amber-700' },
  payment_claimed:  { labelKey: 'fines.status.payment_claimed',  cls: 'bg-blue-100 text-blue-700' },
  paid:             { labelKey: 'fines.status.paid',             cls: 'bg-green-100 text-green-700' },
  rejected:         { labelKey: 'fines.status.rejected',         cls: 'bg-red-100 text-red-600' },
  voided:           { labelKey: 'fines.status.voided',           cls: 'bg-gray-100 text-gray-400' },
};

/**
 * What a fine was for: the catalogue label, else the free-text reason.
 *
 * Returns null when neither is set — both are user-supplied, so there is no
 * translatable fallback to give from here; callers supply `fines.fineFallback`.
 */
export function fineWhat(f: { typeLabel?: string | null; reason?: string | null }): string | null {
  return f.typeLabel ?? f.reason ?? null;
}

export interface Totals { outstanding: number; awaiting: number; paid: number }

// Money totals for a set of fines, by lifecycle bucket.
export function computeTotals(fines: FineLike[]): Totals {
  const sum = (s: FineStatus) => fines.filter(f => f.status === s).reduce((a, f) => a + f.amountDkk, 0);
  return { outstanding: sum('approved'), awaiting: sum('payment_claimed'), paid: sum('paid') };
}

export interface Standing { playerId: string; name: string; outstanding: number; paid: number }

// Per-player standings: paid vs. still-owed (approved + claimed), most-owed first.
export function computeStandings(fines: FineLike[]): Standing[] {
  const map = new Map<string, { name: string; outstanding: number; paid: number }>();
  for (const f of fines) {
    const row = map.get(f.playerId) ?? { name: f.playerName ?? '', outstanding: 0, paid: 0 };
    if (f.status === 'paid') row.paid += f.amountDkk;
    else row.outstanding += f.amountDkk; // approved + payment_claimed
    map.set(f.playerId, row);
  }
  return [...map.entries()]
    .map(([playerId, v]) => ({ playerId, ...v }))
    .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
}
