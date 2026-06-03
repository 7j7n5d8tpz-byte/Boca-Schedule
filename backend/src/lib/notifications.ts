import { supabaseAdmin } from './supabase.js';

export type NotificationType =
  | 'selected'
  | 'match_cancelled'
  | 'match_moved'
  | 'signup_reminder'
  | 'announcement'
  | 'spot_released'
  | 'spot_open'
  | 'spot_claim'
  | 'claim_accepted'
  | 'claim_rejected'
  | 'result_permission_request'
  | 'registration';

interface NewNotification {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  matchId?: string | null;
  refId?: string | null;
}

// Bulk-create one notification per recipient. Fire-and-forget: failures are
// logged, never thrown, so a notification problem can't break the request that
// triggered it (mirrors the mailer's fire-and-forget pattern).
export async function createNotifications(userIds: Array<string | null | undefined>, n: NewNotification): Promise<void> {
  const recipients = [...new Set(userIds.filter((id): id is string => !!id))];
  if (recipients.length === 0) return;

  const rows = recipients.map(uid => ({
    user_id: uid,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    match_id: n.matchId ?? null,
    ref_id: n.refId ?? null,
  }));

  const { error } = await supabaseAdmin.from('notifications').insert(rows);
  if (error) console.error('Failed to create notifications:', error);
}
