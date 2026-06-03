import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// ─── ICS helpers ──────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }

// Floating local time (no Z / no TZID) from a DATE + TIME. The whole club plays
// in one timezone, so a floating time renders correctly in every member's
// local calendar without shipping a VTIMEZONE block.
function floatingLocal(dateStr: string, timeStr: string, addHours = 0): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi, s] = timeStr.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h + addHours, mi, s || 0);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
}

function utcStamp(date = new Date()): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function meetingTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m - 60;
  const mh = ((Math.floor(total / 60) % 24) + 24) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${pad(mh)}:${pad(mm)}`;
}

interface IcsMatch {
  match_id: string;
  match_date: string;
  match_time: string;
  location: string;
  opponent: string | null;
}

function buildEvent(m: IcsMatch, stamp: string): string {
  const summary = m.opponent ? `Boca Boldisch vs ${m.opponent}` : 'Boca Boldisch match';
  const desc = `Kick-off ${m.match_time.slice(0, 5)} · meet at ${meetingTime(m.match_time)}`;
  return [
    'BEGIN:VEVENT',
    `UID:${m.match_id}@bocaboldisch.dk`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${floatingLocal(m.match_date, m.match_time)}`,
    `DTEND:${floatingLocal(m.match_date, m.match_time, 2)}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(m.location)}`,
    `DESCRIPTION:${esc(desc)}`,
    'END:VEVENT',
  ].join('\r\n');
}

function buildCalendar(events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Boca Boldisch//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Boca Boldisch',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/calendar/me — the current user's subscription token + feed path.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('calendar_token')
      .eq('user_id', req.user!.userId)
      .single();
    if (error) throw error;
    res.json({ success: true, data: { token: data.calendar_token, path: `/api/calendar/${data.calendar_token}.ics` } });
  } catch (err) {
    next(err);
  }
});

// GET /api/calendar/:token.ics — personal subscription feed (no auth header;
// the token authorizes). Lists the user's upcoming matches they're signed up
// for or selected in.
router.get('/:token', async (req, res, next) => {
  try {
    const token = req.params.token.replace(/\.ics$/i, '');

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('user_id')
      .eq('calendar_token', token)
      .maybeSingle();

    if (!user) {
      res.status(404).type('text/plain').send('Calendar not found');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const [{ data: signups }, { data: selections }] = await Promise.all([
      supabaseAdmin.from('signups').select('match_id').eq('player_id', user.user_id).eq('is_active', true),
      supabaseAdmin.from('selections').select('match_id').eq('player_id', user.user_id),
    ]);

    const matchIds = [...new Set([
      ...(signups ?? []).map((s: any) => s.match_id),
      ...(selections ?? []).map((s: any) => s.match_id),
    ])];

    let matches: IcsMatch[] = [];
    if (matchIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('matches')
        .select('match_id, match_date, match_time, location, opponent, status')
        .in('match_id', matchIds)
        .neq('status', 'cancelled')
        .gte('match_date', today)
        .order('match_date');
      matches = (data ?? []) as IcsMatch[];
    }

    const stamp = utcStamp();
    const body = buildCalendar(matches.map(m => buildEvent(m, stamp)));

    res.type('text/calendar; charset=utf-8')
      .set('Content-Disposition', 'inline; filename="boca-boldisch.ics"')
      .send(body);
  } catch (err) {
    next(err);
  }
});

export default router;
