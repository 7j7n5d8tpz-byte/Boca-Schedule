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
  const summary = m.opponent ? `Boca Boldisch vs ${m.opponent}` : 'Boca Boldisch-kamp';
  const desc = `Kampstart ${m.matchTime.slice(0, 5)} · mødetid ${meetingTime(m.matchTime)}`;
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

// ─── Email typo suggestion ───────────────────────────────────────────────────

// Mail providers players actually use. A registration whose domain is a near
// miss of one of these ("gmial.com", "hotmail.dl") almost certainly has a typo —
// and the domain may still exist (typo-squatters register them), so the
// backend's DNS check can't catch it. Suggest the fix instead.
const COMMON_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.dk', 'outlook.com', 'outlook.dk',
  'live.com', 'live.dk', 'msn.com', 'yahoo.com', 'yahoo.dk', 'icloud.com', 'me.com', 'mac.com',
  'mail.dk', 'jubii.dk', 'sol.dk', 'ofir.dk', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.net',
  'aol.com',
];

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** The corrected address if the domain looks like a typo of a common provider, else null. */
export function suggestEmailCorrection(email: string): string | null {
  const at = email.trim().lastIndexOf('@');
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  const domain = email.trim().slice(at + 1).toLowerCase();
  if (!domain.includes('.') || COMMON_EMAIL_DOMAINS.includes(domain)) return null;

  let best: { domain: string; dist: number } | null = null;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const dist = editDistance(domain, candidate);
    if (!best || dist < best.dist) best = { domain: candidate, dist };
  }
  // One slip for short domains, two for longer ones — close enough to be a typo,
  // far enough that a real custom domain (e.g. "brendstrup.dk") isn't flagged.
  const maxDist = domain.length <= 7 ? 1 : 2;
  return best && best.dist > 0 && best.dist <= maxDist ? `${local}@${best.domain}` : null;
}
