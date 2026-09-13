import { describe, it, expect } from 'vitest';
import { matchFieldsError, matchUpdatePayload, type MatchEditFields } from '../components/MatchEditForm';

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

  it('accepts a deadline on match day when kick-off is later (20:00 close)', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-15', matchTime: '21:00' }))).toBeNull();
  });

  it('rejects a deadline on a day after the match', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-16' }))).toBe('coach.deadlineAfterKickoff');
  });

  it('rejects a deadline on match day when kick-off is before 20:00', () => {
    expect(matchFieldsError(fields({ signupCloseDate: '2030-06-15', matchTime: '18:00' }))).toBe('coach.deadlineAfterKickoff');
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
