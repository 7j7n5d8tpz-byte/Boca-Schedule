import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { sendSelectionNotifications, sendCancellationNotifications, sendReleaseNotification, sendSpotOpenNotification } from '../lib/mailer.js';
import { walkoverScore, type CancelledBy } from '../lib/walkover.js';
import { createNotifications } from '../lib/notifications.js';
import { notifySignupOpen } from '../lib/signupOpen.js';
import { resolveOpponent } from '../lib/opponents.js';
import { lateSignupOpen } from '../lib/lateSignup.js';
import { kickoffInstant, clubDateString, clubTimeString } from '../lib/clubTime.js';
import { seasonStartYear, seasonRange, seasonLabel } from '../lib/season.js';
import { buildPlayedKeys } from '../lib/participation.js';
import { cellState, selectionPct, type CellState } from '../lib/seasonOverview.js';

// Human-readable match label for notification copy, e.g. "Sat 7 Jun vs FC X".
function matchLabel(m: { match_date: string; match_time?: string; opponent?: string | null }): string {
  const d = new Date(`${m.match_date}T${m.match_time ?? '00:00'}`);
  const date = d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
  return m.opponent ? `${date} vs ${m.opponent}` : date;
}

// A sign-up deadline after kick-off is nonsense: players could sign up for a
// match that has already been played, and the match never leaves `signup_open`,
// so it never auto-completes and the result can't be entered. Reject it at the
// door — on create and on every edit that moves either end of the window.
function deadlineAfterKickoff(matchDate: string, matchTime: string, signupCloseDate: string): boolean {
  return new Date(signupCloseDate) > kickoffInstant(matchDate, matchTime);
}

const DEADLINE_AFTER_KICKOFF = {
  code: 'DEADLINE_AFTER_KICKOFF',
  message: 'Tilmeldingsfristen skal ligge før kampstart',
} as const;

// Mark every live match whose kick-off has passed as completed. Uses the club
// wall-clock, because match_date/match_time are naive club time — comparing
// them against a UTC clock completes matches hours late.
async function autoCompletePastMatches(): Promise<void> {
  const now = new Date();
  const todayStr = clubDateString(now);                     // YYYY-MM-DD
  const nowTimeStr = clubTimeString(now);                   // HH:MM:SS
  await supabaseAdmin
    .from('matches')
    .update({ status: 'completed', completed_at: now.toISOString() })
    .in('status', ['signup_open', 'signup_closed', 'optimized', 'published'])
    .or(`match_date.lt.${todayStr},and(match_date.eq.${todayStr},match_time.lte.${nowTimeStr})`);
}

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
  opponentId: z.string().uuid().optional(),
  matchCategory: z.enum(['serie', 'pokal']).default('serie'),
  serieLetter: z.string().max(10).optional(),
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
    // Coach-view (which also surfaces recently-completed matches for results entry)
    // requires an EXPLICIT status=all — the coach dashboard passes it. A bare
    // /matches/upcoming (the shared player home, used by every role) must never
    // return completed matches, otherwise an admin/coach opening the home sees
    // past matches under "Upcoming".
    const isCoachView = (role === 'coach' || role === 'admin') && statusParam === 'all';

    // Auto-complete any live match whose kick-off has passed.
    //
    // Not just `published`: a match the coach never got round to closing or
    // publishing was still played, and while it sits in `signup_open` it never
    // reaches the "Record results" list — the coach can't enter the result at
    // all. Drafts stay put (never announced, never played), as do cancelled
    // matches. Runs only on the coach/admin 'all' view to avoid affecting
    // player queries.
    if (isCoachView) await autoCompletePastMatches();

    // Fetch matches (left join signups so matches with 0 sign-ups still appear)
    let matchQuery = supabaseAdmin
      .from('matches')
      .select('*, signups(signup_id, player_id, is_active, signed_up_at), selections(player_id), match_results(result_id)', { count: 'exact' })
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
      const statuses = statusParam.split(',');
      matchQuery = matchQuery.in('status', statuses);
      // The result-recording view (status=published,completed) only cares about
      // recent matches — bound completed matches to the last 60 days so the list
      // doesn't fill with old, long-since-recorded history.
      if (statuses.includes('completed')) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 60);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        matchQuery = matchQuery.or(`status.neq.completed,and(status.eq.completed,match_date.gte.${cutoffStr})`);
      }
    } else {
      matchQuery = matchQuery.eq('status', statusParam);
    }

    const { data: matches, error, count } = await matchQuery;
    if (error) throw error;

    const matchIds = (matches ?? []).map((m: any) => m.match_id);
    const { data: myClaims } = matchIds.length > 0
      ? await supabaseAdmin
          .from('spot_claims')
          .select('claim_id, match_id, status')
          .eq('claimant_id', req.user!.userId)
          .eq('status', 'pending')
          .in('match_id', matchIds)
      : { data: [] };

    const claimByMatch = new Map((myClaims ?? []).map((c: any) => [c.match_id, c]));

    const enriched = (matches ?? []).map((m: any) => {
      const signups = (m.signups ?? []).filter((s: any) => s.is_active);
      const mySignup = signups.find((s: any) => s.player_id === req.user!.userId);
      const isSelected = (m.selections ?? []).some((s: any) => s.player_id === req.user!.userId);
      const myClaim = claimByMatch.get(m.match_id);
      // An open spot = a published match whose squad is below capacity.
      const openSpot = m.status === 'published' && (m.selections ?? []).length < m.max_players;
      // Past the deadline, sign-ups reopen while the match is short of players.
      // Kick-off counts as the deadline whatever the coach set, so a match that
      // has already been played never shows a sign-up button.
      const deadlinePassed = new Date(m.signup_close_date) < new Date()
        || kickoffInstant(m.match_date, m.match_time) <= new Date();
      const lateOpen = deadlinePassed && lateSignupOpen(m, signups.length);
      return {
        matchId: m.match_id,
        matchDate: m.match_date,
        matchTime: m.match_time,
        location: m.location,
        matchType: m.match_type,
        opponent: m.opponent ?? null,
        opponentId: m.opponent_id ?? null,
        matchCategory: m.match_category ?? 'serie',
        serieLetter: m.serie_letter ?? null,
        status: m.status,
        signupCloseDate: m.signup_close_date,
        minPlayers: m.min_players,
        maxPlayers: m.max_players,
        currentSignups: signups.length,
        userSignedUp: !!mySignup,
        signupId: mySignup?.signup_id ?? null,
        signupDeadlinePassed: deadlinePassed,
        // Sign-ups reopened because the match is short of players, and how many
        // more can still come in. Null spots-left outside the late window — there
        // is deliberately no cap on sign-ups before the deadline.
        lateSignupOpen: lateOpen,
        lateSignupSpotsLeft: lateOpen ? m.max_players - signups.length : null,
        // A sign-up made after the deadline is still withdrawable pre-publish —
        // otherwise a mistaken late sign-up would be stuck.
        signupIsLate: !!mySignup && new Date(mySignup.signed_up_at) > new Date(m.signup_close_date),
        isSelected,
        openSpot,
        // match_results.match_id is UNIQUE, so PostgREST embeds it as a to-one
        // object (or null), not an array.
        hasResult: Array.isArray(m.match_results) ? m.match_results.length > 0 : !!m.match_results,
        myClaim: myClaim ? { claimId: myClaim.claim_id, status: myClaim.status } : null,
      };
    });

    res.json({ success: true, data: { matches: enriched, pagination: { total: count ?? 0, limit, offset } } });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/season-overview — coach/admin
// Player × match grid for one season: who signed up, was selected, played or
// withdrew, plus matches played and selection % per player. Drafts (never
// announced) and cancelled matches are left out.
router.get('/season-overview', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const matchTypeFilter = (req.query.matchType as string | undefined) ?? 'all';
    await autoCompletePastMatches();

    const [{ data: users, error: usersError }, { data: allMatchDates, error: datesError }] = await Promise.all([
      supabaseAdmin.from('users')
        .select('user_id, name, is_active, is_placeholder')
        .in('role', ['player', 'coach', 'admin']).is('merged_into', null).order('name'),
      supabaseAdmin.from('matches').select('match_date, match_type')
        .not('status', 'in', '(draft,cancelled)'),
    ]);
    if (usersError) throw usersError;
    if (datesError) throw datesError;

    const availableYears = [...new Set(
      (allMatchDates ?? [])
        .filter((m: any) => matchTypeFilter === 'all' || m.match_type === matchTypeFilter)
        .map((m: any) => seasonStartYear(m.match_date, matchTypeFilter)),
    )].sort((a, b) => b - a);
    // Default to the season we're in, when it has matches; otherwise the latest.
    const currentYear = seasonStartYear(clubDateString(new Date()), matchTypeFilter);
    const defaultYear = availableYears.includes(currentYear) ? currentYear : (availableYears[0] ?? currentYear);
    const year = req.query.year ? parseInt(req.query.year as string) : defaultYear;

    const { start, end } = seasonRange(year, matchTypeFilter);
    let matchQuery = supabaseAdmin.from('matches')
      .select('match_id, match_date, match_time, match_type, match_category, opponent, status, min_players, max_players')
      .gte('match_date', start).lte('match_date', end)
      .not('status', 'in', '(draft,cancelled)')
      .order('match_date', { ascending: true }).order('match_time', { ascending: true });
    if (matchTypeFilter !== 'all') matchQuery = matchQuery.eq('match_type', matchTypeFilter);
    const { data: matchRows, error: matchError } = await matchQuery;
    if (matchError) throw matchError;

    const matchIds = (matchRows ?? []).map((m: any) => m.match_id);
    const [{ data: signupData }, { data: selectionData }, { data: perfData }] = matchIds.length > 0
      ? await Promise.all([
          supabaseAdmin.from('signups').select('match_id, player_id, is_active').in('match_id', matchIds),
          supabaseAdmin.from('selections').select('match_id, player_id').in('match_id', matchIds),
          supabaseAdmin.from('match_performance').select('match_id, player_id, attended').in('match_id', matchIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

    const signupByKey = new Map<string, 'active' | 'withdrawn'>();
    (signupData ?? []).forEach((s: any) => signupByKey.set(`${s.match_id}|${s.player_id}`, s.is_active ? 'active' : 'withdrawn'));
    const selectedKeys = new Set((selectionData ?? []).map((s: any) => `${s.match_id}|${s.player_id}`));
    const completedIds = new Set((matchRows ?? []).filter((m: any) => m.status === 'completed').map((m: any) => m.match_id));
    const playedKeys = buildPlayedKeys(selectionData ?? [], perfData ?? [], completedIds);

    const matches = (matchRows ?? []).map((m: any) => ({
      matchId: m.match_id,
      matchDate: m.match_date,
      matchTime: m.match_time,
      matchType: m.match_type,
      matchCategory: m.match_category ?? 'serie',
      opponent: m.opponent ?? null,
      status: m.status,
      minPlayers: m.min_players,
      maxPlayers: m.max_players,
      signupCount: (signupData ?? []).filter((s: any) => s.match_id === m.match_id && s.is_active).length,
      selectedCount: (selectionData ?? []).filter((s: any) => s.match_id === m.match_id).length,
    }));

    const players = (users ?? []).flatMap((u: any) => {
      const inputs = (matchRows ?? []).map((m: any) => {
        const key = `${m.match_id}|${u.user_id}`;
        return {
          matchId: m.match_id as string,
          status: m.status as string,
          signup: signupByKey.get(key) ?? null,
          selected: selectedKeys.has(key),
          played: playedKeys.has(key),
        };
      });
      const hasData = inputs.some(c => c.signup || c.selected || c.played);
      // Current squad members always show; placeholders and inactive players
      // only when they actually took part in this season.
      if (!(u.is_active && !u.is_placeholder) && !hasData) return [];

      const cells: Record<string, CellState> = {};
      for (const c of inputs) cells[c.matchId] = cellState(c);
      const pct = selectionPct(inputs);
      return [{
        userId: u.user_id,
        name: u.name,
        played: inputs.filter(c => c.played).length,
        selected: pct.selected,
        considered: pct.considered,
        selectionPct: pct.pct,
        cells,
      }];
    });

    res.json({
      success: true,
      data: {
        year,
        seasonLabel: seasonLabel(year, matchTypeFilter),
        availableSeasons: (availableYears.length > 0 ? availableYears : [year]).map(y => ({ year: y, label: seasonLabel(y, matchTypeFilter) })),
        matches,
        players,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/matches — coach/admin
router.post('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const body = CreateMatchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ugyldige oplysninger', details: body.data } });
      return;
    }

    const d = body.data;
    if (deadlineAfterKickoff(d.matchDate, d.matchTime, d.signupCloseDate)) {
      res.status(422).json({ success: false, error: DEADLINE_AFTER_KICKOFF });
      return;
    }

    const opp = await resolveOpponent(d.opponent, d.opponentId, req.user!.userId);
    const { data, error } = await supabaseAdmin.from('matches').insert({
      match_date: d.matchDate,
      match_time: d.matchTime,
      location: d.location,
      match_type: d.matchType,
      opponent: opp?.name ?? null,
      opponent_id: opp?.opponentId ?? null,
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

    // Sign-ups are live the moment the match is created (unless it's scheduled
    // to open later, in which case it's a draft and the cron announces it when
    // the time comes). The in-app notification fires now; the email is batched
    // by /api/cron/match-announcements so a burst of matches is one email.
    if (data.status === 'signup_open') {
      notifySignupOpen([data.match_id]).catch(err => console.error('Failed to announce sign-ups open:', err));
    }

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

const HistoricalMatchSchema = z.object({
  matchDate: z.string().date(),
  matchTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  opponent: z.string().max(100).optional(),
  opponentId: z.string().uuid().optional(),
  matchType: z.enum(['futsal', '7-player', '11-player']),
  matchCategory: z.enum(['serie', 'pokal']).default('serie'),
  serieLetter: z.string().max(10).optional(),
  participantIds: z.array(z.string().uuid()).default([]),
});

const TYPE_MIN_PLAYERS: Record<string, number> = { futsal: 5, '7-player': 7, '11-player': 11 };

// POST /api/matches/historical — coach/admin backfill a past, already-played match.
// Creates a completed match plus a signup + selection for each known participant
// (so games-played and attendance stay consistent), then the caller records the
// result through the normal /matches/:matchId/results wizard.
router.post('/historical', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const body = HistoricalMatchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ugyldige oplysninger', details: body.error.issues } });
      return;
    }
    const d = body.data;

    const matchTime = d.matchTime ? (d.matchTime.length === 5 ? `${d.matchTime}:00` : d.matchTime) : '18:00:00';
    const minPlayers = TYPE_MIN_PLAYERS[d.matchType];
    const maxPlayers = Math.max(minPlayers, d.participantIds.length || minPlayers);

    // Placeholder signup window before the match date (satisfies NOT NULL + close>open).
    const matchMs = new Date(`${d.matchDate}T00:00:00Z`).getTime();
    const signupOpen  = new Date(matchMs - 7 * 86_400_000).toISOString();
    const signupClose = new Date(matchMs - 1 * 86_400_000).toISOString();

    const opp = await resolveOpponent(d.opponent, d.opponentId, req.user!.userId);
    const { data: match, error } = await supabaseAdmin.from('matches').insert({
      match_date: d.matchDate,
      match_time: matchTime,
      location: 'Historical',
      match_type: d.matchType,
      opponent: opp?.name ?? null,
      opponent_id: opp?.opponentId ?? null,
      match_category: d.matchCategory,
      serie_letter: d.matchCategory === 'serie' ? (d.serieLetter ?? 'A') : null,
      signup_open_date: signupOpen,
      signup_close_date: signupClose,
      min_players: minPlayers,
      max_players: maxPlayers,
      priority_enabled: false,
      status: 'completed',
      completed_at: new Date().toISOString(),
      created_by: req.user!.userId,
    }).select().single();
    if (error) throw error;

    // Seed a signup + selection for each known participant.
    const participantIds = [...new Set(d.participantIds)];
    if (participantIds.length > 0) {
      await supabaseAdmin.from('signups').insert(
        participantIds.map(pid => ({ match_id: match.match_id, player_id: pid })),
      );
      await supabaseAdmin.from('selections').insert(
        participantIds.map(pid => ({
          match_id: match.match_id,
          player_id: pid,
          selected_by_optimization: false,
          manually_adjusted: true,
          is_priority_selection: false,
          selected_by: req.user!.userId,
        })),
      );
    }

    res.status(201).json({ success: true, data: { matchId: match.match_id } });
  } catch (err) {
    next(err);
  }
});

const UpdateMatchSchema = z.object({
  matchDate: z.string().date().optional(),
  matchTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  location: z.string().min(1).max(200).optional(),
  opponent: z.string().max(100).nullable().optional(),
  opponentId: z.string().uuid().nullable().optional(),
  matchCategory: z.enum(['serie', 'pokal']).optional(),
  serieLetter: z.string().max(10).nullable().optional(),
  status: z.enum(['draft','signup_open','signup_closed','optimized','published','completed','cancelled']).optional(),
  cancelledBy: z.enum(['us','opponent']).nullable().optional(),
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
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ugyldige oplysninger' } });
      return;
    }

    const d = body.data;

    // The prior row: needed to validate the edit against the fields it leaves
    // alone, and further down to detect a new cancellation or a moved match.
    const { data: existing } = await supabaseAdmin
      .from('matches')
      .select('status, match_date, match_time, location, opponent, cancelled_by, signup_close_date')
      .eq('match_id', matchId)
      .single();

    // Reject premature manual completion — the match must have already been played.
    if (d.status === 'completed' && existing) {
      if (kickoffInstant(existing.match_date, existing.match_time) > new Date()) {
        res.status(422).json({
          success: false,
          error: { code: 'PREMATURE_COMPLETION', message: 'Kampen kan ikke markeres som afsluttet, før den er spillet' },
        });
        return;
      }
    }

    // Moving either end of the window has to keep the deadline at or before
    // kick-off — including when only the match is moved and the deadline stays
    // put. Edits that touch neither are left alone, so a match that already has
    // a bad window can still have its venue or squad size fixed.
    if (existing && (d.matchDate !== undefined || d.matchTime !== undefined || d.signupCloseDate !== undefined)) {
      const nextDate = d.matchDate ?? existing.match_date;
      const nextTime = d.matchTime ?? existing.match_time;
      const nextClose = d.signupCloseDate ?? existing.signup_close_date;
      if (deadlineAfterKickoff(nextDate, nextTime, nextClose)) {
        res.status(422).json({ success: false, error: DEADLINE_AFTER_KICKOFF });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (d.matchDate !== undefined) updates.match_date = d.matchDate;
    if (d.matchTime !== undefined) updates.match_time = d.matchTime;
    if (d.location !== undefined) updates.location = d.location;
    // Opponent: resolve the FK and keep the denormalized `opponent` text in sync.
    // An explicit null on either field clears both.
    if (d.opponentId !== undefined || d.opponent !== undefined) {
      if (d.opponentId === null || (d.opponentId === undefined && d.opponent === null)) {
        updates.opponent_id = null;
        updates.opponent = null;
      } else {
        const opp = await resolveOpponent(d.opponent, d.opponentId ?? undefined, req.user!.userId);
        updates.opponent_id = opp?.opponentId ?? null;
        updates.opponent = opp?.name ?? null;
      }
    }
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

    // Who called the match off. Only meaningful while the match is cancelled, so
    // un-cancelling clears it (and the walkover result below with it).
    const nextStatus = d.status ?? existing?.status;
    if (d.cancelledBy != null && nextStatus !== 'cancelled') {
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'cancelledBy kan kun sættes på en aflyst kamp' },
      });
      return;
    }
    if (d.cancelledBy !== undefined) updates.cancelled_by = d.cancelledBy;
    if (nextStatus !== 'cancelled') updates.cancelled_by = null;

    const prevCancelledBy = (existing?.cancelled_by ?? null) as CancelledBy | null;
    const cancelledBy = ('cancelled_by' in updates ? updates.cancelled_by : prevCancelledBy) as CancelledBy | null;

    const { data, error } = await supabaseAdmin.from('matches').update(updates).eq('match_id', matchId).select().single();
    if (error) throw error;

    // Keep the walkover result in step with who cancelled: 3-0 to us when the
    // opponent called it off, 0-3 when we did. It's a team result only — nobody
    // played, so no match_performance rows and no achievement recompute.
    if (cancelledBy !== prevCancelledBy) {
      if (cancelledBy) {
        const { goalsFor, goalsAgainst } = walkoverScore(cancelledBy);
        await supabaseAdmin.from('match_results').upsert({
          match_id: matchId,
          goals_for: goalsFor,
          goals_against: goalsAgainst,
          recorded_by: req.user!.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'match_id' });
      } else {
        // Only ever removes a walkover — a played match's result is never touched.
        await supabaseAdmin.from('match_results').delete().eq('match_id', matchId);
      }
    }

    // Opening a draft by hand announces it, exactly as creating an open match
    // does. notifySignupOpen claims the match atomically, so this can't collide
    // with the cron doing the same flip.
    if (data.status === 'signup_open' && existing?.status === 'draft') {
      notifySignupOpen([String(matchId)]).catch(err => console.error('Failed to announce sign-ups open:', err));
    }

    // Fire cancellation emails only when transitioning into cancelled state
    if (d.status === 'cancelled' && existing && existing.status !== 'cancelled') {
      supabaseAdmin
        .from('selections')
        .select('users!selections_player_id_fkey(user_id, name, email)')
        .eq('match_id', matchId)
        .then(({ data: sel }) => {
          const rows = (sel ?? []).map((s: any) => s.users);
          const players = rows.filter((u: any) => u.email).map((u: any) => ({ name: u.name, email: u.email }));
          if (players.length > 0) {
            sendCancellationNotifications(players, {
              matchDate: existing.match_date,
              matchTime: existing.match_time,
              location: existing.location,
              opponent: existing.opponent ?? null,
            }, cancelledBy).catch(err => console.error('Failed to send cancellation notifications:', err));
          }
          const label = matchLabel({ match_date: existing.match_date, match_time: existing.match_time, opponent: existing.opponent });
          const outcome = cancelledBy === 'opponent'
            ? ' · Opponent called it off — scored as a 3–0 win'
            : cancelledBy === 'us'
              ? ' · We called it off — scored as a 0–3 loss'
              : '';
          createNotifications(rows.map((u: any) => u.user_id), {
            type: 'match_cancelled',
            title: 'Kamp aflyst',
            body: `${label}${outcome}`,
            link: '/dashboard',
            matchId: String(matchId),
          });
        });
    }

    // Notify squad + signed-up players when a visible match is moved/changed
    // (date, time or location). Skip drafts (not visible) and cancellations
    // (handled above).
    const dateChanged = d.matchDate !== undefined && d.matchDate !== existing?.match_date;
    const timeChanged = d.matchTime !== undefined && d.matchTime !== existing?.match_time;
    const locChanged  = d.location  !== undefined && d.location  !== existing?.location;
    if ((dateChanged || timeChanged || locChanged)
        && existing && existing.status !== 'draft' && existing.status !== 'cancelled'
        && d.status !== 'cancelled') {
      Promise.all([
        supabaseAdmin.from('selections').select('player_id').eq('match_id', matchId),
        supabaseAdmin.from('signups').select('player_id').eq('match_id', matchId).eq('is_active', true),
      ]).then(([{ data: sel }, { data: su }]) => {
        const ids = [
          ...(sel ?? []).map((s: any) => s.player_id),
          ...(su ?? []).map((s: any) => s.player_id),
        ];
        createNotifications(ids, {
          type: 'match_moved',
          title: 'Kampdetaljer ændret',
          body: `Nu ${matchLabel({ match_date: data.match_date, match_time: data.match_time, opponent: data.opponent })} · ${data.location}`,
          link: '/dashboard',
          matchId: String(matchId),
        });
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
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Kampen blev ikke fundet' } });
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
          opponentId: match.opponent_id ?? null,
          matchType: match.match_type,
          matchCategory: match.match_category ?? 'serie',
          serieLetter: match.serie_letter ?? null,
          status: match.status,
          cancelledBy: match.cancelled_by ?? null,
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
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Kampen blev ikke fundet' } });
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
      .select('users!selections_player_id_fkey(user_id, name, email)')
      .eq('match_id', matchId)
      .then(({ data: sel }) => {
        const rows = (sel ?? []).map((s: any) => s.users);
        const players = rows.filter((u: any) => u.email).map((u: any) => ({ name: u.name, email: u.email }));
        if (players.length > 0) {
          sendSelectionNotifications(players, {
            matchDate: match.match_date,
            matchTime: match.match_time,
            location: match.location,
            opponent: match.opponent ?? null,
          }).catch(err => console.error('Failed to send selection notifications:', err));
        }
        createNotifications(rows.map((u: any) => u.user_id), {
          type: 'selected',
          title: 'Du er udtaget',
          body: matchLabel(match),
          link: '/dashboard',
          matchId: String(matchId),
        });
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
      res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Du kan kun frigive en plads i en offentliggjort kamp' } });
      return;
    }

    const { data: selection } = await supabaseAdmin
      .from('selections')
      .select('selection_id')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .single();

    if (!selection) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Du er ikke udtaget til denne kamp' } });
      return;
    }

    await supabaseAdmin.from('selections').delete().eq('selection_id', selection.selection_id);

    const { data: playerProfile } = await supabaseAdmin.from('users').select('name').eq('user_id', playerId).single();

    // Notify all coaches and admins — fire-and-forget
    supabaseAdmin
      .from('users')
      .select('user_id, name, email')
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
        createNotifications((coaches ?? []).map((c: any) => c.user_id), {
          type: 'spot_released',
          title: 'Plads frigivet',
          body: `${playerProfile?.name ?? 'En spiller'} — ${matchLabel({ match_date: match.match_date, match_time: match.match_time, opponent: match.opponent })}`,
          link: `/coach/matches/${matchId}/selections`,
          matchId: String(matchId),
        });
      });

    // Announce the now-open spot to every active player not currently selected
    // for this match (the releasing player is already removed from selections) —
    // fire-and-forget.
    Promise.all([
      supabaseAdmin.from('users').select('user_id, name, email').eq('is_active', true),
      supabaseAdmin.from('selections').select('player_id').eq('match_id', matchId),
    ]).then(([{ data: allPlayers }, { data: selected }]) => {
      const selectedIds = new Set((selected ?? []).map((s: any) => s.player_id));
      const eligible = (allPlayers ?? []).filter((p: any) => !selectedIds.has(p.user_id) && p.user_id !== playerId);
      if (eligible.length === 0) return;

      const withEmail = eligible.filter((p: any) => p.email);
      if (withEmail.length > 0) {
        sendSpotOpenNotification(
          withEmail as { name: string; email: string }[],
          { matchDate: match.match_date, matchTime: match.match_time, location: match.location, opponent: match.opponent ?? null },
        ).catch(err => console.error('Failed to send spot-open notifications:', err));
      }
      createNotifications(eligible.map((p: any) => p.user_id), {
        type: 'spot_open',
        title: 'En plads er blevet ledig',
        body: `Overtag den ledige plads til ${matchLabel({ match_date: match.match_date, match_time: match.match_time, opponent: match.opponent })}`,
        link: '/dashboard',
        matchId: String(matchId),
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:matchId/guests
// GET /api/matches/:matchId/squad — the confirmed squad, visible to any player.
// Only exposed once the match is published (or completed), so players can't peek
// at selections before the coach publishes them.
router.get('/:matchId/squad', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const { data: match } = await supabaseAdmin
      .from('matches')
      .select('status')
      .eq('match_id', matchId)
      .single();

    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Kampen blev ikke fundet' } });
      return;
    }
    if (match.status !== 'published' && match.status !== 'completed') {
      res.status(403).json({ success: false, error: { code: 'NOT_PUBLISHED', message: 'Truppen er ikke offentliggjort endnu' } });
      return;
    }

    const [{ data: selections }, { data: guests }] = await Promise.all([
      supabaseAdmin.from('selections').select('player_id').eq('match_id', matchId),
      supabaseAdmin.from('guest_players').select('name, position').eq('match_id', matchId).order('created_at'),
    ]);

    const playerIds = (selections ?? []).map((s: any) => s.player_id);
    const { data: players } = playerIds.length > 0
      ? await supabaseAdmin.from('users').select('user_id, name, preferred_positions').in('user_id', playerIds)
      : { data: [] };

    const selected = (players ?? [])
      .map((p: any) => ({ userId: p.user_id, name: p.name, preferredPositions: p.preferred_positions ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const guestList = (guests ?? []).map((g: any) => ({ name: g.name, position: g.position ?? null }));

    res.json({
      success: true,
      data: { selected, guests: guestList, count: selected.length + guestList.length },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/matches/:matchId/signup-list — who has signed up, visible to any player.
// Names and positions only; the coach-only /signups route keeps the stats and
// priority flags. There is no sign-up cap, so this is deliberately not gated on
// the squad being published.
router.get('/:matchId/signup-list', authenticate, async (req, res, next) => {
  try {
    const { matchId } = req.params;

    const { data: match } = await supabaseAdmin
      .from('matches')
      .select('match_id')
      .eq('match_id', matchId)
      .single();

    if (!match) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Kampen blev ikke fundet' } });
      return;
    }

    const { data: signups } = await supabaseAdmin
      .from('signups')
      .select('users!signups_player_id_fkey(user_id, name, preferred_positions)')
      .eq('match_id', matchId)
      .eq('is_active', true);

    const players = (signups ?? [])
      .map((s: any) => ({
        userId: s.users.user_id,
        name: s.users.name,
        preferredPositions: s.users.preferred_positions ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: { players, count: players.length } });
  } catch (err) {
    next(err);
  }
});

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
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Navn skal udfyldes' } });
      return;
    }
    const validPositions = ['GK', 'DEF', 'WIN', 'MID', 'STR'];
    if (position && !validPositions.includes(position)) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ugyldig position' } });
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
