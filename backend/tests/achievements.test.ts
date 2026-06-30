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
  let scorer: TestUser;
  let teammate: TestUser;
  const matchIds: string[] = [];
  const SEASON = 2026;

  beforeAll(async () => {
    [coach, scorer, teammate] = await Promise.all([
      createTestUser('coach', '-ach'),
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
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(scorer.userId), deleteTestUser(teammate.userId)]);
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
});
