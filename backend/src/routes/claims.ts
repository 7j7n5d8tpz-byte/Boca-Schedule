import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  sendSpotClaimNotification,
  sendClaimResolutionNotification,
} from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';

function claimMatchLabel(m: { match_date: string; match_time?: string }): string {
  return new Date(`${m.match_date}T${m.match_time ?? '00:00'}`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Count current selections for a match and compare against capacity.
async function spotIsOpen(matchId: string, maxPlayers: number): Promise<boolean> {
  const { count } = await supabaseAdmin.from('selections')
    .select('selection_id', { count: 'exact', head: true })
    .eq('match_id', matchId);
  return (count ?? 0) < maxPlayers;
}

const router = Router();

// POST /api/matches/:matchId/claims — player claims an open spot
router.post('/matches/:matchId/claims', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const claimantId = req.user!.userId;

    const { data: match } = await supabaseAdmin.from('matches')
      .select('status, match_date, match_time, location, opponent, max_players')
      .eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }
    if (match.status !== 'published') {
      res.status(400).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Can only claim spots on published matches' } });
      return;
    }

    // Already in the squad? Nothing to claim.
    const { data: sel } = await supabaseAdmin.from('selections')
      .select('selection_id')
      .eq('match_id', matchId)
      .eq('player_id', claimantId)
      .maybeSingle();
    if (sel) {
      res.status(400).json({ success: false, error: { code: 'ALREADY_SELECTED', message: 'You are already in the squad for this match' } });
      return;
    }

    if (!(await spotIsOpen(String(matchId), match.max_players))) {
      res.status(400).json({ success: false, error: { code: 'NO_OPEN_SPOT', message: 'There is no open spot for this match' } });
      return;
    }

    // Upsert: re-claiming after a previous cancel/reject reuses the row
    // (UNIQUE (match_id, claimant_id)).
    const { data, error } = await supabaseAdmin.from('spot_claims')
      .upsert(
        { match_id: matchId, claimant_id: claimantId, status: 'pending', resolved_at: null },
        { onConflict: 'match_id,claimant_id' },
      )
      .select().single();
    if (error) throw error;

    // Notify coaches/admins — fire-and-forget
    Promise.all([
      supabaseAdmin.from('users').select('name').eq('user_id', claimantId).single(),
      supabaseAdmin.from('users').select('user_id, name, email')
        .in('role', ['coach', 'admin']).eq('is_active', true),
    ]).then(([{ data: claimant }, { data: coaches }]) => {
      const recipients = (coaches ?? []).filter((c: any) => c.email);
      if (recipients.length > 0) {
        sendSpotClaimNotification(
          recipients as { name: string; email: string }[],
          claimant?.name ?? 'A player',
          { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null },
          String(matchId),
        ).catch(err => console.error('Failed to send spot claim notification:', err));
      }
      createNotifications((coaches ?? []).map((c: any) => c.user_id), {
        type: 'spot_claim',
        title: 'Spot claimed',
        body: `${claimant?.name ?? 'A player'} wants the open spot for ${claimMatchLabel(match)}`,
        link: `/coach/matches/${matchId}/selections`,
        matchId: String(matchId),
        refId: data.claim_id,
      });
    });

    res.status(201).json({ success: true, data: { claimId: data.claim_id, status: data.status } });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:matchId/claims — coach/admin: pending claimants for a match
router.get('/matches/:matchId/claims', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { data, error } = await supabaseAdmin.from('spot_claims')
      .select(`
        claim_id, created_at,
        claimant:users!spot_claims_claimant_id_fkey(user_id, name, preferred_positions)
      `)
      .eq('match_id', matchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;

    const claims = (data ?? []).map((c: any) => ({
      claimId: c.claim_id,
      claimantId: c.claimant.user_id,
      claimantName: c.claimant.name,
      preferredPositions: c.claimant.preferred_positions ?? [],
      createdAt: c.created_at,
    }));

    res.json({ success: true, data: claims });
  } catch (err) {
    next(err);
  }
});

// PUT /api/claims/:claimId/resolve — coach/admin accepts or rejects a claim
router.put('/claims/:claimId/resolve', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { claimId } = req.params;
    const { accept } = req.body as { accept: boolean };
    const coachId = req.user!.userId;

    const { data: claim } = await supabaseAdmin.from('spot_claims')
      .select('*')
      .eq('claim_id', claimId)
      .eq('status', 'pending')
      .single();
    if (!claim) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending claim not found' } });
      return;
    }

    if (accept) {
      // Add claimant to signups if not already active
      const { data: existing } = await supabaseAdmin.from('signups')
        .select('signup_id')
        .eq('match_id', claim.match_id)
        .eq('player_id', claim.claimant_id)
        .is('withdrawn_at', null)
        .maybeSingle();
      if (!existing) {
        await supabaseAdmin.from('signups').insert({ match_id: claim.match_id, player_id: claim.claimant_id });
      }

      // Add claimant to selections (ignore if somehow already there)
      await supabaseAdmin.from('selections').upsert({
        match_id: claim.match_id,
        player_id: claim.claimant_id,
        selected_by_optimization: false,
        manually_adjusted: true,
        is_priority_selection: false,
        selected_by: coachId,
      }, { onConflict: 'match_id,player_id' });

      // Accept this claim; reject all other pending claims for the same match
      await supabaseAdmin.from('spot_claims')
        .update({ status: 'accepted', resolved_at: new Date().toISOString() })
        .eq('claim_id', claimId);

      const { data: rejected } = await supabaseAdmin.from('spot_claims')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('match_id', claim.match_id)
        .eq('status', 'pending')
        .select('claim_id, claimant_id');

      notifyResolution(claim.match_id, claim.claimant_id, (rejected ?? []).map((r: any) => r.claimant_id));
    } else {
      await supabaseAdmin.from('spot_claims')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('claim_id', claimId);

      notifyResolution(claim.match_id, null, [claim.claimant_id]);
    }

    res.json({ success: true, data: { claimId, status: accept ? 'accepted' : 'rejected' } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/claims/:claimId — claimant cancels their own pending claim
router.delete('/claims/:claimId', authenticate, async (req, res, next) => {
  try {
    const { claimId } = req.params;
    const userId = req.user!.userId;

    const { data: claim } = await supabaseAdmin.from('spot_claims')
      .select('claimant_id, status')
      .eq('claim_id', claimId)
      .single();

    if (!claim || claim.claimant_id !== userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
      return;
    }
    if (claim.status !== 'pending') {
      res.status(400).json({ success: false, error: { code: 'ALREADY_RESOLVED', message: 'Claim is no longer pending' } });
      return;
    }

    await supabaseAdmin.from('spot_claims')
      .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
      .eq('claim_id', claimId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Notify the accepted claimant (if any) and any rejected claimants — fire-and-forget.
function notifyResolution(matchId: string, acceptedId: string | null, rejectedIds: string[]) {
  const ids = [...new Set([acceptedId, ...rejectedIds].filter((x): x is string => !!x))];
  if (ids.length === 0) return;

  Promise.all([
    supabaseAdmin.from('matches')
      .select('match_date, match_time, location, opponent')
      .eq('match_id', matchId).single(),
    supabaseAdmin.from('users').select('user_id, name, email').in('user_id', ids),
  ]).then(([{ data: match }, { data: people }]) => {
    if (!match) return;
    const matchInfo = { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null };
    const byId = new Map((people ?? []).map((p: any) => [p.user_id, p]));

    if (acceptedId) {
      const p = byId.get(acceptedId);
      if (p?.email) {
        sendClaimResolutionNotification({ name: p.name, email: p.email }, true, matchInfo)
          .catch(err => console.error('Failed to send claim acceptance email:', err));
      }
      createNotifications([acceptedId], {
        type: 'claim_accepted',
        title: "You're in the squad",
        body: `You got the open spot for ${claimMatchLabel(match)}`,
        link: '/dashboard',
        matchId: String(matchId),
      });
    }

    for (const rid of rejectedIds) {
      const p = byId.get(rid);
      if (p?.email) {
        sendClaimResolutionNotification({ name: p.name, email: p.email }, false, matchInfo)
          .catch(err => console.error('Failed to send claim rejection email:', err));
      }
    }
    if (rejectedIds.length > 0) {
      createNotifications(rejectedIds, {
        type: 'claim_rejected',
        title: 'Spot went to someone else',
        body: `The open spot for ${claimMatchLabel(match)} was filled`,
        link: '/dashboard',
        matchId: String(matchId),
      });
    }
  });
}

export default router;
