import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendSignupReminder } from '../lib/mailer.js';

const router = Router();

// POST /api/cron/signup-reminders
//
// Invoked by a scheduled GitHub Actions workflow (see .github/workflows/reminders.yml).
// Guarded by a shared secret in the `x-cron-secret` header — there is no user auth
// here because the caller is a machine, not a logged-in user.
//
// Emails active players who have NOT signed up for any match whose signup deadline
// falls within the next `signup_reminder_hours` (system_config, default 24h), then
// stamps `signup_reminder_sent_at` so each match is reminded exactly once.
router.post('/signup-reminders', async (req, res, next) => {
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

    for (const m of matches as any[]) {
      const signedUp = new Set(
        (m.signups ?? []).filter((s: any) => s.is_active).map((s: any) => s.player_id),
      );
      const recipients = (activeUsers ?? [])
        .filter((u: any) => !signedUp.has(u.user_id) && u.email)
        .map((u: any) => ({ name: u.name, email: u.email }));

      if (recipients.length > 0) {
        await sendSignupReminder(recipients, {
          matchDate: m.match_date,
          matchTime: m.match_time,
          location: m.location,
          opponent: m.opponent ?? null,
          signupCloseDate: m.signup_close_date,
        }).catch(err => console.error('Failed to send signup reminders:', err));
        remindersSent += recipients.length;
      }

      // Stamp regardless of recipient count so we don't re-scan this match every run.
      await supabaseAdmin
        .from('matches')
        .update({ signup_reminder_sent_at: new Date().toISOString() })
        .eq('match_id', m.match_id);
      matchesReminded += 1;
    }

    res.json({ success: true, data: { matchesReminded, remindersSent } });
  } catch (err) {
    next(err);
  }
});

export default router;
