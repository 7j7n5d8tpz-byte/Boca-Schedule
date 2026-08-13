// Late sign-ups: the deadline is a nudge, not a wall.
//
// Before the deadline there is no cap — everyone signs up, the coach picks the
// squad. Once the deadline passes the club often turns out to be short of
// players, so sign-ups reopen and stay open until enough people are in to field
// the match: `max_players`, the most who can actually play. Past that the
// deadline is final again, because there is nothing left to gain.
//
// Once the squad is published, an extra player goes through the spot-claim flow
// instead (see routes/claims.ts), so the coach still approves who comes in.

// Only a match still in `signup_open` reopens. Every other status means someone
// already acted: the coach hit "Close signups", ran the optimizer, published the
// squad, or the match is done or off. A deliberate act outranks the shortage — a
// coach who then finds they're short reopens sign-ups from the match page, which
// flips the status back and brings the window with it.
export const REOPENABLE_STATUSES = ['signup_open'];

export interface LateSignupMatch {
  status: string;
  match_date: string;
  match_time: string;
  max_players: number;
}

export const LATE_SIGNUP_COLUMNS = 'status, match_date, match_time, max_players';

// Whether a match still accepts sign-ups now that its deadline has passed.
// `activeSignups` counts non-withdrawn sign-ups.
export function lateSignupOpen(
  m: LateSignupMatch,
  activeSignups: number,
  now: Date = new Date(),
): boolean {
  if (!REOPENABLE_STATUSES.includes(m.status)) return false;
  if (activeSignups >= m.max_players) return false;
  // Kick-off closes the window for good, whatever the state of the squad.
  return new Date(`${m.match_date}T${m.match_time}`) > now;
}
