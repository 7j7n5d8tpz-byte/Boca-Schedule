import { supabaseAdmin } from './supabase.js';
import { createNotifications } from './notifications.js';

// A match whose sign-up window has just opened, as needed by the announcement
// notification and email.
export interface OpenedMatch {
  match_id: string;
  match_date: string;
  match_time: string;
  location: string;
  opponent: string | null;
  signup_close_date: string;
}

export const OPENED_MATCH_COLUMNS =
  'match_id, match_date, match_time, location, opponent, signup_close_date';

// "Sat 12 Sep · 20:00 · Hall 1 vs FC X" — the one-liner used as the in-app
// notification body (same shape as the match-day reminder's).
export function openedMatchLabel(m: OpenedMatch): string {
  const dateStr = new Date(`${m.match_date}T${m.match_time}`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  return `${dateStr} · ${m.match_time.slice(0, 5)} · ${m.location}${m.opponent ? ` vs ${m.opponent}` : ''}`;
}

// Tell every active player that sign-ups just opened — in-app, immediately.
//
// The email is deliberately NOT sent here: /api/cron/match-announcements batches
// it so a coach adding six matches in a row produces one email, not six.
//
// Claiming is an atomic stamped update, so the create/update routes and the cron
// can all call this for the same match without anyone getting notified twice.
// Fire-and-forget like the rest of the notification layer: never throws.
export async function notifySignupOpen(matchIds: string[]): Promise<OpenedMatch[]> {
  const ids = [...new Set(matchIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const { data: claimed, error } = await supabaseAdmin
    .from('matches')
    .update({ signup_open_notified_at: new Date().toISOString() })
    .in('match_id', ids)
    .eq('status', 'signup_open')
    .is('signup_open_notified_at', null)
    .select(OPENED_MATCH_COLUMNS);
  if (error) {
    console.error('Failed to claim matches for sign-up-open notification:', error);
    return [];
  }

  const matches = (claimed ?? []) as unknown as OpenedMatch[];
  if (matches.length === 0) return [];

  // Everyone active — placeholder and merged-away accounts are inactive, so
  // this is the playing squad. One notification per match, each linking to it.
  const { data: users, error: userErr } = await supabaseAdmin
    .from('users')
    .select('user_id')
    .eq('is_active', true)
    .is('merged_into', null);
  if (userErr) {
    console.error('Failed to load recipients for sign-up-open notification:', userErr);
    return matches;
  }

  const recipients = (users ?? []).map((u: any) => u.user_id);
  for (const m of matches) {
    await createNotifications(recipients, {
      type: 'signup_open',
      title: 'Sign-ups are open',
      body: openedMatchLabel(m),
      link: '/dashboard',
      matchId: m.match_id,
    });
  }
  return matches;
}

// Flip drafts whose sign-up opening time has arrived. Nothing else in the app
// does this — a match created with a future `signupOpenDate` is stored as a
// draft, and without this it would stay invisible to players forever.
export async function openDueDrafts(now = new Date()): Promise<string[]> {
  const iso = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from('matches')
    .update({ status: 'signup_open' })
    .eq('status', 'draft')
    .lte('signup_open_date', iso)
    .gt('signup_close_date', iso)
    .select('match_id');
  if (error) throw error;
  return (data ?? []).map((m: any) => m.match_id);
}
