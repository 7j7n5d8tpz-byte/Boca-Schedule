import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

// GET /api/notifications — recent notifications for the current user + unread count.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [{ data, error }, { count }] = await Promise.all([
      supabaseAdmin
        .from('notifications')
        .select('notification_id, type, title, body, link, match_id, ref_id, read_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabaseAdmin
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null),
    ]);
    if (error) throw error;

    res.json({
      success: true,
      data: {
        unreadCount: count ?? 0,
        notifications: (data ?? []).map((nt: any) => ({
          notificationId: nt.notification_id,
          type: nt.type,
          title: nt.title,
          body: nt.body,
          link: nt.link,
          matchId: nt.match_id,
          refId: nt.ref_id,
          readAt: nt.read_at,
          createdAt: nt.created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread-count — cheap endpoint for the nav bell badge poll.
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user!.userId)
      .is('read_at', null);
    if (error) throw error;
    res.json({ success: true, data: { unreadCount: count ?? 0 } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/read — mark all of the user's notifications read.
router.put('/read', authenticate, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user!.userId)
      .is('read_at', null);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/:id/read — mark a single notification read.
router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('notification_id', req.params.id)
      .eq('user_id', req.user!.userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
