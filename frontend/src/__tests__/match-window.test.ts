import { describe, it, expect } from 'vitest';
import { matchFieldsError, matchUpdatePayload, deadlineInstant, type MatchEditFields } from '../components/MatchEditForm';

const fields = (over: Partial<MatchEditFields> = {}): MatchEditFields => ({
  matchDate: '2030-06-15',
  matchTime: '20:00',
  venue: 'Boca Pitch',
  court: '',
  opponentId: null,
  matchCategory: 'serie',
  serieLetter: 'A',
  signupOpenDate: '2030-06-01',
  signupCloseDate: '2030-06-14',
  minPlayers: 5,
  maxPlayers: 10,
  ...over,
});

// A deadline after kick-off lets players sign up for a match that has already
// been played, and leaves the match stuck in signup_open so its result can
// never be recorded. The form must not offer to save it.
describe('matchFieldsError', () => {
  it('accepts a deadline before kick-off', () => {
    expect(matchFieldsError(fields())).toBeNull();
  });

  it('accepts the match day itself — that means "open until kick-off"', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-15', matchTime: '21:00' }))).toBeNull();
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-15', matchTime: '18:00' }))).toBeNull();
  });

  it('rejects a deadline on a day after the match', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-16' }))).toBe('coach.deadlineAfterKickoff');
  });

  it('stays quiet while the form is still half-filled', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '' }))).toBeNull();
    expect(matchFieldsError(fields({ matchDate: '' }))).toBeNull();
  });

  it('validates the same instant the payload sends', () => {
    const f = fields({ signupCloseDate: '2030-06-14' });
    expect(matchUpdatePayload(f).signupCloseDate)
      .toBe(new Date('2030-06-14T20:00:00').toISOString());
  });
});

// The repair migration leaves those matches with a deadline at kick-off, which
// the date picker shows as the match day. Re-saving such a match must not push
// the deadline back past kick-off to the club's default 20:00.
describe('deadlineInstant', () => {
  it('uses 20:00 local on an ordinary earlier day', () => {
    expect(deadlineInstant(fields()).toISOString())
      .toBe(new Date('2030-06-14T20:00:00').toISOString());
  });

  it('clamps to kick-off when the deadline is the match day', () => {
    const f = fields({ signupCloseDate: '2030-06-15', matchTime: '17:30' });
    expect(deadlineInstant(f).toISOString())
      .toBe(new Date('2030-06-15T17:30:00').toISOString());
  });

  it('leaves a late kick-off on 20:00', () => {
    const f = fields({ signupCloseDate: '2030-06-15', matchTime: '21:00' });
    expect(deadlineInstant(f).toISOString())
      .toBe(new Date('2030-06-15T20:00:00').toISOString());
  });

  it('round-trips a repaired match unchanged', () => {
    // Deadline already at kick-off → picker shows the match day → saving sends
    // the same instant back, so the API accepts it.
    const f = fields({ signupCloseDate: '2030-06-15', matchTime: '17:30' });
    expect(matchFieldsError(f)).toBeNull();
    expect(matchUpdatePayload(f).signupCloseDate).toBe(deadlineInstant(f).toISOString());
    expect(deadlineInstant(f) <= new Date(f.matchDate + 'T' + f.matchTime)).toBe(true);
  });
});
