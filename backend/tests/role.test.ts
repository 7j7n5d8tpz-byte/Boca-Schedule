import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch } from './helpers/data.js';

describe('Role enforcement', () => {
  let player: TestUser;
  let coach: TestUser;
  let admin: TestUser;
  let matchId: string;

  beforeAll(async () => {
    [player, coach, admin] = await Promise.all([
      createTestUser('player', '-role'),
      createTestUser('coach', '-role'),
      createTestUser('admin', '-role'),
    ]);
    const match = await createTestMatch();
    matchId = match.match_id;
  });

  afterAll(async () => {
    await deleteTestMatch(matchId);
    await Promise.all([
      deleteTestUser(player.userId),
      deleteTestUser(coach.userId),
      deleteTestUser(admin.userId),
    ]);
  });

  // ── Unauthenticated ─────────────────────────────────────────────────────────

  it('returns 401 for any protected route without a token', async () => {
    const res = await request(app).get('/api/matches/upcoming');
    expect(res.status).toBe(401);
  });

  // ── Coach-only endpoints ────────────────────────────────────────────────────

  it('player cannot create a match', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ matchDate: '2030-01-01', matchTime: '18:00', location: 'X', matchType: '7-player', minPlayers: 5, maxPlayers: 7 });
    expect(res.status).toBe(403);
  });

  it('coach can create a match', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-01-01',
        matchTime:       '18:00',
        location:        'X',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-01-01T18:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(201);
    // cleanup
    if (res.body.data?.matchId) await deleteTestMatch(res.body.data.matchId);
  });

  it('player cannot update selections', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ selectedPlayerIds: [] });
    expect(res.status).toBe(403);
  });

  it('player cannot view match signups list', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}/signups`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(403);
  });

  it('coach can view match signups list', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}/signups`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
  });

  // ── Admin-only endpoints ────────────────────────────────────────────────────

  it('player cannot access admin users list', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(403);
  });

  it('coach cannot access admin users list', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(403);
  });

  it('admin can access admin users list', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });

  // ── Player stats privacy ────────────────────────────────────────────────────

  it('player can view a teammate\'s statistics, with signups redacted', async () => {
    const res = await request(app)
      .get(`/api/players/${coach.userId}/statistics`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.seasonStats.total_signups).toBeNull();
  });

  it('player can view their own statistics, including signups', async () => {
    const res = await request(app)
      .get(`/api/players/${player.userId}/statistics`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.seasonStats.total_signups).toBeTypeOf('number');
    expect(res.body.data.player).toHaveProperty('avatarUrl');
    expect(Array.isArray(res.body.data.availableSeasons)).toBe(true);
    expect(res.body.data.seasonStats).toHaveProperty('gk_appearances');
    expect(res.body.data.seasonStats).toHaveProperty('total_yellow_cards');
    expect(res.body.data.seasonStats).toHaveProperty('total_red_cards');
  });

  it('coach sees a player\'s real signup count', async () => {
    const res = await request(app)
      .get(`/api/players/${player.userId}/statistics`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.seasonStats.total_signups).toBeTypeOf('number');
  });

  it('returns 404 for an unknown player id', async () => {
    const res = await request(app)
      .get('/api/players/00000000-0000-0000-0000-000000000000/statistics')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(404);
  });

  it('coach can view any player\'s statistics', async () => {
    const res = await request(app)
      .get(`/api/players/${player.userId}/statistics`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
  });

  // ── Result entry permissions ────────────────────────────────────────────────

  it('player without permission cannot save results', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ goalsFor: 2, goalsAgainst: 1, players: [] });
    expect(res.status).toBe(403);
  });

  it('player with can_enter_results can save results', async () => {
    await supabaseAdmin
      .from('users')
      .update({ can_enter_results: true })
      .eq('user_id', player.userId);

    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${player.token}`)
      .send({ goalsFor: 2, goalsAgainst: 1, players: [] });
    expect(res.status).toBe(200);

    // Reset
    await supabaseAdmin
      .from('users')
      .update({ can_enter_results: false })
      .eq('user_id', player.userId);
  });
});
