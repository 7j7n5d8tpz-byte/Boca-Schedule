// The club's wall-clock timezone. Everything a player reads should be in this
// zone, not the server's.
export const CLUB_TZ = 'Europe/Copenhagen';

// Render a stored instant (a timestamptz such as `signup_close_date`) as club
// wall-clock time.
//
// This needs the explicit timeZone. Match dates and times are stored as naive
// wall-clock strings, so parsing and formatting them both in server-local time
// cancels out and lands on the right answer wherever the process runs. A
// timestamptz has no such luck: it is a real instant, and formatting it without
// a zone gives whatever the server happens to be set to — UTC on Fly, which
// printed a 21:00 Copenhagen deadline as "19:00" in every email.
export function formatClubDeadline(instant: string): string {
  return new Date(instant).toLocaleString('da-DK', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: CLUB_TZ,
  });
}
