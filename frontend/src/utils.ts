export function meetingTime(matchTime: string): string {
  const [h, m] = matchTime.split(':').map(Number);
  const total = h * 60 + m - 60;
  // Use double-modulo to wrap negative values (e.g. -30 min → 23:30)
  const mh = String(((Math.floor(total / 60) % 24) + 24) % 24).padStart(2, '0');
  const mm = String(((total % 60) + 60) % 60).padStart(2, '0');
  return `${mh}:${mm}`;
}

// Google Maps search link for a venue string (strips our " · court" suffix).
export function mapsUrl(location: string): string {
  const venue = location.split(' · ')[0];
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Floating local timestamp (YYYYMMDDTHHMMSS) for an ICS event — matches the
// backend feed. The club plays in one timezone, so floating time renders
// correctly in any member's local calendar.
function icsFloating(dateStr: string, timeStr: string, addHours = 0): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi, s] = timeStr.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h + addHours, mi, s || 0);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

interface IcsMatch {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
}

// A single-event VCALENDAR for "Add to calendar". Built client-side so the
// download needs no auth round-trip.
export function buildMatchIcs(m: IcsMatch): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const summary = m.opponent ? `Boca Boldisch vs ${m.opponent}` : 'Boca Boldisch match';
  const desc = `Kick-off ${m.matchTime.slice(0, 5)} · meet at ${meetingTime(m.matchTime)}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Boca Boldisch//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${m.matchId}@bocaboldisch.dk`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsFloating(m.matchDate, m.matchTime)}`,
    `DTEND:${icsFloating(m.matchDate, m.matchTime, 2)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(m.location)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
