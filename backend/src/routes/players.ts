import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  preferredPositions: z.array(z.enum(['GK', 'DEF', 'WIN', 'MID', 'STR'])).optional(),
});

// GET /api/players/:playerId/statistics
router.get('/:playerId/statistics', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;

    // Only allow viewing own stats unless coach/admin
    if (playerId !== req.user!.userId && req.user!.role === 'player') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const [{ data: profile }, { data: stats }, { data: recent }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, preferred_positions').eq('user_id', playerId).single(),
      supabaseAdmin.from('player_statistics').select('*').eq('user_id', playerId).single(),
      supabaseAdmin.from('match_performance').select('*, matches(match_date)').eq('player_id', playerId).order('submitted_at', { ascending: false }).limit(10),
    ]);

    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
      return;
    }

    res.json({
      success: true,
      data: {
        player: { userId: profile.user_id, name: profile.name, preferredPositions: profile.preferred_positions },
        seasonStats: stats ?? {},
        recentMatches: (recent ?? []).map((mp: any) => ({
          matchId: mp.match_id,
          matchDate: mp.matches?.match_date,
          attended: mp.attended,
          goals: mp.goals,
          assists: mp.assists,
          minutesPlayed: mp.minutes_played,
          positionPlayed: mp.position_played,
          selfRating: mp.self_rating,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/players/:playerId/profile
router.put('/:playerId/profile', authenticate, async (req, res, next) => {
  try {
    const { playerId } = req.params;

    if (playerId !== req.user!.userId && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Cannot edit another user\'s profile' } });
      return;
    }

    const body = UpdateProfileSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (body.data.name) updates.name = body.data.name;
    if (body.data.preferredPositions) updates.preferred_positions = body.data.preferredPositions;

    const { data, error } = await supabaseAdmin.from('users').update(updates).eq('user_id', playerId).select().single();
    if (error) throw error;

    res.json({ success: true, data: { userId: data.user_id, name: data.name, preferredPositions: data.preferred_positions, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches/:matchId/performance
router.post('/:matchId/performance', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { attended, goals, assists, saves, cleanSheet, yellowCards, redCards, minutesPlayed, positionPlayed, selfRating } = req.body;

    const { data, error } = await supabaseAdmin.from('match_performance').insert({
      match_id: matchId,
      player_id: req.user!.userId,
      attended: attended ?? false,
      goals: goals ?? 0,
      assists: assists ?? 0,
      saves: saves ?? 0,
      clean_sheet: cleanSheet ?? false,
      yellow_cards: yellowCards ?? 0,
      red_cards: redCards ?? 0,
      minutes_played: minutesPlayed,
      position_played: positionPlayed,
      self_rating: selfRating,
      submitted_by: req.user!.userId,
    }).select().single();

    if (error) throw error;

    res.status(201).json({ success: true, data: { performanceId: data.performance_id, matchId, playerId: req.user!.userId, submittedAt: data.submitted_at } });
  } catch (err) {
    next(err);
  }
});

export default router;
