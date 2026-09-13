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

// The UTC offset (ms) that Europe/Copenhagen is running at a given instant.
function clubOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asIfUtc - at.getTime();
}

// Kick-off as a real instant.
//
// `match_date` (DATE) and `match_time` (TIME) are stored as naive club
// wall-clock, so `new Date(\`${date}T${time}\`)` resolves them in the server's
// zone — UTC on Fly, which puts kick-off one or two hours late and lets a
// sign-up through after the match has started. Resolve them in CLUB_TZ instead.
export function kickoffInstant(matchDate: string, matchTime?: string | null): Date {
  const naive = `${matchDate}T${(matchTime ?? '00:00:00').slice(0, 8)}`;
  const asUtc = new Date(`${naive}Z`);
  const offset = clubOffsetMs(asUtc);
  const candidate = new Date(asUtc.getTime() - offset);
  // A DST jump can make the first guess land in the other offset; one correction
  // is enough (offsets only ever shift by an hour).
  const settled = clubOffsetMs(candidate);
  return settled === offset ? candidate : new Date(asUtc.getTime() - settled);
}

// Club wall-clock date (YYYY-MM-DD) and time (HH:MM:SS) for an instant. Used to
// compare against the naive `match_date` / `match_time` columns in SQL.
export function clubDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

export function clubTimeString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLUB_TZ, hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(at);
}
