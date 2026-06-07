import { describe, it, expect } from 'vitest';
import {
  formatKr, fineWhat, STATUS_META, computeTotals, computeStandings, type FineLike,
} from '../pages/player/finesUtil';

const f = (over: Partial<FineLike> & Pick<FineLike, 'status' | 'amountDkk'>): FineLike => ({
  playerId: 'p1', playerName: 'Alice', typeLabel: null, reason: null, ...over,
});

describe('formatKr', () => {
  it('formats whole kroner with a kr suffix', () => {
    expect(formatKr(0)).toBe('0 kr');
    expect(formatKr(50)).toBe('50 kr');
  });
  it('groups thousands (da-DK uses a dot)', () => {
    expect(formatKr(1000)).toBe('1.000 kr');
    expect(formatKr(1234567)).toBe('1.234.567 kr');
  });
});

describe('fineWhat', () => {
  it('prefers the type label', () => {
    expect(fineWhat({ typeLabel: 'Dumt rødt kort', reason: 'note' })).toBe('Dumt rødt kort');
  });
  it('falls back to the reason for custom fines', () => {
    expect(fineWhat({ typeLabel: null, reason: 'Forgot the keys' })).toBe('Forgot the keys');
  });
  it('falls back to "Fine" when nothing is set', () => {
    expect(fineWhat({ typeLabel: null, reason: null })).toBe('Fine');
  });
});

describe('STATUS_META', () => {
  it('maps lifecycle statuses to user-facing labels', () => {
    expect(STATUS_META.approved.label).toBe('Outstanding');
    expect(STATUS_META.payment_claimed.label).toBe('Awaiting confirm');
    expect(STATUS_META.paid.label).toBe('Paid');
  });
});

describe('computeTotals', () => {
  it('buckets amounts by lifecycle state', () => {
    const totals = computeTotals([
      f({ status: 'approved', amountDkk: 50 }),
      f({ status: 'approved', amountDkk: 10 }),
      f({ status: 'payment_claimed', amountDkk: 18 }),
      f({ status: 'paid', amountDkk: 100 }),
      f({ status: 'voided', amountDkk: 999 }), // ignored
      f({ status: 'pending_approval', amountDkk: 999 }), // ignored
    ]);
    expect(totals).toEqual({ outstanding: 60, awaiting: 18, paid: 100 });
  });

  it('returns zeros for an empty list', () => {
    expect(computeTotals([])).toEqual({ outstanding: 0, awaiting: 0, paid: 0 });
  });
});

describe('computeStandings', () => {
  it('aggregates per player: paid vs still-owed (approved + claimed)', () => {
    const standings = computeStandings([
      f({ playerId: 'a', playerName: 'Alice', status: 'approved', amountDkk: 50 }),
      f({ playerId: 'a', playerName: 'Alice', status: 'payment_claimed', amountDkk: 18 }),
      f({ playerId: 'a', playerName: 'Alice', status: 'paid', amountDkk: 100 }),
      f({ playerId: 'b', playerName: 'Bob', status: 'approved', amountDkk: 10 }),
    ]);
    const alice = standings.find(s => s.playerId === 'a')!;
    expect(alice.outstanding).toBe(68); // 50 + 18
    expect(alice.paid).toBe(100);
  });

  it('sorts by most-owed first, then by name', () => {
    const standings = computeStandings([
      f({ playerId: 'a', playerName: 'Alice', status: 'approved', amountDkk: 10 }),
      f({ playerId: 'b', playerName: 'Bob', status: 'approved', amountDkk: 90 }),
      f({ playerId: 'c', playerName: 'Cara', status: 'paid', amountDkk: 200 }),
    ]);
    expect(standings.map(s => s.playerId)).toEqual(['b', 'a', 'c']);
  });
});
