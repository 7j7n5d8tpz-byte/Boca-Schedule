import { Router, type Request, type Response } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendSignupReminder, sendMatchdayReminder, sendSelectionReminder, sendResultReminder, sendSignupOpenAnnouncement } from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';
import { notifySignupOpen, openDueDrafts } from '../lib/signupOpen.js';
// The daily reminders all send at 18:00 club time.
import { CLUB_TZ } from '../lib/clubTime.js';

const router = Router();

function clubHour(d: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: CLUB_TZ, hour: '2-digit', hour12: false })
    .formatToParts(d).find(p => p.type === 'hour')?.value ?? '0';
  return Number(h) % 24;
}
function clubDate(d: Date): string {
  // en-CA renders as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLUB_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cronAuthorized(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ success: false, error: { code: 'CRON_DISABLED', message: 'CRON_SECRET is not configured' } });
    return false;
  }
  if (req.header('x-cron-secret') !== secret) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    return false;
  }
  return true;
}

// POST /api/cron/signup-reminders
//
// Invoked by a scheduled GitHub Actions workflow (see .github/workflows/reminders.yml).
// Guarded by a shared secret in the `x-cron-secret` header — there is no user auth
// here because the caller is a machine, not a logged-in user.
//
// Emails active players who have NOT signed up for any match whose signup deadline
// falls within the next `signup_reminder_hours` (system_config, default 24h), then
// stamps `signup_reminder_sent_at` so each match is reminded exactly once.
router.post('/signup-reminders', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      res.status(503).json({ success: false, error: { code: 'CRON_DISABLED', message: 'CRON_SECRET is not configured' } });
      return;
    }
    if (req.header('x-cron-secret') !== secret) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
      return;
    }

    // How many hours before the deadline to remind (system_config, default 24).
    const { data: cfg } = await supabaseAdmin
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'signup_reminder_hours')
      .maybeSingle();
    const reminderHours = Number(cfg?.config_value ?? 24) || 24;

    const now = new Date();
    const windowEnd = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);

    // Matches whose signup closes within the window, still open, not yet reminded.
    const { data: matches, error: matchErr } = await supabaseAdmin
      .from('matches')
      .select('match_id, match_date, match_time, location, opponent, signup_close_date, signups(player_id, is_active)')
      .eq('status', 'signup_open')
      .is('signup_reminder_sent_at', null)
      .gt('signup_close_date', now.toISOString())
      .lte('signup_close_date', windowEnd.toISOString());
    if (matchErr) throw matchErr;

    if (!matches || matches.length === 0) {
      res.json({ success: true, data: { matchesReminded: 0, remindersSent: 0 } });
      return;
    }

    // All active users with an email — candidates to remind.
    const { data: activeUsers, error: userErr } = await supabaseAdmin
      .from('users')
      .select('user_id, name, email')
      .eq('is_active', true)
      .not('email', 'is', null);
    if (userErr) throw userErr;

    let remindersSent = 0;
    let matchesReminded = 0;
    const failures: string[] = [];

    for (const m of matches as any[]) {
      // One bad match (e.g. a malformed date or a transient send/notify error)
      // must not abort the whole run and leave the remaining matches un-stamped
      // — that would re-fail every hour. Isolate each match.
      try {
        const signedUp = new Set(
          (m.signups ?? []).filter((s: any) => s.is_active).map((s: any) => s.player_id),
        );
        const recipientUsers = (activeUsers ?? []).filter((u: any) => !signedUp.has(u.user_id) && u.email);
        const recipients = recipientUsers.map((u: any) => ({ name: u.name, email: u.email }));

        if (recipients.length > 0) {
          const result = await sendSignupReminder(recipients, {
            matchDate: m.match_date,
            matchTime: m.match_time,
            location: m.location,
            opponent: m.opponent ?? null,
            signupCloseDate: m.signup_close_date,
          });
          await createNotifications(recipientUsers.map((u: any) => u.user_id), {
            type: 'signup_reminder',
            title: 'Tilmeldingen lukker snart',
            body: `${new Date(`${m.match_date}T${m.match_time}`).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' })}${m.opponent ? ` vs ${m.opponent}` : ''}`,
            link: '/dashboard',
            matchId: m.match_id,
          });
          remindersSent += result.sent;

          // Every email failed — the provider is down or the key is bad, not a
          // per-address problem. Leave the match unstamped so the next hourly
          // run retries it; stamping here would bin the reminder for the whole
          // club. A partial failure still stamps: re-running would re-mail
          // everyone who did get it.
          if (result.sent === 0) {
            throw new Error(`all ${result.failed.length} signup reminder(s) failed: ${result.failed[0]?.reason}`);
          }
          if (result.failed.length > 0) {
            failures.push(`${m.match_id}: ${result.failed.length}/${recipients.length} email(s) failed`);
          }
        }

        // Stamp regardless of recipient count so we don't re-scan this match every run.
        const { error: stampErr } = await supabaseAdmin
          .from('matches')
          .update({ signup_reminder_sent_at: new Date().toISOString() })
          .eq('match_id', m.match_id);
        if (stampErr) throw stampErr;
        matchesReminded += 1;
      } catch (matchErr) {
        const detail = matchErr instanceof Error ? matchErr.message : String(matchErr);
        console.error(`signup-reminders: match ${m.match_id} failed:`, matchErr);
        failures.push(`${m.match_id}: ${detail}`);
      }
    }

    // Prune read notifications older than 60 days to keep the table lean.
    // Best-effort: a prune failure must not fail the whole reminder run.
    try {
      const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { error: pruneErr } = await supabaseAdmin
        .from('notifications').delete().not('read_at', 'is', null).lt('created_at', cutoff);
      if (pruneErr) throw pruneErr;
    } catch (pruneErr) {
      console.error('signup-reminders: notification prune failed:', pruneErr);
    }

    res.json({ success: true, data: { matchesReminded, remindersSent, failures } });
  } catch (err) {
    // This endpoint is machine-only (secret-gated), so surface the real cause to
    // the caller and the logs instead of the global handler's opaque INTERNAL_ERROR
    // — that opacity is exactly what made this failure hard to diagnose.
    const detail = err instanceof Error ? err.message : String(err);
    console.error('signup-reminders failed:', err);
    res.status(500).json({ success: false, error: { code: 'CRON_ERROR', message: detail } });
  }
});

// A numeric knob from system_config, with a fallback when unset or unparseable.
async function configNumber(key: string, fallback: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from('system_config').select('config_value').eq('config_key', key).maybeSingle();
  const n = Number(data?.config_value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// POST /api/cron/match-announcements
//
// Invoked hourly by the same workflow as the reminders. Announces matches whose
// sign-up window has opened:
//   1. drafts whose opening time has arrived become signup_open
//   2. in-app notification for anything open but not yet announced
//   3. ONE grouped email per player covering every match in the current burst
//      that they haven't already signed up for
//
// The email is held back while matches are still arriving (a coach entering the
// next block of fixtures adds them a minute apart), so the club gets a single
// "sign-ups open for 6 matches" email instead of six. `signup_open_notified_at`
// is the "opened at" instant the grouping works off; `signup_open_emailed_at`
// marks a match as done.
router.post('/match-announcements', async (req, res) => {
  try {
    if (!cronAuthorized(req, res)) return;

    const now = new Date();
    const nowIso = now.toISOString();

    const opened = await openDueDrafts(now);

    // Anything open without an in-app announcement yet: the drafts just flipped
    // above, plus any match whose create-time notification failed.
    const { data: unannounced, error: unErr } = await supabaseAdmin
      .from('matches')
      .select('match_id')
      .eq('status', 'signup_open')
      .is('signup_open_notified_at', null)
      .gt('signup_close_date', nowIso);
    if (unErr) throw unErr;
    const notified = await notifySignupOpen((unannounced ?? []).map((m: any) => m.match_id));

    // Retire matches that were announced in-app but can no longer be emailed
    // about — the deadline passed while they waited, or they were cancelled or
    // moved on. Without this they'd be rescanned on every run, forever. Two
    // plain filters rather than one `.or()`, because a PostgREST or-clause has
    // to embed the timestamp in its comma/dot-delimited grammar.
    const retire = () => supabaseAdmin
      .from('matches')
      .update({ signup_open_emailed_at: nowIso })
      .is('signup_open_emailed_at', null)
      .not('signup_open_notified_at', 'is', null);
    await retire().lte('signup_close_date', nowIso);
    await retire().neq('status', 'signup_open');

    const { data: pending, error: pendErr } = await supabaseAdmin
      .from('matches')
      .select('match_id, match_date, match_time, location, opponent, signup_close_date, signup_open_notified_at')
      .eq('status', 'signup_open')
      .is('signup_open_emailed_at', null)
      .not('signup_open_notified_at', 'is', null)
      .gt('signup_close_date', nowIso)
      .order('match_date', { ascending: true });
    if (pendErr) throw pendErr;

    if (!pending || pending.length === 0) {
      res.json({ success: true, data: { opened: opened.length, notified: notified.length, matches: 0, recipients: 0 } });
      return;
    }

    // Hold the email while the burst is still growing, but never longer than the
    // max-defer cap — otherwise a coach adding one match every quiet-window
    // could postpone the email indefinitely.
    const quietMinutes = await configNumber('signup_open_quiet_minutes', 20);
    const maxDeferHours = await configNumber('signup_open_max_defer_hours', 3);
    const openedAt = (pending as any[]).map(m => new Date(m.signup_open_notified_at).getTime());
    const stillArriving = now.getTime() - Math.max(...openedAt) < quietMinutes * 60 * 1000;
    const waitedLongEnough = now.getTime() - Math.min(...openedAt) >= maxDeferHours * 60 * 60 * 1000;
    if (stillArriving && !waitedLongEnough) {
      res.json({
        success: true,
        data: { opened: opened.length, notified: notified.length, deferred: pending.length, reason: 'still inside the quiet window' },
      });
      return;
    }

    const { data: recipients, error: recErr } = await supabaseAdmin
      .from('users')
      .select('user_id, name, email')
      .eq('is_active', true)
      .is('merged_into', null)
      .not('email', 'is', null);
    if (recErr) throw recErr;

    // Anyone who signed up while the email was still batching has already acted
    // on that match — leave it out of their copy, and skip them entirely if it
    // was the only one. Withdrawn sign-ups (is_active false) don't count.
    const matchIds = (pending as any[]).map(m => m.match_id);
    const { data: signups, error: signupErr } = await supabaseAdmin
      .from('signups')
      .select('match_id, player_id')
      .in('match_id', matchIds)
      .eq('is_active', true);
    if (signupErr) throw signupErr;

    const signedUpByPlayer = new Map<string, Set<string>>();
    for (const s of (signups ?? []) as any[]) {
      const set = signedUpByPlayer.get(s.player_id) ?? new Set<string>();
      set.add(s.match_id);
      signedUpByPlayer.set(s.player_id, set);
    }

    const announced = (pending as any[]).map(m => ({
      matchId: m.match_id,
      matchDate: m.match_date,
      matchTime: m.match_time,
      location: m.location,
      opponent: m.opponent ?? null,
      signupCloseDate: m.signup_close_date,
    }));

    let emailed = 0;
    let skipped = 0;
    for (const r of (recipients ?? []) as any[]) {
      const alreadyIn = signedUpByPlayer.get(r.user_id);
      const theirs = alreadyIn ? announced.filter(m => !alreadyIn.has(m.matchId)) : announced;
      if (theirs.length === 0) { skipped += 1; continue; }
      await sendSignupOpenAnnouncement({ name: r.name, email: r.email }, theirs)
        .catch(err => console.error('sign-ups open email failed:', err));
      emailed += 1;
    }

    const { error: stampErr } = await supabaseAdmin
      .from('matches')
      .update({ signup_open_emailed_at: new Date().toISOString() })
      .in('match_id', (pending as any[]).map(m => m.match_id));
    if (stampErr) throw stampErr;

    res.json({
      success: true,
      data: { opened: opened.length, notified: notified.length, matches: pending.length, recipients: emailed, skipped },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('match-announcements failed:', err);
    res.status(500).json({ success: false, error: { code: 'CRON_ERROR', message: detail } });
  }
});

// POST /api/cron/daily-reminders
//
// Invoked hourly by the same workflow as signup-reminders, but only does work at
// the 18:00 hour in Europe/Copenhagen — all three reminders below send at 18:00
// local. Each is stamped once per match so a match is never re-reminded.
//   • match-day   → selected players, the evening before kick-off
//   • selection   → coaches, the day after sign-ups closed if no squad published
//   • result      → result-enterers, the day after a played match with no result
router.post('/daily-reminders', async (req, res) => {
  try {
    if (!cronAuthorized(req, res)) return;

    const now = new Date();
    // `?force=true` bypasses the time gate for manual/ops triggers (still secret-gated).
    const force = req.query.force === 'true';
    if (!force && clubHour(now) !== 18) {
      res.json({ success: true, data: { skipped: true, reason: 'only runs at 18:00 Europe/Copenhagen' } });
      return;
    }

    const today = clubDate(now);
    const tomorrow = shiftDate(today, 1);

    const data: Record<string, unknown> = {};
    data.matchday  = await runMatchdayReminders(tomorrow).catch(e => ({ error: String(e) }));
    data.selection = await runSelectionReminders(today, now).catch(e => ({ error: String(e) }));
    data.result    = await runResultReminders(today).catch(e => ({ error: String(e) }));

    res.json({ success: true, data });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('daily-reminders failed:', err);
    res.status(500).json({ success: false, error: { code: 'CRON_ERROR', message: detail } });
  }
});

// Match-day: remind every selected player the evening before kick-off.
async function runMatchdayReminders(matchDate: string) {
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select('match_id, match_date, match_time, location, opponent, selections(player_id)')
    .eq('status', 'published')
    .eq('match_date', matchDate)
    .is('matchday_reminder_sent_at', null);
  if (error) throw error;
  if (!matches || matches.length === 0) return { matches: 0, recipients: 0 };

  // Resolve selected players' contact details in one batch.
  const playerIds = [...new Set((matches as any[]).flatMap(m => (m.selections ?? []).map((s: any) => s.player_id)))];
  const usersById = new Map<string, { name: string; email: string }>();
  if (playerIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users').select('user_id, name, email')
      .in('user_id', playerIds).eq('is_active', true).not('email', 'is', null);
    (users ?? []).forEach((u: any) => usersById.set(u.user_id, { name: u.name, email: u.email }));
  }

  let recipients = 0;
  for (const m of matches as any[]) {
    try {
      const ids = (m.selections ?? []).map((s: any) => s.player_id).filter((id: string) => usersById.has(id));
      if (ids.length > 0) {
        const mr = { matchDate: m.match_date, matchTime: m.match_time, location: m.location, opponent: m.opponent ?? null };
        await sendMatchdayReminder(ids.map((id: string) => usersById.get(id)!), mr)
          .catch(err => console.error('matchday email failed:', err));
        const dateStr = new Date(`${m.match_date}T${m.match_time}`).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
        await createNotifications(ids, {
          type: 'matchday_reminder',
          title: 'Kamp i morgen',
          body: `${dateStr}${m.opponent ? ` vs ${m.opponent}` : ''} · ${m.match_time.slice(0, 5)} · ${m.location}`,
          link: '/dashboard',
          matchId: m.match_id,
        });
        recipients += ids.length;
      }
      // Stamp regardless so the match isn't re-scanned next run.
      await supabaseAdmin.from('matches').update({ matchday_reminder_sent_at: new Date().toISOString() }).eq('match_id', m.match_id);
    } catch (e) {
      console.error(`matchday reminder: match ${m.match_id} failed:`, e);
    }
  }
  return { matches: matches.length, recipients };
}

// Pick-your-squad: one batched email per coach for matches whose sign-up has
// closed (deadlines are 20:00 local, so "deadline passed" at the 18:00 run means
// the day after) but whose squad isn't published yet.
async function runSelectionReminders(today: string, now: Date) {
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select('match_id, match_date, match_time, location, opponent')
    .is('published_at', null)
    .neq('status', 'cancelled')
    .lt('signup_close_date', now.toISOString())
    .gte('match_date', today)                       // don't nag about matches already in the past
    .is('selection_reminder_sent_at', null);
  if (error) throw error;
  if (!matches || matches.length === 0) return { matches: 0, coaches: 0 };

  const reminderMatches = (matches as any[]).map(m => ({ matchDate: m.match_date, matchTime: m.match_time, location: m.location, opponent: m.opponent ?? null }));

  const { data: coaches } = await supabaseAdmin
    .from('users').select('user_id, name, email')
    .in('role', ['coach', 'admin']).eq('is_active', true).not('email', 'is', null);

  for (const c of (coaches ?? []) as any[]) {
    await sendSelectionReminder({ name: c.name, email: c.email }, reminderMatches)
      .catch(err => console.error('selection reminder email failed:', err));
  }
  const n = matches.length;
  await createNotifications((coaches ?? []).map((c: any) => c.user_id), {
    type: 'selection_reminder',
    title: n === 1 ? 'En trup skal udtages' : `${n} trupper skal udtages`,
    body: 'Tilmeldingen er lukket — offentliggør truppen.',
    link: '/coach',
  });

  // Stamp every included match so it isn't re-reminded.
  await supabaseAdmin.from('matches')
    .update({ selection_reminder_sent_at: new Date().toISOString() })
    .in('match_id', (matches as any[]).map(m => m.match_id));

  return { matches: n, coaches: (coaches ?? []).length };
}

// Record-the-result: one batched email per result-enterer for matches that were
// played (before today) but have no result recorded yet.
async function runResultReminders(today: string) {
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select('match_id, match_date, match_time, location, opponent, match_results(result_id)')
    .neq('status', 'cancelled')
    .lt('match_date', today)
    .is('result_reminder_sent_at', null);
  if (error) throw error;

  const pending = (matches ?? []).filter((m: any) => !m.match_results || m.match_results.length === 0);
  if (pending.length === 0) return { matches: 0, recipients: 0 };

  const reminderMatches = pending.map((m: any) => ({ matchDate: m.match_date, matchTime: m.match_time, location: m.location, opponent: m.opponent ?? null }));

  const { data: recipients } = await supabaseAdmin
    .from('users').select('user_id, name, email')
    .or('role.in.(coach,admin),can_enter_results.eq.true')
    .eq('is_active', true).not('email', 'is', null);

  for (const r of (recipients ?? []) as any[]) {
    await sendResultReminder({ name: r.name, email: r.email }, reminderMatches)
      .catch(err => console.error('result reminder email failed:', err));
  }
  const n = pending.length;
  await createNotifications((recipients ?? []).map((r: any) => r.user_id), {
    type: 'result_reminder',
    title: n === 1 ? 'Registrér resultatet' : `Registrér ${n} resultater`,
    body: 'Spillet, men resultatet er ikke registreret endnu.',
    link: '/coach',
  });

  await supabaseAdmin.from('matches')
    .update({ result_reminder_sent_at: new Date().toISOString() })
    .in('match_id', pending.map((m: any) => m.match_id));

  return { matches: n, recipients: (recipients ?? []).length };
}

export default router;
