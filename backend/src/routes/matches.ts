import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { sendSelectionNotifications, sendCancellationNotifications, sendReleaseNotification } from '../lib/mailer.js';

const router = Router();

const CreateMatchSchema = z.object({
  matchDate: z.string().date(),
  matchTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  location: z.string().min(1).max(200),
  matchType: z.enum(['futsal', '7-player', '11-player']),
  signupOpenDate: z.string().datetime(),
  signupCloseDate: z.string().datetime(),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  opponent: z.string().max(100).optional(),
  matchCategory: z.enum(['serie', 'pokal']).default('serie'),
  serieLetter: z.string().max(2).optional(),
  priorityEnabled: z.boolean().default(true),
  optimizationWeights: z.object({
    fairness: z.number(),
    deficit: z.number(),
    positionCoverage: z.number(),
    preferredPosition: z.number(),
  }).optional(),
});

// GET /api/matches/upcoming
// status param: a single status value, or 'all' to return every non-completed match.
// Coaches/admins use 'all'; players default to 'signup_open'.
router.get('/upcoming', authenticate, async (req, res, next) => {
  try {
    const statusParam = req.query.status as string | undefined;
    const limit  = parseInt(req.query.limit  as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const { role } = req.user!;
    const isCoachView = (role === 'coach' || role === 'admin') && (!statusParam || statusParam === 'all');

    // Auto-complete any published match whose date+time has passed.
    // Runs only on the coach/admin 'all' view to avoid affecting player queries.
    if (isCoachView) {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);          // YYYY-MM-DD
      const nowTimeStr = now.toTimeString().slice(0, 8);        // HH:MM:SS
      await supabaseAdmin
        .from('matches')
        .update({ status: 'completed', completed_at: now.toISOString() })
        .eq('status', 'published')
        .or(`match_date.lt.${todayStr},and(match_date.eq.${todayStr},match_time.lte.${nowTimeStr})`);
    }

    // Fetch matches (left join signups so matches with 0 sign-ups still appear)
    let matchQuery = supabaseAdmin
      .from('matches')
      .select('*, signups(signup_id, player_id, is_active), selections(player_id)', { count: 'exact' })
      .order('match_date', { ascending: true })
      .range(offset, offset + limit - 1);

    if (isCoachView) {
      // Include non-cancelled matches + completed matches from the last 60 days so the
      // "Record results" section on the dashboard shows recently auto-completed matches.
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 60);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      matchQuery = matchQuery
        .neq('status', 'cancelled')
        .or(`status.neq.completed,and(status.eq.completed,match_date.gte.${cutoffStr})`);
    } else if (!statusParam || statusParam === 'all') {
      matchQuery = matchQuery.neq('status', 'completed').neq('status', 'cancelled');
    } else if (statusParam.includes(',')) {
      matchQuery = matchQuery.in('status', statusParam.split(','));
    } else {
      matchQuery = matchQuery.eq('status', statusParam);
    }

    const { data: matches, error, count } = await matchQuery;
    if (error) throw error;

    const matchIds = (matches ?? []).map((m: any) => m.match_id);
    const { data: outgoingSwaps } = matchIds.length > 0
      ? await supabaseAdmin
          .from('swap_requests')
          .select('swap_id, match_id, status, target:users!swap_requests_target_id_fkey(user_id, name)')
          .eq('requester_id', req.user!.userId)
          .eq('status', 'pending')
          .in('match_id', matchIds)
      : { data: [] };

    const swapByMatch = new Map((outgoingSwaps ?? []).map((s: any) => [s.match_id, s]));

    const enriched = (matches ?? []).map((m: any) => {
      const signups = (m.signups ?? []).filter((s: any) => s.is_active);
      const mySignup = signups.find((s: any) => s.player_id === req.user!.userId);
      const isSelected = (m.selections ?? []).some((s: any) => s.player_id === req.user!.userId);
      const pendingSwap = swapByMatch.get(m.match_id);
      return {
        matchId: m.match_id,
        matchDate: m.match_date,
        matchTime: m.match_time,
        location: m.location,
        matchType: m.match_type,
        opponent: m.opponent ?? null,
        matchCategory: m.match_category ?? 'serie',
        serieLetter: m.serie_letter ?? null,
        status: m.status,
        signupCloseDate: m.signup_close_date,
        minPlayers: m.min_players,
        maxPlayers: m.max_players,
        currentSignups: signups.length,
        userSignedUp: !!mySignup,
        signupId: mySignup?.signup_id ?? null,
        signupDeadlinePassed: new Date(m.signup_close_date) < new Date(),
        isSelected,
        pendingSwap: pendingSwap
          ? { swapId: pendingSwap.swap_id, targetName: pendingSwap.target.name, targetId: pendingSwap.target.user_id }
          : null,
      };
    });

    res.json({ success: true, data: { matches: enriched, pagination: { total: count ?? 0, limit, offset } } });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches — coach/admin
router.post('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const body = CreateMatchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: body.data } });
      return;
    }

    const d = body.data;
    const { data, error } = await supabaseAdmin.from('matches').insert({
      match_date: d.matchDate,
      match_time: d.matchTime,
      location: d.location,
      match_type: d.matchType,
      opponent: d.opponent ?? null,
      match_category: d.matchCategory,
      serie_letter: d.matchCategory === 'serie' ? (d.serieLetter ?? 'A') : null,
      signup_open_date: d.signupOpenDate,
      signup_close_date: d.signupCloseDate,
      min_players: d.minPlayers,
      max_players: d.maxPlayers,
      priority_enabled: d.priorityEnabled,
      optimization_weights: d.optimizationWeights ? {
        fairness: d.optimizationWeights.fairness,
        deficit: d.optimizationWeights.deficit,
        position_coverage: d.optimizationWeights.positionCoverage,
        preferred_position: d.optimizationWeights.preferredPosition,
      } : undefined,
      created_by: req.user!.userId,
      status: new Date(d.signupOpenDate) <= new Date() ? 'signup_open' : 'draft',
    }).select().single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: {
        matchId: data.match_id,
        matchDate: data.match_date,
        matchTime: data.match_time,
        location: data.location,
        status: data.status,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

const UpdateMatchSchema = z.object({
  matchDate: z.string().date().optional(),
  matchTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  location: z.string().min(1).max(200).optional(),
  opponent: z.string().max(100).nullable().optional(),
  matchCategory: z.enum(['serie', 'pokal']).optional(),
  serieLetter: z.string().max(2).nullable().optional(),
  status: z.enum(['draft','signup_open','signup_closed','optimized','published','completed','cancelled']).optional(),
  minPlayers: z.number().int().positive().optional(),
  maxPlayers: z.number().int().positive().optional(),
  signupOpenDate: z.string().datetime().optional(),
  signupCloseDate: z.string().datetime().optional(),
});

// PUT /api/matches/:matchId — coach/admin
router.put('/:matchId', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const body = UpdateMatchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
      return;
    }

    const d = body.data;

    // Reject premature manual completion — the match must have already been played.
    if (d.status === 'completed') {
      const { data: existing } = await supabaseAdmin
        .from('matches')
        .select('match_date, match_time')
        .eq('match_id', matchId)
        .single();
      if (existing) {
        const matchDateTime = new Date(`${existing.match_date}T${existing.match_time}`);
        if (matchDateTime > new Date()) {
          res.status(422).json({
            success: false,
            error: { code: 'PREMATURE_COMPLETION', message: 'Match cannot be marked as completed before it has been played' },
          });
          return;
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (d.matchDate !== undefined) updates.match_date = d.matchDate;
    if (d.matchTime !== undefined) updates.match_time = d.matchTime;
    if (d.location !== undefined) updates.location = d.location;
    if (d.opponent !== undefined) updates.opponent = d.opponent;
    if (d.matchCategory !== undefined) {
      updates.match_category = d.matchCategory;
      updates.serie_letter = d.matchCategory === 'serie' ? (d.serieLetter ?? 'A') : null;
    } else if (d.serieLetter !== undefined) {
      updates.serie_letter = d.serieLetter;
    }
    if (d.status !== undefined) updates.status = d.status;
    if (d.minPlayers !== undefined) updates.min_players = d.minPlayers;
    if (d.maxPlayers !== undefined) updates.max_players = d.maxPlayers;
    if (d.signupOpenDate !== undefined) updates.signup_open_date = d.signupOpenDate;
    if (d.signupCloseDate !== undefined) updates.signup_close_date = d.signupCloseDate;

    // Fetch current status before update so we can detect a new cancellation
    const { data: existing } = d.status === 'cancelled'
      ? await supabaseAdmin.from('matches').select('status, match_date, match_time, location, opponent').eq('match_id', matchId).single()
      : { data: null };

    const { data, error } = await supabaseAdmin.from('matches').update(updates).eq('match_id', matchId).select().single();
    if (error) throw error;

    // Fire cancellation emails only when transitioning into cancelled state
    if (d.status === 'cancelled' && existing && existing.status !== 'cancelled') {
      supabaseAdmin
        .from('selections')
        .select('users!selections_player_id_fkey(name, email)')
        .eq('match_id', matchId)
        .then(({ data: sel }) => {
          const players = (sel ?? [])
            .map((s: any) => ({ name: s.users.name as string, email: s.users.email as string }))
            .filter(p => p.email);
          if (players.length > 0) {
            sendCancellationNotifications(players, {
              matchDate: existing.match_date,
              matchTime: existing.match_time,
              location: existing.location,
              opponent: existing.opponent ?? null,
            }).catch(err => console.error('Failed to send cancellation notifications:', err));
          }
        });
    }

    res.json({ success: true, data: { matchId: data.match_id, ...updates, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:matchId/signups — coach/admin
router.get('/:matchId/signups', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const [{ data: match }, { data: signups }] = await Promise.all([
      supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single(),
      supabaseAdmin.from('signups').select('*, users!signups_player_id_fkey(user_id, name, preferred_positions)').eq('match_id', matchId).eq('is_active', true),
    ]);

    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    const playerIds = (signups ?? []).map((s: any) => s.users.user_id);
    const { data: statsData } = playerIds.length > 0
      ? await supabaseAdmin.from('player_statistics').select('user_id, total_played, total_signups').in('user_id', playerIds)
      : { data: [] };
    const statsMap = new Map((statsData ?? []).map((s: any) => [s.user_id, s]));

    res.json({
      success: true,
      data: {
        match: {
          matchId: match.match_id,
          matchDate: match.match_date,
          matchTime: match.match_time,
          location: match.location,
          opponent: match.opponent ?? null,
          matchType: match.match_type,
          matchCategory: match.match_category ?? 'serie',
          serieLetter: match.serie_letter ?? null,
          status: match.status,
          minPlayers: match.min_players,
          maxPlayers: match.max_players,
          signupOpenDate: match.signup_open_date,
          signupCloseDate: match.signup_close_date,
        },
        signups: (signups ?? []).map((s: any) => ({
          signupId: s.signup_id,
          player: {
            userId: s.users.user_id,
            name: s.users.name,
            preferredPositions: s.users.preferred_positions,
            totalPlayed: Number(statsMap.get(s.users.user_id)?.total_played ?? 0),
            totalSignups: Number(statsMap.get(s.users.user_id)?.total_signups ?? 0),
          },
          isPriority: s.is_priority,
          signedUpAt: s.signed_up_at,
        })),
        summary: {
          totalSignups: signups?.length ?? 0,
          prioritySignups: signups?.filter((s: any) => s.is_priority).length ?? 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/publish — coach/admin
router.post('/:matchId/publish', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const { data: match } = await supabaseAdmin.from('matches').select('*').eq('match_id', matchId).single();
    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
      return;
    }

    const { count: selectionCount } = await supabaseAdmin
      .from('selections')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchId);

    if ((selectionCount ?? 0) < match.min_players) {
      res.status(400).json({
        success: false,
        error: { code: 'INSUFFICIENT_SELECTIONS', message: `Cannot publish: Only ${selectionCount} players selected, minimum is ${match.min_players}` },
      });
      return;
    }

    const { data } = await supabaseAdmin.from('matches')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .select()
      .single();

    await supabaseAdmin.from('audit_log').insert({
      user_id: req.user!.userId,
      action: 'match_published',
      entity_type: 'match',
      entity_id: matchId,
      new_values: { status: 'published', selectionCount },
    });

    // Fetch selected players' emails and notify them — fire-and-forget
    supabaseAdmin
      .from('selections')
      .select('users!selections_player_id_fkey(name, email)')
      .eq('match_id', matchId)
      .then(({ data: sel }) => {
        const players = (sel ?? [])
          .map((s: any) => ({ name: s.users.name as string, email: s.users.email as string }))
          .filter(p => p.email);
        if (players.length > 0) {
          sendSelectionNotifications(players, {
            matchDate: match.match_date,
            matchTime: match.match_time,
            location: match.location,
            opponent: match.opponent ?? null,
          }).catch(err => console.error('Failed to send selection notifications:', err));
        }
      });

    res.json({ success: true, data: { matchId: data.match_id, status: 'published', publishedAt: data.published_at, emailsSent: selectionCount } });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/release — selected player releases their spot
router.post('/:matchId/release', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const playerId = req.user!.userId;

    const { data: match } = await supabaseAdmin
      .from('matches')
      .select('match_date, match_time, location, opponent, status')
      .eq('match_id', matchId)
      .single();

    if (!match || match.status !== 'published') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Can only release a spot for a published match' } });
      return;
    }

    const { data: selection } = await supabaseAdmin
      .from('selections')
      .select('selection_id')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .single();

    if (!selection) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'You are not selected for this match' } });
      return;
    }

    await supabaseAdmin.from('selections').delete().eq('selection_id', selection.selection_id);

    const { data: playerProfile } = await supabaseAdmin.from('users').select('name').eq('user_id', playerId).single();

    // Notify all coaches and admins — fire-and-forget
    supabaseAdmin
      .from('users')
      .select('name, email')
      .in('role', ['coach', 'admin'])
      .eq('is_active', true)
      .then(({ data: coaches }) => {
        const recipients = (coaches ?? []).filter((c: any) => c.email);
        if (recipients.length > 0) {
          sendReleaseNotification(
            recipients as { name: string; email: string }[],
            playerProfile?.name ?? 'A player',
            { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null },
            String(matchId),
          ).catch(err => console.error('Failed to send release notification:', err));
        }
      });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:matchId/guests
router.get('/:matchId/guests', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('guest_players')
      .select('guest_id, name, position, created_at')
      .eq('match_id', req.params.matchId)
      .order('created_at');
    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/guests — coach/admin
router.post('/:matchId/guests', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { name, position } = req.body;
    if (!name?.trim()) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name is required' } });
      return;
    }
    const validPositions = ['GK', 'DEF', 'WIN', 'MID', 'STR'];
    if (position && !validPositions.includes(position)) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid position' } });
      return;
    }
    const { data, error } = await supabaseAdmin.from('guest_players').insert({
      match_id: req.params.matchId,
      name: name.trim(),
      position: position || null,
      added_by: req.user!.userId,
    }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data: { guestId: data.guest_id, name: data.name, position: data.position } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/matches/:matchId/guests/:guestId — coach/admin
router.delete('/:matchId/guests/:guestId', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('guest_players')
      .delete()
      .eq('guest_id', req.params.guestId)
      .eq('match_id', req.params.matchId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
