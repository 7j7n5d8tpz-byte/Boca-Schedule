import { describe, it, expect } from 'vitest';
import { kickoffInstant, clubDateString, clubTimeString } from '../src/lib/clubTime.js';
import { lateSignupOpen } from '../src/lib/lateSignup.js';

// match_date / match_time are naive club wall-clock. Resolving them in the
// server's zone (UTC on Fly) put kick-off one or two hours late, which let a
// sign-up through after the match had already started.
describe('kickoffInstant', () => {
  it('reads a summer kick-off as CEST (UTC+2)', () => {
    expect(kickoffInstant('2026-06-15', '20:00:00').toISOString()).toBe('2026-06-15T18:00:00.000Z');
  });

  it('reads a winter kick-off as CET (UTC+1)', () => {
    expect(kickoffInstant('2026-01-15', '20:00:00').toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });

  it('handles the spring-forward and autumn changeover days', () => {
    // DST starts 2026-03-29 02:00 CET → 03:00 CEST.
    expect(kickoffInstant('2026-03-29', '20:00:00').toISOString()).toBe('2026-03-29T18:00:00.000Z');
    // DST ends 2026-10-25 03:00 CEST → 02:00 CET.
    expect(kickoffInstant('2026-10-25', '20:00:00').toISOString()).toBe('2026-10-25T19:00:00.000Z');
  });

  it('defaults a missing time to midnight club time', () => {
    expect(kickoffInstant('2026-06-15').toISOString()).toBe('2026-06-14T22:00:00.000Z');
  });
});

describe('club wall-clock strings', () => {
  it('renders an instant as club date and time, not UTC', () => {
    const at = new Date('2026-06-15T22:30:00.000Z'); // 00:30 on the 16th in Copenhagen
    expect(clubDateString(at)).toBe('2026-06-16');
    expect(clubTimeString(at)).toBe('00:30:00');
  });
});

describe('lateSignupOpen', () => {
  const match = { status: 'signup_open', match_date: '2026-06-15', match_time: '20:00:00', max_players: 10 };

  it('stays open while the match is short and kick-off is ahead', () => {
    expect(lateSignupOpen(match, 6, new Date('2026-06-15T17:00:00.000Z'))).toBe(true);
  });

  it('closes at kick-off in club time, not server time', () => {
    // 18:30Z is 20:30 in Copenhagen — half an hour into the match. Parsing the
    // naive kick-off as UTC would have called this "before kick-off".
    expect(lateSignupOpen(match, 6, new Date('2026-06-15T18:30:00.000Z'))).toBe(false);
  });
});

// match_time arrives as 'HH:MM' from the API body and 'HH:MM:SS' from the DB.
describe('kickoffInstant time formats', () => {
  it('accepts both HH:MM and HH:MM:SS', () => {
    expect(kickoffInstant('2030-06-15', '18:00').toISOString()).toBe('2030-06-15T16:00:00.000Z');
    expect(kickoffInstant('2030-06-15', '18:00:00').toISOString()).toBe('2030-06-15T16:00:00.000Z');
  });
});
