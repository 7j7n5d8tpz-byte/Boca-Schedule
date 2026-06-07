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

export const STATUS_META: Record<FineStatus, { label: string; cls: string }> = {
  pending_approval: { label: 'Pending approval', cls: 'bg-gray-100 text-gray-600' },
  approved:         { label: 'Outstanding',      cls: 'bg-amber-100 text-amber-700' },
  payment_claimed:  { label: 'Awaiting confirm', cls: 'bg-blue-100 text-blue-700' },
  paid:             { label: 'Paid',             cls: 'bg-green-100 text-green-700' },
  rejected:         { label: 'Rejected',         cls: 'bg-red-100 text-red-600' },
  voided:           { label: 'Voided',           cls: 'bg-gray-100 text-gray-400' },
};

export function fineWhat(f: { typeLabel?: string | null; reason?: string | null }): string {
  return f.typeLabel ?? f.reason ?? 'Fine';
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
