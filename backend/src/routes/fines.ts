import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { createNotifications } from '../lib/notifications.js';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function fineMatchLabel(m: { match_date: string; match_time?: string; opponent?: string | null }): string {
  const date = new Date(`${m.match_date}T${m.match_time ?? '00:00'}`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return m.opponent ? `${date} vs ${m.opponent}` : date;
}

// A fine admin is anyone with the is_fine_admin flag, plus every app admin.
async function isFineAdmin(userId: string, role: string): Promise<boolean> {
  if (role === 'admin') return true;
  const { data } = await supabaseAdmin.from('users').select('is_fine_admin').eq('user_id', userId).single();
  return data?.is_fine_admin ?? false;
}

// Anyone who may record results may also issue (match, list-type) fines.
async function canEnterResults(userId: string, role: string): Promise<boolean> {
  if (role === 'coach' || role === 'admin') return true;
  const { data } = await supabaseAdmin.from('users').select('can_enter_results').eq('user_id', userId).single();
  return data?.can_enter_results ?? false;
}

// Active user_ids who should be alerted about fines needing attention.
async function fineAdminIds(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('user_id')
    .eq('is_active', true)
    .or('is_fine_admin.eq.true,role.eq.admin');
  return (data ?? []).map((u: any) => u.user_id);
}

async function getPaymentInfo(): Promise<string> {
  const { data } = await supabaseAdmin.from('system_config').select('config_value').eq('config_key', 'fines_payment_info').maybeSingle();
  return typeof data?.config_value === 'string' ? data.config_value : '';
}

const FINE_SELECT = `
  fine_id, player_id, amount_dkk, reason, match_id, status, disputed, dispute_note,
  created_at, approved_at, paid_claimed_at, confirmed_at, voided_at, void_reason,
  player:users!fines_player_id_fkey(user_id, name),
  type:fine_types!fines_fine_type_id_fkey(label),
  match:matches!fines_match_id_fkey(match_date, match_time, opponent)
`;

function mapFine(f: any) {
  return {
    fineId: f.fine_id,
    playerId: f.player_id,
    playerName: f.player?.name ?? null,
    amountDkk: f.amount_dkk,
    typeLabel: f.type?.label ?? null,
    reason: f.reason ?? null,
    matchId: f.match_id ?? null,
    matchLabel: f.match ? fineMatchLabel(f.match) : null,
    status: f.status,
    disputed: f.disputed ?? false,
    disputeNote: f.dispute_note ?? null,
    createdAt: f.created_at,
    approvedAt: f.approved_at ?? null,
    paidClaimedAt: f.paid_claimed_at ?? null,
    confirmedAt: f.confirmed_at ?? null,
  };
}

function forbidden(res: any, message = 'Insufficient permissions') {
  res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message } });
}

// ─── Fine types (catalogue) ───────────────────────────────────────────────────

// GET /api/fine-types — active types; fine admins may request inactive too.
router.get('/fine-types', authenticate, async (req, res, next) => {
  try {
    const wantAll = req.query.includeInactive === 'true' && (await isFineAdmin(req.user!.userId, req.user!.role));
    let query = supabaseAdmin.from('fine_types').select('*').order('sort_order').order('label');
    if (!wantAll) query = query.eq('active', true);
    const { data, error } = await query;
    if (error) throw error;
    res.json({
      success: true,
      data: (data ?? []).map((t: any) => ({
        fineTypeId: t.fine_type_id,
        label: t.label,
        amountDkk: t.amount_dkk,
        active: t.active,
        sortOrder: t.sort_order,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/fine-types — fine admin creates a type
router.post('/fine-types', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { label, amountDkk, sortOrder } = req.body as { label?: string; amountDkk?: number; sortOrder?: number };
    if (!label?.trim() || typeof amountDkk !== 'number' || amountDkk < 0) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'label and a non-negative amountDkk are required' } });
      return;
    }
    const { data, error } = await supabaseAdmin.from('fine_types')
      .insert({ label: label.trim(), amount_dkk: Math.round(amountDkk), sort_order: sortOrder ?? 0 })
      .select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data: { fineTypeId: data.fine_type_id } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fine-types/:id — fine admin edits a type (label/amount/active/order)
router.put('/fine-types/:id', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { label, amountDkk, active, sortOrder } = req.body as { label?: string; amountDkk?: number; active?: boolean; sortOrder?: number };
    const patch: Record<string, unknown> = {};
    if (typeof label === 'string') patch.label = label.trim();
    if (typeof amountDkk === 'number') patch.amount_dkk = Math.round(amountDkk);
    if (typeof active === 'boolean') patch.active = active;
    if (typeof sortOrder === 'number') patch.sort_order = sortOrder;
    if (Object.keys(patch).length === 0) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Nothing to update' } });
      return;
    }
    const { error } = await supabaseAdmin.from('fine_types').update(patch).eq('fine_type_id', req.params.id);
    if (error) throw error;
    res.json({ success: true, data: { fineTypeId: req.params.id } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/fine-types/:id — fine admin deactivates a type (kept for history).
router.delete('/fine-types/:id', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { error } = await supabaseAdmin.from('fine_types').update({ active: false }).eq('fine_type_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Issuing a fine ───────────────────────────────────────────────────────────

// POST /api/fines — issue a fine.
//   • list fine on a match  → anyone with results access (pending_approval)
//   • custom-amount fine     → fine admin only
//   • non-match fine         → fine admin only
//   • issued by a fine admin → auto-approved
router.post('/fines', authenticate, async (req, res, next) => {
  try {
    const { userId, role } = req.user!;
    const { playerId, fineTypeId, amountDkk, reason, matchId } = req.body as {
      playerId?: string; fineTypeId?: string | null; amountDkk?: number; reason?: string | null; matchId?: string | null;
    };

    if (!playerId) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'playerId is required' } });
      return;
    }

    const fineAdmin = await isFineAdmin(userId, role);
    const isCustom = !fineTypeId;
    const isNonMatch = !matchId;

    // Permission gates
    if (isCustom || isNonMatch) {
      if (!fineAdmin) return forbidden(res, 'Only fine admins can issue custom or non-match fines');
    } else if (!(await canEnterResults(userId, role))) {
      return forbidden(res, 'No permission to issue fines');
    }

    // Resolve amount + snapshot
    let amount: number;
    if (isCustom) {
      if (typeof amountDkk !== 'number' || amountDkk < 0) {
        res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A non-negative amountDkk is required for a custom fine' } });
        return;
      }
      if (!reason?.trim()) {
        res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'A reason is required for a custom fine' } });
        return;
      }
      amount = Math.round(amountDkk);
    } else {
      const { data: type } = await supabaseAdmin.from('fine_types').select('amount_dkk, active').eq('fine_type_id', fineTypeId).maybeSingle();
      if (!type) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fine type not found' } });
        return;
      }
      amount = type.amount_dkk;
    }

    const status = fineAdmin ? 'approved' : 'pending_approval';
    const now = new Date().toISOString();

    const { data: fine, error } = await supabaseAdmin.from('fines').insert({
      player_id: playerId,
      fine_type_id: fineTypeId ?? null,
      amount_dkk: amount,
      reason: reason?.trim() || null,
      match_id: matchId ?? null,
      status,
      issued_by: userId,
      approved_by: fineAdmin ? userId : null,
      approved_at: fineAdmin ? now : null,
    }).select('fine_id').single();
    if (error) throw error;

    // Notify — fire-and-forget
    if (status === 'approved') {
      createNotifications([playerId], {
        type: 'fine_issued',
        title: 'You received a fine',
        body: `${amount} DKK — see your fines`,
        link: '/fines',
        refId: fine.fine_id,
      });
    } else {
      fineAdminIds().then(ids => createNotifications(ids, {
        type: 'fine_pending_approval',
        title: 'Fine awaiting approval',
        body: 'A new fine needs your approval',
        link: '/fines/manage',
        refId: fine.fine_id,
      }));
    }

    res.status(201).json({ success: true, data: { fineId: fine.fine_id, status } });
  } catch (err) {
    next(err);
  }
});

// ─── Player views ─────────────────────────────────────────────────────────────

// GET /api/fines/my — current user's fines + totals + payment info.
// Pending/rejected/voided fines are hidden from the fined player.
router.get('/fines/my', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('fines')
      .select(FINE_SELECT)
      .eq('player_id', req.user!.userId)
      .in('status', ['approved', 'payment_claimed', 'paid'])
      .order('created_at', { ascending: false });
    if (error) throw error;

    const fines = (data ?? []).map(mapFine);
    const sum = (s: string) => fines.filter(f => f.status === s).reduce((a, f) => a + f.amountDkk, 0);

    res.json({
      success: true,
      data: {
        fines,
        totals: {
          outstandingDkk: sum('approved'),
          claimedDkk: sum('payment_claimed'),
          paidDkk: sum('paid'),
        },
        paymentInfo: await getPaymentInfo(),
        isFineAdmin: await isFineAdmin(req.user!.userId, req.user!.role),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/fines — shared team ledger (full transparency incl. paid status).
// Only fines that have cleared approval are visible to the team.
router.get('/fines', authenticate, async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('fines')
      .select(FINE_SELECT)
      .in('status', ['approved', 'payment_claimed', 'paid'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: (data ?? []).map(mapFine) });
  } catch (err) {
    next(err);
  }
});

// GET /api/fines/stats — fun team-wide fine statistics (optionally ?year=YYYY).
router.get('/fines/stats', authenticate, async (req, res, next) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? req.query.year : 'all';

    const [{ data: fineRows, error }, { data: roster }, { data: matchRows }, { data: selRows }] = await Promise.all([
      supabaseAdmin.from('fines').select(FINE_SELECT).in('status', ['approved', 'payment_claimed', 'paid']),
      supabaseAdmin.from('users').select('user_id, name').eq('is_active', true).in('role', ['player', 'coach', 'admin']),
      supabaseAdmin.from('matches').select('match_id, match_date').in('status', ['completed', 'published']),
      supabaseAdmin.from('selections').select('player_id, match_id'),
    ]);
    if (error) throw error;

    let fines = (fineRows ?? []).map(mapFine);
    const availableYears = [...new Set(fines.map(f => new Date(f.createdAt).getFullYear()))].sort((a, b) => b - a);

    const inYear = (iso: string) => yearParam === 'all' || new Date(iso).getFullYear() === Number(yearParam);
    fines = fines.filter(f => inYear(f.createdAt));

    // Completed matches in the period, and per-player squad appearances (denominator for kr/game).
    const completedMatchIds = new Set((matchRows ?? []).filter((m: any) => inYear(m.match_date)).map((m: any) => m.match_id));
    const matchCount = completedMatchIds.size;
    const gamesPlayed = new Map<string, number>();
    for (const s of (selRows ?? [])) {
      if (completedMatchIds.has((s as any).match_id)) {
        gamesPlayed.set((s as any).player_id, (gamesPlayed.get((s as any).player_id) ?? 0) + 1);
      }
    }

    const what = (f: any) => f.typeLabel ?? f.reason ?? 'Custom';

    // The pot
    const collectedDkk = fines.filter(f => f.status === 'paid').reduce((a, f) => a + f.amountDkk, 0);
    const outstandingDkk = fines.filter(f => f.status !== 'paid').reduce((a, f) => a + f.amountDkk, 0);

    // Per-player totals
    const byPlayer = new Map<string, { name: string; totalDkk: number; count: number }>();
    for (const f of fines) {
      const r = byPlayer.get(f.playerId) ?? { name: f.playerName ?? '', totalDkk: 0, count: 0 };
      r.totalDkk += f.amountDkk; r.count += 1;
      byPlayer.set(f.playerId, r);
    }
    const topFined = [...byPlayer.entries()]
      .map(([playerId, v]) => ({ playerId, ...v }))
      .sort((a, b) => b.totalDkk - a.totalDkk || b.count - a.count)
      .slice(0, 5);

    // Most fined per game — match-linked fines ÷ squad appearances (normalizes for playing time)
    const MIN_GAMES = 1;
    const byPlayerMatch = new Map<string, { name: string; matchDkk: number }>();
    for (const f of fines) {
      if (!f.matchId) continue;
      const r = byPlayerMatch.get(f.playerId) ?? { name: f.playerName ?? '', matchDkk: 0 };
      r.matchDkk += f.amountDkk;
      byPlayerMatch.set(f.playerId, r);
    }
    const topPerGame = [...byPlayerMatch.entries()]
      .map(([playerId, v]) => ({ playerId, name: v.name, totalDkk: v.matchDkk, games: gamesPlayed.get(playerId) ?? 0 }))
      .filter(p => p.games >= MIN_GAMES)
      .map(p => ({ ...p, perGameDkk: Math.round(p.totalDkk / p.games) }))
      .sort((a, b) => b.perGameDkk - a.perGameDkk || b.totalDkk - a.totalDkk)
      .slice(0, 5);

    // Saints — active players with no fines this period
    const saints = (roster ?? [])
      .filter((u: any) => !byPlayer.has(u.user_id))
      .map((u: any) => u.name);

    // Favourite fine + type breakdown
    const byType = new Map<string, { count: number; totalDkk: number }>();
    for (const f of fines) {
      const k = what(f);
      const r = byType.get(k) ?? { count: 0, totalDkk: 0 };
      r.count += 1; r.totalDkk += f.amountDkk;
      byType.set(k, r);
    }
    const typeBreakdown = [...byType.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count);
    const favouriteFine = typeBreakdown[0] ?? null;

    // Per game (match-linked fines only)
    const matchFinesTotal = fines.filter(f => f.matchId).reduce((a, f) => a + f.amountDkk, 0);
    const perGameDkk = matchCount > 0 ? Math.round(matchFinesTotal / matchCount) : 0;

    // Biggest single fine
    const biggest = fines.reduce((m, f) => (!m || f.amountDkk > m.amountDkk ? f : m), null as any);
    const biggestFine = biggest ? { playerName: biggest.playerName, label: what(biggest), amountDkk: biggest.amountDkk, when: biggest.matchLabel ?? new Date(biggest.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) } : null;

    // Most expensive match
    const byMatch = new Map<string, { label: string; totalDkk: number }>();
    for (const f of fines) {
      if (!f.matchId) continue;
      const r = byMatch.get(f.matchId) ?? { label: f.matchLabel ?? 'Match', totalDkk: 0 };
      r.totalDkk += f.amountDkk;
      byMatch.set(f.matchId, r);
    }
    const mostExpensiveMatch = [...byMatch.values()].sort((a, b) => b.totalDkk - a.totalDkk)[0] ?? null;

    // Over time (by month)
    const byMonth = new Map<string, number>();
    for (const f of fines) {
      const d = new Date(f.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + f.amountDkk);
    }
    const overTime = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, totalDkk]) => {
      const [y, m] = period.split('-');
      return { period, label: new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), totalDkk };
    });

    res.json({
      success: true,
      data: {
        availableYears,
        pot: { collectedDkk, outstandingDkk, totalDkk: collectedDkk + outstandingDkk },
        topFined,
        topPerGame,
        saints,
        favouriteFine,
        perGameDkk,
        biggestFine,
        mostExpensiveMatch,
        typeBreakdown,
        overTime,
        fineCount: fines.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/fines/pay-outstanding — player claims ALL their approved fines paid.
router.post('/fines/pay-outstanding', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('fines')
      .update({ status: 'payment_claimed', paid_claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('player_id', req.user!.userId)
      .eq('status', 'approved')
      .select('fine_id, amount_dkk');
    if (error) throw error;

    const count = data?.length ?? 0;
    if (count > 0) {
      const total = data!.reduce((a: number, f: any) => a + f.amount_dkk, 0);
      supabaseAdmin.from('users').select('name').eq('user_id', req.user!.userId).single().then(({ data: u }) => {
        fineAdminIds().then(ids => createNotifications(ids, {
          type: 'fine_payment_claimed',
          title: 'Fine payment claimed',
          body: `${u?.name ?? 'A player'} says they paid ${total} DKK (${count} fine${count === 1 ? '' : 's'})`,
          link: '/fines/manage',
        }));
      });
    }

    res.json({ success: true, data: { claimed: count } });
  } catch (err) {
    next(err);
  }
});

// POST /api/fines/:id/claim-paid — player claims one approved fine paid.
router.post('/fines/:id/claim-paid', authenticate, async (req, res, next) => {
  try {
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status, amount_dkk').eq('fine_id', req.params.id).single();
    if (!fine || fine.player_id !== req.user!.userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fine not found' } });
      return;
    }
    if (fine.status !== 'approved') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Only an outstanding fine can be marked paid' } });
      return;
    }
    await supabaseAdmin.from('fines')
      .update({ status: 'payment_claimed', paid_claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('fine_id', req.params.id);

    supabaseAdmin.from('users').select('name').eq('user_id', req.user!.userId).single().then(({ data: u }) => {
      fineAdminIds().then(ids => createNotifications(ids, {
        type: 'fine_payment_claimed',
        title: 'Fine payment claimed',
        body: `${u?.name ?? 'A player'} says they paid ${fine.amount_dkk} DKK`,
        link: '/fines/manage',
        refId: String(req.params.id),
      }));
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/fines/:id/dispute — player disputes one of their own fines.
router.post('/fines/:id/dispute', authenticate, async (req, res, next) => {
  try {
    const { note } = req.body as { note?: string };
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status').eq('fine_id', req.params.id).single();
    if (!fine || fine.player_id !== req.user!.userId) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fine not found' } });
      return;
    }
    await supabaseAdmin.from('fines')
      .update({ disputed: true, dispute_note: note?.trim() || null, updated_at: new Date().toISOString() })
      .eq('fine_id', req.params.id);
    fineAdminIds().then(ids => createNotifications(ids, {
      type: 'fine_pending_approval',
      title: 'Fine disputed',
      body: 'A player disputed a fine',
      link: '/fines/manage',
      refId: String(req.params.id),
    }));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── Fine-admin management ──────────────────────────────────────────────────

// GET /api/fines/admin — queues, who-paid overview, treasury totals.
router.get('/fines/admin', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);

    const [{ data: all, error }, paymentInfo] = await Promise.all([
      supabaseAdmin.from('fines').select(FINE_SELECT).order('created_at', { ascending: false }),
      getPaymentInfo(),
    ]);
    if (error) throw error;

    const fines = (all ?? []).map(mapFine);
    const pendingApproval = fines.filter(f => f.status === 'pending_approval');
    const paymentClaimed = fines.filter(f => f.status === 'payment_claimed');

    // Per-player overview across approved/claimed/paid
    const byPlayer = new Map<string, { playerId: string; name: string; outstandingDkk: number; claimedDkk: number; paidDkk: number; unpaidCount: number }>();
    for (const f of fines) {
      if (!['approved', 'payment_claimed', 'paid'].includes(f.status)) continue;
      const row = byPlayer.get(f.playerId) ?? { playerId: f.playerId, name: f.playerName ?? '', outstandingDkk: 0, claimedDkk: 0, paidDkk: 0, unpaidCount: 0 };
      if (f.status === 'approved') { row.outstandingDkk += f.amountDkk; row.unpaidCount += 1; }
      else if (f.status === 'payment_claimed') { row.claimedDkk += f.amountDkk; row.unpaidCount += 1; }
      else if (f.status === 'paid') { row.paidDkk += f.amountDkk; }
      byPlayer.set(f.playerId, row);
    }
    const overview = [...byPlayer.values()].sort((a, b) => (b.outstandingDkk + b.claimedDkk) - (a.outstandingDkk + a.claimedDkk));

    const treasury = {
      collectedDkk: fines.filter(f => f.status === 'paid').reduce((a, f) => a + f.amountDkk, 0),
      outstandingDkk: fines.filter(f => ['approved', 'payment_claimed'].includes(f.status)).reduce((a, f) => a + f.amountDkk, 0),
    };

    res.json({ success: true, data: { pendingApproval, paymentClaimed, overview, treasury, paymentInfo } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fines/:id/approve — approve or reject a pending fine.
router.put('/fines/:id/approve', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { approve } = req.body as { approve: boolean };
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status, amount_dkk').eq('fine_id', req.params.id).single();
    if (!fine || fine.status !== 'pending_approval') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending fine not found' } });
      return;
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from('fines').update({
      status: approve ? 'approved' : 'rejected',
      approved_by: req.user!.userId,
      approved_at: now,
      updated_at: now,
    }).eq('fine_id', req.params.id);

    if (approve) {
      createNotifications([fine.player_id], {
        type: 'fine_issued',
        title: 'You received a fine',
        body: `${fine.amount_dkk} DKK — see your fines`,
        link: '/fines',
        refId: String(req.params.id),
      });
    }
    res.json({ success: true, data: { status: approve ? 'approved' : 'rejected' } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fines/:id/confirm-paid — admin confirms money received.
router.put('/fines/:id/confirm-paid', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status').eq('fine_id', req.params.id).single();
    if (!fine || !['payment_claimed', 'approved'].includes(fine.status)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'Fine cannot be confirmed paid' } });
      return;
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from('fines').update({ status: 'paid', confirmed_by: req.user!.userId, confirmed_at: now, updated_at: now }).eq('fine_id', req.params.id);
    createNotifications([fine.player_id], {
      type: 'fine_payment_confirmed',
      title: 'Fine payment confirmed',
      body: 'Your fine payment was confirmed — thanks!',
      link: '/fines',
      refId: String(req.params.id),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fines/:id/reject-claim — money not received; bounce back to outstanding.
router.put('/fines/:id/reject-claim', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status').eq('fine_id', req.params.id).single();
    if (!fine || fine.status !== 'payment_claimed') {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATE', message: 'No payment claim to reject' } });
      return;
    }
    await supabaseAdmin.from('fines').update({ status: 'approved', paid_claimed_at: null, updated_at: new Date().toISOString() }).eq('fine_id', req.params.id);
    createNotifications([fine.player_id], {
      type: 'fine_claim_rejected',
      title: 'Payment not received',
      body: 'A fine you marked paid is still outstanding — please check your payment',
      link: '/fines',
      refId: String(req.params.id),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fines/:id/void — cancel a fine (issued in error, etc.).
router.put('/fines/:id/void', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { reason } = req.body as { reason?: string };
    const { data: fine } = await supabaseAdmin.from('fines').select('player_id, status').eq('fine_id', req.params.id).single();
    if (!fine || fine.status === 'voided') {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Fine not found' } });
      return;
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from('fines').update({ status: 'voided', voided_by: req.user!.userId, voided_at: now, void_reason: reason?.trim() || null, updated_at: now }).eq('fine_id', req.params.id);
    createNotifications([fine.player_id], {
      type: 'fine_voided',
      title: 'A fine was cancelled',
      body: reason?.trim() ? `A fine was voided: ${reason.trim()}` : 'One of your fines was cancelled',
      link: '/fines',
      refId: String(req.params.id),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/fines/payment-info — fine admin edits the MobilePay box / instructions.
router.put('/fines/payment-info', authenticate, async (req, res, next) => {
  try {
    if (!(await isFineAdmin(req.user!.userId, req.user!.role))) return forbidden(res);
    const { paymentInfo } = req.body as { paymentInfo?: string };
    if (typeof paymentInfo !== 'string') {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'paymentInfo is required' } });
      return;
    }
    const { error } = await supabaseAdmin.from('system_config')
      .update({ config_value: paymentInfo, updated_by: req.user!.userId, updated_at: new Date().toISOString() })
      .eq('config_key', 'fines_payment_info');
    if (error) throw error;
    res.json({ success: true, data: { paymentInfo } });
  } catch (err) {
    next(err);
  }
});

export default router;
