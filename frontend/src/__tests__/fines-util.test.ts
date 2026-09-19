import { describe, it, expect } from 'vitest';
import {
  formatKr, fineWhat, STATUS_META, computeTotals, computeStandings,
  todayIso, pickDefaultMatchId, type FineLike,
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
  it('returns null when nothing is set, leaving the fallback to the caller', () => {
    expect(fineWhat({ typeLabel: null, reason: null })).toBeNull();
  });
});

describe('STATUS_META', () => {
  it('maps lifecycle statuses to their translation keys', () => {
    expect(STATUS_META.approved.labelKey).toBe('fines.status.approved');
    expect(STATUS_META.payment_claimed.labelKey).toBe('fines.status.payment_claimed');
    expect(STATUS_META.paid.labelKey).toBe('fines.status.paid');
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

describe('todayIso', () => {
  it('uses the local calendar day, not UTC', () => {
    // 23:30 local on 1 June is still 1 June, even where UTC has rolled over.
    expect(todayIso(new Date(2026, 5, 1, 23, 30))).toBe('2026-06-01');
    expect(todayIso(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });
});

describe('pickDefaultMatchId', () => {
  const m = (matchId: string, matchDate: string) => ({ matchId, matchDate });

  it("picks today's match — the usual case, fines handed out around kick-off", () => {
    const matches = [m('future', '2026-06-20'), m('today', '2026-06-10'), m('past', '2026-06-03')];
    expect(pickDefaultMatchId(matches, '2026-06-10')).toBe('today');
  });

  it('falls back to the most recently played match', () => {
    const matches = [m('next', '2026-06-20'), m('last', '2026-06-10'), m('older', '2026-06-03')];
    expect(pickDefaultMatchId(matches, '2026-06-12')).toBe('last');
  });

  it('ignores the incoming order', () => {
    const matches = [m('older', '2026-06-03'), m('next', '2026-06-20'), m('last', '2026-06-10')];
    expect(pickDefaultMatchId(matches, '2026-06-12')).toBe('last');
  });

  it('picks the nearest upcoming match when nothing has been played yet', () => {
    const matches = [m('later', '2026-08-01'), m('first', '2026-07-15')];
    expect(pickDefaultMatchId(matches, '2026-06-30')).toBe('first');
  });

  it('leaves the picker on "no match" when there are none', () => {
    expect(pickDefaultMatchId([], '2026-06-10')).toBeNull();
    expect(pickDefaultMatchId(undefined, '2026-06-10')).toBeNull();
  });
});
