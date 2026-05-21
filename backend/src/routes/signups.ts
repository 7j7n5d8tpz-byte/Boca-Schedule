import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// POST /api/signups
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.body;
    if (!matchId) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'matchId required' } });
      return;
    }

    const { data: match } = await supabaseAdmin.from('matches').select('status, signup_close_date').eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }
    if (match.status !== 'signup_open' || new Date(match.signup_close_date) < new Date()) {
      res.status(400).json({ success: false, error: { code: 'SIGNUP_CLOSED', message: 'Signup window has closed for this match' } });
      return;
    }

    const { data: existing } = await supabaseAdmin.from('signups')
      .select('signup_id, withdrawn_at')
      .eq('match_id', matchId)
      .eq('player_id', req.user!.userId)
      .is('withdrawn_at', null)
      .maybeSingle();

    if (existing) {
      res.status(409).json({ success: false, error: { code: 'ALREADY_SIGNED_UP', message: 'You are already signed up for this match' } });
      return;
    }

    const { data, error } = await supabaseAdmin.from('signups').insert({
      match_id: matchId,
      player_id: req.user!.userId,
    }).select().single();

    if (error) throw error;

    res.status(201).json({ success: true, data: { signupId: data.signup_id, matchId, playerId: req.user!.userId, signedUpAt: data.signed_up_at } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/signups/:signupId
router.delete('/:signupId', authenticate, async (req, res, next) => {
  try {
    const { signupId } = req.params;

    const { data: signup } = await supabaseAdmin.from('signups')
      .select('player_id, match_id, matches(status)')
      .eq('signup_id', signupId)
      .single();

    if (!signup) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Signup not found' } });
      return;
    }
    if (signup.player_id !== req.user!.userId) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot withdraw from another player\'s signup' } });
      return;
    }

    const matchStatus = (signup.matches as any)?.status;
    if (matchStatus === 'published' || matchStatus === 'completed') {
      res.status(403).json({ success: false, error: { code: 'WITHDRAWAL_NOT_ALLOWED', message: 'Cannot withdraw after selection has been published' } });
      return;
    }

    await supabaseAdmin.from('signups').update({ withdrawn_at: new Date().toISOString() }).eq('signup_id', signupId);

    res.json({ success: true, message: 'Successfully withdrawn from match' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/signups/:signupId/priority — coach/admin
router.put('/:signupId/priority', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { signupId } = req.params;
    const { isPriority } = req.body;

    const { data, error } = await supabaseAdmin.from('signups').update({
      is_priority: isPriority,
      priority_set_by: req.user!.userId,
      priority_set_at: new Date().toISOString(),
    }).eq('signup_id', signupId).select().single();

    if (error) throw error;

    res.json({ success: true, data: { signupId: data.signup_id, isPriority: data.is_priority, prioritySetBy: data.priority_set_by, prioritySetAt: data.priority_set_at } });
  } catch (err) {
    next(err);
  }
});

export default router;
