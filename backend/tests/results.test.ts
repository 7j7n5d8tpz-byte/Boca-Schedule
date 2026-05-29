import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

describe('Results', () => {
  let coach: TestUser;
  let player: TestUser;
  let playerWithPerm: TestUser;
  let matchId: string;

  beforeAll(async () => {
    [coach, player, playerWithPerm] = await Promise.all([
      createTestUser('coach', '-res'),
      createTestUser('player', '-res1'),
      createTestUser('player', '-res2'),
    ]);
    const match = await createTestMatch({ status: 'completed' });
    matchId = match.match_id;

    // Sign up and select both players
    await Promise.all([
      signupPlayer(matchId, player.userId),
      signupPlayer(matchId, playerWithPerm.userId),
    ]);
    await Promise.all([
      selectPlayer(matchId, player.userId),
      selectPlayer(matchId, playerWithPerm.userId),
    ]);

    // Grant result permission to playerWithPerm
    await supabaseAdmin
      .from('users')
      .update({ can_enter_results: true })
      .eq('user_id', playerWithPerm.userId);
  });

  afterAll(async () => {
    await deleteTestMatch(matchId);
    await Promise.all([
      deleteTestUser(coach.userId),
      deleteTestUser(player.userId),
      deleteTestUser(playerWithPerm.userId),
    ]);
  });

  const validPayload = () => ({
    goalsFor: 3,
    goalsAgainst: 1,
    gameAssessment: 'dominated',
    goalEvents: [],
    players: [],
  });

  it('GET results returns null result for a fresh match', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.result).toBeNull();
  });

  it('player without permission cannot save results', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${player.token}`)
      .send(validPayload());
    expect(res.status).toBe(403);
  });

  it('player with can_enter_results can save results', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${playerWithPerm.token}`)
      .send(validPayload());
    expect(res.status).toBe(200);
    expect(res.body.data.goalsFor).toBe(3);
  });

  it('coach can overwrite results', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ ...validPayload(), goalsFor: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.goalsFor).toBe(5);
  });

  it('GET results returns saved data correctly', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.result.goalsFor).toBe(5);
    expect(res.body.data.result.gameAssessment).toBe('dominated');
  });

  it('rejects results without required score fields', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ players: [] }); // missing goalsFor/goalsAgainst
    expect(res.status).toBe(422);
  });
});
