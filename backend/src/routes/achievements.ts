import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { catalog, teamCatalog, TIERS, PRIVATE_COUNT_CODES, type Tier } from '../lib/achievements.js';
import { computePlayerSeason, computeTeamSeason, seasonsWithMatches } from '../lib/achievementsStore.js';

const router = Router();

const tierRank = (t: Tier) => TIERS.indexOf(t);

/** Pick the default season: most recent with completed matches, else this year. */
async function resolveSeason(yearParam: unknown): Promise<number> {
  if (yearParam) return parseInt(String(yearParam), 10);
  const seasons = await seasonsWithMatches();
  return seasons[0] ?? new Date().getFullYear();
}

// GET /api/achievements — the full catalog (drives locked/greyed crests). Static.
router.get('/achievements', authenticate, (_req, res) => {
  res.json({ success: true, data: { individual: catalog(), team: teamCatalog(), tiers: TIERS } });
});

// GET /api/players/:playerId/achievements?year= — one player's earned crests,
// per-group progress and streaks. Shared: any authenticated teammate may read it.
// Returns badges/streaks only — never the raw signup/selection counts.
router.get('/players/:playerId/achievements', authenticate, async (req, res, next) => {
  try {
    const playerId = String(req.params.playerId);
    const season = await resolveSeason(req.query.year);

    const [{ data: profile }, result, { data: earnedRows }] = await Promise.all([
      supabaseAdmin.from('users').select('user_id, name, avatar_url').eq('user_id', playerId).single(),
      computePlayerSeason(playerId, season),
      supabaseAdmin
        .from('player_achievements')
        .select('achievement_code, tier, earned_at')
        .eq('player_id', playerId)
        .eq('season_year', season),
    ]);

    if (!profile) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
      return;
    }

    // Merge persisted earned_at onto the live computation.
    const earnedAt = new Map<string, string>();
    for (const r of (earnedRows ?? []) as any[]) earnedAt.set(`${r.achievement_code}:${r.tier}`, r.earned_at);

    // Tiers are shared, but a teammate must not see another player's exact
    // signup/selection counts. Redact those numbers for non-owner, non-staff viewers.
    const canSeeCounts = playerId === req.user!.userId || req.user!.role !== 'player';
    const redact = (code: string, value: number | null) =>
      !canSeeCounts && PRIVATE_COUNT_CODES.includes(code) ? null : value;

    res.json({
      success: true,
      data: {
        player: { userId: profile.user_id, name: profile.name, avatarUrl: profile.avatar_url ?? null },
        seasonYear: season,
        earned: result.earned.map(e => ({
          code: e.code,
          tier: e.tier,
          progress: redact(e.code, e.progress),
          earnedAt: earnedAt.get(`${e.code}:${e.tier}`) ?? null,
        })),
        groups: result.groups.map(g => ({
          code: g.code,
          value: redact(g.code, g.value),
          highestTier: g.highestTier,
          nextThreshold: redact(g.code, g.nextThreshold),
        })),
        streaks: result.streaks,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/players/achievements/team-wall?year= — every player's highest crest per
// group (from persisted rows, fast) plus live team/collective crests.
router.get('/players/achievements/team-wall', authenticate, async (req, res, next) => {
  try {
    const season = await resolveSeason(req.query.year);

    const [{ data: rows }, team] = await Promise.all([
      supabaseAdmin
        .from('player_achievements')
        .select('player_id, achievement_code, tier, progress, earned_at, users!player_achievements_player_id_fkey(name, avatar_url)')
        .eq('season_year', season),
      computeTeamSeason(season),
    ]);

    // Collapse to the highest tier each player holds per achievement group.
    type Best = { code: string; tier: Tier; progress: number; earnedAt: string };
    const byPlayer = new Map<string, { name: string; avatarUrl: string | null; best: Map<string, Best> }>();
    for (const r of (rows ?? []) as any[]) {
      const u = Array.isArray(r.users) ? r.users[0] : r.users;
      let entry = byPlayer.get(r.player_id);
      if (!entry) {
        entry = { name: u?.name ?? 'Player', avatarUrl: u?.avatar_url ?? null, best: new Map() };
        byPlayer.set(r.player_id, entry);
      }
      const cur = entry.best.get(r.achievement_code);
      if (!cur || tierRank(r.tier) > tierRank(cur.tier)) {
        entry.best.set(r.achievement_code, { code: r.achievement_code, tier: r.tier, progress: r.progress, earnedAt: r.earned_at });
      }
    }

    const players = [...byPlayer.entries()]
      .map(([playerId, e]) => ({
        playerId,
        name: e.name,
        avatarUrl: e.avatarUrl,
        crests: [...e.best.values()]
          .map(c => ({ ...c, progress: PRIVATE_COUNT_CODES.includes(c.code) ? null : c.progress }))
          .sort((a, b) => tierRank(b.tier) - tierRank(a.tier)),
      }))
      // Show the most-decorated squad members first.
      .sort((a, b) => b.crests.length - a.crests.length || a.name.localeCompare(b.name));

    res.json({
      success: true,
      data: { seasonYear: season, players, team: { earned: team.earned, groups: team.groups } },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
