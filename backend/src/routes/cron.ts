import { Router, type Request, type Response } from 'express';
import { supabaseAdmin, must } from '../lib/supabase.js';
import { sendSignupReminder, sendMatchdayReminder, sendSelectionReminder, sendResultReminder, sendSignupOpenAnnouncement, sendShortageAlerts, sendCoachShortageAlerts, shortageLine, SHORTAGE_SUBJECT, type ShortMatch } from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';
import { notifySignupOpen, openDueDrafts } from '../lib/signupOpen.js';
// The daily reminders all send at 18:00 club time.
import { CLUB_TZ, kickoffInstant } from '../lib/clubTime.js';

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
// Invoked every 10 minutes by the in-process scheduler (see server.ts).
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
      .select('match_id, match_date, match_time, location, opponent, min_players, signup_close_date, signups(player_id, is_active)')
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
            missing: Math.max(0, (m.min_players ?? 0) - signedUp.size),
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
// Invoked by the same scheduler as the reminders. Announces matches whose
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
// Invoked by the same scheduler as signup-reminders. Each reminder is stamped
// once per match so a match is never re-reminded.
//   • selection   → coaches, on the first tick after sign-ups closed if no squad
//                   is published (every tick, NOT 18:00-gated: deadlines are
//                   20:00 the night before, so waiting for 18:00 mailed the coach
//                   after a daytime kick-off)
//   • match-day   → selected players, the evening before kick-off (18:00 local)
//   • result      → result-enterers, the day after a played match with no result (18:00 local)
router.post('/daily-reminders', async (req, res) => {
  try {
    if (!cronAuthorized(req, res)) return;

    const now = new Date();
    // `?force=true` bypasses the time gate for manual/ops triggers (still secret-gated).
    const force = req.query.force === 'true';
    const today = clubDate(now);

    const data: Record<string, unknown> = {};
    data.selection = await runSelectionReminders(today, now).catch(e => ({ error: String(e) }));

    if (!force && clubHour(now) !== 18) {
      res.json({ success: true, data: { ...data, skipped: true, reason: 'match-day/result reminders only run at 18:00 Europe/Copenhagen' } });
      return;
    }

    const tomorrow = shiftDate(today, 1);
    data.matchday  = await runMatchdayReminders(tomorrow).catch(e => ({ error: String(e) }));
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
      await must(supabaseAdmin.from('matches').update({ matchday_reminder_sent_at: new Date().toISOString() }).eq('match_id', m.match_id));
    } catch (e) {
      console.error(`matchday reminder: match ${m.match_id} failed:`, e);
    }
  }
  return { matches: matches.length, recipients };
}

// Pick-your-squad: one batched email per coach for matches whose sign-up has
// closed but whose squad isn't published yet. Runs every tick, so it goes out
// within ~10 min of the deadline — never after kick-off.
async function runSelectionReminders(today: string, now: Date) {
  const { data: rows, error } = await supabaseAdmin
    .from('matches')
    .select('match_id, match_date, match_time, location, opponent')
    .is('published_at', null)
    .not('status', 'in', '(cancelled,completed)')
    .lt('signup_close_date', now.toISOString())
    .gte('match_date', today)                       // don't nag about matches already in the past
    .is('selection_reminder_sent_at', null);
  if (error) throw error;
  // match_date >= today still lets through a match that kicked off earlier today.
  const matches = (rows ?? []).filter((m: any) => kickoffInstant(m.match_date, m.match_time) > now);
  if (matches.length === 0) return { matches: 0, coaches: 0 };

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
  await must(supabaseAdmin.from('matches')
    .update({ selection_reminder_sent_at: new Date().toISOString() })
    .in('match_id', (matches as any[]).map(m => m.match_id)));

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

  await must(supabaseAdmin.from('matches')
    .update({ result_reminder_sent_at: new Date().toISOString() })
    .in('match_id', pending.map((m: any) => m.match_id)));

  return { matches: n, recipients: (recipients ?? []).length };
}

// POST /api/cron/shortage-alerts
//
// "Vi mangler DIG på banen!" Runs at 18:00 club time (`?force=true` bypasses the
// gate). A match triggers the alert when it is still open for sign-up, has
// fewer active sign-ups than min_players, and kicks off within the next
// `shortage_alert_days` (system_config, default 7) — so the club hears about the
// first short-handed match a week before it is played.
//
// When anything triggers, each active player gets ONE email listing every
// short-handed open match they haven't signed up for — not only the ones that
// triggered — so a thin weekend shows up as one list. The triggering matches are
// then stamped (`shortage_alert_sent_at`) so each triggers once; a short match
// that was only listed can still trigger its own alert once its deadline nears.
router.post('/shortage-alerts', async (req, res) => {
  try {
    if (!cronAuthorized(req, res)) return;

    const now = new Date();
    const force = req.query.force === 'true';
    if (!force && clubHour(now) !== 18) {
      res.json({ success: true, data: { skipped: true, reason: 'only runs at 18:00 Europe/Copenhagen' } });
      return;
    }

    const alertDays = await configNumber('shortage_alert_days', 7);
    // Compare calendar dates in club time: at 18:00 a match exactly a week out
    // is in, whatever its kick-off hour.
    const lastMatchDate = shiftDate(clubDate(now), alertDays);

    const { data: open, error: matchErr } = await supabaseAdmin
      .from('matches')
      .select('match_id, match_date, match_time, location, opponent, min_players, signup_close_date, shortage_alert_sent_at, signups(player_id, is_active)')
      .eq('status', 'signup_open')
      .gt('signup_close_date', now.toISOString())
      .order('match_date').order('match_time');
    if (matchErr) throw matchErr;

    const short = ((open ?? []) as any[])
      .map(m => {
        const signedUp = new Set<string>((m.signups ?? []).filter((s: any) => s.is_active).map((s: any) => s.player_id));
        return { m, signedUp, missing: (m.min_players ?? 0) - signedUp.size };
      })
      .filter(x => x.missing > 0);
    const triggering = short.filter(x =>
      !x.m.shortage_alert_sent_at && x.m.match_date <= lastMatchDate);

    if (triggering.length === 0) {
      res.json({ success: true, data: { triggered: 0, listed: short.length, recipients: 0 } });
      return;
    }

    const { data: activeUsers, error: userErr } = await supabaseAdmin
      .from('users').select('user_id, name, email')
      .eq('is_active', true).not('email', 'is', null);
    if (userErr) throw userErr;

    const toShortMatch = (x: typeof short[number]): ShortMatch => ({
      matchDate: x.m.match_date, matchTime: x.m.match_time, location: x.m.location,
      opponent: x.m.opponent ?? null, missing: x.missing,
    });
    // Per player: the short matches they aren't on. Nobody gets an empty email.
    const listFor = new Map<string, ShortMatch[]>();
    for (const u of (activeUsers ?? []) as any[]) {
      const list = short.filter(x => !x.signedUp.has(u.user_id)).map(toShortMatch);
      if (list.length > 0) {
        listFor.set(u.email, list);
      }
    }
    const recipients = ((activeUsers ?? []) as any[])
      .filter(u => listFor.has(u.email))
      .map(u => ({ name: u.name, email: u.email }));

    const result = await sendShortageAlerts(recipients, r => listFor.get(r.email)!);

    // Every email failed: the provider is down or the key is bad. Leave the
    // matches unstamped so the next run (or a forced one) retries.
    if (recipients.length > 0 && result.sent === 0) {
      throw new Error(`all ${result.failed.length} shortage alert(s) failed: ${result.failed[0]?.reason}`);
    }

    for (const x of triggering) {
      const ids = ((activeUsers ?? []) as any[])
        .filter(u => listFor.has(u.email) && !x.signedUp.has(u.user_id))
        .map(u => u.user_id as string);
      await createNotifications(ids, {
        type: 'shortage_alert',
        title: SHORTAGE_SUBJECT,
        body: `Vi mangler ${shortageLine(toShortMatch(x))}`,
        link: '/dashboard',
        matchId: x.m.match_id,
      });
    }

    await must(supabaseAdmin.from('matches')
      .update({ shortage_alert_sent_at: now.toISOString() })
      .in('match_id', triggering.map(x => x.m.match_id)));

    res.json({
      success: true,
      data: {
        triggered: triggering.length,
        listed: short.length,
        recipients: result.sent,
        failures: result.failed.map(f => f.email),
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('shortage-alerts failed:', err);
    res.status(500).json({ success: false, error: { code: 'CRON_ERROR', message: detail } });
  }
});

// POST /api/cron/coach-shortage-alerts
//
// Runs on every scheduler tick (no 18:00 gate: the point is to warn the coach
// as soon as sign-ups close). Picks up matches whose sign-up deadline passed in
// the last `COACH_ALERT_LOOKBACK_DAYS`, that are not cancelled or published, are
// still to be played, and have fewer active sign-ups than min_players. Every
// coach/admin gets one batched email plus an in-app notification, and each
// match is stamped (`coach_shortage_alert_sent_at`) so it alerts once. A match
// that had enough players at the deadline keeps being checked during the
// look-back, so a withdrawal straight after the deadline is still caught.
const COACH_ALERT_LOOKBACK_DAYS = 2;

router.post('/coach-shortage-alerts', async (req, res) => {
  try {
    if (!cronAuthorized(req, res)) return;

    const now = new Date();
    const since = new Date(now.getTime() - COACH_ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const { data: closed, error: matchErr } = await supabaseAdmin
      .from('matches')
      .select('match_id, match_date, match_time, location, opponent, min_players, signups(player_id, is_active)')
      .not('status', 'in', '(cancelled,completed)')
      .is('published_at', null)
      .is('coach_shortage_alert_sent_at', null)
      .lte('signup_close_date', now.toISOString())
      .gt('signup_close_date', since.toISOString())
      .gte('match_date', clubDate(now))
      .order('match_date').order('match_time');
    if (matchErr) throw matchErr;

    const short = ((closed ?? []) as any[])
      .filter(m => kickoffInstant(m.match_date, m.match_time) > now) // not one that already kicked off today
      .map(m => ({ m, missing: (m.min_players ?? 0) - (m.signups ?? []).filter((s: any) => s.is_active).length }))
      .filter(x => x.missing > 0);
    if (short.length === 0) {
      res.json({ success: true, data: { matches: 0, coaches: 0 } });
      return;
    }

    const { data: coaches, error: coachErr } = await supabaseAdmin
      .from('users').select('user_id, name, email')
      .in('role', ['coach', 'admin']).eq('is_active', true).not('email', 'is', null);
    if (coachErr) throw coachErr;

    const list: ShortMatch[] = short.map(x => ({
      matchDate: x.m.match_date, matchTime: x.m.match_time, location: x.m.location,
      opponent: x.m.opponent ?? null, missing: x.missing,
    }));
    const recipients = ((coaches ?? []) as any[]).map(c => ({ name: c.name, email: c.email }));
    const result = await sendCoachShortageAlerts(recipients, list);
    if (recipients.length > 0 && result.sent === 0) {
      throw new Error(`all ${result.failed.length} coach shortage alert(s) failed: ${result.failed[0]?.reason}`);
    }

    for (let i = 0; i < short.length; i++) {
      await createNotifications(((coaches ?? []) as any[]).map(c => c.user_id), {
        type: 'shortage_alert',
        title: 'Kampen mangler spillere',
        body: `Tilmeldingen er lukket. Der mangler ${shortageLine(list[i])}`,
        link: '/coach',
        matchId: short[i].m.match_id,
      });
    }

    await must(supabaseAdmin.from('matches')
      .update({ coach_shortage_alert_sent_at: now.toISOString() })
      .in('match_id', short.map(x => x.m.match_id)));

    res.json({
      success: true,
      data: { matches: short.length, coaches: result.sent, failures: result.failed.map(f => f.email) },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('coach-shortage-alerts failed:', err);
    res.status(500).json({ success: false, error: { code: 'CRON_ERROR', message: detail } });
  }
});

export default router;
