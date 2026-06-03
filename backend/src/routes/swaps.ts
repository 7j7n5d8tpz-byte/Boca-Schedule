import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  sendSwapRequestNotification,
  sendSwapResponseNotification,
  sendReleaseNotification,
} from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';

function swapMatchLabel(m: { match_date: string; match_time?: string }): string {
  return new Date(`${m.match_date}T${m.match_time ?? '00:00'}`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const router = Router();

// POST /api/matches/:matchId/swaps — selected player nominates a replacement
router.post('/matches/:matchId/swaps', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { targetPlayerId } = req.body as { targetPlayerId: string };
    const requesterId = req.user!.userId;

    if (!targetPlayerId) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'targetPlayerId required' } });
      return;
    }
    if (targetPlayerId === requesterId) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Cannot swap with yourself' } });
      return;
    }

    const { data: match } = await supabaseAdmin.from('matches')
      .select('status, match_date, match_time, location, opponent')
      .eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }
    if (match.status !== 'published') {
      res.status(400).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Can only request swaps for published matches' } });
      return;
    }

    const { data: sel } = await supabaseAdmin.from('selections')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('player_id', requesterId)
      .maybeSingle();

    if (!sel) {
      res.status(403).json({ success: false, error: { code: 'NOT_SELECTED', message: 'You are not in the squad for this match' } });
      return;
    }

    // Cancel any existing pending swap for this requester + match
    await supabaseAdmin.from('swap_requests')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .eq('requester_id', requesterId)
      .eq('status', 'pending');

    const { data, error } = await supabaseAdmin.from('swap_requests').insert({
      match_id: matchId,
      requester_id: requesterId,
      target_id: targetPlayerId,
    }).select().single();

    if (error) throw error;

    // Notify the target player — fire-and-forget
    supabaseAdmin.from('users')
      .select('user_id, name, email')
      .in('user_id', [targetPlayerId, requesterId])
      .then(({ data: people }) => {
        const target    = (people ?? []).find((p: any) => p.user_id === targetPlayerId);
        const requester = (people ?? []).find((p: any) => p.user_id === requesterId);
        if (target?.email) {
          sendSwapRequestNotification(
            { name: target.name, email: target.email },
            requester?.name ?? 'A teammate',
            { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null },
          ).catch(err => console.error('Failed to send swap request notification:', err));
        }
        createNotifications([targetPlayerId], {
          type: 'swap_request',
          title: 'Can you cover a spot?',
          body: `${requester?.name ?? 'A teammate'} asked you to cover ${swapMatchLabel(match)}`,
          link: '/dashboard',
          matchId: String(matchId),
          refId: data.swap_id,
        });
      });

    res.status(201).json({ success: true, data: { swapId: data.swap_id, status: data.status } });
  } catch (err) {
    next(err);
  }
});

// GET /api/swaps/incoming — pending swap requests targeting current user
router.get('/swaps/incoming', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('swap_requests')
      .select(`
        swap_id, match_id, created_at,
        requester:users!swap_requests_requester_id_fkey(user_id, name),
        match:matches(match_date, match_time, location)
      `)
      .eq('target_id', req.user!.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const incoming = (data ?? []).map((r: any) => ({
      swapId: r.swap_id,
      matchId: r.match_id,
      matchDate: r.match.match_date,
      matchTime: r.match.match_time,
      location: r.match.location,
      requesterName: r.requester.name,
      requesterId: r.requester.user_id,
      createdAt: r.created_at,
    }));

    res.json({ success: true, data: incoming });
  } catch (err) {
    next(err);
  }
});

// PUT /api/swaps/:swapId/respond — accept or decline
router.put('/swaps/:swapId/respond', authenticate, async (req, res, next) => {
  try {
    const { swapId } = req.params;
    const { accept } = req.body as { accept: boolean };
    const userId = req.user!.userId;

    const { data: swap } = await supabaseAdmin
      .from('swap_requests')
      .select('*')
      .eq('swap_id', swapId)
      .eq('target_id', userId)
      .eq('status', 'pending')
      .single();

    if (!swap) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending swap request not found' } });
      return;
    }

    if (accept) {
      // Remove requester from selections
      await supabaseAdmin.from('selections').delete()
        .eq('match_id', swap.match_id)
        .eq('player_id', swap.requester_id);

      // Add target to signups if not already active
      const { data: existing } = await supabaseAdmin.from('signups')
        .select('signup_id')
        .eq('match_id', swap.match_id)
        .eq('player_id', userId)
        .is('withdrawn_at', null)
        .maybeSingle();

      if (!existing) {
        await supabaseAdmin.from('signups').insert({ match_id: swap.match_id, player_id: userId });
      }

      // Add target to selections
      await supabaseAdmin.from('selections').insert({
        match_id: swap.match_id,
        player_id: userId,
        selected_by_optimization: false,
        manually_adjusted: true,
        is_priority_selection: false,
        selected_by: userId,
      });
    }

    await supabaseAdmin.from('swap_requests').update({
      status: accept ? 'accepted' : 'declined',
      resolved_at: new Date().toISOString(),
    }).eq('swap_id', swapId);

    // Notify the requester of the outcome (and coaches when the squad changed) — fire-and-forget
    Promise.all([
      supabaseAdmin.from('matches')
        .select('match_date, match_time, location, opponent')
        .eq('match_id', swap.match_id).single(),
      supabaseAdmin.from('users').select('user_id, name, email')
        .in('user_id', [swap.requester_id, userId]),
    ]).then(([{ data: match }, { data: people }]) => {
      if (!match) return;
      const requester = (people ?? []).find((p: any) => p.user_id === swap.requester_id);
      const target    = (people ?? []).find((p: any) => p.user_id === userId);
      const matchInfo = { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null };

      if (requester?.email) {
        sendSwapResponseNotification(
          { name: requester.name, email: requester.email },
          target?.name ?? 'A teammate',
          accept,
          matchInfo,
        ).catch(err => console.error('Failed to send swap response notification:', err));
      }
      createNotifications([swap.requester_id], {
        type: accept ? 'swap_accepted' : 'swap_declined',
        title: accept ? 'Swap accepted' : 'Swap declined',
        body: `${target?.name ?? 'A teammate'} ${accept ? 'accepted' : 'declined'} your swap for ${swapMatchLabel(match)}`,
        link: '/dashboard',
        matchId: swap.match_id,
      });

      if (accept) {
        supabaseAdmin.from('users')
          .select('name, email')
          .in('role', ['coach', 'admin'])
          .eq('is_active', true)
          .then(({ data: coaches }) => {
            const recipients = (coaches ?? []).filter((c: any) => c.email);
            if (recipients.length > 0) {
              sendReleaseNotification(
                recipients as { name: string; email: string }[],
                `${requester?.name ?? 'A player'} (covered by ${target?.name ?? 'a teammate'})`,
                matchInfo,
                String(swap.match_id),
              ).catch(err => console.error('Failed to notify coaches of swap:', err));
            }
          });
      }
    });

    res.json({ success: true, data: { swapId, status: accept ? 'accepted' : 'declined' } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/swaps/:swapId — cancel by requester
router.delete('/swaps/:swapId', authenticate, async (req, res, next) => {
  try {
    const { swapId } = req.params;
    const userId = req.user!.userId;

    const { data: swap } = await supabaseAdmin.from('swap_requests')
      .select('requester_id, status')
      .eq('swap_id', swapId)
      .single();

    if (!swap || swap.requester_id !== userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Swap request not found' } });
      return;
    }
    if (swap.status !== 'pending') {
      res.status(400).json({ success: false, error: { code: 'ALREADY_RESOLVED', message: 'Swap is no longer pending' } });
      return;
    }

    await supabaseAdmin.from('swap_requests').update({
      status: 'cancelled',
      resolved_at: new Date().toISOString(),
    }).eq('swap_id', swapId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
