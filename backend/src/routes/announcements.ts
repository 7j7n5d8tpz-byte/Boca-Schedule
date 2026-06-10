import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { createNotifications } from '../lib/notifications.js';

const router = Router();

const CreateSchema = z.object({
  body: z.string().trim().min(1).max(500),
  matchId: z.string().uuid().nullish(),
});

// GET /api/announcements — active announcements for any authenticated user.
// An announcement tied to a match auto-hides once that match's date has passed.
router.get('/', authenticate, async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select(`
        announcement_id, body, created_at, match_id,
        author:users!announcements_created_by_fkey(name),
        match:matches!announcements_match_id_fkey(match_id, match_date, opponent)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const active = (data ?? []).filter((a: any) => !a.match || a.match.match_date >= today);

    res.json({
      success: true,
      data: active.map((a: any) => ({
        announcementId: a.announcement_id,
        body: a.body,
        createdAt: a.created_at,
        author: a.author?.name ?? 'Coach',
        match: a.match ? { matchId: a.match.match_id, matchDate: a.match.match_date, opponent: a.match.opponent ?? null } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/announcements — coach/admin
router.post('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Announcement text is required (max 500 chars)' } });
      return;
    }
    const { body, matchId } = parsed.data;

    const { data, error } = await supabaseAdmin.from('announcements').insert({
      body,
      match_id: matchId ?? null,
      created_by: req.user!.userId,
    }).select('announcement_id, body, created_at, match_id').single();
    if (error) throw error;

    // In-app notification to every active user (no email — by design).
    supabaseAdmin.from('users').select('user_id').eq('is_active', true)
      .then(({ data: users }) => {
        createNotifications((users ?? []).map((u: any) => u.user_id), {
          type: 'announcement',
          title: 'New announcement',
          body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
          link: '/dashboard',
        });
      });

    res.status(201).json({
      success: true,
      data: { announcementId: data.announcement_id, body: data.body, createdAt: data.created_at, matchId: data.match_id },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/announcements/:id — coach/admin
router.put('/:id', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Announcement text is required (max 500 chars)' } });
      return;
    }
    const { body, matchId } = parsed.data;

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .update({ body, match_id: matchId ?? null })
      .eq('announcement_id', req.params.id)
      .select('announcement_id, body, created_at, match_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
      return;
    }

    res.json({
      success: true,
      data: { announcementId: data.announcement_id, body: data.body, createdAt: data.created_at, matchId: data.match_id },
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/announcements/:id — coach/admin
router.delete('/:id', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from('announcements').delete().eq('announcement_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
