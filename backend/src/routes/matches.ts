import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

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

    // Fetch matches (left join signups so matches with 0 sign-ups still appear)
    let matchQuery = supabaseAdmin
      .from('matches')
      .select('*, signups(player_id, is_active)', { count: 'exact' })
      .order('match_date', { ascending: true })
      .range(offset, offset + limit - 1);

    if (!statusParam || statusParam === 'all') {
      // Coaches see everything except completed
      matchQuery = matchQuery.neq('status', 'completed');
    } else {
      matchQuery = matchQuery.eq('status', statusParam);
    }

    const { data: matches, error, count } = await matchQuery;
    if (error) throw error;

    const enriched = (matches ?? []).map((m: any) => {
      const signups = (m.signups ?? []).filter((s: any) => s.is_active);
      return {
        matchId: m.match_id,
        matchDate: m.match_date,
        matchTime: m.match_time,
        location: m.location,
        matchType: m.match_type,
        status: m.status,
        signupCloseDate: m.signup_close_date,
        minPlayers: m.min_players,
        maxPlayers: m.max_players,
        currentSignups: signups.length,
        userSignedUp: signups.some((s: any) => s.player_id === req.user!.userId),
        signupDeadlinePassed: new Date(m.signup_close_date) < new Date(),
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
      status: 'draft',
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

// PUT /api/matches/:matchId — coach/admin
router.put('/:matchId', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const allowed = ['location', 'signup_close_date', 'status', 'min_players', 'max_players'];
    const updates: Record<string, unknown> = {};

    if (req.body.location) updates.location = req.body.location;
    if (req.body.signupCloseDate) updates.signup_close_date = req.body.signupCloseDate;
    if (req.body.status) updates.status = req.body.status;
    if (req.body.minPlayers) updates.min_players = req.body.minPlayers;
    if (req.body.maxPlayers) updates.max_players = req.body.maxPlayers;

    const { data, error } = await supabaseAdmin.from('matches').update(updates).eq('match_id', matchId).select().single();
    if (error) throw error;

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

    res.json({
      success: true,
      data: {
        match: { matchId: match.match_id, matchDate: match.match_date, matchTime: match.match_time, minPlayers: match.min_players, maxPlayers: match.max_players },
        signups: (signups ?? []).map((s: any) => ({
          signupId: s.signup_id,
          player: { userId: s.users.user_id, name: s.users.name, preferredPositions: s.users.preferred_positions },
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

    res.json({ success: true, data: { matchId: data.match_id, status: 'published', publishedAt: data.published_at, emailsSent: 0 } });
  } catch (err) {
    next(err);
  }
});

export default router;
