import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

// Recording a result triggers the achievement recompute (fire-and-forget). Wait
// for the persisted rows to appear rather than guessing at a fixed delay.
async function waitForAchievements(playerId: string, season: number, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const { data } = await supabaseAdmin
      .from('player_achievements')
      .select('player_achievement_id')
      .eq('player_id', playerId)
      .eq('season_year', season)
      .limit(1);
    if (data && data.length > 0) return;
    await new Promise(r => setTimeout(r, 150));
  }
}

describe('Achievements', () => {
  let coach: TestUser;
  let admin: TestUser;
  let scorer: TestUser;
  let teammate: TestUser;
  const matchIds: string[] = [];
  const SEASON = 2026;

  beforeAll(async () => {
    [coach, admin, scorer, teammate] = await Promise.all([
      createTestUser('coach', '-ach'),
      createTestUser('admin', '-ach-admin'),
      createTestUser('player', '-ach-scorer'),
      createTestUser('player', '-ach-mate'),
    ]);

    // A completed match where `scorer` signs up, is selected, and bags goals.
    const match = await createTestMatch({ status: 'published', match_date: `${SEASON}-03-01` });
    matchIds.push(match.match_id);
    await signupPlayer(match.match_id, scorer.userId);
    await selectPlayer(match.match_id, scorer.userId);

    // Record the result via the API → fires the recompute.
    const res = await request(app)
      .post(`/api/matches/${match.match_id}/results`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        goalsFor: 4,
        goalsAgainst: 0,
        manOfMatchId: scorer.userId,
        players: [
          { playerId: scorer.userId, attended: true, goals: 4, assists: 1, cleanSheet: true },
        ],
      });
    expect(res.status).toBe(200);
    await waitForAchievements(scorer.userId, SEASON);
  });

  afterAll(async () => {
    await Promise.all(matchIds.map(deleteTestMatch));
    await supabaseAdmin.from('player_achievements').delete().in('player_id', [scorer.userId, teammate.userId]);
    await supabaseAdmin.from('player_streaks').delete().in('player_id', [scorer.userId, teammate.userId]);
    await Promise.all([
      deleteTestUser(coach.userId), deleteTestUser(admin.userId),
      deleteTestUser(scorer.userId), deleteTestUser(teammate.userId),
    ]);
  });

  it('serves the static catalog with the 7-tier ladder', async () => {
    const res = await request(app).get('/api/achievements').set('Authorization', `Bearer ${scorer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tiers).toEqual(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'legend']);
    const goals = res.body.data.individual.find((a: any) => a.code === 'goals_scored');
    expect(goals.tiers).toHaveLength(7);
  });

  it('awards crests from a recorded result', async () => {
    const res = await request(app)
      .get(`/api/players/${scorer.userId}/achievements?year=${SEASON}`)
      .set('Authorization', `Bearer ${scorer.token}`);
    expect(res.status).toBe(200);

    const goalTiers = res.body.data.earned.filter((e: any) => e.code === 'goals_scored').map((e: any) => e.tier);
    expect(goalTiers).toContain('bronze'); // 4 goals ≥ 1
    expect(goalTiers).toContain('silver'); // 4 goals ≥ 3
    expect(goalTiers).not.toContain('platinum'); // 4 < 10

    // Owner sees their own counts.
    expect(res.body.data.groups.find((g: any) => g.code === 'goals_scored').value).toBe(4);
    expect(res.body.data.groups.find((g: any) => g.code === 'matches_played').value).toBe(1);
  });

  it('lets a teammate see the badges but redacts the private signup/selection counts', async () => {
    const res = await request(app)
      .get(`/api/players/${scorer.userId}/achievements?year=${SEASON}`)
      .set('Authorization', `Bearer ${teammate.token}`);
    expect(res.status).toBe(200);

    // Shared: the goal badges are visible.
    const goalTiers = res.body.data.earned.filter((e: any) => e.code === 'goals_scored').map((e: any) => e.tier);
    expect(goalTiers).toContain('silver');
    // Private: exact matches_played / signups_made counts are nulled out…
    expect(res.body.data.groups.find((g: any) => g.code === 'matches_played').value).toBeNull();
    expect(res.body.data.groups.find((g: any) => g.code === 'signups_made').value).toBeNull();
    // …while the goal count (already public via leaderboards) stays.
    expect(res.body.data.groups.find((g: any) => g.code === 'goals_scored').value).toBe(4);
  });

  it('lists the scorer and the team crests on the team wall', async () => {
    const res = await request(app)
      .get(`/api/players/achievements/team-wall?year=${SEASON}`)
      .set('Authorization', `Bearer ${teammate.token}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.players.find((p: any) => p.playerId === scorer.userId);
    expect(entry).toBeTruthy();
    expect(entry.crests.length).toBeGreaterThan(0);
    // Team won 4-0 → at least team_wins bronze.
    expect(res.body.data.team.earned.some((e: any) => e.code === 'team_wins')).toBe(true);
  });

  // A merged-away placeholder used to keep its crests, so the team wall — which
  // reads the persisted rows joined to `users` — rendered it as a ghost teammate
  // that appeared on no other page.
  it('hands a merged placeholder\'s crests to the real account and drops it off the wall', async () => {
    const { data: ph } = await supabaseAdmin
      .from('users')
      .insert({
        email: `placeholder-${Date.now()}@bocatest.internal`,
        name: 'Ghost Placeholder',
        role: 'player',
        is_active: false,
        is_placeholder: true,
        preferred_positions: [],
      })
      .select('user_id')
      .single();
    const placeholderId = (ph as any).user_id as string;

    // `signups_made` bronze is 1 sign-up, which the scorer genuinely has — so the
    // recompute the merge fires cannot revoke it and the assertions below are stable.
    await supabaseAdmin.from('player_achievements').insert({
      player_id: placeholderId,
      achievement_code: 'signups_made',
      tier: 'bronze',
      season_year: SEASON,
      progress: 3,
    });

    const before = await request(app)
      .get(`/api/players/achievements/team-wall?year=${SEASON}`)
      .set('Authorization', `Bearer ${teammate.token}`);
    expect(before.body.data.players.some((p: any) => p.playerId === placeholderId)).toBe(true);

    const merge = await request(app)
      .post(`/api/admin/users/${placeholderId}/merge`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ targetUserId: scorer.userId });
    expect(merge.status).toBe(200);

    // The tombstone keeps no rows of its own…
    const { data: left } = await supabaseAdmin
      .from('player_achievements')
      .select('player_achievement_id')
      .eq('player_id', placeholderId);
    expect(left ?? []).toHaveLength(0);

    // …the crest sits on the real account…
    const { data: moved } = await supabaseAdmin
      .from('player_achievements')
      .select('achievement_code, tier')
      .eq('player_id', scorer.userId)
      .eq('season_year', SEASON);
    expect((moved ?? []).some((r: any) => r.achievement_code === 'signups_made' && r.tier === 'bronze')).toBe(true);

    // …and the ghost is gone from the wall.
    const after = await request(app)
      .get(`/api/players/achievements/team-wall?year=${SEASON}`)
      .set('Authorization', `Bearer ${teammate.token}`);
    expect(after.body.data.players.some((p: any) => p.playerId === placeholderId)).toBe(false);

    await supabaseAdmin.from('player_achievements').delete().eq('player_id', placeholderId);
    await supabaseAdmin.from('player_streaks').delete().eq('player_id', placeholderId);
    await supabaseAdmin.from('users').update({ merged_into: null }).eq('user_id', placeholderId);
    await supabaseAdmin.from('users').delete().eq('user_id', placeholderId);
  });
});
