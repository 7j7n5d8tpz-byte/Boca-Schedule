import webpush from 'web-push';
import { supabaseAdmin } from './supabase.js';

// Web Push (lock-screen notifications on phones and desktops).
//
// Needs a VAPID key pair: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, generated once
// with `npx web-push generate-vapid-keys`, plus VAPID_SUBJECT (a mailto: or
// https: contact the push services can reach). Without the keys (local dev, CI,
// E2E) push is switched off: nothing is sent and the frontend hides the opt-in.

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://boca-schedule.vercel.app';

let configured = false;
export function pushEnabled(): boolean {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export const vapidPublicKey = () => PUBLIC_KEY;

export interface PushPayload {
  title: string;
  body?: string | null;
  url?: string | null;   // in-app path the tap opens, e.g. /dashboard
  tag?: string | null;   // same tag replaces the earlier notification instead of stacking
}

type SubscriptionRow = { subscription_id: string; endpoint: string; p256dh: string; auth: string };

// Send one payload to every device of every user. Never throws: push is a
// best-effort extra next to email and the in-app bell.
export async function sendPush(userIds: string[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!pushEnabled() || userIds.length === 0) return { sent: 0, removed: 0 };

  try {
    const { data: subs, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('subscription_id, endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (error) throw error;
    if (!subs || subs.length === 0) return { sent: 0, removed: 0 };

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? '',
      url: payload.url ?? '/dashboard',
      tag: payload.tag ?? undefined,
    });

    const gone: string[] = [];
    const seen: string[] = [];
    await Promise.all((subs as SubscriptionRow[]).map(async s => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 24 * 60 * 60, urgency: 'normal' },
        );
        seen.push(s.subscription_id);
      } catch (err: any) {
        // 404/410: the subscription is dead (permission revoked, app removed).
        if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(s.subscription_id);
        else console.error(`push to ${new URL(s.endpoint).host} failed:`, err?.statusCode ?? err);
      }
    }));

    if (gone.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('subscription_id', gone);
    }
    if (seen.length > 0) {
      await supabaseAdmin.from('push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() }).in('subscription_id', seen);
    }
    return { sent: seen.length, removed: gone.length };
  } catch (err) {
    console.error('sendPush failed:', err);
    return { sent: 0, removed: 0 };
  }
}
